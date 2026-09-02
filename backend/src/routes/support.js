'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/supportController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');

/*
 * Installation & Customer Support — ERP Bible V3 document 4.
 *
 * Doc 4 IC-AG-01 lists four things a CS Agent must not see, and each is refused by a
 * different mechanism on purpose:
 *
 *   other agents' tickets   attachScope (their scope is 'own')
 *   SLA comparisons         kpi.read_team, which cs_agent does not hold
 *   team statistics         the same
 *   AMC contract values     config/fieldVisibility.js, at the response chokepoint
 */

/* Static before /:id. */
router.get('/tickets/sla', authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.slaOverview);

router.get('/tickets',  authenticate, requirePermission('support.manage'), attachScope, ctrl.listTickets);
router.post('/tickets', authenticate, requirePermission('support.manage'), attachScope, ctrl.createTicket);
router.get('/tickets/:id',   authenticate, requirePermission('support.manage'), attachScope, ctrl.getTicket);
router.patch('/tickets/:id', authenticate, requirePermission('support.manage'), attachScope, ctrl.updateTicket);
router.post('/tickets/:id/activities', authenticate, requirePermission('support.manage'), attachScope, ctrl.logActivity);
/* Reassignment is the CS Manager's — an agent moving work between queues defeats the
   scoping that the rest of this file rests on. */
router.post('/tickets/:id/assign', authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.assignTicket);

/* Contracts. An agent may READ them (IC-AG-03) — the values are stripped, not the rows. */
router.get('/contracts',          authenticate, requirePermission('support.manage'), attachScope, ctrl.listContracts);
router.get('/contracts/renewals', authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.renewalsDue);
router.post('/contracts/:id/push-to-sales', authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.pushRenewal);

module.exports = router;
