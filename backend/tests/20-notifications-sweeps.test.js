'use strict';
/**
 * Notifications (R-8) and the nightly sales sweeps (S-7, C-5).
 *
 * Two properties matter most here:
 *
 *   1. Recipients resolve by PERMISSION, not role name — so a change to the
 *      role mapping cannot silently stop an alert reaching anyone.
 *   2. A nightly sweep is idempotent. Without the cooldown, a manager is told
 *      about the same dormant lead every morning until someone touches it,
 *      and the feed becomes noise people scroll past — which costs more than
 *      sending nothing, because it buries the alerts that DO matter.
 */
const request      = require('supertest');
const app          = require('../src/app');
const Lead         = require('../src/models/Lead');
const User         = require('../src/models/User');
const Notification = require('../src/models/Notification');
const notify       = require('../src/services/notificationService');
const sweeps       = require('../src/utils/jobs/salesHygiene');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

let managerId, agentId, managerToken, agentToken;

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  managerId = await insertUser({ role: 'sales_director', name: 'Sneha' });
  agentId   = await insertUser({ role: 'sales_executive',   name: 'Rahul' });
  managerToken = tok(managerId);
  agentToken   = tok(agentId);
});

describe('recipients resolve by permission, not by role name', () => {
  it('finds every role holding the permission', async () => {
    await insertUser({ role: 'production_head', name: 'Dev' });
    const users = await notify.recipientsFor(['workorder.accept']);
    const roles = users.map((u) => u.role);

    expect(roles).toContain('production_head');
    /* NOT the Sales Director: doc 3 PD-HD-01 makes accepting a production order the
       Production Head's, and the Director holds `workorder.read` alone. */
    expect(roles).not.toContain('sales_director');
    expect(roles).not.toContain('sales_executive');
  });

  it('excludes deactivated accounts', async () => {
    await User.updateOne({ _id: managerId }, { isActive: false });
    const users = await notify.recipientsFor(['lead.gate_override']);
    expect(users.map((u) => String(u._id))).not.toContain(String(managerId));
  });

  it('returns nobody for a permission no role holds', async () => {
    expect(await notify.recipientsFor(['nonexistent.permission'])).toEqual([]);
  });

  it('does not tell someone about their own action', async () => {
    await notify.notifyByPermission('lead.gate_override', {
      event: 'lead.gate_overridden', title: 'Gate overridden',
    }, { excludeUserId: managerId });

    expect(await Notification.countDocuments({ user: managerId })).toBe(0);
  });

  it('records WHY the person received it', async () => {
    await notify.notifyByPermission('lead.gate_override', {
      event: 'lead.gate_overridden', title: 'Gate overridden',
    });
    const n = await Notification.findOne({ user: managerId }).lean();
    expect(n.reason).toContain('lead.gate_override');
  });
});

