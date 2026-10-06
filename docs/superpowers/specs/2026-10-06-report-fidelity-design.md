# Report Fidelity — Design

## 1. Context and Goal

The `assessment-trust-integrity` branch (merged 2026-10-05) made the
detection/judgment engine itself trustworthy: `ControlAssessment` records
now carry `runId`/`profileRevision`, `ACCEPTED_RISK` is validated against a
real `RiskAcceptance` entity (existence, scope, expiry, revocation),
`N/A` is cross-checked against the applicability engine's own verdict, and
`AnalysisService.evaluateRelease`/`ReportService.generate` both translate
stale or no-longer-backed assessments to `NOT_TESTED` through one shared
function before computing score and release evaluation — so the Coverage
Gate and Control Gate can no longer silently disagree.

To validate that work, all 8 real open-source validation projects
(Vaultwarden, Documenso, Outline, Formbricks, Chatwoot ×3, Listmonk) were
re-assessed against their current profiles and fresh `ProjectReport`s were
generated and reviewed. The engine behaves as designed: `Outline` correctly
lands on `"indeterminate"` (66.7% coverage, 3 unverified blocking controls)
rather than the pre-fix `"approved"`-at-low-coverage bug; `Chatwoot v2`
correctly `"blocked"`s on a release-blocking Control Gate `FAIL`
(`IAM-AUTH-005`) even with zero confirmed critical/high findings — the
exact scenario the Control Gate was built for; a blind pinned-commit
re-assessment of Chatwoot (`Chatwoot-v3`) surfaced a real critical finding
(an unauthenticated public API attachment-validation bypass) that three
earlier passes had missed, without reintroducing a previously-corrected
false positive.

But reviewing those 8 reports surfaced a different, real gap: **the engine
computes rich judgment — finding type, severity, linked controls, attack
scenario, exploitability evidence, which gate a finding affects, whether an
assessment is stale — and almost none of it survives into the persisted
`ProjectReport` artifact.** `prioritizedFindings` entries carry exactly four
fields (`findingId`, `priorityIndex`, `criticalityIndex`, `title`); a reader
of the JSON alone cannot tell a `confirmed_vulnerability` from a
`control_gap` finding, cannot see which control a finding is attached to,
and cannot see why. Two numeric fields are named identically across two
different meanings (`score.ts`'s per-domain `highFindings`, counting every
active finding by severity regardless of type, vs.
`release-evaluator.ts`'s `highFindings`, counting only `confirmed_vulnerability`-type
findings toward the gate) — one report showed domain-level `highFindings: 6`
alongside `releaseEvaluation.highFindings: 0` for the same assessment, with
nothing in the artifact explaining the difference. No report records what
code was actually scanned: `Project`/`AssessmentRun` have no repository or
commit field anywhere, so a `ProjectReport` detached from this session's
chat history cannot prove which commit of `chatwoot/chatwoot` it describes.
`unblockedCriticalAttackPaths` is always `0` — not because attack paths are
rare, but because `AnalysisService`/`ReportService` both hardcode
`attackPaths: []` when calling `evaluateRelease`; no attack-path model
exists anywhere in the codebase. `coveragePercent` and similar fields are
unrounded floats (`57.49999999999999`).

**Goal:** make `ProjectReport` a self-contained, externally-legible
artifact — one that preserves the engine's actual judgment (what was
found, how certain, why it matters, what it affects) and its own
provenance (what code, what profile, what engine version produced this),
without inventing new engine capability the system doesn't actually have.
This is a **reporting-fidelity** fix, not a detection-quality fix — the
engine's judgment is treated as already correct; the job is to stop
discarding it on the way into the persisted artifact.

## 2. Current State (for contrast)

`src/core/report-builder.ts`'s `ProjectReport`:

```ts
export interface ProjectReport {
  reportId: string;
  projectId: string;
  assessmentRunId: string;
  catalogVersion: string;
  profileRevision: number;
  criticalityFormula: { id: string; version: string };
  generatedAt: string;
  score: ScoreForReport;
  prioritizedFindings: PrioritizedFindingInput[];
  releaseEvaluation: ReleaseEvaluationForReport;
  summary: string;
}
```

`PrioritizedFindingInput` is `{ findingId, priorityIndex, criticalityIndex,
title }` — nothing else. The real `Finding` entity (`src/core/repository.ts`)
already carries `type`, `controlIds`, `status`, `severity`,
`exploitabilityEvidence`, and (via an index signature) `attackScenario` —
none of it reaches the report.

`src/core/score.ts`'s `DomainScore` and `src/core/release-evaluator.ts`'s
`ReleaseEvaluation` both declare a field named `criticalFindings`/
`highFindings`, with different definitions:

```ts
// score.ts — countActiveFindings(findings, domainControlIds, "critical"|"high")
// counts every active (open/in_progress) finding by severity label,
// independent of Finding.type.
criticalFindings: number;
highFindings: number;

// release-evaluator.ts — counts only active findings whose
// type === "confirmed_vulnerability", the subset that actually drives
// the Finding Gate threshold check.
const criticalFindings = activeCritical.length;
const highFindings = activeHigh.length;
```

Neither `Project` nor `AssessmentRun` (`src/core/repository.ts`) has a
repository/commit field; the only place a commit ever appears is as free
text embedded in a human-written `Project.name` string (e.g. `"Chatwoot
(chatwoot/chatwoot) — blind pinned-commit re-assessment (097155a,
2026-10-03)"`) — never structured data.

`AnalysisService.evaluateRelease` and `ReportService.generate` both call
core `evaluateRelease` with `attackPaths: []` hardcoded — there is no
`AttackPath` entity, repository method, or MCP tool anywhere in `src/`.
`unblockedCriticalAttackPaths` is therefore structurally always `0`.

`incidentResponseVerified`/`backupRestoreVerified`
(`ReleaseEvaluationForReport`) are booleans computed as
`assessmentByControl.get(<control>) === "PASS"`. Both of their underlying
controls (`GOV-IR-001`, `OPS-BACKUP-TEST-001`) are also members of
`RELEASE_BLOCKING_CONTROLS`, so the same information is *nearly* present
in `blockingControlFailures`/`blockingControlsNotVerified` — except an
`ACCEPTED_RISK`-status blocking control contributes nothing to either
blocking array (by design — see the Control Gate loop in
`release-evaluator.ts`) while still making the boolean `false`. The two
views are not interchangeable the way they look.

