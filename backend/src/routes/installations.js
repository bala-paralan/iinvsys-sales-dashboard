'use strict';
/**
 * Installation & CS routes — permissions per doc 04.
 *
 * `install.execute` is the technician's verb (checklists, snags,
 * commissioning); `install.assign` plans and schedules; `install.handover`
 * closes I4; `feedback.log` and `feedback.corrective_action` belong to
 * Customer Service. A technician holds none of the feedback verbs — recording
 * a customer's satisfaction score is not the job of the person being scored.
 */
const router = require('express').Router();
const ctrl = require('../controllers/installationController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

/* Static before /:id */
router.get('/csat', authenticate, requirePermission('kpi.read'), ctrl.csatDashboard);

router.get('/',    authenticate, requirePermission('install.read'), ctrl.listJobs);
router.get('/:id', authenticate, requirePermission('install.read'), ctrl.getJob);
router.get('/:id/gate', authenticate, requirePermission('install.read'), ctrl.previewJobGate);

router.post('/:id/plan',    authenticate, requirePermission('install.assign'),  ctrl.planJob);
router.patch('/:id/checklist', authenticate, requirePermission('install.execute'), ctrl.updateChecklist);
router.post('/:id/snags',   authenticate, requirePermission('install.execute'), ctrl.addSnag);
router.patch('/:id/snags/:snagId/close', authenticate, requirePermission('install.execute'), ctrl.closeSnag);
router.post('/:id/commissioning', authenticate, requirePermission('install.execute'), ctrl.recordCommissioning);
router.post('/:id/advance', authenticate, requirePermission('install.advance'), ctrl.advanceJob);
router.post('/:id/handover', authenticate, requirePermission('install.handover'), ctrl.recordHandover);

router.post('/:id/check-in',  authenticate, requirePermission('support.manage'), ctrl.checkIn);
router.post('/:id/issues',    authenticate, requirePermission('support.manage'), ctrl.addIssue);
router.patch('/:id/issues/:issueId/resolve', authenticate, requirePermission('support.manage'), ctrl.resolveIssue);

router.post('/:id/feedback', authenticate, requirePermission('feedback.log'), ctrl.recordFeedback);
router.post('/:id/corrective-action',
  authenticate, requirePermission('feedback.corrective_action'), ctrl.recordCorrectiveAction);
router.post('/:id/close', authenticate, requirePermission('feedback.log'), ctrl.closeJob);

router.post('/:id/upload',
  authenticate, requirePermission('install.upload'), ctrl.uploadMiddleware, ctrl.uploadAttachment);

module.exports = router;
