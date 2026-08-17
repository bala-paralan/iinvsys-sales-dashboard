'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/settingsController');
const { authenticate }   = require('../middleware/auth');
const { requireRole, requireMinRole } = require('../middleware/rbac');

/* R-2 pipeline rules. Declared BEFORE /:key, or `GET /settings/pipeline`
   resolves to getSetting('pipeline') and 404s. */
router.get('/pipeline', authenticate, requireMinRole('manager'),   ctrl.getPipelineRules);
router.put('/pipeline', authenticate, requireRole('superadmin'),   ctrl.updatePipelineRules);

/* Anyone authenticated can read settings (used for pipeline stages, sources etc.) */
router.get('/',     authenticate, requireMinRole('readonly'), ctrl.listSettings);
router.get('/:key', authenticate, requireMinRole('readonly'), ctrl.getSetting);

/* Only superadmin can change settings */
router.put('/', authenticate, requireRole('superadmin'), ctrl.updateSettings);

module.exports = router;
