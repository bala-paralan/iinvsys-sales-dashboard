# Stage Gates — the transition contract

> **This document and `backend/src/config/pipeline.js` are a matched pair.**
> Every row below appears in that module as an `entryRequires` entry. Change one, change the other
> in the same commit. `backend/tests/07-pipeline-gate.test.js` asserts the behaviour described here.

> **Role names in the prose below are the Business Process Framework's** ("Delivery Manager",
> "technician"), not system roles. ERP Bible V3 renamed the taxonomy — see
> [`04-roles-and-permissions.md`](04-roles-and-permissions.md). The gates themselves are
> unchanged: `technician` and the rest are FIELD names on the record, and every notification is
> addressed by permission rather than by role name.

## How a gate works

A gate is evaluated when a record moves **forward** to a new stage. It answers one question:
*are the mandatory fields and documents for the target stage present?*

```
POST /api/leads/:id/advance   { toStage, note, patch: {...}, force?, gateOverrideNote? }
        │
        ├── 1. canAdvance(from, to)?          → 422 STAGE_SKIP
        ├── 2. merge `patch` into the record
        ├── 3. validateStageEntry(record, to) → 422 STAGE_GATE_FAILED  { missing: [...] }
        └── 4. save + append stageHistory entry
```

**Nothing is persisted when a gate fails.** The merge in step 2 happens in memory; a rejection at
step 3 discards it. That is what makes "fill in the three missing fields and advance" a single
all-or-nothing request rather than a half-applied write.

### The four transition rules

| Move | Allowed? | Gate runs? |
|---|---|---|
| Forward exactly one stage | Yes | **Yes** |
| Forward more than one stage | **No** — `422 STAGE_SKIP` | — |
| Backward any number of stages, from an open stage | Yes | No — recorded in `stageHistory` |
| To the terminal stage (`order_lost`) from any open stage | Yes | Yes — the lost-reason gate |
| Out of `order_lost` into an **open** stage (re-engagement) | Yes — `direction: 'reopen'` | No — recorded in `stageHistory` |
| Out of `order_lost` straight to `commercial_order` | **No** — `422 STAGE_SKIP` | — |
| Out of `commercial_order`, in any direction | **No** — `422 TERMINAL_STAGE` | — |

"In sequence, no skipping" is the framework's own wording. It is enforced by `canAdvance()`.

**The two terminal stages are not symmetric.** `order_lost` is `reopenable` — re-engaging a lost
deal is ordinary business, and the `Lead` model has always carried an `isReEngage` flag. A reopened
deal lands in an open stage and must climb the pipeline again through the normal gates; it cannot
jump straight to Commercial Order. `commercial_order` is **not** reopenable, because a Delivery
Work Order already exists downstream of it — un-winning the deal would orphan that record.

### Save vs advance

`PUT /api/leads/:id` **never blocks on a gate** when the stage is unchanged. The lead form sends
`stage` only when it differs from the value it loaded, so an ordinary Save is always a same-stage
no-op transition and always succeeds. Only an explicit advance can fail a gate. This is what
satisfies "capture must stay fast" while still enforcing the framework.

### Manager override

A user at `manager` level or above may pass `force: true` together with a non-empty
`gateOverrideNote`. The transition applies, and the `stageHistory` entry records
`gateOverride: true` along with `missingAtOverride: [...]` — the exact list of what was waived.
An override is always visible, never silent. Overrides below manager level are rejected.

### `needsReview` is not a gate

