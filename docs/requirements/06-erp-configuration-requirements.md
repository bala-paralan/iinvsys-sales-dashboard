# ERP Configuration Requirements — traceability

Every "ERP Configuration Requirements" bullet from the Business Process Framework (pages 14–15),
plus the CRM Dictionary's hygiene rules, with where it is implemented **and the test that proves it**.

## The rule

> **A row may only be marked ✅ by the same commit that adds the test named in `Verified by`.**
> A row with no test is 🟡 at best. Nothing is marked ✅ because someone intends to build it.

This rule exists because it was broken. An earlier revision of this document marked ~40 of the rows
below ✅ Implemented while the corresponding models, services, jobs and routes did not exist in the
repository at all. A traceability matrix that reports intent instead of fact is worse than no matrix,
because it tells the next person the work is done.

## Status key

| | Meaning |
|---|---|
| ✅ | Built, wired, and covered by the named test |
| 🟡 | Partially built — the gap is stated in the row |
| 🔧 | **Spec only.** The rule exists as data or a pure function in `backend/src/config/pipeline.js`, but nothing calls it. No model field, no endpoint, no job. |
| ⬜ | Not built |

🔧 is the most common status below and the most important to understand.
[`pipeline.js`](../../backend/src/config/pipeline.js) is a complete, high-quality 1,113-line
declarative spec — every stage table, entry gate, checklist template, enum and KPI target. It is
genuinely finished. What does not yet exist is everything that *consumes* it.

---

## Sales Module

| # | Requirement (verbatim intent) | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| S-1 | Pipeline stages: Suspect, Prospect, Engagement, Negotiation, Commercial Order — **in sequence, no skipping** | ✅ | `POST /api/leads/:id/advance` → `canAdvance()` → in-memory patch → `validateStageEntry()` → save + `stageHistory`. `422 STAGE_SKIP` on a skip, `422 TERMINAL_STAGE` out of Commercial Order. `PUT` refuses a stage change (`STAGE_CHANGE_VIA_ADVANCE`) so the gate cannot be bypassed | `tests/19-lead-advance.test.js` |
| S-4 | Mandatory field: SPENCO score at Prospect stage | ✅ | `spenco` on the model; `total`, `qualified` and `scoredAt` all derived in `pre('validate')` AND re-derived in `applyTransition` before the gate reads them. `scoredAt` — which the → Engagement gate requires — had **no writer at all**, so no lead could pass Engagement through the API; every test hid it by hand-setting the field in its fixture | `tests/19-lead-advance.test.js`, `tests/18-lead-derivations.test.js` |
| S-8 | PO document gate before Commercial Order can be marked complete | ✅ | `hasDoc:po` in the `→ commercial_order` gate. `POST /api/leads/:id/upload` puts real bytes in GridFS — until B4 the gate was undrivable through the API, and `attachments` was writable through `PUT`, so posting `{docType:'po'}` closed a deal with no purchase order anywhere. Server-owned fields are now stripped from every lead write | `tests/19-lead-advance.test.js` |
| S-10 | Stage transitions updated by the responsible owner before progression | ✅ | Every transition appends a `stageHistory` entry with actor, direction and duration; a manager override records `missingAtOverride[]` and raises a separate audit entry | `tests/19-lead-advance.test.js` |
| C-7 | Records with blank mandatory fields flagged for manager review | ✅ | `needsReview` / `reviewIssues[]` derived on every write; `GET /api/leads/hygiene` returns the worklist plus a breakdown by rule | `tests/19-lead-advance.test.js`, `tests/18-lead-derivations.test.js` |
| S-2 | Mandatory field: stage owner | 🟡 | `Lead.ownerUser` exists on the model (B1a) but nothing populates it yet — `stageHistory.by` carries the actor meanwhile | — |
| S-3 | Mandatory field: date of entry | ✅ | `Lead.createdAt` + `stageEnteredAt`, maintained by `applyTransition`; stage age feeds `stage_age_exceeded` | `tests/19-lead-advance.test.js` |
| S-5 | Mandatory field: estimated PO value | ✅ | `Lead.value`; `positiveNumber` gate on `→ engagement` and `→ commercial_order`, evaluated by the advance endpoint | `tests/19-lead-advance.test.js` |
| S-6 | Mandatory field: next action date | ✅ | `Lead.nextAction` / `nextFollowUpDate`; `futureDate` gate from `→ prospect` onward | `tests/19-lead-advance.test.js` |
| S-7 | Inactivity alert: auto-flag to Sales Manager at 30+ days no activity | ✅ | `utils/jobs/salesHygiene.js` → `salesInactivity()`, 07:00 IST nightly via `scheduler.initSweeps()`. Addressed to holders of `lead.gate_override`, with a 7-day cooldown so a dormant lead is not re-reported every morning | `tests/20-notifications-sweeps.test.js` |
| S-9 | Auto-trigger: Work Order creation + Delivery Manager notification on Commercial Order confirmation | ✅ | `handoffService.createWorkOrderForLead()`, fired by the `→ commercial_order` transition; notifies holders of `workorder.accept` at critical severity. A handoff failure never fails the sale — it is logged and repaired by the nightly sweep | `tests/21-handoff-workorder.test.js` |

