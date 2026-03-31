'use strict';
const { validationResult } = require('express-validator');
const Agent = require('../models/Agent');
const Lead  = require('../models/Lead');
const User  = require('../models/User');
const { ok, created, notFound, unprocessable, paginated, badRequest } = require('../utils/response');

/* ── GET /api/agents ─────────────────────────────────────────────── */

async function listAgents(req, res, next) {
  try {
    const { status, territory, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status)    filter.status    = status;
    if (territory) filter.territory = new RegExp(territory, 'i');

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [agents, total] = await Promise.all([
      Agent.find(filter).sort({ name: 1 }).skip(skip).limit(parseInt(limit)).lean(),
      Agent.countDocuments(filter),
    ]);
    return paginated(res, agents, total, parseInt(page), parseInt(limit));
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/agents/:id ─────────────────────────────────────────── */

async function getAgent(req, res, next) {
  try {
    const agent = await Agent.findById(req.params.id).lean();
    if (!agent) return notFound(res, 'Agent not found');
    return ok(res, agent);
  } catch (err) {
    next(err);
  }
}

/* ── POST /api/agents ────────────────────────────────────────────── */

async function createAgent(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const agent = await Agent.create({ ...req.body, createdBy: req.user._id });
    return created(res, agent, 'Agent created');
  } catch (err) {
    next(err);
  }
}

/* ── PUT /api/agents/:id ─────────────────────────────────────────── */

async function updateAgent(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return unprocessable(res, 'Validation failed', errors.array());

    const agent = await Agent.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!agent) return notFound(res, 'Agent not found');
    return ok(res, agent, 'Agent updated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/agents/:id ─ soft deactivate ────────────────────── */

async function deleteAgent(req, res, next) {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) return notFound(res, 'Agent not found');

    agent.status = 'inactive';
    await agent.save();
    return ok(res, {}, 'Agent deactivated');
  } catch (err) {
    next(err);
  }
}

/* ── DELETE /api/agents/:id/hard ─ permanent removal ─────────────── */

async function hardDeleteAgent(req, res, next) {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) return notFound(res, 'Agent not found');

    /* Prevent deleting yourself */
    if (agent.userId && agent.userId.toString() === req.user._id.toString()) {
      return badRequest(res, 'You cannot delete your own account');
    }

    const agentId = agent._id;

    /* Nullify assignedAgent on all their leads (keeps lead history) */
    await Lead.updateMany({ assignedAgent: agentId }, { $set: { assignedAgent: null } });

    /* Delete linked User account if present */
    if (agent.userId) {
      await User.findByIdAndDelete(agent.userId);
    }

    /* Hard-delete the Agent record */
    await Agent.findByIdAndDelete(agentId);

    return ok(res, { leadCount: (await Lead.countDocuments({ assignedAgent: null })) }, 'Agent account permanently deleted');
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/agents/:id/stats ───────────────────────────────────── */

async function getAgentStats(req, res, next) {
  try {
    const agentId = req.params.id;
    const agent = await Agent.findById(agentId).lean();
    if (!agent) return notFound(res, 'Agent not found');

    const [leads, stageBreakdown] = await Promise.all([
      Lead.find({ assignedAgent: agentId }).lean(),
      Lead.aggregate([
        { $match: { assignedAgent: agent._id } },
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
    ]);

    const totalValue  = leads.reduce((s, l) => s + l.value, 0);
    const wonLeads    = leads.filter(l => l.stage === 'won');
    const activeLeads = leads.filter(l => !['won', 'lost'].includes(l.stage));
    const convRate    = leads.length ? Math.round((wonLeads.length / leads.length) * 100) : 0;

    return ok(res, {
      agent,
      summary: {
        totalLeads:   leads.length,
        activeLeads:  activeLeads.length,
        wonLeads:     wonLeads.length,
        totalValue,
        wonValue:     wonLeads.reduce((s, l) => s + l.value, 0),
        conversionRate: convRate,
        targetAchievement: agent.target ? Math.round((wonLeads.reduce((s,l)=>s+l.value,0) / agent.target) * 100) : 0,
      },
      stageBreakdown,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAgents, getAgent, createAgent, updateAgent, deleteAgent, hardDeleteAgent, getAgentStats };
