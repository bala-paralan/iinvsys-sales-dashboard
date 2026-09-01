'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/dealController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

/*
 * Sales — ERP Bible V3 document 2.
 *
 * The SPENCO stages, gates and advance endpoint stay on /api/leads: they predate V3 and
 * are unchanged. These are the commercial decisions doc 2 layers on top.
 *
 * attachScope on every route, because doc 2's defining constraint is a row rule —
 * "Sales Manager 1 cannot see that Sales Manager 2 is at only 44% of target."
 */

/* Static paths first, so they are not shadowed by /:id. */
router.get('/board',    authenticate, requirePermission('lead.read'), attachScope, ctrl.board);
router.get('/team',     authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.teamPerformance);
router.get('/forecast', authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.forecast);

router.post('/', authenticate, requirePermission('lead.write'), attachScope, ctrl.createDeal);

/* Anyone may ASK for a discount; whether it needs a decision at all is the tier's
   business, decided server-side in dealService. */
router.post('/:id/discount', authenticate, requirePermission('approval.request'), attachScope, ctrl.requestDiscount);
router.post('/:id/proposal', authenticate, requirePermission('lead.write'), attachScope, ctrl.recordProposal);
router.post('/:id/commercial-order', authenticate, requirePermission('approval.request'), attachScope, ctrl.submitCommercialOrder);

router.post('/discounts/:id/decide', authenticate, requirePermission('approval.decide'), attachScope, ctrl.decideDiscount);
/* Confirming a Commercial Order is what starts Production, so it is the Director's alone
   — `deal.approve_deviation` in name if not in spelling. */
router.post('/commercial-orders/:id/confirm', authenticate, requirePermission('approval.decide'), attachScope, ctrl.confirmCommercialOrder);

module.exports = router;
