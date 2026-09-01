'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/approvalController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

router.get('/',     authenticate, requirePermission('approval.request', 'approval.decide'), ctrl.listApprovals);
router.post('/',    authenticate, requirePermission('approval.request'), ctrl.requestApproval);
router.get('/:id',  authenticate, requirePermission('approval.request', 'approval.decide'), ctrl.getApproval);
router.post('/:id/decide',   authenticate, requirePermission('approval.decide'), ctrl.decideApproval);
router.post('/:id/escalate', authenticate, requirePermission('approval.escalate'), ctrl.escalateApproval);

module.exports = router;
