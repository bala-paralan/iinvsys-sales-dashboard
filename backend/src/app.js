'use strict';
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const compression = require('compression');
const routes     = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

/* ── Security & Transport ── */
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

/* ── Rate Limiting ── */
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: process.env.RATE_LIMIT || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
}));

/* ── Stricter limit on auth routes ── */
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
}));

/* ── Parsing ── */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ── Logging ── */
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

/* ── Health Check ── */
app.get('/api/health', (req, res) => res.json({
  success: true,
  status: 'healthy',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  version: require('../package.json').version,
}));

/* ── API Routes ── */
app.use('/api', routes);

/* ── 404 Handler ── */
app.use((req, res) => res.status(404).json({
  success: false,
  error: `Route ${req.method} ${req.originalUrl} not found`,
}));

/* ── Global Error Handler ── */
app.use(errorHandler);

module.exports = app;
