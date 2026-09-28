# Core Security Engine — Design

Date: 2026-09-28
Status: Draft — pending user review

## 1. Context and Goal

Every phase to date (Phase 1, Phase 2, catalog-integrity-and-pilot, and
the two bounded domain additions — devops-supply-chain and governance)
built the data foundation: 18 JSON Schemas, reference data, and 48
Control records across 8 domains, all validated by Ajv structural
checks (`src/validate.ts`) and the semantic catalog validator
(`src/validate-catalog.ts`). 154/154 tests pass. None of it is
executable — every formula, applicability rule, and scoring model is
documented data (or, in two cases, executable-precision prose inside a
data file's `description` field), not code.

This spec builds the first executable layer: a deterministic, pure-function
**Core Engine** that takes a project's data (profile, catalog, assessment
results) and produces the computed values this project's schemas have been
promising since Phase 1 — applicability verdicts, criticality indices,
scores, expanded assessment batches, release verdicts, and the final
immutable report.

This project has a established practice (informed by an earlier external
review, recorded in `PROGRESS.md`) of building the Core Engine *before*
the actual MCP server (tool definitions, handlers, transport) and *before*
agent dispatch/orchestration (retry, timeout, partial completion, resume —
explicitly flagged as its own later concern). This spec follows that
practice: **its scope is the Core Engine only.** The MCP tool/handler
layer and agent orchestration are separate, later specs.

## 2. Architecture

```
src/core/
  applicability.ts    # evaluateApplicability(control, profile) -> ApplicabilityResult
  criticality.ts      # calculateCriticality(factors, formula) -> CriticalityResult
  score.ts             # calculateScore(assessments, controls, model) -> Score
  plan-expander.ts     # expandPlan(plan, controls, project) -> Batch[]
  release-evaluator.ts # evaluateRelease(score, assessments, gates) -> ReleaseEvaluation
  report-builder.ts    # buildReport(run, score, findings, releaseEval, ...) -> ProjectReport
  repository.ts        # SecurityRepository interface + JsonRepository implementation
```

**Every function in `applicability.ts` through `report-builder.ts` is a
pure function**: given the same inputs, always the same output, no file
I/O, no network, no mutation of its arguments. All data access goes
through `SecurityRepository` (§9) — Core code never calls `loadJson`
or `readFileSync` directly. This is what makes the eventual SQLite
migration a persistence-layer swap (a new `SecurityRepository`
implementation) rather than a change to any of the calculation logic.

**Type convention:** matching the existing pattern in
`src/validate-catalog.ts` (which defines its own local `Control`,
`ThreatCatalog` interfaces rather than importing from a shared types
module), each Core module defines the minimal local TypeScript
interface it needs for its own inputs and outputs. There is no shared
`src/core/types.ts` — a function's own file is where its contract
lives, and the file stays readable standalone. Where two modules need
the *same* shape (e.g. both `plan-expander.ts` and `release-evaluator.ts`
consume `ControlAssessment`), each defines its own minimal projection of
the fields it actually reads, not a shared full-schema type.

## 3. `applicability.ts` — Three-Valued Evaluation

**The core correctness requirement, carried over from the design spec and
`PROGRESS.md`'s hard rule:** whatever evaluates `ProjectProfile`'s
`components`/`identities`/`dataClasses` fields against a Control's
`applicability` rule DSL must never normalize with `?? []` — an omitted
field is `UNKNOWN`, not `NO`. This module is where that rule gets its
first executable enforcement.

**Composition logic: strong Kleene three-valued logic.** This isn't one
option among several — it's the only composition rule consistent with
the project's own "never collapse unknown into false" principle:

- **`all` (AND):** any child `not_applicable` → the whole node is
  `not_applicable` (a known "no" always wins, regardless of what else is
  unknown). Else, if every child is `applicable` → `applicable`. Else
  (no `not_applicable`, at least one `unknown`) → `unknown`.
- **`any` (OR):** any child `applicable` → the whole node is
  `applicable`. Else, if every child is `not_applicable` → `not_applicable`.
  Else → `unknown`.
- **leaf fact-condition:** if the referenced fact is *absent* from the
  profile (only possible for `components`/`identities`/`dataClasses`,
  per their three-valued schema contract) → `unknown`. Otherwise, evaluate
  the leaf's `operator` (`eq`/`ne`/`in`/`not_in`/`contains`/`intersects`/
  `gt`/`gte`/`lt`/`lte`) against the fact's actual value → `applicable` or
  `not_applicable`.

**Worked example:** a control gated on
`all: [{features.authentication eq true}, {dataClasses contains D3}]`
against a profile with `authentication: false` and `dataClasses` omitted:
the `all` sees one `not_applicable` child (authentication) and one
`unknown` child (dataClasses) — the `not_applicable` wins, result is
`not_applicable`. If instead `authentication: true` and `dataClasses`
omitted: both non-`not_applicable`, one `unknown` — result is `unknown`.

