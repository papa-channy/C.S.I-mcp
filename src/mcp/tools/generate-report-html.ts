import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportService } from "../../service/report-service.js";
import { REPORT_HTML_RENDERER_VERSION } from "../../core/report-html-renderer.js";
import { toErrorResult } from "./error-result.js";

export const generateReportHtmlInputShape = {
  projectId: z.string().min(1),
  reportId: z.string().min(1),
};

export function registerGenerateReportHtmlTool(server: McpServer, service: ReportService): void {
  server.registerTool(
    "generate_report_html",
    {
      title: "Generate Report HTML",
      description: "Render a self-contained, zero-network HTML report from an existing ProjectReport (requires reportSchemaVersion 2.1.0).",
      inputSchema: generateReportHtmlInputShape,
    },
    async (input) => {
      try {
        const result = await service.generateHtml(input);
        return {
          content: [{ type: "text" as const, text: `Generated HTML report at ${result.path} (source SHA-256 ${result.sourceReportSha256}).` }],
          structuredContent: { path: result.path, sourceReportSha256: result.sourceReportSha256, rendererVersion: REPORT_HTML_RENDERER_VERSION },
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