`score.ts`'s `coveragePercent` and related percentages are plain
`number` division results with no rounding (`(assessedControls /
applicableControls) * 100`), copied verbatim into the report.

## 3. Architecture

### 3.1 `projectFindingSnapshots[]`: the full, self-contained finding record

`ProjectReport` gains a new field:

```ts
export interface FindingSnapshot {
  findingId: string;
  title: string;
  type: Finding["type"];
  severity: Finding["severity"];
  controlIds: string[];
  status: Finding["status"];
  priorityIndex: number;
  criticalityIndex: number;
  attackScenario?: string;
  exploitabilityEvidence?: string;
}
```

Every field here already exists on the real `Finding` record at the
project's current `findings.json` — `ReportBuilder` copies, it does not
compute or infer anything new. Two fields considered and explicitly
**excluded**: `evidenceRefs` (no `Finding` field references `Evidence` —
only `ControlAssessment.evidenceIds` does, and a `Finding` can span
multiple `controlIds`/assessments, so there is no single unambiguous
evidence set to point at without inventing a new linkage) and
`dispositionReason` (no write path in this codebase ever records *why* a
`Finding.status` changed to `resolved`/`false_positive` — no tool exists to
transition a finding's status at all yet). Adding either would be new
engine capability, not report fidelity; both are explicitly out of scope
(§7).

`projectFindingSnapshots` contains **every** `Finding` currently recorded for the
report's `projectId` — `open`, `in_progress`, `resolved`, `accepted`, and
`false_positive` alike — as of report-generation time. `prioritizedFindings`
is unchanged and keeps its existing actionable-only filter (`status ===
"open" || status === "in_progress"`) — it remains the executive/action
index; `projectFindingSnapshots` is the complete finding-state snapshot.

**This is project-scoped, not run-scoped — say so plainly, don't overclaim.**
The current `Finding` entity (`src/core/repository.ts`) carries no run
identifier, so there is no way for `ReportBuilder` to filter findings down
to "only what `assessmentRunId`'s run itself produced." For every project
in this codebase today, there is exactly one `AssessmentRun`, so
project-scoped and run-scoped are the same set in practice — but this spec
must not claim otherwise for a project with multiple runs over time: a
report generated from an earlier run of a multi-run project will still
include findings recorded under a *later* run too, because `projectFindingSnapshots`
reflects the project's current finding set, not a per-run slice. §1's Goal
language ("preserves what was found") refers to this project-wide,
report-generation-time set — not a per-run reconstruction. Building real
run-scoped attribution would require adding a run identifier to `Finding`
(the same shape of fix `ControlAssessment` already got in
`assessment-trust-integrity`) and is explicitly out of scope here (§7).

`ReportBuilder` must fetch findings exactly once and derive `score`,
`releaseEvaluation`, `prioritizedFindings`, and `projectFindingSnapshots` all from
that same fetched array — never a second, independent re-read of
`findings.json` for `projectFindingSnapshots` specifically — so the four views of
"what findings exist" in one `ProjectReport` can never drift apart from
each other even accidentally.

**Invariant:** every `prioritizedFindings[i].findingId` must appear in
`projectFindingSnapshots` (`prioritizedFindings` is always a subset of
`projectFindingSnapshots` by `findingId`, never a disjoint list) — and no entry in
`projectFindingSnapshots` whose `status` fails the actionable predicate may appear
in `prioritizedFindings`.

**Ordering:** `projectFindingSnapshots` is sorted ascending by `findingId`
(a plain string comparison — `findingId`s are sequential, e.g. `FND-001`,
`FND-002`, so this is also creation order) before being written into the
report. A fixed, deterministic order means two reports generated from the
same underlying finding set are byte-identical, and a diff between two
reports reflects a real change, not array-ordering noise.

### 3.2 Naming: `criticalSeverityFindings`/`highSeverityFindings` vs. `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`

This project is pre-commercialization, single-user, local-stdio (no remote
consumers with a deployed contract to preserve), and the `score-schema.json`
/ `release-evaluation-schema.json` standalone schemas that mirror these
fields are validated only in tests — nothing in `src/` calls
`compileSchemaFromFile` against either at runtime. Given that, this spec
renames **at the source**, not just inside `ReportBuilder`'s mapping step,
so the same number has the same name wherever it appears (`get_score`,
`evaluate_release`, and `ProjectReport` alike) rather than creating a
second, differently-named alias of the same underlying field for the
report only.

- `src/core/score.ts`'s `DomainScore`: `criticalFindings` →
  `criticalSeverityFindings`, `highFindings` → `highSeverityFindings`.
  Definition unchanged (`countActiveFindings(..., "critical"|"high")`,
  independent of `Finding.type`) — only the name changes, to say what is
  actually being counted (severity label on any active finding).
- `src/core/release-evaluator.ts`'s `ReleaseEvaluation`: `criticalFindings`
  → `confirmedCriticalVulnerabilities`, `highFindings` →
  `confirmedHighVulnerabilities`. Definition unchanged (active findings
  with `type === "confirmed_vulnerability"`, by severity) — the name now
  says what is counted (confirmed vulnerabilities) rather than how the
  count is consumed downstream (a `blocking*` name was considered and
  rejected: a single high-severity confirmed vulnerability doesn't always
  block release by itself — `highFindingsSatisfied`'s threshold depends on
  `securityLevel` — so "blocking" overclaims what the field itself
  guarantees).
- `data/schemas/score-schema.json`, `data/schemas/release-evaluation-schema.json`,
  `data/schemas/project-report-schema.json`: all three renamed to match,
  consistently.

**Invariant:** the rename is not cosmetic — each renamed field's test
fixture must assert the specific predicate its new name claims (e.g. a
`criticalSeverityFindings` test includes an active `hardening`-type
finding at `severity: critical` and asserts it counts; a
`confirmedCriticalVulnerabilities` test includes the same finding and
asserts it does **not** count, only a `confirmed_vulnerability`-type one
does).

**Precision note for §4 and elsewhere in this spec:** wherever this spec
says `get_score`/`evaluate_release`/`calculateScore`/`evaluateRelease`
have "no changes" or are "unchanged," that claim is about **calculation
semantics** (the counting logic, thresholds, and control-gate rules
themselves) — not their **output contract**, which this section does
change (the field names in what they return). A consumer of either live
MCP tool sees the new field names starting with this change, even though
what gets computed is identical.

### 3.3 `target`, `profileSnapshot`, `engineVersion`: provenance lives on `AssessmentRun`, not the report

Three new fields are added to `AssessmentRun`, each captured **by value** at
`start_assessment_run` time — not re-read from live `Project`/`package.json`
state when a report is later generated, since `Project.profile` and
`Project.profileRevision` can both have moved on by then (this is exactly
the staleness scenario `assessment-trust-integrity` exists to catch; a
report must describe the run it came from, not whatever the project or the
installed engine happens to look like right now, which could be a
completely different version if the run took hours and an upgrade landed
in between):

```ts
export interface Target {
  repository: string;
  commitSha: string | null;
  branchOrTag: string | null;
  dirty: boolean | null;
}

export interface AssessmentRun {
  // ...existing fields...
  target?: Target | null;
  profileSnapshot?: ProjectProfile | null;
  engineVersion?: string | null;
}
```

All three are **optional and nullable** (`?: ... | null`, not `: ... | null`)
— this is a deliberate, two-part contract, not a single relaxation:

- **Optional** (the key itself may be absent) is what makes a legacy
  `AssessmentRun` record — one persisted before this change, which has
  none of these three keys at all — a valid value of this type without
  any normalization step. See the legacy compatibility note below.
- **Nullable** (the key may be present with value `null`) is what lets a
  *new* run explicitly record "not declared" rather than merely omitting
  the key. `target` is the field this matters for in practice: a new run
  whose caller doesn't pass a `target` input is a completely normal,
  common case, and its `target` is legitimately `null` — not just on
  legacy runs. (`profileSnapshot`/`engineVersion` are different: every new
  run always gets both from the service itself, never from caller input,
  so in practice they are only ever absent/`null` on a legacy run — but
  the type stays optional-and-nullable for all three uniformly, since
  that is what legacy data requires and what keeps the contract simple.)

- `target` is `Target | null` as a whole — `null` means "this run did not
  declare target provenance" (the common case today; every run prior to
  this change, and every run whose caller omits the new input, has `target:
  null`). When non-`null`, `repository` is required; `commitSha`,
  `branchOrTag`, and `dirty` are each independently `required-but-nullable`
  — matching this project's established convention
  (`RiskAcceptance.reviewDate`, `AssessmentRun.startedAt`/`completedAt`)
  of always-present-but-nullable over optional-and-undefined.
  `commitSha` is the authoritative identity when present; `branchOrTag` is
  reference metadata only (a branch can move; a commit SHA does not).
  When a commit is known, the **full** SHA is stored, not an abbreviated
  short form.
