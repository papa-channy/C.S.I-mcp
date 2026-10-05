# Release-Blocking Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `evaluateRelease`'s gate actually block release on a small set of release-blocking controls failing outright, regardless of what `Finding.type` got attached to the gap, and fix the pre-existing bug where `incidentResponseVerified`/`backupRestoreVerified` were computed but never consulted.

**Architecture:** Split `result` into three independently-computed sub-verdicts (Finding Gate, unchanged; Control Gate, new; Coverage Gate, unchanged) combined worst-wins (`blocked` > `indeterminate` > `approved`). The Control Gate reads a new hardcoded `RELEASE_BLOCKING_CONTROLS` set against the existing per-project `ControlAssessmentInput[]` — no new inputs, no project-profile conditionals in this file (the catalog's own `applicability.when` already resolved that before `evaluateRelease` ever runs).

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema draft 2020-12) — same stack as the rest of `src/core`.

**Spec:** `docs/superpowers/specs/2026-10-05-release-blocking-controls-design.md`

## Global Constraints

- `RELEASE_BLOCKING_CONTROLS` is a hardcoded `ReadonlySet<string>` in `src/core/release-evaluator.ts`, next to the existing `RELEASE_GATE_CONTROL_MAP` — not a JSON/data-driven policy file (spec §8).
- Exactly these 8 controlIds, no more, no fewer, for this plan: `IAM-AUTH-003`, `IAM-AUTH-005`, `IAM-AUTHZ-001`, `IAM-AUTHZ-002`, `DATA-ENC-002`, `DATA-KEYSEP-001`, `OPS-BACKUP-TEST-001`, `GOV-IR-001`.
- Control Gate status mapping (spec §3), exact: `FAIL` → contributes `"blocked"`; `PARTIAL`, `NOT_TESTED`, or the controlId absent entirely from the `assessments` input → contributes `"indeterminate"`; `PASS`, `N/A`, or `ACCEPTED_RISK` → no contribution.
- A `control_gap`-typed `Finding` is never separately counted by the Finding Gate. Only the underlying control's own status (read directly from `assessments`, not derived from any `Finding`) feeds the Control Gate. No mechanism in this plan reads `Finding.type === "control_gap"` anywhere — if a diff does that, it is wrong.
- `result` combination: any gate contributing `"blocked"` → `"blocked"`; else any gate contributing `"indeterminate"` → `"indeterminate"`; else `"approved"`. This generalizes (not replaces) the existing `findingThresholdsPass` / `MIN_COVERAGE_FOR_APPROVAL_PERCENT` logic already in the file.
- `ReleaseEvaluation.blockingControlFailures` and `.blockingControlsNotVerified` are both `string[]` of controlIds (not booleans, not counts) — required fields, not optional.
- No changes to `src/core/score.ts`, `src/core/criticality.ts`, `src/core/applicability.ts`, or any `src/service/*.ts`/`src/mcp/tools/*.ts` file's logic — every one of those either doesn't touch `ReleaseEvaluation` at all, or passes it through unchanged (verified by reading the real source before writing this plan; Task 2 covers the one place — `report-builder.ts`'s type — that needs its *type* widened even though no logic changes).

---

### Task 1: Control Gate logic in `release-evaluator.ts`

**Files:**
- Modify: `src/core/release-evaluator.ts`
- Test: `tests/core/release-evaluator.test.ts`

**Interfaces:**
- Consumes: nothing new from outside this file. `ControlAssessmentInput` (already defined in this file: `{ controlId: string; status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK" }`) is the only input type the Control Gate reads from.
- Produces (for Task 2 and every other consumer of `ReleaseEvaluation`):
  - `export const RELEASE_BLOCKING_CONTROLS: ReadonlySet<string>`
  - `ReleaseEvaluation` interface gains `blockingControlFailures: string[]` and `blockingControlsNotVerified: string[]`.
  - `evaluateRelease(...)`'s returned object always includes both fields, populated from the real `assessments` input it already receives — no new parameter.

The current end of `src/core/release-evaluator.ts` (as of this plan) reads:

```ts
export const RELEASE_GATE_CONTROL_MAP = {
  incidentResponseVerified: "GOV-IR-001",
  backupRestoreVerified: "OPS-BACKUP-TEST-001",
} as const;

// Below this coverage, an otherwise-clean finding set is not good evidence of a
// clean release — it may just mean most applicable controls were never assessed.
// "approved" is downgraded to "indeterminate" in that case; a result that was
// already "blocked" on findings/thresholds stays "blocked" regardless of coverage.
export const MIN_COVERAGE_FOR_APPROVAL_PERCENT = 80;

export interface ScoreInput {
  coverage: { coveragePercent: number };
}

export type FindingType =
  | "confirmed_vulnerability"
  | "likely_vulnerability"
  | "control_gap"
  | "hardening"
  | "process_gap"
  | "accepted_design"
  | "needs_validation";

export interface FindingInput {
  findingId: string;
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "info";
  type: FindingType;
}

export interface AttackPathInput {
  result: "blocked" | "possible";
  relatedFindingIds: string[];
}

export interface ControlAssessmentInput {
  controlId: string;
  status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";
}

export interface ReleaseEvaluation {
  gate: 4;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  result: "approved" | "blocked" | "indeterminate";
}

export function evaluateRelease(inputs: {
  score: ScoreInput;
  findings: FindingInput[];
  attackPaths: AttackPathInput[];
  assessments: ControlAssessmentInput[];
  securityLevel: string;
}): ReleaseEvaluation {
  const { score, findings, attackPaths, assessments, securityLevel } = inputs;

  if (securityLevel !== "SVL-2" && securityLevel !== "SVL-3") {
    throw new Error(
      `evaluateRelease: gate 4 (production_release) has no defined threshold for securityLevel "${securityLevel}" — only SVL-2/SVL-3 are covered by data/process/release-gates.json`
    );
  }

  const activeFindings = findings.filter(
    (f) => (f.status === "open" || f.status === "in_progress") && f.type === "confirmed_vulnerability"
  );
  const activeCritical = activeFindings.filter((f) => f.severity === "critical");
  const activeHigh = activeFindings.filter((f) => f.severity === "high");
  const criticalFindings = activeCritical.length;
  const highFindings = activeHigh.length;

  const criticalFindingIds = new Set(activeCritical.map((f) => f.findingId));
  const unblockedCriticalAttackPaths = attackPaths.filter(
    (ap) => ap.result === "possible" && ap.relatedFindingIds.some((id) => criticalFindingIds.has(id))
  ).length;

  const residualRisksAccepted = assessments.filter((a) => a.status === "ACCEPTED_RISK").length;

  const assessmentByControl = new Map(assessments.map((a) => [a.controlId, a.status]));
  const incidentResponseVerified = assessmentByControl.get(RELEASE_GATE_CONTROL_MAP.incidentResponseVerified) === "PASS";
  const backupRestoreVerified = assessmentByControl.get(RELEASE_GATE_CONTROL_MAP.backupRestoreVerified) === "PASS";

  const uncoveredHigh = activeHigh.filter(
    (f) => !(f.controlIds.length > 0 && f.controlIds.every((id) => assessmentByControl.get(id) === "ACCEPTED_RISK"))
  );
  const highFindingsSatisfied = securityLevel === "SVL-3" ? highFindings === 0 : uncoveredHigh.length === 0;

  const findingThresholdsPass = criticalFindings === 0 && highFindingsSatisfied;
  const result: "approved" | "blocked" | "indeterminate" = !findingThresholdsPass
    ? "blocked"
    : score.coverage.coveragePercent < MIN_COVERAGE_FOR_APPROVAL_PERCENT
      ? "indeterminate"
      : "approved";

  return {
    gate: 4,
    controlCoverage: score.coverage.coveragePercent,
    criticalFindings,
    highFindings,
    unblockedCriticalAttackPaths,
    residualRisksAccepted,
    incidentResponseVerified,
    backupRestoreVerified,
    result,
  };
}
```

Note `assessmentByControl` already exists (a `Map<string, ControlAssessment["status"]>` built from `assessments`) — the Control Gate reuses it rather than re-deriving it.

- [ ] **Step 1: Write the failing Control Gate status-mapping tests**

Append to `tests/core/release-evaluator.test.ts` (keep the existing `import` block; this plan only adds `RELEASE_BLOCKING_CONTROLS` to the named imports from `../../src/core/release-evaluator.js`):

```ts
import {
  evaluateRelease,
  MIN_COVERAGE_FOR_APPROVAL_PERCENT,
  RELEASE_BLOCKING_CONTROLS,
  RELEASE_GATE_CONTROL_MAP,
  type AttackPathInput,
  type ControlAssessmentInput,
  type FindingInput,
  type ScoreInput,
} from "../../src/core/release-evaluator.js";
```

**Important — this change affects existing tests, not just new ones.**
`RELEASE_BLOCKING_CONTROLS` has 8 members, and the Control Gate treats a
blocking control that's simply absent from `assessments` the same as
`NOT_TESTED` (→ contributes `"indeterminate"`). `baseInputs()`'s default
`assessments: []` means **every one of the 8 is absent by default** — so six
*existing* tests in this file that currently assert `.result === "approved"`
using `baseInputs()` with no (or only unrelated) assessments will start
failing once Step 3 is implemented, because the previously-`"approved"`
result becomes `"indeterminate"`. This is correct new behavior (an
unassessed project genuinely shouldn't read as `"approved"`), but it means
this step must also fix those six tests — not as an afterthought, but so
Step 2's "run and confirm only the expected tests fail" is actually true,
and so Step 4's "run and confirm everything passes" is actually true too.

First, add one module-level helper function right after the existing
`baseInputs` function (same place, same file) — every test below, new and
fixed-existing alike, uses it:

```ts
// All 8 RELEASE_BLOCKING_CONTROLS members at PASS — the neutral baseline that
// keeps the Control Gate out of a test's way when the test is really about
// something else (findings, coverage). Tests that exercise the Control Gate
// itself build on top of this via assessmentsWithOneOverride, below.
function allBlockingControlsPass(): ControlAssessmentInput[] {
  return [...RELEASE_BLOCKING_CONTROLS].map((controlId) => ({ controlId, status: "PASS" as const }));
}

// allBlockingControlsPass(), except `overrideControlId` gets `overrideStatus` —
// isolates a test to the one control it's actually exercising instead of
// leaking "absent"/other-status contributions from the other 7.
function assessmentsWithOneOverride(
  overrideControlId: string,
  overrideStatus: ControlAssessmentInput["status"]
): ControlAssessmentInput[] {
  return allBlockingControlsPass().map((a) =>
    a.controlId === overrideControlId ? { ...a, status: overrideStatus } : a
  );
}

// Used only by the "gate precedence" describe block, further below — a second,
// distinct representative control so those tests don't incidentally reuse
// BLOCKING_CONTROL (declared inside the Control Gate describe block) and read
// as if precedence only works for one specific control.
const BLOCKING_CONTROL_FOR_PRECEDENCE = "GOV-IR-001";
```

Second, fix the six existing tests (all in the `evaluateRelease — thresholds`,
`evaluateRelease — type-based gating`, and `evaluateRelease — coverage
threshold / indeterminate` `describe` blocks already in this file) so they
keep asserting `"approved"` for the reason each one actually tests, not for
an accidental absence of blocking-control data:

```ts
// 1. "SVL-3, zero critical and zero high findings -> approved" — was:
//    expect(evaluateRelease(baseInputs()).result).toBe("approved");
// becomes:
    expect(evaluateRelease(baseInputs({ assessments: allBlockingControlsPass() })).result).toBe("approved");

// 2. "a resolved critical finding does not count toward criticalFindings or block the release" — was:
//    const result = evaluateRelease(baseInputs({ findings }));
// becomes:
    const result = evaluateRelease(baseInputs({ findings, assessments: allBlockingControlsPass() }));

// 3. "SVL-2, one open high finding whose only control has an ACCEPTED_RISK assessment -> approved (the exception)" — was:
//    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }];
// becomes:
    const assessments: ControlAssessmentInput[] = [
      { controlId: "X-001", status: "ACCEPTED_RISK" },
      ...allBlockingControlsPass(),
    ];
    // (the rest of this test — the `evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" }))`
    // call and both expectations — is unchanged)

// 4. "SVL-3, an open critical finding typed control_gap does not block the release" — was:
//    const result = evaluateRelease(baseInputs({ findings }));
// becomes:
    const result = evaluateRelease(baseInputs({ findings, assessments: allBlockingControlsPass() }));

// 5. "SVL-3, an open high finding typed hardening does not block the release" — was:
//    const result = evaluateRelease(baseInputs({ findings }));
// becomes:
    const result = evaluateRelease(baseInputs({ findings, assessments: allBlockingControlsPass() }));

// 6. "at or above MIN_COVERAGE_FOR_APPROVAL_PERCENT with zero findings -> approved" — was:
//    const result = evaluateRelease(baseInputs({ score: atThreshold }));
// becomes:
    const result = evaluateRelease(baseInputs({ score: atThreshold, assessments: allBlockingControlsPass() }));
```

Each of these six is a one-line change (add `assessments: allBlockingControlsPass()`,
or spread `...allBlockingControlsPass()` into an existing `assessments` array
literal) — nothing else about any of these six tests changes, including their
names and their other expectations. Do not change any test in this file that
currently asserts `"blocked"` — a finding-driven or Finding-Gate-driven
`"blocked"` result is unaffected by the Control Gate either way, since
`"blocked"` already wins over `"indeterminate"` in the combination rule.

Third, add this new `describe` block at the end of the file (after the
existing `RELEASE_GATE_CONTROL_MAP drift guard` block), using the two helpers
just added — no local re-definition inside this block:

```ts
describe("evaluateRelease — Control Gate (RELEASE_BLOCKING_CONTROLS)", () => {
  const BLOCKING_CONTROL = "IAM-AUTH-005"; // one representative member of RELEASE_BLOCKING_CONTROLS

  it("a release-blocking control with status FAIL -> blocked, listed in blockingControlFailures", () => {
    const result = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride(BLOCKING_CONTROL, "FAIL") }));
    expect(result.result).toBe("blocked");
    expect(result.blockingControlFailures).toEqual([BLOCKING_CONTROL]);
    expect(result.blockingControlsNotVerified).toEqual([]);
  });

  it("a release-blocking control with status PARTIAL -> indeterminate, listed in blockingControlsNotVerified", () => {
    const result = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride(BLOCKING_CONTROL, "PARTIAL") }));
    expect(result.result).toBe("indeterminate");
    expect(result.blockingControlsNotVerified).toEqual([BLOCKING_CONTROL]);
    expect(result.blockingControlFailures).toEqual([]);
  });

  it("a release-blocking control with status NOT_TESTED -> indeterminate, listed in blockingControlsNotVerified", () => {
    const result = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride(BLOCKING_CONTROL, "NOT_TESTED") }));
    expect(result.result).toBe("indeterminate");
    expect(result.blockingControlsNotVerified).toEqual([BLOCKING_CONTROL]);
  });

  it("a release-blocking control absent from the assessments array entirely -> indeterminate, listed in blockingControlsNotVerified", () => {
    const assessments = assessmentsWithOneOverride(BLOCKING_CONTROL, "PASS").filter(
      (a) => a.controlId !== BLOCKING_CONTROL
    );
    const result = evaluateRelease(baseInputs({ assessments }));
    expect(result.result).toBe("indeterminate");
    expect(result.blockingControlsNotVerified).toEqual([BLOCKING_CONTROL]);
  });

  it("a release-blocking control with status PASS -> no contribution, approved", () => {
    const result = evaluateRelease(baseInputs({ assessments: allBlockingControlsPass() }));
    expect(result.result).toBe("approved");
    expect(result.blockingControlFailures).toEqual([]);
    expect(result.blockingControlsNotVerified).toEqual([]);
  });

  it("a release-blocking control with status N/A -> no contribution, approved", () => {
    const result = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride(BLOCKING_CONTROL, "N/A") }));
    expect(result.result).toBe("approved");
  });

  it("a release-blocking control with status ACCEPTED_RISK -> no contribution, approved", () => {
    const result = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride(BLOCKING_CONTROL, "ACCEPTED_RISK") }));
    expect(result.result).toBe("approved");
  });

  it("every member of RELEASE_BLOCKING_CONTROLS independently blocks on FAIL, not just the first", () => {
    for (const controlId of RELEASE_BLOCKING_CONTROLS) {
      const result = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride(controlId, "FAIL") }));
      expect(result.result, `expected ${controlId} FAIL to block`).toBe("blocked");
      expect(result.blockingControlFailures, `expected ${controlId} in blockingControlFailures`).toEqual([controlId]);
    }
  });

  it("a non-blocking control's FAIL does not affect result via the Control Gate", () => {
    const assessments: ControlAssessmentInput[] = [
      ...allBlockingControlsPass(),
      { controlId: "DEVOPS-CI-002", status: "FAIL" },
    ];
    const result = evaluateRelease(baseInputs({ assessments }));
    expect(result.result).toBe("approved");
    expect(result.blockingControlFailures).toEqual([]);
  });

  it("a control_gap finding on a release-blocking control blocks exactly once via the Control Gate, not double-counted by the Finding Gate", () => {
    const findings: FindingInput[] = [
      { findingId: "F-1", controlIds: [BLOCKING_CONTROL], status: "open", severity: "high", type: "control_gap" },
    ];
    const result = evaluateRelease(
      baseInputs({ findings, assessments: assessmentsWithOneOverride(BLOCKING_CONTROL, "FAIL") })
    );
    expect(result.result).toBe("blocked");
    expect(result.blockingControlFailures).toEqual([BLOCKING_CONTROL]);
    expect(result.criticalFindings).toBe(0);
    expect(result.highFindings).toBe(0); // the control_gap finding never reaches the Finding Gate's counters
  });

  it("blockingControlFailures and blockingControlsNotVerified never share a controlId", () => {
    // Every member of RELEASE_BLOCKING_CONTROLS at a different status, covering
    // the full status space in one assessments array — if the Control Gate ever
    // double-bucketed one controlId into both arrays, this would catch it.
    const statuses: ControlAssessmentInput["status"][] = [
      "FAIL", "PARTIAL", "NOT_TESTED", "PASS", "N/A", "ACCEPTED_RISK", "FAIL", "PARTIAL",
    ];
    const controlIds = [...RELEASE_BLOCKING_CONTROLS];
    const assessments: ControlAssessmentInput[] = controlIds.map((controlId, i) => ({
      controlId,
      status: statuses[i],
    }));
    const result = evaluateRelease(baseInputs({ assessments }));
    const overlap = result.blockingControlFailures.filter((id) => result.blockingControlsNotVerified.includes(id));
    expect(overlap).toEqual([]);
  });
});

