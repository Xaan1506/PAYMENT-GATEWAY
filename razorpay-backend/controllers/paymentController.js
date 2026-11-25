const crypto = require('node:crypto');

const SIGNATURE_PATTERN = /^[a-fA-F0-9]{64}$/;

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function signaturesMatch(expectedHex, receivedHex) {
  if (typeof receivedHex !== 'string' || !SIGNATURE_PATTERN.test(receivedHex)) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function createPaymentController({
  getRazorpayClient,
  getPaymentSecret = () => process.env.RAZORPAY_KEY_SECRET,
  getWebhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET,
  logger = console
}) {
  async function createOrder(req, res, next) {
    try {
      const { amount, currency = 'INR' } = req.body || {};
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw createHttpError(400, 'amount must be a positive safe integer in the smallest currency unit (for INR, paise).');
      }

      if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
        throw createHttpError(400, 'currency must be a valid three-letter currency code.');
      }

      const order = await getRazorpayClient().orders.create({
        amount,
        currency: currency.toUpperCase(),
        receipt: `rcpt_${crypto.randomUUID().replaceAll('-', '')}`
      });

      res.status(201).json({
        success: true,
        order: {
          id: order.id,
          entity: order.entity,
          amount: order.amount,
          amount_paid: order.amount_paid,
          amount_due: order.amount_due,
          currency: order.currency,
          receipt: order.receipt,
          status: order.status,
          created_at: order.created_at
        }
      });
    } catch (error) {
      if (!error.status) {
        error.status = 502;
        error.message = 'Unable to create a Razorpay order.';
      }
      next(error);
    }
  }

  function verifyPayment(req, res, next) {
    try {
      const {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: receivedSignature
      } = req.body || {};

      if (!orderId || !paymentId || !receivedSignature) {
        throw createHttpError(400, 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.');
      }

      const secret = getPaymentSecret();
      if (!secret) {
        throw createHttpError(503, 'Payment verification is not configured. Set RAZORPAY_KEY_SECRET.');
      }

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // Compare fixed-length signature bytes in constant time to avoid timing leaks.
      if (!signaturesMatch(expectedSignature, receivedSignature)) {
        throw createHttpError(400, 'Invalid payment signature.');
      }

      res.status(200).json({ success: true, message: 'Payment signature verified.' });
    } catch (error) {
      next(error);
    }
  }

  function verifyWebhook(req, res, next) {
    try {
      const receivedSignature = req.get('x-razorpay-signature');
      if (!receivedSignature) {
        throw createHttpError(400, 'Missing x-razorpay-signature header.');
      }
      if (!Buffer.isBuffer(req.body)) {
        throw createHttpError(400, 'Webhook body must be sent as application/json.');
      }

      const secret = getWebhookSecret();
      if (!secret) {
        throw createHttpError(503, 'Webhook verification is not configured. Set RAZORPAY_WEBHOOK_SECRET.');
      }

      // Razorpay signs the exact raw bytes; parsing and re-serializing JSON changes that input.
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(req.body)
        .digest('hex');

      if (!signaturesMatch(expectedSignature, receivedSignature)) {
        throw createHttpError(400, 'Invalid webhook signature.');
      }

      let event;
      try {
        event = JSON.parse(req.body.toString('utf8'));
      } catch {
        throw createHttpError(400, 'Webhook body must contain valid JSON.');
      }

      const handled = event.event === 'payment.captured' || event.event === 'order.paid';
      if (handled) {
        logger.info(`Received Razorpay event: ${event.event}`);
      }

      res.status(200).json({
        success: true,
        received: true,
        event: event.event || null,
        handled
      });
    } catch (error) {
      next(error);
    }
  }

  return { createOrder, verifyPayment, verifyWebhook };
}

module.exports = { createPaymentController };
