'use strict';
const router = require('express').Router();

router.use('/meta',      require('./meta'));
router.use('/auth',      require('./auth'));
router.use('/leads',     require('./leads'));
router.use('/is',        require('./insideSales'));
/* `Agent` is retired: User is the only identity model. /api/agents stays mounted as a
   deprecated alias so the legacy root app — still the default route in vercel.json —
   keeps working through the cutover. */
router.use('/users',     require('./users'));
router.use('/agents',    require('./users'));
router.use('/products',  require('./products'));
router.use('/expos',     require('./expos'));
router.use('/analytics', require('./analytics'));
router.use('/settings',  require('./settings'));
router.use('/reports',   require('./reports'));
router.use('/notifications', require('./notifications'));
router.use('/workorders', require('./workorders'));
router.use('/installations', require('./installations'));
router.use('/kpis',       require('./kpis'));
router.use('/customers',    require('./customers'));
router.use('/activities',   require('./activities'));
router.use('/tasks',        require('./tasks'));
router.use('/approvals',    require('./approvals'));
router.use('/coaching-notes', require('./coachingNotes'));

module.exports = router;
