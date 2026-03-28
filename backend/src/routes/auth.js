'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { login, getMe, register, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');

/* POST /api/auth/login */
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  login
);

/* GET /api/auth/me */
router.get('/me', authenticate, getMe);

/* POST /api/auth/register — superadmin only */
router.post('/register',
  authenticate,
  requireRole('superadmin'),
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('role').isIn(['superadmin', 'manager', 'agent', 'readonly']),
  register
);

/* PATCH /api/auth/password */
router.patch('/password',
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
  changePassword
);

module.exports = router;
