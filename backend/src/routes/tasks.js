'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/activityController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

router.get('/',      authenticate, requirePermission('task.read'), attachScope, ctrl.listTasks);
router.post('/',     authenticate, requirePermission('task.write'), ctrl.createTask);
router.patch('/:id', authenticate, requirePermission('task.write'), attachScope, ctrl.updateTask);

module.exports = router;
