# Assessment Trust & Validity Hardening — Design

## 1. Context and Goal

The commercialization-readiness audit (2026-10-05, tracked in the
`Commercialization Gate` dashboard) found three real, overlapping gaps in
how much `evaluateRelease` and the rest of the system can actually trust a
stored `ControlAssessment`:

1. **`ACCEPTED_RISK` is unvalidated.** `record_assessment` only checks that
   `riskAcceptanceId` is a non-empty string. No `RiskAcceptance` entity is
   ever created, persisted, or checked — any of the 8
   `RELEASE_BLOCKING_CONTROLS` can be marked `ACCEPTED_RISK` with an
   arbitrary string and the Control Gate treats it as "no contribution,"
   no questions asked.
2. **`N/A` requires no evidence and isn't cross-checked.** `N/A` is the
   only verdict excluded from `VERDICTS_REQUIRING_METHODOLOGY_EVIDENCE`,
   and nothing compares a recorded `N/A` against the control's own
   `applicability.finalResult` — an applicable control can be marked `N/A`
   with nothing but a one-line note. This is currently the *cheapest* of
   the three bypasses.
3. **Assessments go stale silently.** `ControlAssessment` has no
   `profileRevision`, so if a project's profile changes after an
   assessment was recorded (e.g. a project that had no local password auth
   adds it), the old assessment keeps being trusted with no signal that it
   was evaluated against a now-outdated picture of the project.

All three were previously documented as known, deliberately-deferred
limitations in `src/core/release-evaluator.ts` (see the comment block
above the Control Gate loop) and in
`docs/superpowers/specs/2026-10-05-release-blocking-controls-design.md`
§7. This spec is that deferred design pass.

**Goal:** make a stored `ControlAssessment`'s status mean what it claims to
mean, for as long as it's trusted — not just correct at the moment it was
recorded.

## 2. Current State (for contrast)

`src/service/assessment-service.ts`'s `recordAssessment`:
- Requires evidence with `searchScope`/`searchMethod` for `PASS`/`FAIL`/`PARTIAL`.
- Requires non-empty `notes` for `N/A`. Nothing else.
- Requires non-empty `riskAcceptanceId` for `ACCEPTED_RISK`. Nothing else.
- Calls `getRun(projectId, runId)` only to confirm the run exists — the
  returned run object is discarded.
- Computes `applicability` via `evaluateApplicability(control, project.profile)`,
  honoring an optional `input.applicabilityOverride: { result, reason }`.

`src/core/repository.ts`'s `ControlAssessment` interface has no
`profileRevision` field. `AssessmentRun` has one (`profileRevision: number`,
captured once at `start_assessment_run` time from the project's profile at
that moment), but nothing on the `ControlAssessment` record ties it back to
which run — or which profile revision — produced it.

`data/schemas/risk-acceptance-schema.json` already exists, fully specified
(`riskAcceptanceId`, `controlId`, `findingIds`, `reason`,
`compensatingControls`, `approvedBy`, `approvedAt`, `expiresAt`,
`reviewDate`, `status: active|expired|revoked`) — from this project's
original Phase 1 data foundation. **Zero lines in `src/` reference it.**
No repository methods, no service logic, no MCP tool. This spec's
RiskAcceptance work is substantially a wiring task, not a schema design
task.

`src/service/analysis-service.ts`'s `evaluateRelease(projectId)` already
builds a normalized `assessments` array (`{ controlId, status }` per
`ControlAssessment`) before calling the core `evaluateRelease`. This is the
seam this spec uses for ACCEPTED_RISK and staleness enforcement — see §3.3.

## 3. Architecture

Three largely-independent pieces of work, unified by one question: *can
this stored assessment be trusted right now, not just at the moment it was
written?* Each piece closes one bypass; together they're one spec because
all three touch `ControlAssessment`'s write path (`recordAssessment`) and,
for two of the three, its read path (`AnalysisService.evaluateRelease`).

### 3.1 RiskAcceptance: real entity, real validation, record-time **and** release-time

