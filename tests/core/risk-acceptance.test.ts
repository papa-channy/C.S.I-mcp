import { describe, expect, it } from "vitest";
import { isRiskAcceptanceEffectivelyValid } from "../../src/core/risk-acceptance.js";
import type { RiskAcceptance } from "../../src/core/repository.js";

const NOW = "2026-10-05T12:00:00.000Z";

function ra(overrides: Partial<RiskAcceptance> = {}): RiskAcceptance {
  return {
    riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "IAM-AUTH-005", findingIds: [],
    reason: "compensating control", compensatingControls: [],
    approvedBy: "csi-mcp-agent", approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
    reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    ...overrides,
  };
}

describe("isRiskAcceptanceEffectivelyValid", () => {
  it("true when active, approved in the past, and not yet expired", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra(), NOW)).toBe(true);
  });

  it("false when status is expired, even if the date range is otherwise valid", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ status: "expired" }), NOW)).toBe(false);
  });

  it("false when status is revoked, even if the date range is otherwise valid", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ status: "revoked" }), NOW)).toBe(false);
  });

  it("false when now is at or past expiresAt, even if status is still active", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ expiresAt: NOW }), NOW)).toBe(false);
    expect(isRiskAcceptanceEffectivelyValid(ra({ expiresAt: "2026-10-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("false when approvedAt is in the future relative to now (malformed/clock-skewed approval)", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ approvedAt: "2026-10-06T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("true at the exact approvedAt instant (inclusive boundary)", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ approvedAt: NOW }), NOW)).toBe(true);
  });
});
