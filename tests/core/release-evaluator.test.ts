import { describe, expect, it } from "vitest";
import {
  evaluateRelease,
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
    expect(evaluateRelease(baseInputs()).result).toBe("approved");
  });

  it("SVL-3, one open critical finding -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical" }];
    const result = evaluateRelease(baseInputs({ findings }));
    expect(result.criticalFindings).toBe(1);
    expect(result.result).toBe("blocked");
  });

  it("a resolved critical finding does not count toward criticalFindings or block the release", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "resolved", severity: "critical" }];
    const result = evaluateRelease(baseInputs({ findings }));
    expect(result.criticalFindings).toBe(0);
    expect(result.result).toBe("approved");
  });

  it("SVL-3, one open high finding -> blocked, even with an accepted-risk assessment on its control (no exception at SVL-3)", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }];
    expect(evaluateRelease(baseInputs({ findings, assessments })).result).toBe("blocked");
  });

  it("SVL-2, one open high finding uncovered by any accepted risk -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high" }];
    expect(evaluateRelease(baseInputs({ findings, securityLevel: "SVL-2" })).result).toBe("blocked");
  });

  it("SVL-2, one open high finding whose only control has an ACCEPTED_RISK assessment -> approved (the exception)", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }];
    const result = evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" }));
    expect(result.highFindings).toBe(1); // the raw count is unaffected by the exception
    expect(result.result).toBe("approved");
  });

  it("SVL-2, a high finding with two controlIds where only one has ACCEPTED_RISK is NOT covered -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001", "X-002"], status: "open", severity: "high" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }, { controlId: "X-002", status: "FAIL" }];
    expect(evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" })).result).toBe("blocked");
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
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical" }];
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

describe("evaluateRelease — controlCoverage", () => {
  it("passes through score.coverage.coveragePercent without recomputation", () => {
    expect(evaluateRelease(baseInputs()).controlCoverage).toBe(92);
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
