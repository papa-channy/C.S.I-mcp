import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("assessment-run-schema", () => {
  const valid = {
    runId: "RUN-20260919-001",
    projectId: "PRJ-001",
    planId: "PLAN-DEFAULT",
    planVersion: 1,
    profileRevision: 1,
    catalogVersion: "2.1.0",
    batchIds: ["BAT-001", "BAT-002"],
    status: "running",
  };

  it("accepts a well-formed run", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts status partial for a run with mixed batch outcomes", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate({ ...valid, status: "partial" }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate({ ...valid, status: "cancelled" })).toBe(false);
  });

  it("rejects a run missing planVersion", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    const { planVersion, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
});