- `start_assessment_run`'s input gains an optional `target` parameter. The
  **parameter itself** is optional — omitting it entirely is valid and
  stores `target: null`. If the caller does pass a `target` object,
  `repository` is strictly required within it (unlike at the `Target`
  type level, where it's one of several fields):

  ```ts
  target?: {
    repository: string;
    commitSha: string | null;
    branchOrTag: string | null;
    dirty: boolean | null;
  };
  ```

  So `{}` (no `target` key at all) is accepted; `{ target: {} }` (an empty
  target object, missing `repository`) is rejected — a caller declaring
  *some* provenance must declare at least which repository.
- **This is caller-asserted provenance, not server-verified.** Nothing in
  this spec independently confirms that the declared `commitSha` is what
  was actually scanned — `start_assessment_run`'s caller self-reports it.
  The schema description and any report-facing documentation must say so
  explicitly, so a reader doesn't mistake "the assessment agent declared
  this commit" for "the server verified this commit." Actually verifying
  provenance (e.g. against a live git checkout) is out of scope (§7).
- `profileSnapshot: ProjectProfile | null` is a **deep copy** of
  `Project.profile` taken at the moment `startAssessmentRun` runs (never a
  shared object reference — later mutation of the live `Project.profile`
  must not alter an already-created run's snapshot). Paired with the
  already-existing `AssessmentRun.profileRevision` (also captured at the
  same moment), a report reader can see not just *that* the project was at
  revision 2, but *what* revision 2's profile actually was, without needing
  live access to `data/projects/<id>/project.json`.
- `engineVersion: string | null` is this package's own `version` field
  (`package.json`, currently `"0.8.0"`), captured once when
  `startAssessmentRun` runs and stored on the run — not re-read fresh
  when a report is later generated from that run. This matters for the
  same reason as `profileSnapshot`: the question this field answers is
  "what engine version produced this run's judgment," and the run is what
  actually did the scanning — an engine upgrade between run-start and (a
  possibly much later) report-generation must not retroactively relabel
  an old run's findings as having come from the new version.
  `AssessmentService` takes the version as an injected constructor
  parameter (default-reading `package.json` itself only at the
  composition root, e.g. `server.ts`, where the service is constructed) —
  the same pattern already used for its injectable `now: () => string` —
  rather than `startAssessmentRun` reaching for `package.json` directly
  on every call; this keeps the service testable without a real
  `package.json` read, the same way its clock is already injectable.
  **For `engineVersion` to mean anything, `package.json`'s `version` must
  actually change when engine or report-contract semantics change** — this
  spec's own implementation is exactly such a change (new fields, renamed
  fields, new report shape) and must bump the version as part of landing
  it, per the project's existing versioning policy (established
  2026-10-02, `chore(release): establish versioning process, bump to
  0.8.0, add CHANGELOG`). A future release that changes engine/report
  semantics without a version bump silently defeats this field for that
  release — this isn't enforced by any code in this spec, only by
  following the existing policy, so it's worth stating plainly here
  rather than assuming it's obvious.

