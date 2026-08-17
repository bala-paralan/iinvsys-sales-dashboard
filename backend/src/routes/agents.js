'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/agentController');
const { authenticate }  = require('../middleware/auth');
const { requireMinRole, requireRole } = require('../middleware/rbac');

const agentValidation = [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('phone').trim().notEmpty(),
  body('territory').trim().notEmpty(),
];

/* PUT is a partial update. Reusing the create validator made every field
   mandatory, so `PUT {territory:'Pune'}` answered 422 and no partial update was
   possible through the API at all. Each field keeps its format rule but is only
   checked when present — the same shape routes/leads.js already uses. */
const agentUpdateValidation = [
  body('name').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().trim().notEmpty(),
  body('territory').optional().trim().notEmpty(),
];

router.get('/',    authenticate, requireMinRole('readonly'), ctrl.listAgents);
router.post('/',   authenticate, requireMinRole('manager'),  agentValidation, ctrl.createAgent);

router.get('/:id',       authenticate, requireMinRole('readonly'), ctrl.getAgent);
router.get('/:id/stats', authenticate, requireMinRole('readonly'), ctrl.getAgentStats);
router.put('/:id',       authenticate, requireMinRole('manager'),  agentUpdateValidation, ctrl.updateAgent);
router.delete('/:id',      authenticate, requireMinRole('superadmin'), ctrl.deleteAgent);
router.delete('/:id/hard', authenticate, requireRole('superadmin'),    ctrl.hardDeleteAgent);

module.exports = router;