**Entity.** Wire up the existing `risk-acceptance-schema.json` as a first-class
entity, stored the same way `Finding` is (`data/projects/<id>/risk-acceptances.json`,
append/update by `riskAcceptanceId`):

- `SecurityRepository` gains `getRiskAcceptances(projectId): Promise<RiskAcceptance[]>`
  and `saveRiskAcceptance(projectId, ra): Promise<void>` (upsert by
  `riskAcceptanceId`, mirroring `saveControlAssessment`'s upsert-by-`controlId`
  — a `revoke` needs to update a record in place, not append a duplicate).
- `RiskAcceptance` TS interface added to `src/core/repository.ts`, matching
  the schema. Two fields are **added** to the schema beyond what Phase 1
  shipped: `revokedAt: string | null` and `revokedReason: string | null`
  (needed by `revoke_risk_acceptance`, §3.1's third tool — the existing
  `reason` field is the *original* acceptance justification and must not be
  overwritten by a revoke).
- New MCP tool `record_risk_acceptance { projectId, controlId, findingIds?,
  reason, compensatingControls?, expiresAt }` — `approvedBy`/`approvedAt`
  are agent-populated (`AGENT_IDENTITY`/now), same pattern as
  `record_finding`. ID allocation: `nextSequentialId("RA", existing.length)`.
- New MCP tool `revoke_risk_acceptance { projectId, riskAcceptanceId,
  revokedReason }` — loads the existing record, sets
  `status: "revoked"`, `revokedAt: now()`, `revokedReason: input.revokedReason`,
  saves it back. Rejects (`NOT_FOUND`) if the ID doesn't exist. **Added to
  scope after this design's GPT review round** — originally deferred as
  YAGNI, reversed because without it there is no way to undo an improperly
  or prematurely approved risk acceptance before its natural expiry, which
  is a real gap for a control that gates production release.

**Pure validity check.** `src/core/risk-acceptance.ts` (new, pure, no I/O —
same style as `applicability.ts`/`criticality.ts`):

```ts
export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean {
  return ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt;
}
```

Checking `status === "active"` AND the date range independently (not
either alone) is deliberate: a stored `status` field can drift from the
truth it's supposed to represent exactly the way
`incidentResponseVerified`/`backupRestoreVerified` did in the
release-blocking-controls work — trusting `status` alone would silently
keep an expired acceptance "active" forever since nothing flips it. The
`approvedAt <= nowIso` half guards against a malformed or clock-skewed
future-dated approval being treated as already in effect.

**Record-time validation** (`recordAssessment`, strengthened): when
`input.status === "ACCEPTED_RISK"`, beyond the existing non-empty-string
check:
1. The `riskAcceptanceId` must resolve to an actual `RiskAcceptance` for
   this project.
2. That `RiskAcceptance.controlId` must equal `input.controlId` (a risk
   acceptance scoped to one control cannot be reused to cover another —
   closes the scope-confusion gap raised in review).
3. `isRiskAcceptanceEffectivelyValid(ra, now())` must be true.

Any failure throws `VALIDATION_ERROR`, same pattern as the existing checks
in this function.

**Release-time re-validation** (new — see §3.3): record-time validation
alone is insufficient, because a `RiskAcceptance` can expire *after* the
assessment was recorded but *before* `evaluate_release` is actually called
— there is no natural moment where an expired acceptance's effect on an
already-recorded `ACCEPTED_RISK` status gets reconsidered unless
`evaluateRelease` itself re-checks validity every time it runs. §3.3
covers exactly how.

**Governance note, documented not fixed.** `approvedBy` on a
`RiskAcceptance` carries the same unauthenticated-actor limitation as
`ControlAssessment.assessedBy` (both are `AGENT_IDENTITY`, a fixed
placeholder — tracked as TRUST-AUDITLOG-001 on the
commercialization-readiness dashboard). Unlike the general audit-trail gap
(explicitly out of scope for this spec — real identity needs real auth,
which needs
the still-undecided self-hosted-vs-SaaS deployment call), `RiskAcceptance`'s
approval authority specifically cannot be waved off the same way: in the
current single-process stdio MCP deployment model, whoever can call
`record_risk_acceptance` can immediately use the ID they just created to
clear a blocking `FAIL` via `record_assessment` — a self-approval loop with
no real separation between "proposing a risk acceptance" and "approving
one." This spec does not add a second-approver workflow (no evidence yet
that's needed, and it's a bigger feature than this spec's scope). It
**does** require the trust model to be stated explicitly rather than left
implicit: a code comment on `record_risk_acceptance`'s registration and a
line in this spec state that, in the current local single-user stdio
deployment, *possession of local MCP access constitutes approval
authority* — not a cryptographically verified identity, and not a real
governance control. Revisit when deployment model (self-hosted vs SaaS,
still an open decision on the readiness dashboard) is decided.

