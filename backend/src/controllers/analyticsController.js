'use strict';
const { WON_STAGE, LOST_STAGE, TERMINAL_SALES_STAGES } = require('../config/pipeline');
const Lead  = require('../models/Lead');
const Expo  = require('../models/Expo');
const { ok } = require('../utils/response');
const { scopeFilter } = require('../services/scopeService');
const { can } = require('../middleware/rbac');

/* ── GET /api/analytics/overview ────────────────────────────────── */

async function overview(req, res, next) {
  try {
    const baseMatch = scopeFilter(req.scope, 'owner');
    /* A leaderboard IS peer comparison, which doc 1 (IS-DIR-01) and doc 2 (SA-DIR-01)
       both restrict to the people above you — an executive must never see how they rank
       against the person at the next desk. `kpi.read_team` is exactly that right. */
    const showLeaderboard = can(req.user, 'kpi.read_team');

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
      Lead.countDocuments({ ...baseMatch, stage: { $nin: TERMINAL_SALES_STAGES } }),
      Lead.countDocuments({ ...baseMatch, stage: WON_STAGE }),
      Lead.countDocuments({ ...baseMatch, stage: LOST_STAGE }),

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
        { $match: { ...baseMatch, stage: { $in: ['engagement', 'negotiation', WON_STAGE] } } },
        { $group: { _id: '$stage', totalValue: { $sum: '$value' } } },
      ]),

      !showLeaderboard ? [] : Lead.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$owner', wonCount: { $sum: { $cond: [{ $eq: ['$stage', WON_STAGE] }, 1, 0] } }, totalValue: { $sum: '$value' }, leadCount: { $sum: 1 } } },
        { $sort: { wonCount: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
        { $unwind: '$agent' },
        { $project: { wonCount: 1, totalValue: 1, leadCount: 1, 'agent.name': 1, 'agent.initials': 1, 'agent.color': 1 } },
      ]),

      Lead.find(baseMatch)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('owner', 'name initials color')
        .lean(),
    ]);

    const pipeline    = stageBreakdown.reduce((s, d) => s + d.value, 0);
    const wonRevenue  = stageBreakdown.find(d => d._id === WON_STAGE)?.value || 0;
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
    const baseMatch = scopeFilter(req.scope, 'owner');
    /* A leaderboard IS peer comparison, which doc 1 (IS-DIR-01) and doc 2 (SA-DIR-01)
       both restrict to the people above you — an executive must never see how they rank
       against the person at the next desk. `kpi.read_team` is exactly that right. */
    const showLeaderboard = can(req.user, 'kpi.read_team');

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
          won:   { $sum: { $cond: [{ $eq: ['$stage', WON_STAGE] }, 1, 0] } },
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
        const won   = leads.filter(l => l.stage === WON_STAGE);
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
