import { describe, expect, it } from "vitest";
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
import { loadJson } from "../../src/validate.js";

const score: ScoreInput = { coverage: { coveragePercent: 92 } };

function baseInputs(overrides: Partial<Parameters<typeof evaluateRelease>[0]> = {}) {
  return {
    score,
    findings: [] as FindingInput[],
    attackPaths: [] as AttackPathInput[],
    assessments: [] as ControlAssessmentInput[],
    securityLevel: "SVL-3",
    ...overrides,
  };
}

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

describe("evaluateRelease — securityLevel precondition", () => {
  it("throws for SVL-0 (gate 4 has no defined threshold row for it)", () => {
    expect(() => evaluateRelease(baseInputs({ securityLevel: "SVL-0" }))).toThrow();
  });

  it("throws for SVL-1", () => {
    expect(() => evaluateRelease(baseInputs({ securityLevel: "SVL-1" }))).toThrow();
  });
});

describe("evaluateRelease — thresholds", () => {
  it("SVL-3, zero critical and zero high findings -> approved", () => {
    expect(evaluateRelease(baseInputs({ assessments: allBlockingControlsPass() })).result).toBe("approved");
  });

  it("SVL-3, one open critical finding -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "confirmed_vulnerability" }];
    const result = evaluateRelease(baseInputs({ findings }));
    expect(result.criticalFindings).toBe(1);
    expect(result.result).toBe("blocked");
  });

  it("a resolved critical finding does not count toward criticalFindings or block the release", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "resolved", severity: "critical", type: "confirmed_vulnerability" }];
    const result = evaluateRelease(baseInputs({ findings, assessments: allBlockingControlsPass() }));
    expect(result.criticalFindings).toBe(0);
    expect(result.result).toBe("approved");
  });

  it("SVL-3, one open high finding -> blocked, even with an accepted-risk assessment on its control (no exception at SVL-3)", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high", type: "confirmed_vulnerability" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }];
    expect(evaluateRelease(baseInputs({ findings, assessments })).result).toBe("blocked");
  });

  it("SVL-2, one open high finding uncovered by any accepted risk -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high", type: "confirmed_vulnerability" }];
    expect(evaluateRelease(baseInputs({ findings, securityLevel: "SVL-2" })).result).toBe("blocked");
  });

  it("SVL-2, one open high finding whose only control has an ACCEPTED_RISK assessment -> approved (the exception)", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high", type: "confirmed_vulnerability" }];
    const assessments: ControlAssessmentInput[] = [
      { controlId: "X-001", status: "ACCEPTED_RISK" },
      ...allBlockingControlsPass(),
    ];
    const result = evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" }));
    expect(result.highFindings).toBe(1); // the raw count is unaffected by the exception
    expect(result.result).toBe("approved");
  });

  it("SVL-2, a high finding with two controlIds where only one has ACCEPTED_RISK is NOT covered -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001", "X-002"], status: "open", severity: "high", type: "confirmed_vulnerability" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }, { controlId: "X-002", status: "FAIL" }];
    expect(evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" })).result).toBe("blocked");
  });
});

describe("evaluateRelease — type-based gating", () => {
  it("SVL-3, an open critical finding typed control_gap does not block the release", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "control_gap" }];
    const result = evaluateRelease(baseInputs({ findings, assessments: allBlockingControlsPass() }));
    expect(result.criticalFindings).toBe(0);
    expect(result.result).toBe("approved");
  });

  it("SVL-3, an open high finding typed hardening does not block the release", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high", type: "hardening" }];
    const result = evaluateRelease(baseInputs({ findings, assessments: allBlockingControlsPass() }));
    expect(result.highFindings).toBe(0);
    expect(result.result).toBe("approved");
  });

  it("a possible attack path related only to a non-confirmed_vulnerability critical finding is not counted as unblocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "process_gap" }];
    const attackPaths: AttackPathInput[] = [{ result: "possible", relatedFindingIds: ["F-1"] }];
    const result = evaluateRelease(baseInputs({ findings, attackPaths }));
    expect(result.unblockedCriticalAttackPaths).toBe(0);
  });

  it("mixed set: only the confirmed_vulnerability finding counts toward criticalFindings/highFindings", () => {
    const findings: FindingInput[] = [
      { findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "confirmed_vulnerability" },
      { findingId: "F-2", controlIds: ["X-002"], status: "open", severity: "high", type: "control_gap" },
      { findingId: "F-3", controlIds: ["X-003"], status: "open", severity: "high", type: "needs_validation" },
    ];
    const result = evaluateRelease(baseInputs({ findings }));
    expect(result.criticalFindings).toBe(1);
    expect(result.highFindings).toBe(0);
    expect(result.result).toBe("blocked");
  });
});