**Output shape** matches `ControlAssessment.applicability`'s existing
schema fields exactly:

```ts
interface ApplicabilityResult {
  autoResult: "applicable" | "not_applicable" | "unknown";
  matchedRules: string[]; // e.g. ["all[0]", "any[1].all[0]"] — JSON-pointer-
                           // style paths into the rule tree identifying
                           // which leaf condition(s) actually determined
                           // the result, for explainability
}
```

`evaluateApplicability(control: Control, profile: ProjectProfile):
ApplicabilityResult` is the module's one exported function.

## 4. `criticality.ts` — Criticality Calculation

The formula is already fully specified, in prose, in the Phase 2 design
spec (§"Formula") and mirrored by `data/schemas/criticality-formula-schema.json`
+ `data/core/criticality-weights.json`'s structure. This module makes it
executable, reading the weights/ranges/directions from the
`CriticalityFormula` data object rather than hardcoding them (so a
retuned `criticality-weights.json` changes behavior without a code
change):

```ts
interface SeverityFactors {
  impact: number;             // 1-5
  exploitability: number;     // 1-5
  exposure: number;           // 1-3
  privilegeRequired: number;  // 0-2, lower is worse
  detectionDifficulty: number; // 0-2, higher is worse
}

interface CriticalityFormula {
  formulaId: string;
  version: string;
  weights: Record<keyof SeverityFactors, number>;
  ranges: Record<keyof SeverityFactors, { min: number; max: number }>;
  directions: Record<keyof SeverityFactors, "higher_is_worse" | "lower_is_worse">;
  rounding: "round" | "floor" | "ceil";
}

interface CriticalityResult {
  index: number; // 0-9
  formulaId: string;
  formulaVersion: string;
  computedAt: string; // ISO 8601, caller supplies "now" for testability
}
```

Normalization per factor: `higher_is_worse` factors normalize as
`(value - min) / (max - min)`; `lower_is_worse` factors (only
`privilegeRequired` today) normalize as `(max - value) / (max - min)` —
this generalizes the spec's hardcoded `(2 - privilegeRequired) / 2` to
work for any `min`/`max` the formula data declares, not just the current
`0`/`2`. Weighted sum of the five normalized values, scaled by
`scaleMax` (currently always `9`, per the schema's `const`), then
rounded per the formula's `rounding` field (`round`/`floor`/`ceil` — all
three are schema-legal even though only `round` is used today).

`calculateCriticality(factors: SeverityFactors, formula: CriticalityFormula,
now: () => string): CriticalityResult` — `now` is injected (not
`new Date().toISOString()` called internally) so tests can assert exact
`computedAt` values without mocking global time.

## 5. `score.ts` — Score Calculation

Also already fully specified, this time directly in
`data/core/scoring-model.json`'s own `description` field (added during
the Phase 2 final-review fix wave specifically so this formula would be
precise enough to implement from):

```
overallScore = 100 * Σ(statusWeights[status] for each non-excluded, applicable
                ControlAssessment) / count(non-excluded, applicable ControlAssessments)
```

`excludedStatuses` (`N/A`, `ACCEPTED_RISK`) are removed from both the
numerator and denominator entirely — this is the mechanism that prevents
"3 tested, 97 untested" from silently reading as "100% score," per this
project's own stated design principle. `domainScores[]` applies the
identical formula scoped to each domain's own `ControlAssessment`
records, with the full 6-status breakdown (`passCount`/`failCount`/
`partialCount`/`notTestedCount`/`notApplicableCount`/`acceptedRiskCount`)
and `coveragePercent = assessedControls / applicableControls * 100`
(`assessedControls` excludes `NOT_TESTED`).

```ts
interface ScoreModel {
  modelId: string;
  version: string;
  statusWeights: Record<"PASS" | "PARTIAL" | "FAIL" | "NOT_TESTED", number>;
  excludedStatuses: ("N/A" | "ACCEPTED_RISK")[];
}

function calculateScore(
  assessments: ControlAssessmentInput[], // { controlId, status }
  controls: ControlDomainInput[],        // { controlId, domain }
  model: ScoreModel
): Score
```

`Score`'s shape matches `data/schemas/score-schema.json` exactly
(`overallScore`, `coverage`, `scoreModel` id/version, `domainScores[]`,
`computedAt`).

## 6. `plan-expander.ts` — Plan → Batch Expansion

