const express = require('express');
const cors = require('cors');
const { getRazorpayClient } = require('./config/razorpay');
const { createPaymentController } = require('./controllers/paymentController');
const { createPaymentRouter } = require('./routes/paymentRoutes');
const { errorHandler } = require('./middleware/errorHandler');

function createApp(options = {}) {
  const app = express();
  const controller = createPaymentController({
    getRazorpayClient: options.getRazorpayClient || getRazorpayClient,
    getPaymentSecret: options.getPaymentSecret,
    getWebhookSecret: options.getWebhookSecret,
    logger: options.logger
  });

  app.use(cors());
  app.disable('x-powered-by');

  app.get('/api/health', (req, res) => {
    res.status(200).json({ success: true, status: 'ok' });
  });

  // This route must consume raw bytes before express.json() parses ordinary API requests.
  app.post(
    '/api/payment/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    controller.verifyWebhook
  );

  app.use(express.json({ limit: '100kb' }));
  app.use('/api/payment', createPaymentRouter(controller));
  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Route not found.' });
  });
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
