'use strict';
/**
 * Vercel serverless entry point.
 * Keeps the MongoDB connection cached across warm invocations.
 * Local development still uses server.js (which calls app.listen).
 */
require('dotenv').config();
const app       = require('./src/app');
const connectDB = require('./src/config/db');

let connected = false;

module.exports = async (req, res) => {
  if (!connected) {
    await connectDB();
    connected = true;
  }
  return app(req, res);
};
