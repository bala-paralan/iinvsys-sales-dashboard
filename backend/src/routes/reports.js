'use strict';
const router = require('express').Router();
const { authenticate }   = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');
const {
  getConfig,
  updateConfig,
  sendNow,
  previewData,
} = require('../controllers/reportController');

// GET  /api/reports/config   — superadmin only
router.get('/config',    authenticate, requireMinRole('superadmin'), getConfig);

// PUT  /api/reports/config   — superadmin only
router.put('/config',    authenticate, requireMinRole('superadmin'), updateConfig);

// POST /api/reports/send     — superadmin or manager
router.post('/send',     authenticate, requireMinRole('manager'), sendNow);

// GET  /api/reports/preview  — superadmin or manager
router.get('/preview',   authenticate, requireMinRole('manager'), previewData);

module.exports = router;