describe("evaluateRelease — gate precedence (worst-wins across Finding/Control/Coverage Gates)", () => {
  it("Finding Gate blocked + Control Gate indeterminate + Coverage Gate indeterminate -> blocked", () => {
    const findings: FindingInput[] = [
      { findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "confirmed_vulnerability" },
    ];
    const belowThreshold: ScoreInput = { coverage: { coveragePercent: 10 } };
    const assessments = assessmentsWithOneOverride(BLOCKING_CONTROL_FOR_PRECEDENCE, "PARTIAL");
    const result = evaluateRelease(baseInputs({ findings, score: belowThreshold, assessments }));
    expect(result.result).toBe("blocked");
  });

  it("Finding Gate clear + Control Gate indeterminate + Coverage Gate clear -> indeterminate", () => {
    const result = evaluateRelease(
      baseInputs({ assessments: assessmentsWithOneOverride(BLOCKING_CONTROL_FOR_PRECEDENCE, "NOT_TESTED") })
    );
    expect(result.result).toBe("indeterminate");
  });

  it("Finding Gate clear + Control Gate clear + Coverage Gate indeterminate -> indeterminate", () => {
    const belowThreshold: ScoreInput = { coverage: { coveragePercent: 10 } };
    const result = evaluateRelease(baseInputs({ score: belowThreshold, assessments: allBlockingControlsPass() }));
    expect(result.result).toBe("indeterminate");
  });

  it("all three gates clear -> approved", () => {
    const result = evaluateRelease(baseInputs({ assessments: allBlockingControlsPass() }));
    expect(result.result).toBe("approved");
  });
});
```

`BLOCKING_CONTROL_FOR_PRECEDENCE` is the same kind of representative constant
as `BLOCKING_CONTROL` in the Control Gate block above — add it as a second
module-level `const BLOCKING_CONTROL_FOR_PRECEDENCE = "GOV-IR-001";` (a
different control than `BLOCKING_CONTROL` purely so the two test blocks don't
read as coincidentally testing the same one control; the Control Gate's
behavior doesn't depend on which of the 8 is used).

- [ ] **Step 2: Run the tests to verify the new ones fail and the fixed existing ones still pass**

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: the whole file fails to even compile/run yet — `RELEASE_BLOCKING_CONTROLS` is not exported from `src/core/release-evaluator.ts`, so every test in the file errors, not just the new ones. This is expected at this point (the import added in this step references a symbol that doesn't exist until Step 3). Confirm the failure is specifically about the missing export (a TypeScript/module-resolution error), not an assertion failure inside one of the six fixed existing tests — if one of those six fails with an assertion error instead of a module error, its `assessments` fix from this step has a mistake; find and fix it before moving on.

- [ ] **Step 3: Implement `RELEASE_BLOCKING_CONTROLS` and the Control Gate**

In `src/core/release-evaluator.ts`, add the constant right after `RELEASE_GATE_CONTROL_MAP`:

```ts
// Controls whose complete absence breaks a basic security/safety assumption on its
// own, regardless of what Finding.type an agent attached to the gap — see
// docs/superpowers/specs/2026-10-05-release-blocking-controls-design.md §4 for the
// inclusion test and per-control rationale. Deliberately small: most FAIL controls
// affect score/coverage but should not unconditionally block release.
export const RELEASE_BLOCKING_CONTROLS: ReadonlySet<string> = new Set([
  "IAM-AUTH-003",
  "IAM-AUTH-005",
  "IAM-AUTHZ-001",
  "IAM-AUTHZ-002",
  "DATA-ENC-002",
  "DATA-KEYSEP-001",
  "OPS-BACKUP-TEST-001",
  "GOV-IR-001",
]);
```

Add the two new fields to the `ReleaseEvaluation` interface, immediately before `result`:

```ts
export interface ReleaseEvaluation {
  gate: 4;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  blockingControlFailures: string[];
  blockingControlsNotVerified: string[];
  result: "approved" | "blocked" | "indeterminate";
}
```

Inside `evaluateRelease`, after the existing `assessmentByControl` map is built (right after the `incidentResponseVerified`/`backupRestoreVerified` lines, before `uncoveredHigh`), compute the Control Gate:

```ts
  // Known, documented limitation (see spec §7): an ACCEPTED_RISK status here is
  // trusted at face value — nothing in this codebase validates that a real,
  // in-scope, unexpired RiskAcceptance backs it. Treating ACCEPTED_RISK as
  // "no contribution" for a release-blocking control is therefore a real
  // bypass path, not just a theoretical one. Also known: this reads whatever
  // status is currently stored with no check that it was assessed against the
  // project's CURRENT profile (ControlAssessment has no profileRevision field) —
  // a stale PASS from before a profile change is trusted the same as a fresh one.
  // Both are pre-existing properties of the assessment model this Control Gate
  // builds on, not introduced here — fixing either needs its own design pass.
  const blockingControlFailures: string[] = [];
  const blockingControlsNotVerified: string[] = [];
  for (const controlId of RELEASE_BLOCKING_CONTROLS) {
    const status = assessmentByControl.get(controlId);
    if (status === "FAIL") {
      blockingControlFailures.push(controlId);
    } else if (status === "PARTIAL" || status === "NOT_TESTED" || status === undefined) {
      blockingControlsNotVerified.push(controlId);
    }
    // PASS, N/A, ACCEPTED_RISK: no contribution.
  }
  blockingControlFailures.sort();
  blockingControlsNotVerified.sort();
