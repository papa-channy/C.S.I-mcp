import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("score-schema", () => {
  const validDomainScore = {
    domain: "authentication",
    score: 87,
    totalControls: 21,
    applicableControls: 16,
    assessedControls: 14,
    coveragePercent: 87.5,
    passCount: 11,
    failCount: 2,
    partialCount: 1,
    notTestedCount: 2,
    notApplicableCount: 4,
    acceptedRiskCount: 1,
    criticalSeverityFindings: 0,
    highSeverityFindings: 1,
  };

  const valid = {
    projectId: "PRJ-001",
    overallScore: 82,
    coverage: {
      applicableControls: 120,
      assessedControls: 110,
      coveragePercent: 91.67,
    },
    scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
    domainScores: [validDomainScore],
    computedAt: "2026-09-19T05:00:00Z",
  };

  it("accepts a well-formed score", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a score missing coverage", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    const { coverage, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a domainScores entry missing notTestedCount", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    const { notTestedCount, ...restDomainScore } = validDomainScore;
    expect(validate({ ...valid, domainScores: [restDomainScore] })).toBe(false);
  });

  it("rejects an overallScore above 100", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    expect(validate({ ...valid, overallScore: 101 })).toBe(false);
  });
});
