import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { RiskAcceptanceService } from "../../../src/service/risk-acceptance-service.js";
import { registerRecordRiskAcceptanceTool } from "../../../src/mcp/tools/record-risk-acceptance.js";
import { registerRevokeRiskAcceptanceTool } from "../../../src/mcp/tools/revoke-risk-acceptance.js";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  const service = new RiskAcceptanceService(repo, () => "2026-10-05T00:00:00.000Z");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRecordRiskAcceptanceTool(server, service);
  registerRevokeRiskAcceptanceTool(server, service);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, repo };
}

describe("record_risk_acceptance / revoke_risk_acceptance", () => {
  it("record_risk_acceptance round-trips through the tool layer to a real RiskAcceptance", async () => {
    const { client, repo } = await makeConnectedClient();
    const result = await client.callTool({
      name: "record_risk_acceptance",
      arguments: {
        projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "compensating control in place",
        expiresAt: "2026-12-05T00:00:00.000Z",
      },
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).riskAcceptanceId).toBe("RA-001");
    const [stored] = await repo.getRiskAcceptances("PRJ-1");
    expect(stored.controlId).toBe("IAM-AUTH-005");
  });

  it("revoke_risk_acceptance round-trips through the tool layer", async () => {
    const { client } = await makeConnectedClient();
    await client.callTool({
      name: "record_risk_acceptance",
      arguments: { projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" },
    });
    const result = await client.callTool({
      name: "revoke_risk_acceptance",
      arguments: { projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "control remediated" },
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).status).toBe("revoked");
  });

  it("revoke_risk_acceptance surfaces NOT_FOUND through the tool layer's error-result translation", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({
      name: "revoke_risk_acceptance",
      arguments: { projectId: "PRJ-1", riskAcceptanceId: "RA-999", revokedReason: "x" },
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("NOT_FOUND");
  });

  it("record_risk_acceptance rejects a non-ISO expiresAt at the schema boundary", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({
      name: "record_risk_acceptance",
      arguments: { projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r", expiresAt: "90 days" },
    });
    expect(result.isError).toBeTruthy();
  });
});
