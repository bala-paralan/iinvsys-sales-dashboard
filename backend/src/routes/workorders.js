'use strict';
/**
 * Work Order routes — every one behind requirePermission(), never the ladder.
 * The verbs mirror docs/requirements/04-roles-and-permissions.md: a warehouse
 * operator can advance and upload but cannot accept or commit a date; only
 * roles holding workorder.deliver can close the delivery.
 */
const router = require('express').Router();
const ctrl = require('../controllers/workOrderController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

router.get('/',    authenticate, requirePermission('workorder.read'), attachScope, ctrl.listWorkOrders);
router.get('/:id', authenticate, requirePermission('workorder.read'), attachScope, ctrl.getWorkOrder);
router.get('/:id/gate', authenticate, requirePermission('workorder.read'), attachScope, ctrl.previewWorkOrderGate);

router.post('/:id/accept',      authenticate, requirePermission('workorder.accept'), attachScope,      ctrl.acceptWorkOrder);
router.post('/:id/commit-date', authenticate, requirePermission('workorder.commit_date'), attachScope, ctrl.commitDate);
router.post('/:id/delay',       authenticate, requirePermission('workorder.commit_date'), attachScope, ctrl.logDelay);
router.post('/:id/advance',     authenticate, requirePermission('workorder.advance'), attachScope,     ctrl.advanceWorkOrder);
router.post('/:id/dispatch',    authenticate, requirePermission('workorder.dispatch'), attachScope,    ctrl.dispatchWorkOrder);
router.post('/:id/deliver',     authenticate, requirePermission('workorder.deliver'), attachScope,     ctrl.deliverWorkOrder);
router.post('/:id/upload',
  authenticate, requirePermission('workorder.upload'), attachScope, ctrl.uploadMiddleware, ctrl.uploadAttachment);

module.exports = router;
