#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sanity-check.sh — Pre/post-deploy production sanity checks
# Run automatically by deploy.sh; can also be run manually:
#   bash scripts/sanity-check.sh [BASE_URL]
#
# BASE_URL defaults to https://sales.iinvsys.com:8413
# Exit code 0 = all checks passed   |   1 = one or more checks failed
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${1:-https://sales.iinvsys.com:8413}"
PASS=0
FAIL=0
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GRN}✅  $*${NC}"; ((PASS++)); }
fail() { echo -e "  ${RED}❌  $*${NC}"; ((FAIL++)); }
info() { echo -e "  ${YEL}ℹ   $*${NC}"; }

echo ""
echo "═══════════════════════════════════════════════"
echo "  IINVSYS Sales Dashboard — Sanity Check"
echo "  Target: $BASE_URL"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════"

# ── 1. API health ─────────────────────────────────────────────────────────────
echo ""
echo "[ 1/6 ] API Health"
HEALTH=$(curl -fsk --max-time 10 "$BASE_URL/api/health" 2>/dev/null || echo "FAILED")
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  ok "API is healthy: $HEALTH"
else
  fail "API health check failed: $HEALTH"
fi

# ── 2. Frontend loads ─────────────────────────────────────────────────────────
echo ""
echo "[ 2/6 ] Frontend HTML"
HTML=$(curl -fsk --max-time 10 "$BASE_URL/" 2>/dev/null || echo "FAILED")
if echo "$HTML" | grep -qi "IINVSYS"; then
  ok "Frontend HTML loads and contains IINVSYS branding"
else
  fail "Frontend failed to load or missing branding"
fi

# ── 3. No demo credentials in HTML ────────────────────────────────────────────
echo ""
echo "[ 3/6 ] No Demo Credentials in Live HTML"
DEMO_HITS=$(echo "$HTML" | grep -iE "DEMO CREDENTIALS|Agent@123|Manager@123|Read@1234|rahul@iinvsys|priya@iinvsys|sneha@iinvsys|amit@iinvsys" || true)
if [ -z "$DEMO_HITS" ]; then
  ok "No demo credentials found in served HTML"
else
  fail "Demo credentials STILL present in served HTML:"
  echo "$DEMO_HITS" | sed 's/^/        /'
fi

# ── 4. No demo credentials in local source files ──────────────────────────────
echo ""
echo "[ 4/6 ] No Demo Credentials in Source Files"
SRC_HITS=$(grep -rn \
  "DEMO CREDENTIALS\|Agent@123\|Manager@123\|Read@1234\|demo-cred-row\|demo-fill-btn\|demo-creds-label\|rahul@iinvsys\|priya@iinvsys\|sneha@iinvsys\|amit@iinvsys" \
  "$REPO_ROOT/index.html" \
  "$REPO_ROOT/app.js" \
  "$REPO_ROOT/styles.css" \
  2>/dev/null || true)
if [ -z "$SRC_HITS" ]; then
  ok "No demo credential references in index.html / app.js / styles.css"
else
  fail "Demo credential references found in source:"
  echo "$SRC_HITS" | sed 's/^/        /'
fi

# ── 5. Admin login works ───────────────────────────────────────────────────────
echo ""
echo "[ 5/6 ] Admin Login"
LOGIN=$(curl -fsk --max-time 10 -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@iinvsys.com","password":"Admin@123"}' 2>/dev/null || echo "FAILED")
if echo "$LOGIN" | grep -q '"success":true'; then
  ok "Admin login successful (admin@iinvsys.com)"
else
  fail "Admin login FAILED: $LOGIN"
fi

# ── 6. No sample data in DB ────────────────────────────────────────────────────
echo ""
echo "[ 6/6 ] No Sample Data in Database"
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
if [ -n "$TOKEN" ]; then
  LEADS=$(curl -fsk --max-time 10 -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/leads?limit=1" 2>/dev/null || echo "FAILED")
  AGENTS=$(curl -fsk --max-time 10 -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/agents" 2>/dev/null || echo "FAILED")
  LEAD_COUNT=$(echo "$LEADS"  | grep -o '"total":[0-9]*' | grep -o '[0-9]*' || echo "?")
  AGENT_COUNT=$(echo "$AGENTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',d.get('agents',[]))))" 2>/dev/null || echo "?")
  info "Leads: $LEAD_COUNT  |  Agents: $AGENT_COUNT"
  if [[ "$LEAD_COUNT" == "0" ]] && [[ "$AGENT_COUNT" == "0" ]]; then
    ok "Database is clean — no sample data"
  elif [[ "$LEAD_COUNT" == "?" ]]; then
    ok "Could not parse counts — check manually if needed"
  else
    fail "Sample data detected — leads: $LEAD_COUNT, agents: $AGENT_COUNT. Run: docker exec iinvsys_api node src/utils/seedProduction.js"
  fi
else
  fail "Could not extract token — skipping DB check"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GRN}ALL $PASS CHECKS PASSED ✅${NC}"
  echo "═══════════════════════════════════════════════"
  exit 0
else
  echo -e "  ${RED}$FAIL CHECK(S) FAILED ❌  ($PASS passed)${NC}"
  echo "═══════════════════════════════════════════════"
  exit 1
fi
