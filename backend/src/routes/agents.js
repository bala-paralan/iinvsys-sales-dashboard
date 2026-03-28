'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/agentController');
const { authenticate }  = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');

const agentValidation = [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('phone').trim().notEmpty(),
  body('territory').trim().notEmpty(),
];

router.get('/',    authenticate, requireMinRole('readonly'), ctrl.listAgents);
router.post('/',   authenticate, requireMinRole('manager'),  agentValidation, ctrl.createAgent);

router.get('/:id',       authenticate, requireMinRole('readonly'), ctrl.getAgent);
router.get('/:id/stats', authenticate, requireMinRole('readonly'), ctrl.getAgentStats);
router.put('/:id',       authenticate, requireMinRole('manager'),  agentValidation, ctrl.updateAgent);
router.delete('/:id',    authenticate, requireMinRole('superadmin'), ctrl.deleteAgent);

module.exports = router;
