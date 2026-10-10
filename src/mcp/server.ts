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
import { registerGenerateReportDataTool } from "./tools/generate-report-data.js";
import { registerGenerateReportHtmlTool } from "./tools/generate-report-html.js";
import { registerRecordRiskAcceptanceTool } from "./tools/record-risk-acceptance.js";
import { registerRevokeRiskAcceptanceTool } from "./tools/revoke-risk-acceptance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readEngineVersion(): string {
  const packageJsonPath = join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
  return pkg.version;
}

function readD3Source(): string {
  const d3Path = join(__dirname, "..", "assets", "d3.v7.min.js");
  return readFileSync(d3Path, "utf-8");
}

// CSI_MCP_DATA_DIR lets a distributed/installed deployment point project data at a location
// outside the installed package (e.g. ~/.csi-mcp/data) instead of a relative "data" dir that
// would otherwise live inside wherever this package was unpacked. Unset in this repo's own
// dev/test workflow, where the relative "data" default (this repo's own data/ tree) is correct.
export function buildServer(dataDir = process.env.CSI_MCP_DATA_DIR ?? "data"): McpServer {
  const engineVersion = readEngineVersion();
  const repository = new JsonRepository(dataDir);
  const projectService = new ProjectService(repository);
  const assessmentService = new AssessmentService(repository, undefined, engineVersion);
  const analysisService = new AnalysisService(repository);
  const reportService = new ReportService(repository, undefined, readD3Source());
  const riskAcceptanceService = new RiskAcceptanceService(repository);

  const server = new McpServer({ name: "csi-mcp", version: engineVersion });

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
  registerGenerateReportDataTool(server, reportService);
  registerGenerateReportHtmlTool(server, reportService);
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
