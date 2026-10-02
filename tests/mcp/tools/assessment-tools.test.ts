import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AssessmentService } from "../../../src/service/assessment-service.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { registerStartAssessmentRunTool } from "../../../src/mcp/tools/start-assessment-run.js";
import { registerListControlsTool } from "../../../src/mcp/tools/list-controls.js";
import { registerRecordAssessmentTool } from "../../../src/mcp/tools/record-assessment.js";
import { registerRecordFindingTool } from "../../../src/mcp/tools/record-finding.js";
import { registerListFindingsTool } from "../../../src/mcp/tools/list-findings.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} },
  });
  repo.controls = [{
    controlId: "APP-INPUT-VAL-001", version: 1, status: "active", title: "Validate input", domain: "appsec",
    subdomain: "input", layer: "prevent", group: "validation",
    applicability: { when: { fact: "features.authentication", operator: "eq", value: true } },
  }];
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
  const service = new AssessmentService(repo, () => NOW);
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerStartAssessmentRunTool(server, service);
  registerListControlsTool(server, service);
  registerRecordAssessmentTool(server, service);
  registerRecordFindingTool(server, service);
  registerListFindingsTool(server, service);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, repo };
}

describe("assessment tools", () => {
  it("start_assessment_run returns a runId and startedAt", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "start_assessment_run", arguments: { projectId: "PRJ-1" } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).runId).toHaveLength(36);
  });

  it("list_controls returns summaries by default", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "list_controls", arguments: { projectId: "PRJ-1" } });
    expect((result.structuredContent as any).controls).toHaveLength(1);
    expect((result.structuredContent as any).controls[0].assessmentStatus).toBe("NOT_ASSESSED");
  });

  it("list_controls returns full catalog records when detail is 'full'", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "list_controls", arguments: { projectId: "PRJ-1", detail: "full" } });
    expect(result.isError).toBeFalsy();
    const controls = (result.structuredContent as any).controls;
    expect(controls).toHaveLength(1);
    expect(controls[0].applicability).toEqual({ when: expect.any(Object) });
    expect(controls[0].version).toBe(1);
    expect(controls[0].status).toBe("active");
  });

  it("record_assessment rejects PASS with no evidence as a VALIDATION_ERROR", async () => {
    const { client } = await makeConnectedClient();
    const run = await client.callTool({ name: "start_assessment_run", arguments: { projectId: "PRJ-1" } });
    const result = await client.callTool({
      name: "record_assessment",
      arguments: { projectId: "PRJ-1", runId: (run.structuredContent as any).runId, controlId: "APP-INPUT-VAL-001", status: "PASS", evidence: [] },
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("VALIDATION_ERROR");
  });

  it("record_assessment then record_finding then list_findings round-trips", async () => {
    const { client } = await makeConnectedClient();
    const run = await client.callTool({ name: "start_assessment_run", arguments: { projectId: "PRJ-1" } });
    const assessment = await client.callTool({
      name: "record_assessment",
      arguments: {
        projectId: "PRJ-1", runId: (run.structuredContent as any).runId, controlId: "APP-INPUT-VAL-001", status: "FAIL",
        evidence: [{
          type: "CODE", location: "src/x.ts",
          searchScope: "src/x.ts and its callers", searchMethod: "manual trace",
        }],
      },
    });
    expect(assessment.isError).toBeFalsy();
    const finding = await client.callTool({
      name: "record_finding",
      arguments: {
        projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "SQLi", type: "confirmed_vulnerability", attackScenario: "attacker injects",
        severityFactors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 },
        priorityIndex: 0, priorityRationale: "worst case", exploitabilityEvidence: "traced end-to-end in code review",
      },
    });
    expect((finding.structuredContent as any).findingId).toBe("FND-001");
    const list = await client.callTool({ name: "list_findings", arguments: { projectId: "PRJ-1" } });
    expect((list.structuredContent as any).findings).toHaveLength(1);
  });
});
