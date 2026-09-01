'use strict';

/**
 * pipeline.js — the single declarative definition of every workflow in IINVSYS.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  This module mirrors docs/requirements/03-stage-gates.md one-for-one.     │
 * │  Change one, change the other IN THE SAME COMMIT.                        │
 * │  Enum values are documented in docs/requirements/01-crm-data-dictionary.  │
 * │  Assumptions (A1..A25) are recorded in                                    │
 * │  docs/requirements/07-open-questions-and-assumptions.md                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * HARD CONSTRAINT: this file must contain pure data and pure functions only.
 * It must never `require` mongoose or any model. That is what allows models,
 * controllers, validators, the scheduler, the Excel builder and the /api/meta
 * route to all consume it without a require cycle.
 */

/* ══════════════════════════════════════════════════════════════════════════
   ENUMS — stored key ⇄ display label
   ══════════════════════════════════════════════════════════════════════════ */

const LEAD_SOURCES = [
  { key: 'cold_call',             label: 'Cold Call' },
  { key: 'referral',              label: 'Referral' },
  { key: 'digital_website',       label: 'Digital / Website' },
  { key: 'exhibition_event',      label: 'Exhibition / Event' },
  { key: 'channel_partner',       label: 'Channel Partner' },
  { key: 'builder_referral',      label: 'Builder Referral' },
  { key: 'inside_sales_outbound', label: 'Inside Sales Outbound' },
  { key: 'inbound_enquiry',       label: 'Inbound Enquiry' },
  { key: 'social_media',          label: 'Social Media' },
];

const COMPANY_TYPES = [
  { key: 'homeowner',         label: 'Homeowner' },
  { key: 'msme_factory',      label: 'MSME Factory' },
  { key: 'large_factory',     label: 'Large Factory' },
  { key: 'builder_developer', label: 'Builder / Developer' },
  { key: 'system_integrator', label: 'System Integrator' },
  { key: 'epc',               label: 'EPC' },
  { key: 'government_psu',    label: 'Government / PSU' },
  { key: 'distributor',       label: 'Distributor' },
  { key: 'other',             label: 'Other' },
];

/* Assumption A4 — "industrial" is undefined in the source document. */
const AMC_REQUIRED_COMPANY_TYPES = [
  'msme_factory', 'large_factory', 'system_integrator', 'epc', 'government_psu',
];

/* Assumption A6 — B2B is undefined in the source document. */
const NON_B2B_COMPANY_TYPES = ['homeowner'];

const INDUSTRY_SEGMENTS = [
  { key: 'auto',             label: 'Auto',            priority: true },
  { key: 'pharma',           label: 'Pharma',          priority: true },
  { key: 'fmcg',             label: 'FMCG',            priority: true },
  { key: 'textile',          label: 'Textile' },
  { key: 'chemical',         label: 'Chemical' },
  { key: 'steel_metal',      label: 'Steel / Metal',   priority: true },
  { key: 'electronics',      label: 'Electronics' },
  { key: 'food_processing',  label: 'Food Processing' },
  { key: 'cement',           label: 'Cement' },
  { key: 'ports',            label: 'Ports' },
  { key: 'railways',         label: 'Railways' },
  { key: 'it_manufacturing', label: 'IT Manufacturing' },
  { key: 'other',            label: 'Other' },
];

/*
 * Business domains — the axis the V3 org chart is organised along: one Sales Manager
 * per domain, each with two Executives. Deliberately SEPARATE from INDUSTRY_SEGMENTS,
 * which classifies the customer's industry for hygiene and reporting. A customer can be
 * `electronics` by segment and belong to the `defence` sales domain; collapsing the two
 * would force one to lie. `domain` is a routing and labelling attribute — never a
 * security boundary (see ROLE_SCOPE in config/permissions.js).
 */
const DOMAINS = [
  { key: 'railways',        label: 'Railways' },
  { key: 'defence',         label: 'Defence' },
  { key: 'space_satellite', label: 'Space / Satellite' },
  { key: 'iot_iiot',        label: 'IoT / IIoT' },
  { key: 'automotive',      label: 'Automotive' },
  { key: 'ai_ml',           label: 'AI / ML' },
  { key: 'none',            label: '\u2014' },
];

const ZONES = [
  { key: 'north', label: 'North' },
  { key: 'south', label: 'South' },
  { key: 'east',  label: 'East' },
  { key: 'west',  label: 'West' },
];

const COMPETITORS = [
  { key: 'cisco',      label: 'Cisco' },
  { key: 'moxa',       label: 'Moxa' },
  { key: 'advantech',  label: 'Advantech' },
  { key: 'legrand',    label: 'Legrand' },
  { key: 'havells',    label: 'Havells' },
  { key: 'honeywell',  label: 'Honeywell' },
  { key: 'siemens',    label: 'Siemens' },
  { key: 'abb',        label: 'ABB' },
  { key: 'other',      label: 'Other (specify)' },
  { key: 'none_known', label: 'None Known' },
];

const LOST_REASONS = [
  { key: 'price_too_high',           label: 'Price too high' },
  { key: 'chose_competitor',         label: 'Chose competitor' },
  { key: 'no_budget_this_year',      label: 'No budget this year' },
  { key: 'technical_mismatch',       label: 'Technical mismatch' },
  { key: 'project_cancelled',        label: 'Project cancelled' },
  { key: 'no_decision_maker_access', label: 'No decision-maker access' },
  { key: 'timeline_mismatch',        label: 'Timeline mismatch' },
  { key: 'internal_delays',          label: 'Internal delays (our side)' },
  { key: 'other',                    label: 'Other (specify)' },
];

const LOST_TO = [
  { key: 'competitor',  label: 'Competitor' },
  { key: 'no_purchase', label: 'No purchase (status quo)' },
  { key: 'unknown',     label: 'Unknown' },
];

const SUBSCRIPTION_STATES = [
  { key: 'yes',            label: 'Yes' },
  { key: 'no',             label: 'No' },
  { key: 'already_on_sub', label: 'Already on Subscription' },
];

const AMC_STATES = [
  { key: 'yes',            label: 'Yes' },
  { key: 'no',             label: 'No' },
  { key: 'already_on_amc', label: 'Already on AMC' },
];

const DISQUALIFY_REASONS = [
  { key: 'no_budget',         label: 'No budget' },
  { key: 'no_authority',      label: 'No decision authority' },
  { key: 'no_need',           label: 'No genuine need' },
  { key: 'wrong_segment',     label: 'Outside target segment' },
  { key: 'competitor_locked', label: 'Locked to a competitor' },
  { key: 'unreachable',       label: 'Unreachable' },
  { key: 'other',             label: 'Other' },
];

const NEED_TYPES = [
  { key: 'replacement', label: 'Replacement' },
  { key: 'expansion',   label: 'Expansion' },
  { key: 'new_build',   label: 'New Build' },
  { key: 'compliance',  label: 'Compliance' },
  { key: 'upgrade',     label: 'Upgrade' },
];

const DOC_TYPES = [
  { key: 'po',                       label: 'Purchase Order',          entity: 'lead' },
  { key: 'quote',                    label: 'Quotation',               entity: 'lead' },
  { key: 'proposal',                 label: 'Proposal',                entity: 'lead' },
  { key: 'packing_list',             label: 'Packing List',            entity: 'workorder' },
  { key: 'delivery_note',            label: 'Delivery Note',           entity: 'workorder' },
  { key: 'invoice',                  label: 'Tax Invoice',             entity: 'workorder' },
  { key: 'delivery_acknowledgement', label: 'Delivery Acknowledgement', entity: 'workorder' },
  { key: 'da_photo',                 label: 'Delivery Photo Evidence', entity: 'workorder' },
  /* Doc 3 PD-ENG-02: a photo as proof at each WIP step, and the QC evidence the Head
     reviews at PD-HD-07. Distinct doc types so the Head's QC screen can show the QC
     photos without every enclosure shot from step 4. */
  { key: 'wip_photo',                label: 'WIP Step Photo',          entity: 'workorder' },
  { key: 'qc_evidence',              label: 'QC Evidence',             entity: 'workorder' },
  { key: 'installation_checklist',   label: 'Installation Checklist',  entity: 'installation' },
  { key: 'commissioning_report',     label: 'Commissioning Test Report', entity: 'installation' },
  { key: 'handover_certificate',     label: 'Handover Certificate',    entity: 'installation' },
  { key: 'feedback_form',            label: 'Customer Feedback Form',  entity: 'installation' },
  { key: 'other',                    label: 'Other',                   entity: 'any' },
];

const DELAY_REASON_CODES = [
  { key: 'stock_unavailable',       label: 'Stock unavailable' },
  { key: 'supplier_delay',          label: 'Supplier delay' },
  { key: 'logistics_delay',         label: 'Logistics delay' },
  { key: 'customer_site_not_ready', label: 'Customer site not ready' },
  { key: 'customer_requested',      label: 'Customer requested' },
  { key: 'quality_hold',            label: 'Quality hold' },
  { key: 'payment_pending',         label: 'Payment pending' },
  { key: 'transport_damage',        label: 'Transport damage' },
  { key: 'force_majeure',           label: 'Force majeure' },
  { key: 'internal_scheduling',     label: 'Internal scheduling' },
  { key: 'other',                   label: 'Other' },
];

const SNAG_SEVERITIES = ['minor', 'major', 'blocker'];
const BLOCKING_SNAG_SEVERITIES = ['major', 'blocker'];

/* ══════════════════════════════════════════════════════════════════════════
   SPENCO — assumptions A18 (threshold) and A19 (need type)
   ══════════════════════════════════════════════════════════════════════════ */

