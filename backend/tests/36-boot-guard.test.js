'use strict';
/**
 * The application must refuse to start if any authenticated route lacks an
 * authorisation guard.
 *
 * This is the structural replacement for the deleted `ROLE_LEVEL` ladder. The ladder had
 * exactly one real virtue — a route that forgot its guard still refused outsiders by
 * accident, because `requireMinRole` was on nearly everything. Without this check,
 * deny-by-default becomes a matter of everyone remembering, and the history in this
 * repository is that they did not.
 */
const express = require('express');
const app = require('../src/app');
const { authenticate } = require('../src/middleware/auth');
const { requirePermission, requireRole } = require('../src/middleware/rbac');

const { assertRoutesGuarded } = app;

describe('boot-time route guard', () => {
  it('accepts the real router — every authenticated route is guarded', () => {
    expect(() => assertRoutesGuarded(require('../src/routes'))).not.toThrow();
  });

  it('throws when an authenticated route has no guard', () => {
    const child = express.Router();
    child.get('/oops', authenticate, (req, res) => res.json({}));
    const parent = express.Router();
    parent.use('/danger', child);

    expect(() => assertRoutesGuarded(parent)).toThrow(/GET \/danger\/oops/);
  });

  it('accepts a route guarded by requirePermission', () => {
    const r = express.Router();
    r.get('/fine', authenticate, requirePermission('lead.read'), (req, res) => res.json({}));
    expect(() => assertRoutesGuarded(r)).not.toThrow();
  });

  it('accepts a route guarded by requireRole', () => {
    const r = express.Router();
    r.post('/admin', authenticate, requireRole('superadmin'), (req, res) => res.json({}));
    expect(() => assertRoutesGuarded(r)).not.toThrow();
  });

  it('ignores unauthenticated routes', () => {
    const r = express.Router();
    r.get('/public', (req, res) => res.json({}));
    expect(() => assertRoutesGuarded(r)).not.toThrow();
  });

  it('marks the guards so a composite guard written inline still counts', () => {
    expect(requirePermission('lead.read').isGuard).toBe(true);
    expect(requireRole('superadmin').isGuard).toBe(true);
  });
});
