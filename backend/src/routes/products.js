'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/productController');
const { authenticate }   = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

const productValidation = [
  body('name').trim().notEmpty(),
  body('sku').trim().notEmpty(),
  body('category').isIn(['hardware', 'software', 'service', 'bundle']),
  body('price').isFloat({ min: 0 }),
];

/* PUT is a partial update — see the note in routes/agents.js. */
const productUpdateValidation = [
  body('name').optional().trim().notEmpty(),
  body('sku').optional().trim().notEmpty(),
  body('category').optional().isIn(['hardware', 'software', 'service', 'bundle']),
  body('price').optional().isFloat({ min: 0 }),
];

router.get('/',    authenticate, requirePermission('catalog.read'), ctrl.listProducts);
router.post('/',   authenticate, requirePermission('catalog.write'), productValidation, ctrl.createProduct);

router.get('/:id',    authenticate, requirePermission('catalog.read'),    ctrl.getProduct);
router.put('/:id',    authenticate, requirePermission('catalog.write'),  productUpdateValidation, ctrl.updateProduct);
router.delete('/:id', authenticate, requirePermission('catalog.write'),  ctrl.deleteProduct);

module.exports = router;