const SPENCO_DIMENSIONS = [
  { key: 'size',                 label: 'Size',                  hint: 'Deal size relative to our average' },
  { key: 'potential',            label: 'Potential',             hint: 'Follow-on / expansion potential' },
  { key: 'evidenceOfNeed',       label: 'Evidence of Need',      hint: 'Concrete evidence the need is real' },
  { key: 'needType',             label: 'Need Type',             hint: 'How well the need type fits our offering' },
  { key: 'competitionAwareness', label: 'Competition Awareness', hint: 'Do we know who else is bidding' },
  { key: 'originOfNeed',         label: 'Origin of Need',        hint: 'Internal, regulatory, or created by us' },
];

const SPENCO_MAX_PER_DIMENSION = 5;
const SPENCO_MAX_TOTAL = SPENCO_DIMENSIONS.length * SPENCO_MAX_PER_DIMENSION; // 30

/* A18 — NOT stated in the source document. Confirm with the Sales Director. */
const SPENCO_MIN_TOTAL = 18;
const SPENCO_SUB_GATES = { evidenceOfNeed: 3, size: 2 };

/* ══════════════════════════════════════════════════════════════════════════
   DISCOUNT AUTHORITY  (ERP Bible V3, document 2)
   ══════════════════════════════════════════════════════════════════════════ */

/*
 * Doc 2, stated twice — on the org chart and in the module footer:
 *
 *     0–3%   Self-approve (Exec)
 *     3–10%  Sales Manager approves
 *     >10%   Director + COO approves
 *
 * Held as data, and as BANDS rather than three hard-coded comparisons, because a
 * discount ladder is exactly the kind of rule a Sales Director changes without wanting a
 * deploy — see config/pipelineRuntime.js, which resolves it from Settings.
 *
 * `maxPercent: null` means "no upper bound". Bands are half-open on the lower edge
 * (`percent > from`), so 3% is self-approval and 3.01% is the Manager's: doc 2 writes
 * "0–3%" and "3–10%" against each other, and the boundary has to land somewhere stated
 * rather than wherever a `<=` happened to fall.
 */
const DISCOUNT_TIERS = [
  {
    tier: 1, from: 0, to: 3,
    label: 'Self-approved',
    approverRole: null,          // the executive themselves
    permission: null,
  },
  {
    tier: 2, from: 3, to: 10,
    label: 'Sales Manager',
    approverRole: 'sales_manager',
    permission: 'approval.decide',
  },
  {
    tier: 3, from: 10, to: null,
    label: 'Sales Director',
    approverRole: 'sales_director',
    permission: 'approval.decide',
    /* Doc 2 names a COO as co-approver above 10%. No such role has a screen anywhere in
       the specification, so it is not a role — `Approval.coApprovedBy` is reserved so
       that adding a second signature later is a write, not a migration. */
    coApprovalReserved: true,
  },
];

/** Which band a discount percentage falls in. Returns null for a nonsensical input. */
function discountTierFor(percent, rules) {
  const tiers = R(rules).discountTiers || DISCOUNT_TIERS;
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0) return null;
  return tiers.find((t) => p > t.from && (t.to === null || p <= t.to))
    /* 0% is not a discount request at all, but it is not an error either — it belongs to
       the self-approval band rather than falling off the bottom of the table. */
    || (p === 0 ? tiers[0] : null);
}

/** True when the executive may simply apply this discount themselves. */
function discountSelfApproved(percent, rules) {
  const t = discountTierFor(percent, rules);
  return !!t && t.approverRole === null;
}

/* ══════════════════════════════════════════════════════════════════════════
   PROCESS 0 — INSIDE SALES  (ERP Bible V3, document 1)
   ══════════════════════════════════════════════════════════════════════════ */

/*
 * BANT — the qualification framework doc 1 runs before a lead may reach Sales.
 * IS-EX-05 shows all four as independent ticks with a note each; IS-HD-04 shows the
 * IS Head reading those four lines before approving a handoff.
 */
const BANT_DIMENSIONS = [
  { key: 'budget',    label: 'Budget',    hint: 'Is there money, and roughly how much' },
  { key: 'authority', label: 'Authority', hint: 'Is this person the decision point, or who is' },
  { key: 'need',      label: 'Need',      hint: 'What problem are they actually solving' },
  { key: 'timeline',  label: 'Timeline',  hint: 'When do they intend to buy' },
];
const BANT_KEYS = BANT_DIMENSIONS.map((d) => d.key);

/*
 * Inside Sales stages.
 *
 * A SEPARATE TABLE, not extra SPENCO stages. An IS record is not an early deal — doc 1
 * numbers them IS-2026-XXXX, doc 2 numbers deals SA-2026-XXX, and IS-DIR-03's "Bypass IS"
 * creates both at once. A qualified IS lead never becomes a deal in place; it mints a
 * linked track:'sales' record, so Customer 360 shows the nurture and the deal as the two
 * distinct things they are.
 *
 * services/stageService.js is generic over a stage list, so this table drives the same
 * gate engine, the same stageHistory and the same advance endpoint as the other three.
 */
const IS_STAGES = [
  {
    key: 'is_new', order: 1, shortCode: 'N1', label: 'New', color: 'var(--gold)',
    borderClass: 'gold-border', probability: 0, maxDays: 2, terminal: false,
    ownerRole: 'is_executive',
    definition: 'Assigned, not yet contacted.',
    advancesOn: 'First contact attempt logged.',
    entryRequires: [],
  },
  {
    key: 'is_contacted', order: 2, shortCode: 'N2', label: 'Contacted', color: 'var(--azure)',
    borderClass: 'blue-border', probability: 0, maxDays: 14, terminal: false,
    ownerRole: 'is_executive',
    definition: 'Conversation started. BANT in progress.',
    advancesOn: 'All four BANT dimensions confirmed.',
    entryRequires: [
      /* Doc 1 IS-DIR-01 flags a lead with zero activities as an instant red flag, so
         reaching Contacted requires that an interaction actually exists. */
      { field: 'lastActivityAt', test: 'anyDate', message: 'Log the first call, email or visit before marking this Contacted' },
      { field: 'customer',       test: 'notEmpty', message: 'Link this lead to a customer account — the activity log hangs off it' },
    ],
  },
  {
    key: 'is_qualified', order: 3, shortCode: 'N3', label: 'Qualified', color: 'var(--emerald)',
    borderClass: 'green-border', probability: 0, maxDays: 7, terminal: false,
    ownerRole: 'is_executive',
    definition: 'BANT complete. Ready to request handoff to Sales.',
    advancesOn: 'IS Executive requests handoff.',
    entryRequires: [
      { field: 'bant.budget.confirmed',    test: 'isTrue', message: 'Budget not confirmed — record the amount or range' },
      { field: 'bant.authority.confirmed', test: 'isTrue', message: 'Authority not confirmed — name the decision maker' },
      { field: 'bant.need.confirmed',      test: 'isTrue', message: 'Need not confirmed — state the problem in their words' },
      { field: 'bant.timeline.confirmed',  test: 'isTrue', message: 'Timeline not confirmed — record when they intend to buy' },
    ],
  },
  {
    key: 'is_handoff_requested', order: 4, shortCode: 'N4', label: 'Handoff Requested',
    color: 'var(--violet)', borderClass: 'violet-border', probability: 0, maxDays: 3,
    terminal: false, ownerRole: 'is_head',
    definition: 'Waiting on the IS Head. Doc 1 IS-HD-04.',
    advancesOn: 'IS Head approves — a Sales lead is minted and this record closes.',
    entryRequires: [
      { field: 'handoffApproval', test: 'notEmpty', message: 'Raise the handoff request from the lead — do not move the stage by hand' },
    ],
  },
  {
    key: 'is_converted', order: 5, shortCode: 'N5', label: 'Converted to Sales',
    color: 'var(--emerald)', borderClass: 'green-border', probability: 100,
    terminal: true, ownerRole: 'is_head',
    definition: 'Approved. A track:sales lead exists and carries the opportunity.',
    advancesOn: '—',
    entryRequires: [
      { field: 'convertedTo', test: 'notEmpty', message: 'Conversion is performed by approving the handoff, never by hand' },
    ],
  },
  {
    key: 'is_lost', order: 6, shortCode: '—', label: 'Disqualified', color: 'var(--coral)',
    borderClass: 'coral-border', probability: 0, terminal: true, reachableFromAny: true,
    reopenable: true, ownerRole: 'is_executive',
    definition: 'Not a fit, unreachable, or no budget.',
    advancesOn: '—',
    entryRequires: [
      { field: 'lostReason', test: 'notEmpty', message: 'Record why this lead was disqualified' },
    ],
  },
];

const IS_STAGE_KEYS = IS_STAGES.map((s) => s.key);
const IS_TERMINAL_STAGES = IS_STAGES.filter((s) => s.terminal).map((s) => s.key);
const IS_OPEN_STAGES = IS_STAGES.filter((s) => !s.terminal).map((s) => s.key);
const IS_QUALIFIED_STAGE = 'is_qualified';
const IS_HANDOFF_STAGE = 'is_handoff_requested';
const IS_CONVERTED_STAGE = 'is_converted';

/* Doc 1 IS-DIR-03 — where a Director-originated lead goes. */
const IS_ASSIGNMENT_MODES = [
  { key: 'is_executive', label: 'Assign to IS Executive' },
  { key: 'bypass_is',    label: 'Bypass IS → Assign to Sales Executive' },
  { key: 'director_managed', label: 'Director Managed — Hold for now' },
];

const LEAD_PRIORITIES = [
  { key: 'hot',    label: 'Hot — contact within 4 hours',  hours: 4 },
  { key: 'high',   label: 'High — contact within 24 hours', hours: 24 },
  { key: 'normal', label: 'Normal — route to queue',        hours: null },
];

/* ══════════════════════════════════════════════════════════════════════════
   PROCESS 1 — SALES
   ══════════════════════════════════════════════════════════════════════════ */

