'use strict';
/**
 * The V3 role taxonomy — that every role the matrix grants rights to can actually exist,
 * and that the three places a role is named cannot drift apart.
 *
 * This replaces 07-operational-roles.test.js, whose subject — seven "operational" roles
 * bolted onto a five-role ladder — no longer exists. The failure it was written for is
 * still worth pinning: `config/permissions.js` granted rights to roles the `User.role`
 * enum could not persist, so the grants applied to accounts nobody could create.
 *
 * See docs/requirements/04-roles-and-permissions.md.
 */
const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../src/app');
const User     = require('../src/models/User');
const {
  ALL_ROLES, V3_ROLES, REGISTERABLE_ROLES,
  ROLE_PERMISSIONS, ROLE_SCOPE, permissionsFor, roleHasAny, rolesWith, scopeModeFor,
} = require('../src/config/permissions');

const { connect, disconnect, clearCollections } = require('./helpers/db');
const { tok } = require('./helpers/testUtils');

let superToken;

beforeAll(connect);
afterAll(disconnect);
beforeEach(async () => {
  await clearCollections();
  const admin = await User.create({
    name: 'Super', email: 'super@iinvsys.test', password: 'TestPass@123', role: 'superadmin',
  });
  superToken = tok(admin._id);
});

describe('every recognised role is persistable', () => {
  it.each(ALL_ROLES)('%s can be saved on a User', async (role) => {
    const u = await User.create({
      name: role, email: `${role}@persist.test`, password: 'TestPass@123', role,
    });
    expect(u.role).toBe(role);
  });

  it('rejects a role that is not in ALL_ROLES', async () => {
    await expect(User.create({
      name: 'Nope', email: 'nope@persist.test', password: 'TestPass@123', role: 'wizard',
    })).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('keeps the schema enum and ALL_ROLES from drifting apart', () => {
    expect(User.schema.path('role').enumValues.sort()).toEqual([...ALL_ROLES].sort());
  });

  it('retires the v2 taxonomy outright', () => {
    /* Greenfield, per the cutover decision: a legacy role value is a validation error,
       never a silent upgrade to something that looks similar. */
    for (const gone of ['manager', 'agent', 'readonly', 'finance', 'delivery_manager',
      'warehouse', 'logistics', 'installation_manager', 'technician', 'cs_executive']) {
      expect(ALL_ROLES).not.toContain(gone);
    }
  });
});

describe('POST /api/auth/register accepts every V3 role', () => {
  it.each(V3_ROLES)('creates a %s', async (role) => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: role, email: `${role}@register.test`, password: 'TestPass@123', role });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe(role);
  });

  it('refuses to create a referrer — that path generates scoped credentials', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: 'R', email: 'r@register.test', password: 'TestPass@123', role: 'referrer' });

    /* 422 from the route validator, 400 if it ever reaches the controller — both are
       a refusal, and pinning the exact one would make this a test of which layer
       happens to run first. */
    expect([400, 422]).toContain(res.status);
    expect(REGISTERABLE_ROLES).not.toContain('referrer');
  });
});

describe('the tables agree with the role list', () => {
  it('every role in ALL_ROLES has a ROLE_PERMISSIONS entry', () => {
    for (const role of ALL_ROLES) expect(ROLE_PERMISSIONS[role]).toBeDefined();
  });

  it('ROLE_PERMISSIONS declares no role outside ALL_ROLES', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) expect(ALL_ROLES).toContain(role);
  });

  it('every role in ALL_ROLES has a ROLE_SCOPE entry', () => {
    /* A missing entry falls back to 'own', which is safe but silent. Requiring the entry
       makes adding a role a decision about visibility, not an accident. */
    for (const role of ALL_ROLES) expect(ROLE_SCOPE[role]).toBeDefined();
    for (const role of ALL_ROLES) expect(['own', 'team', 'all']).toContain(scopeModeFor(role));
  });

  it('referrer holds no internal permission', () => {
    expect(permissionsFor('referrer')).toEqual([]);
  });

  it('roleHasAny is false for a role holding none of the listed permissions', () => {
    expect(roleHasAny('production_engineer', ['lead.write', 'lead.gate_override'])).toBe(false);
    expect(roleHasAny('production_engineer', ['workorder.advance'])).toBe(true);
  });

  it('rolesWith resolves notification recipients by permission, not role name', () => {
    const dispatchers = rolesWith('workorder.dispatch');
    expect(dispatchers).toContain('production_head');
    expect(dispatchers).not.toContain('production_engineer');   // doc 3: no self-dispatch
    expect(dispatchers).not.toContain('referrer');
  });
});

describe('the finance-blind roles', () => {
  /* Doc 3: "not sent to the engineer's session at all". Doc 4: CS Agents "cannot see
     AMC contract values". These are requirements, not defaults. */
  it.each(['production_engineer', 'field_engineer', 'cs_agent'])('%s holds no finance.read', (role) => {
    expect(permissionsFor(role)).not.toContain('finance.read');
  });

  it.each(['sales_director', 'sales_manager', 'production_head', 'install_head'])(
    '%s holds finance.read', (role) => {
      expect(permissionsFor(role)).toContain('finance.read');
    });
});
