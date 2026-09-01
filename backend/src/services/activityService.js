'use strict';

const Activity = require('../models/Activity');
const Task     = require('../models/Task');

/**
 * activityService — logging an interaction, and the compliance figures derived from the
 * log rather than stored on it.
 */

/* Doc 2 SA-EX-04: "Daily minimum: at least 5 activities logged per working day." */
const DAILY_ACTIVITY_TARGET = 5;
/* Doc 1 IS-DIR-01: the Last Activity cell turns orange at 24h and red at 48h. */
const ACTIVITY_WARN_HOURS = 24;
const ACTIVITY_ALERT_HOURS = 48;

/**
 * Log one activity, creating the follow-up task in the same operation.
 *
 * Doc 1 IS-EX-03 note 2: "When the exec selects 'Next Task' ... the system auto-creates
 * a task with a due date. No manual task creation needed — every activity automatically
 * seeds the next action." Doing it in the caller instead would mean every one of the
 * five screens that logs an activity has to remember.
 */
async function logActivity(input, actor) {
  const activity = await Activity.create({
    customer: input.customer,
    deal: input.deal || null,
    ticket: input.ticket || null,
    type: input.type,
    direction: input.direction || 'outbound',
    occurredAt: input.occurredAt || new Date(),
    durationMinutes: input.durationMinutes ?? null,
    outcome: input.outcome || '',
    summary: input.summary,
    contact: input.contact || {},
    by: actor._id,
    bantUpdate: input.bantUpdate || 'none',
    stageUpdate: input.stageUpdate || '',
    nextAction: {
      label: input.nextAction?.label || '',
      dueAt: input.nextAction?.dueAt || null,
    },
  });

  /* Keep the deal's hygiene anchor current. config/pipeline.js computes the C-5
     "one note per week" rule from the lead document alone, so if this is skipped a deal
     with daily calls logged against it still reports stale notes. */
  if (activity.deal) {
    const Lead = require('../models/Lead');
    await Lead.updateOne(
      { _id: activity.deal },
      { $set: { lastActivityAt: activity.occurredAt, lastContact: activity.occurredAt } },
    );
  }

  let task = null;
  if (activity.nextAction.label) {
    task = await Task.create({
      owner: actor._id,
      customer: activity.customer,
      deal: activity.deal,
      activity: activity._id,
      title: activity.nextAction.label,
      type: input.nextAction?.type || 'other',
      /* A next action with no date is a next action nobody does. Default to tomorrow
         rather than refusing the whole activity — the log is the valuable part. */
      dueAt: activity.nextAction.dueAt || tomorrow(),
      source: 'activity_next_action',
      createdBy: actor._id,
    });
    activity.createdTask = task._id;
    await activity.save();
  }

  return { activity, task };
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

/** When each of the given users last logged anything, plus the doc 1 severity band. */
async function lastActivityFor(userIds) {
  const rows = await Activity.aggregate([
    { $match: { by: { $in: userIds } } },
    { $group: { _id: '$by', lastAt: { $max: '$occurredAt' } } },
  ]);

  const now = Date.now();
  const byUser = new Map(rows.map((r) => [String(r._id), r.lastAt]));
  return userIds.map((id) => {
    const lastAt = byUser.get(String(id)) || null;
    const hours = lastAt ? (now - new Date(lastAt).getTime()) / 36e5 : Infinity;
    let severity = 'ok';
    if (hours >= ACTIVITY_ALERT_HOURS) severity = 'alert';
    else if (hours >= ACTIVITY_WARN_HOURS) severity = 'warn';
    return { user: id, lastAt, hoursSince: lastAt ? Math.round(hours) : null, severity };
  });
}

/** How many activities a user logged on a given day — the 5/day counter. */
async function dailyCount(userId, date = new Date()) {
  const from = new Date(date); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return Activity.countDocuments({ by: userId, occurredAt: { $gte: from, $lt: to } });
}

module.exports = {
  logActivity, lastActivityFor, dailyCount,
  DAILY_ACTIVITY_TARGET, ACTIVITY_WARN_HOURS, ACTIVITY_ALERT_HOURS,
};
