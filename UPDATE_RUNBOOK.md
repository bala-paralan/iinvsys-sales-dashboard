# Code Update Runbook — IINVSYS Sales Dashboard

How to ship a code change from GitHub to the production on-premise server at `sales.iinvsys.com`.

**Repo:** `github.com/bala-paralan/iinvsys-sales-dashboard`
**Server path:** `/opt/iinvsys` (Docker Compose backend + static frontend files)
**Frontend served from:** `/var/www/iinvsys` (copied from repo at deploy time)
**Backend runs in:** Docker containers `iinvsys_api` and `iinvsys_mongo`

---

## 0. One-time: moving the repo to `bala-paralan`

If the repo has been transferred from `balaaarc` to `bala-paralan`, update every clone to follow it.

### 0a. If you used GitHub's "Transfer ownership" feature

GitHub keeps the old URL alive as a redirect, so `git fetch` still works — but you should update the remote explicitly:

```bash
# On your laptop
cd ~/path/to/iinvsys-sales-dashboard
git remote set-url origin git@github.com:bala-paralan/iinvsys-sales-dashboard.git
git remote -v   # verify

# On the server
cd /opt/iinvsys
sudo -u <deploy-user> git remote set-url origin git@github.com:bala-paralan/iinvsys-sales-dashboard.git
sudo -u <deploy-user> git fetch origin
```

### 0b. If you created a new repo under `bala-paralan` instead of transferring

Push everything (branches + tags) to the new remote:

```bash
# On a clone that has all branches fetched
cd ~/path/to/iinvsys-sales-dashboard
git remote rename origin old-origin
git remote add origin git@github.com:bala-paralan/iinvsys-sales-dashboard.git
git push origin --all
git push origin --tags
```

Then update the server's clone the same way as 0a.

### 0c. Post-move checklist

- [ ] Re-add the **deploy key** to the new repo (Settings → Deploy keys). Old deploy keys don't auto-transfer if you went the "new repo" route.
- [ ] Re-create any **webhooks** (CI, notifications, GitHub Actions secrets).
- [ ] Update **branch protection** rules on `main` on the new repo.
- [ ] Add collaborators/teams with the right access.
- [ ] If you use GitHub Actions for auto-deploy (section 7), the `PROD_*` secrets need to be set on the new repo.
- [ ] Archive or delete the old repo once everything is verified, so nobody pushes to it by accident.
- [ ] Update any README/docs/links that reference the old URL.

---

## 1. One-time setup on the server

Do this once, right after the initial deployment, so subsequent updates are clean.

### 1a. SSH deploy key for the repo (if private)

```bash
# On the server, as the deploy user:
ssh-keygen -t ed25519 -C "sales-server-deploy" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

Copy the public key into GitHub → repo Settings → Deploy keys → **Add deploy key** (read-only is enough; no write-back needed).

Configure SSH to use it:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Switch the clone's remote to SSH if it was cloned via HTTPS:

```bash
cd /opt/iinvsys
git remote set-url origin git@github.com:bala-paralan/iinvsys-sales-dashboard.git
git fetch origin
```

### 1b. Make the working tree safe to pull

The `.env` file must never be in git. Verify:

```bash
grep -E '^\.env$|^backend/\.env$' /opt/iinvsys/.gitignore
```

If missing, add it and commit once locally — never on the server.

### 1c. Install a deploy script

Save as `/opt/iinvsys/deploy.sh`:

```bash
#!/usr/bin/env bash
# IINVSYS Sales Dashboard — deploy script
# Usage:
#   ./deploy.sh               # deploy latest main
#   ./deploy.sh v1.4.2        # deploy a specific tag
#   ./deploy.sh --frontend    # only redeploy frontend static files
#   ./deploy.sh --backend     # only rebuild + restart backend container

set -euo pipefail

REPO=/opt/iinvsys
WEB_ROOT=/var/www/iinvsys
REF="${1:-origin/main}"
MODE="both"

case "${1:-}" in
  --frontend) MODE="frontend"; REF="origin/main" ;;
  --backend)  MODE="backend";  REF="origin/main" ;;
esac

cd "$REPO"

echo "==> Fetching latest from GitHub"
git fetch --all --tags --prune

# Record the currently-deployed SHA so we can roll back
PREV_SHA=$(git rev-parse HEAD)
echo "$PREV_SHA" > /opt/iinvsys/.last_deployed_sha
echo "==> Previous SHA: $PREV_SHA"

echo "==> Checking out $REF"
git checkout --detach "$REF"
NEW_SHA=$(git rev-parse HEAD)
echo "==> New SHA: $NEW_SHA"

if [[ "$MODE" != "backend" ]]; then
  echo "==> Deploying frontend static files"
  sudo rsync -a --delete \
    --exclude='.*' \
    "$REPO/index.html" "$REPO/styles.css" "$REPO/app.js" \
    "$WEB_ROOT/"
  sudo chown -R www-data:www-data "$WEB_ROOT"
  sudo nginx -t && sudo systemctl reload nginx
fi

if [[ "$MODE" != "frontend" ]]; then
  echo "==> Rebuilding backend container"
  cd "$REPO/backend"
  docker compose pull mongo || true          # refresh base images
  docker compose up -d --build api
  echo "==> Waiting for API health..."
  for i in {1..30}; do
    if curl -fsS http://localhost:5000/api/health >/dev/null; then
      echo "    API is healthy"
      break
    fi
    sleep 2
    [[ $i -eq 30 ]] && { echo "API failed health check"; exit 1; }
  done
