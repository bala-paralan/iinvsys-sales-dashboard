#!/usr/bin/env bash
# deploy.sh — push latest main to GitHub, then pull and deploy on the production server
set -e

SERVER_USER="balap"
SERVER_HOST="103.191.208.50"
SERVER_SSH_PORT="${SSH_PORT:-22}"
REPO_DIR="/opt/iinvsys/iinvsys-sales-dashboard"
WEB_DIR="/var/www/iinvsys"
STATIC_FILES="app.js index.html styles.css"

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Connecting to server ${SERVER_HOST}:${SERVER_SSH_PORT}..."
ssh -o StrictHostKeyChecking=no -p "$SERVER_SSH_PORT" "${SERVER_USER}@${SERVER_HOST}" bash << REMOTE
  set -e
  echo "  → Pulling latest code..."
  cd ${REPO_DIR}
  git config --global --add safe.directory ${REPO_DIR}
  git pull origin main

  echo "  → Copying static files to ${WEB_DIR}..."
  sudo cp ${STATIC_FILES} ${WEB_DIR}/
  sudo chown nginx:nginx $(echo $STATIC_FILES | sed 's|[^ ]*|${WEB_DIR}/&|g')
  sudo chmod 644 ${WEB_DIR}/app.js ${WEB_DIR}/index.html ${WEB_DIR}/styles.css

  echo "  → Restarting backend (if needed)..."
  cd ${REPO_DIR}/backend
  docker compose restart backend 2>/dev/null || docker compose up -d backend 2>/dev/null || true

  echo "Deploy complete."
REMOTE

echo "==> Done! Site is live at https://${SERVER_HOST}/"
