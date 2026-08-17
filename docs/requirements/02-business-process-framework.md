# Business Process Framework — Sales · Delivery · Installation & Customer Service

> Transcribed from [`source/iinvsys_Business_Process_Framework.pdf`](source/iinvsys_Business_Process_Framework.pdf).

## The value chain

Three processes, independent in execution, joined by two formal handoffs:

```
PROCESS 1                PROCESS 2                  PROCESS 3
SALES              →     DELIVERY             →     INSTALLATION & CS
Lead → Purchase Order    PO → Delivery              Delivery → Customer Feedback

        Handoff 1 ─────┘            Handoff 2 ─────┘
  Confirmed Purchase Order      Signed Delivery Acknowledgement
  triggers the Delivery         triggers the Installation
  Work Order                    Work Order
```

Both handoffs are **mandatory workflow gates**. No downstream process is activatable without the
trigger document physically present in the system.

---

# Process 1 — SALES

**Scope:** Lead generation to confirmed Purchase Order · **Method:** SPENCO
**Starts:** a Suspect is identified and entered · **Ends:** a signed PO is received, verified, and the Delivery Work Order is created

| Stage | Owner | Key activities | Inputs | Outputs / deliverables | Exit criteria |
|---|---|---|---|---|---|
| **S1 Suspect** | Sales Executive / BDM | Identify any individual or organisation that may need the product. Build lead lists via market research, referrals, trade events and digital channels. Enter with source tagged. | Market intelligence, referrals, marketing campaigns, industry directories | Suspect record: company name, contact, source, date of entry | Suspect is logged and preliminary research confirms target industry or segment fit |
| **S2 Prospect** | Sales Executive | Qualify against SPENCO: Size, Potential, Evidence of need, Need type, Competition awareness, Origin of need. Score and record the outcome. | Suspect record, initial discovery call or meeting notes | Qualified Prospect with SPENCO score. Disqualified suspects archived with a reason code. | Prospect meets the minimum SPENCO threshold. Budget, authority, need and timeline broadly confirmed. |
| **S3 Engagement** | Sales Executive + Sales Manager | Formal meetings, product demonstrations, site visits. Deep requirement discovery. Present the value proposition. Submit a detailed proposal or quotation. | Qualified Prospect record, product catalogue, pricing matrix | Proposal or quotation submitted and acknowledged by the prospect. Follow-up date recorded. | Customer has received and acknowledged the proposal. Next action date is set. |
| **S4 Negotiation** | Sales Manager + Sales Director | Address objections on price, scope, delivery timelines and contract terms. Revise proposals. Obtain internal approval for any discount or scope deviation per the approval matrix. | Submitted proposal, customer objection log, internal approval matrix | Revised, mutually agreed commercial terms. Internal approval sign-off recorded. | Customer confirms agreement on commercial terms, in writing or by documented verbal confirmation. |
| **S5 Commercial Order** | Sales Manager + Finance / Admin | Customer issues the Purchase Order. Verify the PO against agreed scope, price and terms. Log it. Create the internal Work Order. Notify Delivery. Mark Closed-Won. | Agreed proposal, customer PO document | PO logged. Work Order created. Delivery team notified. Opportunity status: Closed-Won. | PO verified and Work Order accepted by the Delivery Manager. Sales process is closed. |

### Roles & accountability

- **Sales Executive** — owns Suspect through Engagement. Responsible for pipeline volume and lead quality.
- **Sales Manager** — co-owns Engagement, leads Negotiation, approves Commercial Order entry.
- **Sales Director** — final authority on deviations from standard terms and discounts beyond threshold.
- **Finance / Admin** — validates the PO against agreed commercial terms before logging.

### Rules

- All stage transitions must be updated by the responsible owner **before** progression.
- Opportunities inactive for **30 or more days** are flagged automatically for Sales Manager review.

---

# Process 2 — DELIVERY

**Scope:** Confirmed Purchase Order to signed Delivery Acknowledgement · **Owner:** Delivery Team
**Starts:** the Work Order is created following the Sales handoff · **Ends:** the product is delivered and the signed DA is uploaded

### Delivery date notification & delay communication policy