const SALES_STAGES = [
  {
    key: 'suspect', order: 1, shortCode: 'S1', label: 'Suspect', color: 'var(--gold)',
    borderClass: 'gold-border', probability: 5, maxDays: 14, terminal: false,
    ownerRole: 'sales_executive',
    definition: 'Contact identified. No conversation yet.',
    advancesOn: 'First call or email made.',
    entryRequires: [],
  },
  {
    key: 'prospect', order: 2, shortCode: 'S2', label: 'Prospect', color: 'var(--azure)',
    borderClass: 'blue-border', probability: 15, maxDays: 21, terminal: false,
    ownerRole: 'sales_executive',
    definition: 'Conversation had. Need confirmed. Budget exists or will exist.',
    advancesOn: 'Discovery call completed. Pain confirmed.',
    entryRequires: [
      { field: 'jobTitle',         test: 'notEmpty',       message: 'Designation is required — the exact job title, not "manager"' },
      { field: 'company',          test: 'notEmpty',       message: 'Company name is required — use the legal name' },
      { field: 'companyType',      test: 'notEmpty',       message: 'Company Type drives segmentation and the AMC rule' },
      { field: 'city',             test: 'notEmpty',       message: 'City is required' },
      { field: 'state',            test: 'notEmpty',       message: 'State is required — Zone is derived from it' },
      { field: 'industrySegment',  test: 'requiredIfB2B',  message: 'Industry is required for B2B contacts' },
      { field: 'email',            test: 'requiredIfB2B',  message: 'Email is required for B2B contacts' },
      { field: 'nextAction',       test: 'notEmpty',       message: 'Record the specific next action and who owns it' },
      { field: 'nextFollowUpDate', test: 'futureDate',     message: 'Every open deal needs a future follow-up date' },
    ],
  },
  {
    key: 'engagement', order: 3, shortCode: 'S3', label: 'Engagement', color: 'var(--violet)',
    borderClass: 'violet-border', probability: 45, maxDays: 21, terminal: false,
    ownerRole: 'sales_executive',
    definition: 'Product shown or site visited. Formal quote/proposal sent.',
    advancesOn: 'Demo completed. Customer engaged. Proposal sent with a date.',
    entryRequires: [
      { field: 'spenco.scoredAt',  test: 'anyDate',                       message: 'SPENCO scoring must be completed at the Prospect stage' },
      /* `configKey` marks a row the resolver rewrites or relocates from the
         active rule set. See resolveStages(). */
      { field: 'spenco.qualified', test: 'isTrue', configKey: 'spenco',   message: `SPENCO total must meet the qualification threshold (>= ${SPENCO_MIN_TOTAL}/${SPENCO_MAX_TOTAL}, evidence >= ${SPENCO_SUB_GATES.evidenceOfNeed}, size >= ${SPENCO_SUB_GATES.size})` },
      { field: 'competitor',       test: 'notEmpty',                      configKey: 'competitor', message: 'Competitor is required from Engagement onward — use "None Known" if applicable' },
      { field: 'competitorOther',  test: 'requiredIf:competitor=other',   configKey: 'competitor', message: 'Name the competitor' },
      { field: 'value',            test: 'positiveNumber',                message: 'Deal Value is required' },
      { field: 'productPackage',   test: 'notEmpty',                      message: 'Select the product or package' },
      { field: 'expectedCloseDate',test: 'futureDate',                    message: 'Expected Close Date is required and must not be in the past' },
      { field: 'nextFollowUpDate', test: 'futureDate',                    message: 'Every open deal needs a future follow-up date' },
    ],
  },
  {
    key: 'negotiation', order: 4, shortCode: 'S4', label: 'Negotiation', color: 'var(--amber)',
    borderClass: 'amber-border', probability: 70, maxDays: 21, terminal: false,
    ownerRole: 'sales_manager',
    definition: 'Active price/term discussion.',
    advancesOn: 'Any pricing conversation started.',
    entryRequires: [
      { field: 'attachments',       test: 'hasAnyDoc:proposal|quote', message: 'A proposal or quotation document must be on file' },
      { field: 'expectedCloseDate', test: 'futureDate',               message: 'Expected Close Date must be current — update it when it changes' },
      { field: 'nextFollowUpDate',  test: 'futureDate',               message: 'Every open deal needs a future follow-up date' },
      { field: 'nextAction',        test: 'notEmpty',                 message: 'Record the specific next action' },
    ],
  },
  {
    key: 'commercial_order', order: 5, shortCode: 'S5', label: 'Commercial Order', color: 'var(--emerald)',
    borderClass: 'green-border', probability: 100, maxDays: null, terminal: true, won: true,
    ownerRole: 'sales_manager',
    definition: 'PO received and verified. Work Order created.',
    advancesOn: 'PO number logged. Subscription form signed.',
    entryRequires: [
      { field: 'attachments',         test: 'hasDoc:po',                           message: 'The customer Purchase Order document must be uploaded' },
      { field: 'poNumber',            test: 'notEmpty',                            message: 'Log the PO number' },
      { field: 'value',               test: 'positiveNumber',                      message: 'Deal Value must match the verified PO' },
      { field: 'subscriptionOffered', test: 'oneOf:yes|already_on_sub',            message: 'Subscription must be offered or already active at Closed Won' },
      { field: 'amcOffered',          test: 'oneOfIfIndustrial:yes|already_on_amc',message: 'AMC is mandatory at Closed Won for industrial company types' },
      { field: 'expectedCloseDate',   test: 'anyDate',                             message: 'Expected Close Date is required' },
    ],
  },
  {
    key: 'order_lost', order: 6, shortCode: '—', label: 'Order Lost', color: 'var(--coral)',
    borderClass: 'red-border', probability: 0, maxDays: null, terminal: true, lost: true,
    /* A lost deal may be re-engaged — the Lead model has always carried isReEngage.
       A won deal may NOT be reopened: a Delivery Work Order exists downstream. */
    reopenable: true,
    ownerRole: 'sales_executive',
    definition: 'Customer will not proceed.',
    advancesOn: 'Decision communicated by the customer.',
    reachableFromAny: true,
    entryRequires: [
      { field: 'lostReason',       test: 'notEmpty',                        message: 'A lost reason is required' },
      { field: 'lostReasonDetail', test: 'requiredIf:lostReason=other',     message: 'Describe the reason' },
      { field: 'lostTo',           test: 'notEmpty',                        message: 'Record who or what we lost to' },
      { field: 'lostToName',       test: 'requiredIf:lostTo=competitor',    message: 'Name the competitor' },
    ],
  },
];

const SALES_STAGE_KEYS      = SALES_STAGES.map((s) => s.key);
const TERMINAL_SALES_STAGES = SALES_STAGES.filter((s) => s.terminal).map((s) => s.key);
const OPEN_SALES_STAGES     = SALES_STAGES.filter((s) => !s.terminal).map((s) => s.key);
const WON_STAGE             = 'commercial_order';
const LOST_STAGE            = 'order_lost';

/* ══════════════════════════════════════════════════════════════════════════
   PROCESS 2 — DELIVERY
   ══════════════════════════════════════════════════════════════════════════ */

const DELIVERY_STAGES = [
  {
    key: 'order_review', order: 1, shortCode: 'D1', label: 'Order Review & Planning',
    color: 'var(--gold)', borderClass: 'gold-border', ownerRole: 'production_head',
    definition: 'Verify the Work Order against the PO, confirm stock, set the target delivery date.',
    entryRequires: [],
  },
  {
    key: 'procurement', order: 2, shortCode: 'D2', label: 'Procurement & Stock',
    color: 'var(--azure)', borderClass: 'blue-border', ownerRole: 'production_head',
    definition: 'Allocate stock or raise a supplier PO. Incoming quality inspection.',
    entryRequires: [
      { field: 'acceptedAt',              test: 'anyDate',    message: 'The Work Order must be accepted by the Delivery Manager' },
      { field: 'currentCommittedDate',    test: 'anyDate',    message: 'A target delivery date must be confirmed to the customer' },
      { field: 'customerAck.acknowledged',test: 'isTrue',     message: 'The customer must have acknowledged the committed date' },
      { field: 'items',                   test: 'notEmpty',   message: 'Verify product specifications and quantities against the PO' },
    ],
  },
  {
    key: 'preparation_packing', order: 3, shortCode: 'D3', label: 'Production & Packing',
    color: 'var(--violet)', borderClass: 'violet-border', ownerRole: 'production_engineer',
    definition: 'Pick, inspect, pack and label. Generate dispatch documents.',
    entryRequires: [
      { field: 'stockConfirmedAt', test: 'anyDate', message: 'All items must be available, quality-checked and tagged to this Work Order' },
    ],
  },
  {
    key: 'scheduling_dispatch', order: 4, shortCode: 'D4', label: 'Scheduling & Dispatch',
    color: 'var(--amber)', borderClass: 'amber-border', ownerRole: 'production_head',
    definition: 'Confirm the delivery window, assign transport, dispatch.',
    entryRequires: [
      /* THE QC GATE (doc 3, PD-HD-07). "Engineers cannot mark an order as dispatch ready
         — only the Production Head can do that after reviewing QC results. This is
         enforced at the backend level."

         Enforced twice, deliberately and independently: an engineer holds no
         `workorder.dispatch` permission, AND this gate refuses the stage without a Head's
         approval timestamp. Either alone would be a single point of failure for the one
         rule doc 3 states most emphatically. */
      { field: 'qc.approvedAt',   test: 'anyDate',              message: 'QC must be approved by the Production Head before dispatch' },
      { field: 'attachments',     test: 'hasDoc:packing_list',  message: 'Packing list must be attached' },
      { field: 'attachments',     test: 'hasDoc:delivery_note', message: 'Delivery note must be attached' },
      { field: 'attachments',     test: 'hasDoc:invoice',       message: 'Tax invoice must be attached' },
      { field: 'packingCheckedBy',test: 'notEmpty',             message: 'The packing checklist must be signed off' },
    ],
  },
  {
    key: 'delivery_handover', order: 5, shortCode: 'D5', label: 'Delivery & Handover',
    color: 'var(--emerald)', borderClass: 'green-border', ownerRole: 'production_head',
    definition: 'Transport, verify against the delivery note, obtain the signed DA.',
    entryRequires: [
      { field: 'dispatchedAt',            test: 'anyDate',  message: 'The shipment must be physically dispatched' },
      { field: 'dispatchDetails.carrier', test: 'notEmpty', message: 'Record the carrier or vehicle' },
    ],
  },
];