**Legacy `AssessmentRun` compatibility.** Every `AssessmentRun` that exists
on disk before this change ships has none of `target`/`profileSnapshot`/
`engineVersion` as keys at all — exactly the case the optional-and-nullable
typing above (not required-but-nullable) exists to accept without any
normalization step. `target: null`/absent for a legacy run means "not
declared" (the existing, intentional meaning from before this note).
`profileSnapshot`/`engineVersion` absent or `null` for a legacy run means
"this run predates provenance capture" — there is no honest backfill for
either: a project's profile and the installed engine version at some past
`startedAt` cannot be reliably reconstructed from their current values
(the whole point of staleness-awareness is that both can have moved on
since). No migration script attempts to backfill these three fields on
existing `AssessmentRun`s — unlike `scripts/migrate-control-assessment-profile-revision.ts`'s
real per-assessment join against `AssessmentRun` data, there is no
analogous source of truth to join against here. A `ProjectReport`
generated from a legacy run simply carries `target: null`,
`profileSnapshot: null`, `engineVersion: null` forward — an honest "not
captured for this run," not a fabricated value.

`ReportBuilder` does not construct or infer provenance — it copies
`run.target`, `run.profileSnapshot`, `run.engineVersion`, and the
already-existing `run.profileRevision` verbatim onto `ProjectReport`.
`ProjectReport` gains:

```ts
target: Target | null;
profileSnapshot: ProjectProfile | null;
engineVersion: string | null;
```

Unlike `AssessmentRun`'s fields (optional-and-nullable, to accept a legacy
record's missing keys as-is), `ProjectReport`'s mirrors are
**required-but-nullable** — `ReportBuilder` always constructs a fresh
object and always sets all three explicitly (`run.target ?? null`, and
likewise for the other two), so there's no "missing key" case to accept
on the output side, only "we have a value" vs. "we know there is none."

(`profileRevision` already exists on `ProjectReport` and is unchanged —
it's now explicitly documented as sourced from `AssessmentRun.profileRevision`,
not a fresh `Project` read, matching what `ReportService.generate` already
does today.)

**Invariant:** `ProjectReport.profileRevision === AssessmentRun.profileRevision`,
`ProjectReport.profileSnapshot` deep-equals `(AssessmentRun.profileSnapshot ?? null)`,
`ProjectReport.target` deep-equals `(AssessmentRun.target ?? null)`, and
`ProjectReport.engineVersion === (AssessmentRun.engineVersion ?? null)`, for
the run named by `ProjectReport.assessmentRunId` — `ReportBuilder` must not
read current `Project` state or `package.json` to populate any of the four.

### 3.4 `unblockedCriticalAttackPaths`: removed from the report, not from core

No attack-path-related change to `src/core/release-evaluator.ts`'s logic,
its exported `ReleaseEvaluation` interface's `unblockedCriticalAttackPaths`
field, or the `evaluate_release` MCP tool's output — attack-path modeling
is a real, separate feature this spec does not build (§7), and the field's
live behavior (always `0`, because `attackPaths: []` is hardcoded at both
call sites) is unchanged outside the report. (`ReleaseEvaluation`'s
`criticalFindings`/`highFindings` fields *do* change in this spec — that's
§3.2's rename, unrelated to attack paths; this section only scopes what
stays untouched regarding attack-path tracking specifically.)

`ReportBuilder`'s `ReleaseEvaluationForReport` (the report-only mirror
type) drops `unblockedCriticalAttackPaths` when mapping from the full
`ReleaseEvaluation` — a field that can only ever read `0`, persisted
permanently into an immutable artifact, communicates false precision.
Removing it from the artifact is less misleading than keeping it.

### 3.5 `incidentResponseVerified`/`backupRestoreVerified`: removed from the report

Not merely documented as derived — removed from `ProjectReport` (and its
mirror `ReleaseEvaluationForReport`) entirely. The brainstorming review
surfaced a real discrepancy, not just redundancy: a `RELEASE_BLOCKING_CONTROLS`
member at `status: "ACCEPTED_RISK"` contributes nothing to
`blockingControlFailures`/`blockingControlsNotVerified` by design (Control
Gate loop, `release-evaluator.ts`), yet `incidentResponseVerified`/
`backupRestoreVerified` — checking `=== "PASS"` only — would read `false`
in that same case. A boolean that silently collapses `FAIL`,
`NOT_TESTED`, `PARTIAL`, `undefined`, *and* `ACCEPTED_RISK` into the same
`false` is not a faithful summary of
`blockingControlFailures`/`blockingControlsNotVerified`; keeping both
around invites a reader to treat them as interchangeable when they aren't.
`blockingControlFailures`/`blockingControlsNotVerified` (unchanged,
already present) are strictly more informative and remain the report's
sole source of truth for release-blocking-control status specifically
(not a claim about the whole report — `projectFindingSnapshots`,
`score`, etc. are the source of truth for their own respective facts).

No further change to core `release-evaluator.ts`'s `ReleaseEvaluation`
interface beyond §3.2's rename — the two booleans themselves stay there
unrenamed and unremoved; cleaning up that API is a separate, future,
non-report concern (§7).

### 3.6 Rounding: report-serialization boundary only

A new helper, `src/core/report-builder.ts` (or a small shared formatting
module if it grows):

```ts
export function roundReportNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`roundReportNumber: non-finite value ${value} cannot be serialized into a ProjectReport`);
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}
```

Applied **only** when `ReportBuilder` copies numeric fields from the
engine's `Score`/`ReleaseEvaluation` objects into `ProjectReport` — never
to the `Score`/`ReleaseEvaluation` objects themselves before or during
gate-threshold comparisons (`coverageOk = score.coverage.coveragePercent
>= MIN_COVERAGE_FOR_APPROVAL_PERCENT` in `release-evaluator.ts` must keep
comparing full-precision values; rounding first could flip a borderline
case, e.g. `79.996` rounding to `80.0` before the `>= 80` check, silently
changing a `blocked`/`indeterminate` result to `approved`). Precision
policy: coverage percentage fields (`coveragePercent`, `controlCoverage`,
domain `coveragePercent`) and `overallScore`/domain `score` → 2 decimal
places; integer counts (`applicableControls`, `assessedControls`,
`passCount`, etc.) → unchanged, already integers. For the coverage
percentages specifically, no raw information is lost by rounding —
`Score.coverage` already carries `applicableControls`/`assessedControls`
as separate integer fields alongside `coveragePercent`, so a reader can
always recover the exact fraction; `overallScore`/domain `score` are
rounded for the same display-only reason but, being derived from a
weighted status model rather than a simple fraction, don't carry an
equivalent pair of integer fields to recover an exact value from — that's
an accepted, intentional display-precision trade for a human-facing
report, not a claim that every rounded field is exactly reconstructable.
`roundReportNumber` additionally guards against non-finite input
(`NaN`/`Infinity`/`-Infinity` must never reach `ProjectReport` — any such
value reaching the rounding step indicates an upstream bug and should
throw rather than silently serialize a non-finite number into the
artifact).