> Upon Work Order acceptance, the Delivery Manager **must confirm a target delivery date to the
> customer within one business day** and record it. If at any point delivery is anticipated to be
> delayed — stock shortage, logistics constraint, or any other reason — the Delivery Manager must
> notify **both the customer and the Sales team** at the earliest opportunity and **no later than
> 48 hours before the originally committed date**. A revised date must be recorded and the
> customer must acknowledge the change. All delay events must be logged against the Work Order
> with a **reason code** for performance review.

This is the most operationally specific requirement in either document, and it drives three
schema decisions: `originalCommittedDate` is **write-once**, every subsequent change flows through
a delay event carrying a mandatory `reasonCode`, and `noticeHours` is computed against the
*original* date, not the current one.

| Stage | Owner | Key activities | Inputs | Outputs / deliverables | Exit criteria |
|---|---|---|---|---|---|
| **D1 Order Review & Planning** | Delivery Manager | Review the Work Order. Verify product specifications, quantities and delivery address against the PO. Confirm internal stock availability. Raise a procurement request if stock is insufficient. Set and confirm the target delivery date with the customer within one business day of Work Order receipt. | Work Order, Sales handoff package, inventory records | Delivery Plan with target date, assigned logistics person, task checklist. Delivery date confirmed to customer and recorded. | Delivery Plan approved. Target delivery date confirmed to the customer and logged. |
| **D2 Procurement & Stock Allocation** | Procurement / Warehouse | Allocate reserved stock or raise a supplier purchase order. Track procurement status daily. Receive goods and conduct incoming quality inspection. Update stock levels and Work Order status. Notify the Delivery Manager immediately if procurement risks causing a delay. | Delivery Plan, supplier database, warehouse stock records | Stock confirmed available and reserved against the Work Order | All required items are physically available, quality-checked, and tagged to the Work Order |
| **D3 Preparation & Packing** | Warehouse / Operations | Pick items per the Work Order. Conduct pre-dispatch quality inspection. Pack securely with correct labelling. Prepare dispatch documents: packing list, delivery note, tax invoice. Attach all documents to the Work Order. | Work Order, stock allocation, packing standards SOP | Packed and labelled shipment. Dispatch documents generated and attached. | Packing checklist completed and signed off. All dispatch documents attached to the Work Order. |
| **D4 Scheduling & Dispatch** | Logistics Coordinator | Confirm delivery date and time window with the customer. Assign vehicle and personnel or book third-party logistics. Brief the delivery team on site-specific access requirements. Update status to In Transit. If any event here risks a delay, notify the customer and Sales immediately and record a revised date. | Packed shipment, customer contact, transport resources | Dispatch confirmed. Status In Transit. Customer notified of the delivery window. | Shipment physically dispatched. Delivery team or logistics partner in possession of goods and all documents. |
| **D5 Delivery & Handover** | Delivery Executive / Logistics | Transport goods to site. Unload and verify items against the delivery note with the customer representative. Obtain the customer signature on the Delivery Acknowledgement. Photograph delivery as proof of condition. Upload the signed DA and photo evidence. | Goods, delivery note, DA form | Signed DA uploaded. Status Delivered. Installation Work Order auto-triggered. | Signed DA received, photographed and uploaded. Status is Delivered. Installation team notified. |

### Roles & accountability

- **Delivery Manager** — owns the process end to end. Accountable for delivery dates, customer communication and delay notification.
- **Procurement / Warehouse** — stock availability, quality inspection, packing.
- **Logistics Coordinator** — scheduling, dispatch, third-party logistics management.
- **Delivery Executive** — on-ground handover, obtains the signed DA, uploads proof.

### Rules

- No delivery proceeds without a complete set of dispatch documents.
- **The Delivery Acknowledgement is a mandatory contractual record — no Work Order can be closed without it.**
- Every delay must be logged with a reason code for monthly performance review.

### Delay reason codes

`stock_unavailable` · `supplier_delay` · `logistics_delay` · `customer_site_not_ready` ·
`customer_requested` · `quality_hold` · `payment_pending` · `transport_damage` ·
`force_majeure` · `internal_scheduling` · `other`

---

# Process 3 — INSTALLATION & CUSTOMER SERVICE

**Scope:** Signed Delivery Acknowledgement to closed Customer Feedback record · **Owner:** Installation & CS Team
**Starts:** the signed DA triggers the Installation Work Order · **Ends:** the Customer Feedback Form is received, logged, and the record is marked Closed

