'use strict';
const router = require('express').Router();
const { authenticate }   = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const {
  getConfig,
  updateConfig,
  sendNow,
  previewData,
  downloadReport,
} = require('../controllers/reportController');

// GET  /api/reports/config   — superadmin only
router.get('/config',    authenticate, requireRole('superadmin'), getConfig);

// PUT  /api/reports/config   — superadmin only
router.put('/config',    authenticate, requireRole('superadmin'), updateConfig);

/* Mailing the report to the configured distribution list, and previewing what would be
   mailed, are a different right from downloading your own scoped workbook: these reach
   other people's inboxes carrying team-wide figures. `kpi.read_team` is the line — the
   same one that separates a manager's dashboard from an executive's. */
router.post('/send',     authenticate, requirePermission('kpi.read_team'), sendNow);
router.get('/preview',   authenticate, requirePermission('kpi.read_team'), previewData);

/* GET /api/reports/export.xlsx — self-service, scoped by role rather than gated to
   managers. What each role actually GETS is narrowed by `scopeFor()` in
   utils/excelReport.js: an executive's workbook holds their own leads, and a
   finance-blind role's holds no value columns at all. */
router.get('/export.xlsx',
  authenticate, requirePermission('report.export'), downloadReport);

module.exports = router;
