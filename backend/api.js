'use strict';
/**
 * Vercel serverless entry point.
 * Keeps the MongoDB connection cached across warm invocations.
 * Local development still uses server.js (which calls app.listen).
 */
require('dotenv').config();
const app       = require('./src/app');
const connectDB = require('./src/config/db');

let connectionPromise = null;

function ensureDB() {
  if (!connectionPromise) {
    connectionPromise = connectDB().catch(err => {
      // Reset so next request retries
      connectionPromise = null;
      throw err;
    });
  }
  return connectionPromise;
}

module.exports = async (req, res) => {
  console.log(`[Vercel] ${req.method} ${req.url} — JWT_SECRET set: ${!!process.env.JWT_SECRET} — MONGO_URI set: ${!!process.env.MONGO_URI}`);

  // Health check responds without waiting for DB
  if (req.url === '/api/health' || req.url === '/api/health/') {
    return app(req, res);
  }
  try {
    await ensureDB();
  } catch (err) {
    console.error('[Vercel] DB connection error:', err.message);
    return res.status(503).json({ success: false, error: 'Database unavailable. Please try again.' });
  }
  try {
    return await new Promise((resolve, reject) => {
      res.on('finish', resolve);
      res.on('error', reject);
      app(req, res);
    });
  } catch (err) {
    console.error('[Vercel] Unhandled app error:', err.stack || err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message, stack: err.stack });
    }
  }
};
