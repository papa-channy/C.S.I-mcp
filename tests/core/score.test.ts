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

describe("calculateScore — domainScores", () => {
  const twoDomainControls: ControlDomainInput[] = [
    { controlId: "A-001", domain: "appsec" },
    { controlId: "A-002", domain: "appsec" },
    { controlId: "B-001", domain: "infra" },
  ];

  it("a domain with zero non-excluded controls is omitted from domainScores entirely, not scored 100 or 0", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "B-001", status: "N/A" }, // infra's only control is excluded -> zero-denominator domain
    ];
    const result = calculateScore(assessments, twoDomainControls, [], model);
    expect(result.domainScores.map((d) => d.domain)).toEqual(["appsec"]);
    expect(result.overallScore).toBe(100); // unaffected by infra's exclusion since it's excluded project-wide too
  });

  it("domainScores are sorted by domain name ascending", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "B-001", status: "PASS" },
    ];
    const reordered: ControlDomainInput[] = [twoDomainControls[2], twoDomainControls[0], twoDomainControls[1]];
    const result = calculateScore(assessments, reordered, [], model);
    expect(result.domainScores.map((d) => d.domain)).toEqual(["appsec", "infra"]);
  });

  it("DomainScore reports every per-status count and coverage field, not just domain/criticalSeverityFindings/highSeverityFindings", () => {
    // One domain, 7 controls: 2 PASS, 1 FAIL, 1 PARTIAL, 1 NOT_TESTED, 1 N/A, 1 ACCEPTED_RISK.
    const sevenControls: ControlDomainInput[] = Array.from({ length: 7 }, (_, i) => ({ controlId: `S-00${i + 1}`, domain: "appsec" }));
    const assessments: ControlAssessmentInput[] = [
      { controlId: "S-001", status: "PASS" },
      { controlId: "S-002", status: "PASS" },
      { controlId: "S-003", status: "FAIL" },
      { controlId: "S-004", status: "PARTIAL" },
      { controlId: "S-005", status: "NOT_TESTED" },
      { controlId: "S-006", status: "N/A" },
      { controlId: "S-007", status: "ACCEPTED_RISK" },
    ];
    const result = calculateScore(assessments, sevenControls, [], model);
    const appsec = result.domainScores.find((d) => d.domain === "appsec")!;

    // non-excluded (not N/A/ACCEPTED_RISK): PASS, PASS, FAIL, PARTIAL, NOT_TESTED = 5 controls
    // weighted sum = 1.0 + 1.0 + 0 + 0.5 + 0 = 2.5 -> score = 100 * 2.5 / 5 = 50
    expect(appsec.score).toBe(50);
    expect(appsec.totalControls).toBe(7);
    expect(appsec.applicableControls).toBe(5);
    expect(appsec.assessedControls).toBe(4); // applicable minus NOT_TESTED
    expect(appsec.coveragePercent).toBeCloseTo((4 / 5) * 100);
    expect(appsec.passCount).toBe(2);
    expect(appsec.failCount).toBe(1);
    expect(appsec.partialCount).toBe(1);
    expect(appsec.notTestedCount).toBe(1);
    expect(appsec.notApplicableCount).toBe(1);
    expect(appsec.acceptedRiskCount).toBe(1);
  });

  it("counts an open critical finding against the domain of any control it references", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "B-001", status: "PASS" },
    ];
    const findings: FindingInput[] = [
      { controlIds: ["A-001"], severity: "critical", status: "open" },
      { controlIds: ["B-001"], severity: "high", status: "resolved" }, // resolved: not counted
    ];
    const result = calculateScore(assessments, twoDomainControls, findings, model);
    const appsec = result.domainScores.find((d) => d.domain === "appsec")!;
    const infra = result.domainScores.find((d) => d.domain === "infra")!;
    expect(appsec.criticalSeverityFindings).toBe(1);
    expect(infra.highSeverityFindings).toBe(0);
  });

  it("criticalSeverityFindings counts an active hardening-type finding at severity critical — it is not limited to confirmed_vulnerability", () => {
    const assessments: ControlAssessmentInput[] = [{ controlId: "A-001", status: "PASS" }];
    const findings: FindingInput[] = [
      { controlIds: ["A-001"], severity: "critical", status: "open" },
    ];
    const result = calculateScore(assessments, [controls[0]], findings, model);
    const appsec = result.domainScores.find((d) => d.domain === "appsec")!;
    expect(appsec.criticalSeverityFindings).toBe(1);
  });
});
