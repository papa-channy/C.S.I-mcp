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
  plan-expander.ts     # expandPlan(plan, controls, project) -> BatchDraft[]
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

Concretely, this means no function in §3-§8 ever takes a
`SecurityRepository` as a parameter or calls one of its methods — every
signature in this spec takes plain data (`Control[]`, `ProjectProfile`,
`Score`, etc.) and returns a plain result. `SecurityRepository` is loaded
by, and only by, the caller sitting above these functions (an
Application/Service layer this spec does not define — it belongs to the
later MCP-tool-layer spec, §11): that caller fetches what a Core function
needs via the Repository, invokes the pure function, and persists the
result back via the Repository. None of §3-§8's function signatures
change if `JsonRepository` is later replaced.

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

**Boundary conditions, fixed now rather than left implicit:**

- An `all` or `any` node with an **empty condition list** (`all: []` or
  `any: []`) is not evaluated — it is a catalog validation error. There is
  no legitimate reason for a Control's applicability rule to contain an
  empty conjunction/disjunction, and silently defaulting to
  `applicable`/`not_applicable` (the usual boolean-algebra convention)
  would hide an authoring mistake instead of surfacing it.
- The DSL has no `not` node (only `all`/`any`/leaf conditions) — this
  spec does not add one.

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

**Zero-denominator domains.** `score-schema.json`'s `domainScores[].score`
and `.coveragePercent` are both typed as plain `number` — `null` is not a
schema-legal value, so a synthetic `null` is not the fix here. Instead: if
a domain's `count(non-excluded, applicable ControlAssessments)` is `0`
(every control in that domain is `N/A`, `ACCEPTED_RISK`, or has no
applicable controls at all for this profile), **that domain is omitted
from `domainScores[]` entirely** rather than given a fabricated `100` or
`0`. A domain with nothing left to score is not the same as a domain that
scored perfectly, and `domainScores[]` is an array precisely because it
doesn't need to enumerate every domain the catalog defines — only the
ones this run actually produced a real score for. (`overallScore` itself
is computed directly over the full project-wide non-excluded/applicable
`ControlAssessment` set per §5's formula, not by averaging
`domainScores[]`, so a single empty domain never distorts it; the
degenerate case of zero applicable+non-excluded assessments *project-wide*
is a precondition violation `calculateScore` should reject rather than
silently score, and is not expected to occur against the real 48-control
catalog.)

**Controls with unresolved (`unknown`) applicability are not excluded.**
`calculateScore` never sees applicability results directly — it consumes
`ControlAssessment.status`, and a control whose applicability hasn't been
resolved yet has no basis for being marked `N/A`. It stays in the
denominator as `NOT_TESTED` (weight `0`), the same as any other
not-yet-assessed control. This is a direct consequence of `excludedStatuses`
covering only `N/A`/`ACCEPTED_RISK` — worth stating explicitly here since
an `unknown`-applicability control silently being treated as excluded
would recreate exactly the "3 tested, 97 untested reads as 100%" failure
mode this design already exists to prevent.

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

**Return type.** `AssessmentBatch`'s schema requires `batchId` and
`runId`, and neither is knowable from Plan/Control data alone — ID
generation is a side-effecting concern the Repository layer or its
caller owns, not something a pure function should be responsible for.
So `expandPlan` does not return `AssessmentBatch[]` (that would require
either fabricating IDs inside a pure function or leaving required schema
fields unset on a typed `AssessmentBatch`, neither of which is correct).
Its actual return type is a plan-scoped draft:

```ts
interface BatchDraft {
  groupBy: string;          // the plan's groupBy field, echoed for traceability
  groupValue: string;       // e.g. the domain name, when groupBy = "domain"
  controlIds: string[];     // deterministic order — see below
  maxParallelAgents?: number; // from groupOverrides, if set for this group
}

function expandPlan(plan: AssessmentPlan, controls: Control[], project: Project): BatchDraft[]
```

The caller (Application/Service layer, §2) materializes each `BatchDraft`
into a persisted `AssessmentBatch` by attaching `batchId`, `runId`, and
initial `status` before calling `repository.saveBatch`.

**Determinism rules**, fixed now so report/test snapshots never depend on
object-iteration order:

- `controlIds` within a `BatchDraft` are sorted `controlId` ascending.
- `BatchDraft[]` is sorted by `groupValue` ascending.
- A group with zero controls after `selection` filtering produces no
  `BatchDraft` at all — never an empty-`controlIds` draft.
- `groupOverrides[]` entries are keyed by `groupValue`. Two override
  entries for the same `groupValue` is a plan validation error (not
  "last wins" — silently picking one hides an authoring mistake the same
  way an empty `all`/`any` does in §3). An override naming a `groupValue`
  that has no matching group after selection (e.g. `domain: mobile` when
  the current selection has no mobile controls) is not an error — a
  `Plan` is meant to be reusable across projects whose profiles don't all
  have the same components, so this only produces a no-op (no `BatchDraft`
  for that group exists to apply the override to).

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
| `result` | `"approved"` \| `"blocked"` — see below. |

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

