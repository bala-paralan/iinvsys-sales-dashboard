'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/leadController');
const { authenticate }    = require('../middleware/auth');
const { requireMinRole, scopeToAgent } = require('../middleware/rbac');

const auth = [authenticate, requireMinRole('agent'), scopeToAgent];

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

router.get('/',   ...auth, ctrl.listLeads);
router.post('/',  ...auth, createValidation, ctrl.createLead);

router.get('/:id',    ...auth, ctrl.getLead);
router.put('/:id',    ...auth, updateValidation, ctrl.updateLead);
router.delete('/:id', authenticate, requireMinRole('manager'), scopeToAgent, ctrl.deleteLead);

/* POST /api/leads/:id/followups */
router.post('/:id/followups',
  ...auth,
  body('channel').isIn(['call', 'whatsapp', 'email', 'visit', 'other']),
  ctrl.addFollowUp
);

module.exports = router;
