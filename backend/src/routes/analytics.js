'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { authenticate }            = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

router.get('/overview', authenticate, requirePermission('kpi.read'), attachScope, ctrl.overview);
router.get('/trends',   authenticate, requirePermission('kpi.read'), attachScope, ctrl.trends);
router.get('/expos',    authenticate, requirePermission('kpi.read_company'), ctrl.expoStats);

module.exports = router;
