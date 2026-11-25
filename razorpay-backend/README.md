# Razorpay Payment Backend

A minimal, modular Express backend demonstrating Razorpay order creation, payment-signature verification, and webhook-signature verification. It uses Razorpay Test Mode credentials and does not include a frontend, database, or authentication layer.

## Technologies

- Node.js (18+), Express.js, Razorpay Node.js SDK
- dotenv, CORS, Node.js `crypto`
- Nodemon for development
- Node's built-in test runner for API tests

## Project structure

```text
razorpay-backend/
├── config/razorpay.js
├── controllers/paymentController.js
├── middleware/errorHandler.js
├── postman/Razorpay-Backend.postman_collection.json
├── routes/paymentRoutes.js
├── test/payment.test.js
├── .env.example
├── .gitignore
├── app.js
├── package.json
├── README.md
└── server.js
```

## Install and configure

```bash
cd razorpay-backend
npm install
cp .env.example .env
```

Open `.env` and set your credentials:

```dotenv
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_signing_secret
PORT=5000
```

Never commit `.env`; `.gitignore` excludes it. The API key secret and webhook secret remain server-side and are never returned by the API.

### Obtain Razorpay test credentials

1. Create/sign in to a Razorpay account at [razorpay.com](https://razorpay.com/).
2. Open **Account & Settings → Website and app settings** (or **API Keys**, depending on the dashboard layout).
3. Use **Generate Test Key** while in Test Mode.
4. Copy the Key ID and Key Secret to the corresponding `.env` values. Keep the secret private.
5. Configure a webhook in Test Mode and set its signing secret separately as `RAZORPAY_WEBHOOK_SECRET`.

## Run

```bash
npm run dev
```

For a normal process:

```bash
npm start
```

The server listens on port `5000` by default. Check `GET http://localhost:5000/api/health`.

## API

All request/response bodies are JSON except that the webhook endpoint deliberately reads the original raw request bytes before parsing.

### `POST /api/payment/create-order`

Creates a Razorpay order. `amount` must be a positive safe integer in the smallest unit of the currency: **paise for INR** (for example, `50000` paise is ₹500). `currency` is optional and defaults to `INR`.

Request:

```json
{
  "amount": 50000,
  "currency": "INR"
}
```

Success (`201 Created`):

```json
{
  "success": true,
  "order": {
    "id": "order_...",
    "entity": "order",
    "amount": 50000,
    "amount_paid": 0,
    "amount_due": 50000,
    "currency": "INR",
    "receipt": "receipt_...",
    "status": "created",
    "created_at": 1700000000
  }
}
```

Invalid amounts/currency return `400`; missing server-side credentials return `503`; Razorpay order-creation failures return `502`.

### `POST /api/payment/verify`

Verifies the checkout response fields using the server-side `RAZORPAY_KEY_SECRET`.

Request:

```json
{
  "razorpay_order_id": "order_...",
  "razorpay_payment_id": "pay_...",
  "razorpay_signature": "signature_from_checkout"
}
```

Success (`200 OK`):

```json
{ "success": true, "message": "Payment signature verified." }
```

Missing fields or an invalid signature return `400`. This confirms signature authenticity; an application handling fulfillment should also fetch/validate the payment and order state with Razorpay before fulfilling an order.

### `POST /api/payment/webhook`

Set `Content-Type: application/json` and include the Razorpay-signed `x-razorpay-signature` header. The endpoint validates the signature over the exact raw request body bytes using `RAZORPAY_WEBHOOK_SECRET`. Missing/invalid signatures return `400`; successful deliveries are acknowledged with `200`.

The endpoint recognizes `payment.captured` and `order.paid` events and reports `handled: true`. Other valid events are acknowledged with `handled: false`. Extend the controller with durable, idempotent application-specific work before relying on webhook events for fulfillment.

Example response:

```json
{
  "success": true,
  "received": true,
  "event": "payment.captured",
  "handled": true
}
```

### `GET /api/health`

Returns `200 OK` with `{ "success": true, "status": "ok" }`.

## Signature verification

### Checkout payment signature

Razorpay's checkout signature is an HMAC-SHA256 hex digest of:

```text
razorpay_order_id + "|" + razorpay_payment_id
```

The backend computes that digest with `RAZORPAY_KEY_SECRET`, validates the received hex format, then compares equal-length digest bytes using Node's `crypto.timingSafeEqual`. Do not send the key secret to a browser.

### Webhook signature

The webhook signature is an HMAC-SHA256 hex digest of the **original raw HTTP body bytes**, keyed with `RAZORPAY_WEBHOOK_SECRET`. The webhook route installs `express.raw()` before the general `express.json()` middleware. Re-serializing parsed JSON can alter whitespace, field ordering, or escaping, so it must not be used as signature input.

## Test with Postman

Import `postman/Razorpay-Backend.postman_collection.json` in Postman. The collection includes health, order creation, invalid amount, payment verification, and webhook examples.

1. Start the server and use the `baseUrl` collection variable.
2. For order creation, send `amount: 50000` to create a ₹500 test order. Use the returned order ID with the Razorpay Checkout test flow in a client.
3. For payment verification, submit the actual `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` returned by Checkout. Do not invent a successful signature for a real deployment.
4. For manual webhook testing, set a valid HMAC-SHA256 hex signature in `x-razorpay-signature`. Its input is the exact body text shown in Postman and its key is your webhook secret. A signature made with the wrong body or secret returns `400`.

Run the automated scenarios locally:

```bash
npm test
```

These tests use an injected fake Razorpay client, so they do not create real transactions or require API credentials.

## Configure Razorpay webhooks

1. In the Razorpay Dashboard, switch to **Test Mode** and open **Account & Settings → Webhooks**.
2. Add a webhook URL reachable by Razorpay, such as your deployed HTTPS URL or a temporary HTTPS tunnel to local port `5000`, ending in `/api/payment/webhook`.
3. Choose at least `payment.captured` and `order.paid` as the events to receive.
4. Set a webhook secret and configure the same value as `RAZORPAY_WEBHOOK_SECRET` on this backend. The webhook secret is distinct from the API Key Secret.
5. Save, trigger a test event, and confirm the endpoint returns `200`. In production, use HTTPS and implement durable/idempotent event processing appropriate for your application.

## GitHub submission

From the project directory, after creating an empty GitHub repository:

```bash
git init
git add .
git commit -m "Add Razorpay payment integration backend"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPOSITORY>.git
git push -u origin main
```

Confirm `.env` is not staged before pushing:

```bash
git status --short
```