Hygiene violations set `needsReview: true` and push codes into `reviewIssues[]`. They never block
anything. They surface in `GET /api/leads/hygiene`, on the lead card, and in the nightly
notification sweeps. See [`01-crm-data-dictionary.md`](01-crm-data-dictionary.md#crm-hygiene-rules).

---

## The `entryRequires` test vocabulary

Each requirement is a `{ field, test, message }` triple. `validateStageEntry()` is a small
interpreter over `test` — keeping this data-driven rather than a switch statement is what lets the
same table serve the API validator, the `GET /:id/gate` preflight, the UI checklist, and this doc.

| `test` | Passes when |
|---|---|
| `notEmpty` | The field is a non-empty string / non-null value |
| `isTrue` | The field is boolean `true` |
| `positiveNumber` | The field is a number greater than 0 |
| `futureDate` | The field is a date at or after today |
| `anyDate` | The field is a valid date |
| `oneOf:a\|b` | The field's value is in the listed set |
| `hasDoc:<docType>` | `attachments[]` contains at least one entry with that `docType` |
| `requiredIfB2B` | `notEmpty`, but only when `companyType !== 'homeowner'` |
| `requiredIf:<field>=<value>` | `notEmpty`, but only when the named sibling field has that value |
| `allItemsDone` | Every `required` item in the stage's checklist is `done` |
| `noOpenSnags` | No snag with severity `major` or `blocker` is open |

---

# Process 1 — Sales stage gates

### → `suspect` (S1)

Entry stage for every new lead. No gate — capture must stay fast.

The following are hygiene flags only, not blockers: `name`, `phone`, `source`.

### → `prospect` (S2)

| Field | Test | Message |
|---|---|---|
| `jobTitle` | `notEmpty` | Designation is required — the exact job title, not "manager" |
| `company` | `notEmpty` | Company name is required — the legal name |
| `companyType` | `notEmpty` | Company Type drives segmentation and the AMC rule |
| `city` | `notEmpty` | City is required |
| `state` | `notEmpty` | State is required — Zone is derived from it |
| `industrySegment` | `requiredIfB2B` | Industry is required for B2B contacts |
| `email` | `requiredIfB2B` | Email is required for B2B contacts |
| `nextFollowUpDate` | `futureDate` | Every open deal needs a future follow-up date |
| `nextAction` | `notEmpty` | Record the specific next action and who owns it |

*Rationale: S2's exit criteria are "Budget, authority, need and timeline broadly confirmed" — which
presupposes you know who and where the contact is. These are the dictionary's mandatory
lead/contact fields.*

### → `engagement` (S3)

| Field | Test | Message |
|---|---|---|
| `spenco.scoredAt` | `anyDate` | SPENCO scoring must be completed at the Prospect stage |
| `spenco.qualified` | `isTrue` | SPENCO total must meet the qualification threshold (≥18/30, evidence ≥3, size ≥2) |
| `competitor` | `notEmpty` | Competitor is required from Engagement onward — use "None Known" if applicable |
| `competitorOther` | `requiredIf:competitor=other` | Name the competitor |
| `value` | `positiveNumber` | Deal Value is required |
| `productPackage` | `notEmpty` | Select the product or package from the picklist |
| `expectedCloseDate` | `futureDate` | Expected Close Date is required and must not be in the past |
| `nextFollowUpDate` | `futureDate` | Every open deal needs a future follow-up date |

*Rationale: S2's exit criterion is the SPENCO threshold. "Qualified stage or later" in the
dictionary's Competitor row maps to Engagement — see assumption A2.*

### → `negotiation` (S4)

| Field | Test | Message |
|---|---|---|
| `attachments` | `hasDoc:proposal` | A proposal or quotation document must be on file |
| `expectedCloseDate` | `futureDate` | Expected Close Date must be current — update it when it changes |
| `nextFollowUpDate` | `futureDate` | Every open deal needs a future follow-up date |
| `nextAction` | `notEmpty` | Record the specific next action |

*Rationale: S3's exit criterion is "Customer has received and acknowledged the proposal." The
document on file is the evidence. `hasDoc:quote` also satisfies this — either type counts.*

### → `commercial_order` (S5)

| Field | Test | Message |
|---|---|---|
| `attachments` | `hasDoc:po` | **PO document gate** — the customer Purchase Order must be uploaded |
| `poNumber` | `notEmpty` | Log the PO number |
| `value` | `positiveNumber` | Deal Value must match the verified PO |
| `subscriptionOffered` | `oneOf:yes\|already_on_sub` | Subscription must be offered or already active at Closed Won |
| `amcOffered` | `requiredIfIndustrial` → `oneOf:yes\|already_on_amc` | AMC is mandatory for industrial company types |
| `expectedCloseDate` | `anyDate` | — |

`requiredIfIndustrial` reads `AMC_REQUIRED_COMPANY_TYPES` =
`msme_factory`, `large_factory`, `system_integrator`, `epc`, `government_psu` (assumption **A4**).

**On success this fires Handoff 1** — `createWorkOrderForLead()` creates the Delivery Work Order,
notifies the Delivery Manager, and starts the one-business-day clock for the target delivery date.

### → `order_lost`

Reachable from `suspect`, `prospect`, `engagement` or `negotiation`.

| Field | Test | Message |
|---|---|---|
| `lostReason` | `notEmpty` | A lost reason is required |
| `lostReasonDetail` | `requiredIf:lostReason=other` | Describe the reason |
| `lostTo` | `notEmpty` | Record who or what we lost to |
| `lostToName` | `requiredIf:lostTo=competitor` | Name the competitor |

---

# Process 2 — Delivery stage gates

A Work Order also carries a `status` (`created` → `accepted` → `in_progress` → `dispatched` →
`delivered`) alongside its stage. The stage is the workflow position; the status is what the KPIs
and sweeps query.

### → `order_review` (D1)

Entry stage, created by Handoff 1. No gate.

**Two SLA clocks start here.** Failure to *accept* within one business day of creation, and
failure to *confirm a target delivery date* within one business day of acceptance, are two
separately tracked breaches (assumption **A11**).

### → `procurement` (D2)

| Field | Test | Message |
|---|---|---|
| `acceptedAt` | `anyDate` | The Work Order must be accepted by the Delivery Manager |
| `currentCommittedDate` | `futureDate` | A target delivery date must be confirmed to the customer |
| `customerAck.acknowledged` | `isTrue` | The customer must have acknowledged the committed date |
| `items` | `notEmpty` | Verify product specifications and quantities against the PO |

### → `preparation_packing` (D3)

| Field | Test | Message |
|---|---|---|
| `stockConfirmedAt` | `anyDate` | All items must be physically available, quality-checked and tagged to this Work Order |

### → `scheduling_dispatch` (D4)

| Field | Test | Message |
|---|---|---|
| `attachments` | `hasDoc:packing_list` | Packing list must be attached |
| `attachments` | `hasDoc:delivery_note` | Delivery note must be attached |
| `attachments` | `hasDoc:invoice` | Tax invoice must be attached |
| `packingCheckedBy` | `notEmpty` | The packing checklist must be signed off |

*Rationale: "No delivery should proceed without a complete set of dispatch documents."*

### → `delivery_handover` (D5)

| Field | Test | Message |
|---|---|---|
| `dispatchedAt` | `anyDate` | The shipment must be physically dispatched |
| `dispatchDetails.carrier` | `notEmpty` | Record the carrier or vehicle |

### → status `delivered` (the DA gate)

| Field | Test | Message |
|---|---|---|
| `attachments` | `hasDoc:delivery_acknowledgement` | **The signed Delivery Acknowledgement is mandatory** |
| `attachments` | `hasDoc:da_photo` | Photo evidence of delivery condition is mandatory |
| `deliveryAccuracy.itemsDelivered` | `positiveNumber` | Verify items against the delivery note |

**On success this fires Handoff 2** — `createInstallationJobForWorkOrder()` creates the
Installation Job and notifies the Installation Manager.

### The delay rule

`originalCommittedDate` is **write-once**. It is set the first time a target date is committed and
never changes. Every subsequent date change must go through `POST /:id/delay`, which requires:

| Field | Test |
|---|---|
| `reasonCode` | `notEmpty`, one of `DELAY_REASON_CODES` |
| `revisedDate` | `futureDate` |

The endpoint computes `noticeHours = hours between now and originalCommittedDate`. A delay logged
with `noticeHours < 48` is a **compliance breach** — it is recorded, not rejected, because
refusing to record a late delay would simply hide it. The breach feeds the Delay Notification
Compliance KPI and raises a critical notification to the Delivery Manager, Sales owner and manager.

---

# Process 3 — Installation & CS stage gates

Every install stage carries a **checklist template** in `pipeline.js`. The universal rule from the
framework — *"stage-specific checklists must be fully completed before the stage can be
progressed"* — is expressed as an `allItemsDone` test on each gate.

### → `planning` (I1)

Entry stage, created by Handoff 2. No gate.

### → `on_site` (I2)

| Field | Test | Message |
|---|---|---|
| `siteReady.confirmedAt` | `anyDate` | The customer must confirm site readiness: power, space, access, civil work |
| `technician` | `notEmpty` | Assign an installation technician |
| `scheduledDate` | `anyDate` | Schedule the installation date |
| `checklists.planning` | `allItemsDone` | Complete the planning checklist |

**Planning checklist:** site power supply confirmed · space and access confirmed · civil
requirements confirmed · technician assigned · tools and consumables prepared · documentation pack
prepared.

### → `commissioning` (I3)

| Field | Test | Message |
|---|---|---|
| `checklists.on_site` | `allItemsDone` | The Installation Checklist must be fully completed |
| `checklists.on_site.signedByName` | `notEmpty` | The technician must sign the Installation Checklist |
| *snags* | `noOpenSnags` | No open major or blocker snagging items may remain |

**On-site checklist:** unboxed and inventory verified · assembled and positioned · wired to spec ·
configured per technical specification · installation SOP followed · site left clean · snags
recorded.

### → `handover_training` (I4)

| Field | Test | Message |
|---|---|---|
| `commissioning.passed` | `isTrue` | The product must pass the full functional test protocol |
| `commissioning.technicianSignedAt` | `anyDate` | The technician must sign the Commissioning Test Report |
| `commissioning.customerCountersignedAt` | `anyDate` | **The customer representative must countersign the report** |
| `attachments` | `hasDoc:commissioning_report` | The Commissioning Test Report must be uploaded |

*The dual signature is explicit in the framework: "signed by the technician and countersigned by
the customer representative." A single signature does not satisfy this gate.*

### → status `handed_over`

| Field | Test | Message |
|---|---|---|
| `attachments` | `hasDoc:handover_certificate` | A signed Handover Certificate must be uploaded |
| `handover.trainedAttendees` | `notEmpty` | Record who attended the end-user training |
| `checklists.handover_training` | `allItemsDone` | Complete the handover checklist |

**Handover checklist:** operation training delivered · maintenance training delivered ·
troubleshooting basics covered · user manual handed over · warranty card handed over · service
contact details provided.

Setting `handedOverAt` starts two clocks: the **7-day check-in** and the **14-day feedback
dispatch**.

### → `post_support` (I5) and `feedback` (I6)

| Gate | Field | Test |
|---|---|---|
| → `feedback` | `postSupport.checkInDoneAt` | `anyDate` — the 7-day proactive check-in must be done |
| → `feedback` | *issues* | All logged issues must be resolved and closed |

### → status `closed` (the closure gate)

| Field | Test | Message |
|---|---|---|
| `feedback.receivedAt` | `anyDate` | **A record cannot be Closed until the Customer Feedback Form is received** |
| `feedback.csat` | `positiveNumber` | Log the CSAT score |
| `correctiveAction.documentedAt` | `requiredIf:feedback.csat<3` | A corrective action plan must be documented before closing a job with CSAT below 3.0 |

When a CSAT below 3.0 is logged, `POST /:id/feedback` sets `correctiveAction.required = true` and
`correctiveAction.dueAt = 5 business days from now`, and raises a critical notification to the
Customer Service Manager. The overdue plan is swept nightly.

---

## Process 0 — Inside Sales (ERP Bible V3, document 1)

A **fourth stage table**, not extra SPENCO stages. Doc 1 numbers Inside Sales records
`IS-2026-XXXX` and doc 2 numbers deals `SA-2026-XXX`, and IS-DIR-03's "Bypass IS" creates
both at once — so a qualified lead never becomes a deal in place, it *mints a linked
`track:'sales'` record*. Customer 360 then shows the nurture and the deal as the two
distinct things they are.

The table is held in `IS_STAGES` and runs through the same `stageService.applyTransition`
contract as Sales, Delivery and Installation, with `stageField: 'isStage'`.

| Stage | Entry requires | Why |
|---|---|---|
| **New** | — | Assigned, not yet contacted. |
| **Contacted** | `lastActivityAt` is a date; `customer` is linked | IS-DIR-01 treats a lead with zero activities as an instant red flag, so reaching Contacted requires that an interaction actually exists. The customer link is what the activity log hangs off. |
| **Qualified** | all four of `bant.{budget,authority,need,timeline}.confirmed` | IS-EX-05. A dimension cannot be confirmed without a note — the IS Head reads those notes at IS-HD-04, and "Budget ✓" is not something anyone can decide on. |
| **Handoff Requested** | `handoffApproval` is set | Reached only by `POST /api/is/leads/:id/request-handoff`, never by moving the stage. |
| **Converted to Sales** | `convertedTo` is set | Reached only by an IS Head approving the handoff. The advance endpoint refuses this stage outright, which is what makes "no Sales deal without an approved handoff" a property of the system rather than a convention. |
| **Disqualified** | `lostReason` | Reachable from any open stage; re-openable. |



## Notification triggers attached to gates

| Event | Recipients | Severity | Email? |
|---|---|---|---|
| Lead advanced to `commercial_order` | Delivery Manager | critical | — |
| PO uploaded | Finance | info | ✔ |
| Work Order created (Handoff 1) | Delivery Manager | critical | — |
| Delivery date not confirmed within 1 business day of acceptance | Delivery Manager, Sales Manager, lead owner | critical | ✔ |
| Delay logged with `noticeHours < 48` | Delivery Manager, Sales owner, manager | critical | ✔ |
| Revised delivery date recorded | Sales owner | warn | — |
| DA uploaded (Handoff 2) | Installation Manager | critical | — |
| Installation Job created | Installation Manager | critical | — |
| Commissioning failed | Installation Manager, manager | warn | — |
| Handover complete | Customer Service Executive | info | — |
| Issue open past its 48h SLA | CS Executive, manager | warn | — |
| CSAT below 3.0 | CS Executive, Customer Service Manager | critical | ✔ |
| Corrective action plan overdue (5 business days) | manager | critical | — |