```

The trailing `.sort()` calls keep the two arrays' order deterministic —
`RELEASE_BLOCKING_CONTROLS` is a `Set`, and relying on its iteration order
(insertion order, in practice, but not a guarantee worth depending on) for
test/snapshot output would be fragile.

Replace the existing `result` computation:

```ts
  const findingThresholdsPass = criticalFindings === 0 && highFindingsSatisfied;
  const result: "approved" | "blocked" | "indeterminate" = !findingThresholdsPass
    ? "blocked"
    : score.coverage.coveragePercent < MIN_COVERAGE_FOR_APPROVAL_PERCENT
      ? "indeterminate"
      : "approved";
```

with:

```ts
  const findingThresholdsPass = criticalFindings === 0 && highFindingsSatisfied;
  const controlGatePass = blockingControlFailures.length === 0;
  const coverageOk = score.coverage.coveragePercent >= MIN_COVERAGE_FOR_APPROVAL_PERCENT;

  const result: "approved" | "blocked" | "indeterminate" =
    !findingThresholdsPass || !controlGatePass
      ? "blocked"
      : !coverageOk || blockingControlsNotVerified.length > 0
        ? "indeterminate"
        : "approved";
```

And add the two new fields to the returned object, immediately before `result`:

```ts
  return {
    gate: 4,
    controlCoverage: score.coverage.coveragePercent,
    criticalFindings,
    highFindings,
    unblockedCriticalAttackPaths,
    residualRisksAccepted,
    incidentResponseVerified,
    backupRestoreVerified,
    blockingControlFailures,
    blockingControlsNotVerified,
    result,
  };
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: PASS, all tests in the file including the new `Control Gate` describe block.

