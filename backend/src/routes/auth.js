'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const {
  login, getMe, register, changePassword, checkInvite, redeemInvite,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');
const { REGISTERABLE_ROLES } = require('../config/permissions');

/* POST /api/auth/login */
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  login
);

/* Invite redemption — UNAUTHENTICATED by necessity: the holder has no
   credential yet, which is the entire point. The token IS the credential, so
   it is single-use, expiring, and stored only as a hash. */
router.get('/invite/:token',  checkInvite);
router.post('/invite/:token', redeemInvite);

/* GET /api/auth/me */
router.get('/me', authenticate, getMe);

/* POST /api/auth/register — superadmin only */
router.post('/register',
  authenticate,
  requireRole('superadmin'),
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  /* Every role except `referrer`, which is only creatable through
     POST /api/expos/:id/referrers where the scoped credentials are generated. */
  body('role').isIn(REGISTERABLE_ROLES),
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
