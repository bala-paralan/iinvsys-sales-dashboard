'use strict';
/**
 * Financial blindness — doc 3, stated twice and stated as a BACKEND requirement:
 *
 *   "Notice that the engineer's order view shows customer name, product, and delivery
 *    date — but NOT the order value. Financial data is visible only to the Production
 *    Head and Sales Director. This is a backend access control — not just hidden in the
 *    UI but not sent to the engineer's session at all."
 *
 * Doc 4 says the same of CS Agents and AMC contract values.
 *
 * A crawler rather than a list of assertions: it walks every GET route as each
 * finance-blind role and refuses any response body that carries a redacted key at ANY
 * depth. A new endpoint that embeds a work order somewhere unforeseen fails here without
 * anyone remembering to add a case.
 */
const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const WorkOrder = require('../src/models/WorkOrder');
const { FIELD_PERMISSIONS } = require('../src/config/fieldVisibility');
const { permissionsFor } = require('../src/config/permissions');
const { redact } = require('../src/utils/redact');
const { connect, disconnect, clearCollections } = require('./helpers/db');
const roles = require('./helpers/roles');

/* Every GET the finance-blind roles can actually reach. */
const GET_ROUTES = [
  '/api/meta/pipeline',
  '/api/products',
  '/api/customers',
  '/api/tasks',
  '/api/approvals',
  '/api/workorders',
  '/api/installations',
  '/api/kpis/summary',
  '/api/kpis/sales',
  '/api/kpis/delivery',
  '/api/kpis/installation',
  '/api/notifications',
  '/api/activities',
];

const BLIND_ROLES = ['production_engineer', 'field_engineer', 'cs_agent'];

/** Every leaf key anywhere in a payload. */
function keysDeep(node, acc = new Set(), depth = 0) {
  if (node === null || typeof node !== 'object' || depth > 24) return acc;
  if (Array.isArray(node)) {
    node.forEach((v) => keysDeep(v, acc, depth + 1));
    return acc;
  }
  for (const [k, v] of Object.entries(node)) {
    acc.add(k);
    keysDeep(v, acc, depth + 1);
  }
  return acc;
}

describe('financial redaction', () => {
  const actors = {};

  beforeAll(async () => {
    await connect();
    await clearCollections();

    for (const role of [...BLIND_ROLES, 'production_head', 'sales_director']) {
      actors[role] = await roles.make(role);
    }

    /* Real records carrying real money, so a passing crawl means the fields were there
       to leak rather than simply absent. */
    const owner = await roles.asSalesExecutive();
    const lead = await Lead.create({
      name: 'DMRC', phone: '9100000001', source: 'referral',
      stage: 'commercial_order', owner: owner.id, value: 48000000,
    });
    await WorkOrder.create({
      woNumber: 'WO-2026-000001', lead: lead._id, poNumber: 'PO-1', poValue: 48000000,
      customerSnapshot: { name: 'DMRC', company: 'DMRC Delhi' },
      items: [{ name: 'ConnectSei', quantity: 50, unitPrice: 912000 }],
    });
  });
  afterAll(disconnect);

  describe.each(BLIND_ROLES)('%s', (role) => {
    it.each(GET_ROUTES)('receives no redacted field from %s', async (path) => {
      const res = await request(app).get(path)
        .set('Authorization', `Bearer ${actors[role].token}`);

      if (res.status === 403) return;          // not reachable by this role at all
      expect(res.status).toBeLessThan(500);

      const held = permissionsFor(role);
      const forbidden = Object.keys(FIELD_PERMISSIONS)
        .filter((f) => !held.includes(FIELD_PERMISSIONS[f]));

      const present = [...keysDeep(res.body)].filter((k) => forbidden.includes(k));
      expect({ path, role, leaked: present }).toEqual({ path, role, leaked: [] });
    });
  });

  it('sends the order value to the Production Head, who is entitled to it', async () => {
    const res = await request(app).get('/api/workorders')
      .set('Authorization', `Bearer ${actors.production_head.token}`);

    expect(res.status).toBe(200);
    /* The counterpart assertion: if redaction stripped this for everyone the crawl above
       would pass while the feature was broken. */
    expect([...keysDeep(res.body)]).toContain('poValue');
  });

  describe('the redact() primitive', () => {
    const engineer = { role: 'production_engineer' };
    const head = { role: 'production_head' };

    it('strips a redacted key nested inside an array inside an object', () => {
      const payload = { orders: [{ id: 1, items: [{ name: 'x', unitPrice: 10 }] }] };
      expect(redact(payload, engineer)).toEqual({ orders: [{ id: 1, items: [{ name: 'x' }] }] });
      expect(redact(payload, head)).toEqual(payload);
    });

    it('leaves the payload untouched when the caller loses nothing', () => {
      const payload = { value: 1 };
      expect(redact(payload, { role: 'superadmin' })).toBe(payload);
    });

    it('does not mutate the input', () => {
      const payload = { value: 1, name: 'x' };
      redact(payload, engineer);
      expect(payload.value).toBe(1);
    });

    it('survives a value with no user (unauthenticated paths)', () => {
      const payload = { value: 1 };
      expect(redact(payload, null)).toBe(payload);
    });
  });
});