`AssessmentPlan.selection` (optional filters on `applicability`,
`assessmentStatuses`, `domains`, `controlIds` — all arrays, empty/absent
means "no filter on this dimension") narrows the catalog's Control set
down to the ones this run actually targets. The remaining controls are
grouped by whichever field `groupBy` names (`domain`/`subdomain`/`layer`/
`group`/`controlId` — every Control record already carries all five
fields, so no new taxonomy is needed; `controlId` as `groupBy` naturally
produces "one Batch per Control" since each control's own ID is a
distinct group value). Each group becomes one `AssessmentBatch` with
that group's `controlIds[]`. `groupOverrides[]` entries (keyed by
`groupValue`) can set a non-default `maxParallelAgents` for that specific
group or mark it `skip: true` (skipped groups produce no Batch at all).

`expandPlan(plan: AssessmentPlan, controls: Control[], project: Project):
AssessmentBatch[]` — deterministic given the same plan/controls/project,
consistent with every other Core function. Batch IDs and the owning
`AssessmentRun`'s ID are the caller's concern (ID generation is a
side-effecting concern the Repository layer or its caller owns, not
something a pure function should be responsible for) — `expandPlan`
returns Batches with `batchId`/`runId` left for the caller to assign
before persisting, matching how `AssessmentBatch`'s schema requires both
but neither is knowable from the Plan/Control data alone.

## 7. `release-evaluator.ts` — Release Gate Evaluation

`ReleaseEvaluation`'s schema requires 8 computed fields beyond `projectId`/
`evaluatedAt`. Only `gate` is a constant; the rest are each sourced from a
specific, different upstream input — worth spelling out individually since
none of them share a data source:

