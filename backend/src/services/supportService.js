'use strict';

const Ticket = require('../models/Ticket');
const Contract = require('../models/Contract');
const Lead = require('../models/Lead');
const User = require('../models/User');
const pipeline = require('../config/pipeline');
const salesEntry = require('./salesEntryService');
const notify = require('./notificationService');
const audit = require('./auditService');

/**
 * supportService — Installation & Customer Support. ERP Bible V3 document 4.
 *
 * Two things here close loops the rest of the system opened:
 *
 *   createContractForSignOff()  the Install Head approving a sign-off is what brings an
 *                               AMC into existence (IC-HD-04)
 *   pushRenewalToSales()        an expiring AMC becomes a Suspect-stage deal, which is
 *                               where doc 4's cycle rejoins doc 2's
 */

const YEAR = () => new Date().getFullYear();
const nextRef = (prefix) =>
  `${prefix}-${YEAR()}-${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`;

const nextTicketRef = () => nextRef('CS');
const nextContractRef = () => nextRef('AMC');

/* ── Tickets ─────────────────────────────────────────────────────────────── */

/**
 * Raise a ticket. The SLA is derived by the model from the priority.
 *
 * Assignment is explicit rather than round-robin: doc 4 shows the CS Manager assigning
 * and reassigning, and an allocation rule nobody asked for is a rule somebody has to
 * unpick later.
 */
async function createTicket(input, actor) {
  let ticket = null;
  for (let attempt = 0; attempt < 3 && !ticket; attempt += 1) {
    try {
      ticket = await Ticket.create({
        ref: nextTicketRef(),
        customer: input.customer,
        installationJob: input.installationJob || null,
        contract: input.contract || null,
        product: input.product || '',
        issueType: input.issueType || 'other',
        subject: input.subject,
        description: input.description || '',
        contact: input.contact || {},
        priority: input.priority || 'medium',
        assignedTo: input.assignedTo || null,
        createdBy: actor._id,
      });
    } catch (err) {
      if (err && err.code === 11000) continue;      // ref collision — mint another
      throw err;
    }
  }
  if (!ticket) throw new Error('could not allocate a unique ticket ref in 3 attempts');

  if (ticket.assignedTo) await notifyAssignee(ticket);
  return ticket;
}

async function notifyAssignee(ticket) {
  return notify.notifyUser(ticket.assignedTo, {
    event: 'install.issue_sla_breached',
    severity: ticket.priority === 'critical' ? 'critical' : 'warn',
    title: `${ticket.ref} assigned to you — ${ticket.priority}`,
    body: `${ticket.subject}. SLA ${ticket.slaHours}h, due ${
      ticket.slaDueAt ? ticket.slaDueAt.toISOString() : 'n/a'}.`,
    reason: 'It is assigned to you.',
    entityType: 'installation',
    entityId: ticket.installationJob || undefined,
  });
}

/**
 * Log work against a ticket, stamping the first response.
 *
 * `firstResponseAt` is set once and never moved — it is the number an SLA is actually
 * judged on, and one that drifts forward with every later note measures nothing.
 */
async function logTicketActivity(ticket, { type, summary, minutes }, actor) {
  ticket.activities.push({ type, summary, minutes: minutes ?? null, by: actor._id });
  if (!ticket.firstResponseAt) ticket.firstResponseAt = new Date();
  if (ticket.status === 'open') ticket.status = 'in_progress';
  await ticket.save();
  return ticket;
}

/** Resolve or close. A breach already recorded stays recorded. */
async function resolveTicket(ticket, { status, resolution }, actor) {
  if (status === 'resolved') {
    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    ticket.resolution = resolution || '';
  } else if (status === 'closed') {
    ticket.status = 'closed';
    ticket.closedAt = new Date();
    if (!ticket.resolvedAt) ticket.resolvedAt = new Date();
    if (resolution) ticket.resolution = resolution;
  }
  await ticket.save();

  await audit.record({
    action: 'record.update',
    entityType: 'installation',
    entityId: ticket.installationJob || ticket._id,
    summary: `${ticket.ref} ${status}`,
    meta: { ref: ticket.ref, status, slaBreached: ticket.slaBreached },
  });
  return ticket;
}

/* ── Sign-off → AMC (IC-HD-04) ───────────────────────────────────────────── */

/**
 * The Install Head approves the customer's sign-off, and the AMC comes into existence.
 *
 * Idempotent through `job.signOff.contract`: a retried approval adopts the contract it
 * already made rather than issuing a second one, the same guard both process handoffs use.
 */