**A rounded coverage number can look like it contradicts the verdict —
this is expected, not a bug.** Because gate comparisons use the unrounded
value (above) while the report displays the rounded one, a report can
legitimately show `controlCoverage: 80.00` alongside `result:
"indeterminate"` when the true value was, say, `79.996` — just under the
`MIN_COVERAGE_FOR_APPROVAL_PERCENT` threshold, but rounding to display as
exactly `80.00`. A reader comparing the displayed number to the documented
80% threshold without this context could reasonably conclude the verdict
is wrong. This spec doesn't resolve that ambiguity structurally (e.g. by
also exposing the unrounded value) — doing so is tracked as a candidate
follow-up, not required here — but it must be named explicitly so a future
reader of a real report that exhibits this isn't left thinking it found a
bug.

### 3.7 `reportSchemaVersion`

(`engineVersion` moved to §3.3 — it's captured on `AssessmentRun` at
run-start time, for the same reason `target`/`profileSnapshot` are, not
freshly read at report-generation time.)

One more new top-level `ProjectReport` field: `reportSchemaVersion: string`
— a version string for the `ProjectReport` *shape* itself, starting at
`"2.0.0"` for this change (distinct from `engineVersion`: the report shape
can change independently of the engine's judgment logic — a future spec
could add another report field without touching `score.ts`/
`release-evaluator.ts` at all, and that would bump `reportSchemaVersion`
alone). This directly addresses why three of the eight re-assessed
projects — different Chatwoot runs (`v1`/`v2`/`v3`) — produced different
results against the same `catalogVersion`: `engineVersion` (§3.3)
attributes that to code differences, `reportSchemaVersion` attributes any
future differences in the *report's own shape* to a shape change rather
than a judgment change.

Old reports already on disk (generated by the previous `ProjectReport`
shape, with no `reportSchemaVersion` field at all) are **not** migrated
and are **not** required to validate against the new
`project-report-schema.json` — they remain as-is, legacy artifacts
describing what they described when generated, consistent with the
project's existing immutable-report philosophy (a `ProjectReport` is
never rewritten after creation). Only newly-generated reports carry
`reportSchemaVersion: "2.0.0"` and the new fields.

## 4. Interface Changes

- `src/core/repository.ts`:
  - New `Target` interface: `{ repository: string; commitSha: string | null; branchOrTag: string | null; dirty: boolean | null }`.
  - `AssessmentRun` gains `target?: Target | null`, `profileSnapshot?: ProjectProfile | null`, and `engineVersion?: string | null` — all three **optional and nullable** (§3.3), so a legacy record missing the keys entirely is a valid value with no normalization step, while a new run can still explicitly record `target: null` (caller declined to declare it).
- `src/service/assessment-service.ts`:
  - `AssessmentService`'s constructor gains an injected `engineVersion: string` parameter (same pattern as its existing injectable `now`), defaulted at the composition root (`server.ts`) by reading `package.json`'s `version` once — not read inline inside `startAssessmentRun` on every call.
  - `StartAssessmentRunResult`/`startAssessmentRun` input gains an optional `target` parameter: `target?: { repository: string; commitSha: string | null; branchOrTag: string | null; dirty: boolean | null }` (§3.3 — the parameter is optional; `repository` is required within it if present). The service deep-copies `project.profile` into the new run's `profileSnapshot`, stores its injected `engineVersion`, and stores the declared (or `null`) `target`.
