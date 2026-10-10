import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportService } from "../../service/report-service.js";
import { toErrorResult } from "./error-result.js";

export const generateReportDataInputShape = {
  projectId: z.string().min(1),
  runId: z.string().min(1),
  summary: z.string().min(1),
};

export function registerGenerateReportDataTool(server: McpServer, service: ReportService): void {
  server.registerTool(
    "generate_report_data",
    { title: "Generate Report Data", description: "Generate the ProjectReport JSON for an assessment run (the data step behind generate_report_html).", inputSchema: generateReportDataInputShape },
    async (input) => {
      try {
        const report = await service.generateData(input);
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
