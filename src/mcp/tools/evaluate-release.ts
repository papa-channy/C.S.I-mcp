import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "../../service/analysis-service.js";
import { toErrorResult } from "./error-result.js";

// projectId only, deliberately — securityLevel is read server-side from the project's own
// profile (spec §6): accepting it as a parameter here would let a call silently evaluate
// against a weaker gate than the project's real one.
export const evaluateReleaseInputShape = { projectId: z.string().min(1) };

export function registerEvaluateReleaseTool(server: McpServer, service: AnalysisService): void {
  server.registerTool(
    "evaluate_release",
    { title: "Evaluate Release", description: "Evaluate gate-4 production-release readiness for a project.", inputSchema: evaluateReleaseInputShape },
    async ({ projectId }) => {
      try {
        const evaluation = await service.evaluateRelease(projectId);
        return {
          content: [{ type: "text" as const, text: `Release evaluation: ${evaluation.result}.` }],
          structuredContent: evaluation as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
