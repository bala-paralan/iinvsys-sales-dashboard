'use strict';

/**
 * Named role fixtures.
 *
 * Twenty test files referenced role names as string literals. Going through these
 * helpers instead means the next taxonomy change is one file, not twenty — and, more
 * importantly, that a PARTIAL rename cannot leave suites passing for the wrong reason,
 * which is the failure mode that makes a large rename dangerous.
 *
 * Every fixture that takes a manager wires `chain` as well as `reportsTo`. A fixture that
 * sets only `reportsTo` produces a user whose 'team' scope resolves to an empty subtree,
 * so a scoping test would pass without testing anything.
 */

const { insertUser, tok } = require('./testUtils');

async function make(role, attrs = {}) {
  const { reportsTo, ...rest } = attrs;
  let chain = [];
  if (reportsTo) {
    const User = require('../../src/models/User');
    const mgr = await User.findById(reportsTo).select('chain').lean();
    chain = [...((mgr && mgr.chain) || []), reportsTo];
  }
  const id = await insertUser({ role, reportsTo: reportsTo || null, chain, ...rest });
  return { id, token: tok(id), role };
}

/* Platform */
const asSuperadmin = (a) => make('superadmin', a);
const asReferrer   = (a) => make('referrer', a);

/* Sales leadership */
const asDirector = (a) => make('sales_director', a);

/* Inside Sales — doc 1 */
const asISHead = (a) => make('is_head', a);
const asISExec = (a) => make('is_executive', a);

/* Sales — doc 2 */
const asSalesManager   = (a) => make('sales_manager', a);
const asSalesExecutive = (a) => make('sales_executive', a);

/* Production & Delivery — doc 3 */
const asProductionHead     = (a) => make('production_head', a);
const asProductionEngineer = (a) => make('production_engineer', a);

/* Installation & CS — doc 4 */
const asInstallHead   = (a) => make('install_head', a);
const asFieldEngineer = (a) => make('field_engineer', a);
const asCSManager     = (a) => make('cs_manager', a);
const asCSAgent       = (a) => make('cs_agent', a);

/**
 * The doc 2 shape in one call: a manager with two executives beneath them.
 * Used by every test that has to prove Manager 1 cannot see Manager 2's team.
 */
async function salesTeam(domain = 'railways') {
  const manager = await asSalesManager({ domain });
  const execA = await asSalesExecutive({ domain, reportsTo: manager.id });
  const execB = await asSalesExecutive({ domain, reportsTo: manager.id });
  return { manager, execA, execB };
}

module.exports = {
  make, salesTeam,
  asSuperadmin, asReferrer, asDirector,
  asISHead, asISExec,
  asSalesManager, asSalesExecutive,
  asProductionHead, asProductionEngineer,
  asInstallHead, asFieldEngineer, asCSManager, asCSAgent,
};
