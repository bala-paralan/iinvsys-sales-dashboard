'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/approvalController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

/* Private manager assessments — doc 1 IS-DIR-02, doc 2 SA-MGR-03. `coaching.read` is
   the gate; who may read WHICH note is decided per note by canReadCoaching(), because
   the rule ("the author and their ancestors, never the subject") is not expressible as
   a permission. */
router.get('/',  authenticate, requirePermission('coaching.read'), attachScope, ctrl.listCoachingNotes);
router.post('/', authenticate, requirePermission('coaching.write'), attachScope, ctrl.createCoachingNote);

module.exports = router;
