'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl     = require('../controllers/leadController');
const vmCtrl   = require('../controllers/voiceMemoController');
const { authenticate }    = require('../middleware/auth');
const { requireMinRole, scopeToAgent, allowReferrer } = require('../middleware/rbac');

const auth = [authenticate, requireMinRole('agent'), scopeToAgent];

/* Referrer-aware auth: referrers get allowReferrer (expo-scoped), others get normal agent auth */
const referrerAuth = [authenticate, (req, res, next) => {
  if (req.user.role === 'referrer') return allowReferrer(req, res, next);
  requireMinRole('agent')(req, res, () => scopeToAgent(req, res, next));
}];

const createValidation = [
  body('name').trim().notEmpty(),
  body('phone').trim().notEmpty(),
  body('source').isIn(['expo', 'referral', 'direct', 'digital']),
  body('assignedAgent').isMongoId().optional(),
];

/* PUT validators are all optional — RBAC runs inside the controller */
const updateValidation = [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim().notEmpty(),
  body('source').optional().isIn(['expo', 'referral', 'direct', 'digital']),
  body('assignedAgent').optional().isMongoId(),
];

/* POST /api/leads/bulk — manager+ */
router.post('/bulk',
  authenticate, requireMinRole('manager'),
  ctrl.bulkImport
);

/* PRD 3–5 static routes — must be declared before /:id patterns */
router.post('/check-duplicate', ...referrerAuth, ctrl.checkDuplicate);
router.post('/telemetry',       authenticate,    ctrl.logTelemetry);
router.post('/bulk-scan',       ...auth,          ctrl.bulkScan);
router.get('/batch/:batchId',   ...referrerAuth,  ctrl.getBatch);

router.get('/',   ...referrerAuth, ctrl.listLeads);   // referrers see their expo's leads
router.post('/',  ...referrerAuth, createValidation, ctrl.createLead);

router.get('/:id',    ...referrerAuth, ctrl.getLead);
router.put('/:id',    ...referrerAuth, updateValidation, ctrl.updateLead); // referrers edit own leads only
router.delete('/:id', authenticate, requireMinRole('manager'), scopeToAgent, ctrl.deleteLead);

/* PRD 4 — merge */
router.post('/:id/merge',          ...auth,         ctrl.mergeLead);
/* PRD 5 — enrichment */
router.post('/:id/enrich',         ...referrerAuth, ctrl.triggerEnrich);
router.delete('/:id/enrich/:field',...auth,         ctrl.rollbackEnrichField);

/* POST /api/leads/:id/followups */
router.post('/:id/followups',
  ...auth,
  body('channel').isIn(['call', 'whatsapp', 'email', 'visit', 'other']),
  ctrl.addFollowUp
);

/* PRD 6 — Voice Memos */
router.post('/:id/voice-memos/extract', ...auth, vmCtrl.extractPreview);
router.get( '/:id/voice-memos',         ...auth, vmCtrl.listVoiceMemos);
router.post('/:id/voice-memos',         ...auth, vmCtrl.createVoiceMemo);
router.patch('/:id/voice-memos/:memoId',...auth, vmCtrl.updateVoiceMemo);

module.exports = router;