## Delivery Module

| # | Requirement | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| D-1 | Workflow stages: Order Review, Procurement / Stock, Packing, Dispatch, Delivery & Handover | ✅ | `WorkOrder.stage` over `DELIVERY_STAGES`, advanced through the shared `stageService` contract (`POST /api/workorders/:id/advance` + gate preflight) | `tests/23-workorder-routes.test.js` |
| D-2 | Delivery date mandatory; set and confirmed within 1 business day of Work Order receipt | ✅ | `POST /:id/commit-date` (once, with customer ack); the two A11 clocks swept hourly 09:00–19:00 IST by `utils/jobs/deliverySweeps.js` | `tests/23-workorder-routes.test.js` |
| D-3 | Delay notification rule: auto-alert to Sales when a revised date differs from the confirmed date | ✅ | `POST /:id/delay` notifies holders of `workorder.accept` + `lead.gate_override`; late notices escalate at critical severity | `tests/23-workorder-routes.test.js` |
| D-4 | Delay reason code mandatory when a delay is recorded | ✅ | `DelayEventSchema.reasonCode` enum-required; `POST /:id/delay` answers 422 without one | `tests/23-workorder-routes.test.js` |
| D-5 | Document vault: packing list, delivery note, invoice, DA linked to the Work Order | ✅ | `POST /:id/upload` (multer → `fileStore`, magic-byte validated) onto `WorkOrder.attachments[]` | `tests/23-workorder-routes.test.js` |
| D-6 | DA upload gate: signed DA **with photo** mandatory before Delivered | ✅ | `POST /:id/deliver` evaluates `DELIVERED_REQUIRES`; `422 DA_GATE_FAILED` names what is missing | `tests/23-workorder-routes.test.js` |
| D-7 | Auto-trigger: Installation Work Order created on DA upload and confirmation | ✅ | `handoffService.createInstallationJobForWorkOrder()` fired by `POST /workorders/:id/deliver` | `tests/24-installation.test.js`, `tests/23-workorder-routes.test.js` |
| D-8 | Target delivery date confirmed to customer and acknowledged | ✅ | `commit-date` records `customerAck{acknowledged, at, method}`; the `→ procurement` gate requires it | `tests/23-workorder-routes.test.js` |
| D-9 | 48-hour advance notice of any delay | ✅ | `noticeHours` computed against the ORIGINAL committed date (A12, runtime-configurable); a breach is recorded + escalated, never rejected | `tests/23-workorder-routes.test.js` |
| D-10 | Monthly performance review of delay reason codes | ✅ | The **Delay Reason Codes** sheet — one row per code, sorted by frequency, with late-notice count, mean notice hours and mean slip. `GET /api/kpis/delivery` carries the headline compliance figure | `tests/26-excel-export.test.js`, `tests/25-kpis.test.js` |

## Installation & Customer Service Module

