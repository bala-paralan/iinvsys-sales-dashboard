'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/expoController');
const { authenticate }   = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');

const expoValidation = [
  body('name').trim().notEmpty(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('venue').trim().notEmpty(),
  body('city').trim().notEmpty(),
];

router.get('/',    authenticate, requireMinRole('readonly'), ctrl.listExpos);
router.post('/',   authenticate, requireMinRole('manager'),  expoValidation, ctrl.createExpo);

router.get('/:id',    authenticate, requireMinRole('readonly'), ctrl.getExpo);
router.put('/:id',    authenticate, requireMinRole('manager'),  expoValidation, ctrl.updateExpo);
router.put('/:id/products', authenticate, requireMinRole('manager'), ctrl.updateExpoProducts);
router.delete('/:id', authenticate, requireMinRole('manager'), ctrl.deleteExpo);

/* Referrer sub-resource */
router.get   ('/:id/referrers',      authenticate, requireMinRole('manager'), ctrl.listReferrers);
router.post  ('/:id/referrers',      authenticate, requireMinRole('manager'), ctrl.createReferrer);
router.delete('/:id/referrers/:uid', authenticate, requireMinRole('manager'), ctrl.deleteReferrer);

module.exports = router;
