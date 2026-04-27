#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# daily-qa-report.sh — IINVSYS Sales Dashboard daily automation suite.
#
# Runs every test layer (unit, integration, UI, smoke), aggregates results,
# and emails an HTML summary to the QA Manager.
#
# See TESTING_STRATEGY.md for the full pipeline description.
#
# Env vars:
#   QA_REPORT_DRY_RUN=1      — skip email send
#   QA_REPORT_SKIP_UI=1      — skip Playwright (faster iteration)
#   QA_REPORT_SKIP_SMOKE=1   — skip production smoke check
#   QA_REPORT_RECIPIENTS     — comma-separated list (default balap@iinvsys.com)
#   QA_REPORT_PROD_URL       — smoke target  (default https://sales.iinvsys.com:8413)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail   # no -e: a failing test layer must not abort the whole run

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/qa-output"
ARCHIVE_DIR="${HOME}/.iinvsys-qa-archive/$(date -u +%Y-%m-%d)"
PROD_URL="${QA_REPORT_PROD_URL:-https://sales.iinvsys.com:8413}"
RECIPIENTS="${QA_REPORT_RECIPIENTS:-balap@iinvsys.com}"
START_TS=$(date -u +%s)

mkdir -p "$OUT_DIR" "$ARCHIVE_DIR"
: > "$OUT_DIR/run.log"