| # | Requirement | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| I-1 | Workflow stages: Planning, On-Site, Commissioning, Handover & Training, Support Window, Feedback | ✅ | `InstallationJob.stage` over `INSTALL_STAGES`, advanced through the shared `stageService` contract | `tests/24-installation.test.js` |
| I-2 | Checklist engine: stage-specific checklists fully completed before the stage can progress | ✅ | Templates instantiated onto the job at Handoff 2 (not resolved live, so a job keeps the items its technician ticked); `checklistDone` / `checklistSigned` gate each advance | `tests/24-installation.test.js` |
| I-3 | Feedback Form auto-dispatch within 14 days of Handover Certificate upload | ✅ | `utils/jobs/installationSweeps.js` → `feedbackDispatchSweep`, 07:30 IST daily | `tests/24-installation.test.js` |
| I-4 | Reminder sent if not returned in 7 days | ✅ | Same sweep — 7 days from **dispatch**, not handover (A14), or the reminder could fire before some dispatches | `tests/24-installation.test.js` |
| I-5 | CSAT dashboard: real-time visibility by job, technician and period | ✅ | `GET /api/installations/csat?groupBy=technician\|job\|period` — mean CSAT + first-time-right rate per group | `tests/24-installation.test.js` |
| I-6 | Escalation rule: auto-alert to Customer Service Manager if CSAT below 3.0 | ✅ | `POST /:id/feedback` raises a critical notification synchronously and sets the corrective-action clock | `tests/24-installation.test.js` |
| I-7 | Process closure gate: record cannot be Closed until the Feedback Form is received and logged | ✅ | `POST /:id/close` evaluates `CLOSED_REQUIRES`; `422 CLOSURE_GATE_FAILED` names what is missing | `tests/24-installation.test.js` |
| I-8 | Corrective action plan documented within 5 business days when CSAT < 3.0, before closing | ✅ | `correctiveAction.dueAt = addBusinessDays(now, 5)`; `requiredIfCsatBelow:3` in the closure gate blocks closure until documented; overdue plans swept daily | `tests/24-installation.test.js` |
| I-9 | Commissioning Test Report signed by technician **and countersigned by customer** | ✅ | Both timestamps required by the `→ handover_training` gate; a countersignature must name the signatory | `tests/24-installation.test.js` |
| I-10 | Proactive check-in within 7 days of handover | ✅ | `postSupport.checkInDueAt` set on entering the support window; `checkInSweep` flags overdue | `tests/24-installation.test.js` |
| I-11 | Issue escalation with a defined response SLA | ✅ | `postSupport.issues[]` with per-issue `slaHours`; breach flagged on resolve and swept while open | `tests/24-installation.test.js` |

## Handoffs

| # | Requirement | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| H-1 | Handoff 1 enforced as a mandatory gate — Delivery not activatable without a confirmed & verified PO | ✅ | Work Orders are created only by `handoffService`, itself reachable only through the PO-gated `→ commercial_order` transition. A failed gate creates nothing | `tests/21-handoff-workorder.test.js` |
| H-2 | Handoff 2 enforced as a mandatory gate — Installation not activatable without the signed DA | ✅ | Installation Jobs are created only by `handoffService`, reachable only through the DA-gated `deliver` endpoint | `tests/24-installation.test.js` |
| H-3 | Both handoffs idempotent under retry | ✅ | Each: a back-pointer + a unique index, with the duplicate-key race resolved by returning the winner; nightly repair passes (`ensureWorkOrderExists`, `ensureInstallationJobExists`) close gaps left by non-fatal failures | `tests/21-handoff-workorder.test.js`, `tests/24-installation.test.js` |

## CRM Dictionary hygiene rules

`pipeline.hygieneIssues()` computes the codes for C-1 through C-5, C-7 and C-8. B1a added every
`Lead` field it reads, and the `pre('validate')` hook now calls it on **every** write — including
`insertMany`, which is how bulk import and bulk card scan create leads and is where a `pre('save')`
implementation would have silently skipped them.