describe("evaluateRelease — incidentResponseVerified / backupRestoreVerified", () => {
  it("true only when the mapped control's assessment status is PASS", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: RELEASE_GATE_CONTROL_MAP.incidentResponseVerified, status: "PASS" },
      { controlId: RELEASE_GATE_CONTROL_MAP.backupRestoreVerified, status: "FAIL" },
    ];
    const result = evaluateRelease(baseInputs({ assessments }));
    expect(result.incidentResponseVerified).toBe(true);
    expect(result.backupRestoreVerified).toBe(false);
  });

  it("false when no assessment exists for the mapped control at all", () => {
    const result = evaluateRelease(baseInputs());
    expect(result.incidentResponseVerified).toBe(false);
    expect(result.backupRestoreVerified).toBe(false);
  });
});

describe("evaluateRelease — unblockedCriticalAttackPaths / residualRisksAccepted", () => {
  it("counts a possible attack path only when it relates to a critical finding", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "confirmed_vulnerability" }];
    const attackPaths: AttackPathInput[] = [
      { result: "possible", relatedFindingIds: ["F-1"] },
      { result: "blocked", relatedFindingIds: ["F-1"] },
      { result: "possible", relatedFindingIds: ["F-nonexistent"] },
    ];
    const result = evaluateRelease(baseInputs({ findings, attackPaths }));
    expect(result.unblockedCriticalAttackPaths).toBe(1);
  });

  it("counts ACCEPTED_RISK assessments as residualRisksAccepted", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "X-001", status: "ACCEPTED_RISK" },
      { controlId: "X-002", status: "ACCEPTED_RISK" },
      { controlId: "X-003", status: "PASS" },
    ];
    expect(evaluateRelease(baseInputs({ assessments })).residualRisksAccepted).toBe(2);
  });
});

describe("evaluateRelease — coverage threshold / indeterminate", () => {
  it("below MIN_COVERAGE_FOR_APPROVAL_PERCENT with zero findings -> indeterminate, not approved", () => {
    const belowThreshold: ScoreInput = { coverage: { coveragePercent: MIN_COVERAGE_FOR_APPROVAL_PERCENT - 1 } };
    const result = evaluateRelease(baseInputs({ score: belowThreshold }));
    expect(result.result).toBe("indeterminate");
  });

  it("at or above MIN_COVERAGE_FOR_APPROVAL_PERCENT with zero findings -> approved", () => {
    const atThreshold: ScoreInput = { coverage: { coveragePercent: MIN_COVERAGE_FOR_APPROVAL_PERCENT } };
    const result = evaluateRelease(baseInputs({ score: atThreshold, assessments: allBlockingControlsPass() }));
    expect(result.result).toBe("approved");
  });

  it("low coverage does not override an actual blocked verdict", () => {
    const belowThreshold: ScoreInput = { coverage: { coveragePercent: 10 } };
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical", type: "confirmed_vulnerability" }];
    const result = evaluateRelease(baseInputs({ score: belowThreshold, findings }));
    expect(result.result).toBe("blocked");
  });
});

describe("evaluateRelease — controlCoverage", () => {
  it("passes through score.coverage.coveragePercent without recomputation", () => {
    expect(evaluateRelease(baseInputs()).controlCoverage).toBe(92);
  });
});

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

describe("evaluateRelease — RELEASE_GATE_CONTROL_MAP drift guard", () => {
  it("both mapped controlIds exist in the real catalog and are not replacedBy-superseded", () => {
    const manifest = loadJson<{ controls: { files: string[] } }>("data/manifest.json");
    const allControls = manifest.controls.files.flatMap((f) =>
      loadJson<{ controlId: string; replacedBy?: string }[]>(`data/${f}`)
    );
    const byId = new Map(allControls.map((c) => [c.controlId, c]));

    for (const controlId of Object.values(RELEASE_GATE_CONTROL_MAP)) {
      const control = byId.get(controlId);
      expect(control, `RELEASE_GATE_CONTROL_MAP references unknown controlId "${controlId}"`).toBeDefined();
      expect(control?.replacedBy, `RELEASE_GATE_CONTROL_MAP's "${controlId}" has been superseded by "${control?.replacedBy}"`).toBeUndefined();
    }
  });
});

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
