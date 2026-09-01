'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/settingsController');
const { authenticate }   = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

/* R-2 pipeline rules. Declared BEFORE /:key, or `GET /settings/pipeline`
   resolves to getSetting('pipeline') and 404s. */
router.get('/pipeline', authenticate, requirePermission('settings.read'),   ctrl.getPipelineRules);
router.put('/pipeline', authenticate, requirePermission('settings.write'), ctrl.updatePipelineRules);

/* Anyone authenticated can read settings (used for pipeline stages, sources etc.) */
router.get('/',     authenticate, requirePermission('settings.read'), ctrl.listSettings);
router.get('/:key', authenticate, requirePermission('settings.read'), ctrl.getSetting);

/* `settings.write` is held by superadmin alone — see config/permissions.js. Stated as a
   permission rather than a role name so there is one answer to who may change settings. */
router.put('/', authenticate, requirePermission('settings.write'), ctrl.updateSettings);

module.exports = router;