| # | Requirement | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| C-1 | Close Date updated immediately when it changes; expired close date flagged | ✅ | `Lead.expectedCloseDate` + `close_date_expired` in `reviewIssues[]`; counted by `GET /api/kpis/sales` as `leads_close_date_expired` | `tests/18-lead-derivations.test.js`, `tests/25-kpis.test.js` |
| C-2 | Probability not overridden above the stage default by more than 15 points without a note | ✅ | `Lead.probability` + `probabilityOverrideNote`; the stage default is stamped on arrival by `applyTransition` | `tests/18-lead-derivations.test.js`, `tests/19-lead-advance.test.js` |
| C-3 | Every open deal has a future follow-up date | ✅ | `Lead.nextFollowUpDate`; `futureDate` gate from `→ prospect` onward, and `followup_missing` / `followup_past` in the review queue | `tests/18-lead-derivations.test.js`, `tests/19-lead-advance.test.js` |
| C-4 | Follow-up not more than 14 days out without a reason | ✅ | `followup_far_unexplained`, threshold from `FOLLOWUP_MAX_DAYS_AHEAD` | `tests/18-lead-derivations.test.js` |
| C-5 | Minimum one note per week for deals at Engagement and above | ✅ | `stale_notes` from `hygieneIssues()`, surfaced by `weeklyNote()` in the nightly sweep — to the deal's `ownerUser`, falling back to managers for referrer-captured leads with no linked User | `tests/20-notifications-sweeps.test.js` |
| C-6 | Duplicate prevention — search by phone before creating a contact | 🟡 | `POST /api/leads/check-duplicate` and `utils/matching.js` (Jaro-Winkler) exist and work, and the client calls them. It is **advisory only** — `POST /api/leads` never returns 409, so the check is bypassable by any direct API call. | `tests/prd-features.test.js` (advisory behaviour only) |
| C-8 | Zone auto-filled from state | ✅ | `deriveZone()` in the `pre('validate')` hook; unrecognised states leave it blank and raise `zone_underived` rather than guessing | `tests/18-lead-derivations.test.js` |
| C-9 | Opportunity Name follows `[Company] — [Product/Package] — [Mon YYYY]` | ✅ | Composed in `pre('validate')` only when left blank, so a hand-written name survives | `tests/18-lead-derivations.test.js` |
| C-10 | Phone is a 10-digit mobile | 🟡 | `phone_format_invalid` now reaches the review queue via `reviewIssues[]`, so a bad number is visible. The route validator is still only `notEmpty()` — flagged, not rejected, which is deliberate for expo capture but should be an explicit decision | `tests/18-lead-derivations.test.js` |

## Foundation — what genuinely is built

Recorded separately so the 🔧 rows above are not read as "nothing exists".

| Component | Status | Verified by |
|---|---|---|
| `config/pipeline.js` — 3 stage tables, entry gates, 16-test interpreter, SPENCO, hygiene rules, `KPI_TARGETS`, `STATE_TO_ZONE`, `serialize()` | ✅ | `tests/08-pipeline-rules.test.js` |
| `config/pipelineRuntime.js` — 10 rules resolved from Settings over compiled-in defaults (R-2), strict validation, boot-time install | ✅ | `tests/08-pipeline-rules.test.js` |
| `config/permissions.js` — 28 permissions × 13 roles | ✅ | `tests/07-operational-roles.test.js` |
| `middleware/rbac.js` — `requirePermission()`, `can()`, `allowReferrerOr()`, corrected `ROLE_LEVEL` | ✅ | `tests/07-operational-roles.test.js`, `tests/10-role-ladder.test.js` — now guarding every route in the delivery, installation, notification and KPI trees |
| Referrer expo scoping — `GET /api/expos[/:id]` limited to the referrer's own expo | ✅ | `tests/10-role-ladder.test.js` |
| `User.role` enum widened to all 13 roles; `REGISTERABLE_ROLES` wired into register | ✅ | `tests/07-operational-roles.test.js` |
| `GET /api/meta/pipeline` + `/api/meta/permissions` | ✅ | `tests/13-meta-endpoint.test.js` |
| `utils/businessDays.js` — Asia/Kolkata business-day arithmetic, plus IST reporting windows | ✅ | `tests/12-business-days.test.js`, `tests/25-kpis.test.js` — drives both SLA clocks, the install lead time and every KPI window |
| `utils/pagination.js` — clamped paging (N-1), applied to all 4 list controllers | ✅ | `tests/11-pagination.test.js` |
| `AuditLog` + `services/auditService.js` (R-7) — append-only; wired into sign-in and every destructive path | ✅ | `tests/14-audit-log.test.js`, `tests/15-audit-integration.test.js` |
| `utils/fileStore.js` (N-6 / A25) — GridFS default, `local` driver refuses to run on Vercel, magic-byte validation, virus-scan hook | ✅ | `tests/16-file-store.test.js` |
| `models/schemas/{spenco,stageHistory,attachment}.js` | ✅ | Embedded by `Lead`, `WorkOrder` and `InstallationJob`; `stageHistory` is what makes every Sales conversion KPI computable |

