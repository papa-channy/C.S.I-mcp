import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

const targetInputShape = z.object({
  repository: z.string().min(1),
  commitSha: z.string().nullable(),
  branchOrTag: z.string().nullable(),
  dirty: z.boolean().nullable(),
});

export const startAssessmentRunInputShape = {
  projectId: z.string().min(1),
  target: targetInputShape.optional(),
};

export function registerStartAssessmentRunTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "start_assessment_run",
    {
      title: "Start Assessment Run",
      description:
        "Start a new assessment run for a project. The optional target input declares what code this " +
        "run is assessing (repository, commitSha, branchOrTag, dirty) — this is caller-asserted " +
        "provenance, not independently verified by the server. When supplied, repository is required; " +
        "the other three fields may be null. A project's current profile is deep-copied onto the run " +
        "at this moment, so a later profile change cannot retroactively alter what this run recorded.",
      inputSchema: startAssessmentRunInputShape,
    },
    async ({ projectId, target }) => {
      try {
        const result = await service.startAssessmentRun(projectId, target ? { target } : undefined);
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
