'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/customerController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

const customerValidation = [
  body('name').trim().notEmpty(),
  body('city').optional().trim(),
];

router.post('/check-duplicate', authenticate, requirePermission('customer.read'), ctrl.checkDuplicate);

router.get('/',  authenticate, requirePermission('customer.read'), ctrl.listCustomers);
router.post('/', authenticate, requirePermission('customer.write'), customerValidation, ctrl.createCustomer);

router.get('/:id',     authenticate, requirePermission('customer.read'), ctrl.getCustomer);
/* Customer 360 — doc 1 IS-DIR-04, doc 2 SA-DIR-06. Not scoped by owner: the whole point
   is the complete relationship across every rep and every module. Financial figures in
   the payload are still redacted per role by utils/redact.js. */
router.get('/:id/360',  authenticate, requirePermission('customer.read'), ctrl.get360);
router.put('/:id',      authenticate, requirePermission('customer.write'), ctrl.updateCustomer);
router.post('/:id/contacts', authenticate, requirePermission('customer.write'), ctrl.addContact);
router.post('/:id/merge',    authenticate, requirePermission('customer.merge'), attachScope, ctrl.mergeCustomer);

module.exports = router;
