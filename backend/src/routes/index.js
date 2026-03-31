'use strict';
const router = require('express').Router();

router.use('/auth',      require('./auth'));
router.use('/leads',     require('./leads'));
router.use('/agents',    require('./agents'));
router.use('/products',  require('./products'));
router.use('/expos',     require('./expos'));
router.use('/analytics', require('./analytics'));
router.use('/settings',  require('./settings'));

module.exports = router;