- [ ] **Step 5: Write the failing drift guard test**

Add this new `describe` block at the very end of `tests/core/release-evaluator.test.ts` (after the `Control Gate` block added in Step 1), mirroring the existing `RELEASE_GATE_CONTROL_MAP drift guard` block exactly:

```ts
describe("evaluateRelease — RELEASE_BLOCKING_CONTROLS drift guard", () => {
  it("every listed controlId exists in the real catalog and is not replacedBy-superseded", () => {
    const manifest = loadJson<{ controls: { files: string[] } }>("data/manifest.json");
    const allControls = manifest.controls.files.flatMap((f) =>
      loadJson<{ controlId: string; status: string; replacedBy?: string }[]>(`data/${f}`)
    );
    const byId = new Map(allControls.map((c) => [c.controlId, c]));

    for (const controlId of RELEASE_BLOCKING_CONTROLS) {
      const control = byId.get(controlId);
      expect(control, `RELEASE_BLOCKING_CONTROLS references unknown controlId "${controlId}"`).toBeDefined();
      expect(control?.replacedBy, `RELEASE_BLOCKING_CONTROLS' "${controlId}" has been superseded by "${control?.replacedBy}"`).toBeUndefined();
      expect(["draft", "active"]).toContain(control?.status);
    }
  });
});
```

This test file already imports `loadJson` from `../../src/validate.js` (used by the existing `RELEASE_GATE_CONTROL_MAP drift guard` block) — no new import needed.

- [ ] **Step 6: Run to verify it fails only if the list is wrong, then passes**

Run: `npx vitest run tests/core/release-evaluator.test.ts -t "drift guard"`
Expected: PASS immediately — this test proves a property of the real catalog against the list written in Step 3, both already correct. (If it fails, the list in Step 3 has a typo or references a deprecated/retired control — fix the list, not the test.)

- [ ] **Step 7: Write the failing metamorphic regression test**

Add this `describe` block, also at the end of `tests/core/release-evaluator.test.ts`:

As in Step 1, the baseline must set all 8 `RELEASE_BLOCKING_CONTROLS` members
to `PASS` explicitly — `baseInputs()`'s default `assessments: []` would leave
every one of them "absent," which makes the baseline itself `"indeterminate"`
(via `blockingControlsNotVerified`), not `"approved"` — and this test needs a
genuinely `"approved"` baseline to prove the flip changes anything. Reuses
`allBlockingControlsPass()` and `assessmentsWithOneOverride()`, both added at
module level in Step 1 — no local re-definition.

```ts
describe("evaluateRelease — metamorphic regression: a blocking control's FAIL must actually change result", () => {
  it("flipping only GOV-IR-001 to FAIL on an otherwise-approved input changes result to blocked", () => {
    const baseline = evaluateRelease(baseInputs({ assessments: allBlockingControlsPass() }));
    expect(baseline.result).toBe("approved"); // sanity: confirm the baseline really is approved first

    const flipped = evaluateRelease(baseInputs({ assessments: assessmentsWithOneOverride("GOV-IR-001", "FAIL") }));
    expect(flipped.result).toBe("blocked");
  });

  it("flipping only OPS-BACKUP-TEST-001 to FAIL on an otherwise-approved input changes result to blocked", () => {
    const baseline = evaluateRelease(baseInputs({ assessments: allBlockingControlsPass() }));
    expect(baseline.result).toBe("approved");

    const flipped = evaluateRelease(
      baseInputs({ assessments: assessmentsWithOneOverride("OPS-BACKUP-TEST-001", "FAIL") })
    );
    expect(flipped.result).toBe("blocked");
  });
});
```

This is the direct regression test for the bug that motivated this plan: before this plan, `incidentResponseVerified`/`backupRestoreVerified` were computed from these same two controlIds but never read when computing `result` — a hand-built "should be blocked" fixture could still pass even with that bug present, because nobody had written a before/after flip on an otherwise-fixed input. This test would have failed against the pre-this-plan code (both flips would have left `result` at `"approved"`).

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/core/release-evaluator.test.ts -t "metamorphic"`
Expected: PASS (the Control Gate implementation from Step 3 already covers this — this step is confirming the regression test itself is correctly written and genuinely exercises the fix).

