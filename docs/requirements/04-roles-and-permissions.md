# Roles & Permissions

Mirrors `backend/src/config/permissions.js`. Change one, change the other in the same commit.

## The V3 taxonomy

ERP Bible V3 (`new_requirement_21Aug/`) names eleven operational roles. They replace the v2
taxonomy outright — greenfield, so a legacy role value is a validation error, never a silent
upgrade to something that looks similar.

| V3 role | Module | Doc | Retired v2 role it supersedes |
|---|---|---|---|
| `sales_director` | 1 + 2 | doc 1, doc 2 | `sales_director` (unchanged) |
| `is_head` | 1 | IS-HD-01…05 | — (new) |
| `is_executive` | 1 | IS-EX-01…05 | — (new) |
| `sales_manager` | 2 | SA-MGR-01…09 | `manager` |
| `sales_executive` | 2 | SA-EX-01…07 | `agent` |
| `production_head` | 3 | PD-HD-01…10 | `delivery_manager`, `logistics` |
| `production_engineer` | 3 | PD-ENG-01…05 | `warehouse` |
| `install_head` | 4 | IC-HD-01…05 | `installation_manager` |
| `cs_manager` | 4 | IC-CSM-01…05 | `manager` (CS duties) |
| `field_engineer` | 4 | IC-FE-01…04 | `technician` |
| `cs_agent` | 4 | IC-AG-01…03 | `cs_executive` |

Plus two system roles: `superadmin`, and `referrer` (external, temporary expo-capture accounts
that hold no internal permission and reach their one expo through `allowReferrer`).

Retired with no successor: `readonly` and `finance`. `readonly` existed to mean "any internal
viewer", which is what made `requireMinRole('readonly')` dangerous; each thing it used to grant is
now an explicit permission. `finance` held only `po.verify`, which was wired to nothing.

**The four Sales Managers are one role.** Doc 2 gives each a domain and two executives; modelling
them as four roles would put four identical columns in the matrix and make the org chart
un-editable without a code change. `User.domain` and `User.reportsTo` carry the difference.

**No COO role.** Doc 2 line 38 says ">10% Director + COO approves", but a COO has no screen and no
other mention anywhere in the four documents. Tier 3 is `sales_director` alone, with a nullable
`Approval.coApprovedBy` reserved so adding the second signature later is a write, not a migration.

---

## One authorisation mechanism

v2 ran two: a `ROLE_LEVEL` total order behind `requireMinRole`, and the permission matrix.
**The ladder is deleted.**

Under V3 there is no total order to express. A Production Head is neither above nor below an IS
Head; a CS Agent is not a lesser Field Engineer. Ranking incomparable roles is precisely what
produced the documented hole where every operational role sat at level 1 next to `readonly`, and
`requireMinRole('readonly')` — the guard on the staff directory, the priced product catalogue,
every expo and system settings — therefore admitted **every authenticated user**, referrers
included.

What survives in `middleware/rbac.js`:

- `requirePermission(...perms)` — the gate on every authenticated route. Passes if the role holds
  **any** listed permission.
- `requireRole(...roles)` — exact match, no ordering. For the handful of superadmin-only routes.
  It cannot produce a level collision because it compares names, not ranks.
- `allowReferrerOr(...perms)` — referrers take the expo-scoped path; everyone else needs a
  permission. The expo id comes from the account, never the query string.
- `can(user, permission)` — for controllers that branch rather than gate.

### The ladder's one real virtue, replaced

A route that forgot its guard still refused outsiders by accident, because `requireMinRole` was on
nearly everything. `assertRoutesGuarded()` in `backend/src/app.js` replaces that with something
structural: it walks the Express router stack at boot and **throws** if any route carries
`authenticate` without `requirePermission` or `requireRole`. Guards mark themselves with `isGuard`,
so a composite guard written inline in a route file still counts and anything unmarked reads as
unguarded — the safe direction to fail.

Allowlisted (authenticated, deliberately unguarded — each answers "who am I", or is already scoped
to `req.user._id` in the handler): `GET /auth/me`, `PATCH /auth/password`, `GET /meta/pipeline`,
the four `/notifications` routes, `POST /leads/telemetry`.

Regressions: `tests/36-boot-guard.test.js`, `tests/10-role-matrix.test.js`.

### Call site → permission

The migration off the ladder, reviewed one route at a time. The `requireMinRole('readonly')` rows
are the dangerous ones: that floor silently granted these to everyone at level ≥ 1.

