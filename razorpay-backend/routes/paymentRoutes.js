const express = require('express');

function createPaymentRouter(controller) {
  const router = express.Router();

  router.post('/create-order', controller.createOrder);
  router.post('/verify', controller.verifyPayment);

  return router;
}

module.exports = { createPaymentRouter };
