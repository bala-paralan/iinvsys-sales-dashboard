# Frontend Architecture — R-5

> **Code:** `frontend/` (Vite + React + TypeScript). The legacy no-build app
> (root `index.html` / `app.js` / `styles.css`) stays deployed and untouched
> until cutover — see the plan's B5/F6 phase for the flip and rollback story.

## The binding rule

> **The client renders from `GET /api/meta/pipeline`.** Stage columns, gate
> checklists, enum dropdowns, checklist templates, SPENCO dimensions and KPI
> targets are never hardcoded in frontend source. A hardcoded enum is a
> defect, not a shortcut.

The payload embeds `version` — a hash of the stage keys **and** the resolved
runtime rules (doc 09) — so a threshold change in Settings invalidates every
cached client copy. It also embeds `me: {role, permissions}`, which is what
drives all client-side gating.

### The one sanctioned exception

`src/meta/pipeline-fallback.json` — the offline board skeleton, drawn when the
API is unreachable. It is deliberately **minimal**: stage keys, labels,
colours, order. It must never grow gates or enums, because a gate checklist
rendered from stale offline data would tell a rep the wrong requirements.
Parity with `serialize()` is pinned by
`backend/tests/22-frontend-fallback-parity.test.js`; renaming a stage fails
that suite until the fallback is regenerated:

```bash
cd backend && node -e "console.log('see tests/22 header for the regen snippet')"
```

## Stack

| Concern | Choice | Note |
|---|---|---|
| Build | Vite 6, TypeScript strict | `npm run typecheck` / `npm run build` |
| Server state | TanStack Query | `staleTime: Infinity` on the pipeline payload — the `version` hash, not time, is the invalidation signal |
| Routing | **react-router-dom v7** | ⚠ Deviation from the plan's TanStack Router: no codegen step, fewer moving parts for the first slice. Revisit when file-based routes earn their keep |
| Forms | React Hook Form + Zod | arrives with the lead form (F2 continuation) |
| Styling | Plain CSS on the ported NeoPop tokens | `src/styles/global.css` carries the `:root` tokens verbatim from the legacy `styles.css`, including the v1.2 contrast fixes |
| Auth | Token in memory + sessionStorage | ⚠ Interim: the plan calls for an httpOnly refresh cookie; the backend does not issue one yet (N-8 work). `src/api/client.ts` is the single place to change |

## Layout

```
frontend/src/
  api/client.ts        the ONLY fetch path: envelope unwrap, ApiError with
                       gate `code`/`missing`, 401 → session reset, status-0
                       "cannot reach server" (never blamed on credentials)
  auth/session.tsx     SessionProvider, token restore via /auth/me,
                       queryClient.clear() on login/logout so one account
                       never sees another's cached payload
  meta/usePipeline.ts  the pipeline cache + types + PIPELINE_FALLBACK + can()
  components/          EnumSelect (takes an enum NAME, not options — a call
                       site cannot substitute a hardcoded list)
                       StageGateChecklist (renders the SERVER's verdict from
                       GET /:id/gate; never re-implements the 16 test types —
                       two implementations of gate logic is how they diverge)
                       KanbanBoard (generic over any stage list — sales today,
                       delivery/installation in F3)
  features/            leads/ auth/ … one directory per module
```

## Behaviours worth knowing

- **Advance lives behind the gate checklist.** There is deliberately no silent
  drag-to-move on the kanban: a stage change without its gate is exactly what
  the backend refuses, so the UI does not offer the gesture.
- A `422 STAGE_GATE_FAILED` from `/advance` carries the authoritative
  `missing` list; the checklist overlays it onto the preview (the server's
  word supersedes the client's).
- The override path (`force` + note) renders only for holders of
  `lead.gate_override`, and the Force button stays disabled until the note is
  non-empty — mirroring the server's 400.
- Login failures are named: server unreachable / bad credentials / rate-limited
  / server error are four different messages, because the legacy app's single
  "Invalid credentials" banner sent people to reset passwords when the API was
  down.

## Screens

| Route | Purpose | Gated on |
|---|---|---|
| `/dashboard` | All three KPI dashboards, period switch, health roll-up, xlsx export | `kpi.read` |
| `/leads`, `/leads/:id` | Pipeline kanban, lead detail, SPENCO, gate-checklist advance | signed in |
| `/hygiene` | The manager review queue | `lead.read` |
| `/delivery`, `/delivery/:id` | Work Order queue, dates, delays, DA gate, document vault | `workorder.read` |
| `/installation`, `/installation/:id` | Job board, checklist runner, snags, commissioning, CSAT | `install.read` |
| `/notifications` | The notification centre — rows link to the record they concern | `notification.read` |
| `/admin` | Agents, products, expos | role manager+ |
| `/settings` | The R-2 rule editors | read manager+, write superadmin |

`/admin` and `/settings` gate on ROLE rather than permission, and that is a
deliberate inconsistency: doc 04 defines no `agent.write` or `settings.write`
verb, and the routes behind them are `requireMinRole`. Inventing a permission
client-side would put the UI and the API on different models of who may do
what. Both should move to permissions when doc 04 defines them.

## Out of scope: OCR, scanning and bulk card capture

**Dropped from the rebuild at the client's direction (2026-08-14).** The
legacy app's Tesseract.js business-card OCR, jsQR code scanning and bulk card
scan are NOT ported to this frontend. This removes the wasm bundle, the
traineddata asset, and the four-step scan-review flow from the client entirely.

The corresponding backend endpoints (`POST /api/leads/bulk-scan`, the
`ocrCapture` provenance field, the scan telemetry events) are **left in place
and untouched** — removing them is a separate, destructive decision that was
not asked for, and the legacy app remains deployed until cutover. They are
simply not called by this frontend.

Still open from the original F5 list, neither built nor cancelled: the CSV
import wizard and MediaRecorder voice memos.

## Running it

```bash
cd backend && npm run dev:local     # in-memory Mongo + seed + API on :5001
```

```bash
cd frontend && npm run dev          # Vite on :5173, /api proxied to :5001
```

Or the `iinvsys-api` and `iinvsys-react` launch entries. Demo credentials are
printed by the seed (`admin@iinvsys.com / Admin@123` etc.). The dev runner
forces `JWT_SECRET=dev-local-secret-not-for-production`, so a token minted
locally can never be valid against production.