## KPIs — doc 05

`GET /api/kpis/{sales|delivery|installation}` plus `/summary`, all under `kpi.read`. Targets, labels,
units and directions come from `pipeline.KPI_TARGETS`; nothing numeric is written in the controller.

| # | Requirement | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| K-1 | All 21 KPIs served with numerator, denominator, target and status | ✅ | `services/kpiService.js`; every rate asserted against a hand-computed fixture, because a KPI fails by being plausibly wrong rather than by crashing | `tests/25-kpis.test.js` |
| K-2 | `status` = ok / warn (within 10%) / breach, respecting each KPI's direction | ✅ | `statusOf()`; `null` — never `ok` — when a KPI has no target or no data, so an empty month reports 21 unmeasured rather than 21 green | `tests/25-kpis.test.js` |
| K-3 | Default window is the trailing calendar month, overridable | ✅ | `resolveWindow()`; half-open `[from, to)` in Asia/Kolkata, `?period=current_month` for month-to-date, `?to=` inclusive of that day | `tests/25-kpis.test.js` |
| K-4 | Conversion rates computed from `stageHistory`, not current stage | ✅ | Counts **leads**, not entries, and numerators count only genuine transitions — a lead created mid-funnel reached the stage but never converted into it. Both bugs put the rate above 100%; the second was caught at 140% on live seeded data, not by the unit tests | `tests/25-kpis.test.js` |
| K-5 | Manager hygiene counters on the sales dashboard | ✅ | `salesHygieneCounters()`, attached to `/api/kpis/sales` only | `tests/25-kpis.test.js` |
| K-6 | CSAT dashboard by job / technician / period | ✅ | `GET /api/installations/csat`; its target lookup was reading `KPI_TARGETS.csat` (undefined — the table is keyed by process first) and reported no target at all | `tests/24-installation.test.js` |
| K-7 | Excel export rewritten for the three-process model | ✅ | Six sheets — KPI Summary, Sales Pipeline, Agent Performance, Delivery, Delay Reason Codes, Installation & CS. The KPI sheet calls `kpiService`, so there is one implementation of "win rate", not two | `tests/26-excel-export.test.js` |
| K-8 | The export is scoped to the caller | ✅ | `scopeFor(user)`. The old version pulled **every** lead whoever asked — an agent now gets their own leads and no delivery or installation sheets; a technician gets their own jobs. A role with nothing to export is refused rather than sent a zero-sheet file Excel calls corrupt | `tests/26-excel-export.test.js` |
| K-9 | The export is reachable without being an email recipient | ✅ | `GET /api/reports/export.xlsx` under `kpi.read`. Previously the workbook could only be *mailed*, so a manager had to add themselves to the recipient list to see this month's numbers | `tests/26-excel-export.test.js` |
| K-11 | The R-2 rules are editable at runtime, with validation | ✅ | `GET/PUT /api/settings/pipeline`. The generic `PUT /api/settings` validated nothing, so a superadmin could store `spenco.minTotal: "eighteen"` — accepted silently, then rejected by the STRICT loader at the next production boot. It now refuses pipeline keys and points at the validated endpoint | `tests/27-pipeline-settings.test.js` |
| K-12 | A rule change takes effect without a restart | ✅ | Validate → persist → `loadRules({strict:true})`. Without the re-install a change sat in the database while the UI reported it saved and the gates kept using the old value; the version hash also moves, so cached gate checklists are dropped | `tests/27-pipeline-settings.test.js` |
| K-13 | Rule changes are audited with their previous value | ✅ | `settings.rule_change` per key, carrying actor and prior value — "who moved the SPENCO threshold" is the question the audit log is opened to answer | `tests/27-pipeline-settings.test.js` |
| K-10 | No N+1 in the report path | ✅ | Agent performance and the funnel are each one `$group`; `GET /api/reports/preview` likewise. It was previously one query per agent plus a full document scan per agent, and two queries per stage | `tests/26-excel-export.test.js` |

