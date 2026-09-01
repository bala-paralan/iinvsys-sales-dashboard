'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const ctrl = require('../controllers/metaController');

/* Every authenticated role needs stage labels to render anything at all. */
router.get('/pipeline', authenticate, ctrl.getPipeline);

/* The caller's own permissions, scope and portal. Authenticate-only for the same reason
   as /pipeline: a permission test on "what may I do?" is circular. Allowlisted in
   assertRoutesGuarded(). */
router.get('/me', authenticate, ctrl.getMe);

router.get('/permissions', authenticate, requirePermission('user.read'), ctrl.getPermissions);

module.exports = router;
