'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/productionController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

/*
 * Production & Delivery — ERP Bible V3 document 3.
 *
 * The permission split IS doc 3's rule set:
 *
 *   workorder.read      Head and engineer both — but attachScope narrows the engineer to
 *                       "my assigned orders", and productionController.visibleFields()
 *                       strips the money before it leaves Mongo.
 *   workorder.advance   the engineer's own work: WIP steps, QC submission, flagging.
 *   workorder.dispatch  Head only — engineer assignment, BOM, QC approval, dispatch auth.
 *                       "Engineers cannot mark an order as dispatch ready."
 */

router.get('/workload', authenticate, requirePermission('workorder.dispatch'), attachScope, ctrl.workload);

router.get('/orders',     authenticate, requirePermission('workorder.read'), attachScope, ctrl.listOrders);
router.get('/orders/:id', authenticate, requirePermission('workorder.read'), attachScope, ctrl.getOrder);

/* ── Production Head only ─────────────────────────────────────────────────── */
router.post('/orders/:id/assign',        authenticate, requirePermission('workorder.dispatch'), attachScope, ctrl.assignEngineer);
router.put('/orders/:id/bom',            authenticate, requirePermission('workorder.dispatch'), attachScope, ctrl.setBom);
router.post('/orders/:id/qc/decide',     authenticate, requirePermission('workorder.dispatch'), attachScope, ctrl.decideQc);
router.post('/orders/:id/dispatch-auth', authenticate, requirePermission('workorder.dispatch'), attachScope, ctrl.authoriseDispatch);

/* ── The engineer's own work ──────────────────────────────────────────────── */
router.patch('/orders/:id/steps/:stepId', authenticate, requirePermission('workorder.advance'), attachScope, ctrl.updateStep);
router.post('/orders/:id/steps/:stepId/photo', authenticate, requirePermission('workorder.upload'), attachScope, ctrl.uploadMiddleware, ctrl.uploadStepPhoto);
router.post('/orders/:id/qc',     authenticate, requirePermission('workorder.advance'), attachScope, ctrl.submitQc);
router.post('/orders/:id/issues', authenticate, requirePermission('workorder.advance'), attachScope, ctrl.flagIssue);

module.exports = router;
