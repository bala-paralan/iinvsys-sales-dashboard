# Roles & Permissions

## Mapping the framework's roles to system roles

The Business Process Framework names ten operational roles. Four already exist in the system;
seven are new.

| Framework role | System role | Status |
|---|---|---|
| Sales Executive / BDM | `agent` | existing |
| Sales Manager | `manager` | existing |
| Sales Director | `sales_director` | **new** |
| Finance / Admin | `finance` | **new** |
| Delivery Manager | `delivery_manager` | **new** |
| Procurement / Warehouse | `warehouse` | **new** |
| Logistics Coordinator | `logistics` | **new** |
| Delivery Executive | `logistics` | reuses `logistics` |
| Installation Manager | `installation_manager` | **new** |
| Installation Technician | `technician` | **new** |
| Customer Service Executive | `cs_executive` | **new** |
| Customer Service Manager | `manager` | reuses `manager` |
| — (platform owner) | `superadmin` | existing |
| — (expo lead capture) | `referrer` | existing |
| — (view-only) | `readonly` | existing |

Delivery Executive maps onto `logistics` rather than getting its own role: the framework gives it
no permission the Logistics Coordinator lacks, and every extra role is a permanent maintenance cost.
Customer Service Manager maps onto `manager` for the same reason — its distinct duties (reviewing
CSAT, driving corrective actions) are already `manager`-level reads and approvals.

---

## Two authorisation mechanisms, deliberately

The existing `ROLE_LEVEL` ladder in `backend/src/middleware/rbac.js` is a **total order**:

```js
{ superadmin: 4, manager: 3, agent: 2, referrer: 1, readonly: 1 }
```

The new roles are **orthogonal** to it — a Delivery Manager is neither above nor below a Sales
Executive. But every existing route and roughly 700 tests depend on `requireMinRole`, so the ladder
cannot be removed. Both mechanisms coexist:

### `requireMinRole(role)` — unchanged, used by every pre-existing route

```js
{
  superadmin: 4,
  manager: 3, sales_director: 3,
  agent: 2,
  readonly: 1,
  // level 0 — no internal read
  finance: 0, delivery_manager: 0, warehouse: 0, logistics: 0,
  installation_manager: 0, technician: 0, cs_executive: 0,
  referrer: 0,
}
```

The ladder answers exactly one question: **how far into internal sales data may this account see?**
It is not a seniority ranking.

**`readonly` is level 1 and nothing else is.** `requireMinRole('readonly')` guards the agent
directory, the product catalogue, the expo list and system settings — it means "any internal
viewer", and `readonly` is the floor of that idea.

**The operational roles and `referrer` sit at level 0.** They are orthogonal to the ladder: a
warehouse operator is not "below" a sales agent, they simply have no business in the sales pipeline.
They reach everything they need through the permission layer instead.

`sales_director` sits at level 3 because it genuinely *is* an escalation of `manager` — final
authority on discount and term deviations — and keeps full internal read.

> **This was wrong in an earlier revision, and it was exploitable.** Every operational role *and*
> `referrer` were placed at level 1 alongside `readonly`. Because `requireMinRole` tests `>=`,
> `requireMinRole('readonly')` then admitted **every authenticated user**. A referrer — an external,
> temporary expo account whose credentials are generated in bulk and handed out at events — could
> read the full agent directory (names, emails, phones, territories, targets), the product catalogue
> with prices, every expo, and system settings.
>
> The claim in the previous revision that operational roles "are refused by every existing
> `requireMinRole('agent')` route for free" was true only of the `agent` floor. It was false for
> every `requireMinRole('readonly')` route, which is most of the read surface.
>
> Regression: `backend/tests/10-role-ladder.test.js`, which asserts the ladder through the HTTP
> layer for all 13 roles rather than by reading the constant.

### Referrers and their expo

Referrers legitimately need the one expo they are attached to, in order to render their capture view.
`allowReferrerOr(minRole)` in `rbac.js` handles this: a referrer passes through `allowReferrer`
(which sets `req.referrerExpoId`), everyone else must clear `minRole`.

