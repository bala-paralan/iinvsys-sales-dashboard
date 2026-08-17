# KPI Definitions

Every KPI below is served by `GET /api/kpis/{sales|delivery|installation}` and returns:

```json
{ "key": "win_rate", "label": "Win Rate", "actual": 34.2, "target": 30,
  "unit": "percent", "status": "ok", "window": "2026-07-01..2026-07-31",
  "numerator": 41, "denominator": 120 }
```

`status` is `ok` when the target is met, `warn` within 10% of it, `breach` otherwise. Targets live
in `pipeline.KPI_TARGETS` — never hardcoded in the controller.

**`status` is `null`, not `ok`, when a KPI has no target or no data.** Pipeline Value and Sales
Cycle Length have no target in this document — they are numbers to watch, not bars to clear — and a
month with no deliveries has not achieved 0% on-time delivery, it has achieved nothing measurable.
Reporting either as green would be an invented pass. `/api/kpis/summary` counts these separately as
`health.unmeasured`.

**Default window is the trailing calendar month** — the last *complete* one, matching the example
above. `?period=current_month` gives month-to-date instead, and `?from=&to=` gives an arbitrary
range with `to` inclusive of that day. KPIs that measure a duration use the *completion* date to
decide window membership, so a deal that closed in July counts in July regardless of when it
started.

**Windows are half-open `[from, to)` and bounded in Asia/Kolkata**, not UTC. A delivery signed at
02:00 IST on 1 August is 20:30 UTC on 31 July, and a UTC-bounded July window would file it in the
wrong month; an inclusive `to` set to the last day's midnight would drop the whole of the 31st.

**Conversion rates count leads, not stage entries.** A lead pushed back to Prospect and advanced
again entered Engagement twice. It is one lead converting — counting entries lets a single
indecisive deal push the rate above 100%.

**Denominators count every way of reaching a stage; numerators count only genuine transitions.**
A lead created straight into Prospect — bulk import, an expo backlog, a rep entering a deal already
in flight — reached Prospect but never entered Suspect. Counting its creation entry in the numerator
credits a conversion out of a cohort it was never in; on seeded data this reported
Suspect-to-Prospect at **140%** (7 ÷ 5). Such a lead now sits out the conversion entirely, while
still counting in denominators it genuinely belongs to — a lead created at Negotiation and won is
absent from Prospect-to-Proposal but present in Win Rate.

---

## Process 1 — Sales

| KPI | Key | Formula | Target |
|---|---|---|---|
| **Suspect-to-Prospect Rate** | `suspect_to_prospect` | leads whose `stageHistory` contains a transition into `prospect` in the window ÷ leads whose `stageHistory` contains an entry into `suspect` in the window | **≥ 40%** |
| **Prospect-to-Proposal Rate** | `prospect_to_proposal` | leads that reached `negotiation` (i.e. a proposal document exists and was accepted) ÷ leads that reached `engagement` | **≥ 60%** |
| **Win Rate** | `win_rate` | leads that reached `commercial_order` ÷ leads that reached `negotiation` | **≥ 30%** |
| **Sales Cycle Length** | `sales_cycle_days` | mean of (`stageHistory` entry into `commercial_order`) − (`createdAt`), over leads won in the window | baseline in Q1, no target |
| **Pipeline Value** | `pipeline_value` | Σ `value` over leads in `suspect`…`negotiation` | reviewed weekly, no target |
| **Weighted Pipeline** | `weighted_pipeline` | Σ (`value` × `probability` ÷ 100) over open leads | informational |
| **PO Accuracy Rate** | `po_accuracy` | Work Orders never revised after creation ÷ Work Orders created | **≥ 95%** |

> **Prospect-to-Proposal** is measured at entry to `negotiation` rather than at proposal upload,
> because the S4 gate already requires a proposal document on file — reaching Negotiation *is*
> having submitted a proposal that the customer acknowledged. This keeps the numerator a single
> indexed query rather than an attachment scan.

> **A lead's `stageHistory` begins at creation.** `stageService` only appends on a transition, so
> before B4 a lead created at Suspect had an empty history and the Suspect-to-Prospect denominator
> counted only leads that moved *backward* into Suspect. The rate was structurally meaningless and
> could exceed 100%. `Lead.pre('validate')` now seeds a `{from: null, to: <initial stage>}` entry —
> in `validate` rather than `save`, because bulk import goes through `insertMany`, which skips save
> middleware.

> **PO Accuracy** has no direct field in the source. A Work Order carries `revisionCount`,
> incremented whenever its `items` or `poValue` change after `acceptedAt`. A revision means the PO
> did not match the agreed terms.

### Supporting hygiene counters (not KPIs, shown on the manager dashboard)

`leads_needing_review` · `leads_inactive_30d` · `leads_stage_age_exceeded` ·
`leads_missing_followup` · `leads_close_date_expired`

---

## Process 2 — Delivery

