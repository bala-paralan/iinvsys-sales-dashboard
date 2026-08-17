# CRM Data Dictionary & Field Definitions

> Transcribed from [`source/Sales_CRM_Dictionary.pdf`](source/Sales_CRM_Dictionary.pdf).
> Every enum below lists the **stored key** (what goes in MongoDB and the API) alongside the
> **display label** (what the user sees). The keys are defined once in
> `backend/src/config/pipeline.js` and served to the browser by `GET /api/meta/pipeline`.

## Purpose

> The CRM is only as useful as the data in it. Clean data = accurate forecasting.
> Garbage data = wrong decisions.

**Golden rule.** Enter data the way you would want to read it in a report six months from now.
Full names. Full product names. Complete next actions. Not *"followed up"* — *"Called on
14 July, sent revised proposal to Rajesh Kumar. Waiting for his MD's approval. Next call: 21 July."*

**Enforcement model.** Leaving a mandatory field blank does **not** block the save — capture at
an expo must stay fast. It does two things instead:

1. The record is flagged `needsReview` with a machine-readable `reviewIssues[]` list, surfaced
   to managers in the hygiene queue.
2. The lead **cannot advance to the next stage** until that stage's mandatory fields are
   present. See [`03-stage-gates.md`](03-stage-gates.md).

---

## Lead / Contact fields

| Field | API field | Mandatory | Type / valid values | Notes |
|---|---|---|---|---|
| Lead Source | `source` | Yes | `LEAD_SOURCES` enum | Always track where leads come from — it drives marketing investment decisions |
| Contact Name | `name` | Yes | String, First + Last | No "Mr." or "Sir" — just the name |
| Designation | `jobTitle` | Yes | String, exact job title as on their card/LinkedIn | Not "manager" — "Plant Operations Manager". Aliased as `designation` |
| Company Name | `company` | Yes | String, legal company name | Not "abc factory" |
| Company Type | `companyType` | Yes | `COMPANY_TYPES` enum | Drives reporting segmentation **and** the B2B / AMC rules |
| Industry | `industrySegment` | Yes (B2B) | `INDUSTRY_SEGMENTS` enum | Pack 2 priority: Auto, Pharma, FMCG, Steel |
| City | `city` | Yes | String, city name only | "Delhi", not "DEL" |
| State | `state` | Yes | String, full state name | |
| Zone | `zone` | Yes (derived) | `ZONES` enum | **Auto-filled from `state`** — see the zone table below |
| Phone (Primary) | `phone` | Yes | 10-digit Indian mobile, `/^[6-9]\d{9}$/` | Must be contactable — no landlines as primary |
| Email | `email` | Yes (B2B) | Email address | Company email preferred; personal acceptable if unavailable |

### `LEAD_SOURCES`

| Key | Label |
|---|---|
| `cold_call` | Cold Call |
| `referral` | Referral |
| `digital_website` | Digital / Website |
| `exhibition_event` | Exhibition / Event |
| `channel_partner` | Channel Partner |
| `builder_referral` | Builder Referral |
| `inside_sales_outbound` | Inside Sales Outbound |
| `inbound_enquiry` | Inbound Enquiry |
| `social_media` | Social Media |

> Leads captured through the expo/referrer flow are written as `exhibition_event`. The separate
> `expo` ObjectId reference remains the actual linkage to the event record.

### `COMPANY_TYPES`

| Key | Label | Counts as B2B? | AMC mandatory at Commercial Order? |
|---|---|---|---|
| `homeowner` | Homeowner | **No** | No |
| `msme_factory` | MSME Factory | Yes | **Yes** |
| `large_factory` | Large Factory | Yes | **Yes** |
| `builder_developer` | Builder / Developer | Yes | No |
| `system_integrator` | System Integrator | Yes | **Yes** |
| `epc` | EPC | Yes | **Yes** |
| `government_psu` | Government / PSU | Yes | **Yes** |
| `distributor` | Distributor | Yes | No |
| `other` | Other | Yes | No |

The "industrial" set that the dictionary requires AMC for is not defined in the source. See
assumption **A4** — the five types marked above are the working definition, held in
`AMC_REQUIRED_COMPANY_TYPES`.

### `INDUSTRY_SEGMENTS`

`auto` Auto · `pharma` Pharma · `fmcg` FMCG · `textile` Textile · `chemical` Chemical ·
`steel_metal` Steel / Metal · `electronics` Electronics · `food_processing` Food Processing ·
`cement` Cement · `ports` Ports · `railways` Railways · `it_manufacturing` IT Manufacturing ·
`other` Other