`GET /api/expos` and `GET /api/expos/:id` use it, and the controller **scopes the response to that
single expo** — the id comes from the referrer's own account, so it cannot be widened from the query
string. Requesting someone else's expo answers `404`, not `403`, so the endpoint cannot be used to
probe which expo ids exist.

This is transparent to the existing frontend, which already discarded every expo but its own
(`app.js` finds `S.expos` by `S.session.expoId`).

### `requirePermission(...perms)` — new, used by every new route

Permissions are `resource.verb` strings held in `backend/src/config/permissions.js`. A user passes
if their role holds **any** of the listed permissions. `superadmin` implicitly holds all.

---

## Permission matrix

Legend: ● granted · ○ granted but scoped to own records

| Permission | superadmin | manager | sales_director | agent | finance | delivery_manager | warehouse | logistics | installation_manager | technician | cs_executive |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `lead.read` | ● | ● | ● | ○ | | | | | | | |
| `lead.write` | ● | ● | ● | ○ | | | | | | | |
| `lead.advance` | ● | ● | ● | ○ | | | | | | | |
| `lead.gate_override` | ● | ● | ● | | | | | | | | |
| `lead.delete` | ● | ● | | | | | | | | | |
| `deal.approve_deviation` | ● | | ● | | | | | | | | |
| `po.verify` | ● | ● | | | ● | | | | | | |
| `workorder.read` | ● | ● | ● | ○ | ● | ● | ● | ● | ● | | ● |
| `workorder.create` | ● | ● | | | | ● | | | | | |
| `workorder.accept` | ● | ● | | | | ● | | | | | |
| `workorder.commit_date` | ● | ● | | | | ● | | | | | |
| `workorder.advance` | ● | ● | | | | ● | ● | ● | | | |
| `workorder.dispatch` | ● | ● | | | | ● | | ● | | | |
| `workorder.deliver` | ● | ● | | | | ● | | ● | | | |
| `workorder.upload` | ● | ● | | | | ● | ● | ● | | | |
| `install.read` | ● | ● | ● | ○ | | ● | | | ● | ○ | ● |
| `install.assign` | ● | ● | | | | | | | ● | | |
| `install.execute` | ● | ● | | | | | | | ● | ● | |
| `install.advance` | ● | ● | | | | | | | ● | ● | |
| `install.handover` | ● | ● | | | | | | | ● | | |
| `install.upload` | ● | ● | | | | | | | ● | ● | ● |
| `support.manage` | ● | ● | | | | | | | ● | | ● |
| `feedback.log` | ● | ● | | | | | | | | | ● |
| `feedback.corrective_action` | ● | ● | | | | | | | | | ● |
| `kpi.read` | ● | ● | ● | ○ | | ● | | | ● | | ● |
| `notification.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |

`referrer` and `readonly` hold no permissions in the new matrix. Referrers keep their existing
narrow lead-capture path unchanged.

---

## Why Delivery and Installation never read a Lead

Delivery and installation staff legitimately need to know who the customer is. They do **not** get
`lead.read`.

Instead, `WorkOrder` and `InstallationJob` each carry a `customerSnapshot` sub-document — name,
company, phone, email, city, state, zone — denormalised at handoff time. `GET /api/workorders/:id`
populates nothing from `Lead`.

Three reasons this is the right call:

1. **Least privilege.** A warehouse operator has no business reading deal values, competitor
   intelligence, SPENCO scores or lost reasons.
2. **It removes agent-scoping from the delivery path entirely.** `scopeToAgent` exists to keep
   agents inside their own book of business; applying it to a shared delivery queue would be
   incoherent.
3. **It is historically correct.** The delivery record should reflect the customer details as they
   stood when the PO was verified, not as someone edits them six weeks later.

## Interaction with the existing scoping middleware

`scopeToAgent` only special-cases `role === 'agent'`; `allowReferrer` only `role === 'referrer'`.
Both fall through correctly for every new role with no edits. New roles must be added to the
`User.role` enum in `backend/src/models/User.js`.

`POST /api/auth/register` currently restricts creatable roles to
`['superadmin','manager','agent','readonly']`. It is widened to include the new operational roles;
`referrer` remains creatable only through `POST /api/expos/:id/referrers`, which generates the
scoped credentials.
