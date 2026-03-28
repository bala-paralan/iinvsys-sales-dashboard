'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { authenticate }            = require('../middleware/auth');
const { requireMinRole, scopeToAgent } = require('../middleware/rbac');

router.get('/overview', authenticate, requireMinRole('agent'), scopeToAgent, ctrl.overview);
router.get('/trends',   authenticate, requireMinRole('agent'), scopeToAgent, ctrl.trends);
router.get('/expos',    authenticate, requireMinRole('manager'), ctrl.expoStats);

module.exports = router;
