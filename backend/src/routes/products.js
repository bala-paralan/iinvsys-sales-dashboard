'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/productController');
const { authenticate }   = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');

const productValidation = [
  body('name').trim().notEmpty(),
  body('sku').trim().notEmpty(),
  body('category').isIn(['hardware', 'software', 'service', 'bundle']),
  body('price').isFloat({ min: 0 }),
];

router.get('/',    authenticate, requireMinRole('readonly'), ctrl.listProducts);
router.post('/',   authenticate, requireMinRole('superadmin'), productValidation, ctrl.createProduct);

router.get('/:id',    authenticate, requireMinRole('readonly'),    ctrl.getProduct);
router.put('/:id',    authenticate, requireMinRole('superadmin'),  productValidation, ctrl.updateProduct);
router.delete('/:id', authenticate, requireMinRole('superadmin'),  ctrl.deleteProduct);

module.exports = router;
