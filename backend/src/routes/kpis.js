'use strict';
/**
 * KPI routes. One permission — `kpi.read` — held by every role that has a
 * dashboard, and by none of technician, referrer or readonly.
 */
const router = require('express').Router();
const ctrl = require('../controllers/kpiController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

const auth = [authenticate, requirePermission('kpi.read')];

router.get('/summary',      ...auth, ctrl.summary);
router.get('/sales',        ...auth, ctrl.salesKpis);
router.get('/delivery',     ...auth, ctrl.deliveryKpis);
router.get('/installation', ...auth, ctrl.installationKpis);

module.exports = router;
