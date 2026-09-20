import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";

describe("score-model-schema", () => {
  const valid = {
    modelId: "USSVS-SCORE-DEFAULT",
    version: "1.0.0",
    statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
    excludedStatuses: ["N/A", "ACCEPTED_RISK"],
    description: "overallScore = weighted pass rate over applicable, non-excluded controls.",
  };

  it("accepts a well-formed score model", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a model missing a status weight", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    const { FAIL, ...rest } = valid.statusWeights;
    expect(validate({ ...valid, statusWeights: rest })).toBe(false);
  });

  it("rejects an excludedStatuses value outside N/A or ACCEPTED_RISK", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    expect(validate({ ...valid, excludedStatuses: ["FAIL"] })).toBe(false);
  });
});

describe("core/scoring-model.json", () => {
  it("validates against score-model-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    const data = loadJson<object>("data/core/scoring-model.json");
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });
});