### 3.2 N/A cross-check against applicability

No new fields. `recordAssessment` already computes `autoResult` via
`evaluateApplicability(control, project.profile)` and already accepts an
optional `input.applicabilityOverride: { result: Verdict; reason: string }`
that becomes `applicability.finalResult` when present. The fix reuses both:

1. Move the `evaluateApplicability(...)` call above the existing
   validation block (currently computed after; the N/A check needs
   `autoResult` before it runs — a pure reorder, no behavior change to the
   computation itself).
2. New rule: if `input.status === "N/A"` and `autoResult !== "not_applicable"`,
   `input.applicabilityOverride` is now **required**, and its `result`
   must be `"not_applicable"`. The override's already-required `reason`
   field is the justification the review round asked for — no new field
   needed. If `autoResult` is already `"not_applicable"`, behavior is
   unchanged (existing non-empty-`notes` check is sufficient — engine and
   status already agree).
3. **Forward construction already prevents the reverse contradiction.**
   Because `applicability.finalResult` is always derived from either
   `autoResult` (no override) or `input.applicabilityOverride.result` (with
   one), and rule 2 forces that override's `result` to be
   `"not_applicable"` whenever `status === "N/A"`, there is no code path
   left where `status === "N/A"` and `finalResult !== "not_applicable"`
   can both hold — by construction, not by an extra runtime check.
4. The schema (`control-assessment-schema.json`) gets the same invariant
   declared in `allOf`, as a defense-in-depth backstop independent of
   `recordAssessment`'s code path (consistent with how
   `ACCEPTED_RISK`/`riskAcceptanceId` and `N/A`/`notes` are already
   schema-enforced, not just service-enforced):

```json
{
  "if": { "properties": { "status": { "const": "N/A" } }, "required": ["status"] },
  "then": {
    "properties": {
      "applicability": {
        "type": "object",
        "properties": { "finalResult": { "const": "not_applicable" } },
        "required": ["finalResult"]
      }
    }
  }
}
```

### 3.3 Staleness: whole-run granularity, trust-translation at the service seam

**Rejected approach, and why.** An earlier draft of this design added a
`profileRevision` field to `release-evaluator.ts`'s `ControlAssessmentInput`
and a new `currentProfileRevision` parameter to the core `evaluateRelease`
function, with per-control staleness comparison inside the Control Gate
loop. External review raised two problems with this: (1) a profile change
can affect *any* of the 48 cataloged controls' applicability, not just the
8 `RELEASE_BLOCKING_CONTROLS` — and there is no dependency-tracking
anywhere in this codebase that could tell us *which* controls a given
profile change actually touches, so per-control staleness checking is
precision this system cannot actually deliver; and (2) widening the core
`evaluateRelease` function's signature again, immediately after it was
hardened by the previous spec, adds surface area to an already-reviewed
file for a problem that can be solved entirely in the service layer
instead.

**Adopted approach.** Treat staleness the same way §3.1 treats an invalid
`ACCEPTED_RISK`: translate it into an effective status *before* the array
reaches the pure core `evaluateRelease` function, so that function's
interface and internal logic do not change at all.

**Write path.** `ControlAssessment` gains `profileRevision: number`
(required). `recordAssessment` captures it from the **run's** pinned
`profileRevision` (`run.profileRevision`, from the already-fetched —
currently discarded — `getRun` result), not a fresh read of the project's
current `profileRevision`. This matters: the run is the system's existing
snapshot boundary (`AssessmentRun.profileRevision` is captured once, at
`start_assessment_run`), so an assessment's `profileRevision` should record
*what the run believed the profile was*, which is the correct provenance
question. Whether that belief is still *current* is a separate question,
answered at read time (next paragraph).

