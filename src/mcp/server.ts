// This module's only I/O boundary with the outside world is stdio, and StdioServerTransport
// uses stdout as the JSON-RPC message channel — do not add any console.log here or in anything
// this file imports. console.error (stderr) is safe if logging is ever needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JsonRepository } from "../core/repository.js";
import { ProjectService } from "../service/project-service.js";
import { AssessmentService } from "../service/assessment-service.js";
import { AnalysisService } from "../service/analysis-service.js";
import { ReportService } from "../service/report-service.js";
import { RiskAcceptanceService } from "../service/risk-acceptance-service.js";
import { registerCreateProjectTool } from "./tools/create-project.js";
import { registerGetProjectTool } from "./tools/get-project.js";
import { registerUpdateProjectProfileTool } from "./tools/update-project-profile.js";
import { registerStartAssessmentRunTool } from "./tools/start-assessment-run.js";
import { registerListControlsTool } from "./tools/list-controls.js";
import { registerRecordAssessmentTool } from "./tools/record-assessment.js";
import { registerRecordFindingTool } from "./tools/record-finding.js";
import { registerListFindingsTool } from "./tools/list-findings.js";
import { registerGetScoreTool } from "./tools/get-score.js";
import { registerEvaluateReleaseTool } from "./tools/evaluate-release.js";
import { registerGenerateReportTool } from "./tools/generate-report.js";
import { registerRecordRiskAcceptanceTool } from "./tools/record-risk-acceptance.js";
import { registerRevokeRiskAcceptanceTool } from "./tools/revoke-risk-acceptance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readEngineVersion(): string {
  const packageJsonPath = join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
  return pkg.version;
}

export function buildServer(dataDir = "data"): McpServer {
  const repository = new JsonRepository(dataDir);
  const projectService = new ProjectService(repository);
  const assessmentService = new AssessmentService(repository, undefined, readEngineVersion());
  const analysisService = new AnalysisService(repository);
  const reportService = new ReportService(repository);
  const riskAcceptanceService = new RiskAcceptanceService(repository);

  const server = new McpServer({ name: "csi-mcp", version: "0.1.0" });

  registerCreateProjectTool(server, projectService);
  registerGetProjectTool(server, projectService);
  registerUpdateProjectProfileTool(server, projectService);
  registerStartAssessmentRunTool(server, assessmentService);
  registerListControlsTool(server, assessmentService);
  registerRecordAssessmentTool(server, assessmentService);
  registerRecordFindingTool(server, assessmentService);
  registerListFindingsTool(server, assessmentService);
  registerGetScoreTool(server, analysisService);
  registerEvaluateReleaseTool(server, analysisService);
  registerGenerateReportTool(server, reportService);
  registerRecordRiskAcceptanceTool(server, riskAcceptanceService);
  registerRevokeRiskAcceptanceTool(server, riskAcceptanceService);

  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