const DELIVERY_STAGE_KEYS = DELIVERY_STAGES.map((s) => s.key);

const WORKORDER_STATUSES = ['created', 'accepted', 'in_progress', 'dispatched', 'delivered', 'cancelled'];

/* The DA gate — checked when marking a Work Order Delivered, not on a stage move. */
const DELIVERED_REQUIRES = [
  { field: 'attachments', test: 'hasDoc:delivery_acknowledgement', message: 'The signed Delivery Acknowledgement is mandatory' },
  { field: 'attachments', test: 'hasDoc:da_photo',                 message: 'Photo evidence of delivery condition is mandatory' },
  { field: 'deliveryAccuracy.itemsDelivered', test: 'positiveNumber', message: 'Verify delivered items against the delivery note' },
];

/* Delivery date must be confirmed within this many business days of acceptance. */
const DELIVERY_DATE_SLA_BUSINESS_DAYS = 1;
/* Minimum advance notice for a delay, measured against originalCommittedDate (A12). */
const DELAY_NOTICE_MIN_HOURS = 48;

/* ══════════════════════════════════════════════════════════════════════════
   PROCESS 3 — INSTALLATION & CUSTOMER SERVICE
   ══════════════════════════════════════════════════════════════════════════ */

const INSTALL_STAGES = [
  {
    key: 'planning', order: 1, shortCode: 'I1', label: 'Installation Planning',
    color: 'var(--gold)', borderClass: 'gold-border', ownerRole: 'install_head',
    definition: 'Confirm site readiness, assign a technician, schedule the date.',
    entryRequires: [],
    checklistTemplate: [
      { key: 'power_supply',   label: 'Site power supply confirmed',    required: true },
      { key: 'space_access',   label: 'Space and access confirmed',     required: true },
      { key: 'civil_work',     label: 'Civil requirements confirmed',   required: true },
      { key: 'technician',     label: 'Technician assigned',            required: true },
      { key: 'tools',          label: 'Tools and consumables prepared', required: true },
      { key: 'doc_pack',       label: 'Documentation pack prepared',    required: true },
    ],
  },
  {
    key: 'on_site', order: 2, shortCode: 'I2', label: 'On-Site Installation',
    color: 'var(--azure)', borderClass: 'blue-border', ownerRole: 'field_engineer',
    definition: 'Unbox, assemble, position, wire and configure per the installation SOP.',
    entryRequires: [
      { field: 'siteReady.confirmedAt', test: 'anyDate',              message: 'The customer must confirm site readiness: power, space, access, civil work' },
      { field: 'technician',            test: 'notEmpty',             message: 'Assign an installation technician' },
      { field: 'scheduledDate',         test: 'anyDate',              message: 'Schedule the installation date' },
      { field: 'checklists',            test: 'checklistDone:planning', message: 'Complete the planning checklist' },
    ],
    checklistTemplate: [
      { key: 'unboxed',    label: 'Unboxed and inventory verified',       required: true },
      { key: 'assembled',  label: 'Assembled and positioned',             required: true },
      { key: 'wired',      label: 'Wired to specification',               required: true },
      { key: 'configured', label: 'Configured per technical specification', required: true },
      { key: 'sop',        label: 'Installation SOP followed',            required: true },
      { key: 'site_clean', label: 'Site left clean',                      required: false },
      { key: 'snags',      label: 'Snags recorded',                       required: true },
    ],
  },
  {
    key: 'commissioning', order: 3, shortCode: 'I3', label: 'Commissioning & Testing',
    color: 'var(--violet)', borderClass: 'violet-border', ownerRole: 'field_engineer',
    definition: 'Full functional test protocol. Verify all features against the scope of supply.',
    entryRequires: [
      { field: 'checklists', test: 'checklistDone:on_site',   message: 'The Installation Checklist must be fully completed' },
      { field: 'checklists', test: 'checklistSigned:on_site', message: 'The technician must sign the Installation Checklist' },
      { field: 'snags',      test: 'noOpenSnags',             message: 'No open major or blocker snagging items may remain' },
    ],
    checklistTemplate: [
      { key: 'power_on',      label: 'Powered on successfully',            required: true },
      { key: 'functional',    label: 'Full functional test protocol run',  required: true },
      { key: 'scope_verify',  label: 'All features verified against scope of supply', required: true },
      { key: 'results_logged',label: 'Test results recorded',              required: true },
    ],
  },
  {
    key: 'handover_training', order: 4, shortCode: 'I4', label: 'Handover & Training',
    color: 'var(--amber)', borderClass: 'amber-border', ownerRole: 'install_head',
    definition: 'End-user training, documentation handover, signed Handover Certificate.',
    entryRequires: [
      { field: 'commissioning.passed',                  test: 'isTrue',  message: 'The product must pass the full functional test protocol' },
      { field: 'commissioning.technicianSignedAt',      test: 'anyDate', message: 'The technician must sign the Commissioning Test Report' },
      { field: 'commissioning.customerCountersignedAt', test: 'anyDate', message: 'The customer representative must countersign the Commissioning Test Report' },
      { field: 'attachments', test: 'hasDoc:commissioning_report',       message: 'The Commissioning Test Report must be uploaded' },
    ],
    checklistTemplate: [
      { key: 'training_operation',   label: 'Operation training delivered',    required: true },
      { key: 'training_maintenance', label: 'Routine maintenance training delivered', required: true },
      { key: 'training_troubleshoot',label: 'Basic troubleshooting covered',   required: true },
      { key: 'manual',               label: 'User manual handed over',         required: true },
      { key: 'warranty',             label: 'Warranty card handed over',       required: true },
      { key: 'service_contact',      label: 'Service contact details provided',required: true },
    ],
  },
  {
    key: 'post_support', order: 5, shortCode: 'I5', label: 'Post-Installation Support',
    color: 'var(--azure)', borderClass: 'blue-border', ownerRole: 'cs_agent',
    definition: 'Proactive check-in within 7 days. Log, track and close all issues.',
    entryRequires: [
      { field: 'attachments',               test: 'hasDoc:handover_certificate', message: 'A signed Handover Certificate must be uploaded' },
      { field: 'handover.trainedAttendees', test: 'notEmpty',                    message: 'Record who attended the end-user training' },
      { field: 'checklists',                test: 'checklistDone:handover_training', message: 'Complete the handover checklist' },
    ],
    checklistTemplate: [],
  },
  {
    key: 'feedback', order: 6, shortCode: 'I6', label: 'Customer Feedback',
    color: 'var(--emerald)', borderClass: 'green-border', ownerRole: 'cs_manager',
    definition: 'Dispatch the feedback form, chase it, log CSAT, close the record.',
    entryRequires: [
      { field: 'postSupport.checkInDoneAt', test: 'anyDate',        message: 'The 7-day proactive check-in must be completed' },
      { field: 'postSupport.issues',        test: 'allIssuesClosed', message: 'All logged support issues must be resolved and closed' },
    ],
    checklistTemplate: [],
  },
];

const INSTALL_STAGE_KEYS = INSTALL_STAGES.map((s) => s.key);

const INSTALL_STATUSES = ['open', 'in_progress', 'handed_over', 'support', 'closed', 'cancelled'];

/* The handover status gate. */
const HANDED_OVER_REQUIRES = [
  { field: 'attachments',               test: 'hasDoc:handover_certificate',     message: 'A signed Handover Certificate must be uploaded' },
  { field: 'handover.trainedAttendees', test: 'notEmpty',                        message: 'Record who attended the end-user training' },
  { field: 'checklists',                test: 'checklistDone:handover_training', message: 'Complete the handover checklist' },
];

/* The closure gate — the framework's hardest rule. */
const CLOSED_REQUIRES = [
  { field: 'feedback.receivedAt',        test: 'anyDate',              message: 'A record cannot be Closed until the Customer Feedback Form is received' },
  { field: 'feedback.csat',              test: 'positiveNumber',       message: 'Log the CSAT score' },
  { field: 'correctiveAction.documentedAt', test: 'requiredIfCsatBelow:3', message: 'A corrective action plan must be documented before closing a job with CSAT below 3.0' },
];

const CSAT_ESCALATION_THRESHOLD    = 3.0;
const CSAT_MAX                     = 5;
const CHECK_IN_DUE_DAYS            = 7;   // calendar days after handover
const FEEDBACK_DISPATCH_DUE_DAYS   = 14;  // calendar days after handover certificate
const FEEDBACK_REMINDER_DAYS       = 7;   // calendar days after dispatch (A14)
const FEEDBACK_COLLECTION_WINDOW_DAYS = 30; // for the collection-rate KPI (A15)
const CORRECTIVE_ACTION_SLA_BUSINESS_DAYS = 5;
const ISSUE_SLA_HOURS              = 48;
const INSTALL_LEAD_TIME_TARGET_BUSINESS_DAYS = 5;

/* ══════════════════════════════════════════════════════════════════════════
   HYGIENE THRESHOLDS
   ══════════════════════════════════════════════════════════════════════════ */