| KPI | Key | Formula | Target |
|---|---|---|---|
| **On-Time Delivery Rate** | `on_time_delivery` | Work Orders where `deliveredAt ≤ originalCommittedDate` ÷ Work Orders delivered in the window | **≥ 95%** |
| **Delivery Date Notification Rate** | `date_notification_rate` | Work Orders where `committedDateSetAt ≤ acceptedAt + 1 business day` ÷ Work Orders accepted in the window | **100%** |
| **Delay Notification Compliance** | `delay_notice_compliance` | delay events with `noticeHours ≥ 48` ÷ all delay events in the window | **100%** |
| **Order-to-Dispatch Time** | `order_to_dispatch_days` | mean of `dispatchedAt` − `createdAt`, in calendar days | define per product type |
| **Delivery Accuracy Rate** | `delivery_accuracy` | Work Orders where `deliveryAccuracy.discrepancies` is empty ÷ Work Orders delivered | **≥ 99%** |
| **DA Completion Rate** | `da_completion` | Work Orders with both a `delivery_acknowledgement` and a `da_photo` attachment ÷ Work Orders delivered | **100%** |
| **Damage / Return Rate** | `damage_rate` | Work Orders with `damageReported = true` ÷ Work Orders delivered | **< 1%** |

> **On-Time Delivery measures against `originalCommittedDate`, never `currentCommittedDate`.** If
> it measured against the current date, moving the date would make every delivery on time and the
> KPI would be meaningless. This is why `originalCommittedDate` is write-once.

> **DA Completion Rate is structurally 100%** — the DA gate makes it impossible to mark a Work
> Order delivered without both documents. It is reported anyway, because a value below 100% means
> someone has bypassed the gate at the database level and is worth an alarm.

---

## Process 3 — Installation & Customer Service

| KPI | Key | Formula | Target |
|---|---|---|---|
| **Installation Lead Time** | `install_lead_time_days` | mean business days from the Work Order's `deliveredAt` (DA upload) to the job's `completedAt` (I2 complete) | **≤ 5 business days** |
| **First-Time Right Rate** | `first_time_right` | jobs with `firstTimeRight = true` ÷ jobs that completed installation in the window | **≥ 90%** |
| **Commissioning Pass Rate** | `commissioning_pass` | jobs with `commissioning.retestCount = 0` and `passed = true` ÷ jobs commissioned | **≥ 95%** |
| **Handover Certificate Rate** | `handover_cert_rate` | jobs with a `handover_certificate` attachment ÷ jobs with status `handed_over` or beyond | **100%** |
| **Issue Resolution Time** | `issue_resolution_hours` | mean of `resolvedAt` − `reportedAt` across `postSupport.issues[]` closed in the window | **≤ 48 hours** |
| **CSAT Score** | `csat` | mean `feedback.csat` across feedback received in the window | **≥ 4.0** out of 5.0 |
| **Feedback Collection Rate** | `feedback_collection` | forms received within 30 days of dispatch ÷ forms dispatched in the window | **≥ 85%** |

> **`firstTimeRight`** is derived at I2 close: `commissioning.retestCount === 0` **and** no open
> snag of severity `major` or `blocker`. It records whether a return visit was needed.

> **Installation Lead Time is measured to I2 completion, not to handover** — the framework's phrase
> is "to *start* of installation", but a start timestamp with no completion is not measurable
> against a 5-day target. See assumption **A13**.

> **Feedback Collection Rate vs the closure gate.** The closure gate is absolute — no feedback, no
> closure. The 85% target therefore cannot be about eventual collection (which is 100% by
> construction). It measures *timely* return: within 30 days of dispatch. Jobs still awaiting
> feedback sit in status `support` and are excluded from the closure denominator. See assumption
> **A15**.

### CSAT dashboard

`GET /api/installations/csat?groupBy=technician|period|job` gives the "real-time visibility of
satisfaction scores by job, technician, and period" the framework requires. Grouping by technician
returns mean CSAT, job count, and first-time-right rate per technician.

---

## Where the numbers come from

| Source field | Feeds |
|---|---|
| `Lead.stageHistory[]` | every Sales conversion-rate KPI and the cycle-length KPI |
| `Lead.value`, `Lead.probability` | pipeline value, weighted pipeline |
| `WorkOrder.originalCommittedDate` | on-time delivery |
| `WorkOrder.committedDateSetAt`, `acceptedAt` | date notification rate |
| `WorkOrder.delayEvents[].noticeHours` | delay notification compliance |
| `WorkOrder.deliveryAccuracy` | delivery accuracy |
| `InstallationJob.commissioning.retestCount` | commissioning pass, first-time-right |
| `InstallationJob.postSupport.issues[]` | issue resolution time |
| `InstallationJob.feedback.csat` | CSAT |

`stageHistory[]` is what makes the Sales conversion rates computable at all. Before it existed,
the current stage was the only signal — so a lead that passed through Engagement and was later
lost was indistinguishable from one that never got there.
