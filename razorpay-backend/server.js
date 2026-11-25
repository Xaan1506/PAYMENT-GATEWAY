require('dotenv').config();

const { createApp } = require('./app');

const port = Number.parseInt(process.env.PORT || '5001', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const app = createApp();
app.listen(port, () => {
  console.log(`Razorpay backend listening on port ${port}`);
});