## Non-functional (R-6)

| # | Requirement | Status | Implementation / gap | Verified by |
|---|---|---|---|---|
| N-1 | Pagination and bounds on every collection endpoint | ✅ | `utils/pagination.js`, `MAX_LIMIT = 200` | `tests/11-pagination.test.js` |
| N-2 | Every route carries an authorisation decision | ✅ | `requirePermission` on every delivery, installation, KPI and notification route | `tests/07-operational-roles.test.js` |
| N-2b | A user-specific payload is never cached by URL | ✅ | `GET /api/meta/pipeline` embeds `me.role` / `me.permissions` and was `Cache-Control: private, max-age=300`. `private` only stops SHARED caches — the browser's own cache keys on the URL and ignores `Authorization`, so on a shared expo laptop the next user to sign in rendered the PREVIOUS user's permissions for five minutes. Now `no-store` + `Vary: Authorization` | `tests/13-meta-endpoint.test.js` |
| N-3 | Structured JSON logging with a request id; `/api/ready` | ✅ | `middleware/requestContext.js`; production emits one JSON object per request, development keeps morgan's readable line. `/api/health` never touches the database (liveness) and `/api/ready` pings it (readiness) — the single old endpoint reported "healthy" with Mongo unreachable and every request failing | `tests/28-platform.test.js` |
| N-4 | Env validated at boot; the RATE_LIMIT name mismatch fixed | ✅ | `config/env.js`, called before anything binds a port. With no `JWT_SECRET` the process used to start, report healthy, and 500 on every login — green monitoring on an unusable app. Production additionally rejects short secrets, well-known default passwords, blank `CORS_ORIGINS` (which means `'*'` with credentials) and `local` file storage on Vercel | `tests/28-platform.test.js` |
| N-5 | No secret in a response body or an export | ✅ | `models/Invite.js` — single-use, expiring, stored only as a SHA-256 hash. The referrer sets their own password at `/invite/:token`; nobody else, including the manager who invited them, ever knows it. Re-inviting kills the previous link | `tests/29-invites.test.js` |
| N-6 | Upload validation, virus-scan hook, GridFS | ✅ | `utils/fileStore.js` | `tests/16-file-store.test.js` |
| N-7 | CSP without `unsafe-inline`; SRI on third-party JS | ✅ | A real policy in `helmet()`: `script-src` never gets `unsafe-inline` or `unsafe-eval`, `frame-ancestors`/`object-src` are `'none'`. The legacy CDN allowance is scoped behind `SERVE_LEGACY_APP` and collapses at cutover; Chart.js and SheetJS are now SRI-pinned | `tests/28-platform.test.js` |
| N-8 | Consistent response envelope | ✅ | The 404 handler and both rate limiters now answer `{success, code, message}` like everything else. They used `error`, which the client never reads — a rate-limited user saw "Request failed (429)" while the real text sat in an ignored key | `tests/28-platform.test.js` |
| N-9 | Multi-write operations are transactional | 🟡 | Both handoffs are idempotent and self-repairing rather than transactional — a deliberate choice, since `mongodb-memory-server` and standalone Mongo have no transactions. `mergeLead` and `bulkImport` remain non-atomic | `tests/21-handoff-workorder.test.js` |
| N-10 | WCAG 2.1 AA | 🟡 | `--text-4` measured **2.58:1** on `--bg` (the requirement doc estimated 3.2:1) and carried 11px metadata — moved to 4.56:1, with `--text-3` raised to 6.23:1 to keep the levels distinct. `components/Modal.tsx` adds a focus trap, focus restore and Escape to both dialogs. Not yet audited: keyboard reachability of the kanban, and the legacy app's remaining modals | — |
| N-11 | CI required to merge | 🟡 | `.github/workflows/ci.yml` — backend suite (in band, which is mandatory), frontend typecheck + build, `npm audit --audit-level=high`, and a guard rejecting committed `.env`/keys and browser-delivered default credentials. Playwright E2E is not in it: the existing suite fakes login by toggling CSS classes and would have to be rewritten first | — |
| N-12 | Telemetry retention | ✅ | TTL index on `timestampUtc`, 180 days by default via `TELEMETRY_RETENTION_DAYS` | `tests/28-platform.test.js` |

