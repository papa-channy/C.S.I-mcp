import { describe, expect, it } from "vitest";
import { calculateCriticality, type CriticalityFormula, type SeverityFactors } from "../../src/core/criticality.js";

const formula: CriticalityFormula = {
  formulaId: "CRIT-DEFAULT",
  version: "1.0.0",
  scaleMax: 9,
  directions: {
    impact: "higher_is_worse",
    exploitability: "higher_is_worse",
    exposure: "higher_is_worse",
    privilegeRequired: "lower_is_worse",
    detectionDifficulty: "higher_is_worse",
  },
  ranges: {
    impact: { min: 1, max: 5 },
    exploitability: { min: 1, max: 5 },
    exposure: { min: 1, max: 3 },
    privilegeRequired: { min: 0, max: 2 },
    detectionDifficulty: { min: 0, max: 2 },
  },
  weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.1 },
  rounding: "round",
};

const fixedNow = () => "2026-09-28T00:00:00.000Z";

describe("calculateCriticality", () => {
  it("all-minimum-severity factors (best case, including max privilegeRequired since lower_is_worse) produce index 0", () => {
    const factors: SeverityFactors = { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 };
    expect(calculateCriticality(factors, formula, fixedNow).index).toBe(0);
  });

  it("all-maximum-severity factors (worst case, including privilegeRequired 0 since lower_is_worse) produce index 9", () => {
    const factors: SeverityFactors = { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 };
    expect(calculateCriticality(factors, formula, fixedNow).index).toBe(9);
  });

  it("all-midpoint factors produce a weighted sum of exactly 4.5, rounded to 5 (JS Math.round rounds .5 up)", () => {
    const factors: SeverityFactors = { impact: 3, exploitability: 3, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 };
    expect(calculateCriticality(factors, formula, fixedNow).index).toBe(5);
  });

  it("the same midpoint factors with rounding:'floor' produce 4", () => {
    const factors: SeverityFactors = { impact: 3, exploitability: 3, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 };
    expect(calculateCriticality(factors, { ...formula, rounding: "floor" }, fixedNow).index).toBe(4);
  });

  it("the same midpoint factors with rounding:'ceil' produce 5", () => {
    const factors: SeverityFactors = { impact: 3, exploitability: 3, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 };
    expect(calculateCriticality(factors, { ...formula, rounding: "ceil" }, fixedNow).index).toBe(5);
  });

  it("stamps computedAt from the injected now() rather than the real clock", () => {
    const factors: SeverityFactors = { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 };
    expect(calculateCriticality(factors, formula, fixedNow).computedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("carries formulaId/formulaVersion from the formula input", () => {
    const factors: SeverityFactors = { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 };
    const result = calculateCriticality(factors, formula, fixedNow);
    expect(result.formulaId).toBe("CRIT-DEFAULT");
    expect(result.formulaVersion).toBe("1.0.0");
  });
});