fi

echo "==> Deploy complete: $NEW_SHA"
```

Make it executable:

```bash
chmod +x /opt/iinvsys/deploy.sh
```

---

## 2. Day-to-day workflow (developer side)

1. Create a feature branch locally, make changes, open a pull request.
2. Merge the PR to `main` after review.
3. Tag the release with a semver-style tag if the change is production-worthy:

   ```bash
   git checkout main && git pull
   git tag -a v1.4.2 -m "Fix: lead export column order"
   git push origin v1.4.2
   ```

Tags let you pin production to a specific, reviewable commit and make rollback trivial. `main` is fine for small patches, but use tags for anything customer-visible.

---

## 3. Day-to-day workflow (server side)

SSH to the server, then run one of:

```bash
cd /opt/iinvsys

# Standard update — deploy latest main
./deploy.sh

# Pinned release — deploy a specific tag (preferred for prod)
./deploy.sh v1.4.2

# Surgical updates
./deploy.sh --frontend   # only static files changed
./deploy.sh --backend    # only API code changed
```

The script:
- Fetches tags + branches from GitHub
- Records the previously-deployed SHA to `/opt/iinvsys/.last_deployed_sha`
- Checks out the requested ref
- If frontend files changed: rsync's them into `/var/www/iinvsys` and reloads Nginx
- If backend files changed: rebuilds the `api` container and waits for `/api/health` to return 200

Expected time: ~30 seconds frontend-only, ~60–90 seconds backend rebuild.

---

## 4. What counts as frontend vs backend

| Path in repo | Owner | Update command |
|---|---|---|
| `index.html`, `styles.css`, `app.js` | Frontend | `./deploy.sh --frontend` |
| `backend/src/**`, `backend/package.json` | Backend | `./deploy.sh --backend` |
| `backend/docker-compose.yml` or `Dockerfile` | Backend | `./deploy.sh --backend` (rebuilds image) |
| `backend/.env` | Server-only — **not in git** | Edit directly, then `docker compose restart api` |
| Both folders in one release | Full deploy | `./deploy.sh` |

If a release changes the database schema, run any migration script **after** `deploy.sh` finishes and **before** announcing the release.

---

## 5. Rollback

The deploy script writes the prior SHA to `/opt/iinvsys/.last_deployed_sha`. To revert:

```bash
cd /opt/iinvsys
./deploy.sh "$(cat .last_deployed_sha)"
```

Or roll back to a known-good tag:

```bash
./deploy.sh v1.4.1
```

Rollback takes the same ~60–90 seconds as a forward deploy. There is no database rollback — if the update included a destructive migration, restore from the nightly `mongodump` archive.

---

## 6. Zero-downtime notes

- Frontend reload is effectively zero-downtime: rsync is atomic at the file level and Nginx reload doesn't drop connections.
- Backend rebuild briefly restarts the `api` container — expect 3–5 seconds of 502s. If that's unacceptable, run two API containers behind Nginx `upstream` and deploy them rolling-style (out of scope for this runbook; raise if needed).
- Always deploy during low-traffic windows for backend changes until you have the rolling setup.

---

## 7. Optional: GitHub Actions auto-deploy

If you want `git push` to deploy automatically, add a workflow that SSHes into the server and runs `./deploy.sh`. A minimal sketch at `.github/workflows/deploy.yml`:

```yaml
name: deploy
on:
  push:
    tags: ['v*']         # deploy only when a version tag is pushed
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            cd /opt/iinvsys
            ./deploy.sh ${{ github.ref_name }}
```

Secrets to configure in the repo (Settings → Secrets and variables → Actions):
- `PROD_HOST` — your server's public IP or `sales.iinvsys.com`
- `PROD_USER` — the deploy user on the server
- `PROD_SSH_KEY` — a private key whose public key is in `~/.ssh/authorized_keys` for that user

**Trade-off:** auto-deploy is faster but removes the "pause and think before prod" moment. Many teams prefer manual `./deploy.sh` for small operations; auto-deploy shines when 3+ people ship daily.

---

## 8. Troubleshooting

| Symptom | First check |
|---|---|
| `./deploy.sh` fails at `git fetch` | Deploy key permissions; `ssh -T git@github.com` should print a GitHub hello. |
| Frontend shows old content after deploy | Hard-refresh (Cmd/Ctrl-Shift-R); verify `sudo ls -la /var/www/iinvsys/` timestamps are recent. |
| API returns 502 after deploy | `docker compose logs -f api` — likely a startup error or missing env var. |
| `/api/health` fails during deploy | Container may still be starting; the script retries 30× at 2-second intervals. If it still fails: roll back. |
| Nginx reload fails | `sudo nginx -t` to see the syntax error; fix the config and re-run. |
| `.env` got overwritten | Your repo's `.gitignore` isn't ignoring it. Restore from your password manager, add to `.gitignore`, and never check it in. |

---

## 9. Release checklist (every deploy)

- [ ] Changes reviewed and merged to `main`.
- [ ] Release tagged (for anything user-visible).
- [ ] Low-traffic window confirmed (for backend-only changes).
- [ ] `mongodump` is recent (last nightly succeeded).
- [ ] `./deploy.sh <tag>` run.
- [ ] `curl -s https://sales.iinvsys.com/api/health` returns success.
- [ ] Smoke-tested at least one logged-in flow in the browser.
- [ ] Deploy SHA noted (for rollback): `/opt/iinvsys/.last_deployed_sha`.
