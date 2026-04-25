'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/leadController');
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

router.get('/',   ...referrerAuth, ctrl.listLeads);   // referrers see their expo's leads
router.post('/',  ...referrerAuth, createValidation, ctrl.createLead);

router.get('/:id',    ...referrerAuth, ctrl.getLead);
router.put('/:id',    ...referrerAuth, updateValidation, ctrl.updateLead); // referrers edit own leads only
router.delete('/:id', authenticate, requireMinRole('manager'), scopeToAgent, ctrl.deleteLead);

/* POST /api/leads/:id/followups */
router.post('/:id/followups',
  ...auth,
  body('channel').isIn(['call', 'whatsapp', 'email', 'visit', 'other']),
  ctrl.addFollowUp
);

module.exports = router;
