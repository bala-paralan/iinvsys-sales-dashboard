# IINVSYS Sales Dashboard — Automation Testing Strategy

> **Owner:** QA Manager — balap@iinvsys.com
> **Cadence:** Daily, 06:00 IST (00:30 UTC)
> **Delivery:** Automated email with HTML summary + JUnit XML + Playwright HTML attachments
> **Last revised:** 2026-04-27

---

## 1. Goals & Non-Goals

### Goals
1. **Catch regressions before users do** — every API contract, RBAC rule, lead-flow behaviour, and UI breakpoint must run unattended every 24 h.
2. **Single dashboard for QA** — one daily email tells the QA Manager pass/fail counts, slow tests, new failures, and links to artifacts.
3. **Block merges on red** — the same suite that runs nightly also runs on every PR via the test runner script.
4. **Repeatable on any host** — runs on a developer Mac, on the on-premise Docker host, or in CI without code changes.

### Non-Goals
- Load / soak testing (handled separately by k6 in `MIGRATION_PLAN.md`).
- Pen-testing / OWASP automated scans (out of scope; quarterly manual review).
- Visual regression with pixel diffs (deferred — current Playwright suite asserts structure, not pixels).

---

## 2. Test Pyramid for This Codebase

```
                ┌──────────────────────────┐
   E2E + UI →   │  Playwright (Chromium)   │   ~25 specs · 4 viewports · 90 s
                ├──────────────────────────┤
   Integration  │  Jest + Supertest +      │   ~280 specs (HTTP layer w/
                │  mongodb-memory-server   │   in-memory MongoDB) · 90 s
                ├──────────────────────────┤
   Unit         │  Pure Jest               │   model virtuals, matching utils,
                │                          │   response shapers · 30 s
                ├──────────────────────────┤
   Smoke        │  scripts/sanity-check.sh │   curl-based, prod URL · 15 s
                └──────────────────────────┘
```

| Layer | Where it lives | Runner | Target run-time | Failure budget |
|---|---|---|---|---|
| Unit | `backend/tests/*.test.js` (small `describe` blocks for utils + models) | `jest` | < 30 s | 0 |
| Integration (HTTP) | `backend/tests/0?-*.test.js`, `frontend-contracts.test.js`, `prd-features.test.js` | `jest --runInBand` | < 120 s | 0 |
| UI E2E (responsive) | `tests/ui/responsive.spec.js` | `@playwright/test` | < 120 s | 0 (1 retry allowed) |
| Smoke (post-deploy) | `scripts/sanity-check.sh` | bash + curl | < 30 s | 0 |
| Daily aggregate | `scripts/daily-qa-report.sh` | bash | < 8 min | n/a (always emails) |

---

## 3. Coverage Matrix — What We Test

### 3.1 Backend (Node + Express + MongoDB)

| Module | File | Layer | Critical paths covered |
|---|---|---|---|
| Auth | `auth.test.js`, `01-auth-security.test.js` | Integration | login, /me, password change, JWT expiry, brute-force rate-limit, bcrypt rounds, RBAC on /register |
| Agents | `agents.test.js`, `02-leads-agents.test.js` | Integration | CRUD, soft vs hard delete, stats aggregation, agent-scoping middleware |
| Leads | `leads.test.js`, `lead-filters.test.js`, `02-leads-agents.test.js` | Integration | CRUD, agent scoping, bulk import, kanban stage transitions, model virtuals (fullName, daysInStage), 34 filter combinations, pagination |
| Products | `products.test.js`, `03-products-expos-settings.test.js` | Integration | CRUD, SKU uniqueness, soft delete |
| Expos | `expos.test.js`, `03-products-expos-settings.test.js` | Integration | CRUD, referrer attribution, auto-status hook, ROI calc |
| Analytics | `analytics.test.js`, `04-analytics-reports.test.js` | Integration | KPI overview, lead trends, expo ROI, conversion funnel |
| Reports / Scheduler | `reports.test.js`, `04-analytics-reports.test.js` | Integration | xlsx generation, email scheduling, template rendering, cron trigger |
| Settings | `settings.test.js`, `03-products-expos-settings.test.js` | Integration | list, update, get-by-key, role-gated mutations |
| PRD features (1-6) | `prd-features.test.js`, `02-leads-agents.test.js` | Integration | OCR ingest, voice memo → structured note, bulk scan queue, auto-enrichment, multilingual OCR |
| Frontend contracts | `frontend-contracts.test.js` | Integration | every JSON shape `app.js` consumes — 102 specs |
| Performance + edge | `05-performance-exceptions.test.js` | Integration | N+1 detection, large-payload limits, malformed input, race conditions on stage transitions |
| Regression | `06-regression-contracts.test.js` | Integration | snapshot of public API shapes (BUG-01..BUG-04 fixed regressions stay fixed) |

### 3.2 Frontend (Vanilla SPA + Chart.js)

