# Migration Notes — ARCHIVED

> **This document does not describe the current plan.** The project took a **greenfield** decision:
> the new schema ships against an empty database and existing production records are not carried
> forward. There is no `001-stage-and-source-rename.js`, no migration runner, and no `Migration`
> ledger. `LEGACY_STAGE_MAP` / `LEGACY_SOURCE_MAP` and the transitional `pre('validate')` upgrade
> hook are removed — a legacy enum value is now a `422`, not a silent upgrade.
>
> It is kept, unmodified below, because it is a complete and correct runbook. If the migration path
> is ever revived — for example if the live `sales.iinvsys.com` data must be preserved after all —
> start here rather than rewriting it. See `R-3` in the implementation plan.

---

Adopting the CRM Data Dictionary replaces the lead `stage` and `source` enums. Existing records
must be remapped. This document is the operator runbook.

## What changes

### Stage

| Legacy value | New value | Why |
|---|---|---|
| `new` | `suspect` | Contact identified, no conversation yet |
| `contacted` | `prospect` | A conversation has happened |
| `interested` | `prospect` | Interest expressed but not yet demoed or quoted — still S2 |
| `proposal` | `engagement` | S3 is defined by a formal quote/proposal having been sent |
| `negotiation` | `negotiation` | unchanged |
| `won` | `commercial_order` | |
| `lost` | `order_lost` | |

Seven legacy values collapse into six. `contacted` and `interested` both map to `prospect`: the new
model's S2 covers everything from "we spoke" to "need confirmed", and S3 requires a proposal to
have been sent — which neither legacy value implies.

### Source

| Legacy | New |
|---|---|
| `expo` | `exhibition_event` |
| `referral` | `referral` |
| `digital` | `digital_website` |
| `direct` | `inbound_enquiry` |

The five sources with no legacy equivalent (`cold_call`, `channel_partner`, `builder_referral`,
`inside_sales_outbound`, `social_media`) become available for new records.

### Lost reason

`lostReason` was free text and becomes an enum. Any value that is not already a valid enum key is
moved to `lostReasonDetail` and `lostReason` is set to `other`, so no text is lost.

## What `001-stage-and-source-rename.js` does

1. Remaps `stage` and `source` per the tables above.
2. Rescues free-text `lostReason` into `lostReasonDetail`.
3. Backfills `stageEnteredAt = updatedAt` — the best available approximation.
4. Backfills `probability` from the new stage's default.
5. Backfills `zone` via `deriveZone(state)`.
6. Backfills `ownerUser` by joining `User` on `agentId === lead.assignedAgent`.
7. Seeds one synthetic `stageHistory` entry per lead:
   `{ from: null, to: <newStage>, at: updatedAt, by: null, note: 'migrated from <legacy>' }`.
8. Sets **`needsReview: true, reviewIssues: ['migrated_incomplete']` on every migrated lead.**

Step 8 is intentional and important. No legacy lead has `companyType`, `industrySegment`,
`expectedCloseDate`, `nextFollowUpDate`, `nextAction`, `competitor` or a SPENCO score. Flagging them
all is exactly the "flag your record for manager review" mechanism the dictionary asks for, and it
gives the sales team a concrete worklist on day one rather than a silent data-quality debt.

`002-settings-pipeline-cleanup.js` removes the now-misleading `lead.stages` and `lead.sources`
Setting documents. Those settings were never read by any code; leaving them would advertise dead
values on the Settings page.

## Idempotency

Every `updateMany` filters on the **legacy** value. A second run matches zero documents even if the
migration ledger is lost or the database is restored from a mid-migration snapshot. The ledger
(`Migration` collection: `{name, appliedAt, durationMs, result}`) is a convenience, not the
correctness mechanism.

The runner **refuses to execute when `mongoose.connection.name` ends in `-test`**, so an
accidental invocation cannot corrupt a test fixture.

## Running it

```bash
cd backend && npm run migrate
```

**On-prem.** `server.js` calls the runner automatically after `initAdmin()` unless
`AUTO_MIGRATE=false`. The existing `deploy.sh` upgrade path therefore needs no new step.

**Vercel.** The runner is **not** called from `backend/api.js` — that is the serverless entry and
would attempt a migration on every cold start. Run `npm run migrate` once from a workstation with
`MONGO_URI` pointed at production.

## Rehearsal procedure

Never run this against production first.

```bash
docker start iinvsys_mongo
mongodump --uri "$MONGO_URI" --out ./backup-$(date +%F)
cd backend && npm run migrate
```

Then verify:

```bash
mongosh "$MONGO_URI" --eval 'db.leads.aggregate([{$group:{_id:"$stage",n:{$sum:1}}}])'
mongosh "$MONGO_URI" --eval 'db.leads.countDocuments({stage:{$in:["new","contacted","interested","proposal","won","lost"]}})'  # must be 0
```

Run it a second time and confirm zero documents modified.

Rollback is `mongorestore --drop` from the dump. There is no down-migration — a reverse mapping
cannot distinguish the `contacted` and `interested` records that both became `prospect`.

## Backward compatibility during rollout

`Lead` carries a `pre('validate')` hook applying `LEGACY_STAGE_MAP` and `LEGACY_SOURCE_MAP`, so a
document arriving with `stage: 'won'` or `source: 'expo'` is silently upgraded rather than rejected
with a 422. This covers:

- CSV bulk-import templates already in circulation
- a browser holding a cached copy of the previous `app.js`
- any external integration posting to `/api/leads`

The hook is a **transitional measure**. Remove it in a cleanup commit one release after rollout,
once the logs show no legacy values arriving.

## Frontend skew

`vercel.json` builds `app.js` as a static asset independently of `backend/api.js`, so the two can
be momentarily out of step across a deploy. `app.js` therefore ships a small hardcoded
`PIPELINE_FALLBACK` covering stage keys, labels and colours. If `GET /api/meta/pipeline` 404s or
fails, the kanban still renders its columns instead of drawing an empty board with no error.
`backend/tests/frontend-contracts.test.js` asserts that the fallback stays in parity with the
server's stage list, so it cannot silently rot.

## Post-migration worklist for the sales team

After migration every lead is flagged `migrated_incomplete`. To clear a lead:

1. Open it and fill Designation, Company Type, Industry, City/State (Zone auto-fills).
2. Set Next Action and a future Next Follow-up Date.
3. For anything at Engagement or beyond: set Expected Close Date, Competitor and Deal Value.
4. For anything at Prospect: complete the SPENCO score.

The queue is at `GET /api/leads/hygiene` and on the Leads page filtered by "Needs review".
Leads already at `commercial_order` or `order_lost` are terminal — they can be cleared without
re-gating, since gates only run on forward transitions.
