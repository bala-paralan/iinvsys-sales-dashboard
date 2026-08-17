# Configurable Rules — R-2

> **Code mirror:** `DEFAULT_RULES` in [`backend/src/config/pipeline.js`](../../backend/src/config/pipeline.js)
> and the `SPEC` table in [`backend/src/config/pipelineRuntime.js`](../../backend/src/config/pipelineRuntime.js).
> Covered by `backend/tests/08-pipeline-rules.test.js`.

## Why these are settings and not constants

[`07-open-questions-and-assumptions.md`](07-open-questions-and-assumptions.md) records 25 places where
the source documents are silent or self-contradictory. Four are marked 🔴 *confirm before Phase 1* —
they were expensive to change once production data accumulated behind them, so they blocked the build.

They no longer block it. The values below are read from the `Setting` collection at boot, over the
compiled-in defaults. A client ruling becomes a Settings change, not a code change plus a migration.

**A18 is the reason this exists.** The SPENCO qualification threshold is never stated in either
document, and it alone decides how many suspects become prospects — which is the numerator of the
Suspect-to-Prospect KPI reported against its 40% target. Shipping a guess as a constant means the
first month of reporting is measured against a number nobody chose.

## The rules

| Setting key | Default | Type | Assumption |
|---|---|---|---|
| `pipeline.spenco.minTotal` | `18` (of 30) | number | **A18** |
| `pipeline.spenco.subGates` | `{evidenceOfNeed: 3, size: 2}` | object | **A18** |
| `pipeline.amcRequiredCompanyTypes` | `msme_factory`, `large_factory`, `system_integrator`, `epc`, `government_psu` | array | **A4** |
| `pipeline.competitorRequiredFromStage` | `engagement` | string | **A2** |
| `pipeline.probabilityOverrideMaxPoints` | `15` | number | **A5** |
| `pipeline.delayClockResetsOnRevision` | `false` | boolean | **A12** |
| `pipeline.stateToZone` | the A17 table | object | **A17** |
| `pipeline.inactivityAlertDays` | `30` | number | framework |
| `pipeline.followUpMaxDaysAhead` | `14` | number | **A8** |
| `pipeline.weeklyNoteDays` | `7` | number | **A9** |

Everything else in `pipeline.js` stays a constant. Stage keys, stage order, the enum vocabularies and
the KPI targets are **not** configurable — they come verbatim from the source documents, and making
them editable would let an operator silently invalidate historical reporting.

## How resolution works

```
boot
 ├── seedRuleSettings()   inserts any missing rows; never overwrites an operator's value
 ├── loadRules()
 │     ├── read Setting where key matches ^pipeline\.
 │     ├── resolveOverrides()  coerce + validate each row
 │     └── pipeline.setActiveRules(overrides)   → frozen resolved set
 └── every rule-aware function now reads the resolved set
```

Each rule-aware function takes an **optional trailing `rules` argument** defaulting to the active set:

```js
spencoQualified(spenco)                  // uses the active rules
spencoQualified(spenco, DEFAULT_RULES)   // explicit — what tests do
```

That shape matters. `setActiveRules` is process-global, and a test that mutated it without restoring
would silently change the result of every later test in the process. Passing rules explicitly keeps
the suite order-independent.

### Two rules change the stage tables, not just a number

`resolveStages(list, rules)` returns a **new** table — the module-level `SALES_STAGES` is never
mutated:

- **A2 / `competitorRequiredFromStage`** — the `competitor` and `competitorOther` gate rows are tagged
  `configKey: 'competitor'` and are *relocated* to whichever stage is configured. The dictionary
  requires Competitor "at Qualified stage or later", but no stage is called Qualified; when the client
  names one, this is the setting that moves it.
- **A18 / `spencoMinTotal`** — the threshold appears in the user-facing gate message, so the message is
  regenerated rather than left quoting the compiled-in default. A rep should never be told "must be
  ≥ 18" by a system enforcing 24.

### Validation is strict, and deliberately so

`resolveOverrides()` coerces and validates every stored row. A threshold above 30, an unknown SPENCO
dimension, a company type that does not exist, a zone that is not one of the four, a competitor stage
that is terminal — each is rejected with a message naming the key.

In **production** an invalid stored value **aborts the boot**. Everywhere else it is logged and the
default is used. The asymmetry is intentional: a server running on 18 while the Settings page displays
24 is a worse failure than a server that refuses to start, because nobody finds out until the
conversion numbers are already wrong.

`setActiveRules` likewise rejects an unknown *rule* key rather than ignoring it, so a typo surfaces
immediately instead of quietly restoring a default.

### Cache invalidation

`pipelineVersion(rules)` hashes the stage keys **and** the resolved rule set. `GET /api/meta/pipeline`
returns it as `version`, and the browser caches the payload against it. Changing the SPENCO threshold
therefore invalidates every client copy — without this, a cached client would keep rendering the old
gate checklist and the old threshold message after the rule changed.

## Changing a rule in production

1. Settings → Pipeline (superadmin only).
2. Change the value. It is validated on write, not just on read.
3. The change takes effect at the next boot. **It is not retroactive** — leads already at Engagement
   are not re-gated, because gates only run on forward transitions.

Point 3 is the substantive consequence of raising a threshold: existing records keep the position
they legitimately earned under the old rule, and only new transitions face the new one. If a
retroactive re-evaluation is ever wanted, it belongs in the hygiene sweep as a `needsReview` flag —
never as a silent stage demotion.

Every change is written to the audit log (R-7).
