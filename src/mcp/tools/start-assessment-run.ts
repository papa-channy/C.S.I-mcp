import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const startAssessmentRunInputShape = { projectId: z.string().min(1) };

export function registerStartAssessmentRunTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "start_assessment_run",
    { title: "Start Assessment Run", description: "Start a new assessment run for a project.", inputSchema: startAssessmentRunInputShape },
    async ({ projectId }) => {
      try {
        const result = await service.startAssessmentRun(projectId);
        return {
          content: [{ type: "text" as const, text: `Started run ${result.runId} at ${result.startedAt}.` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