async function createContractForSignOff(job, approver, { months, value } = {}) {
  if (job.signOff && job.signOff.contract) {
    const existing = await Contract.findById(job.signOff.contract);
    if (existing) return { contract: existing, created: false };
  }

  /* Resolve the account. Jobs created before the customer link existed carry none, and a
     Contract without a customer cannot be renewed or shown in Customer 360 — so fall back
     through the lead, then to matching the snapshot, rather than failing the sign-off. */
  let customerId = job.customer || null;
  if (!customerId && job.lead) {
    const lead = await Lead.findById(job.lead).select('customer').lean();
    customerId = lead ? lead.customer : null;
  }
  if (!customerId && job.customerSnapshot && job.customerSnapshot.company) {
    const customerService = require('./customerService');
    const { customer: resolved } = await customerService.findOrCreateCustomer({
      name: job.customerSnapshot.company,
      city: job.customerSnapshot.city,
      state: job.customerSnapshot.state,
    }, { interactive: false, actorId: approver._id });
    customerId = resolved._id;
  }
  if (!customerId) {
    throw Object.assign(
      new Error('This job has no customer account, so no AMC can be created against it'),
      { code: 'NO_CUSTOMER' },
    );
  }
  if (!job.customer) job.customer = customerId;

  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + (months || pipeline.CONTRACT_DEFAULT_MONTHS));

  let contract = null;
  for (let attempt = 0; attempt < 3 && !contract; attempt += 1) {
    try {
      contract = await Contract.create({
        ref: nextContractRef(),
        customer: customerId,
        installationJob: job._id,
        originDeal: job.lead || null,
        type: 'amc',
        product: job.customerSnapshot?.product || '',
        startsAt,
        expiresAt,
        value: value || 0,
        renewalValue: value || 0,
        createdBy: approver._id,
      });
    } catch (err) {
      if (err && err.code === 11000) continue;
      throw err;
    }
  }
  if (!contract) throw new Error('could not allocate a unique contract ref in 3 attempts');

  job.signOff.contract = contract._id;
  job.signOff.approvedAt = new Date();
  job.signOff.approvedBy = approver._id;
  await job.save();

  /* Doc 4: "CS Manager notified to onboard." Addressed by permission because onboarding is
     the CS function's job, not one named person's. */
  await notify.notifyByPermission('support.manage', {
    event: 'install.handover_complete',
    severity: 'info',
    title: `AMC ${contract.ref} created`,
    body: `${job.customerSnapshot?.company || 'Customer'} is now under AMC until ${
      expiresAt.toISOString().slice(0, 10)}.`,
    reason: 'You run customer support.',
    entityType: 'installation',
    entityId: job._id,
  }, { excludeUserId: approver._id });

  await audit.record({
    action: 'handoff.created',
    entityType: 'installation',
    entityId: job._id,
    summary: `${contract.ref} created from sign-off on ${job.jobNumber}`,
    meta: { contract: String(contract._id), expiresAt, months: months || pipeline.CONTRACT_DEFAULT_MONTHS },
  });

  return { contract, created: true };
}

/* ── Renewal → Sales (IC-CSM-04) ─────────────────────────────────────────── */

/**
 * Push an expiring contract back into SPENCO as a Suspect.
 *
 * Doc 4: "the system creates a new SPENCO deal at Suspect stage for the relevant Sales
 * Executive (the one who originally closed the deal)." That last clause is the reason
 * `originDeal` exists — assigning to whoever owns the account today would hand the
 * renewal to someone with no history of it.
 *
 * Goes through salesEntryService.mintSalesLead(), the one entry point to the pipeline, so
 * a renewal and a handoff produce the same shape of record.
 */
async function pushRenewalToSales(contract, actor) {
  if (contract.renewalLead) {
    const existing = await Lead.findById(contract.renewalLead);
    if (existing) return { lead: existing, created: false };
  }

  const origin = contract.originDeal ? await Lead.findById(contract.originDeal) : null;
  let assignee = origin && origin.owner ? origin.owner : null;

  if (!assignee) {
    /* No origin deal, or its owner has gone. Fall back to the account owner, then to any
       active Sales Executive — a renewal worth chasing should not be dropped because the
       history is incomplete. */
    const Customer = require('../models/Customer');
    const cust = contract.customer ? await Customer.findById(contract.customer).select('accountOwner').lean() : null;
    assignee = cust && cust.accountOwner ? cust.accountOwner : null;
  }
  if (!assignee) {
    const anyExec = await User.findOne({ role: 'sales_executive', isActive: true }).select('_id').lean();
    assignee = anyExec ? anyExec._id : null;
  }
  if (!assignee) {
    throw Object.assign(new Error('No Sales Executive to assign this renewal to'), { code: 'NO_ASSIGNEE' });
  }

  const { lead } = await salesEntry.mintSalesLead(origin, {
    stage: 'suspect',
    assignee,
    actor,
    reason: `is an AMC renewal (${contract.ref}, expires ${contract.expiresAt.toISOString().slice(0, 10)})`,
    seed: {
      customer: contract.customer,
      productPackage: contract.product || '',
      value: contract.renewalValue || 0,
      source: 'inbound_enquiry',
      /* mintSalesLead links originLead when one is passed; for a renewal with no origin
         deal the customer link is what ties it back. */
    },
  });

  contract.renewalLead = lead._id;
  contract.renewalPushedAt = new Date();
  contract.renewalPushedBy = actor._id;
  contract.status = 'expiring';
  await contract.save();

  return { lead, created: true };
}

/** Contracts inside the renewal window, for IC-CSM-04. */
async function renewalsDue(days = pipeline.CONTRACT_RENEWAL_WINDOW_DAYS) {
  const until = new Date(Date.now() + days * 86400000);
  return Contract.find({
    status: { $in: ['active', 'expiring'] },
    expiresAt: { $lte: until },
    renewalLead: null,
  }).populate('customer', 'name city').sort({ expiresAt: 1 }).lean();
}

module.exports = {
  createTicket, logTicketActivity, resolveTicket,
  createContractForSignOff, pushRenewalToSales, renewalsDue,
  nextTicketRef, nextContractRef,
};
