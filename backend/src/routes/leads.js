'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl     = require('../controllers/leadController');
const vmCtrl   = require('../controllers/voiceMemoController');
const { authenticate }    = require('../middleware/auth');
const { requireMinRole, scopeToAgent, allowReferrer } = require('../middleware/rbac');
const Lead     = require('../models/Lead');

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
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('natureOfBusiness').optional().isIn(Lead.NATURE_OF_BUSINESS),
  body('interestedIn').optional().isIn(Lead.INTERESTED_IN),
];

/* PUT validators are all optional — RBAC runs inside the controller */
const updateValidation = [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim().notEmpty(),
  body('source').optional().isIn(['expo', 'referral', 'direct', 'digital']),
  body('assignedAgent').optional().isMongoId(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('natureOfBusiness').optional().isIn(Lead.NATURE_OF_BUSINESS),
  body('interestedIn').optional().isIn(Lead.INTERESTED_IN),
];

/* POST /api/leads/bulk — manager+ unrestricted; referrers capped to 100 rows + force-tagged to their expo (controller enforces) */
router.post('/bulk', ...referrerAuth, ctrl.bulkImport);

/* PRD 3–5 static routes — must be declared before /:id patterns */
router.post('/check-duplicate', ...referrerAuth, ctrl.checkDuplicate);
router.post('/telemetry',       authenticate,    ctrl.logTelemetry);
router.post('/bulk-scan',       ...referrerAuth, ctrl.bulkScan);
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

/* PRD 6 — Voice Memos. Referrers can memo leads they created in their expo (controller enforces). */
router.post('/:id/voice-memos/extract', ...referrerAuth, vmCtrl.extractPreview);
router.get( '/:id/voice-memos',         ...referrerAuth, vmCtrl.listVoiceMemos);
router.post('/:id/voice-memos',         ...referrerAuth, vmCtrl.createVoiceMemo);
router.patch('/:id/voice-memos/:memoId',...auth,         vmCtrl.updateVoiceMemo);

module.exports = router;
