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
    detectability: 1,
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
