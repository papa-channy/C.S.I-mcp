import { describe, expect, it } from "vitest";
import { isRiskAcceptanceEffectivelyValid, translateAssessmentsForTrust } from "../../src/core/risk-acceptance.js";
import type { ControlAssessment, RiskAcceptance } from "../../src/core/repository.js";

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

function assessment(controlId: string, overrides: Partial<ControlAssessment> = {}): ControlAssessment {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-1", controlId, controlVersion: 1,
    runId: "RUN-1", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: NOW, nextReviewAt: null, notes: null,
    ...overrides,
  };
}

describe("translateAssessmentsForTrust", () => {
  it("a fresh assessment (profileRevision matches) passes through with its real status", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 1, [], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "PASS" }]);
  });

  it("a stale assessment (profileRevision does not match) is translated to NOT_TESTED", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 2, [], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "NOT_TESTED" }]);
  });

  it("ACCEPTED_RISK backed by a valid RiskAcceptance passes through unchanged", () => {
    const ra: RiskAcceptance = {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    };
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [ra], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "ACCEPTED_RISK" }]);
  });

  it("ACCEPTED_RISK whose RiskAcceptance has since expired is translated to NOT_TESTED", () => {
    const ra: RiskAcceptance = {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", // expired before NOW
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    };
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [ra], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "NOT_TESTED" }]);
  });

  it("ACCEPTED_RISK whose riskAcceptanceId resolves to nothing at all is translated to NOT_TESTED", () => {
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-404" });
    const result = translateAssessmentsForTrust([a], 1, [], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "NOT_TESTED" }]);
  });

  it("never mutates the input ControlAssessment objects", () => {
    const a = assessment("TEST-001", { profileRevision: 1 });
    translateAssessmentsForTrust([a], 2, [], NOW);
    expect(a.status).toBe("PASS");
    expect(a.profileRevision).toBe(1);
  });
});
