import { describe, expect, it } from "vitest";
import { calculateScore, type ControlAssessmentInput, type ControlDomainInput, type FindingInput, type ScoreModel } from "../../src/core/score.js";

const model: ScoreModel = {
  modelId: "USSVS-SCORE-DEFAULT",
  version: "1.0.0",
  statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
  excludedStatuses: ["N/A", "ACCEPTED_RISK"],
};

const controls: ControlDomainInput[] = [
  { controlId: "A-001", domain: "appsec" },
  { controlId: "A-002", domain: "appsec" },
  { controlId: "A-003", domain: "appsec" },
  { controlId: "A-004", domain: "appsec" },
];

describe("calculateScore — overall formula", () => {
  it("2 PASS + 1 FAIL + 1 NOT_TESTED = 100 * 2 / 4 = 50", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "A-003", status: "FAIL" },
      { controlId: "A-004", status: "NOT_TESTED" },
    ];
    expect(calculateScore(assessments, controls, [], model).overallScore).toBe(50);
  });

  it("all-NOT_TESTED must not read as 100% — it reads as 0", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "NOT_TESTED" },
      { controlId: "A-002", status: "NOT_TESTED" },
      { controlId: "A-003", status: "NOT_TESTED" },
    ];
    const threeControls = controls.slice(0, 3);
    expect(calculateScore(assessments, threeControls, [], model).overallScore).toBe(0);
  });

  it("3 tested (PASS) + 7 NOT_TESTED does not read as near-100% — it reads as 30, not silently rounding up to full coverage's worth of confidence", () => {
    const tenControls: ControlDomainInput[] = Array.from({ length: 10 }, (_, i) => ({ controlId: `C-${i}`, domain: "d" }));
    const assessments: ControlAssessmentInput[] = tenControls.map((c, i) => ({
      controlId: c.controlId,
      status: i < 3 ? "PASS" : "NOT_TESTED",
    }));
    expect(calculateScore(assessments, tenControls, [], model).overallScore).toBe(30);
  });

  it("N/A and ACCEPTED_RISK are removed from both numerator and denominator entirely", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "FAIL" },
      { controlId: "A-003", status: "N/A" },
    ];
    // non-excluded: PASS + FAIL = 2 controls, sum weights = 1 -> 100*1/2 = 50 (A-003 counted nowhere)
    expect(calculateScore(assessments, controls.slice(0, 3), [], model).overallScore).toBe(50);
  });

  it("throws when every assessment is excluded (no non-excluded applicable control to score at all)", () => {
    const assessments: ControlAssessmentInput[] = [{ controlId: "A-001", status: "N/A" }];
    expect(() => calculateScore(assessments, controls.slice(0, 1), [], model)).toThrow();
  });

  it("coverage.coveragePercent excludes NOT_TESTED from assessedControls", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "FAIL" },
      { controlId: "A-003", status: "NOT_TESTED" },
      { controlId: "A-004", status: "N/A" },
    ];
    // applicableControls = 3 (A-001,A-002,A-003; A-004 excluded), assessedControls = 2 (A-001,A-002)
    const result = calculateScore(assessments, controls, [], model);
    expect(result.coverage.applicableControls).toBe(3);
    expect(result.coverage.assessedControls).toBe(2);
    expect(result.coverage.coveragePercent).toBeCloseTo((2 / 3) * 100);
  });
});
