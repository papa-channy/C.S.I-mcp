import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AnalysisService } from "../../../src/service/analysis-service.js";
import { ReportService } from "../../../src/service/report-service.js";
import { RELEASE_BLOCKING_CONTROLS } from "../../../src/core/release-evaluator.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { registerGetScoreTool } from "../../../src/mcp/tools/get-score.js";
import { registerEvaluateReleaseTool } from "../../../src/mcp/tools/evaluate-release.js";
import { registerGenerateReportTool } from "../../../src/mcp/tools/generate-report.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
  });
  // No ControlAssessment records for this project, so calculateScore's zero-denominator
  // guard fires — used to exercise a genuine PRECONDITION_FAILED at the tool layer.
  await repo.saveProject({
    projectId: "PRJ-EMPTY", name: "Empty", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
  });
  repo.scoreModel = { modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0", statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 }, excludedStatuses: ["N/A", "ACCEPTED_RISK"] };
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
  repo.controls = [];
  await repo.saveRun({ runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1, catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: NOW, completedAt: null });
  // All 8 RELEASE_BLOCKING_CONTROLS must have assessments for an "approved" result
  const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
  for (let i = 0; i < blockingControls.length; i++) {
    await repo.saveControlAssessment({
      assessmentId: `A-${i + 1}`, projectId: "PRJ-1", controlId: blockingControls[i], controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
    });
  }

  const analysisService = new AnalysisService(repo);
  const reportService = new ReportService(repo, () => NOW);
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerGetScoreTool(server, analysisService);
  registerEvaluateReleaseTool(server, analysisService);
  registerGenerateReportTool(server, reportService);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client };
}

describe("analysis and report tools", () => {
  it("get_score returns a Score", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "get_score", arguments: { projectId: "PRJ-1" } });
    expect((result.structuredContent as any).overallScore).toBe(100);
  });

  it("get_score on a project with zero ControlAssessment records surfaces a genuine PRECONDITION_FAILED", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "get_score", arguments: { projectId: "PRJ-EMPTY" } });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("PRECONDITION_FAILED");
  });

  it("evaluate_release takes only projectId — no securityLevel field in its input schema", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "evaluate_release", arguments: { projectId: "PRJ-1" } });
    expect((result.structuredContent as any).result).toBe("approved");
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "evaluate_release")!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["projectId"]);
  });

  it("generate_report produces a ProjectReport", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "generate_report", arguments: { projectId: "PRJ-1", runId: "RUN-1", summary: "all clear" } });
    expect((result.structuredContent as any).summary).toBe("all clear");
    expect((result.structuredContent as any).releaseEvaluation.result).toBe("approved");
  });
});
