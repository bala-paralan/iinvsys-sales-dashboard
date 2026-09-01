'use strict';
/**
 * KPI routes.
 *
 * `kpi.read` is the gate; `attachScope` decides WHOSE numbers come back. In v2 these
 * four endpoints had no scoping at all — kpiService took only a window — so every role
 * holding kpi.read received company-wide pipeline value, win rate and revenue. Doc 2
 * forbids exactly that twice: SA-MGR-01 ("No company-wide revenue numbers — only what's
 * within their domain team") and SA-DIR-01 ("Sales Manager 1 cannot see that Sales
 * Manager 2 is at only 44% of target").
 */
const router = require('express').Router();
const ctrl = require('../controllers/kpiController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

const auth = [authenticate, requirePermission('kpi.read'), attachScope];

router.get('/summary',      ...auth, ctrl.summary);
router.get('/sales',        ...auth, ctrl.salesKpis);
router.get('/delivery',     ...auth, ctrl.deliveryKpis);
router.get('/installation', ...auth, ctrl.installationKpis);

module.exports = router;
