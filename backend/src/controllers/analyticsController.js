'use strict';
const Lead  = require('../models/Lead');
const Agent = require('../models/Agent');
const Expo  = require('../models/Expo');
const { ok } = require('../utils/response');

/* ── GET /api/analytics/overview ────────────────────────────────── */

async function overview(req, res, next) {
  try {
    const agentScope = req.agentScope;
    const baseMatch  = agentScope ? { assignedAgent: agentScope } : {};

    const [
      totalLeads,
      activeLeads,
      wonLeads,
      lostLeads,
      stageBreakdown,
      sourceBreakdown,
      valueByStage,
      topAgents,
      recentLeads,
    ] = await Promise.all([
      Lead.countDocuments(baseMatch),
      Lead.countDocuments({ ...baseMatch, stage: { $nin: ['won', 'lost'] } }),
      Lead.countDocuments({ ...baseMatch, stage: 'won' }),
      Lead.countDocuments({ ...baseMatch, stage: 'lost' }),

      Lead.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
        { $sort: { count: -1 } },
      ]),

      Lead.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Lead.aggregate([
        { $match: { ...baseMatch, stage: { $in: ['proposal', 'negotiation', 'won'] } } },
        { $group: { _id: '$stage', totalValue: { $sum: '$value' } } },
      ]),

      agentScope ? [] : Lead.aggregate([
        { $group: { _id: '$assignedAgent', wonCount: { $sum: { $cond: [{ $eq: ['$stage', 'won'] }, 1, 0] } }, totalValue: { $sum: '$value' }, leadCount: { $sum: 1 } } },
        { $sort: { wonCount: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'agents', localField: '_id', foreignField: '_id', as: 'agent' } },
        { $unwind: '$agent' },
        { $project: { wonCount: 1, totalValue: 1, leadCount: 1, 'agent.name': 1, 'agent.initials': 1, 'agent.color': 1 } },
      ]),

      Lead.find(baseMatch)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('assignedAgent', 'name initials color')
        .lean(),
    ]);

    const pipeline    = stageBreakdown.reduce((s, d) => s + d.value, 0);
    const wonRevenue  = stageBreakdown.find(d => d._id === 'won')?.value || 0;
    const convRate    = totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0;

    return ok(res, {
      kpi: { totalLeads, activeLeads, wonLeads, lostLeads, pipeline, wonRevenue, conversionRate: convRate },
      stageBreakdown,
      sourceBreakdown,
      valueByStage,
      topAgents,
      recentLeads,
    });
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/analytics/trends ───────────────────────────────────── */

async function trends(req, res, next) {
  try {
    const agentScope = req.agentScope;
    const baseMatch  = agentScope ? { assignedAgent: agentScope } : {};

    /* Leads created per month (last 6 months) */
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthly = await Lead.aggregate([
      { $match: { ...baseMatch, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
          value: { $sum: '$value' },
          won:   { $sum: { $cond: [{ $eq: ['$stage', 'won'] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    /* Score distribution */
    const scoreDist = await Lead.aggregate([
      { $match: baseMatch },
      {
        $bucket: {
          groupBy: '$score',
          boundaries: [0, 21, 41, 61, 81, 101],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
    ]);

    return ok(res, { monthly, scoreDist });
  } catch (err) {
    next(err);
  }
}

/* ── GET /api/analytics/expos ────────────────────────────────────── */

async function expoStats(req, res, next) {
  try {
    const expos = await Expo.find({}).lean();
    const stats = await Promise.all(
      expos.map(async expo => {
        const leads = await Lead.find({ expo: expo._id }).lean();
        const won   = leads.filter(l => l.stage === 'won');
        return {
          ...expo,
          leadCount: leads.length,
          wonCount:  won.length,
          wonValue:  won.reduce((s, l) => s + l.value, 0),
          roiPercent: expo.targetLeads ? Math.round((leads.length / expo.targetLeads) * 100) : 0,
        };
      })
    );
    return ok(res, stats);
  } catch (err) {
    next(err);
  }
}

module.exports = { overview, trends, expoStats };
