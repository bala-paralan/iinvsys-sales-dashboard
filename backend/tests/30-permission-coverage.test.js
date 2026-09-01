'use strict';
/**
 * Every declared permission must be wired to something.
 *
 * `deal.approve_deviation` and `po.verify` were declared in config/permissions.js, listed
 * in the docs, granted to roles — and referenced by no route or controller for an entire
 * release. A permission that gates nothing is worse than a missing one: the matrix reads
 * as though the rule exists, so nobody goes looking for it.
 *
 * This test is the reason the Phase 0 vocabulary is small. A permission returns in the
 * phase that actually uses it.
 */
const fs = require('fs');
const path = require('path');
const { PERMISSIONS, ROLE_PERMISSIONS, ALL_ROLES } = require('../src/config/permissions');

const SRC = path.join(__dirname, '..', 'src');

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

describe('permission coverage', () => {
  /* config/permissions.js declares them; it must not also count as a use. */
  const files = walk(SRC).filter((f) => !f.endsWith(path.join('config', 'permissions.js')));
  const corpus = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  it.each(PERMISSIONS)('%s is referenced by a route, controller or config', (perm) => {
    expect(corpus.includes(`'${perm}'`)).toBe(true);
  });

  it('grants no permission that is not declared', () => {
    const declared = new Set(PERMISSIONS);
    for (const [role, held] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of held) {
        expect({ role, permission: p, declared: declared.has(p) })
          .toEqual({ role, permission: p, declared: true });
      }
    }
  });

  it('gives every recognised role an entry in the matrix', () => {
    for (const role of ALL_ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('leaves referrer with no internal permission', () => {
    expect(ROLE_PERMISSIONS.referrer).toEqual([]);
  });
});