| Route | Was | Now |
|---|---|---|
| `GET /api/users` (was `/agents`) | `requireMinRole('readonly')` | `requirePermission('directory.read')` |
| `POST`/`PUT`/`DELETE /api/users/:id` | `requireMinRole('manager')` | `requirePermission('user.write')` |
| `PATCH /api/users/:id/manager` | — (new) | `requirePermission('user.assign_reports')` |
| `DELETE /api/users/:id/hard` | `requireRole('superadmin')` | unchanged |
| `GET /api/products[/:id]` | `requireMinRole('readonly')` | `requirePermission('catalog.read')` |
| `POST`/`PUT`/`DELETE /api/products` | `requireMinRole('superadmin')` | `requirePermission('catalog.write')` |
| `GET /api/settings[/:key]`, `/settings/pipeline` | `requireMinRole('readonly'/'manager')` | `requirePermission('settings.read')` |
| `PUT /api/settings[/pipeline]` | `requireRole('superadmin')` | unchanged |
| `GET /api/expos[/:id]` | `allowReferrerOr('readonly')` | `allowReferrerOr('expo.manage','catalog.read')` |
| every other `/api/expos` route | `requireMinRole('manager')` | `requirePermission('expo.manage')` |
| `GET /api/reports/{config}` | `requireMinRole('superadmin')` | `requireRole('superadmin')` |
| `POST /api/reports/send`, `GET /preview` | `requireMinRole('manager')` | `requirePermission('report.export')` |
| `GET /api/reports/export.xlsx` | `requirePermission('kpi.read')` | `requirePermission('report.export')` |
| `GET /api/meta/permissions` | `requireMinRole('manager')` | `requirePermission('user.read')` |
| `GET /api/analytics/{overview,trends}` | `requireMinRole('agent')` + `scopeToAgent` | `requirePermission('kpi.read')` + `attachScope` |
| `GET /api/analytics/expos` | `requireMinRole('manager')` | `requirePermission('kpi.read_company')` |
| `GET`/`POST`/`PUT /api/leads…` | `requireMinRole('agent')` + `scopeToAgent` | `requirePermission('lead.read')` + `attachScope` |
| `DELETE /api/leads/:id` | `requireMinRole('manager')` | `requirePermission('lead.delete')` |

---

## Permissions

Every string in `PERMISSIONS` is referenced by at least one route, controller or config, enforced by
`tests/30-permission-coverage.test.js`. This is why the vocabulary is small: a permission returns in
the phase that actually uses it.

`deal.approve_deviation`, `po.verify` and `workorder.create` were declared in v2, listed in this
document, granted to roles — and wired to nothing for an entire release. A permission that gates
nothing is worse than a missing one, because the matrix reads as though the rule exists.

Legend: ● granted · — denied

