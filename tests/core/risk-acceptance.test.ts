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

describe("translateAssessmentsForTrust — recordedStatus/status/effectiveStatusReason shape", () => {
  it("a fresh assessment (profileRevision matches) passes through with recordedStatus === status and a null reason", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 1, [], NOW);
    expect(result).toEqual([{
      assessmentId: "A-TEST-001", controlId: "TEST-001", runId: "RUN-1",
      recordedStatus: "PASS", status: "PASS", effectiveStatusReason: null,
    }]);
  });

  it("a stale assessment (profileRevision does not match) is translated to NOT_TESTED with reason stale_profile, recordedStatus preserved", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 2, [], NOW);
    expect(result).toEqual([{
      assessmentId: "A-TEST-001", controlId: "TEST-001", runId: "RUN-1",
      recordedStatus: "PASS", status: "NOT_TESTED", effectiveStatusReason: { code: "stale_profile" },
    }]);
  });

  it("ACCEPTED_RISK backed by a valid, scope-matched RiskAcceptance passes through unchanged with a null reason", () => {
    const riskAcceptance = ra({ controlId: "TEST-001" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result).toEqual([{
      assessmentId: "A-TEST-001", controlId: "TEST-001", runId: "RUN-1",
      recordedStatus: "ACCEPTED_RISK", status: "ACCEPTED_RISK", effectiveStatusReason: null,
    }]);
  });

  it("ACCEPTED_RISK whose RiskAcceptance has since expired is translated to NOT_TESTED with reason risk_acceptance_expired", () => {
    const riskAcceptance = ra({ controlId: "TEST-001", approvedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].recordedStatus).toBe("ACCEPTED_RISK");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_expired" });
  });

  it("ACCEPTED_RISK whose riskAcceptanceId resolves to nothing at all is translated to NOT_TESTED with reason risk_acceptance_missing", () => {
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-404" });
    const result = translateAssessmentsForTrust([a], 1, [], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_missing" });
  });

  it("ACCEPTED_RISK whose RiskAcceptance has status revoked is translated to NOT_TESTED with reason risk_acceptance_revoked, even inside the still-unexpired date range", () => {
    const riskAcceptance = ra({ controlId: "TEST-001", status: "revoked" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_revoked" });
  });

  it("ACCEPTED_RISK whose RiskAcceptance is scoped to a different controlId is translated to NOT_TESTED with reason risk_acceptance_scope_mismatch and a detail string naming both ids", () => {
    const riskAcceptance = ra({ controlId: "OTHER-CONTROL-001" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason?.code).toBe("risk_acceptance_scope_mismatch");
    expect(result[0].effectiveStatusReason?.detail).toContain("RA-001");
    expect(result[0].effectiveStatusReason?.detail).toContain("OTHER-CONTROL-001");
  });

  it("ACCEPTED_RISK whose RiskAcceptance has an approvedAt in the future (not yet approved) is translated to NOT_TESTED with reason risk_acceptance_expired and an explanatory detail", () => {
    const riskAcceptance = ra({ controlId: "TEST-001", approvedAt: "2026-11-01T00:00:00.000Z" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason?.code).toBe("risk_acceptance_expired");
    expect(result[0].effectiveStatusReason?.detail).toBeTruthy();
  });

  it("stale_profile takes precedence when both staleness and an ACCEPTED_RISK problem would independently apply", () => {
    const a = assessment("TEST-001", { profileRevision: 1, status: "ACCEPTED_RISK", riskAcceptanceId: "RA-404" });
    const result = translateAssessmentsForTrust([a], 2, [], NOW);
    expect(result[0].effectiveStatusReason).toEqual({ code: "stale_profile" });
  });

  it("a stale assessment whose recorded status is already NOT_TESTED has a null reason, since nothing actually changed", () => {
    const a = assessment("TEST-001", { profileRevision: 1, status: "NOT_TESTED" });
    const result = translateAssessmentsForTrust([a], 2, [], NOW);
    expect(result[0].recordedStatus).toBe("NOT_TESTED");
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toBeNull();
  });

  it("never mutates the input ControlAssessment objects", () => {
    const a = assessment("TEST-001", { profileRevision: 1 });
    translateAssessmentsForTrust([a], 2, [], NOW);
    expect(a.status).toBe("PASS");
    expect(a.profileRevision).toBe(1);
  });

  it("carries each assessment's own runId through, for a mixed-run input array", () => {
    const a1 = assessment("TEST-001", { runId: "RUN-1" });
    const a2 = assessment("TEST-002", { runId: "RUN-2" });
    const result = translateAssessmentsForTrust([a1, a2], 1, [], NOW);
    expect(result.find((r) => r.controlId === "TEST-001")?.runId).toBe("RUN-1");
    expect(result.find((r) => r.controlId === "TEST-002")?.runId).toBe("RUN-2");
  });
});
