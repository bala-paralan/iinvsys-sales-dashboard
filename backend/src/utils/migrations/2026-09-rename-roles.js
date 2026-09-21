'use strict';

/**
 * 2026-09 — rename the Sales role keys to the SPENCO CRM brief's names.
 *
 *   is_head        → inside_sales_manager
 *   is_executive   → inside_sales_executive
 *   sales_manager  → area_sales_manager
 *
 * `User.role` is an enum, so an unmigrated account fails validation the next time it is
 * saved — a login updates `lastLogin`, so that is the first login after deploy. Run this
 * BEFORE the new API starts:
 *
 *     cd /opt/iinvsys/backend && node src/utils/migrations/2026-09-rename-roles.js
 *
 * Idempotent: a second run finds nothing to rename. Every rename is logged to the
 * append-only AuditLog as `user.role_change`, with no actor, so the history of every
 * affected account says when and why its role string changed.
 *
 * The Zonal Sales Manager tier is NOT created here — it is an org-chart decision (which
 * ASMs sit under which ZSM), made by the Director through Admin, not by a script.
 */

const mongoose = require('mongoose');

const RENAMES = {
  is_head:       'inside_sales_manager',
  is_executive:  'inside_sales_executive',
  sales_manager: 'area_sales_manager',
};

async function run({ log = console.log } = {}) {
  /* Raw collection access: the model's enum would refuse to even read the old values. */
  const users = mongoose.connection.collection('users');
  const audit = mongoose.connection.collection('auditlogs');
  const summary = {};

  for (const [from, to] of Object.entries(RENAMES)) {
    const affected = await users.find({ role: from }).project({ _id: 1, name: 1 }).toArray();
    if (affected.length === 0) { summary[from] = 0; continue; }

    const res = await users.updateMany({ role: from }, { $set: { role: to } });
    summary[from] = res.modifiedCount;

    const now = new Date();
    await audit.insertMany(affected.map((u) => ({
      action: 'user.role_change',
      entityType: 'user',
      entityId: u._id,
      actor: { user: null, name: 'migration:2026-09-rename-roles', role: 'system' },
      summary: `Role key renamed ${from} → ${to} for ${u.name || u._id}`,
      meta: { from, to },
      ip: '', userAgent: '',
      at: now,
    })));
    log(`${from} → ${to}: ${res.modifiedCount}`);
  }

  const remaining = await users.countDocuments({ role: { $in: Object.keys(RENAMES) } });
  return { summary, remaining };
}

module.exports = { run, RENAMES };

if (require.main === module) {
  require('dotenv').config();
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
  mongoose.connect(uri)
    .then(() => run())
    .then(({ summary, remaining }) => {
      console.log(JSON.stringify({ summary, remaining }));
      process.exit(remaining === 0 ? 0 : 2);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
