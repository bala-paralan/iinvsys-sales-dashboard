'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { requirePermission, requireRole } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');
const { ALL_ROLES } = require('../config/permissions');
const { DOMAIN_KEYS } = require('../config/pipeline');

const userValidation = [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  /* Optional: omitted means the account is created and its holder sets their own
     password through an invite. See userController.createUser. */
  body('password').optional().isLength({ min: 8 }),
  body('role').optional().isIn(ALL_ROLES),
  body('domain').optional().isIn(DOMAIN_KEYS),
];

/* PUT is a partial update: each field keeps its format rule but is only checked when
   present, so `PUT {territory:'Pune'}` is not a 422. */
const userUpdateValidation = [
  body('name').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('role').optional().isIn(ALL_ROLES),
  body('domain').optional().isIn(DOMAIN_KEYS),
  body('target').optional().isNumeric(),
  body('status').optional().isIn(['active', 'inactive']),
];

router.get('/',  authenticate, requirePermission('directory.read'), ctrl.listUsers);
router.post('/', authenticate, requirePermission('user.write'), userValidation, ctrl.createUser);

router.get('/:id',         authenticate, requirePermission('directory.read'), ctrl.getUser);
router.get('/:id/reports',  authenticate, requirePermission('directory.read'), ctrl.getReports);
/* `kpi.read` — held by every internal role — not `user.read`, which only heads and above
   hold. The permission answers "may you read performance figures at all"; WHOSE is decided
   by scopeAllows() in the controller, and an executive's scope is exactly themselves.
   Gating on user.read meant an executive could not open their own My Performance screen,
   which doc 1 IS-EX and doc 2 SA-EX both list in the sidebar. */
router.get('/:id/stats',    authenticate, requirePermission('kpi.read'), attachScope, ctrl.getUserStats);
router.put('/:id',          authenticate, requirePermission('user.write'), userUpdateValidation, ctrl.updateUser);
router.patch('/:id/manager', authenticate, requirePermission('user.assign_reports'), ctrl.setManager);
router.delete('/:id',       authenticate, requirePermission('user.write'), ctrl.deactivateUser);
router.delete('/:id/hard',  authenticate, requireRole('superadmin'), ctrl.hardDeleteUser);

module.exports = router;
