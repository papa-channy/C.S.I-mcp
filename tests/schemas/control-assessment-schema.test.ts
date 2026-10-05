import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

const baseAssessment = {
  assessmentId: "ASM-001",
  projectId: "proj-001",
  controlId: "IAM-AUTH-005",
  controlVersion: 1,
  runId: "RUN-001",
  profileRevision: 1,
  applicability: {
    autoResult: "applicable",
    finalResult: "applicable",
    matchedRules: ["identities contains administrator"],
    source: "automatic",
  },
  status: "PASS",
  evidenceIds: ["EVD-001"],
  findingIds: [],
  riskAcceptanceId: null,
  owner: "security",
  assessedBy: "agent",
  assessedAt: "2026-09-16T05:00:00Z",
};

describe("control-assessment-schema", () => {
  it("accepts a PASS assessment", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    expect(validate(baseAssessment), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects status N/A without notes", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "N/A" };
    expect(validate(doc)).toBe(false);
  });

  it("accepts status N/A with notes", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment, status: "N/A", notes: "No admin interface exists in this project.",
      applicability: { ...baseAssessment.applicability, finalResult: "not_applicable" },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects status ACCEPTED_RISK without riskAcceptanceId", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "ACCEPTED_RISK" };
    expect(validate(doc)).toBe(false);
  });

  it("accepts status ACCEPTED_RISK with riskAcceptanceId", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a manual_override applicability without reason", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment,
      applicability: {
        autoResult: "applicable",
        finalResult: "not_applicable",
        source: "manual_override",
      },
    };
    expect(validate(doc)).toBe(false);
  });

  it("rejects a manual_override applicability with an empty-string reason", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment,
      applicability: {
        autoResult: "applicable",
        finalResult: "not_applicable",
        source: "manual_override",
        reason: "",
      },
    };
    expect(validate(doc)).toBe(false);
  });

  it("accepts a manual_override applicability with reason", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment,
      applicability: {
        autoResult: "applicable",
        finalResult: "not_applicable",
        source: "manual_override",
        reason: "Authentication is fully delegated to an external IdP.",
      },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    expect(validate({ ...baseAssessment, status: "MAYBE" })).toBe(false);
  });

  it("rejects status N/A with applicability.finalResult still 'applicable'", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment, status: "N/A", notes: "attempted bypass",
      applicability: { ...baseAssessment.applicability, finalResult: "applicable" },
    };
    expect(validate(doc)).toBe(false);
  });

  it("accepts status N/A when applicability.finalResult is 'not_applicable'", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment, status: "N/A", notes: "genuinely not applicable",
      applicability: {
        autoResult: "applicable", finalResult: "not_applicable", matchedRules: [],
        source: "manual_override", reason: "no admin interface exists in this deployment",
      },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });
});