- [ ] **Step 9: Run the full release-evaluator test file**

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: PASS, all tests (original + every block added in this task).

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: Errors in `src/core/report-builder.ts` consumers and test fixture files that construct a `ReleaseEvaluation`/`ReleaseEvaluationForReport` literal without the two new fields — this is expected and is exactly what Task 2 fixes. Confirm the errors are ONLY in those already-known locations (`src/core/report-builder.ts`, `tests/core/report-builder.test.ts`, `tests/core/repository.test.ts`, `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`, `tests/schemas/project-report-schema.test.ts`) and nowhere else in `src/service/*.ts` or `src/mcp/tools/*.ts` (those pass the object through without reconstructing it, so they should show no error). If an error appears anywhere outside this known list, stop and investigate before continuing — it means some file manually reconstructs `ReleaseEvaluation` that this plan didn't account for.

- [ ] **Step 11: Commit**

```bash
git add src/core/release-evaluator.ts tests/core/release-evaluator.test.ts
git commit -m "feat(core): add Control Gate — release-blocking controls to evaluateRelease

Introduces RELEASE_BLOCKING_CONTROLS (8 controls) and a Control Gate
that blocks release on FAIL regardless of Finding.type, fixing the
case where a control_gap finding on a genuinely critical control
(e.g. admin MFA) could never block release. Also fixes the
pre-existing dead-calculation bug where incidentResponseVerified/
backupRestoreVerified were computed but never consulted — GOV-IR-001
and OPS-BACKUP-TEST-001 are both in the new blocking set.

See docs/superpowers/specs/2026-10-05-release-blocking-controls-design.md"
```