const INACTIVITY_ALERT_DAYS        = 30;  // framework: auto-flag to Sales Manager
const OVERDUE_CONTACT_DAYS         = 7;   // pre-existing isOverdue behaviour
const FOLLOWUP_MAX_DAYS_AHEAD      = 14;  // dictionary: not further out without a note
const WEEKLY_NOTE_DAYS             = 7;   // dictionary: one note per week at Engagement+
const PROBABILITY_OVERRIDE_MAX_POINTS = 15; // A5 — percentage points, not relative
const NOTE_REQUIRED_FROM_STAGE_ORDER  = 3;  // Engagement and above

/* ══════════════════════════════════════════════════════════════════════════
   KPI TARGETS — see docs/requirements/05-kpi-definitions.md
   ══════════════════════════════════════════════════════════════════════════ */

const KPI_TARGETS = {
  sales: {
    suspect_to_prospect:  { label: 'Suspect-to-Prospect Rate', target: 40,   unit: 'percent', direction: 'min' },
    prospect_to_proposal: { label: 'Prospect-to-Proposal Rate',target: 60,   unit: 'percent', direction: 'min' },
    win_rate:             { label: 'Win Rate',                 target: 30,   unit: 'percent', direction: 'min' },
    sales_cycle_days:     { label: 'Sales Cycle Length',       target: null, unit: 'days',    direction: 'max' },
    pipeline_value:       { label: 'Pipeline Value',           target: null, unit: 'currency',direction: 'min' },
    weighted_pipeline:    { label: 'Weighted Pipeline',        target: null, unit: 'currency',direction: 'min' },
    po_accuracy:          { label: 'PO Accuracy Rate',         target: 95,   unit: 'percent', direction: 'min' },
  },
  delivery: {
    on_time_delivery:        { label: 'On-Time Delivery Rate',         target: 95,   unit: 'percent', direction: 'min' },
    date_notification_rate:  { label: 'Delivery Date Notification Rate',target: 100, unit: 'percent', direction: 'min' },
    delay_notice_compliance: { label: 'Delay Notification Compliance', target: 100,  unit: 'percent', direction: 'min' },
    order_to_dispatch_days:  { label: 'Order-to-Dispatch Time',        target: null, unit: 'days',    direction: 'max' },
    delivery_accuracy:       { label: 'Delivery Accuracy Rate',        target: 99,   unit: 'percent', direction: 'min' },
    da_completion:           { label: 'DA Completion Rate',            target: 100,  unit: 'percent', direction: 'min' },
    damage_rate:             { label: 'Damage / Return Rate',          target: 1,    unit: 'percent', direction: 'max' },
  },
  installation: {
    install_lead_time_days:  { label: 'Installation Lead Time',     target: 5,   unit: 'business days', direction: 'max' },
    first_time_right:        { label: 'First-Time Right Rate',      target: 90,  unit: 'percent', direction: 'min' },
    commissioning_pass:      { label: 'Commissioning Pass Rate',    target: 95,  unit: 'percent', direction: 'min' },
    handover_cert_rate:      { label: 'Handover Certificate Rate',  target: 100, unit: 'percent', direction: 'min' },
    issue_resolution_hours:  { label: 'Issue Resolution Time',      target: 48,  unit: 'hours',   direction: 'max' },
    csat:                    { label: 'CSAT Score',                 target: 4.0, unit: 'score',   direction: 'min' },
    feedback_collection:     { label: 'Feedback Collection Rate',   target: 85,  unit: 'percent', direction: 'min' },
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   ZONE DERIVATION — assumption A17
   ══════════════════════════════════════════════════════════════════════════ */

const STATE_TO_ZONE = {
  /* North */
  'jammu and kashmir': 'north', 'jammu & kashmir': 'north', 'jk': 'north',
  'ladakh': 'north', 'la': 'north',
  'himachal pradesh': 'north', 'hp': 'north',
  'punjab': 'north', 'pb': 'north',
  'haryana': 'north', 'hr': 'north',
  'delhi': 'north', 'new delhi': 'north', 'nct of delhi': 'north', 'dl': 'north',
  'chandigarh': 'north', 'ch': 'north',
  'uttarakhand': 'north', 'uttaranchal': 'north', 'uk': 'north', 'ut': 'north',
  'rajasthan': 'north', 'rj': 'north',
  'uttar pradesh': 'north', 'up': 'north',
  /* South */
  'karnataka': 'south', 'ka': 'south',
  'kerala': 'south', 'kl': 'south',
  'tamil nadu': 'south', 'tamilnadu': 'south', 'tn': 'south',
  'andhra pradesh': 'south', 'ap': 'south',
  'telangana': 'south', 'ts': 'south', 'tg': 'south',
  'puducherry': 'south', 'pondicherry': 'south', 'py': 'south',
  'lakshadweep': 'south', 'ld': 'south',
  'andaman and nicobar islands': 'south', 'andaman & nicobar': 'south', 'an': 'south',
  /* East */
  'west bengal': 'east', 'wb': 'east',
  'odisha': 'east', 'orissa': 'east', 'or': 'east', 'od': 'east',
  'jharkhand': 'east', 'jh': 'east',
  'bihar': 'east', 'br': 'east',
  'assam': 'east', 'as': 'east',
  'sikkim': 'east', 'sk': 'east',
  'arunachal pradesh': 'east', 'ar': 'east',
  'nagaland': 'east', 'nl': 'east',
  'manipur': 'east', 'mn': 'east',
  'mizoram': 'east', 'mz': 'east',
  'tripura': 'east', 'tr': 'east',
  'meghalaya': 'east', 'ml': 'east',
  /* West */
  'maharashtra': 'west', 'mh': 'west',
  'gujarat': 'west', 'gj': 'west',
  'goa': 'west', 'ga': 'west',
  'madhya pradesh': 'west', 'mp': 'west',
  'chhattisgarh': 'west', 'chattisgarh': 'west', 'cg': 'west',
  'dadra and nagar haveli and daman and diu': 'west', 'daman and diu': 'west',
  'dadra and nagar haveli': 'west', 'dn': 'west', 'dd': 'west',
};

/* LEGACY_STAGE_MAP and LEGACY_SOURCE_MAP were removed in B1b.
 *
 * The project is greenfield (R-3): no production records are carried forward,
 * so a legacy value arriving at the API is a mistake to surface, not a value to
 * silently upgrade. Keeping the maps here would have invited exactly that —
 * someone wiring them into a pre('validate') hook and quietly rewriting
 * `won` to `commercial_order` on input, which reintroduces the ambiguity the
 * dictionary exists to remove (`contacted` and `interested` both map to
 * `prospect`, so the upgrade is lossy and irreversible).
 *
 * The mapping itself is preserved, with its rationale, in
 * docs/requirements/archive/08-migration-notes.md.
 */

/* Free-text industry → picklist segment. Used to SUGGEST only (A21). */
const INDUSTRY_SEGMENT_HINTS = {
  auto: 'auto', automotive: 'auto', automobile: 'auto',
  pharma: 'pharma', pharmaceutical: 'pharma', pharmaceuticals: 'pharma', biotech: 'pharma',
  fmcg: 'fmcg', 'consumer goods': 'fmcg', retail: 'fmcg',
  textile: 'textile', textiles: 'textile', apparel: 'textile', garments: 'textile',
  chemical: 'chemical', chemicals: 'chemical', petrochemical: 'chemical',
  steel: 'steel_metal', metal: 'steel_metal', metals: 'steel_metal', mining: 'steel_metal',
  electronics: 'electronics', semiconductor: 'electronics', electrical: 'electronics',
  food: 'food_processing', 'food processing': 'food_processing', beverage: 'food_processing', dairy: 'food_processing',
  cement: 'cement', construction: 'cement',
  ports: 'ports', shipping: 'ports', logistics: 'ports', maritime: 'ports',
  railways: 'railways', rail: 'railways',
  it: 'it_manufacturing', 'information technology': 'it_manufacturing', software: 'it_manufacturing',
  manufacturing: 'it_manufacturing',
};

/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURABLE RULES — R-2
   ══════════════════════════════════════════════════════════════════════════

   The assumptions the source documents never settled are held here rather than
   inlined at their point of use, so a client ruling becomes a Setting change
   instead of a code change plus a data migration.

   The constants above remain the DEFAULTS. `config/pipelineRuntime.js` reads
   overrides from the Setting collection at boot and calls setActiveRules().

   Every function that depends on one of these takes an optional trailing
   `rules` argument defaulting to the active set. Tests pass rules explicitly so
   they never depend on global state — the same discipline that keeps the rest
   of the suite order-independent.

   See docs/requirements/09-configurable-rules.md and 07-open-questions.
   ══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_RULES = Object.freeze({
  /* A18 — the single assumption most likely to be wrong. Controls the
     Suspect-to-Prospect KPI against its 40% target. */
  spencoMinTotal: SPENCO_MIN_TOTAL,
  spencoSubGates: Object.freeze({ ...SPENCO_SUB_GATES }),

  /* A4 — "industrial" is never defined in the dictionary. */
  amcRequiredCompanyTypes: Object.freeze([...AMC_REQUIRED_COMPANY_TYPES]),

  /* A2 — "Qualified stage or later" names no stage that exists. */
  competitorRequiredFromStage: 'engagement',

  /* Doc 2's discount ladder. Runtime-tunable because it is a commercial policy, not a
     law of the system — the band edges are the sort of thing a Sales Director moves. */
  discountTiers: Object.freeze(DISCOUNT_TIERS.map((t) => Object.freeze({ ...t }))),

  /* A5 — percentage points, not relative percent. */
  probabilityOverrideMaxPoints: PROBABILITY_OVERRIDE_MAX_POINTS,

  /* A12 — does the 48-hour delay clock restart when a date is revised twice?
     false keeps `originalCommittedDate` write-once, so repeated small
     revisions cannot reset the clock and hollow out the KPI. */
  delayClockResetsOnRevision: false,

  /* A17 — India has no canonical four-zone split. */
  stateToZone: Object.freeze({ ...STATE_TO_ZONE }),

  /* Hygiene thresholds — flags only, never gates. */
  inactivityAlertDays: INACTIVITY_ALERT_DAYS,
  followUpMaxDaysAhead: FOLLOWUP_MAX_DAYS_AHEAD,
  weeklyNoteDays: WEEKLY_NOTE_DAYS,
});

/** The resolved rule set in force for this process. Replaced once, at boot. */
let activeRules = DEFAULT_RULES;

/**
 * Install a resolved rule set. Called by pipelineRuntime after reading Settings.
 * Unknown keys are rejected rather than silently ignored, so a typo in a Setting
 * document surfaces at boot instead of quietly restoring a default.
 */
function setActiveRules(next) {
  const unknown = Object.keys(next || {}).filter((k) => !(k in DEFAULT_RULES));
  if (unknown.length) {
    throw new Error(`Unknown pipeline rule key(s): ${unknown.join(', ')}`);
  }
  activeRules = Object.freeze({ ...DEFAULT_RULES, ...next });
  return activeRules;
}

function getActiveRules() {
  return activeRules;
}

/** Normalise the optional trailing `rules` argument every rule-aware fn accepts. */
const R = (rules) => rules || activeRules;

/* ══════════════════════════════════════════════════════════════════════════
   PURE HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

const keysOf = (list) => list.map((e) => e.key);

/** Enum key arrays, with '' prepended for optional Mongoose fields. */
const optional = (list) => ['', ...keysOf(list)];

/** Read a possibly dotted path off a document or plain object. */
function getPath(doc, path) {
  if (!doc || !path) return undefined;
  return path.split('.').reduce((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    /* Mongoose Maps and sub-docs both respond to .get() */
    if (typeof acc.get === 'function' && !Array.isArray(acc)) {
      const viaGet = acc.get(part);
      if (viaGet !== undefined) return viaGet;
    }
    return acc[part];
  }, doc);
}

function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return (startOfDay(b) - startOfDay(a)) / 86400000;
}

/** Normalise a state name to a zone key. Returns '' when unrecognised (A17). */
function deriveZone(state, rules) {
  if (!state || typeof state !== 'string') return '';
  const norm = state.trim().toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
  return R(rules).stateToZone[norm] || '';
}

/** Suggest an industry segment from free-text enrichment data. Never auto-persisted. */
function mapIndustryToSegment(freeText) {
  if (!freeText || typeof freeText !== 'string') return '';
  const norm = freeText.trim().toLowerCase();
  if (INDUSTRY_SEGMENT_HINTS[norm]) return INDUSTRY_SEGMENT_HINTS[norm];
  const hit = Object.keys(INDUSTRY_SEGMENT_HINTS).find((k) => norm.includes(k));
  return hit ? INDUSTRY_SEGMENT_HINTS[hit] : '';
}

/** Assumption A6 — B2B is everything that is not a homeowner. */
function isB2B(doc) {
  const ct = getPath(doc, 'companyType');
  if (isBlank(ct)) return true; // unknown ⇒ treat as B2B, the stricter reading
  return !NON_B2B_COMPANY_TYPES.includes(ct);
}

/** Assumption A4 — does this company type require an AMC at Commercial Order? */
function isIndustrial(doc, rules) {
  return R(rules).amcRequiredCompanyTypes.includes(getPath(doc, 'companyType'));
}

/** Does the document carry at least one attachment of this docType? */
function hasDoc(doc, docType) {
  const atts = getPath(doc, 'attachments');
  if (!Array.isArray(atts)) return false;
  return atts.some((a) => a && a.docType === docType);
}

function spencoTotal(spenco) {
  if (!spenco) return 0;
  return SPENCO_DIMENSIONS.reduce((sum, d) => {
    const v = Number(getPath(spenco, d.key)) || 0;
    return sum + Math.max(0, Math.min(SPENCO_MAX_PER_DIMENSION, v));
  }, 0);
}

/**
 * Has anyone actually scored this SPENCO, as opposed to leaving it at its
 * zero defaults? Drives the `spenco.scoredAt` stamp that the → Engagement gate
 * requires; without a writer for that field, no lead could pass Engagement at
 * all, because every dimension defaults to 0 and 0 is indistinguishable from
 * "not yet assessed" unless something records the moment of assessment.
 */
function spencoScored(spenco) {
  if (!spenco) return false;
  return SPENCO_DIMENSIONS.some((d) => (Number(getPath(spenco, d.key)) || 0) > 0);
}

function spencoQualified(spenco, rules) {
  if (!spenco) return false;
  const r = R(rules);
  if (spencoTotal(spenco) < r.spencoMinTotal) return false;
  return Object.entries(r.spencoSubGates)
    .every(([dim, min]) => (Number(getPath(spenco, dim)) || 0) >= min);
}

/* ── rule resolution over the stage tables ─────────────────────────────── */

/**
 * Apply the active rules to a stage table, returning a NEW table.
 *
 * Two rows carry a `configKey`:
 *   `spenco`     — the threshold appears in the user-facing message, so the
 *                  message is regenerated rather than left quoting the default.
 *   `competitor` — assumption A2. The dictionary says Competitor is mandatory
 *                  "at Qualified stage or later", but no stage is called
 *                  Qualified. The rows move to whichever stage the client
 *                  eventually names.
 *
 * Pure: the module-level tables are never mutated.
 */
function resolveStages(list, rules) {
  const r = R(rules);
  if (list !== SALES_STAGES) return list; // only the sales table carries configKeys

  const target = r.competitorRequiredFromStage;
  if (!list.some((s) => s.key === target)) {
    throw new Error(
      `competitorRequiredFromStage: '${target}' is not a sales stage ` +
      `(expected one of ${list.filter((s) => !s.terminal).map((s) => s.key).join(', ')})`
    );
  }

  const competitorRows = [];
  for (const stage of list) {
    for (const row of stage.entryRequires || []) {
      if (row.configKey === 'competitor') competitorRows.push(row);
    }
  }

  const targetLabel = stageDef(list, target).label;

  return list.map((stage) => {
    let rows = (stage.entryRequires || []).filter((row) => row.configKey !== 'competitor');

    rows = rows.map((row) => {
      if (row.configKey !== 'spenco') return row;
      return {
        ...row,
        message:
          `SPENCO total must meet the qualification threshold ` +
          `(>= ${r.spencoMinTotal}/${SPENCO_MAX_TOTAL}` +
          Object.entries(r.spencoSubGates).map(([d, m]) => `, ${d} >= ${m}`).join('') +
          `)`,
      };
    });

    if (stage.key === target) {
      rows = rows.concat(competitorRows.map((row) => (
        row.field === 'competitor'
          ? { ...row, message: `Competitor is required from ${targetLabel} onward — use "None Known" if applicable` }
          : row
      )));
    }

    return { ...stage, entryRequires: rows };
  });
}

/* ── stage list navigation ─────────────────────────────────────────────── */

function stageDef(list, key) {
  return list.find((s) => s.key === key) || null;
}

function stageIndex(list, key) {
  return list.findIndex((s) => s.key === key);
}

function stageLabel(list, key) {
  const s = stageDef(list, key);
  return s ? s.label : key;
}

/** The single stage forward from `key`, skipping terminal-only stages. */
function nextStage(list, key) {
  const cur = stageDef(list, key);
  if (!cur || cur.terminal) return null;
  const forward = list
    .filter((s) => !s.reachableFromAny && s.order > cur.order)
    .sort((a, b) => a.order - b.order);
  return forward.length ? forward[0].key : null;
}

/**
 * Movement rules (docs/requirements/03-stage-gates.md):
 *   forward by exactly one   → allowed, gated
 *   forward by more than one → rejected (STAGE_SKIP)
 *   backward                 → allowed, ungated
 *   → a reachableFromAny terminal stage (order_lost) from any open stage → allowed, gated
 */
function canAdvance(list, fromKey, toKey) {
  if (fromKey === toKey) return { ok: true, direction: 'same', gated: false };

  const from = stageDef(list, fromKey);
  const to   = stageDef(list, toKey);
  if (!to)   return { ok: false, reason: 'UNKNOWN_STAGE', message: `Unknown stage '${toKey}'` };
  if (!from) return { ok: true, direction: 'forward', gated: true }; // brand-new document

  if (to.reachableFromAny) {
    if (from.terminal) {
      return { ok: false, reason: 'TERMINAL_STAGE', message: `'${from.label}' is a closed stage and cannot be moved to '${to.label}'` };
    }
    return { ok: true, direction: 'forward', gated: true };
  }

  if (to.order < from.order) {
    if (from.terminal) {
      if (!from.reopenable) {
        return { ok: false, reason: 'TERMINAL_STAGE', message: `'${from.label}' cannot be reopened — a downstream Work Order already exists` };
      }
      /* Re-engaging a lost deal. Only ever back into an OPEN stage — a reopened
         deal must climb the pipeline again through the normal gates rather than
         jumping straight to Commercial Order. */
      if (to.terminal) {
        return { ok: false, reason: 'STAGE_SKIP', message: `Reopen '${from.label}' into an open stage first — it cannot move directly to '${to.label}'` };
      }
      return { ok: true, direction: 'reopen', gated: false };
    }
    return { ok: true, direction: 'backward', gated: false };
  }

  if (from.terminal) {
    return { ok: false, reason: 'TERMINAL_STAGE', message: `'${from.label}' is a closed stage and cannot advance` };
  }

  const expected = nextStage(list, fromKey);
  if (toKey !== expected) {
    return {
      ok: false,
      reason: 'STAGE_SKIP',
      message: `Stages must be followed in sequence — '${from.label}' can only advance to '${stageLabel(list, expected)}', not '${to.label}'`,
      expected,
    };
  }
  return { ok: true, direction: 'forward', gated: true };
}

/* ── the requirement interpreter ───────────────────────────────────────── */

/**
 * Evaluate one { field, test, message } requirement against a document.
 * Returns true when satisfied. Unknown tests fail closed and are reported,
 * so a typo in a stage table surfaces immediately rather than silently passing.
 */
function evaluateTest(doc, req, now, rules) {
  const { field, test } = req;
  const [name, arg] = String(test).split(':');
  const value = getPath(doc, field);
  const ref = now instanceof Date ? now : new Date();

  switch (name) {
    case 'notEmpty':
      return !isBlank(value);

    case 'isTrue':
      return value === true;

    case 'positiveNumber':
      return typeof value === 'number' ? value > 0 : Number(value) > 0;

    case 'nonNegativeNumber':
      return Number(value) >= 0;

    case 'anyDate':
      return toDate(value) !== null;

    case 'futureDate': {
      const d = toDate(value);
      return d !== null && startOfDay(d) >= startOfDay(ref);
    }

    case 'oneOf':
      return String(arg || '').split('|').includes(value);

    case 'oneOfIfIndustrial':
      if (!isIndustrial(doc, rules)) return true;
      return String(arg || '').split('|').includes(value);

    case 'hasDoc':
      return hasDoc(doc, arg);

    case 'hasAnyDoc':
      return String(arg || '').split('|').some((t) => hasDoc(doc, t));

    case 'requiredIfB2B':
      if (!isB2B(doc)) return true;
      return !isBlank(value);

    case 'requiredIf': {
      const [depField, depValue] = String(arg || '').split('=');
      if (String(getPath(doc, depField)) !== depValue) return true;
      return !isBlank(value);
    }

    case 'requiredIfCsatBelow': {
      const csat = Number(getPath(doc, 'feedback.csat'));
      if (!Number.isFinite(csat) || csat >= Number(arg)) return true;
      return !isBlank(value);
    }

    case 'checklistDone': {
      const cl = findChecklist(value, arg);
      if (!cl) return false;
      return (cl.items || []).every((i) => !i.required || i.done === true);
    }

    case 'checklistSigned': {
      const cl = findChecklist(value, arg);
      return !!(cl && !isBlank(cl.signedByName));
    }

    case 'noOpenSnags': {
      const snags = Array.isArray(value) ? value : [];
      return !snags.some((s) => s && !s.closedAt && BLOCKING_SNAG_SEVERITIES.includes(s.severity));
    }

    case 'allIssuesClosed': {
      const issues = Array.isArray(value) ? value : [];
      return !issues.some((i) => i && !i.resolvedAt);
    }

    default:
      return false;
  }
}

function findChecklist(checklists, stageKey) {
  if (!Array.isArray(checklists)) return null;
  return checklists.find((c) => c && c.stageKey === stageKey) || null;
}

/**
 * Run a requirement list against a document.
 * @returns {{ok:boolean, missing:Array<{field,test,message,code}>}}
 */
function validateRequirements(doc, requirements, now, rules) {
  const missing = [];
  for (const req of requirements || []) {
    if (!evaluateTest(doc, req, now, rules)) {
      missing.push({
        field: req.field,
        test: req.test,
        code: `${req.field}.${String(req.test).split(':')[0]}`,
        message: req.message || `${req.field} is required`,
      });
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Validate a document against a target stage's entry requirements.
 * The stage table is resolved against the active rules first, so a client
 * ruling on A2 or A18 takes effect here without touching this function.
 */
function validateStageEntry(doc, list, targetKey, now, rules) {
  const resolved = resolveStages(list, rules);
  const target = stageDef(resolved, targetKey);
  if (!target) {
    return { ok: false, missing: [{ field: 'stage', test: 'oneOf', code: 'stage.unknown', message: `Unknown stage '${targetKey}'` }] };
  }
  return validateRequirements(doc, target.entryRequires, now, rules);
}

/* ── hygiene ───────────────────────────────────────────────────────────── */

/**
 * Non-blocking data-quality issues for a lead.
 * Pure and synchronous — safe to call from a Mongoose pre('save') hook.
 * @returns {Array<{code, message, severity}>}
 */
function hygieneIssues(lead, now, rules) {
  const ref = now instanceof Date ? now : new Date();
  const r = R(rules);
  const issues = [];
  const push = (code, message, severity = 'warn') => issues.push({ code, message, severity });

  const stage = getPath(lead, 'stage');
  const def = stageDef(SALES_STAGES, stage);
  const isOpen = def && !def.terminal;

  /* Mandatory contact fields — flagged always, gated only on advance. */
  if (isBlank(getPath(lead, 'companyType'))) push('company_type_missing', 'Company Type is not set');
  if (isB2B(lead) && isBlank(getPath(lead, 'industrySegment'))) {
    const suggestion = mapIndustryToSegment(getPath(lead, 'industry'));
    push('industry_segment_missing',
      suggestion ? `Industry segment is not set — enrichment suggests "${suggestion}"` : 'Industry segment is not set for a B2B contact');
  }
  if (isB2B(lead) && isBlank(getPath(lead, 'email'))) push('email_missing', 'Email is required for B2B contacts');
  if (isBlank(getPath(lead, 'jobTitle'))) push('designation_missing', 'Designation is not set');
  if (isBlank(getPath(lead, 'state'))) push('state_missing', 'State is not set');
  else if (isBlank(getPath(lead, 'zone'))) push('zone_underived', `Zone could not be derived from state "${getPath(lead, 'state')}"`);

  const phone = String(getPath(lead, 'phone') || '');
  if (phone && !/^[6-9]\d{9}$/.test(phone)) push('phone_format_invalid', 'Phone is not a 10-digit Indian mobile number', 'info');

  if (!isOpen) return issues;

  /* C-1 — expired close date */
  const close = toDate(getPath(lead, 'expectedCloseDate'));
  if (!close) push('close_date_missing', 'Expected Close Date is not set');
  else if (startOfDay(close) < startOfDay(ref)) push('close_date_expired', 'Expected Close Date is in the past — update it', 'critical');

  /* C-2 — probability override */
  const prob = Number(getPath(lead, 'probability'));
  if (def && Number.isFinite(prob) && prob > def.probability + r.probabilityOverrideMaxPoints
      && isBlank(getPath(lead, 'probabilityOverrideNote'))) {
    push('probability_override_unexplained',
      `Probability ${prob}% exceeds the ${def.label} default of ${def.probability}% by more than ${r.probabilityOverrideMaxPoints} points with no explanation`);
  }

  /* C-3 / C-4 — follow-up date */
  const fu = toDate(getPath(lead, 'nextFollowUpDate'));
  if (!fu) push('followup_missing', 'Every open deal must carry a future follow-up date', 'critical');
  else if (startOfDay(fu) < startOfDay(ref)) push('followup_past', 'The next follow-up date has passed', 'critical');
  else if (daysBetween(ref, fu) > r.followUpMaxDaysAhead && isBlank(getPath(lead, 'nextFollowUpNote'))) {
    push('followup_far_unexplained', `Follow-up is more than ${r.followUpMaxDaysAhead} days out with no reason recorded`);
  }

  if (isBlank(getPath(lead, 'nextAction'))) push('next_action_missing', 'Next Action is not recorded');

  /* Inactivity + stage age — cheap enough to evaluate on save as well as nightly. */
  const lastContact = toDate(getPath(lead, 'lastContact'));
  if (lastContact && daysBetween(lastContact, ref) >= r.inactivityAlertDays) {
    push('inactive_30d', `No activity for ${Math.floor(daysBetween(lastContact, ref))} days`, 'critical');
  }

  const enteredAt = toDate(getPath(lead, 'stageEnteredAt'));
  if (def && def.maxDays && enteredAt && daysBetween(enteredAt, ref) > def.maxDays) {
    push('stage_age_exceeded', `${Math.floor(daysBetween(enteredAt, ref))} days at ${def.label} — the limit is ${def.maxDays}`, 'critical');
  }

  /* C-5 — weekly note at Engagement and above */
  if (def && def.order >= NOTE_REQUIRED_FROM_STAGE_ORDER) {
    /* `lastActivityAt` is stamped on the lead by activityService when an activity is
       logged against it. This module is a pure function over ONE document and may not
       query the Activity collection, which is exactly why that field is denormalised. */
    const anchor = toDate(getPath(lead, 'lastActivityAt'))
      || toDate(getPath(lead, 'stageEnteredAt'))
      || toDate(getPath(lead, 'createdAt'));
    if (anchor && daysBetween(anchor, ref) > r.weeklyNoteDays) {
      push('stale_notes', `No note recorded in ${Math.floor(daysBetween(anchor, ref))} days — ${def.label} deals need one per week`);
    }
  }

  return issues;
}

/* ── serialisation for GET /api/meta/pipeline ──────────────────────────── */

/**
 * A version string that changes whenever the shape the browser depends on
 * changes. Derived from the stage keys so a rename invalidates the client
 * cache automatically without anyone remembering to bump a number.
 */
const hash36 = (s) =>
  s.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36);

/**
 * Derived from the stage keys AND the resolved rule set, so that changing the
 * SPENCO threshold in Settings invalidates every cached client copy — not just
 * renaming a stage. A stale client would otherwise keep showing the old
 * qualification message and the old gate checklist.
 */
function pipelineVersion(rules) {
  /* The taxonomy is part of the payload, so it must be part of the hash.
     usePipeline.ts caches this response with `staleTime: Infinity` keyed on `version`;
     when the hash omitted `ownerRole`, renaming a role changed what the endpoint sent
     and changed nothing about what already-signed-in clients believed — indefinitely. */
  const ownerRoles = [...IS_STAGES, ...SALES_STAGES, ...DELIVERY_STAGES, ...INSTALL_STAGES]
    .map((s) => `${s.key}:${s.ownerRole || ''}`).join(',');
  return hash36([
    IS_STAGE_KEYS.join(','),
    SALES_STAGE_KEYS.join(','),
    DELIVERY_STAGE_KEYS.join(','),
    INSTALL_STAGE_KEYS.join(','),
    keysOf(LEAD_SOURCES).join(','),
    keysOf(DOMAINS).join(','),
    ownerRoles,
    JSON.stringify(R(rules)),
  ].join('|'));
}

/** The version for the DEFAULT rules. Prefer pipelineVersion() at runtime. */
const PIPELINE_VERSION = pipelineVersion(DEFAULT_RULES);

function serialize(rules) {
  const r = R(rules);
  const publicStage = (s) => ({
    key: s.key, order: s.order, shortCode: s.shortCode, label: s.label,
    color: s.color, borderClass: s.borderClass, ownerRole: s.ownerRole,
    definition: s.definition, advancesOn: s.advancesOn,
    probability: s.probability, maxDays: s.maxDays,
    terminal: !!s.terminal, won: !!s.won, lost: !!s.lost,
    reachableFromAny: !!s.reachableFromAny,
    entryRequires: (s.entryRequires || []).map((r) => ({ field: r.field, test: r.test, message: r.message })),
    checklistTemplate: s.checklistTemplate || undefined,
  });

  return {
    version: pipelineVersion(r),
    insideSales:  { stages: IS_STAGES.map(publicStage), terminal: IS_TERMINAL_STAGES, qualified: IS_QUALIFIED_STAGE, handoffRequested: IS_HANDOFF_STAGE, converted: IS_CONVERTED_STAGE, lost: 'is_lost' },
    sales:        { stages: resolveStages(SALES_STAGES, r).map(publicStage), terminal: TERMINAL_SALES_STAGES, won: WON_STAGE, lost: LOST_STAGE },
    delivery:     { stages: DELIVERY_STAGES.map(publicStage), statuses: WORKORDER_STATUSES, deliveredRequires: DELIVERED_REQUIRES },
    installation: { stages: INSTALL_STAGES.map(publicStage),  statuses: INSTALL_STATUSES, handedOverRequires: HANDED_OVER_REQUIRES, closedRequires: CLOSED_REQUIRES },
    enums: {
      leadSources: LEAD_SOURCES, companyTypes: COMPANY_TYPES, industrySegments: INDUSTRY_SEGMENTS,
      zones: ZONES, domains: DOMAINS, competitors: COMPETITORS, lostReasons: LOST_REASONS, lostTo: LOST_TO,
      subscriptionStates: SUBSCRIPTION_STATES, amcStates: AMC_STATES,
      disqualifyReasons: DISQUALIFY_REASONS, needTypes: NEED_TYPES,
      docTypes: DOC_TYPES, delayReasonCodes: DELAY_REASON_CODES, snagSeverities: SNAG_SEVERITIES,
      bantDimensions: BANT_DIMENSIONS, leadPriorities: LEAD_PRIORITIES,
      discountTiers: r.discountTiers,
      isAssignmentModes: IS_ASSIGNMENT_MODES,
    },
    spenco: {
      dimensions: SPENCO_DIMENSIONS, maxPerDimension: SPENCO_MAX_PER_DIMENSION,
      maxTotal: SPENCO_MAX_TOTAL, minTotal: r.spencoMinTotal, subGates: r.spencoSubGates,
    },
    rules: {
      amcRequiredCompanyTypes: r.amcRequiredCompanyTypes,
      competitorRequiredFromStage: r.competitorRequiredFromStage,
      delayClockResetsOnRevision: r.delayClockResetsOnRevision,
      nonB2BCompanyTypes: NON_B2B_COMPANY_TYPES,
      inactivityAlertDays: r.inactivityAlertDays,
      overdueContactDays: OVERDUE_CONTACT_DAYS,
      followUpMaxDaysAhead: r.followUpMaxDaysAhead,
      probabilityOverrideMaxPoints: r.probabilityOverrideMaxPoints,
      deliveryDateSlaBusinessDays: DELIVERY_DATE_SLA_BUSINESS_DAYS,
      delayNoticeMinHours: DELAY_NOTICE_MIN_HOURS,
      csatEscalationThreshold: CSAT_ESCALATION_THRESHOLD,
      csatMax: CSAT_MAX,
      checkInDueDays: CHECK_IN_DUE_DAYS,
      feedbackDispatchDueDays: FEEDBACK_DISPATCH_DUE_DAYS,
      feedbackReminderDays: FEEDBACK_REMINDER_DAYS,
      correctiveActionSlaBusinessDays: CORRECTIVE_ACTION_SLA_BUSINESS_DAYS,
      issueSlaHours: ISSUE_SLA_HOURS,
    },
    kpiTargets: KPI_TARGETS,
  };
}

module.exports = {
  /* stage tables */
  IS_STAGES, SALES_STAGES, DELIVERY_STAGES, INSTALL_STAGES,
  DISCOUNT_TIERS, discountTierFor, discountSelfApproved,
  SALES_STAGE_KEYS, DELIVERY_STAGE_KEYS, INSTALL_STAGE_KEYS,
  TERMINAL_SALES_STAGES, OPEN_SALES_STAGES, WON_STAGE, LOST_STAGE,
  IS_STAGE_KEYS, IS_TERMINAL_STAGES, IS_OPEN_STAGES,
  IS_QUALIFIED_STAGE, IS_HANDOFF_STAGE, IS_CONVERTED_STAGE,
  BANT_DIMENSIONS, BANT_KEYS, IS_ASSIGNMENT_MODES, LEAD_PRIORITIES,
  WORKORDER_STATUSES, INSTALL_STATUSES,
  DELIVERED_REQUIRES, HANDED_OVER_REQUIRES, CLOSED_REQUIRES,

  /* enums (objects) */
  LEAD_SOURCES, COMPANY_TYPES, INDUSTRY_SEGMENTS, ZONES, DOMAINS, COMPETITORS,
  LOST_REASONS, LOST_TO, SUBSCRIPTION_STATES, AMC_STATES,
  DISQUALIFY_REASONS, NEED_TYPES, DOC_TYPES, DELAY_REASON_CODES,
  SNAG_SEVERITIES, BLOCKING_SNAG_SEVERITIES, SPENCO_DIMENSIONS,

  /* enum key arrays, for Mongoose */
  keysOf, optional,
  LEAD_SOURCE_KEYS:      keysOf(LEAD_SOURCES),
  COMPANY_TYPE_KEYS:     keysOf(COMPANY_TYPES),
  INDUSTRY_SEGMENT_KEYS: keysOf(INDUSTRY_SEGMENTS),
  ZONE_KEYS:             keysOf(ZONES),
  DOMAIN_KEYS:           keysOf(DOMAINS),
  COMPETITOR_KEYS:       keysOf(COMPETITORS),
  LOST_REASON_KEYS:      keysOf(LOST_REASONS),
  LOST_TO_KEYS:          keysOf(LOST_TO),
  SUBSCRIPTION_KEYS:     keysOf(SUBSCRIPTION_STATES),
  AMC_KEYS:              keysOf(AMC_STATES),
  DISQUALIFY_REASON_KEYS:keysOf(DISQUALIFY_REASONS),
  NEED_TYPE_KEYS:        keysOf(NEED_TYPES),
  DOC_TYPE_KEYS:         keysOf(DOC_TYPES),
  DELAY_REASON_KEYS:     keysOf(DELAY_REASON_CODES),

  /* constants */
  AMC_REQUIRED_COMPANY_TYPES, NON_B2B_COMPANY_TYPES,
  SPENCO_MIN_TOTAL, SPENCO_MAX_TOTAL, SPENCO_MAX_PER_DIMENSION, SPENCO_SUB_GATES,
  INACTIVITY_ALERT_DAYS, OVERDUE_CONTACT_DAYS, FOLLOWUP_MAX_DAYS_AHEAD,
  WEEKLY_NOTE_DAYS, PROBABILITY_OVERRIDE_MAX_POINTS, NOTE_REQUIRED_FROM_STAGE_ORDER,
  DELIVERY_DATE_SLA_BUSINESS_DAYS, DELAY_NOTICE_MIN_HOURS,
  CSAT_ESCALATION_THRESHOLD, CSAT_MAX, CHECK_IN_DUE_DAYS,
  FEEDBACK_DISPATCH_DUE_DAYS, FEEDBACK_REMINDER_DAYS, FEEDBACK_COLLECTION_WINDOW_DAYS,
  CORRECTIVE_ACTION_SLA_BUSINESS_DAYS, ISSUE_SLA_HOURS,
  INSTALL_LEAD_TIME_TARGET_BUSINESS_DAYS,
  KPI_TARGETS, STATE_TO_ZONE,
  INDUSTRY_SEGMENT_HINTS,
  PIPELINE_VERSION, pipelineVersion,

  /* configurable rules — R-2 */
  DEFAULT_RULES, setActiveRules, getActiveRules, resolveStages,

  /* pure functions */
  getPath, isBlank, toDate, startOfDay, daysBetween,
  deriveZone, mapIndustryToSegment, isB2B, isIndustrial, hasDoc,
  spencoTotal, spencoQualified, spencoScored,
  stageDef, stageIndex, stageLabel, nextStage, canAdvance,
  evaluateTest, validateRequirements, validateStageEntry, findChecklist,
  hygieneIssues, serialize,
};