log()  { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT_DIR/run.log"; }
step() { echo "" | tee -a "$OUT_DIR/run.log"; log "═══ $* ═══"; }

# ── 0. Preflight ──────────────────────────────────────────────────────────────
step "0/8 Preflight"
log "node:    $(node --version 2>/dev/null || echo MISSING)"
log "npm:     $(npm --version 2>/dev/null || echo MISSING)"
log "host:    $(hostname)"
log "repo:    $REPO_ROOT"
log "output:  $OUT_DIR"
log "to:      $RECIPIENTS"

DISK_FREE_MB=$(df -m "$REPO_ROOT" | awk 'NR==2 {print $4}')
log "disk:    ${DISK_FREE_MB}MB free"
[ "$DISK_FREE_MB" -lt 1024 ] && log "WARNING: less than 1 GB free — Playwright traces may fail"

# ── 1. Backend dep install ────────────────────────────────────────────────────
step "1/8 Backend npm ci"
cd "$REPO_ROOT/backend"
if [ -d node_modules ] && [ -f node_modules/.qa-installed ]; then
  log "node_modules cached — skipping ci (delete node_modules/.qa-installed to force)"
else
  # Use a runner-local cache to avoid permission issues in shared ~/.npm
  NPM_CACHE_DIR="${QA_NPM_CACHE:-/tmp/iinvsys-qa-npm-cache}"
  mkdir -p "$NPM_CACHE_DIR"
  npm ci --omit=optional --no-audit --no-fund --cache "$NPM_CACHE_DIR" >> "$OUT_DIR/run.log" 2>&1 \
    && touch node_modules/.qa-installed \
    && log "npm ci OK (cache: $NPM_CACHE_DIR)" \
    || log "npm ci FAILED — see run.log"
fi

# Source backend/.env so the Jest suite + email sender both see RESEND_API_KEY,
# JWT_SECRET, etc. — works even if dotenv is missing from node_modules.
if [ -f "$REPO_ROOT/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/backend/.env"
  set +a
  log "loaded backend/.env into shell environment"
fi

# Make `require('resend')` etc. resolve against backend/node_modules from any cwd.
export NODE_PATH="$REPO_ROOT/backend/node_modules"

# ── 2. npm audit (high+ only) ─────────────────────────────────────────────────
step "2/8 npm audit"
npm audit --audit-level=high --json > "$OUT_DIR/npm-audit.json" 2>/dev/null || true
HIGH_VULNS=$(node -e "try{const j=require('$OUT_DIR/npm-audit.json');console.log(j.metadata?.vulnerabilities?.high||0)}catch(e){console.log(0)}")
CRIT_VULNS=$(node -e "try{const j=require('$OUT_DIR/npm-audit.json');console.log(j.metadata?.vulnerabilities?.critical||0)}catch(e){console.log(0)}")
log "vulnerabilities: ${CRIT_VULNS} critical / ${HIGH_VULNS} high"

# ── 3. Jest (unit + integration) ──────────────────────────────────────────────
step "3/8 Jest test suite"
JEST_START=$(date -u +%s)
npx jest \
  --runInBand \
  --forceExit \
  --detectOpenHandles \
  --json --outputFile="$OUT_DIR/jest.json" \
  >> "$OUT_DIR/run.log" 2>&1
JEST_EXIT=$?
JEST_DUR=$(( $(date -u +%s) - JEST_START ))
log "jest exit ${JEST_EXIT} in ${JEST_DUR}s"

# ── 4. Playwright (UI E2E) ────────────────────────────────────────────────────
if [ "${QA_REPORT_SKIP_UI:-0}" = "1" ]; then
  step "4/8 Playwright — SKIPPED (QA_REPORT_SKIP_UI=1)"
  echo '{"stats":{"expected":0,"unexpected":0,"flaky":0,"skipped":0,"duration":0},"suites":[]}' > "$OUT_DIR/playwright.json"
else
  step "4/8 Playwright UI tests"
  cd "$REPO_ROOT"
  if [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund >> "$OUT_DIR/run.log" 2>&1 || log "frontend npm ci failed"
  fi
  if [ ! -d .playwright-browsers ]; then
    log "installing Playwright browsers (first run)"
    PLAYWRIGHT_BROWSERS_PATH="$REPO_ROOT/.playwright-browsers" \
      npx playwright install chromium >> "$OUT_DIR/run.log" 2>&1
  fi
  PW_START=$(date -u +%s)
  npx playwright test \
    --reporter="json,html" \
    >> "$OUT_DIR/run.log" 2>&1
  PW_EXIT=$?
  # Playwright's json reporter writes to stdout by default; capture via env
  # We re-run with env-pinned output if missing.
  if [ ! -s "$OUT_DIR/playwright.json" ]; then
    PLAYWRIGHT_JSON_OUTPUT_FILE="$OUT_DIR/playwright.json" \
      npx playwright test --reporter=json >> "$OUT_DIR/run.log" 2>&1 || true
  fi
  PW_DUR=$(( $(date -u +%s) - PW_START ))
  log "playwright exit ${PW_EXIT} in ${PW_DUR}s"
  # Zip the HTML report for email attachment
  if [ -d playwright-report ]; then
    (cd "$REPO_ROOT" && zip -qr "$OUT_DIR/playwright-report.zip" playwright-report)
  fi
fi

# ── 5. Smoke check (production) ───────────────────────────────────────────────
if [ "${QA_REPORT_SKIP_SMOKE:-0}" = "1" ]; then
  step "5/8 Smoke check — SKIPPED"
  echo "skipped" > "$OUT_DIR/sanity.txt"
  SMOKE_EXIT=0
else
  step "5/8 Production smoke check ($PROD_URL)"
  bash "$REPO_ROOT/scripts/sanity-check.sh" "$PROD_URL" > "$OUT_DIR/sanity.txt" 2>&1
  SMOKE_EXIT=$?
  log "sanity-check exit ${SMOKE_EXIT}"
fi

# ── 6. Build the HTML report ──────────────────────────────────────────────────
step "6/8 Build HTML report"
cd "$REPO_ROOT"
node scripts/qa-report-builder.js \
  --jest "$OUT_DIR/jest.json" \
  --playwright "$OUT_DIR/playwright.json" \
  --audit "$OUT_DIR/npm-audit.json" \
  --sanity "$OUT_DIR/sanity.txt" \
  --smoke-exit "$SMOKE_EXIT" \
  --previous "${HOME}/.iinvsys-qa-archive/$(date -u -v-1d +%Y-%m-%d 2>/dev/null || date -u --date=yesterday +%Y-%m-%d)/jest.json" \
  --out-html "$OUT_DIR/report.html" \
  --out-csv  "$OUT_DIR/qa-summary.csv" \
  --out-junit "$OUT_DIR/jest-junit.xml" \
  >> "$OUT_DIR/run.log" 2>&1
BUILDER_EXIT=$?
log "report builder exit ${BUILDER_EXIT}"

# ── 7. Email the report ───────────────────────────────────────────────────────
if [ "${QA_REPORT_DRY_RUN:-0}" = "1" ]; then
  step "7/8 Email — DRY RUN (QA_REPORT_DRY_RUN=1)"
  EMAIL_EXIT=0
else
  step "7/8 Email report to $RECIPIENTS"
  cd "$REPO_ROOT/backend"   # so dotenv finds backend/.env
  node "$REPO_ROOT/scripts/qa-email-sender.js" \
    --to "$RECIPIENTS" \
    --html "$OUT_DIR/report.html" \
    --subject-from "$OUT_DIR/report.subject" \
    --attach "$OUT_DIR/jest-junit.xml" \
    --attach "$OUT_DIR/qa-summary.csv" \
    --attach "$OUT_DIR/sanity.txt" \
    $( [ -f "$OUT_DIR/playwright-report.zip" ] && echo --attach "$OUT_DIR/playwright-report.zip" ) \
    >> "$OUT_DIR/run.log" 2>&1
  EMAIL_EXIT=$?
  log "email exit ${EMAIL_EXIT}"
fi

# ── 8. Archive run artefacts ──────────────────────────────────────────────────
step "8/8 Archive run"
cp -r "$OUT_DIR"/* "$ARCHIVE_DIR/" 2>/dev/null || true
log "archived to $ARCHIVE_DIR"

TOTAL_DUR=$(( $(date -u +%s) - START_TS ))
log ""
log "═════════════════════════════════════════════"
log "  Daily QA run complete in ${TOTAL_DUR}s"
log "  jest=${JEST_EXIT}  playwright=${PW_EXIT:-skip}  smoke=${SMOKE_EXIT}  email=${EMAIL_EXIT}"
log "═════════════════════════════════════════════"

# Exit non-zero ONLY if email failed — every other failure is reported, not raised.
exit "$EMAIL_EXIT"
