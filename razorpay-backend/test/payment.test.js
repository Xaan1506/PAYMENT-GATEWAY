const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, test } = require('node:test');
const { createApp } = require('../app');

const PAYMENT_SECRET = 'payment-test-secret';
const WEBHOOK_SECRET = 'webhook-test-secret';
let baseUrl;
let server;
let receivedOrderOptions;

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

async function post(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

before(async () => {
  const app = createApp({
    getRazorpayClient: () => ({
      orders: {
        create: async (options) => {
          receivedOrderOptions = options;
          return {
            id: 'order_test123',
            entity: 'order',
            amount: options.amount,
            amount_paid: 0,
            amount_due: options.amount,
            currency: options.currency,
            receipt: options.receipt,
            status: 'created',
            created_at: 1700000000
          };
        }
      }
    }),
    getPaymentSecret: () => PAYMENT_SECRET,
    getWebhookSecret: () => WEBHOOK_SECRET,
    logger: { info() {} }
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health endpoint responds successfully', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('creates an order and defaults currency to INR', async () => {
  const response = await post('/api/payment/create-order', { amount: 50000 });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.order.id, 'order_test123');
  assert.equal(receivedOrderOptions.amount, 50000);
  assert.equal(receivedOrderOptions.currency, 'INR');
  assert.ok(receivedOrderOptions.receipt.length <= 40);
});

test('rejects invalid and fractional amounts', async () => {
  for (const amount of [0, -1, 1.5, '500']) {
    const response = await post('/api/payment/create-order', { amount });
    assert.equal(response.status, 400);
  }
});

test('rejects missing payment details', async () => {
  const response = await post('/api/payment/verify', { razorpay_order_id: 'order_test123' });
  assert.equal(response.status, 400);
});

test('accepts a valid payment signature and rejects an invalid one', async () => {
  const orderId = 'order_test123';
  const paymentId = 'pay_test123';
  const validSignature = hmac(PAYMENT_SECRET, `${orderId}|${paymentId}`);
  const validResponse = await post('/api/payment/verify', {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: validSignature
  });
  assert.equal(validResponse.status, 200);

  const invalidResponse = await post('/api/payment/verify', {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: '0'.repeat(64)
  });
  assert.equal(invalidResponse.status, 400);
});

test('accepts webhook with valid raw-body signature and rejects invalid or missing signatures', async () => {
  const rawBody = '{"event":"payment.captured","payload":{}}';
  const signature = hmac(WEBHOOK_SECRET, rawBody);
  const validResponse = await post('/api/payment/webhook', rawBody, {
    'x-razorpay-signature': signature
  });
  assert.equal(validResponse.status, 200);
  assert.equal((await validResponse.json()).handled, true);

  const invalidResponse = await post('/api/payment/webhook', rawBody, {
    'x-razorpay-signature': 'f'.repeat(64)
  });
  assert.equal(invalidResponse.status, 400);

  const missingResponse = await post('/api/payment/webhook', rawBody);
  assert.equal(missingResponse.status, 400);
});
