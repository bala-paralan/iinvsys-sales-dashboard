# Open Questions & Assumptions

Where the source documents are silent, ambiguous, or contradict themselves, this file records the
decision taken. **Nothing here was invented in code without being written down first.**

Each assumption is a named constant or a single table in `backend/src/config/pipeline.js`, so
reversing one is a one-line change plus (where data already exists) a migration.

**Priority key:** 🔴 confirm before Phase 1 ships — expensive to change once data exists ·
🟠 confirm before go-live · 🟢 safe default, revisit if the client objects

> **⚙️ Ten of these are now runtime settings, not constants — see
> [`09-configurable-rules.md`](09-configurable-rules.md).** That covers every 🔴 assumption
> (**A2**, **A4**, **A12**, **A18**) plus **A5**, **A8**, **A9** and **A17**. They no longer block
> Phase 1: a client ruling is a Settings change, validated on write, with no code change and no data
> migration. They still need answers — a default nobody chose is still a guess — but the cost of
> being wrong is now an afternoon rather than a migration.
>
> The rows below record the *reasoning* behind each default, which is why they are unchanged.

---

| # | Priority | Ambiguity | Assumption taken | Owner | Decision by |
|---|---|---|---|---|---|
| **A1** | 🟢 | The CRM Dictionary numbers stages 1, 2, 3, **5**, 6, 7 — it skips 4. The Process Framework lists S1–S5 with no gap. | Follow the framework. Five sequential forward stages (`order` 1–5, `shortCode` S1–S5) plus a terminal Order Lost reachable from any open stage. The dictionary's numbering is treated as a typo. | Sales Director | — |
| **A2** | 🔴 | The Competitor field is "required at **Qualified** stage or later", but no stage is named Qualified. | Qualified == **Engagement (S3)**, because SPENCO qualification is precisely what gates Prospect → Engagement. Competitor becomes mandatory to *enter* Engagement. | Sales Director | before Phase 1 |
| **A3** | 🟢 | The dictionary says "Closed Won"; the framework says "Commercial Order". | The same stage. Stored key `commercial_order`, label "Commercial Order". The Subscription and AMC rules attach to its gate. | — | — |
| **A4** | 🔴 | "AMC Offered must be Yes at Closed Won **for industrial**" — *industrial* is never defined. | `AMC_REQUIRED_COMPANY_TYPES = { msme_factory, large_factory, system_integrator, epc, government_psu }`. Homeowner, Builder/Developer, Distributor and Other are exempt. | Sales Director | before Phase 1 |
| **A5** | 🟠 | "Do not override the stage default up by more than 15% without a note" — 15 percentage points, or 15% relative? | **Percentage points.** Engagement default 45 → may reach 60 without a note. Relative would give 51.75, which is not a number anyone types. | Sales Director | before go-live |
| **A6** | 🟠 | Industry and Email are "mandatory for B2B", but B2B is never defined. | `isB2B() ⇔ companyType !== 'homeowner'`. One helper governs both fields, so they can never diverge. | Sales Director | before go-live |
| **A7** | 🟢 | Phone must be a "10-digit mobile", but existing records and test fixtures contain shorter numbers. | Enforce `/^[6-9]\d{9}$/` **in the express-validator layer only**, not in the Mongoose schema. New input is validated; existing records survive and are flagged `needsReview` rather than becoming unsaveable. | — | — |
| **A8** | 🟢 | Follow-up "never more than 14 days out without a reason in Notes" — gate or warning? | **Warning only.** It appears under CRM Hygiene Rules, not under stage exit criteria. Sets `followup_far_unexplained`. | — | — |
| **A9** | 🟢 | "Minimum one note per week for every deal in Stage 3 and above" — what counts as a note? | A `followUps[]` entry **or** a `stageHistory` entry carrying a note, within 7 calendar days. Hygiene flag only. | — | — |
| **A10** | 🟢 | Lost Reason offers "Other (specify)" and Lost To offers "Competitor name" — where does the specified text go? | Companion free-text fields `lostReasonDetail` and `lostToName`, each required when its parent enum is `other` / `competitor`. | — | — |
| **A11** | 🟠 | Delivery date must be confirmed "within one business day of Work Order **acceptance**" — but the same paragraph also says "of Work Order receipt". | The clock for the date-confirmation SLA starts at **`acceptedAt`**. Failure to *accept* within one business day of creation is tracked as a **separate** breach, so neither reading is lost. | Delivery Manager | before go-live |
| **A12** | 🔴 | "No later than 48 hours before the **originally** committed date" — does the clock reset when a date is revised twice? | **No.** `originalCommittedDate` is write-once and never overwritten; `currentCommittedDate` moves. `noticeHours` is always measured against the original. Otherwise repeated small revisions would reset the clock indefinitely and the KPI would be meaningless. | Delivery Manager | before Phase 2 |
| **A13** | 🟠 | Installation Lead Time is "≤5 business days from Delivery Acknowledgement to **start** of installation" — a start event has no completion to measure. | Measured from DA upload (the Handoff 2 trigger) to **I2 completion**. A start-only timestamp cannot be assessed against a target. | Installation Manager | before Phase 3 |
| **A14** | 🟢 | "Reminder sent if not returned in 7 days" — seven days from handover, or from dispatch? | From **dispatch**. Feedback dispatch is itself up to 14 days after handover; measuring the reminder from handover would make it fire before some dispatches. | — | — |
| **A15** | 🟠 | A record cannot be Closed without feedback, yet the Feedback Collection Rate target is only ≥85%. If closure requires feedback, collection is 100% by construction. | The hard closure gate holds. Jobs awaiting feedback sit in status `support` with `feedback.dispatchedAt` set, and are excluded from the closure denominator. The 85% KPI measures **timely** return — within 30 days of dispatch. | CS Manager | before Phase 3 |
| **A16** | 🟢 | Can one contact hold multiple concurrent opportunities? | **No — 1:1 for this release.** The Lead record *is* the opportunity, with flat fields. Neither document requires otherwise, and the dictionary places Lead Source and Deal Value on the same record. The flat field set is already the exact column list a future extraction would need. | — | — |
| **A17** | 🟠 | Zone is "auto-filled from state", but India has no single canonical four-zone split. | The table in [`01-crm-data-dictionary.md`](01-crm-data-dictionary.md#zones-and-the-state--zone-table), held as `STATE_TO_ZONE` in `pipeline.js`. **Madhya Pradesh and Chhattisgarh to West is the debatable placement** — some organisations put them in Central or North. Unrecognised states leave `zone` blank and flag for review rather than guessing. | Sales Director | before go-live |
| **A18** | 🔴 | **The SPENCO minimum qualification threshold is never stated.** The framework says only "Prospect meets minimum SPENCO threshold." | `SPENCO_MIN_TOTAL = 18` out of 30 (60%), with hard sub-gates `evidenceOfNeed ≥ 3` and `size ≥ 2`. **This is the single assumption most likely to be wrong** — it directly controls how many suspects become prospects, and therefore the Suspect-to-Prospect KPI against its 40% target. | Sales Director | **before Phase 1** |
| **A19** | 🟠 | SPENCO's "Need type" is a category, not obviously a 0–5 score. | Scored 0–5 like the others (how well the need type fits our offering), **plus** a categorical `needTypeLabel` from `{replacement, expansion, new_build, compliance, upgrade}` for reporting. | Sales Director | before go-live |
| **A20** | 🟢 | "Search by phone number first. Duplicates corrupt reporting." — advisory or enforced? | **Enforced.** `POST /api/leads` returns `409` when the phone matches an existing lead, unless the caller supplies a `dupeOverride` with a reason code. The existing client-side duplicate-check flow already produces exactly that payload, and the Referrer Manual documents today's *unenforced* behaviour as a known gap. | — | — |
| **A21** | 🟢 | The dictionary wants an Industry picklist, but `industry` already exists as a free-text field written by the auto-enrichment provider (PRD-5). | Keep both. `industry` stays free-text and enrichment-owned, with its existing provenance and rollback. New `industrySegment` is the compliance-gated picklist, rep-owned. Enrichment may *suggest* a segment in the UI; it never writes one. | — | — |
| **A22** | 🟢 | "Product / Package — select from product picklist" but the existing model has `products[]` (multi-select ObjectIds), and packages are not modelled. | `products[]` stays as the line-item selection. New `productPackage` is a string naming the commercial package, used in the auto-composed Opportunity Name. Full package modelling (bundle-of-products with pricing) is out of scope. | Sales Director | before go-live |
| **A23** | 🟢 | The framework's Delivery Executive role has no permission the Logistics Coordinator lacks. | Both map to the `logistics` system role. Likewise Customer Service Manager maps to `manager`. Fewer roles, same enforcement. | — | — |
| **A24** | 🟠 | Delivery and Installation staff need customer details but must not see deal intelligence. | `WorkOrder` and `InstallationJob` carry a denormalised `customerSnapshot`; neither role is granted `lead.read`. This is also historically correct — the delivery record reflects the customer as they stood at PO verification. | Sales Director | before go-live |
| **A25** | 🟢 | Where do uploaded documents live, given the app deploys to both Vercel (ephemeral filesystem) and on-prem Docker? | **GridFS by default**, over the existing Mongo connection — identical behaviour on both targets, no new infrastructure. A `local` driver exists for on-prem installs wanting files on a mountable disk, and refuses to start when `process.env.VERCEL` is set rather than silently writing to `/tmp`. | Ops | before go-live |

---

## The four to settle first

If only four of these get client time, make them **A18** (SPENCO threshold), **A2** (which stage
"Qualified" means), **A4** (what counts as industrial for AMC) and **A12** (whether the 48-hour clock
resets on re-revision). Each one silently changes what a KPI reports.

All four are now settings rather than constants, so none of them blocks a release. What that buys is
time, not certainty — **A18 in particular still needs a real answer.** It determines the numerator of
the Suspect-to-Prospect rate reported against a 40% target, so until the Sales Director rules, that
KPI is measured against a threshold nobody chose. Ship on `18`, measure the actual rate for a month,
and bring the real number to that conversation.
