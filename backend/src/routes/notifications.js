'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

/* `notification.read` is held by every role except referrer and readonly —
   an operational role that cannot see its own alerts cannot do its job.
   Every handler scopes to req.user._id, so the permission grants access to
   your OWN notifications only. */
const auth = [authenticate, requirePermission('notification.read')];

/* Static routes before any /:id pattern. */
router.get('/unread-count', ...auth, ctrl.getUnreadCount);
router.patch('/read-all',   ...auth, ctrl.markAllRead);

router.get('/',             ...auth, ctrl.listNotifications);
router.patch('/:id/read',   ...auth, ctrl.markRead);

module.exports = router;