> **Two industry fields exist and this is deliberate.** `industry` is a free-text field owned by
> the auto-enrichment provider (PRD-5) with per-field provenance and a rollback endpoint.
> `industrySegment` is this compliance-gated picklist, owned by the sales rep. Enrichment may
> *suggest* a segment in the UI; it never writes one.

### `ZONES` and the state → zone table

| Zone | States / UTs |
|---|---|
| `north` | Jammu & Kashmir, Ladakh, Himachal Pradesh, Punjab, Haryana, Delhi, Chandigarh, Uttarakhand, Rajasthan, Uttar Pradesh |
| `south` | Karnataka, Kerala, Tamil Nadu, Andhra Pradesh, Telangana, Puducherry, Lakshadweep, Andaman & Nicobar Islands |
| `east` | West Bengal, Odisha, Jharkhand, Bihar, Assam, Sikkim, Arunachal Pradesh, Nagaland, Manipur, Mizoram, Tripura, Meghalaya |
| `west` | Maharashtra, Gujarat, Goa, Madhya Pradesh, Chhattisgarh, Dadra & Nagar Haveli and Daman & Diu |

India has no single canonical four-zone split; this table is the project's decision (assumption
**A17**). Madhya Pradesh and Chhattisgarh to West is the debatable placement. Matching is
case-insensitive and accepts common abbreviations; an unrecognised state leaves `zone` blank and
raises a `needsReview` flag rather than guessing.

---

## Opportunity / Deal fields

| Field | API field | Mandatory | Type / valid values | Notes |
|---|---|---|---|---|
| Opportunity Name | `opportunityName` | Yes | `[Company] — [Product/Package] — [Mon YYYY]` | Auto-composed when left blank, e.g. `Sharma Industries — SMART FACTORY — Jul 2026` |
| Product / Package | `productPackage` + `products[]` | Yes | From the product picklist | Do not type freeform — use the dropdown |
| Deal Value (₹) | `value` | Yes | Number, no separators | `250000`, not `₹2.5 Lakh` |
| Stage | `stage` | Yes | `SALES_STAGES` enum | Move stages within 24 hours of the trigger event |
| Expected Close Date | `expectedCloseDate` | Yes | Date | Update every time it changes — never leave an expired close date |
| Competitor | `competitor` | Conditional | `COMPETITORS` enum | Required from **Engagement** onward (assumption **A2**) |
| Next Action | `nextAction` | Yes | Free text — specific action + owner | *"Send revised commercial proposal — Exec. Deadline: 16 Jul"* |
| Next Follow-up Date | `nextFollowUpDate` | Yes | Date | Never blank. Never more than 14 days out without a reason in `nextFollowUpNote` |
| Subscription Offered? | `subscriptionOffered` | Yes | `yes` · `no` · `already_on_sub` | Must be `yes` or `already_on_sub` at Commercial Order |
| AMC Offered? | `amcOffered` | Yes | `yes` · `no` · `already_on_amc` | Must be `yes` or `already_on_amc` at Commercial Order **for industrial company types** |
| Probability | `probability` | Auto | 0–100 | Defaults to the stage value; see the override rule below |
| PO Number | `poNumber` | At Commercial Order | String | Logged with the PO document |

### `COMPETITORS`

`cisco` Cisco · `moxa` Moxa · `advantech` Advantech · `legrand` Legrand · `havells` Havells ·
`honeywell` Honeywell · `siemens` Siemens · `abb` ABB · `other` Other (specify) ·
`none_known` None Known

`other` requires the companion free-text field `competitorOther`.

### Lost fields

`lostReason` — `LOST_REASONS`:
`price_too_high` Price too high · `chose_competitor` Chose competitor ·
`no_budget_this_year` No budget this year · `technical_mismatch` Technical mismatch ·
`project_cancelled` Project cancelled · `no_decision_maker_access` No decision-maker access ·
`timeline_mismatch` Timeline mismatch · `internal_delays` Internal delays (our side) ·
`other` Other (specify) → requires `lostReasonDetail`

`lostTo` — `LOST_TO`:
`competitor` Competitor → requires `lostToName` · `no_purchase` No purchase (status quo) ·
`unknown` Unknown

---

## Stage definitions, probabilities and time limits

