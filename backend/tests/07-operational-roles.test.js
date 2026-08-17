'use strict';
/**
 * Operational roles — R-4.
 *
 * The Business Process Framework introduces seven roles beyond the original
 * five. `config/permissions.js` grants them rights, but until the `User.role`
 * enum was widened none of them could be persisted, so those grants applied to
 * accounts that could not exist.
 *
 * See docs/requirements/04-roles-and-permissions.md.
 */
const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../src/app');
const User     = require('../src/models/User');
const {
  ALL_ROLES, REGISTERABLE_ROLES, OPERATIONAL_ROLES,
  ROLE_PERMISSIONS, permissionsFor, roleHasAny, rolesWith,
} = require('../src/config/permissions');
const { ROLE_LEVEL } = require('../src/middleware/rbac');

const { connect, disconnect, clearCollections } = require('./helpers/db');
const { tok } = require('./helpers/testUtils');

let superToken;

beforeAll(async () => {
  await connect();
});
afterAll(async () => {
  await disconnect();
});
beforeEach(async () => {
  await clearCollections();
  const admin = await User.create({
    name: 'Super',
    email: 'super@iinvsys.test',
    password: 'TestPass@123',
    role: 'superadmin',
  });
  superToken = tok(admin._id);
});

describe('R-4 — every recognised role is persistable', () => {
  it.each(ALL_ROLES)('User.create accepts role "%s"', async (role) => {
    const user = await User.create({
      name: 'Role probe',
      email: `probe.${role}@iinvsys.test`,
      password: 'TestPass@123',
      role,
    });
    expect(user.role).toBe(role);
  });

  it('rejects a role that is not in ALL_ROLES', async () => {
    await expect(User.create({
      name: 'Bad role',
      email: 'bad@iinvsys.test',
      password: 'TestPass@123',
      role: 'chief_wizard',
    })).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('the schema enum and ALL_ROLES cannot drift apart', () => {
    expect(User.schema.path('role').enumValues.sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe('R-4 — POST /api/auth/register accepts the operational roles', () => {
  it.each(OPERATIONAL_ROLES)('a superadmin can register a "%s"', async (role) => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        name: `New ${role}`,
        email: `new.${role}@iinvsys.test`,
        password: 'TestPass@123',
        role,
      });

    expect(res.status).toBeLessThan(300);
    const created = await User.findOne({ email: `new.${role}@iinvsys.test` });
    expect(created).not.toBeNull();
    expect(created.role).toBe(role);
  });

  it('refuses to create a referrer — that path generates scoped credentials', async () => {
    expect(REGISTERABLE_ROLES).not.toContain('referrer');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        name: 'Sneaky referrer',
        email: 'sneaky@iinvsys.test',
        password: 'TestPass@123',
        role: 'referrer',
      });

    expect([400, 422]).toContain(res.status);
    expect(await User.findOne({ email: 'sneaky@iinvsys.test' })).toBeNull();
  });
});

describe('R-4 — the permission tables agree with the role list', () => {
  it('every role in ALL_ROLES has a ROLE_PERMISSIONS entry', () => {
    for (const role of ALL_ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('ROLE_PERMISSIONS declares no role outside ALL_ROLES', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ALL_ROLES].sort());
  });

  it('every role in ALL_ROLES has a ROLE_LEVEL entry', () => {
    for (const role of ALL_ROLES) {
      expect(typeof ROLE_LEVEL[role]).toBe('number');
    }
  });

  it('referrer and readonly hold no permissions', () => {
    expect(permissionsFor('referrer')).toEqual([]);
    expect(permissionsFor('readonly')).toEqual([]);
  });

  it('roleHasAny is false for a role holding none of the listed permissions', () => {
    expect(roleHasAny('warehouse', ['lead.read', 'lead.write'])).toBe(false);
    expect(roleHasAny('warehouse', ['workorder.read'])).toBe(true);
  });

  it('rolesWith resolves notification recipients by permission, not role name', () => {
    const readers = rolesWith('workorder.read');
    expect(readers).toContain('delivery_manager');
    expect(readers).not.toContain('referrer');
  });
});
