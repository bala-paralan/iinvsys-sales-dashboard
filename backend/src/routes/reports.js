'use strict';
const router = require('express').Router();
const { authenticate }   = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');
const { requirePermission } = require('../middleware/rbac');
const {
  getConfig,
  updateConfig,
  sendNow,
  previewData,
  downloadReport,
} = require('../controllers/reportController');

// GET  /api/reports/config   — superadmin only
router.get('/config',    authenticate, requireMinRole('superadmin'), getConfig);

// PUT  /api/reports/config   — superadmin only
router.put('/config',    authenticate, requireMinRole('superadmin'), updateConfig);

// POST /api/reports/send     — superadmin or manager
router.post('/send',     authenticate, requireMinRole('manager'), sendNow);

// GET  /api/reports/preview  — superadmin or manager
router.get('/preview',   authenticate, requireMinRole('manager'), previewData);

/* GET /api/reports/export.xlsx — scoped by role, not gated to managers.
   `kpi.read` rather than a new `report.export` verb: doc 04 defines no export
   permission, and "may see performance numbers" is exactly what kpi.read
   means. What each role actually GETS is narrowed by `scopeFor()` in
   utils/excelReport.js — an agent's workbook holds their own leads and no
   delivery or installation sheets at all. */
router.get('/export.xlsx',
  authenticate, requirePermission('kpi.read'), downloadReport);

module.exports = router;