---

### Task 2: Propagate the new fields through the report layer, schemas, and fixtures

**Files:**
- Modify: `src/core/report-builder.ts`
- Modify: `data/schemas/release-evaluation-schema.json`
- Modify: `data/schemas/project-report-schema.json`
- Modify: `tests/core/report-builder.test.ts`
- Modify: `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`
- Modify: `tests/schemas/project-report-schema.test.ts`
- Modify: `tests/core/repository.test.ts`

**Interfaces:**
- Consumes: `ReleaseEvaluation` from Task 1 (`src/core/release-evaluator.ts`), specifically the two new fields `blockingControlFailures: string[]` and `blockingControlsNotVerified: string[]`.
- Produces: `ReleaseEvaluationForReport` (in `src/core/report-builder.ts`) widened to match — every later consumer of a `ProjectReport` (there are none left to change in this codebase; `src/service/report-service.ts` and `src/mcp/tools/generate-report.ts` both pass the object straight through without reconstructing it) sees the two new fields automatically.

- [ ] **Step 1: Widen `ReleaseEvaluationForReport` in `report-builder.ts`**

In `src/core/report-builder.ts`, change:

```ts
export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  result: "approved" | "blocked" | "indeterminate";
}
```

to:

```ts
export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  blockingControlFailures: string[];
  blockingControlsNotVerified: string[];
  result: "approved" | "blocked" | "indeterminate";
}
```

