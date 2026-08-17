'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');
const ctrl = require('../controllers/metaController');

/* Every authenticated role needs stage labels to render anything at all. */
router.get('/pipeline', authenticate, ctrl.getPipeline);

router.get('/permissions', authenticate, requireMinRole('manager'), ctrl.getPermissions);

module.exports = router;
