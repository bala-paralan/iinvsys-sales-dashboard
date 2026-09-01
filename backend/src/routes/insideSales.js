'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/insideSalesController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { attachScope } = require('../middleware/scope');
const { LEAD_SOURCE_KEYS } = require('../config/pipeline');

/*
 * Inside Sales — ERP Bible V3 document 1.
 *
 * Every route carries attachScope: doc 1's central rule is that an IS Executive sees
 * ONLY their own leads while the IS Head sees their whole team, and that is a row
 * question, not a permission one.
 */

const captureValidation = [
  body('name').trim().notEmpty(),
  body('phone').trim().notEmpty(),
  body('source').isIn(LEAD_SOURCE_KEYS),
  body('company').optional().trim(),
  body('priority').optional().isIn(['hot', 'high', 'normal']),
];

/* Static paths first — they must not be shadowed by /:id. */
router.get('/team', authenticate, requirePermission('kpi.read_team'), attachScope, ctrl.teamPerformance);

router.get('/leads',  authenticate, requirePermission('lead.read'), attachScope, ctrl.listLeads);
router.post('/leads', authenticate, requirePermission('lead.write'), attachScope, captureValidation, ctrl.createLead);

router.get('/leads/:id',      authenticate, requirePermission('lead.read'), attachScope, ctrl.getLead);
router.get('/leads/:id/gate', authenticate, requirePermission('lead.read'), attachScope, ctrl.previewLeadGate);
router.patch('/leads/:id/bant', authenticate, requirePermission('lead.write'), attachScope, ctrl.updateBant);
router.post('/leads/:id/advance', authenticate, requirePermission('lead.advance'), attachScope, ctrl.advanceLead);

/* Routing a lead between executives is the IS Head's job — doc 1 IS-HD-02. */
router.post('/leads/:id/assign', authenticate, requirePermission('user.assign_reports', 'lead.gate_override'), attachScope, ctrl.assignLead);

router.post('/leads/:id/request-handoff', authenticate, requirePermission('approval.request'), attachScope, ctrl.requestHandoff);
/* Approving is the ONLY path that mints a Sales lead — see salesEntryService. */
router.post('/handoffs/:id/decide', authenticate, requirePermission('approval.decide'), attachScope, ctrl.decideHandoff);

module.exports = router;
