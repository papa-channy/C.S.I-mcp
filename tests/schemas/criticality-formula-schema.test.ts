import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";

describe("criticality-formula-schema", () => {
  const valid = {
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
    weights: {
      impact: 0.35,
      exploitability: 0.25,
      exposure: 0.15,
      privilegeRequired: 0.15,
      detectionDifficulty: 0.1,
    },
    rounding: "round",
  };

  it("accepts a well-formed formula definition", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a formula missing a weight", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    const { impact, ...restWeights } = valid.weights;
    expect(validate({ ...valid, weights: restWeights })).toBe(false);
  });

  it("rejects a scaleMax other than 9", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    expect(validate({ ...valid, scaleMax: 10 })).toBe(false);
  });
});

describe("core/criticality-weights.json", () => {
  it("validates against criticality-formula-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    const data = loadJson<object>("data/core/criticality-weights.json");
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });

  it("has weights that sum to 1.0 within a small tolerance", () => {
    const data = loadJson<{ weights: Record<string, number> }>("data/core/criticality-weights.json");
    const sum = Object.values(data.weights).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });
});
