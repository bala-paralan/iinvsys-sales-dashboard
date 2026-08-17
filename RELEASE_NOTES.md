# IINVSYS — Release Notes

Lead, Agent & Expo Management Platform → three-process ERP (Sales · Delivery · Installation & CS).

**Current release: v2.0.3** — 2026-08-17 · branch `release/erp-three-process` · commit `fb50458`

> **On version numbers.** This repository has never carried semver tags — the only git tag is
> `InitialRelease` (`6b4f28a`, 2026-04-25). The versions below are assigned retroactively in this
> document from the commit history, so they are a reading of the history, not a record that
> already existed. The `version` fields in `package.json` are stale and do not match
> (see [Pending items](#pending-items) → *Housekeeping*).

---

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
| P-21 | CI (N-11) cannot gate merges until the suite is green and pinned. |

### Deliberately out of scope

Recorded so they are not re-raised as gaps: multiple opportunities per contact; the internal discount
approval matrix (S4 — the framework references it without defining thresholds); a supplier /
purchase-order module behind D2; a customer-facing portal for DA and feedback signature (all
signature capture is staff-mediated); and migration from the legacy stage/source enums (superseded by
the greenfield decision — the runbook survives at `docs/requirements/archive/08-migration-notes.md`).
