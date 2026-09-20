import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("assessment-plan-schema", () => {
  const valid = {
    planId: "PLAN-DEFAULT",
    version: 1,
    projectId: "PRJ-001",
    groupBy: "domain",
    defaultMaxParallelAgents: 4,
    createdAt: "2026-09-19T05:00:00Z",
  };

  it("accepts a minimal well-formed plan", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a plan with selection and groupOverrides", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    const withExtras = {
      ...valid,
      selection: {
        assessmentStatuses: ["FAIL", "PARTIAL"],
        domains: ["authentication"],
      },
      groupOverrides: [{ groupValue: "authentication", maxParallelAgents: 2 }],
    };
    expect(validate(withExtras), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts groupBy: controlId for one-agent-per-control", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    expect(validate({ ...valid, groupBy: "controlId" }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown groupBy value", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    expect(validate({ ...valid, groupBy: "threat" })).toBe(false);
  });

  it("rejects a plan missing version", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    const { version, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
});