- `src/mcp/tools/start-assessment-run.ts`: input schema gains the optional `target` object (zod), `repository` required within it. No new input for `profileSnapshot`/`engineVersion` — both are always server-derived, never caller-supplied.
- `src/core/score.ts`: `DomainScore.criticalFindings`/`highFindings` renamed to `criticalSeverityFindings`/`highSeverityFindings`. Calculation logic unchanged — `calculateScore`'s output *contract* (field names) changes, its computation does not (§3.2's precision note).
- `src/core/release-evaluator.ts`: `ReleaseEvaluation.criticalFindings`/`highFindings` renamed to `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`. Calculation logic unchanged, output contract renamed — same precision note. `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` **remain** on this core interface, unrenamed and unremoved (§3.4, §3.5 only remove them from the report, not from core); the attack-path logic and the `unblockedCriticalAttackPaths` field's own computation are untouched by this spec — only the unrelated §3.2 finding-count rename applies to this file.
- `src/core/report-builder.ts`:
  - `PrioritizedFindingInput` unchanged.
  - New `FindingSnapshot` interface (§3.1) and a `buildProjectFindingSnapshots` step (sorted ascending by `findingId`, §3.1's ordering invariant) alongside the existing `sortPrioritizedFindings`, both derived from the same single findings fetch `buildReport`'s caller already passes in — no second independent read.
  - `ScoreForReport.domainScores` items reflect the §3.2 domain rename.
  - `ReleaseEvaluationForReport` reflects the §3.2 release rename, and drops `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` (§3.4, §3.5).
  - `ProjectReport` gains `projectFindingSnapshots: FindingSnapshot[]`, `target: Target | null`, `profileSnapshot: ProjectProfile | null`, `engineVersion: string | null`, `reportSchemaVersion: string` — all four non-`projectFindingSnapshots` fields required-but-nullable (not optional) on `ProjectReport` specifically, since `ReportBuilder` always constructs them fresh (§3.3's `ProjectReport` vs. `AssessmentRun` nullability distinction).
  - New `roundReportNumber` helper (§3.6, with the non-finite-input guard), applied to all percentage/score fields during construction.
  - `buildReport`'s input gains `run: { ...existing, target, profileSnapshot, engineVersion }` (no separate `engineVersion` parameter — it comes from the run, not freshly read).
- `src/service/report-service.ts`: `generate` passes `run.target ?? null`/`run.profileSnapshot ?? null`/`run.engineVersion ?? null` through to `buildReport` — does **not** read `package.json` itself (that only happens once, via injection, in `AssessmentService`, per §3.3).
- `data/schemas/score-schema.json`, `data/schemas/release-evaluation-schema.json`, `data/schemas/project-report-schema.json`, `data/schemas/assessment-run-schema.json`: updated to match (new/renamed/removed fields; `target`/`profileSnapshot`/`engineVersion` all optional on `assessment-run-schema.json` per §3.3 — absent from `required`, not merely typed nullable; `additionalProperties: false` preserved throughout).
- No changes to `get_score`'s or `evaluate_release`'s calculation logic, `src/core/score.ts`'s `calculateScore` signature, or `src/core/release-evaluator.ts`'s `evaluateRelease` signature — both tools' **output field names** do change via §3.2's rename, which is a contract change, not a behavior change (§3.2's precision note).
- **Versioning:** this change's own PR/commit bumps `package.json`'s `version` (per the project's existing versioning policy) — required for `engineVersion` to be meaningful starting from the first run created after this change ships (§3.3).

## 5. Testing Strategy

- **`projectFindingSnapshots` completeness:** a project with findings across all five `status` values (`open`, `in_progress`, `resolved`, `accepted`, `false_positive`) — assert every one of them appears in `projectFindingSnapshots`, and only the `open`/`in_progress` ones appear in `prioritizedFindings`. Assert the subset invariant (§3.1) directly: every `prioritizedFindings[i].findingId` is present in `projectFindingSnapshots`.
- **`projectFindingSnapshots` is project-scoped, not run-scoped (the §3.1 limitation, made explicit):** a project with **two** `AssessmentRun`s and findings recorded under each — generate a `ProjectReport` for the *earlier* run and assert `projectFindingSnapshots` still includes the findings associated with the *later* run too (proving the field is project-wide as documented, not silently and incorrectly filtered to one run — the point of this test is to pin the documented limitation so a future change can't accidentally "fix" it into a false promise of run-scoping without updating §3.1 and this test together).
- **Single findings fetch:** assert (e.g. via a repository call-count check in the test double) that generating a report calls `getFindings`/equivalent exactly once — `score`, `releaseEvaluation`, `prioritizedFindings`, and `projectFindingSnapshots` are all derived from that one fetched array, never a second independent read.
- **Renamed field semantics (not just names):** for `criticalSeverityFindings`, a fixture with an active `hardening`-type finding at `severity: "critical"` — assert it counts. For `confirmedCriticalVulnerabilities`, the identical fixture — assert it does **not** count (only `confirmed_vulnerability`-type counts). Mirror for the `high` pair. This directly tests the distinction the old shared name obscured.
- **`target`/`profileSnapshot`/`engineVersion` snapshot fidelity:** `start_assessment_run` with a declared `target` and a project profile at a given revision, constructing `AssessmentService` with `engineVersion: "0.8.0"`; mutate the live `Project.profile` afterward (simulating `update_project_profile`), then construct a second `AssessmentService`/`ReportService` pair with `engineVersion: "0.9.0"` injected (simulating an upgrade before report generation); generate a report from the *original* run and assert `ProjectReport.target`/`profileSnapshot`/`profileRevision`/`engineVersion` all match the **run's** captured values (`engineVersion === "0.8.0"`), not the now-mutated live project or the newer injected version. A sibling test omits `target` entirely from `startAssessmentRun`'s input and asserts `ProjectReport.target === null` while `profileSnapshot`/`engineVersion` are still populated (proving `target`'s null-ability is independent of the other two).
- **`profileSnapshot` is a real deep copy:** mutate the object passed as `project.profile` after `startAssessmentRun` returns and assert the stored `AssessmentRun.profileSnapshot` is unaffected (no shared reference).
- **`target` input validation:** `start_assessment_run` with `target: {}` (no `repository`) is rejected; `target` omitted entirely succeeds with `target: null` stored (§3.3's object-optional/repository-required-if-present distinction).
- **Legacy `AssessmentRun` compatibility:** a fixture `AssessmentRun` object with the `target`/`profileSnapshot`/`engineVersion` keys entirely absent (not merely `null` — a real stand-in for a pre-this-change persisted record) — assert it still validates against the updated `assessment-run-schema.json` (all three absent from `required`, genuinely optional) and that generating a `ProjectReport` from it produces `target: null`, `profileSnapshot: null`, `engineVersion: null` rather than throwing or fabricating a value. A sibling test does the same key-level assertion directly against the TypeScript type (a legacy-shaped object literal with the three keys omitted type-checks as a valid `AssessmentRun`).
- **`unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` absence:** assert `ProjectReport`/`ReleaseEvaluationForReport` has none of the three keys (schema `additionalProperties: false` plus a direct key-absence assertion), while a sibling test confirms core `evaluateRelease`'s own return value (outside the report path) still has all three, unchanged — proving this is a report-layer-only removal.
- **Rounding does not affect gate decisions:** a **synthetic** `Score` fixture (not derived from the real ~48-control catalog, which is too coarse-grained to naturally land on an edge case like `79.995`) engineered so raw `coveragePercent` is just under 80 — assert the **unrounded** value is what `evaluateRelease`'s `coverageOk` comparison uses (result stays `indeterminate`/`blocked`, not `approved`), while the **report's** `controlCoverage` is the rounded `80.0` (or correctly rounds to a value still `< 80` — whichever the fixture's exact math produces) — the point being gate logic and report display never share a rounding step.
- **`-0` normalization:** a `roundReportNumber` unit test asserting `roundReportNumber(-0.001)` (or any input that rounds to negative zero) returns `0`, not `-0` (`Object.is` check).
- **Non-finite rejection:** `roundReportNumber(NaN)`, `roundReportNumber(Infinity)`, and `roundReportNumber(-Infinity)` each throw rather than returning a non-finite value.
- **`reportSchemaVersion` presence:** a freshly generated report has `reportSchemaVersion === "2.0.0"`.
- **`projectFindingSnapshots` ordering:** a fixture with findings recorded out of `findingId` order (e.g. `FND-003` before `FND-001`) — assert the generated report's `projectFindingSnapshots` array is sorted ascending by `findingId` regardless of input order (§3.1's ordering invariant), and that generating the same report twice from unchanged underlying data produces byte-identical `projectFindingSnapshots` arrays.
- **Old report compatibility (non-migration, byte-preservation):** concrete, not just an absence-of-reads claim —
  1. Given: a fixture `legacyReport.json` exists on disk (old shape, no `reportSchemaVersion`) with content hash `H1`.
  2. When: a new `ProjectReport` (shape `2.0.0`) is generated for the same project via the normal `generate_report` path.
  3. Then: `legacyReport.json`'s content hash is still `H1` (byte-for-byte untouched); a separate, new file was written for the new report; the new report's `reportSchemaVersion === "2.0.0"`.

  This replaces a harder-to-prove "assert no code path reads/rewrites existing reports" claim with a directly testable before/after hash comparison.

## 6. Adoption Log (external review)

Brainstorming round 1 (ChatGPT, same persistent review thread as
`assessment-trust-integrity`): confirmed `projectFindingSnapshots` should include
*all* findings (not just actionable) so `ProjectReport` can reconstruct
what was claimed at assessment time, not just today's open list; confirmed
Option A (rename at the source, not just in `ReportBuilder`'s mapping)
given no live schema validation and no external consumer contract yet;
flagged that `release-evaluator.ts`'s renamed field should name *what is
counted* (`confirmed*Vulnerabilities`) rather than *how it's used*
(`blocking*`), since a single high-severity finding doesn't always block
release by itself; flagged that `target` being caller-asserted, not
server-verified, must be stated explicitly in schema/docs wording; found a
real (not just stylistic) problem with keeping
`incidentResponseVerified`/`backupRestoreVerified` — the `ACCEPTED_RISK`
case diverges from `blockingControlsNotVerified`, so the two views are not
actually interchangeable; proposed `reportSchemaVersion`/`engineVersion`/
`profileSnapshot` as three additions beyond the original six sections,
reasoning that identical `catalogVersion` across Chatwoot v1/v2/v3 produced
different results for reasons a report reader can't otherwise attribute.

Brainstorming round 2: confirmed the full synthesis above as final,
including deliberately excluding `evidenceRefs`/`dispositionReason` from
`projectFindingSnapshots` (no existing `Finding` data or write path backs either
— adding them would be new engine capability, not report fidelity);
settled on `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`
as the release-level names; confirmed `target`+`profileSnapshot` belong on
`AssessmentRun`, captured once at run-start, with `ReportBuilder` only
copying the run's snapshot forward (never re-reading live `Project`
state); confirmed `incidentResponseVerified`/`backupRestoreVerified`
should be removed from the report outright, not merely commented, given
the `ACCEPTED_RISK` divergence; gave a concrete `roundReportNumber`
implementation including `-0` normalization; gave the exact snapshot/
finding/renamed-count/old-report-compatibility invariants reproduced in
§3 and §5 above; explicit final verdict: proceed directly to the
implementation plan.

Spec review round 1 (full written spec, same thread): rated the design
85-90% complete and found 4 issues to fix before an implementation plan,
two of them structural. (1) **Blocker, found the spec's own internal
contradiction:** §3.1 claimed `projectFindingSnapshots` was simultaneously "every
`Finding` for the project" and a mechanism to "reconstruct what this
assessment claimed at the time" — these only coincide when a project has
exactly one `AssessmentRun` (true of all 8 validation projects today, not
true in general, since `Finding` carries no run identifier to scope by).
Fixed by making §3.1 state plainly that the field is project-scoped, not
run-scoped, with the limitation demonstrated by a dedicated multi-run test
(§5) and the proper fix (adding a run identifier to `Finding`) named as an
explicit new Out of Scope item (§7). (2) **Blocker:** `engineVersion` was
specified as read fresh in `ReportService.generate` (report-generation
time), which breaks the same staleness principle just established for
`target`/`profileSnapshot` — an engine upgrade between a run's start and a
much-later report generation would mislabel the run's actual engine
version. Fixed by moving `engineVersion` to `AssessmentRun`, captured once
at `start_assessment_run` time, for the same reason and in the same place
as `target`/`profileSnapshot` (§3.3). (3) **Blocker:** making
`target`/`profileSnapshot` required fields on `AssessmentRun` was never
reconciled against the fact that every existing `AssessmentRun` on disk
has neither — unlike `ProjectReport` (where old reports are explicitly
exempted from the new schema, §3.7), nothing said what happens to old
*runs*. Fixed by typing all three new `AssessmentRun` fields nullable
(§3.3's new legacy-compatibility note) rather than attempting a migration
— `profileSnapshot` in particular cannot be honestly backfilled for a
historical run, since there is no way to know what a project's profile
actually was at a past moment once it has since changed. (4) **Minor
wording fix:** §3.4/§3.5/§7 said "no change to `ReleaseEvaluation`
interface," which is misleading since §3.2 does rename two of that same
interface's fields — reworded to scope the "no change" claim specifically
to attack-path/incident-boolean logic, not the interface as a whole.
Also incorporated as non-blocking polish: `roundReportNumber` now rejects
non-finite input rather than silently rounding it; the "reader can always
recover the exact fraction" rounding rationale narrowed to coverage
fields specifically (not claimed for `overallScore`/domain `score`, which
lack an equivalent pair of integer sub-fields); `ReportBuilder` explicitly
required to derive all finding-related report fields from one single
findings fetch, never a second independent read, with a dedicated test.

Spec review round 2 (full revised spec, same thread): rated the design
~95% complete, found 2 new internal contradictions introduced by round
1's own fixes (both now closed) plus 8 polish items, split explicitly
into must-fix-before-plan (items 1-3) and strongly-recommended-given-this-
spec's-own-fidelity-goal (items 4-5), with the rest optional — all 10
incorporated here rather than deferred. (1) **New contradiction:**
`AssessmentRun.target`/`profileSnapshot`/`engineVersion` were typed
required-but-nullable (`field: Type | null`), which cannot represent a
legacy record missing the key entirely — retyped
optional-and-nullable (`field?: Type | null`), matching this same
interface's existing `startedAt`/`completedAt` precedent, with the
object-presence/value-nullability distinction spelled out explicitly.
(2) **New contradiction:** the round-1 text claimed "every newly-created
run never has `target: null`," which is false for `target` specifically
(a new run whose caller omits the `target` input legitimately has
`target: null`) — only `profileSnapshot`/`engineVersion` are
always-populated-by-the-service; reworded to state this per-field rather
than as one blanket claim. (3) **Precision:** `target`'s own input shape
was ambiguous about which part is optional — clarified that the whole
`target` parameter is optional, but `repository` is strictly required
*within* a supplied `target` object (an empty `{}` is rejected; omitting
`target` entirely is accepted). (4) Renamed `findingSnapshots` to
`projectFindingSnapshots` so the project-scoped-not-run-scoped limitation
(round 1's fix) is encoded in the field name itself, not only in prose a
reader might skip — reviewer's framing: this is the report expressing its
own already-decided limitation as a fidelity field, not new detection
capability, so it fits this spec's scope. (5) Noted explicitly that a
rounded `controlCoverage` (e.g. `80.00`) can coexist with a `result` the
number appears to contradict (e.g. `"indeterminate"`, from an unrounded
value just under the threshold) — named as expected behavior arising from
§3.6's own design, not resolved structurally, so a future reader doesn't
mistake it for a bug. (6) `engineVersion` changed from an inline
`package.json` read to an injected `AssessmentService` constructor
parameter (mirroring its existing injectable `now`), plus an explicit
note that this spec's own implementation must bump `package.json`'s
version for the field to mean anything starting from its own first
release. (7) Added a precision note distinguishing "calculation
semantics unchanged" from "output contract unchanged" — §3.2 does rename
fields in `get_score`/`evaluate_release`'s return shape even though
nothing about what they compute changes, and every "no change" claim
elsewhere in the spec now implicitly refers to the former, not the
latter. (8) Tightened `blockingControlFailures`/`blockingControlsNotVerified`'s
"only source of truth" framing (§3.5) to be explicit that this claim is
scoped to blocking-control status, not the whole report, and completed
the §3.4/§7 wording fix begun in round 1 (`release-evaluator.ts` is
untouched regarding attack-path logic specifically, not the file as a
whole, since §3.2 touches the same file). (9) Replaced the old-report
compatibility test's abstract "assert no code path reads/rewrites
existing reports" with a concrete content-hash-preservation test
(Given/When/Then). (10) Added an explicit `findingId`-ascending ordering
invariant and test for `projectFindingSnapshots`, so two reports
generated from the same finding set are byte-identical. Also added two
Out of Scope items surfaced during this round: exact engine *source*
(not just semver) revision provenance, and legacy-report deserialization
(never needed, since old and new report shapes never coexist in memory).
Explicit final verdict: proceed to the implementation plan.

## 7. Out of Scope

- **Attack-path modeling.** `unblockedCriticalAttackPaths` is removed from
  the report (§3.4) but the underlying feature — an `AttackPath` entity,
  repository methods, an MCP tool to record one, and real (non-empty)
  input to `evaluateRelease`'s `attackPaths` parameter — is a separate,
  future feature. Attack-path logic and the `unblockedCriticalAttackPaths`
  core field's own computation remain untouched; §3.2's unrelated
  finding-count rename still applies to this same file
  (`release-evaluator.ts`).
- **`incidentResponseVerified`/`backupRestoreVerified` core API cleanup.**
  These remain on `release-evaluator.ts`'s `ReleaseEvaluation` and
  `evaluate_release`'s live tool output; only `ProjectReport` drops them.
  Removing or renaming them at the core/tool level is a separate concern.
- **`evidenceRefs`/`dispositionReason` on findings.** Would require new
  `Finding` data model fields and (for `dispositionReason`) a new write
  path to transition finding status with a reason — genuinely new engine
  capability, not a report-fidelity fix (§3.1).
- **`Finding`-to-`AssessmentRun` provenance/linkage.** `projectFindingSnapshots`
  is project-scoped, not run-scoped, specifically because `Finding` carries
  no run identifier (§3.1). Adding one (the same shape of fix
  `ControlAssessment` got for `runId`/`profileRevision` in
  `assessment-trust-integrity`) would let a future report scope its
  finding snapshot to exactly the run it came from — genuinely useful, but
  a data-model change to `Finding`'s write path (`record_finding` and
  wherever else constructs one), not a report-serialization fix, so it's
  out of scope here.
- **Server-verified `target` provenance.** `target.commitSha` etc. are
  caller-asserted only; actually verifying a declared commit against a
  live checkout (or any other independent confirmation) is not built here
  (§3.3).
- **Exact engine source revision provenance.** `engineVersion` (§3.3) is
  `package.json`'s semver string, not a build/commit identifier for this
  tool's own source (e.g. a git SHA of the C.S.I-mcp repository itself) —
  two different engine builds sharing the same unreleased `package.json`
  version (a real risk until §4's versioning-policy note is consistently
  followed) are indistinguishable by this field alone. A stronger
  provenance mechanism (e.g. embedding this repo's own build SHA) is a
  separate, future hardening step.
- **Migrating existing on-disk reports.** Old `ProjectReport` files keep
  their original shape permanently; `reportSchemaVersion` only appears on,
  and only applies to, reports generated after this change (§3.7). This
  also means no code in this spec ever deserializes/reads an old-shape
  `ProjectReport` back into the new `ProjectReport` type — the two shapes
  never need to coexist in the same in-memory representation.
- **RiskAcceptance expiry/revoke/staleness integration-test coverage.**
  The 8 re-assessed projects' `acceptedRiskCount` is effectively `0` across
  the board, so this report set is regression evidence (`assessment-trust-integrity`
  didn't break existing projects) but not validation evidence that the new
  trust paths work under real exercise — that needs dedicated
  integration/metamorphic tests, already covered by
  `assessment-trust-integrity`'s own Testing Strategy, and is not part of
  this report-fidelity spec.