| Concern | File | Coverage |
|---|---|---|
| Responsive layout | `tests/ui/responsive.spec.js` | 4 viewports (375 / 430 / 768 / 1440), 5 pages, modals, sidebar toggle, button hit-targets ≥ 44 px, no horizontal overflow |
| Auth / nav | `tests/ui/responsive.spec.js` `bypassAuth()` helper | login → app transition, page swap via `data-page` |
| Forms | (gap — see §6) | New Lead modal 4-field capture, validation messages |
| Charts render | (gap — see §6) | Chart.js donut/line/bar mount on each viewport without console errors |
| Accessibility | (gap — see §6) | axe-core sweep per page (target: zero serious/critical) |

### 3.3 Cross-cutting

| Concern | Tool | Where |
|---|---|---|
| Static analysis | none currently — see §6 | proposed: `eslint` + `prettier --check` |
| Secret scan | none currently — see §6 | proposed: `gitleaks` in pre-commit + daily |
| Dep vulnerabilities | `npm audit` | daily script step 0 |
| Smoke (prod) | `scripts/sanity-check.sh` against `https://sales.iinvsys.com:8413` | daily script step 5 |

---

## 4. Test Data & Environment Discipline

- **Database:** `mongodb-memory-server` spun up once in `tests/helpers/globalSetup.js`. Every suite resets collections in `afterEach`. **Never** point the test runner at a real MongoDB.
- **Auth fixtures:** `tests/helpers/testUtils.js` mints JWTs for `admin`, `manager`, `agent` roles — every protected endpoint must be hit with at least one allowed and one denied role.
- **Seed parity:** the daily smoke step re-runs `npm run seed` on a throwaway DB and asserts seed counts (6 users / 6 agents / 5 products / 3 expos / 15 leads). If `seed.js` drifts from the schema, this fails first.
- **Time / TZ:** Jest timeouts are 30 s globally. Tests that compare dates must use UTC ISO strings — never local `Date.toString()`.
- **Browsers:** Playwright pinned via `.playwright-browsers/` (already gitignored, 360 MB). The runner verifies the dir exists; if missing it `npx playwright install chromium` once.

---

## 5. The Daily Run

### 5.1 Pipeline

```
┌─ 00:30 UTC (06:00 IST) launchd / cron / GHA fires
│
├─ scripts/daily-qa-report.sh
│   ├─ 0. preflight: node --version, mongo memory bin OK, disk free > 1 GB
│   ├─ 1. cd backend && npm ci --omit=optional               (~30 s)
│   ├─ 2. npm audit --audit-level=high --json                 (~5 s)
│   ├─ 3. npm test -- --json --outputFile=../qa-output/jest.json
│   │       JUnit + JSON reporters; never aborts on failure   (~120 s)
│   ├─ 4. cd .. && npx playwright test --reporter=json,html   (~120 s)
│   │       writes qa-output/playwright.json + playwright-report/
│   ├─ 5. bash scripts/sanity-check.sh https://sales.iinvsys.com:8413
│   │       -> qa-output/sanity.txt                           (~15 s)
│   ├─ 6. node scripts/qa-report-builder.js
│   │       merges jest+pw+sanity+audit -> qa-output/report.html
│   ├─ 7. node scripts/qa-email-sender.js
│   │       sends report.html + attachments to balap@iinvsys.com
│   └─ 8. archive qa-output/ -> ~/.iinvsys-qa-archive/YYYY-MM-DD/
│
└─ exit 0 (always — failures are reported, not raised — except step 7)
```

### 5.2 Email contents (what `balap@iinvsys.com` receives)

**Subject:** `[IINVSYS QA] {{date}} — {{passCount}}/{{total}} pass · {{failCount}} fail · {{durationSec}}s`

**HTML body** (top-down):
1. **Headline tile** — green / amber / red based on overall result
2. **Score table** — per layer: Unit, Integration, UI, Smoke, npm-audit
3. **New failures** — any test that passed yesterday and failed today (diff vs `~/.iinvsys-qa-archive/<yesterday>/jest.json`)
4. **Slowest 10 tests** — for catching perf regressions
5. **Flaky tests** — tests that passed only on retry
6. **Open vulnerabilities** — `npm audit` high/critical counts with package names
7. **Smoke check** — table of 6 production endpoints with status codes
8. **Links** — JUnit XML, Playwright HTML report, raw logs (all attached)

