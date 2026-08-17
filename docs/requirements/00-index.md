# IINVSYS Requirements — Index

This folder is the **source of truth** for how the IINVSYS platform is supposed to behave.
It transcribes two governance documents issued by the Sales Director and turns them into a
build specification that the application code mirrors one-for-one.

## Source documents

| File | Issued | Defines |
|---|---|---|
| [`source/Sales_CRM_Dictionary.pdf`](source/Sales_CRM_Dictionary.pdf) | 2026 | Every mandatory CRM field, its valid values, the stage model, and the hygiene rules |
| [`source/iinvsys_Business_Process_Framework.pdf`](source/iinvsys_Business_Process_Framework.pdf) | 2026 | The three operational processes (Sales, Delivery, Installation & CS), their handoffs, roles, KPIs, and ERP configuration requirements |

The PDFs are authoritative on *intent*. Where they are silent or self-contradictory, the
decision taken is recorded in [`07-open-questions-and-assumptions.md`](07-open-questions-and-assumptions.md)
— never invented ad hoc in code.

## Reading order

| # | Document | Read it when |
|---|---|---|
| 01 | [CRM Data Dictionary](01-crm-data-dictionary.md) | You are adding or changing a field on a lead/opportunity |
| 02 | [Business Process Framework](02-business-process-framework.md) | You need the stage-by-stage owner, inputs, activities, outputs and exit criteria |
| 03 | **[Stage Gates](03-stage-gates.md)** | You are touching transition logic. **This is the contract doc** |
| 04 | [Roles & Permissions](04-roles-and-permissions.md) | You are adding an endpoint or a role |
| 05 | [KPI Definitions](05-kpi-definitions.md) | You are building a dashboard, report or export |
| 06 | **[ERP Configuration Requirements](06-erp-configuration-requirements.md)** | You need traceability: which requirement is actually built, and what proves it. **Read this before estimating anything** |
| 07 | [Open Questions & Assumptions](07-open-questions-and-assumptions.md) | A requirement looks ambiguous — check here before deciding |
| 09 | [Configurable Rules](09-configurable-rules.md) | You are changing a threshold, or wondering why one is a Setting rather than a constant |
| 10 | [Frontend Architecture](10-frontend-architecture.md) | You are touching `frontend/` — the pipeline-driven rendering rule lives here |
| — | [~~Migration Notes~~](archive/08-migration-notes.md) | **Archived.** Superseded by the greenfield decision; kept in case the migration path is revived |

## The code mirror

Everything in documents 01–03 is expressed as executable data in a single module:

> **`backend/src/config/pipeline.js`**

That module has no `mongoose` import and no model dependency, which is what lets the schemas,
controllers, validators, scheduler, Excel builder and the `GET /api/meta/pipeline` endpoint all
consume the same definitions without a require cycle. The browser gets the same tables over
`/api/meta/pipeline` rather than duplicating them.

> **`pipeline.js` is finished; almost nothing consumes it yet.** The stage tables, gates, checklist
> templates and KPI targets are complete and correct, but as of today the models, services, jobs and
> routes that would evaluate them largely do not exist.
> [`06-erp-configuration-requirements.md`](06-erp-configuration-requirements.md) marks those rows 🔧
> *Spec only*. Read it before assuming a rule is enforced.

**If you change an enum or a gate, change `03-stage-gates.md` and `pipeline.js` in the same
commit.** Each file carries a comment pointing at the other.

## Change process

1. Amend the relevant document here, with a rationale.
2. Update `backend/src/config/pipeline.js` to match.
3. Update the status **and the `Verified by` column** in
   [`06-erp-configuration-requirements.md`](06-erp-configuration-requirements.md). A row may only be
   marked ✅ by the same commit that adds the test proving it.
4. Existing records are not migrated — the project is greenfield. Update the seed scripts instead so
   a clean database still exercises the change.

## Terminology note

The two source documents use different names for the same things. Throughout this folder:

| Source term | Canonical term used here |
|---|---|
| "Closed Won", "Commercial Order", "Order" | **Commercial Order** (stage key `commercial_order`) |
| "Order Lost", "Closed Lost" | **Order Lost** (stage key `order_lost`) |
| "Qualified stage" | **Engagement** (see assumption A2) |
| "Opportunity", "Deal", "Lead" | One record — the **Lead**, which carries the opportunity fields |
