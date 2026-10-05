import { describe, expect, it } from "vitest";
import { RiskAcceptanceService } from "../../src/service/risk-acceptance-service.js";
import { FakeRepository } from "./fake-repository.js";

const NOW = "2026-10-05T00:00:00.000Z";

describe("RiskAcceptanceService.record", () => {
  it("creates RA-001 with agent-populated approvedBy/approvedAt and status active", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    const ra = await service.record({
      projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "compensating control in place",
      expiresAt: "2026-12-05T00:00:00.000Z",
    });
    expect(ra.riskAcceptanceId).toBe("RA-001");
    expect(ra.status).toBe("active");
    expect(ra.approvedBy).toBe("csi-mcp-agent");
    expect(ra.approvedAt).toBe(NOW);
    expect(ra.revokedAt).toBeNull();
    const [stored] = await repo.getRiskAcceptances("PRJ-1");
    expect(stored).toEqual(ra);
  });

  it("assigns sequential IDs across calls within the same project", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    const second = await service.record({ projectId: "PRJ-1", controlId: "DATA-ENC-002", reason: "r2", expiresAt: "2026-12-05T00:00:00.000Z" });
    expect(second.riskAcceptanceId).toBe("RA-002");
  });

  it("defaults findingIds/compensatingControls/reviewDate when omitted", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    const ra = await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    expect(ra.findingIds).toEqual([]);
    expect(ra.compensatingControls).toEqual([]);
    expect(ra.reviewDate).toBeNull();
  });
});

describe("RiskAcceptanceService.revoke", () => {
  it("transitions active to revoked with revokedAt/revokedReason set", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    const revoked = await service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "control remediated" });
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe(NOW);
    expect(revoked.revokedReason).toBe("control remediated");
    const [stored] = await repo.getRiskAcceptances("PRJ-1");
    expect(stored.status).toBe("revoked");
  });

  it("is idempotent on an already-revoked record — returns it unchanged, not an error", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    await service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "first revoke" });
    const second = await service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "second revoke attempt" });
    expect(second.status).toBe("revoked");
    expect(second.revokedReason).toBe("first revoke"); // unchanged by the second call
  });

  it("throws NOT_FOUND for an unknown riskAcceptanceId", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await expect(service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-999", revokedReason: "x" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