**Attachments:**
- `jest-junit.xml` (parseable by Jenkins / TestRail / Xray)
- `playwright-report.zip` (interactive HTML w/ traces & screenshots)
- `qa-summary.csv` (one row per test, for QA Manager's spreadsheet)
- `sanity.txt` (production smoke output)

### 5.3 Failure routing

- **Any test fails** → email is amber/red with the failing test names in body. Run still exits 0 so the schedule keeps firing.
- **Email send fails** → script writes `qa-output/email.error` and exits 2 — surfaced via `launchd`'s `StandardErrorPath` / GHA failure.
- **Smoke fails (prod down)** → email subject is prefixed `🚨 PROD DOWN —` so it sorts to the top of inbox.

---

## 6. Known Coverage Gaps & Hardening Roadmap

| # | Gap | Severity | Proposed test | Owner | ETA |
|---|---|---|---|---|---|
| G1 | Frontend forms (New Lead modal validation, error toasts) | High | Playwright spec `tests/ui/forms.spec.js` — fill / submit / assert toast | FE | wk-1 |
| G2 | Chart.js mount + no console errors | Medium | Playwright spec `tests/ui/charts.spec.js` — assert canvases exist + `page.on('console')` is clean | FE | wk-1 |
| G3 | Accessibility (axe-core) | Medium | `@axe-core/playwright` integration, fail on serious/critical | FE | wk-2 |
| G4 | Static analysis | Medium | Add `eslint`, `prettier --check`, run as step 0a in daily script | BE | wk-1 |
| G5 | Secret scan | Medium | `gitleaks detect --no-banner` in step 0b | DevOps | wk-2 |
| G6 | Visual regression | Low | `@playwright/test` `toHaveScreenshot()` w/ baselines, gated by env var | FE | wk-4 |
| G7 | Real-DB integration | Medium | Optional `INTEGRATION_REAL_DB=1` job that runs against staging MongoDB nightly | BE | wk-3 |
| G8 | API load smoke | Low | k6 `scripts/k6-smoke.js` 30 RPS for 60 s, alert on p95 > 500 ms | DevOps | wk-4 |

Each gap is tracked as a TODO in this file — closing one means deleting the row.

---

## 7. How To Run It Locally

```bash
# One-shot full daily run (writes qa-output/, sends email)
bash scripts/daily-qa-report.sh

# Skip email (dry-run during development)
QA_REPORT_DRY_RUN=1 bash scripts/daily-qa-report.sh

# Skip slow layers (UI + smoke) during quick iteration
QA_REPORT_SKIP_UI=1 QA_REPORT_SKIP_SMOKE=1 bash scripts/daily-qa-report.sh

# Just run the Jest suite the way CI does
cd backend && npm test

# Just run the Playwright suite
npm run test:ui
```

---

## 8. Scheduling (pick **one** based on host)

The repo ships templates for all three; `scripts/install-schedule.sh` will install the right one after you confirm.

### Option A — macOS launchd (recommended for the dev Mac)
File: `scripts/com.iinvsys.qa-daily.plist`
Install:
```bash
cp scripts/com.iinvsys.qa-daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.iinvsys.qa-daily.plist
launchctl list | grep iinvsys
```
Logs: `/tmp/iinvsys-qa-daily.{out,err}.log`

### Option B — cron (Linux on-premise host)
```cron
30 0 * * * cd /opt/iinvsys/Sales_Dashboard && bash scripts/daily-qa-report.sh >> /var/log/iinvsys-qa.log 2>&1
```

### Option C — GitHub Actions (CI host)
Template: `scripts/schedule/github-actions-daily-qa.yml` — schedule `cron: '30 0 * * *'`, runs on `ubuntu-latest`, uploads artifacts, sends email via `RESEND_API_KEY` repo secret.

To activate, copy the template into `.github/workflows/` from a session whose GitHub token has the `workflow` scope (or commit it via the GitHub web UI):
```bash
mkdir -p .github/workflows && cp scripts/schedule/github-actions-daily-qa.yml .github/workflows/daily-qa.yml
git add .github/workflows/daily-qa.yml && git commit -m "ci: enable daily QA workflow"
```

---

## 9. Configuration Required

The runner reads from `backend/.env` (which already exists with real values for the API). The QA email step requires **one** of:

| Mode | Required env vars | Where to get them |
|---|---|---|
| **Resend** (recommended) | `RESEND_API_KEY`, `RESEND_FROM` | https://resend.com — free tier covers daily reports |
| **SMTP** (on-premise) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | existing Gmail / SendGrid creds in `.env.example` |

The script also reads `QA_REPORT_RECIPIENTS` (comma-separated) — defaults to `balap@iinvsys.com`.

---

## 10. Acceptance Criteria

The strategy is "in production" when **all** of the following hold:
1. ☐ `bash scripts/daily-qa-report.sh` runs end-to-end without manual intervention.
2. ☐ A test email arrives at `balap@iinvsys.com` with a working HTML body and three attachments.
3. ☐ The launchd / cron / GHA schedule has fired at least 3 consecutive days without a missed run.
4. ☐ A deliberate failing test (added then reverted) shows up in the email's "New failures" section.
5. ☐ The Playwright HTML report attachment opens in a browser and shows screenshots for any failed UI test.
6. ☐ `qa-output/` is gitignored (no accidental commits of run artifacts).

Sign-off: QA Manager (balap@iinvsys.com) replies "approved" to a test email.
