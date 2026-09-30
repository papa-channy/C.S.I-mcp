import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JsonRepository } from "../../src/core/repository.js";
import { ProjectService } from "../../src/service/project-service.js";
import { AssessmentService } from "../../src/service/assessment-service.js";
import { AnalysisService } from "../../src/service/analysis-service.js";
import { ReportService } from "../../src/service/report-service.js";
import { registerCreateProjectTool } from "../../src/mcp/tools/create-project.js";
import { registerUpdateProjectProfileTool } from "../../src/mcp/tools/update-project-profile.js";
import { registerStartAssessmentRunTool } from "../../src/mcp/tools/start-assessment-run.js";
import { registerListControlsTool } from "../../src/mcp/tools/list-controls.js";
import { registerRecordAssessmentTool } from "../../src/mcp/tools/record-assessment.js";
import { registerRecordFindingTool } from "../../src/mcp/tools/record-finding.js";
import { registerGetScoreTool } from "../../src/mcp/tools/get-score.js";
import { registerEvaluateReleaseTool } from "../../src/mcp/tools/evaluate-release.js";
import { registerGenerateReportTool } from "../../src/mcp/tools/generate-report.js";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("full MCP workflow, against the real data/ catalog", () => {
  let dataDir: string;
  let client: Client;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "csi-mcp-integration-"));
    const repository = new JsonRepository(dataDir);
    // The real catalog/core/process files live under the repo's own data/ tree — only the
    // project-instance tree (data/projects/, data/plans/) is temp-directory-scoped, matching how
    // JsonRepository already separates the two in the Core Engine spec's file layout.
    const realCatalog = new JsonRepository("data");
    (repository as any).dataDir = dataDir;

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const projectService = new ProjectService(repository);
    const assessmentService = new AssessmentService(mixedRepository(repository, realCatalog));
    const analysisService = new AnalysisService(mixedRepository(repository, realCatalog));
    const reportService = new ReportService(mixedRepository(repository, realCatalog));

    registerCreateProjectTool(server, projectService);
    registerUpdateProjectProfileTool(server, projectService);
    registerStartAssessmentRunTool(server, assessmentService);
    registerListControlsTool(server, assessmentService);
    registerRecordAssessmentTool(server, assessmentService);
    registerRecordFindingTool(server, assessmentService);
    registerGetScoreTool(server, analysisService);
    registerEvaluateReleaseTool(server, analysisService);
    registerGenerateReportTool(server, reportService);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("walks create → profile → run → list → assess → find → score → release → report", async () => {
    const created = await client.callTool({
      name: "create_project",
      arguments: {
        name: "Integration Demo", owner: "alice", securityLevel: "SVL-3", exposure: ["internet_public"],
        features: { authentication: true }, technologies: { languages: ["typescript"] },
      },
    });
    expect(created.isError).toBeFalsy();
    const projectId = (created.structuredContent as any).projectId as string;

    await client.callTool({ name: "update_project_profile", arguments: { projectId, components: ["web-app"] } });

    const run = await client.callTool({ name: "start_assessment_run", arguments: { projectId } });
    expect(run.isError).toBeFalsy();
    const runId = (run.structuredContent as any).runId as string;

    const listed = await client.callTool({ name: "list_controls", arguments: { projectId } });
    const controls = (listed.structuredContent as any).controls as { controlId: string }[];
    expect(controls.length).toBe(48);

    const targetControlId = "GOV-IR-001";
    const backupControlId = "OPS-BACKUP-TEST-001";
    for (const controlId of new Set([targetControlId, backupControlId, ...controls.map((c) => c.controlId)])) {
      await client.callTool({
        name: "record_assessment",
        arguments: {
          projectId, runId, controlId, status: "PASS",
          evidence: [{ type: "MANUAL_TEST", location: "manual test log" }],
        },
      });
    }

    const finding = await client.callTool({
      name: "record_finding",
      arguments: {
        projectId, controlIds: [targetControlId], title: "Weak incident runbook", attackScenario: "delayed response",
        severityFactors: { impact: 2, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 },
        priorityIndex: 5, priorityRationale: "low urgency",
      },
    });
    expect(finding.isError).toBeFalsy();
    const findingId = (finding.structuredContent as any).findingId as string;

    const score = await client.callTool({ name: "get_score", arguments: { projectId } });
    expect(score.isError).toBeFalsy();
    expect((score.structuredContent as any).overallScore).toBe(100);

    const release = await client.callTool({ name: "evaluate_release", arguments: { projectId } });
    expect(release.isError).toBeFalsy();

    const report = await client.callTool({
      name: "generate_report",
      arguments: { projectId, runId, summary: "Integration test run — all controls PASS, one low finding." },
    });
    expect(report.isError).toBeFalsy();
    const reportPayload = report.structuredContent as any;
    expect(reportPayload.prioritizedFindings.some((f: { findingId: string }) => f.findingId === findingId)).toBe(true);

    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const valid = validate(reportPayload);
    expect(valid, JSON.stringify(validate.errors)).toBe(true);
  });
});

function mixedRepository(projectRepo: JsonRepository, catalogRepo: JsonRepository) {
  return {
    getProject: projectRepo.getProject.bind(projectRepo),
    getControls: catalogRepo.getControls.bind(catalogRepo),
    getThreats: catalogRepo.getThreats.bind(catalogRepo),
    getCriticalityFormula: catalogRepo.getCriticalityFormula.bind(catalogRepo),
    getScoreModel: catalogRepo.getScoreModel.bind(catalogRepo),
    getReleaseGates: catalogRepo.getReleaseGates.bind(catalogRepo),
    getPlan: projectRepo.getPlan.bind(projectRepo),
    getCatalogVersion: catalogRepo.getCatalogVersion.bind(catalogRepo),
    getControlAssessments: projectRepo.getControlAssessments.bind(projectRepo),
    getFindings: projectRepo.getFindings.bind(projectRepo),
    getEvidence: projectRepo.getEvidence.bind(projectRepo),
    getRun: projectRepo.getRun.bind(projectRepo),
    saveRun: projectRepo.saveRun.bind(projectRepo),
    saveBatch: projectRepo.saveBatch.bind(projectRepo),
    saveReport: projectRepo.saveReport.bind(projectRepo),
    savePlan: projectRepo.savePlan.bind(projectRepo),
    saveProject: projectRepo.saveProject.bind(projectRepo),
    saveControlAssessment: projectRepo.saveControlAssessment.bind(projectRepo),
    saveFinding: projectRepo.saveFinding.bind(projectRepo),
    saveEvidence: projectRepo.saveEvidence.bind(projectRepo),
  };
}