This keeps the fixed-mapping design already approved during brainstorming
(over the alternative of the caller supplying these two flags as raw
inputs) — but a fixed mapping to specific catalog IDs has a real drift
risk if either control is ever renamed, replaced, or deprecated in the
catalog, since nothing would catch the mismatch except a report silently
treating a verified gate as unverified. Rather than moving the mapping
into `release-gates.json` (which would touch data outside this spec's
scope and reopen the plan/batch-groupBy-style duplication question this
project has deliberately deferred), the mitigation stays inside this
module's own test suite (§10): a test loads the real catalog and asserts
both `RELEASE_GATE_CONTROL_MAP` values exist as controlIds and are not
`replacedBy`-superseded. That test fails loudly the moment a rename
happens, which is the actual problem being guarded against.

`evaluateRelease(inputs: { score: Score; findings: FindingInput[]; // { status, severity }
attackPaths: AttackPathInput[]; // { result, relatedFindingIds }
assessments: ControlAssessmentInput[]; // { controlId, status }
securityLevel: string }): ReleaseEvaluation` looks up each mapped
control's assessment status (`PASS` → `true`, anything else → `false`,
including "no assessment exists for this control at all" → `false`, since
an unverified gate control is not a verified one), counts findings/attack
paths/accepted risks per the table above, and combines that with the
threshold check to produce `result`:

`ReleaseEvaluation.result`'s schema enum is exactly `"approved" | "blocked"`
(`release-evaluation-schema.json`, mirrored in `project-report-schema.json`)
— a Phase 2 schema this spec does not change, so `result` stays two-valued
rather than growing a third "unknown" state:

- **`"blocked"`** — `securityLevel` is `SVL-2`/`SVL-3` and at least one
  threshold in the table above is not met.
- **`"approved"`** — `securityLevel` is `SVL-2`/`SVL-3` and every
  threshold is met.
- **`securityLevel` is `SVL-0`/`SVL-1`** — `data/process/release-gates.json`
  defines gate-4 numeric criteria only for `SVL-2`/`SVL-3`; there is no
  policy to apply. `evaluateRelease` throws rather than guessing a
  `result` for a policy that doesn't exist — silently applying the
  `SVL-2` thresholds to an `SVL-0` project (or silently approving it)
  would both be inventing a decision nobody made. This is a caller
  precondition, not a business outcome the schema needs to represent:
  gate 4 (`production_release`) is not a lifecycle stage an `SVL-0`/`SVL-1`
  project should be evaluated against in the first place.

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

**Which findings appear in `prioritizedFindings[]`.** `finding-schema.json`'s
`status` enum is `"open" | "in_progress" | "resolved" | "accepted" |
"false_positive"`. Only `open` and `in_progress` findings are included —
`resolved`/`accepted`/`false_positive` findings are not actionable, and
including them would leave a fixed-severity finding permanently pinned
near the top of every future report regardless of its actual current
state. `report-builder.ts` does this filtering itself, so `ReportBuilder`
callers pass the full `Finding[]` for the project, not a pre-filtered
list.

`ReportBuilder`'s other responsibility boundary: it assembles already-computed
snapshots (`Score` from §5, `ReleaseEvaluation` from §7, sorted findings)
into the immutable `ProjectReport` shape — it never calls `calculateScore`
or `evaluateRelease` itself. If it did, the same computation could run
twice with two different opportunities to disagree; every calculated
value `buildReport` uses is a required input, not something it derives.

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
  not just described. Real-project fixtures alone are not sufficient
  proof of Kleene-logic correctness, though — a person can mislabel the
  expected verdict for a realistic-but-complex profile just as easily as
  for a synthetic one. So this module also gets an exhaustive **synthetic
  truth-table suite**, independent of the real-project fixtures: every
  `all`/`any` input combination from §3's tables (`all(T,T)=T`,
  `all(T,U)=U`, `all(T,F)=F`, `all(U,F)=F`, `all(U,U)=U`, and the mirror
  set for `any`), plus at least one nested case (e.g.
  `all(applicable, any(not_applicable, unknown)) = unknown`) to prove
  composition, not just single-level evaluation, is correct.
- A **catalog-engine compatibility smoke test**, distinct from both of
  the above: run `evaluateApplicability` over all 48 real
  `data/controls/*.json` records against one placeholder profile, and
  assert none of them throws and none produces an unrecognized
  fact/operator/nesting error. This is not an assessment-correctness
  check (it says nothing about whether any given verdict is *right*) —
  it only proves every Control's applicability rule uses grammar this
  Engine actually supports, which is cheap to verify now and expensive to
  discover later as a runtime failure on control #37 of 48.
- **`criticality.ts`**, **`score.ts`**, **`plan-expander.ts`**,
  **`release-evaluator.ts`**, **`report-builder.ts`** are pure
  aggregation/arithmetic over whatever `ControlAssessment`/`Finding`
  records they're given — realism of the *source* project doesn't change
  whether the math is correct, so these are tested with small,
  hand-authored synthetic fixtures covering the documented formulas'
  edge cases (e.g. `score.ts`: an all-`NOT_TESTED` domain must not read
  as 100%, and a domain with zero non-excluded applicable controls is
  omitted from `domainScores[]` rather than fabricating a `100` or `0`;
  `report-builder.ts`: two findings sharing both `priority.index` and
  `criticality.index` must still sort deterministically by `findingId`,
  and a `resolved` finding must not appear in `prioritizedFindings[]`).
  `release-evaluator.ts` additionally gets one test that is not
  synthetic: it loads the real `data/controls/*.json` catalog and asserts
  `RELEASE_GATE_CONTROL_MAP`'s two controlIds (§7) both exist and are not
  `replacedBy`-superseded — the drift guard for that fixed mapping.
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
