import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("finding-schema", () => {
  const valid = {
    findingId: "FND-001",
    title: "Admin API reachable without authentication",
    controlIds: ["IAM-AUTH-001", "IAM-AUTHZ-003"],
    threatIds: ["THR-IAM-UNAUTHENTICATED-ACCESS"],
    attackScenario: "An unauthenticated request to /admin/users returns the full user list.",
    impact: 5,
    exploitability: 4,
    exposure: 3,
    privilegeRequired: 0,
    detectionDifficulty: 1,
    criticality: {
      index: 8,
      formulaId: "CRIT-DEFAULT",
      formulaVersion: "1.0.0",
      computedAt: "2026-09-19T05:00:00Z",
    },
    priority: {
      index: 0,
      source: "agent",
      rationale: "Unauthenticated admin data exposure is actively exploitable right now.",
      assignedBy: "agent-security-01",
      assignedAt: "2026-09-19T05:00:00Z",
    },
    severity: "critical",
    status: "open",
  };

  it("accepts a well-formed finding referencing multiple controls", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a finding with no controlIds", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    expect(validate({ ...valid, controlIds: [] })).toBe(false);
  });

  it("rejects an out-of-range impact score", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    expect(validate({ ...valid, impact: 9 })).toBe(false);
  });

  it("rejects a priority object missing rationale", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const { rationale, ...restPriority } = valid.priority;
    expect(validate({ ...valid, priority: restPriority })).toBe(false);
  });

  it("rejects a criticality object missing formulaVersion", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const { formulaVersion, ...restCriticality } = valid.criticality;
    expect(validate({ ...valid, criticality: restCriticality })).toBe(false);
  });

  it("requires priorityOverrideReason when criticality.index>=8 and priority.index>=2", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const highCLowUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 9 },
      priority: { ...valid.priority, index: 3 },
    };
    expect(validate(highCLowUrgency)).toBe(false);
  });

  it("accepts priorityOverrideReason satisfying the guardrail", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const highCLowUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 9 },
      priority: { ...valid.priority, index: 3 },
      priorityOverrideReason: "Exploitation requires an already-authenticated session; scheduled for next sprint.",
    };
    expect(validate(highCLowUrgency), JSON.stringify(validate.errors)).toBe(true);
  });

  it("does not require priorityOverrideReason when priority.index is below 2, even at high criticality", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const highCHighUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 9 },
      priority: { ...valid.priority, index: 1 },
    };
    expect(validate(highCHighUrgency), JSON.stringify(validate.errors)).toBe(true);
  });

  it("does not require priorityOverrideReason when criticality.index is below 8, even at low urgency", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const lowCLowUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 5 },
      priority: { ...valid.priority, index: 9 },
    };
    expect(validate(lowCLowUrgency), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("attack-path-schema", () => {
  const valid = {
    attackPathId: "AP-001",
    entryPoint: "Public marketing site contact form",
    initialPrivilege: "anonymous",
    steps: ["Reflected XSS in contact form", "Steal admin session cookie", "Access admin API", "Export customer data"],
    targetAsset: "AST-017",
    existingControls: ["APPSEC-XSS-002"],
    failedControls: ["IAM-SESSION-003"],
    result: "possible",
    relatedFindingIds: ["FND-001"],
  };

  it("accepts a well-formed attack path", () => {
    const validate = compileSchemaFromFile("data/schemas/attack-path-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an attack path with no steps", () => {
    const validate = compileSchemaFromFile("data/schemas/attack-path-schema.json");
    expect(validate({ ...valid, steps: [] })).toBe(false);
  });

  it("rejects an invalid result value", () => {
    const validate = compileSchemaFromFile("data/schemas/attack-path-schema.json");
    expect(validate({ ...valid, result: "maybe" })).toBe(false);
  });
});
