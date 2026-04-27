#!/usr/bin/env bash
# Installs the daily QA schedule for the current host.
# Detects macOS vs Linux and wires up launchd or cron accordingly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

case "$(uname)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.iinvsys.qa-daily.plist"
    echo "→ Installing macOS launchd job at $PLIST"
    sed "s|REPO_ROOT|$REPO_ROOT|g" "$REPO_ROOT/scripts/schedule/com.iinvsys.qa-daily.plist" > "$PLIST"
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST"
    echo "✅ Loaded. Verify with:  launchctl list | grep iinvsys"
    echo "   Test fire:           launchctl start com.iinvsys.qa-daily"
    echo "   Logs:                /tmp/iinvsys-qa-daily.{out,err}.log"
    ;;
  Linux)
    LINE="30 0 * * *  cd $REPO_ROOT && /usr/bin/bash scripts/daily-qa-report.sh >> /var/log/iinvsys-qa.log 2>&1"
    echo "→ Add this line to crontab (run: crontab -e):"
    echo ""
    echo "$LINE"
    echo ""
    echo "Or pipe automatically:"
    echo "  (crontab -l 2>/dev/null; echo '$LINE') | crontab -"
    ;;
  *)
    echo "Unsupported OS: $(uname). Use the GitHub Actions workflow instead — see .github/workflows/daily-qa.yml"
    exit 1
    ;;
esac