**New write-time guard.** `recordAssessment` now also rejects
(`PRECONDITION_FAILED`, matching this codebase's existing use of that code
for run/profile mismatches) if `run.profileRevision !== project.profileRevision`
— i.e. the project's profile moved on since this run started. This forces
a new run rather than letting a run silently keep producing assessments
against a profile it no longer represents, which would otherwise let a
single run mix assessments from two different profile snapshots with no
way to tell them apart later.

**Read path — the actual staleness check.** `AnalysisService.evaluateRelease`
already builds a normalized assessments array via `.map()` before calling
core `evaluateRelease`. Both staleness and ACCEPTED_RISK validity are
folded into that same translation step:

```ts
// src/service/analysis-service.ts, inside evaluateRelease(projectId)
const riskAcceptances = await this.repository.getRiskAcceptances(projectId);
const riskAcceptanceById = new Map(riskAcceptances.map((ra) => [ra.riskAcceptanceId, ra]));
const now = this.now();

const normalizedAssessments: ControlAssessmentInput[] = assessments.map((a) => {
  const stale = a.profileRevision !== project.profileRevision;
  const ra = a.riskAcceptanceId ? riskAcceptanceById.get(a.riskAcceptanceId) : undefined;
  const acceptedRiskInvalid = a.status === "ACCEPTED_RISK" && !(ra && isRiskAcceptanceEffectivelyValid(ra, now));
  return { controlId: a.controlId, status: stale || acceptedRiskInvalid ? "NOT_TESTED" : a.status };
});
```

A stale assessment or an assessment whose `ACCEPTED_RISK` is no longer
backed by a valid `RiskAcceptance` is translated to `"NOT_TESTED"` for
*this evaluation only* — the stored `ControlAssessment` record is never
mutated. For a `RELEASE_BLOCKING_CONTROLS` member this means it lands in
`blockingControlsNotVerified` (indeterminate), via the Control Gate's
existing, unchanged status-mapping logic: not a `FAIL` (we don't know the
control is actually broken — only that the record claiming otherwise can
no longer be trusted), and not silently `PASS`. This requires
`AnalysisService` to gain an injectable clock (`now: () => string`,
constructor parameter defaulting to `() => new Date().toISOString()`) —
the same pattern `AssessmentService` already uses, needed here for
deterministic tests of the `ACCEPTED_RISK`-expiry path.

**`src/core/release-evaluator.ts` is untouched by this spec.** No new
parameters, no new fields on `ControlAssessmentInput`, no new logic in the
Control Gate loop. Everything in this section lives in
`src/service/analysis-service.ts` and the new `src/core/risk-acceptance.ts`
helper.

**Existing-data migration.** Adding `profileRevision` as a *required*
`ControlAssessment` field breaks every assessment already recorded for the
6 real-world validation projects under `data/projects/` (now gitignored,
per LEGAL-GITIGNORE-001, but still real data this tool needs to keep
working with). These records have no `profileRevision` and — since
`ControlAssessment` has never stored a `runId` either — no stored link back
to which run produced them. A one-time migration script
(`scripts/migrate-control-assessment-profile-revision.ts`, run once, not
part of the ongoing MCP server or its test suite) backfills each project:
for each project with exactly one `AssessmentRun` (true for all 6, by
construction of how this tool has been used so far — single-pass
validation runs), stamp every `ControlAssessment` with that run's
`profileRevision`. A project with more than one run is skipped and
reported for manual review rather than guessed at (none currently exist,
but the script must not silently guess wrong for one that does later).

## 4. Interface Changes

- `RiskAcceptance` (new TS interface, `src/core/repository.ts`): matches
  `risk-acceptance-schema.json` plus the two new fields
  (`revokedAt: string | null`, `revokedReason: string | null`).
