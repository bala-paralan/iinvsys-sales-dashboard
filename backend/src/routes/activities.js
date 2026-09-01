'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/activityController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');
const { ACTIVITY_TYPES } = require('../models/Activity');

const activityValidation = [
  body('customer').notEmpty().withMessage('customer is required'),
  body('type').isIn(ACTIVITY_TYPES),
  body('summary').trim().notEmpty().withMessage('summary is required'),
];

/* Every one of these needs attachScope: which rows are visible is the whole question a
   manager's activity screen asks. */
router.get('/',           authenticate, requirePermission('activity.read'), attachScope, ctrl.listActivities);
router.get('/compliance', authenticate, requirePermission('activity.read'), attachScope, ctrl.compliance);
router.post('/',          authenticate, requirePermission('activity.write'), activityValidation, ctrl.createActivity);

module.exports = router;
