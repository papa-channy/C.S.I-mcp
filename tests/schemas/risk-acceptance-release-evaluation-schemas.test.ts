import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("risk-acceptance-schema", () => {
  const valid = {
    riskAcceptanceId: "RA-001",
    projectId: "proj-001",
    controlId: "IAM-AUTH-005",
    findingIds: ["FND-004"],
    reason: "Compensating network-level control mitigates this in the short term.",
    compensatingControls: ["NET-ADMIN-003"],
    approvedBy: "ciso@example.com",
    approvedAt: "2026-09-16T05:00:00Z",
    expiresAt: "2026-12-16T05:00:00Z",
    status: "active",
    revokedAt: null,
    revokedReason: null,
  };

  it("accepts a well-formed risk acceptance with an expiration date", () => {
    const validate = compileSchemaFromFile("data/schemas/risk-acceptance-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a risk acceptance with no expiresAt", () => {
    const validate = compileSchemaFromFile("data/schemas/risk-acceptance-schema.json");
    const { expiresAt, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a risk acceptance missing revokedAt", () => {
    const validate = compileSchemaFromFile("data/schemas/risk-acceptance-schema.json");
    const { revokedAt, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
});

describe("release-evaluation-schema", () => {
  const valid = {
    projectId: "proj-001",
    gate: 4,
    controlCoverage: 97,
    confirmedCriticalVulnerabilities: 0,
    confirmedHighVulnerabilities: 0,
    unblockedCriticalAttackPaths: 0,
    residualRisksAccepted: 3,
    incidentResponseVerified: true,
    backupRestoreVerified: true,
    blockingControlFailures: [],
    blockingControlsNotVerified: [],
    result: "approved",
    evaluatedAt: "2026-09-16T05:00:00Z",
  };

  it("accepts a well-formed release evaluation", () => {
    const validate = compileSchemaFromFile("data/schemas/release-evaluation-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a gate value outside 0-4", () => {
    const validate = compileSchemaFromFile("data/schemas/release-evaluation-schema.json");
    expect(validate({ ...valid, gate: 5 })).toBe(false);
  });
});
