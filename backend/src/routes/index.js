'use strict';
const router = require('express').Router();

router.use('/meta',      require('./meta'));
router.use('/auth',      require('./auth'));
router.use('/leads',     require('./leads'));
router.use('/agents',    require('./agents'));
router.use('/products',  require('./products'));
router.use('/expos',     require('./expos'));
router.use('/analytics', require('./analytics'));
router.use('/settings',  require('./settings'));
router.use('/reports',   require('./reports'));
router.use('/notifications', require('./notifications'));
router.use('/workorders', require('./workorders'));
router.use('/installations', require('./installations'));
router.use('/kpis',       require('./kpis'));

module.exports = router;