| Stage | Key | Code | Definition | Default probability | What moves it forward | Max days at stage |
|---|---|---|---|---|---|---|
| 1. Suspect | `suspect` | S1 | Contact identified. No conversation yet. | 5% | First call/email made | 14 |
| 2. Prospect | `prospect` | S2 | Conversation had. Need confirmed. Budget exists or will exist. | 15% | Discovery call completed. Pain confirmed. | 21 |
| 3. Engagement | `engagement` | S3 | Product shown or site visited. Formal quote/proposal sent. | 45% | Demo completed. Customer engaged. Proposal email sent with date. | 21 |
| 4. Negotiation | `negotiation` | S4 | Active price/term discussion. | 70% | Any pricing conversation started. | 21 |
| 5. Commercial Order | `commercial_order` | S5 | PO received in ERP. | 100% | PO number logged. Sub form signed. | — |
| — Order Lost | `order_lost` | — | Customer will not proceed. | 0% | Decision communicated by customer. | — |

> The source PDF numbers these 1, 2, 3, 5, 6, 7 — it skips 4. The framework document lists them
> as S1–S5 with no gap. We follow the framework: five sequential forward stages plus a terminal
> Order Lost reachable from any open stage. See assumption **A1**.

**Sequence is enforced.** A lead moves forward exactly one stage at a time. Backward moves are
always allowed and recorded. `order_lost` is reachable from any non-terminal stage.

---

## CRM hygiene rules

These are **non-blocking**. Each produces a `reviewIssues[]` code, a `needsReview` flag, and a
notification to the record owner. None of them prevents a save or an advance.

| Rule | Code | Evaluated |
|---|---|---|
| **Close Date** — update immediately when the expected date changes. An expired close date = inaccurate forecast. | `close_date_expired` | On save + nightly |
| **Probability** — do not override the stage default upward by more than **15 percentage points** without a note in `probabilityOverrideNote` | `probability_override_unexplained` | On save |
| **Next Follow-up Date** — every open deal must carry a future follow-up date. No exceptions. | `followup_missing`, `followup_past` | On save + nightly |
| **Next Follow-up Date** — never set more than 14 days out without a reason in `nextFollowUpNote` | `followup_far_unexplained` | On save |
| **Notes** — minimum one note per week for every deal at Engagement or above | `stale_notes` | Weekly (Mondays) |
| **Inactivity** — no activity for 30+ days auto-flags to the Sales Manager | `inactive_30d` | Nightly |
| **Max days at stage** — exceeded the stage's limit | `stage_age_exceeded` | Nightly |
| **Duplicate prevention** — search by phone number before creating a contact. Duplicates corrupt reporting. | *hard 409* | On create |

Duplicate prevention is the one rule that **is** blocking: `POST /api/leads` returns `409` when
an existing lead shares the phone number, unless the caller supplies a `dupeOverride` with a
reason code.

---

## SPENCO qualification

Scored at the **Prospect** stage; a passing score is what allows the move to Engagement.

| Dimension | API field | Scale | Question it answers |
|---|---|---|---|
| **S**ize | `spenco.size` | 0–5 | How large is the opportunity relative to our average deal? |
| **P**otential | `spenco.potential` | 0–5 | What is the follow-on / expansion potential beyond this deal? |
| **E**vidence of need | `spenco.evidenceOfNeed` | 0–5 | What concrete evidence exists that the need is real? |
| **N**eed type | `spenco.needType` | 0–5 | Is it replacement, expansion, new build, compliance or upgrade? (`needTypeLabel`) |
| **C**ompetition awareness | `spenco.competitionAwareness` | 0–5 | Do we know who else is bidding and where we stand? |
| **O**rigin of need | `spenco.originOfNeed` | 0–5 | Did the need originate internally, from regulation, or from us? |

`spenco.total` = the sum, 0–30. **Qualification threshold: `total ≥ 18`, with `evidenceOfNeed ≥ 3`
and `size ≥ 2`.** The source document gives no number — this is assumption **A18** and the single
value most likely to need client confirmation. It is a named constant, `SPENCO_MIN_TOTAL`.

A scored lead's SPENCO total also drives the existing `score` field
(`score = round(total / 30 × 100)`), so the hot/warm/cold badge finally reflects qualification.
Unscored leads keep the legacy default of 50.

Suspects that fail qualification are **archived, not deleted**: `spenco.disqualified = true` with
a `disqualifyReason` from `DISQUALIFY_REASONS` (`no_budget`, `no_authority`, `no_need`,
`wrong_segment`, `competitor_locked`, `unreachable`, `other`).
