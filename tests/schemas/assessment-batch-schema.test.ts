import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("assessment-batch-schema", () => {
  const valid = {
    batchId: "BAT-001",
    runId: "RUN-20260919-001",
    planId: "PLAN-DEFAULT",
    projectId: "PRJ-001",
    groupBy: "domain",
    groupValue: "authentication",
    controlIds: ["IAM-AUTH-001", "IAM-AUTH-002"],
    assignedAgent: null,
    status: "pending",
    startedAt: null,
    completedAt: null,
    resultingAssessmentIds: [],
    resultingFindingIds: [],
  };

  it("accepts a well-formed batch", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a batch missing runId", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    const { runId, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a batch with no controlIds", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    expect(validate({ ...valid, controlIds: [] })).toBe(false);
  });

  it("rejects an unknown status value", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    expect(validate({ ...valid, status: "queued" })).toBe(false);
  });
});
