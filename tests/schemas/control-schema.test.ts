import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

const validControl = {
  controlId: "IAM-AUTH-005",
  version: 1,
  status: "active",
  title: "Privileged MFA",
  group: "identity_access",
  domain: "authentication",
  subdomain: "privileged_authentication",
  layer: "prevent",
  requirement: "Privileged accounts must use multi-factor authentication.",
  rationale: "A compromised password alone must not grant privileged access.",
  threatIds: ["THR-IAM-ACCOUNT-TAKEOVER"],
  applicability: {
    when: { all: [{ fact: "identities", operator: "contains", value: "administrator" }] },
  },
  baselineRisk: { severity: "high" },
  verification: {
    methods: [
      {
        type: "manual_test",
        procedure: "Attempt privileged login with only the password factor.",
        requiredEvidenceTypes: ["MANUAL_TEST"],
        minimumSvl: "SVL-2",
        automatable: false,
      },
    ],
  },
  passCriteria: ["Privileged accounts cannot complete login with a password alone."],
  ownerRoles: ["application", "security"],
};

describe("control-schema", () => {
  it("accepts a well-formed control", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const ok = validate(validControl);
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a control missing requirement", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const { requirement, ...rest } = validControl as Record<string, unknown>;
    expect(validate(rest)).toBe(false);
  });

  it("rejects an invalid status value", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    expect(validate({ ...validControl, status: "sort_of_active" })).toBe(false);
  });

  it("rejects a malformed applicability rule tree", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const bad = { ...validControl, applicability: { when: { all: [], any: [] } } };
    expect(validate(bad)).toBe(false);
  });

  it("accepts a nested any/all applicability rule tree", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const nested = {
      ...validControl,
      applicability: {
        when: {
          any: [
            { all: [{ fact: "components", operator: "contains", value: "browser_frontend" }] },
            { fact: "features.ai", operator: "eq", value: true },
          ],
        },
      },
    };
    expect(validate(nested), JSON.stringify(validate.errors)).toBe(true);
  });
});
