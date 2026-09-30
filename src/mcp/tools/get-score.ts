import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "../../service/analysis-service.js";
import { toErrorResult } from "./error-result.js";

export const getScoreInputShape = { projectId: z.string().min(1) };

export function registerGetScoreTool(server: McpServer, service: AnalysisService): void {
  server.registerTool(
    "get_score",
    { title: "Get Score", description: "Compute the current security score for a project.", inputSchema: getScoreInputShape },
    async ({ projectId }) => {
      try {
        const score = await service.getScore(projectId);
        return {
          content: [{ type: "text" as const, text: `Overall score: ${score.overallScore}.` }],
          structuredContent: score as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