| Stage | Owner | Key activities | Inputs | Outputs / deliverables | Exit criteria |
|---|---|---|---|---|---|
| **I1 Installation Planning** | Installation Manager | Review the DA and Work Order. Confirm site readiness with the customer: power supply, space, access, civil requirements. Assign a technician. Schedule the date. Prepare tools, consumables and the documentation pack. | Signed DA, Work Order, site requirement checklist, customer contact | Installation Schedule. Site Readiness Confirmation on file. | Customer has confirmed the site is ready. Installation date and assigned technician recorded. |
| **I2 On-Site Installation** | Installation Technician | Travel to site on the scheduled date. Unbox, assemble, position, wire and configure per technical specifications and the installation SOP. Complete the Installation Checklist. Report site issues immediately. | Installation schedule, technical manual, tools, consumables, installation SOP | Product physically installed. Installation Checklist completed and signed by the technician. | All items on the Installation Checklist are completed and verified. No open snagging items remain. |
| **I3 Commissioning & Testing** | Installation Technician + Installation Manager | Power on and conduct the full functional test protocol. Verify all features operate per the scope of supply. Record test results. Identify and resolve any snags or defects before sign-off. | Installation Checklist, product test protocol, scope of supply document | Commissioning Test Report signed by the technician **and countersigned by the customer representative** | Product passes all functional tests. The customer representative has witnessed testing and signed the report. |
| **I4 Handover & Training** | Installation Manager / Trainer | Conduct end-user training covering product operation, routine maintenance and basic troubleshooting. Hand over the user manual, warranty card and service contact details. Obtain the signed Handover Certificate. | Commissioned product, training materials, warranty documents, user manual | Signed Handover Certificate uploaded. All documentation handed to the customer and recorded. | Handover Certificate signed by an authorised customer representative. Status is Handed Over. |
| **I5 Post-Installation Support** | Customer Service Executive | Proactive check-in call or visit **within 7 days of handover**. Log any issues raised. Resolve operational queries. Escalate technical issues to the Installation team with a defined response SLA. Track and close all issues. | Handover Certificate, customer contact, issue log | All support interactions logged against the customer record. All raised issues resolved and closed. | All post-handover issues are resolved and their records are closed. |
| **I6 Customer Feedback** | Customer Service Executive / Manager | Dispatch the Customer Feedback Form **within 14 days of the Handover Certificate date**. Follow up if not returned within 7 days of dispatch. Log the CSAT score and comments. Escalate any score below threshold to the Customer Service Manager for corrective action. | Support log, Customer Feedback Form, handover date | Completed Feedback Form stored. CSAT score recorded. Process marked Closed. | Feedback Form received and logged. **If CSAT is below 3.0 out of 5.0, a corrective action plan is initiated and documented before closing.** |

### Roles & accountability

- **Installation Manager** — plans and supervises all installation activity. Accountable for commissioning quality and schedule.
- **Installation Technician** — executes on-site installation and functional testing. Responsible for technical accuracy.
- **Customer Service Executive** — manages the post-handover support window, feedback dispatch and issue escalation.
- **Customer Service Manager** — reviews CSAT scores, drives corrective actions, reports to the Sales Director.

### Rules

- A job record **cannot be marked Closed until the Customer Feedback Form is received**.
- If CSAT falls below 3.0, the Customer Service Manager must initiate and document a corrective
  action plan **within 5 business days** of receipt.

---

# Handoff summary

| Handoff | From | To | Trigger document | System action |
|---|---|---|---|---|
| **1** | Sales | Delivery | Confirmed & verified Purchase Order | Work Order auto-created · Delivery Manager notified · target delivery date to be set within 1 business day |
| **2** | Delivery | Installation & CS | Signed Delivery Acknowledgement uploaded | Installation Work Order auto-triggered · Installation Manager notified |

Both are implemented in `backend/src/services/handoffService.js`, called explicitly from the
controller that satisfies the gate — never from a Mongoose hook, so that migrations, seeds and
bulk imports cannot accidentally fire a handoff. Both are idempotent: the back-pointer
(`lead.workOrder`, `workOrder.installationJob`) plus a unique document-number index means a
retried request returns the existing record rather than creating a second one.