`buildReport`'s body does no field-by-field construction of `releaseEvaluation` — it assigns `input.releaseEvaluation` straight to `ProjectReport.releaseEvaluation` (see the existing `return { ..., releaseEvaluation: input.releaseEvaluation, ... }` in the current file). No other change needed in this file.

- [ ] **Step 2: Add the two new properties to `release-evaluation-schema.json`**

In `data/schemas/release-evaluation-schema.json`, add two entries to `properties` (after `backupRestoreVerified`, before `result`):

```json
    "blockingControlFailures": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "blockingControlsNotVerified": { "type": "array", "items": { "type": "string", "minLength": 1 } },
```

and add both names to the `required` array (after `"backupRestoreVerified"`, before `"result"`):

```json
  "required": [
    "projectId", "gate", "controlCoverage", "criticalFindings", "highFindings",
    "unblockedCriticalAttackPaths", "residualRisksAccepted",
    "incidentResponseVerified", "backupRestoreVerified",
    "blockingControlFailures", "blockingControlsNotVerified",
    "result", "evaluatedAt"
  ],
```

- [ ] **Step 3: Add the same two properties to `project-report-schema.json`'s nested `releaseEvaluation`**

In `data/schemas/project-report-schema.json`, inside the `releaseEvaluation` object's `properties` (after `backupRestoreVerified`, before `result`):

```json
        "blockingControlFailures": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "blockingControlsNotVerified": { "type": "array", "items": { "type": "string", "minLength": 1 } },
```

and its `required` array (after `"backupRestoreVerified"`, before `"result"`):

```json
      "required": ["gate", "controlCoverage", "criticalFindings", "highFindings", "unblockedCriticalAttackPaths", "residualRisksAccepted", "incidentResponseVerified", "backupRestoreVerified", "blockingControlFailures", "blockingControlsNotVerified", "result"],
```

- [ ] **Step 4: Fix the `tests/core/report-builder.test.ts` fixture**

Change the module-level fixture:

```ts
const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, criticalFindings: 0, highFindings: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true, result: "approved",
};
```

to:

```ts
const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, criticalFindings: 0, highFindings: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true,
  blockingControlFailures: [], blockingControlsNotVerified: [],
  result: "approved",
};
```

- [ ] **Step 5: Fix the `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts` fixture**

Change the `valid` object in the `describe("release-evaluation-schema", ...)` block:

```ts
  const valid = {
    projectId: "proj-001",
    gate: 4,
    controlCoverage: 97,
    criticalFindings: 0,
    highFindings: 0,
    unblockedCriticalAttackPaths: 0,
    residualRisksAccepted: 3,
    incidentResponseVerified: true,
    backupRestoreVerified: true,
    result: "approved",
    evaluatedAt: "2026-09-16T05:00:00Z",
  };
```

to:

```ts
  const valid = {
    projectId: "proj-001",
    gate: 4,
    controlCoverage: 97,
    criticalFindings: 0,
    highFindings: 0,
    unblockedCriticalAttackPaths: 0,
    residualRisksAccepted: 3,
    incidentResponseVerified: true,
    backupRestoreVerified: true,
    blockingControlFailures: [],
    blockingControlsNotVerified: [],
    result: "approved",
    evaluatedAt: "2026-09-16T05:00:00Z",
  };
```

- [ ] **Step 6: Fix the `tests/schemas/project-report-schema.test.ts` fixture**

Change the `releaseEvaluation` field inside that file's `valid` report fixture:

```ts
    releaseEvaluation: {
      gate: 4,
      controlCoverage: 91.67,
      criticalFindings: 1,
      highFindings: 2,
      unblockedCriticalAttackPaths: 0,
      residualRisksAccepted: 0,
      incidentResponseVerified: true,
      backupRestoreVerified: true,
      result: "blocked",
    },
```

to:

```ts
    releaseEvaluation: {
      gate: 4,
      controlCoverage: 91.67,
      criticalFindings: 1,
      highFindings: 2,
      unblockedCriticalAttackPaths: 0,
      residualRisksAccepted: 0,
      incidentResponseVerified: true,
      backupRestoreVerified: true,
      blockingControlFailures: ["IAM-AUTH-005"],
      blockingControlsNotVerified: [],
      result: "blocked",
    },
```