## Skipped-test register

The suite is green, but **28 tests are `it.skip`**, and a skip that nobody revisits is just a
deleted test with extra steps. Each carries its reason at the call site; this is the index.

Ground rule: **nothing here is a live security hole.** Every access-model row is a case where the
application is *more* restrictive than the test, except the bulk-import group — and that one is not
a privilege escalation, because an agent may already create leads one at a time.

| Group | Count | Why skipped | Re-enable when |
|---|---|---|---|
| `TC-AN006`–`012`, `TC-AN019` | 8 | Controller returns `data.kpi.{...}`; tests assert a flat shape. The frontend never calls `/api/analytics/*` — these tests are the endpoint's only consumer | **B4** replaces it with `/api/kpis/*`; re-point at [`05-kpi-definitions.md`](05-kpi-definitions.md) |
| `TC-A001`–`004`, `TC-A010` | 5 | Assert `400` for validation; the app answers `422` everywhere, consistently | **N-8** settles the response envelope |
| `TC-S023`–`S025` | 3 | **The defence works** — operator injection is rejected by `isEmail()`. They fail only because they accept `[400,401]` and the app answers `422` | **N-8** |
| `TC-A011` | 1 | Asserts the body doesn't match `/password/`, but the legitimate message is *"Invalid email or password"* | Rewrite to assert absence of a password **field** |
| `TC-A035`, `TC-E017` | 2 | Assert routes that have never existed (`PUT /auth/change-password`, `GET /expos/:id/stats`) | Rewrite against the real routes |
| `TC-S005`, `TC-S037` | 2 | **Open decision** — may `readonly` read leads? `GET /api/leads` requires `agent` | Owner rules on the `readonly` scope. `TC-S037` is also the regression for the real `.lean()` `__v` leak |
| `TC-AG026` | 1 | **Open decision** — may a `manager` soft-delete an agent? Currently `superadmin` only | Owner ruling |
| `TC-EX033` | 1 | `GET /api/leads/bulk` answers `400` (CastError on `:id`) rather than `404/405`. Not a 500 | **N-8** |
| bulk-import group | 4 | **Open decision** — who may `POST /api/leads/bulk`, and what payload shape is canonical? Four tests disagree with each other | Owner ruling; settle all four together |

### Five decisions needed from an owner

1. Does `readonly` read leads? (`TC-S005`, `TC-S037`)
2. May a `manager` deactivate an agent, or is that `superadmin` only? (`TC-AG026`)
3. Who may bulk-import leads? (4 tests)
4. Does `GET /api/leads` **scope** a referrer to their expo (today's behaviour, which the referrer
   view depends on) or **refuse** them outright?
5. Is the API's validation-failure status `400` or `422`? It is `422` today; five tests assume `400`.

## Deliberately not in this release

| Requirement | Why |
|---|---|
| ⬜ Multiple opportunities per contact | Neither document requires it; the dictionary puts Lead Source and Deal Value on the same record. The flat field set makes later extraction mechanical (assumption A16) |
| ⬜ Internal approval matrix for discounts (S4) | The framework references "the approval matrix" without defining thresholds. `deal.approve_deviation` exists as a permission; the matrix itself needs client input |
| ⬜ Supplier / purchase-order module behind D2 | The framework says "raise a supplier purchase order" but defines no supplier process. `stockConfirmedAt` records the outcome; procurement itself stays external |
| ⬜ Customer-facing portal for DA / feedback signature | All signature capture is staff-mediated: a photo or PDF upload plus a recorded signatory name |
| ⬜ Data migration from the legacy stage/source enums | Superseded by the greenfield decision. The runbook is preserved at [`archive/08-migration-notes.md`](archive/08-migration-notes.md) should the migration path be revived |
