import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("threat-schema", () => {
  const valid = {
    threatId: "THR-IAM-ACCOUNT-TAKEOVER",
    title: "Account Takeover",
    description: "An attacker gains persistent control of a privileged account.",
    category: "authentication",
  };

  it("accepts a well-formed threat", () => {
    const validate = compileSchemaFromFile("data/schemas/threat-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a threatId that does not start with THR-", () => {
    const validate = compileSchemaFromFile("data/schemas/threat-schema.json");
    expect(validate({ ...valid, threatId: "ACCOUNT-TAKEOVER" })).toBe(false);
  });
});

describe("asset-schema", () => {
  const valid = {
    assetId: "AST-017",
    assetName: "Customer Credential",
    assetType: "credential",
    dataClassification: "D3",
    owner: "security",
    storage: "authentication_db",
    process: "auth_service",
    access: ["auth_service"],
    backup: true,
    encryption: "password_hash",
    businessImpact: "account_takeover",
  };

  it("accepts a well-formed asset", () => {
    const validate = compileSchemaFromFile("data/schemas/asset-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an invalid dataClassification", () => {
    const validate = compileSchemaFromFile("data/schemas/asset-schema.json");
    expect(validate({ ...valid, dataClassification: "D9" })).toBe(false);
  });
});

describe("evidence-schema", () => {
  const valid = {
    evidenceId: "EVD-001",
    type: "AUTOMATED_TEST",
    location: "ci://run/4821/artifacts/auth-mfa.json",
    capturedAt: "2026-09-16T05:00:00Z",
    capturedBy: "ci-pipeline",
  };

  it("accepts a well-formed evidence record", () => {
    const validate = compileSchemaFromFile("data/schemas/evidence-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown evidence type", () => {
    const validate = compileSchemaFromFile("data/schemas/evidence-schema.json");
    expect(validate({ ...valid, type: "VIBES" })).toBe(false);
  });
});