(Using a real controlId from `RELEASE_BLOCKING_CONTROLS` here rather than an empty array keeps this fixture a genuine example of a blocked report, consistent with its own `result: "blocked"`.)

- [ ] **Step 7: Fix the `tests/core/repository.test.ts` fixture**

Find the inline `releaseEvaluation` object (currently `{ gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, result: "approved" as const }`) and add the two new fields immediately before `result`:

```ts
      prioritizedFindings: [], releaseEvaluation: { gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" as const },
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 9: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, every test file (this includes `tests/integration/full-workflow.test.ts`, which exercises the real `generate_report` tool end-to-end and validates the result against `project-report-schema.json` — the schema change in Step 3 is what keeps that test passing once the real `releaseEvaluation` object genuinely contains the two new fields).

- [ ] **Step 10: Build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 11: Commit**

```bash
git add src/core/report-builder.ts data/schemas/release-evaluation-schema.json data/schemas/project-report-schema.json tests/core/report-builder.test.ts tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts tests/schemas/project-report-schema.test.ts tests/core/repository.test.ts
git commit -m "feat(core,schemas): propagate blockingControlFailures/blockingControlsNotVerified through report layer

Widens ReleaseEvaluationForReport and both JSON schemas
(release-evaluation-schema.json, project-report-schema.json's nested
releaseEvaluation) to require the two new fields Task 1 added to
ReleaseEvaluation, and updates every existing test fixture that
constructs one of these objects literally. No logic change —
report-builder.ts passes releaseEvaluation through unchanged, as it
already did."
```

---

## Self-Review Notes (for whoever runs this plan)

- **Spec coverage:** §3 (three-gate architecture) → Task 1 Step 3. §4 (`RELEASE_BLOCKING_CONTROLS` list + inclusion test) → Task 1 Step 3's constant, with per-control rationale left in the spec (not repeated in code comments beyond a pointer). §5 (interface changes) → Task 1 Step 3 (`ReleaseEvaluation`) + Task 2 Step 1 (`ReleaseEvaluationForReport`) + Task 2 Steps 2-3 (schemas). §6 (all four test categories) → Task 1 Steps 1, 5, 7 and the no-double-counting test folded into Step 1's block. §7 (out of scope) → nothing in this plan touches `data/process/release-gates.json`, `IAM-AUTHZ-003/004/005`, `DEVOPS-ARTIFACT-001`, the Finding Gate's `likely_vulnerability` handling, or any already-persisted project data under `data/projects/` — confirmed by the file list in both tasks above.
- **Known transient state between tasks:** after Task 1 alone, `npx tsc --noEmit` will show errors in `report-builder.ts` and several test fixtures (Task 1 Step 10 says this explicitly and tells the implementer what "expected" looks like) — this is intentional sequencing, not a mistake to fix early. Task 2 is what makes the whole repo clean again.
- **A real bug was caught during this plan's own self-review, not left for the implementer to discover:** `RELEASE_BLOCKING_CONTROLS` has 8 members, and `baseInputs()`'s default `assessments: []` leaves all 8 "absent," which the Control Gate treats as `"indeterminate"` — so six existing tests in `tests/core/release-evaluator.test.ts` that assert `.result === "approved"` using the default empty `assessments` would silently start failing once Task 1 Step 3 ships, with no task in an earlier draft of this plan accounting for it. Task 1 Step 1 now fixes all six as part of writing the new tests (safe to do before implementation — the extra `assessments` entries don't change pre-implementation behavior, since old code doesn't consult them for this purpose). If you find a seventh pre-existing test asserting `"approved"` that this plan missed, apply the same fix (add `assessments: allBlockingControlsPass()`) rather than skipping it.
- **Nothing in `src/service/analysis-service.ts`, `src/service/report-service.ts`, `src/mcp/tools/evaluate-release.ts`, or `src/mcp/tools/generate-report.ts` needs modification** — all four were read in full before writing this plan; each either calls `evaluateRelease`/`buildReport` and returns/forwards the result directly, or spreads the whole object into `structuredContent` without reconstructing individual fields. If a plan executor finds a reason to touch any of these four files, stop and re-check against the real current source — this plan's authors verified they don't need it as of commit `496811f`.
- **Two known, pre-existing structural gaps were found during a second external review round, after this plan was first drafted, and are deliberately NOT fixed by this plan** — see spec §7 for the full writeup: (1) `ACCEPTED_RISK` on a release-blocking control is trusted with no validation that a real `RiskAcceptance` backs it (a real bypass path, not introduced by this plan but made more consequential by it); (2) `ControlAssessment` has no `profileRevision` field, so a stale assessment from before a profile change is trusted the same as a fresh one. Task 1 Step 3's code now carries a comment documenting both at the point where the Control Gate reads `assessmentByControl`. Do not attempt to fix either as part of this plan — both need their own design pass and would violate the Global Constraint against touching `src/service/*.ts`.
- **The same review round added three small items to Task 1 Step 1's test block** beyond what was in the first draft: the `.sort()` calls on both output arrays (determinism), a no-overlap invariant test, and a dedicated "gate precedence" `describe` block exercising all four meaningful combinations of the three gates' outcomes. None of these change the Step 3 implementation's actual logic — they're additional proof, not additional behavior.
