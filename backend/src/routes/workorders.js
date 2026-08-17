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

router.get('/',    authenticate, requirePermission('workorder.read'), ctrl.listWorkOrders);
router.get('/:id', authenticate, requirePermission('workorder.read'), ctrl.getWorkOrder);
router.get('/:id/gate', authenticate, requirePermission('workorder.read'), ctrl.previewWorkOrderGate);

router.post('/:id/accept',      authenticate, requirePermission('workorder.accept'),      ctrl.acceptWorkOrder);
router.post('/:id/commit-date', authenticate, requirePermission('workorder.commit_date'), ctrl.commitDate);
router.post('/:id/delay',       authenticate, requirePermission('workorder.commit_date'), ctrl.logDelay);
router.post('/:id/advance',     authenticate, requirePermission('workorder.advance'),     ctrl.advanceWorkOrder);
router.post('/:id/dispatch',    authenticate, requirePermission('workorder.dispatch'),    ctrl.dispatchWorkOrder);
router.post('/:id/deliver',     authenticate, requirePermission('workorder.deliver'),     ctrl.deliverWorkOrder);
router.post('/:id/upload',
  authenticate, requirePermission('workorder.upload'), ctrl.uploadMiddleware, ctrl.uploadAttachment);

module.exports = router;
