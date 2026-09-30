import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportService } from "../../service/report-service.js";
import { toErrorResult } from "./error-result.js";

export const generateReportInputShape = {
  projectId: z.string().min(1),
  runId: z.string().min(1),
  summary: z.string().min(1),
};

export function registerGenerateReportTool(server: McpServer, service: ReportService): void {
  server.registerTool(
    "generate_report",
    { title: "Generate Report", description: "Generate the final project report for an assessment run.", inputSchema: generateReportInputShape },
    async (input) => {
      try {
        const report = await service.generate(input);
        return {
          content: [{ type: "text" as const, text: `Generated report ${report.reportId} — ${report.releaseEvaluation.result}.` }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