| Permission | superadmin | director | is_head | is_exec | sa_mgr | sa_exec | prod_head | prod_eng | inst_head | cs_mgr | field_eng | cs_agent | referrer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `user.read` | ● | ● | ● | — | ● | — | ● | — | ● | ● | — | — | — |
| `user.write` / `user.assign_reports` | ● | — | — | — | — | — | — | — | — | — | — | — | — |
| `directory.read` | ● | ● | ● | — | ● | — | ● | — | ● | ● | — | — | — |
| `catalog.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `catalog.write` | ● | — | — | — | — | — | — | — | — | — | — | — | — |
| `settings.read` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| `settings.write` | ● | — | — | — | — | — | — | — | — | — | — | — | — |
| `expo.manage` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| `customer.read` | ● | ● | ● | ● | ● | ● | ● | — | ● | ● | ● | ● | — |
| `customer.write` | ● | ● | ● | ● | ● | ● | — | — | — | ● | — | — | — |
| `customer.merge` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| `activity.read` / `activity.write` | ● | ● | ● | ● | ● | ● | — | — | ●¹ | ● | ● | ● | — |
| `activity.read_team` | ● | ● | ● | — | ● | — | — | — | ● | ● | — | — | — |
| `task.read` / `task.write` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `coaching.read` / `coaching.write` | — | ● | ● | — | ● | — | — | — | — | ● | — | — | — |
| `approval.request` | ● | ● | ● | ● | ● | ● | — | ● | — | — | ● | ● | — |
| `approval.decide` | ● | ● | ● | — | ● | — | ● | — | ● | ● | — | — | — |
| `approval.escalate` | ● | ● | ● | — | ● | — | — | — | — | ● | — | — | — |
| `lead.read` / `lead.write` / `lead.advance` | ● | ● | ●² | ●² | ● | ● | — | — | — | — | — | — | — |
| `lead.gate_override` | ● | ● | — | — | ● | — | — | — | — | — | — | — | — |
| `lead.delete` | ● | — | — | — | — | — | — | — | — | — | — | — | — |
| `workorder.read` | ● | ● | — | — | ● | ● | ● | ● | ● | — | — | — | — |
| `workorder.advance` / `.upload` | ● | — | — | — | — | — | ● | ● | — | — | — | — | — |
| `workorder.accept` / `.commit_date` / `.dispatch` / `.deliver` | ● | — | — | — | — | — | ● | —³ | — | — | — | — | — |
| `install.read` | ● | ● | — | — | ● | ● | — | — | ● | ● | ● | ● | — |
| `install.assign` / `.handover` | ● | — | — | — | — | — | — | — | ● | — | — | — | — |
| `install.execute` / `.advance` / `.upload` | ● | — | — | — | — | — | — | — | ● | ●⁴ | ● | ●⁴ | — |
| `support.manage` | ● | — | — | — | — | — | — | — | ● | ● | — | ● | — |
| `feedback.log` | ● | — | — | — | — | — | — | — | — | ● | — | ● | — |
| `feedback.corrective_action` | ● | — | — | — | — | — | — | — | — | ● | — | — | — |
| `kpi.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `kpi.read_team` | ● | ● | ● | — | ● | — | ● | — | ● | ● | — | — | — |
| `kpi.read_company` | ● | ● | — | — | — | — | ● | — | ● | ● | — | — | — |
| `report.export` | ● | ● | — | — | ● | ● | ● | — | ● | ● | — | — | — |
| `notification.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | — |
| **`finance.read`** | ● | ● | — | — | ● | ● | ● | **—** | ● | ● | **—** | **—** | — |

¹ read only — the Install Head reviews engineers' logs, they do not log customer calls.
² restricted to `track:'inside_sales'` by the scope resolver, not by permission. Doc 1: the IS Head
"cannot see Sales pipeline".
³ doc 3 PD-HD-07: "Engineers cannot mark an order as dispatch ready — only the Production Head."
Enforced by permission **and** by the stage gate; two independent layers.
⁴ upload only.

### The denials that are requirements

The bolded `finance.read` denials are not defaults, they are the specification:

> Doc 3 (twice): "Financial data is visible only to the Production Head and Sales Director. This is
> a backend access control — **not just hidden in the UI but not sent to the engineer's session at
> all**."
>
> Doc 4: CS Agents "cannot see other agents' tickets, SLA performance comparisons, team statistics,
> or AMC contract values."

Enforcement is `utils/redact.js`, called from `ok()` / `created()` / `paginated()` in
`utils/response.js` — the one place every JSON response passes through, and therefore the one place
a new endpoint cannot forget. `config/fieldVisibility.js` holds the field list as pure data.

Three backstops, because one chokepoint is not enough:
- query-layer projections on the hot list endpoints, so the values never leave Mongo;
- an explicit `scope.finance` flag in `utils/excelReport.js`, which streams a buffer and never
  touches `ok()` — this is exactly the leak its own comment already described ("an export that is
  broader than the screen it summarises is a leak");
- `tests/31-financial-redaction.test.js`, a crawler that signs in as each finance-blind role, walks
  every GET route and refuses any response body carrying a redacted key at any depth.

---

## Row-level visibility

Permissions answer "which verbs". `services/scopeService.js` answers "over which rows" — one
resolver, replacing the **four** independent mechanisms v2 had (`scopeToAgent` in the middleware, an
`agentScopeFilter` in `workOrderController`, an inline `role === 'technician'` test in
`installationController`, and a fourth inside `excelReport.scopeFor`). Replacing one of them would
have left three leaks.

```js
resolveScope(user)          // → { mode, userIds, self, tracks }
scopeFilter(scope, field)   // that id set, expressed against one named owner column
scopeAllows(scope, ownerId) // per-document check
```

Two functions deliberately: every model names its owner column differently (`Lead.owner`,
`Activity.by`, `Task.owner`, `InstallationJob.technician`), so no single filter object is universal.
`userIds === null` means *no restriction* — not an empty array, which means *restricted to nobody*.
Conflating them is how a scope bug becomes a company-wide leak.

| mode | roles |
|---|---|
| `own` | `is_executive`, `sales_executive`, `production_engineer`, `field_engineer`, `cs_agent`, `referrer` |
| `team` (self + `User.chain` subtree) | `is_head`, `sales_manager` |
| `all` | `superadmin`, `sales_director`, `production_head`, `install_head`, `cs_manager` |

`User.chain` is a materialised ancestor path maintained by `services/orgService.js`, so "everyone
under me at any depth" is one indexed query rather than a recursive walk on every request. It is
derived state: only `orgService.setManager()` may write it, and it rewrites the moved subtree.

**There is no `domain` scope mode.** Doc 2 defines Manager visibility by the reporting line — "sees
only his 2 Executives' deals + his own" — not by domain. Making domain a scope axis would leak two
managers who happen to share a domain into each other. `domain` is a labelling and routing
attribute: a query parameter, never a security boundary.

### KPIs are scoped too

v2's four KPI endpoints had no scoping at all — `salesKpis(window)` took only a window — so every
role holding `kpi.read` received company-wide pipeline value, win rate and revenue. Doc 2 forbids
exactly that twice (SA-MGR-01, SA-DIR-01 note 1). The signatures now take a scope, and
`kpi.read` / `kpi.read_team` / `kpi.read_company` decide which one the controller passes.

Regression: `tests/32-scope-resolver.test.js`, which asserts *Manager 1 cannot see Manager 2* through
HTTP rather than by calling the resolver — the resolver being correct and the controller using it
are two different facts, and only the second one matters.

---

## Why Delivery and Installation never read a Lead

Unchanged from v2, and still right. `WorkOrder` and `InstallationJob` each carry a
`customerSnapshot` sub-document denormalised at handoff time; `GET /api/workorders/:id` populates
nothing from `Lead`. Least privilege, no agent-scoping in the delivery path, and historically
correct — the delivery record should reflect the customer as they stood when the PO was verified.
