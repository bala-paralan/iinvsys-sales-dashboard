# IINVSYS — Release Notes

Lead, Agent & Expo Management Platform → three-process ERP (Sales · Delivery · Installation & CS).

**Current release: v2.0.3** — 2026-08-17 · branch `release/erp-three-process` · commit `fb50458`

> **On version numbers.** This repository has never carried semver tags — the only git tag is
> `InitialRelease` (`6b4f28a`, 2026-04-25). The versions below are assigned retroactively in this
> document from the commit history, so they are a reading of the history, not a record that
> already existed. The `version` fields in `package.json` are stale and do not match
> (see [Pending items](#pending-items) → *Housekeeping*).

---

## v3.4.0 — Installation & Customer Support (ERP Bible V3, document 4)

Branch `release/erp-three-process`. Seventeen screens across Install Head, CS Manager,
Field Engineer and CS Agent. **The V3 programme is complete**: all four modules built.

**The loop closes here.** An expiring AMC becomes a Suspect-stage deal through
`salesEntryService.mintSalesLead()` — the same entry point Inside Sales and direct creation
use — assigned to the executive who closed the ORIGINAL deal rather than whoever owns the
account today. Installed → AMC → renewal → back into SPENCO.

**Doc 4 lists four things a CS Agent must not see, and each is refused by a different
mechanism**: other agents' tickets by the scope resolver, SLA comparisons and team
statistics by `kpi.read_team`, and AMC values by the response chokepoint. All four are
asserted separately, because one test that "an agent sees less" would pass with three of
them broken.

**SLA targets are stamped at creation and frozen.** A countdown against a target that
moves when policy changes is worse than no countdown. A breach, once recorded, is never
cleared by a later resolution.

`Ticket` is deliberately NOT `InstallationJob.postSupport.issues[]`. Those gate one job's
Feedback stage; a ticket belongs to the customer and outlives the job.

### Fixed while building

- **`InstallationJob` had no link to the `Customer` entity.** Phase 0 added `Lead.customer`
  but the job created by Handoff 2 never carried one, so the AMC created at sign-off had
  nothing to attach to and the installation could not appear in Customer 360. Handoff 2 now
  propagates it, and `supportService` resolves it through the lead or the customer snapshot
  for jobs that predate the field.

Backend: 52 suites, 1,803 passing, 28 skipped, 0 failing. Frontend typechecks and builds.


## v3.3.0 — Production & Delivery (ERP Bible V3, document 3)

Branch `release/erp-three-process`. Fifteen screens across Production Head and Engineer,
built by **extending `WorkOrder`** rather than adding a parallel `ProductionOrder` — the
existing chain already models this flow and already has an idempotent Handoff 1.

**The QC gate is enforced twice, independently.** An engineer holds no
`workorder.dispatch`, AND `qc.approvedAt` is an `entryRequires` on the dispatch stage.
Doc 3 calls this mandatory twice; a single mechanism would be a single point of failure.
Both layers have their own test.

**Engineers receive no financial values at all** — now three layers, closing the gap the
Phase 0 plan deferred to this phase: the query projection means the value never leaves
Mongo, `redact()` strips it at the response chokepoint, and the Excel export carries its
own flag.

`marginal` is a first-class QC outcome. Doc 3's own worked example turns on it — 1°C over
spec but inside the customer's tolerance band — and a binary pass/fail makes the engineer
choose between lying and failing a good unit.

### Fixed while verifying

- **`wipPercent` was absent from every read path.** The schema defines it as a virtual, but
  `.lean()` does not evaluate virtuals and `lean({virtuals:true})` needs a plugin that is
  not installed, so the option was silently ignored. The test passed because it asserted
  on a PATCH response, which returns a real document; the list and the detail page — where
  anyone actually sees the number — had no percentage at all. Now computed explicitly, and
  asserted on the read paths.
- **A portal test pinned a landing route as a string**, and failed when doc 3 gave the
  engineer a dashboard where Phase 0 could only offer a list. Replaced with the property
  that matters — every role's landing must be a route that role can mount — which then
  found `referrer` landing outside its own portal. That one is deliberate and is now a
  named exemption rather than a silent pass.

Backend: 51 suites, 1,775 passing, 28 skipped, 0 failing. Frontend typechecks and builds.


## v3.2.0 — Sales / SPENCO (ERP Bible V3, document 2)

Branch `release/erp-three-process`. Twenty-five screens across Director, Manager and
Executive. The SPENCO stages, gates and advance endpoint are unchanged from v2 — what doc 2
adds is the commercial layer above them.

**The discount ladder is data, and it routes up the requester's own reporting line.**
0–3% self · 3–10% Manager · >10% Director, held as bands in `pipeline.js` and resolvable
from Settings, because a discount ladder is commercial policy rather than a law of the
system. `approverFor()` walks UP the requester's chain for the first holder of the
approving role — routing to whichever manager a query returned first would breach doc 2's
central isolation rule in the one place it matters most. A counter-offer cannot exceed the
approver's own band, or 3–10% is advisory.

**Confirming a Commercial Order starts Production**, firing the existing Handoff 1 rather
than a second path. Handoff 1 now has two triggers — the stage transition and the CO
confirmation — and its unique index plus back-pointer is what makes that safe.

**One board at three scopes.** Column totals come back `null` for a role without
`finance.read`; summing client-side would produce a total whose parts the same caller is
not allowed to see.

### Fixed while verifying

- **A Commercial Order could be confirmed on a deal still in Negotiation**, raising a
  production order for a deal with no PO document and no PO number. Confirming a CO fires
  Handoff 1, so this was the H-1 guarantee — "Delivery not activatable without a confirmed
  and verified PO" — routed around by a different endpoint. Reaching `commercial_order`
  through the advance endpoint is now a precondition of submitting the order. Found by
  driving the flow against a running server; the test suite was green throughout.

Backend: 50 suites, 1,752 passing, 28 skipped, 0 failing. Frontend typechecks and builds.


## v3.1.0 — Inside Sales (ERP Bible V3, document 1)

Branch `release/erp-three-process`. Fifteen screens across three roles; the module every
other part of the specification feeds from, and the one with nothing in the app before.

**The module runs on its own stage table through the existing transition engine.**
`IS_STAGES` (New → Contacted → Qualified → Handoff Requested → Converted, plus
Disqualified) is a fourth table driven by the same `stageService.applyTransition`, which
gained a `stageField` option rather than a second copy of itself. Doc 1 numbers records
`IS-2026-XXXX` and doc 2 numbers deals `SA-2026-XXX`, and IS-DIR-03's bypass creates both,
so a qualified lead never becomes a deal in place — it mints a linked `track:'sales'`
record and Customer 360 shows both.

**BANT refuses a tick without a note.** The IS Head reads those four notes at IS-HD-04 to
decide; "Budget ✓" is not something anyone can decide on.

**One entry point to the Sales pipeline.** `salesEntryService.mintSalesLead()` is the only
thing that creates a SPENCO record, and the advance endpoint refuses `is_converted`
outright — so "no Sales deal without an approved handoff" is a property, not a convention.
Phase 2's discount flow and Phase 4's AMC renewal reuse it.

**Approvals are addressed to one person.** A handoff request goes to the requester's own
`reportsTo`. The alternative — `notifyByPermission` — would tell every IS Head in the
company about a decision only one of them can take.

### Fixed while verifying, all found by running the thing

- **`scopeAllows` refused owners their own records** when a controller populated the owner
  for display: it compared a Mongoose document against a set of ids. The unit test only
  asserted the *refusal* case, which is how a check that refuses everyone looks correct.
  Fixed in the resolver, not at the seventeen call sites.
- **Five audit writes wrote nothing**, three of them shipped in v3.0.0. They passed
  `before`/`after`, which are not schema fields, and omitted the required `summary`;
  `auditService.record` logs and returns null by design, so nothing surfaced.
- **A stale 401 tore down a fresh session.** A request issued before sign-in could resolve
  after it and clear the token that had just been installed — the screen returned to the
  login form with no error, which looks like a wrong password. The handler now only clears
  the credential that actually failed.
- **`useMe` queried `/meta/me` while logged out**, guaranteeing a 401 on the login page.
- **Sidebar links stopped stacking** when portal nav grouped them into sections — they had
  been direct flex children of `.sidebar` and lost that for free.
- **Inside Sales records could exist with no Inside Sales stage.** Now derived in the
  model: an IS record without `isStage` is not a valid record.

Backend: 49 suites, 1,725 passing, 28 skipped, 0 failing. Frontend typechecks and builds.


## Version index

| Version | Date | Headline | Commit |
|---|---|---|---|
| [2.0.3](#v203--2026-08-17) | 2026-08-17 | User manual shipped inside the app, linked from the sidebar | `fb50458` |
| [2.0.2](#v202--2026-08-17) | 2026-08-17 | Delivery & Installation unblocked; Admin writes possible | `784100d` |
| [2.0.1](#v201--2026-08-17) | 2026-08-17 | The write controls every stage gate was waiting on | `d4d9069` |
| [2.0.0](#v200--2026-08-17) | 2026-08-17 | **Three-process ERP** — Sales, Delivery, Installation & CS | `71240a1` |
| [1.8.0](#v180--2026-04-29) | 2026-04-29 | Excel export of leads, scoped by role | `e6789ca`, `381b873` |
| [1.7.0](#v170--2026-04-29) | 2026-04-29 | OCR pipeline rebuilt, self-hosted, QR fast path | `46a9857` … `a4680ca` |
| [1.6.0](#v160--2026-04-28) | 2026-04-28 | Referrer lead-capture parity + 6 RBAC gaps closed | `a4f659a`, `f105763`, `7de3a2b` |
| [1.5.1](#v151--2026-04-27) | 2026-04-27 | QA automation suite; real mail errors surfaced | `1690e7e`, `24225e3` |
| [1.5.0](#v150--2026-04-26) | 2026-04-26 | Lead-addition PRDs 1–6 | `7c20b4c` (PR #1) |
| [1.4.0](#v140--2026-04-25) | 2026-04-25 | Production hardening · **tag `InitialRelease`** | `6b4f28a` |
| [1.3.0](#v130--2026-04-20) | 2026-04-20 | Scheduled email reports; on-premise runbooks | `9813cec` |
| [1.2.0](#v120--2026-04-02) | 2026-04-02 | Functional + contract test suites | `2f77943`, `4ed6157` |
| [1.1.0](#v110--2026-03-31) | 2026-03-31 | OCR lead capture, dynamic settings, expo referrers | `048e1ed` |
| [1.0.0](#v100--2026-03-29) | 2026-03-29 | First deploy — Sales Dashboard | `87f22e3` |

---

## v3.0.0 — ERP Bible V3, Phase 0 (Foundation)

Branch `release/erp-three-process`. Ships **no V3 screens**; ships the substrate all four
V3 modules stand on. `new_requirement_21Aug/` specifies 72 screens across 11 roles,
delivered in five phases — this is the first.

### The role taxonomy is replaced

Eleven V3 roles (`sales_director`, `is_head`, `is_executive`, `sales_manager`,
`sales_executive`, `production_head`, `production_engineer`, `install_head`, `cs_manager`,
`field_engineer`, `cs_agent`) plus `superadmin` and `referrer`. Greenfield: a legacy role
value is a validation error, never a silent upgrade. `manager`, `agent`, `readonly`,
`finance`, `delivery_manager`, `warehouse`, `logistics`, `installation_manager`,
`technician` and `cs_executive` are gone.

**The `ROLE_LEVEL` ladder is deleted.** V3 names roles that are genuinely incomparable — a
Production Head is neither above nor below an IS Head — and ranking incomparable roles is
what produced the documented hole where `requireMinRole('readonly')` admitted every
authenticated user, referrers included. `requirePermission` is now the only gate, with
`requireRole` for superadmin-only routes.

The ladder's one real virtue was that a route which forgot its guard still refused
outsiders by accident. That is replaced by `assertRoutesGuarded()` in `src/app.js`, which
**refuses to boot** if any authenticated route carries neither guard. Deny-by-default is
structural now instead of incidental. A permission-coverage lint enforces the other half:
every declared permission must be wired to something — `deal.approve_deviation`,
`po.verify` and `workorder.create` had been declared, documented and granted while
gating nothing since v2.0.0.

### The organisation, and who may see whose rows

`User` gains `reportsTo`, a materialised `chain` and `domain`. `services/orgService.js`
owns both derived fields — it rewrites the moved subtree on reassignment and refuses a
cycle. `services/scopeService.js` is the single row-level resolver, replacing the **four**
independent mechanisms v2 had (`scopeToAgent`, a filter in `workOrderController`, an
inline `role === 'technician'` test in `installationController`, and a fourth inside
`excelReport.scopeFor`) — replacing one of them would have left three leaks.

**The KPI endpoints had no scoping at all.** `salesKpis(window)` took only a window, so
every role holding `kpi.read` received company-wide pipeline value, win rate and revenue —
the exact thing doc 2 forbids twice (SA-MGR-01, SA-DIR-01). They now take a scope, and
`kpi.read` / `kpi.read_team` / `kpi.read_company` decide which.

`Agent` is retired: `User` is the only identity model and `Lead.assignedAgent` becomes
`Lead.owner: ref User`. This also closes **P-1** — Installation Planning requires a
technician ObjectId and there was no endpoint that could supply one; `GET /api/users` now
can.

### Engineers are not sent money

Doc 3 states it twice and states it as a backend requirement: financial values must be
"not sent to the engineer's session at all". `config/fieldVisibility.js` (pure data) plus
`utils/redact.js`, called from `ok()`/`created()`/`paginated()` — the one place every JSON
response passes through. Three backstops: query-layer projections, an explicit flag in
`excelReport` (which streams a buffer and never touches `ok()`), and a crawler test that
signs in as each finance-blind role, walks every GET route and refuses any body carrying a
redacted key at any depth.

### The customer, and the interaction log

New `Customer`, `Activity`, `Task`, `Approval` and `CoachingNote` models, with routes and
tests but no screens.

- **Activities belong to the customer, not the lead** — the rule doc 1 and doc 2 both
  restate. `Lead.followUps[]` is retired; `POST /api/leads/:id/followups` is gone.
  `Lead.lastActivityAt` is denormalised so `config/pipeline.js` stays a pure function over
  one document and the C-5 weekly-note rule keeps working.
- **"Next Action" auto-creates a dated task**, in the same operation, linked both ways.
- **Customer 360** aggregates every deal and every rep onto one timeline. Nothing derived
  is stored.
- **Dedupe is advisory for a human and exact-match-only for automated callers.** A wrong
  fuzzy auto-merge under a unique index cannot be picked apart afterwards, and no one is
  watching when a cron job guesses.
- **Approvals are addressed to one person.** `notifyByPermission` fans out to every holder
  of a permission, which would have alerted all four Sales Managers and the whole director
  tier for a single 7% discount request.
- **Coaching notes are a separate collection**, not an `Activity` variant: folded in, one
  forgotten predicate on the Customer 360 timeline shows an executive their own Director's
  private assessment of them.

### Per-role portals

`config/portals.js` (server-side, pure data) gives each role its own sidebar, landing route
and screen allowlist — "All screens, all flows, no shared views", on every document header.
`nav` and `routes` derive from one object, so a role's sidebar and its reachable routes
cannot drift: v2 hid a link and left the URL working, so the page mounted and rendered a
403 banner. `frontend/src/App.tsx` is now a generated route tree; the client holds only a
screen-key → component map.

**`me` has left the cached pipeline payload.** It rode inside `/api/meta/pipeline`, which
the client caches with `staleTime: Infinity` keyed on a `version` hash that did not cover
the taxonomy — so changing someone's role changed what the server sent and changed nothing
about what their open tab believed. It is now `GET /api/meta/me` (`staleTime: 0`), and
`pipelineVersion()` additionally hashes the role list and every stage's `ownerRole`.

### Seed

The full V3 org chart — 29 users using the documents' own names (Priya Krishnan, Rajan V.,
Vikram Nair, Exec A–H, Suresh R., Kumar R., Agent Priya …), the seven customers the
specification's screenshots are drawn from with their named contacts, and a few activities
so the timeline screens are demonstrable at the phase gate. Reporting lines are written
through `orgService`, which makes the seed the first test that `chain` maintenance works.

### Tests

New: `07-role-taxonomy`, `10-role-matrix` (exhaustive role × guarded-route product,
asserted through HTTP), `30-permission-coverage`, `31-financial-redaction`,
`32-scope-resolver`, `33-customer-activity`, `34-portals`, `35-approval`, `36-boot-guard`.
`tests/helpers/roles.js` gives every suite named role fixtures that wire `chain` as well as
`reportsTo` — a fixture setting only `reportsTo` produces an empty subtree and a scoping
test that passes without testing anything.

## v2.0.3 — 2026-08-17

A user manual for all three processes, shipped **inside** the application rather than beside it:
`frontend/public/manual/`, so it deploys with the build and needs no route, no bundle weight and no
server change. The sidebar link is deliberately ungated — it documents what every role can and
cannot do, and the role that most needs that is the one holding the fewest permissions. Its href is
built from `import.meta.env.BASE_URL`, so it resolves under both the pre-cutover `/v2/` base and the
current `/` (see [Pending items](#pending-items) → *Housekeeping* P-19).

**What it covers** — every screen, plus the states a reference document usually omits: the four
sign-in failures (bad credentials, unreachable server, the 15-minute lockout, session expiry), invite
redemption including expired and already-used links, the gate drawer in all four states (unmet, the
override note, all met, closed stage), the DA gate refusing a delivery, an installation gate blocked
by an open snag, a closure refused for a missing corrective-action plan, degraded/offline mode, the
two native browser dialogs, and an appendix mapping every message the system can show to what to do
about it. Also the full gate table for all three processes and the role/permission matrix, both read
out of `pipeline.js` and `permissions.js` rather than restated from memory.

**Screenshots are captured from the running software.** A Playwright pass drove the live app after
scripted API calls pushed real records through Sales → Delivery → Installation — a full sale, a
second job closed out at CSAT 2.5 (which is what makes the corrective-action screens reachable), a
forced override, a delay event — and the sweeps in `backend/src/utils/jobs/` were run against the
in-memory Mongo with a forward-dated `now` to populate the alert feed. Every error banner and gate
refusal in the manual is a state the software actually produced; the only intercepted case is
"cannot reach the server", where the request was blocked to trigger the client's own offline path.

65 images, quantised to 256 colours and lazy-loaded: 4.3 MB rather than 12 MB, because a help page
nobody waits for is a help page nobody reads.

## v2.0.2 — 2026-08-17

Second pass of the end-to-end review. The same defect class as 2.0.1 ran through both downstream
processes: a gate the backend enforces, a field on the model, and no control anywhere to set it.

**Delivery — hard stop cleared**
- Leads had only a free-text "product / package" and no product picker. Work Order line items are
  built from `lead.products` by `handoffService.itemsFrom`, so **every Work Order was created empty**
  and Delivery's first gate (`items notEmpty`) could never pass. Delivery has no override, so this
  blocked the entire downstream chain.
- `stockConfirmedAt` and `packingCheckedBy` — the only 2 of all 58 gate fields with no writer
  anywhere (no route, no controller, no UI) — now ride along as the transition's `patch`. The server
  merges the patch before judging the gate and persists only on success, so a failed advance cannot
  leave a half-set timestamp behind.

**Installation**
- Planning displayed technician, scheduled date and site readiness but never called
  `POST /installations/:id/plan`, which has set all three since B3.

**Admin**
- `Product.category` is a server-side required enum but rendered as a free-text box — every save
  was a 422, and the error banner sat *behind* the modal overlay, so it read as a dead Save button.
  Now a select, with the error rendered inside the dialog.
- `competitorOther` had no input, though the Engagement gate requires it when competitor is "other".

**Behaviour change**
- The gate button no longer pre-disables itself when a patch is pending. The preview was computed
  before the patch existed; the server, which merges it before judging, is the authority.

**Known and not fixed in this release** — the Planning gate reads `technician`, an ObjectId ref to
`User`, and no endpoint lists users, so no client can obtain a valid id. The form records
`technicianName` and says so plainly rather than 422-ing the whole request. See
[Pending items](#pending-items) → *Blocking*.

## v2.0.1 — 2026-08-17

Production shipped with the backend enforcing stage gates correctly and the frontend offering no
way to satisfy them. Five instances of one pattern, found in an end-to-end pass against the live
server:

- **No lead-creation UI at all.** `POST /leads` existed and nothing called it, so the greenfield
  database stayed at zero leads — the ERP had no entry point.
- **No SPENCO scoring.** `meta.spenco` shipped dimensions, hints and thresholds to the client and
  nothing read them; Prospect → Engagement was unreachable.
- **No PO number / subscription / AMC controls** (Commercial Order).
- **No lost-reason controls** (Order Lost).
- **No document upload on leads** — Engagement → Negotiation wants a proposal or quotation on file.
  The upload UI existed on Delivery and Installation but not here.

Each was reachable only via `lead.gate_override`, which turns the qualification discipline the gates
exist to enforce into a rubber stamp — and override is permission-gated, so an ordinary agent could
not move a deal at all.

Every control renders from the pipeline payload, never a local array, so a threshold changed in
Settings re-renders the panel with no deploy. SPENCO sends the six dimension scores only; total and
qualified are derived in the Lead pre-save hook and a client-supplied total is not trusted.

Also fixed:
- Admin table headers stacked vertically — `<th>` borrowed `.form-label` (`display:block`), which
  collapsed the header row while the `<td>`s stayed in columns. New `.table-th`.
- A rejected form produced no feedback anywhere: only 3 of 16 fields rendered their own error, so
  the gold Save button just looked dead.
- `vite.config.ts` takes `API_PROXY_TARGET`, so a build can be verified against the real API before
  it is deployed.

## v2.0.0 — 2026-08-17

The Business Process Framework and CRM Dictionary implemented as a working system. Previously
`docs/requirements/` described ~40 requirements as complete while the models, services, jobs and
routes did not exist. Doc 06 now states what is actually built, under the rule that **a row may only
be marked complete by the commit that adds the test named beside it**.

**Backend**
- **Process 1 — Sales:** Lead rewritten to the dictionary. `POST /leads/:id/advance` runs the gate
  contract (`canAdvance` → in-memory patch → `validateStageEntry` → save), so nothing persists when a
  gate fails. Hygiene queue plus nightly sweeps.
- **Process 2 — Delivery:** `WorkOrder`, write-once `originalCommittedDate`, delay events with reason
  codes, the DA gate, two SLA clocks.
- **Process 3 — Installation & CS:** `InstallationJob`, checklist engine, commissioning dual
  signature, snags, support issues, CSAT, closure gate.
- Handoff 1 and Handoff 2, both idempotent and self-repairing.
- **21 KPIs** at `/api/kpis/*`, targets read from `pipeline.KPI_TARGETS`.
- Excel export rebuilt for three processes and scoped to the caller.

**Security**
- Referrer **invites** replace the plaintext password the API used to return; the token is stored
  only as a SHA-256 hash, single use, expiring.
- Server-owned fields stripped from lead writes — a forged attachment defeated the PO gate, and a
  forged `stageHistory` inflated every conversion KPI.
- `GET /api/meta/pipeline` is no longer cached: it embeds the caller's permissions and the browser
  caches by URL, so the next user to sign in on a shared machine saw the previous user's permissions.
- Environment validated at boot; CSP without inline scripts; SRI on CDN scripts; audit log;
  telemetry TTL.

**Frontend**
- New **React + Vite + TypeScript** app at `frontend/`, rendering from `GET /api/meta/pipeline` — no
  hardcoded stages, enums or gates. Served at `/v2` beside the legacy app; cutover and rollback are
  one line in `vercel.json`.
- OCR, QR scanning and bulk card capture are deliberately **not** ported.

**Tests** — 1,311 passing, 28 documented skips, 41 suites. The suite was never green before this
work. It requires `--runInBand` (one shared in-memory Mongo); use `npm test`, never a bare `npx jest`.

**Deployment (2026-08-17)** — v2 went live on `192.168.10.33` serving `https://sales.iinvsys.com:8413`,
on a fresh `iinvsys_v2` database. The legacy static app is preserved at
`/var/www/iinvsys.bak_legacy_20260817_051605` and the old `iinvsys` database (123 leads) is intact —
greenfield was done by switching database name, not by deleting anything.

Found during the deploy: **production had been unable to log anyone in for 25 days.** `iinvsys_mongo`
exited 2026-07-23 and the API kept running against a hostname that no longer resolved, while
`/api/health` reported healthy because it never touched the database. The container healthcheck now
points at `/api/ready`. Also corrected in `backend/docker-compose.yml`: `CORS_ORIGINS` was hardcoded
`''` (serving `*` **with** `credentials: true`), `PUBLIC_APP_URL` is now set so referrer invite links
never come from the Host header, and `SERVE_LEGACY_APP: 'false'` tightens the CSP.

---

## v1.8.0 — 2026-04-29
- Excel export of leads for admin, agent and referrer, scoped per role (`e6789ca`).
- Referrer name plus auto-enrichment columns added to the export (`381b873`).

## v1.7.0 — 2026-04-29
Business-card scanning rebuilt for speed, in four passes:
- Warm worker, image preprocessing, column-aware extractor (`46a9857`).
- `tesseract.js` self-hosted; **jsQR** pre-pass so a card with a QR code skips OCR entirely (`ec30687`).
- Persistent OCR worker, idle prewarm, image downscale (`7414275`).
- jsQR fast path, 1200px OCR target, PSM 6, idle warm-up recognize (`a4680ca`).

## v1.6.0 — 2026-04-28
- Lead-capture parity for referrer accounts — 5 features (`a4f659a`).
- 6 backend RBAC gaps closed, CSS `[hidden]` override, voice-memo listener leak, success-card race,
  a11y labels (`f105763`).
- `city`, `state`, `natureOfBusiness`, `interestedIn` added to leads (`7de3a2b`).

## v1.5.1 — 2026-04-27
- Daily QA automation suite with email reporting to the QA Manager (`1690e7e`), runner fixed to
  isolate the npm cache and set `NODE_PATH` (`51f2b4d`).
- "Send Now" surfaces the real mail error instead of a literal "API error" (`24225e3`).

## v1.5.0 — 2026-04-26
Lead-addition PRDs 1–6, merged as PR #1:
- PRD 1 + 4 — confidence-scored scan fields and duplicate detection (`651f294`).
- PRD 3 Phase 1 + 5 — bulk scan queue and auto-enrichment (`696b154`).
- PRD 2 + 6 — multilingual OCR and voice-memo structured notes (`a1d962a`).
- 50 functional tests covering all six (`2a7fd93`).

## v1.4.0 — 2026-04-25 · tag `InitialRelease`
- Production hardening: auto-init admin, clean seed, CORS fix, dev credentials removed (`6b4f28a`);
  demo credentials panel removed and a post-deploy sanity check added (`8dcbe94`).
- Expo products, presenters and in-expo lead capture (`a243303`).
- Referrer lead tracking, read-only expo view, no-expiry accounts (`57589a5`); expo referrer
  credentials sheet download (`45b5b49`).
- Fixes: login catch separated from `initApp`, `initAdmin` double-hashing, CORS 500, iOS safe-area
  and modal scroll, plus 8 QA bugs.

## v1.3.0 — 2026-04-20
- Scheduled email reports and an expanded test suite (`9813cec`).
- On-premise migration plan and code-update runbook (`8de22d1`).

## v1.2.0 — 2026-04-02
- 99 functional tests across 4 new suites, 134 total (`2f77943`).
- 4 frontend bugs fixed, 102 contract tests, manual testing guide (`4ed6157`).
- On-premise hosting guide, Docker and bare-metal (`9bcec0d`).

## v1.1.0 — 2026-03-31
- Superadmin hard-delete, dynamic settings, expo referrers, OCR lead capture (`048e1ed`).
- Comprehensive loader system across all operations (`ea66f65`).
- OCR: live progress instead of a silent hang; field extraction fixed for common Indian phone
  formats.

## v1.0.0 — 2026-03-29
First deployed build of the IINVSYS Sales Dashboard — Overview, Leads (Kanban), Agents, Expos and
Analytics on the dark NeoPop design system, backed by Node.js + Express + MongoDB. Resilient Vercel
entry point, health check without DB, CSS stacking-context contrast fixes, and `DEPLOYMENT.md`.

---

## Security incidents (infrastructure, outside the release line)

| Date | Event |
|---|---|
| 2026-04-27 | Akira ransomware wiped the production `iinvsys` MongoDB via an unauthenticated public port 27018. Rebuilt from scratch; ransom not paid. Backend code hardened 2026-04-28 (CORS, JWT alg pin, login rate limit 20 → 5). |
| 2026-04-29 | **Hit again, same root cause** — the 2026-04-27 fix never reached the server's `docker-compose.yml`, so the public port stayed open. 32 leads captured on 2026-04-28 evening were lost; only a pre-burst daily backup existed. |
| 2026-04-29 | Properly hardened and verified: `27018` mapping removed, Mongo root auth enforced, API bound to `127.0.0.1:5050`, `NODE_ENV=production`, iptables DROP on 27018 as a second layer, and a **5-minute backup** cron added alongside the daily one. |

Rotation and SSH follow-ups from these incidents are still open — see below.

---

## Pending items

### Blocking

| # | Item | Detail |
|---|---|---|
| P-1 | **Installation Planning → On-Site is unreachable** | The gate requires `InstallationJob.technician`, an ObjectId ref to `User`, and there is **no `/users` endpoint**, so no client can obtain a valid id. Decision needed: add a users-list endpoint, or gate on `technicianName`. |

### Product / UX

| # | Item | Detail |
|---|---|---|
| P-2 | **Light theme** | The app is dark-only. `frontend/src/styles/global.css` defines a single `:root` NeoPop token set (`--bg #070707` …) with no `prefers-color-scheme` or `data-theme` branch. Needs a light token set, a persisted user toggle, and a re-run of the WCAG 2.1 AA contrast pass — the `--text-3`/`--text-4` values were tuned against `#070707` and will not carry over. |
| P-3 | Features not ported to v2 | OCR card scanning, QR pre-pass, bulk card capture and voice-memo notes exist only in the legacy app. Deliberate for the ERP release; needs an explicit keep-or-drop ruling. |
| P-4 | `Product.category` enum duplicated in the frontend | Hardcoded in `AdminPage` because it is not in the `/meta/pipeline` payload like every other enum. Move it there. |
| P-5 | `spenco.scoredBy` never stamped | The server sets `scoredAt` only. |

### Owner decisions (block 28 skipped tests)

| # | Question |
|---|---|
| P-6 | Does the `readonly` role read leads? (`TC-S005`, `TC-S037`) |
| P-7 | May a `manager` deactivate an agent, or is that `superadmin` only? (`TC-AG026`) |
| P-8 | Who may bulk-import leads, and what payload shape is canonical? (4 tests disagree with each other — settle together) |
| P-9 | Does `GET /api/leads` **scope** a referrer to their expo (today's behaviour, which the referrer view depends on) or **refuse** them outright? |
| P-10 | Is the validation-failure status `400` or `422`? It is `422` today; five tests assume `400`. |

Full register with re-enable conditions: `docs/requirements/06-erp-configuration-requirements.md`.

### Security / operations

| # | Item |
|---|---|
| P-11 | Rotate `MONGO_ROOT_PASS`, `JWT_SECRET` and `SMTP_PASS` — all sat in plaintext `.env` through both ransomware windows; treat as known-leaked. |
| P-12 | Rotate the `ADMIN_PASSWORD` generated at the 2026-08-17 deploy (it was shared in chat). |
| P-13 | Rotate the `balap` SSH password and **disable `PasswordAuthentication`**; move to keys. |
| P-14 | Automate TLS renewal on `sales.iinvsys.com` — `certbot` is not installed and the CentOS 8 Stream repos are broken. |
| P-15 | Same misconfiguration class on the same host, unrelated to IINVSYS but same blast radius: ChromaDB `0.0.0.0:8000`, RabbitMQ mgmt `15672`, netdata, node-exporter, cadvisor, rpcbind. |
| P-16 | `/app/mongobkp.sh` hardcodes a Mongo password in a world-readable file. |
| P-17 | Audit the other stacks on the host for the health-check pattern that hid a 25-day outage (liveness probe that never touches the database). |

### Housekeeping

| # | Item |
|---|---|
| P-18 | `package.json` versions are stale: root `1.0.0`, `backend` `1.0.0`, `frontend` `0.1.0` — none reflect v2.0.2. Set them and start tagging releases in git. |
| P-19 | `vercel.json` still routes `/` to the **legacy** app with v2 at `/v2`. The on-premise host has already cut over (`APP_BASE=/`); the Vercel config has not. |
| P-20 | 18 legacy Jest suites clear collections in `afterEach` only, so each one's first test inherits the previous suite's state — an intermittent failure with no code change. New suites must clear in `beforeEach` **and** `afterAll`. |
| P-25 | **A full `--runInBand` run intermittently stalls for ~15 minutes inside one arbitrary suite.** Observed twice on different suites (`15-audit-integration` 993 s, then `lead-filters` 864 s); each runs in 12–39 s in isolation, and `redact()` on the largest response measures 27 ms. The stall is the single shared `mongodb-memory-server` under 1,700 tests of sustained write load, not application code. It matters because a 30 s test timeout during a stall used to cascade into unrelated dup-key failures — the fixtures now return the unique-index winner instead of throwing, so a stall produces one honest timeout. Worth pinning a real mongod, or sharding the run, before CI gates merges (P-21). |
| P-21 | CI (N-11) cannot gate merges until the suite is green and pinned. |
| P-22 | **The in-app user manual (`frontend/public/manual/`) is now wrong about roles and navigation.** It documents the v2 taxonomy and the single shared sidebar; v3.0.0 replaced both. Regenerate once the portals settle — note the screenshot rate-limit trap recorded against the original 62 captures. |
| P-23 | `/api/agents` is mounted as a deprecated alias of `/api/users` so the legacy root app keeps working through the cutover. Drop it when `vercel.json` stops routing `/` to the legacy app (P-19). |
| P-24 | Phase 0 ships the Customer, Activity, Task, Approval and CoachingNote **routes with no screens** — that is deliberate (they are the substrate P1–P4 stand on), but it means the only way to exercise them today is the API or the test suite. |

### Deliberately out of scope

Recorded so they are not re-raised as gaps: multiple opportunities per contact; the internal discount
approval matrix (S4 — the framework references it without defining thresholds); a supplier /
purchase-order module behind D2; a customer-facing portal for DA and feedback signature (all
signature capture is staff-mediated); and migration from the legacy stage/source enums (superseded by
the greenfield decision — the runbook survives at `docs/requirements/archive/08-migration-notes.md`).
