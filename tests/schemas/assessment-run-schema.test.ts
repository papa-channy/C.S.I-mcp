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

  it("accepts a run with target/profileSnapshot/engineVersionAtRunStart populated", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    const doc = {
      ...valid,
      target: { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false },
      profileSnapshot: { securityLevel: "SVL-2", exposure: ["internet_public"] },
      engineVersionAtRunStart: "0.9.0",
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a run with target/profileSnapshot/engineVersionAtRunStart keys entirely absent (legacy compatibility)", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts target: null explicitly (a new run whose caller declined to declare provenance)", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate({ ...valid, target: null }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a target object missing repository", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    const doc = { ...valid, target: { commitSha: null, branchOrTag: null, dirty: null } };
    expect(validate(doc)).toBe(false);
  });
});