describe('notifyOnce suppresses repeats inside the cooldown', () => {
  const entry = (entityId) => ({
    event: 'lead.inactive', title: 'Stale', entityType: 'lead', entityId,
  });

  it('sends the first time', async () => {
    const id = (await Lead.create({ name: 'A', phone: '9000000001', source: 'cold_call' }))._id;
    const r = await notify.notifyOnce([{ _id: managerId }], entry(id));
    expect(r.sent).toHaveLength(1);
    expect(r.suppressed).toBe(0);
  });

  it('suppresses an immediate repeat for the same user AND entity', async () => {
    const id = (await Lead.create({ name: 'A', phone: '9000000002', source: 'cold_call' }))._id;
    await notify.notifyOnce([{ _id: managerId }], entry(id));
    const second = await notify.notifyOnce([{ _id: managerId }], entry(id));

    expect(second.sent).toHaveLength(0);
    expect(second.suppressed).toBe(1);
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('still notifies about a DIFFERENT record', async () => {
    const a = (await Lead.create({ name: 'A', phone: '9000000003', source: 'cold_call' }))._id;
    const b = (await Lead.create({ name: 'B', phone: '9000000004', source: 'cold_call' }))._id;

    await notify.notifyOnce([{ _id: managerId }], entry(a));
    const second = await notify.notifyOnce([{ _id: managerId }], entry(b));
    expect(second.sent).toHaveLength(1);
  });

  it('still notifies a DIFFERENT person about the same record', async () => {
    const id = (await Lead.create({ name: 'A', phone: '9000000005', source: 'cold_call' }))._id;
    await notify.notifyOnce([{ _id: managerId }], entry(id));
    const second = await notify.notifyOnce([{ _id: agentId }], entry(id));
    expect(second.sent).toHaveLength(1);
  });

  it('sends again once the cooldown has elapsed', async () => {
    const id = (await Lead.create({ name: 'A', phone: '9000000006', source: 'cold_call' }))._id;
    await notify.notifyOnce([{ _id: managerId }], entry(id));

    /* Age the first notification past the window. */
    await Notification.collection.updateMany({}, { $set: { createdAt: daysAgo(3) } });

    const second = await notify.notifyOnce([{ _id: managerId }], entry(id), 24);
    expect(second.sent).toHaveLength(1);
  });
});

describe('a delivery failure never breaks the caller', () => {
  it('returns an empty array rather than throwing', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await notify.notifyUsers([{ _id: managerId }], {
      event: 'not-a-real-event', title: 'Bad',
    });
    expect(res).toEqual([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('NOTIFICATION FAILED'));
    spy.mockRestore();
  });
});

describe('S-7 — the inactivity sweep', () => {
  const stale = (over = {}) => Lead.create({
    name: 'Dormant Deal', phone: '9000000010', source: 'cold_call',
    stage: 'engagement', lastContact: daysAgo(45), ...over,
  });

  it('flags a lead with no activity beyond the threshold', async () => {
    await stale();
    const r = await sweeps.salesInactivity();
    expect(r.flagged).toBe(1);
    expect(r.notified).toBeGreaterThan(0);

    const n = await Notification.findOne({ event: 'lead.inactive' }).lean();
    expect(n.severity).toBe('critical');
    expect(n.title).toContain('Dormant Deal');
    expect(n.meta.days).toBeGreaterThanOrEqual(45);
  });

  it('ignores a recently contacted lead', async () => {
    await stale({ lastContact: daysAgo(3) });
    expect((await sweeps.salesInactivity()).flagged).toBe(0);
  });

  it('ignores closed deals — a won deal is nobody’s worklist', async () => {
    await stale({ stage: 'commercial_order' });
    await stale({ phone: '9000000011', stage: 'order_lost' });
    expect((await sweeps.salesInactivity()).flagged).toBe(0);
  });

  it('falls back to stageEnteredAt when a lead was never contacted', async () => {
    await stale({ lastContact: null, stageEnteredAt: daysAgo(60) });
    expect((await sweeps.salesInactivity()).flagged).toBe(1);
  });

  it('running it two nights running does not notify twice', async () => {
    await stale();
    const first = await sweeps.salesInactivity();
    const second = await sweeps.salesInactivity();

    expect(first.notified).toBeGreaterThan(0);
    expect(second.notified).toBe(0);
    expect(second.suppressed).toBeGreaterThan(0);
  });

  it('addresses managers, not the agent who owns the lead', async () => {
    await stale();
    await sweeps.salesInactivity();

    expect(await Notification.countDocuments({ user: managerId })).toBe(1);
    expect(await Notification.countDocuments({ user: agentId })).toBe(0);
  });
});

describe('the hygiene re-evaluation sweep', () => {
  it('catches a close date that lapsed with no edit to the record', async () => {
    const lead = await Lead.create({
      name: 'Lapsing', phone: '9000000020', source: 'cold_call', stage: 'engagement',
      companyType: 'homeowner', jobTitle: 'Owner', state: 'Maharashtra',
      nextAction: 'call', expectedCloseDate: new Date(Date.now() + 86400000),
      nextFollowUpDate: new Date(Date.now() + 86400000),
    });
    expect(lead.reviewIssues).not.toContain('close_date_expired');

    /* Nobody touches the record; only the calendar moves. This is exactly the
       case a write-triggered hook can never catch. */
    const r = await sweeps.reevaluateHygiene(new Date(Date.now() + 5 * 86400000));
    expect(r.changed).toBe(1);

    const after = await Lead.findById(lead._id).lean();
    expect(after.reviewIssues).toContain('close_date_expired');
    expect(after.needsReview).toBe(true);
  });

  it('writes nothing when nothing changed', async () => {
    await Lead.create({ name: 'Steady', phone: '9000000021', source: 'cold_call' });
    await sweeps.reevaluateHygiene();
    const second = await sweeps.reevaluateHygiene();
    expect(second.changed).toBe(0);
  });
});

describe('GET /api/notifications', () => {
  beforeEach(async () => {
    await notify.notifyUsers([{ _id: managerId }], { event: 'lead.inactive', title: 'One', severity: 'critical' });
    await notify.notifyUsers([{ _id: managerId }], { event: 'lead.notes_stale', title: 'Two', severity: 'warn' });
    await notify.notifyUsers([{ _id: agentId }],   { event: 'lead.inactive', title: 'Theirs' });
  });

  it('returns only the caller’s own notifications', async () => {
    const res = await request(app).get('/api/notifications')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toHaveLength(2);
    expect(res.body.data.notifications.map((n) => n.title)).not.toContain('Theirs');
  });

  it('cannot be pointed at someone else’s feed via the query string', async () => {
    const res = await request(app).get(`/api/notifications?user=${agentId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.body.data.notifications).toHaveLength(2); // still only their own
  });

  it('reports an unread count', async () => {
    const res = await request(app).get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.body.data.unread).toBe(2);
  });

  it('filters to unread and by severity', async () => {
    const crit = await request(app).get('/api/notifications?severity=critical')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(crit.body.data.notifications).toHaveLength(1);
  });

  it('marks one as read', async () => {
    const list = await request(app).get('/api/notifications')
      .set('Authorization', `Bearer ${managerToken}`);
    const id = list.body.data.notifications[0]._id;

    const res = await request(app).patch(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.readAt).not.toBeNull();

    const after = await request(app).get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(after.body.data.unread).toBe(1);
  });

  it('cannot mark someone else’s notification read — 404, not 403', async () => {
    const theirs = await Notification.findOne({ user: agentId }).lean();
    const res = await request(app).patch(`/api/notifications/${theirs._id}/read`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(404);
    expect((await Notification.findById(theirs._id)).readAt).toBeNull();
  });

  it('marks all read', async () => {
    await request(app).patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(await notify.unreadCount(managerId)).toBe(0);
    expect(await notify.unreadCount(agentId)).toBe(1); // untouched
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });

  it('refuses a referrer — they hold no notification permission', async () => {
    const ref = tok(await insertUser({ role: 'referrer' }));
    expect((await request(app).get('/api/notifications').set('Authorization', `Bearer ${ref}`)).status).toBe(403);
  });
});