- `SecurityRepository` gains `getRiskAcceptances(projectId): Promise<RiskAcceptance[]>`
  and `saveRiskAcceptance(projectId: string, ra: RiskAcceptance): Promise<void>`.
- `ControlAssessment.profileRevision: number` — new required field.
- Two new MCP tools: `record_risk_acceptance`, `revoke_risk_acceptance`.
- `src/core/risk-acceptance.ts` (new file): exports
  `isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean`.
- `AnalysisService`'s constructor gains an optional `now: () => string`
  parameter (default `() => new Date().toISOString()`), matching
  `AssessmentService`'s existing constructor shape.
- `src/core/release-evaluator.ts`: **no changes.**
- `src/core/score.ts`: **no changes** (see §7 — staleness and
  `ACCEPTED_RISK` validity are deliberately not propagated to
  coverage/score calculations by this spec).

## 5. Testing Strategy

- **RiskAcceptance validity:** parameterized tests over
  `isRiskAcceptanceEffectivelyValid` covering all combinations of
  `status` (active/expired/revoked) crossed with date position (before
  `approvedAt`, between, after `expiresAt`).
- **Record-time ACCEPTED_RISK:** existing-but-missing-ID, wrong-`controlId`
  scope, expired, revoked, and valid cases — each a distinct `VALIDATION_ERROR`
  or success.
- **Record-time N/A:** `autoResult === "not_applicable"` with/without notes
  (unchanged behavior), `autoResult === "applicable"` with/without a
  matching override (new behavior), and the construction argument itself —
  assert that no code path can produce a saved `ControlAssessment` with
  `status: "N/A"` and `applicability.finalResult !== "not_applicable"`.