| Field | Source |
|---|---|
| `gate` | Always `4` — this evaluator scopes to gate 4 (`production_release`), the only gate in `data/process/release-gates.json` with structured, numeric `requiresByLevel` criteria rather than a prose checklist (gates 0-3 are earlier-lifecycle checklists — see §11, not this evaluator's job). |
| `controlCoverage` | `score.coverage.coveragePercent`, passed in as an already-computed `Score` (§5) — not recomputed here. |
| `criticalFindings` / `highFindings` | Count of `Finding[]` records that are still open (`status` in `["open", "in_progress"]` — resolved/accepted/false_positive findings don't block a release) with `severity` `"critical"` / `"high"` respectively. |
| `unblockedCriticalAttackPaths` | Count of `AttackPath[]` records with `result: "possible"` (per `attack-path-schema.json`'s `result` enum, `"blocked" \| "possible"`) whose `relatedFindingIds` includes at least one `"critical"`-severity Finding. |
| `residualRisksAccepted` | Count of `ControlAssessment[]` records with `status: "ACCEPTED_RISK"`. |
| `incidentResponseVerified` / `backupRestoreVerified` | See below — a fixed controlId mapping, not derivable from aggregation. |
| `result` | `"approved"` only if every applicable threshold for the project's `securityLevel` (below) is met; otherwise `"blocked"`. |

Gate 4's thresholds, from `data/process/release-gates.json`:

```
common:  criticalFindings must be 0
SVL-2:   criticalFindings 0, highFindings 0 OR covered by an accepted risk
SVL-3:   criticalFindings 0, highFindings 0 (no accepted-risk exception)
```

**`incidentResponseVerified` and `backupRestoreVerified`** cannot be
derived from Score/Finding aggregation at all — per the approved design,
they come from a fixed internal mapping to two specific controls' pass
status, exposed as a named constant so a future controlId rename is a
one-line change, not a search-and-replace:

```ts
const RELEASE_GATE_CONTROL_MAP = {
  incidentResponseVerified: "GOV-IR-001",
  backupRestoreVerified: "OPS-BACKUP-TEST-001",
} as const;
```

`evaluateRelease(inputs: { score: Score; findings: FindingInput[]; // { status, severity }
attackPaths: AttackPathInput[]; // { result, relatedFindingIds }
assessments: ControlAssessmentInput[]; // { controlId, status }
securityLevel: string }): ReleaseEvaluation` looks up each mapped
control's assessment status (`PASS` → `true`, anything else → `false`,
including "no assessment exists for this control at all" → `false`, since
an unverified gate control is not a verified one), counts findings/attack
paths/accepted risks per the table above, and combines that with the
threshold check to produce `result`.

## 8. `report-builder.ts` — Report Assembly

Assembles the immutable `ProjectReport` snapshot: pins
`assessmentRunId`, `catalogVersion`, `profileRevision`,
`criticalityFormula` (id+version), `score.scoreModel` (id+version) — all
already required by `project-report-schema.json`, this module is what
actually populates them from the run's actual inputs rather than leaving
them as documentation-only intent.

**`prioritizedFindings[]` sorting** — the one place in this project where
a test has been *knowingly* self-referential since Phase 2 (sorting a
fixture and comparing it to itself, because no real sort function
existed yet). This module is where that gets resolved:

```ts
function sortPrioritizedFindings(findings: PrioritizedFindingInput[]): PrioritizedFindingInput[]
```

Sort order: `priority.index` ascending, then `criticality.index`
descending, then `findingId` ascending (final tie-break, guaranteeing a
deterministic total order even when two findings share both P and C) —
exactly the rule the Phase 2 spec specified and the schema-level test
could only assert against itself, never verify.

## 9. `repository.ts` — Data Access Abstraction

```ts
interface SecurityRepository {
  getProject(projectId: string): Promise<Project>;
  getControls(): Promise<Control[]>;
  getThreats(): Promise<Threat[]>;
  getCriticalityFormula(formulaId: string): Promise<CriticalityFormula>;
  getScoreModel(modelId: string): Promise<ScoreModel>;
  getReleaseGates(): Promise<ReleaseGateData>;
  getPlan(planId: string): Promise<AssessmentPlan>;
  getControlAssessments(projectId: string, runId?: string): Promise<ControlAssessment[]>;
  getFindings(projectId: string): Promise<Finding[]>;
  saveRun(run: AssessmentRun): Promise<void>;
  saveBatch(batch: AssessmentBatch): Promise<void>;
  saveReport(report: ProjectReport): Promise<void>;
}
```

Explicit, typed, one-method-per-entity-operation — matching this
project's established preference for explicitness over generic
`get(collection, id)`-style access (the same judgment already applied
throughout the schema design: e.g. `Score.coverage` as named fields, not
a generic metrics bag). `JsonRepository` is this spec's only
implementation, reading/writing the existing `data/` layout via the
existing `loadJson`/`createAjv` helpers in `src/validate.ts`; a future
`SqliteRepository` implements the same interface without any Core module
changing.

## 10. Testing Strategy

Per the approved design-phase discussion, testing splits by whether
realism of the input data actually matters to what's being verified:

- **`applicability.ts`** is tested against the real, already-merged 48
  Control records (`data/controls/*.json`) and against `ProjectProfile`
  fixtures informed by 1-2 real open-source projects' actual
  characteristics (read from their README/architecture, not invented) —
  chosen because synthetic profiles risk only ever exercising condition
  combinations convenient to write, and this project's own catalog
  content (e.g. `APP-INJ-001`'s tech-stack-gating issue, caught in the
  pilot's final review) has already shown that convenient test data can
  hide real applicability gaps. At least one fixture must omit a
  `components`/`identities`/`dataClasses` field entirely (not `[]`) to
  exercise the `unknown` path end-to-end, and at least one Control's
  `all`/`any` tree must be tested with a mix of known-false and unknown
  children to prove the Kleene composition (§3) is actually implemented,
  not just described.
- **`criticality.ts`**, **`score.ts`**, **`plan-expander.ts`**,
  **`release-evaluator.ts`**, **`report-builder.ts`** are pure
  aggregation/arithmetic over whatever `ControlAssessment`/`Finding`
  records they're given — realism of the *source* project doesn't change
  whether the math is correct, so these are tested with small,
  hand-authored synthetic fixtures covering the documented formulas'
  edge cases (e.g. `score.ts`: an all-`NOT_TESTED` domain must not read
  as 100%; `report-builder.ts`: two findings sharing both `priority.index`
  and `criticality.index` must still sort deterministically by
  `findingId`).
- **`repository.ts`** (`JsonRepository`) is tested against the real
  `data/` tree, the same way `src/validate.ts`'s existing helpers already
  are.

**Explicitly out of scope for this spec's testing:** manually assessing
all 48 controls against a real open-source project's actual codebase to
produce a full, realistic end-to-end `ControlAssessment`/`Finding`/
`Score`/`ProjectReport` chain. This is valuable — arguably the most
convincing possible proof the whole system works — but it's a
significantly larger effort than verifying the Core Engine's functions
are individually correct, and it naturally belongs *after* the Core
Engine exists (and likely after some assessment workflow, manual or
agent-driven, exists to produce the `ControlAssessment` data in the
first place). Recorded here as a concrete next step, not silently
dropped.

## 11. Out of Scope

- The MCP server itself: tool definitions, request handlers, transport.
  A separate, later spec, once this Core Engine is stable — the same
  decomposition this project already applied to Phase 1/Phase 2/
  catalog-integrity-and-pilot.
- Agent orchestration: dispatch, retry, timeout, partial completion,
  resume, concurrent-write-to-the-same-Finding. Explicitly flagged in
  `PROGRESS.md` as its own later concern, not to be built alongside the
  deterministic Core.
- The SQLite migration. `SecurityRepository` (§9) exists specifically so
  this stays a persistence-layer swap whenever it happens; this spec
  does not implement `SqliteRepository`.
- A full real-project, all-48-controls, manually-assessed end-to-end run
  (§10's last paragraph) — a valuable next step, not part of verifying
  the Core Engine itself.
