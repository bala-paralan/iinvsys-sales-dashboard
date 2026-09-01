'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/expoController');
const { authenticate }   = require('../middleware/auth');
const { requirePermission, allowReferrerOr } = require('../middleware/rbac');

const expoValidation = [
  body('name').trim().notEmpty(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('venue').trim().notEmpty(),
  body('city').trim().notEmpty(),
];

/* PUT is a partial update — see the note in routes/agents.js. */
const expoUpdateValidation = [
  body('name').optional().trim().notEmpty(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('venue').optional().trim().notEmpty(),
  body('city').optional().trim().notEmpty(),
];

/* Referrers need the expo they are attached to in order to render their capture
   view. allowReferrerOr scopes the response to that single expo — they never
   see the full list. Every other reader must be an internal viewer or above. */
router.get('/',    authenticate, allowReferrerOr('expo.manage', 'catalog.read'), ctrl.listExpos);
router.post('/',   authenticate, requirePermission('expo.manage'),  expoValidation, ctrl.createExpo);

router.get('/:id',    authenticate, allowReferrerOr('expo.manage', 'catalog.read'), ctrl.getExpo);
router.put('/:id',    authenticate, requirePermission('expo.manage'),  expoUpdateValidation, ctrl.updateExpo);
router.put('/:id/products', authenticate, requirePermission('expo.manage'), ctrl.updateExpoProducts);
router.delete('/:id', authenticate, requirePermission('expo.manage'), ctrl.deleteExpo);

/* Referrer sub-resource */
router.get   ('/:id/referrers',      authenticate, requirePermission('expo.manage'), ctrl.listReferrers);
router.post  ('/:id/referrers',      authenticate, requirePermission('expo.manage'), ctrl.createReferrer);
router.post  ('/:id/referrers/:uid/reinvite', authenticate, requirePermission('expo.manage'), ctrl.reinviteReferrer);
router.delete('/:id/referrers/:uid', authenticate, requirePermission('expo.manage'), ctrl.deleteReferrer);

module.exports = router;
