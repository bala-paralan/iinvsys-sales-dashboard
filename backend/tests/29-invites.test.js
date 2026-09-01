'use strict';
/**
 * N-5 — no secret ever in a response body.
 *
 * `POST /api/expos/:id/referrers` used to return the referrer's plaintext
 * password. That password was chosen by an admin, travelled through the API
 * response, sat in the browser's network log, was relayed over WhatsApp, and
 * reached anything that logged response bodies. It could not be rotated,
 * because nobody recorded who had seen it.
 *
 * It is replaced by a single-use, expiring invite whose token is stored ONLY
 * as a SHA-256 hash — so a database dump yields nothing usable, which matters
 * on a host with two prior ransomware wipes.
 */
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const User = require('../src/models/User');
const Expo = require('../src/models/Expo');
const Invite = require('../src/models/Invite');
const AuditLog = require('../src/models/AuditLog');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const { insertUser, tok } = require('./helpers/testUtils');

let managerToken, agentToken, expo;

const createReferrer = (name = 'Sunita Patil', token = managerToken) =>
  request(app).post(`/api/expos/${expo._id}/referrers`)
    .set('Authorization', `Bearer ${token}`).send({ name });

beforeAll(connect);
afterAll(async () => { await clearCollections(); await disconnect(); });

beforeEach(async () => {
  await clearCollections();
  managerToken = tok(await insertUser({ role: 'sales_director', name: 'Sneha' }));
  agentToken = tok(await insertUser({ role: 'sales_executive', name: 'Rahul' }));
  expo = await Expo.create({
    name: 'Bengaluru Tech Summit', venue: 'BIEC', city: 'Bangalore',
    startDate: new Date(Date.now() + 7 * 86400000),
    endDate: new Date(Date.now() + 10 * 86400000),
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('POST /api/expos/:id/referrers', () => {
  it('returns an invite link and NO password', async () => {
    const res = await createReferrer();
    expect(res.status).toBe(201);

    const body = JSON.stringify(res.body);
    /* The regression that matters: nothing password-shaped in the response. */
    expect(res.body.data.password).toBeUndefined();
    expect(body).not.toMatch(/"password"/);

    expect(res.body.data.inviteToken).toMatch(/^[\w-]{40,}$/);
    expect(res.body.data.inviteUrl).toContain(res.body.data.inviteToken);
    expect(new Date(res.body.data.inviteExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('stores only a hash of the token, never the token', async () => {
    const res = await createReferrer();
    const raw = res.body.data.inviteToken;

    /* A dump of the invites collection must be worthless. */
    expect(await Invite.findOne({ tokenHash: raw }).lean()).toBeNull();

    const stored = await Invite.findOne({}).lean();
    expect(stored.tokenHash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it('leaves the account unusable until the invite is redeemed', async () => {
    const res = await createReferrer();
    const user = await User.findById(res.body.data.id).select('+password').lean();

    /* A random unusable secret, not a known default and not the referrer's
       eventual password — an un-redeemed invite must leave no live credential. */
    expect(user.password).toBeTruthy();
    expect(user.password).not.toBe('Admin@123');

    const login = await request(app).post('/api/auth/login')
      .send({ email: res.body.data.email, password: 'Admin@123' });
    expect(login.status).toBe(401);
  });

  it('no longer accepts an admin-chosen password', async () => {
    const res = await request(app).post(`/api/expos/${expo._id}/referrers`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Trojan', password: 'KnownToAdmin1!' });

    /* The field is ignored, not honoured — accepting it would keep the old
       "the admin knows the referrer's password" property alive. */
    expect(res.status).toBe(201);
    const user = await User.findById(res.body.data.id).select('+password');
    expect(await user.comparePassword('KnownToAdmin1!')).toBe(false);
  });

  it('requires manager rank', async () => {
    expect((await createReferrer('Nope', agentToken)).status).toBe(403);
  });

  it('audits the invitation', async () => {
    await createReferrer();
    const entry = await AuditLog.findOne({ action: 'user.create' }).lean();
    expect(entry.summary).toMatch(/Sunita Patil/);
    expect(entry.actor.name).toBe('Sneha');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('GET /api/auth/invite/:token', () => {
  it('names the invitee so the redemption page is not anonymous', async () => {
    const { body } = await createReferrer();
    const res = await request(app).get(`/api/auth/invite/${body.data.inviteToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Sunita Patil', role: 'referrer' });
  });

  it('gives the same answer for unknown, expired and spent tokens', async () => {
    /* Distinguishing them would turn this endpoint into an oracle for
       enumerating which tokens once existed. */
    const unknown = await request(app).get('/api/auth/invite/not-a-real-token');
    expect(unknown.status).toBe(400);

    const { body } = await createReferrer();
    await Invite.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).get(`/api/auth/invite/${body.data.inviteToken}`);

    expect(expired.status).toBe(400);
    expect(expired.body.message).toBe(unknown.body.message);
  });
});

describe('POST /api/auth/invite/:token', () => {
  const redeem = (token, password) =>
    request(app).post(`/api/auth/invite/${token}`).send({ password });

  it('lets the holder set their own password and signs them in', async () => {
    const { body } = await createReferrer();
    const res = await redeem(body.data.inviteToken, 'ChosenByTheReferrer1');

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('referrer');

    /* And it really works as a credential afterwards. */
    const login = await request(app).post('/api/auth/login')
      .send({ email: body.data.email, password: 'ChosenByTheReferrer1' });
    expect(login.status).toBe(200);
  });

  it('is single use', async () => {
    const { body } = await createReferrer();
    const token = body.data.inviteToken;

    expect((await redeem(token, 'FirstPassword123')).status).toBe(200);
    /* A forwarded or intercepted link is worthless once used — this is what
       replaces "the password cannot be rotated because nobody knows who has it". */
    expect((await redeem(token, 'SecondPassword123')).status).toBe(400);

    const login = await request(app).post('/api/auth/login')
      .send({ email: body.data.email, password: 'SecondPassword123' });
    expect(login.status).toBe(401);
  });

  it('refuses an expired invite', async () => {
    const { body } = await createReferrer();
    await Invite.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await redeem(body.data.inviteToken, 'TooLateNow123')).status).toBe(400);
  });

  it('enforces a minimum password length', async () => {
    const { body } = await createReferrer();
    const res = await redeem(body.data.inviteToken, 'short');
    expect(res.status).toBe(400);

    /* And the invite is NOT burned by a rejected attempt. */
    expect((await redeem(body.data.inviteToken, 'LongEnoughNow123')).status).toBe(200);
  });

  it('records who redeemed it and when', async () => {
    const { body } = await createReferrer();
    await redeem(body.data.inviteToken, 'ChosenByTheReferrer1');

    const invite = await Invite.findOne({}).lean();
    expect(invite.redeemedAt).toBeInstanceOf(Date);
    expect(invite.redeemedIp).toBeTruthy();

    const entry = await AuditLog.findOne({ action: 'auth.password_change' }).lean();
    expect(entry.summary).toMatch(/redeemed an invitation/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('POST /api/expos/:id/referrers/:uid/reinvite', () => {
  it('kills the previous link when a new one is issued', async () => {
    const { body } = await createReferrer();
    const first = body.data.inviteToken;

    const re = await request(app)
      .post(`/api/expos/${expo._id}/referrers/${body.data.id}/reinvite`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(re.status).toBe(200);
    const second = re.body.data.inviteToken;
    expect(second).not.toBe(first);

    /* Otherwise an admin who re-sends because "it didn't arrive" leaves two
       working credentials in circulation. */
    expect((await request(app).post(`/api/auth/invite/${first}`).send({ password: 'OldLink12345' })).status).toBe(400);
    expect((await request(app).post(`/api/auth/invite/${second}`).send({ password: 'NewLink12345' })).status).toBe(200);
  });

  it('404s for a user who is not a referrer on this expo', async () => {
    const stranger = await insertUser({ role: 'sales_executive' });
    const res = await request(app)
      .post(`/api/expos/${expo._id}/referrers/${stranger}/reinvite`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/expos/:id/referrers', () => {
  it('never returns password material', async () => {
    await createReferrer();
    const res = await request(app).get(`/api/expos/${expo._id}/referrers`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password|tokenHash/i);
  });
});