- **profileRevision capture and run-mismatch rejection:** `recordAssessment`
  stamps `run.profileRevision` (not the project's live value) onto the
  saved assessment; a run whose `profileRevision` no longer matches the
  project's current one is rejected with `PRECONDITION_FAILED` before any
  assessment is written.
- **evaluateRelease staleness translation (metamorphic):** an otherwise-approved
  baseline where every `RELEASE_BLOCKING_CONTROLS` member has
  `profileRevision` equal to the project's current one; flip exactly one
  assessment's `profileRevision` to an old value and assert `result`
  changes to `"indeterminate"` with that control now in
  `blockingControlsNotVerified` — same shape as the metamorphic tests from
  the previous spec, applied to the new mechanism.
- **evaluateRelease ACCEPTED_RISK re-validation (metamorphic):** an
  otherwise-approved baseline with a valid `RiskAcceptance` backing a
  blocking control's `ACCEPTED_RISK` status; expire or revoke that
  `RiskAcceptance` *without touching the `ControlAssessment`* and assert
  `result` changes from `"approved"` to `"indeterminate"` on the next
  `evaluateRelease` call — this is the direct regression test for the
  record-time-only validation gap this spec exists to close.
- **No mutation of stored data:** assert the saved `ControlAssessment`'s
  `status` field is untouched (`"ACCEPTED_RISK"`, not overwritten with
  `"NOT_TESTED"`) after an `evaluateRelease` call reveals its risk
  acceptance expired — only the evaluator's internal, in-memory view is
  translated.
- **Migration script:** run against fixture data mirroring the real 6
  projects' shape (single run each), assert every `ControlAssessment`
  gets its run's `profileRevision`; a fixture project with two runs is
  asserted to be skipped and reported, not guessed.

## 6. Adoption Log (external review)

Reviewed with the same persistent ChatGPT thread used for the
release-blocking-controls spec (2026-10-05, same day — continuation of
that review relationship). The reviewer:

- Confirmed combining RiskAcceptance validation, N/A cross-check, and
  staleness into one spec is correct — all three are the same underlying
  question ("can a stored assessment's state be trusted at release time,
  not just record time") and share the `ControlAssessment` write/read
  seam.
- **Found a real gap in the initial draft**: record-time `ACCEPTED_RISK`
  validation alone is insufficient — a `RiskAcceptance` can expire between
  when an assessment is recorded and when `evaluate_release` is actually
  called, and nothing in the original draft re-checked validity at that
  later point. Adopted: §3.3's release-time translation covers both
  staleness and `ACCEPTED_RISK` validity through the same mechanism.
- **Found a second real gap**: `RiskAcceptance.approvedBy` carries the
  same unauthenticated-actor weakness as `ControlAssessment.assessedBy`,
  but unlike the general audit-trail gap (legitimately out of scope here),
  it creates a concrete self-approval loop (an MCP caller can create a
  `RiskAcceptance` and immediately spend it). Adopted: §3.1's governance
  note, documented rather than fixed with a real approval workflow (no
  evidence that's needed yet, and it's a bigger feature than this spec).
- **Reversed an earlier scoping call**: a `revoke_risk_acceptance` tool was
  initially cut as YAGNI; reviewer argued the absence of any way to undo
  an improperly-approved risk acceptance before its natural expiry is a
  real gap for a control that gates production release. Adopted — see
  §3.1.
- **Caught that the initial staleness design was architecturally wrong**,
  not just incomplete: per-control `profileRevision` comparison inside the
  core `evaluateRelease` function implies a dependency-tracking capability
  ("which controls does this profile change actually affect") that does
  not exist anywhere in this codebase. The author independently proposed
  the fix adopted in §3.3 (translate at the `AnalysisService` seam,
  mirroring the `ACCEPTED_RISK` pattern, leaving `release-evaluator.ts`
  untouched) after recognizing it generalized the reviewer's own earlier
  recommendation for `ACCEPTED_RISK` validation placement; the reviewer
  had separately suggested a coarser alternative (treat an entire stale
  run as indeterminate) for the same reason — both converge on the same
  practical requirement: don't claim per-control precision this system
  cannot support.
- Flagged that an existing-data migration would be needed once
  `profileRevision` becomes required (the author's initial draft had not
  considered this at all) — adopted as §3.3's migration script,
  with the reviewer's specific guidance to backfill from the assessment's
  originating run rather than the project's current profile revision
  (which would fabricate false provenance for historical data).
- Suggested propagating staleness/invalid-`ACCEPTED_RISK` translation into
  `score.ts`'s coverage calculation too. Declined for this spec — see §7.

## 7. Out of Scope

- **General audit trail** (`ControlAssessment.assessedBy` carrying real,
  distinguishable actor identity). Already documented as a known
  limitation; the real fix needs authentication, which needs the
  still-undecided self-hosted-vs-SaaS deployment model. Tracked on the
  commercialization-readiness dashboard as TRUST-AUDITLOG-001.
- **Concurrent-write protection** (cross-process file locking). Unrelated
  to assessment trust semantics; a pure infrastructure concern, deferred
  to whatever spec eventually addresses the deployment model decision.
  Tracked as TRUST-CONCURRENCY-001.
- **A real multi-party approval workflow for `RiskAcceptance`** (separate
  proposer/approver roles, cryptographic identity). The governance note in
  §3.1 documents the current single-actor trust model honestly; building
  a real workflow needs real identity, which (again) needs the deployment
  model decision.
- **Propagating staleness or `ACCEPTED_RISK` invalidity into
  `src/core/score.ts`'s coverage/score calculation.** Raised during
  review as a reasonable follow-up — an assessment that's effectively
  `NOT_TESTED` for release-gate purposes arguably shouldn't count as
  "covered" for coverage-percentage purposes either. Declined here because
  it's a genuinely separate consumer with its own existing behavior this
  spec hasn't audited, and the user-approved scope for this spec was the
  Trust/Control Gate axis specifically. A real, separate follow-up
  candidate, not silently dropped.
- **Per-control dependency tracking** ("which specific controls does a
  given profile change actually affect"). Would allow finer-grained
  staleness than the whole-run-vs-current-revision comparison this spec
  adopts. No such tracking exists anywhere in this codebase today, and
  building it is a meaningfully larger undertaking than this spec's scope.
- **Retroactively re-running `evaluate_release`/`generate_report` for the
  6 already-assessed real validation projects** against this spec's new
  logic once it ships. A likely real next step, same as the equivalent
  item deferred in the release-blocking-controls spec — tracked
  separately, not bundled into implementation.
