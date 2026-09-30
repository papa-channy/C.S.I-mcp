import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const listFindingsInputShape = {
  projectId: z.string().min(1),
  status: z.enum(["open", "in_progress", "resolved", "accepted", "false_positive"]).optional(),
  controlId: z.string().optional(),
  maxPriorityIndex: z.number().int().optional(),
  maxCriticalityIndex: z.number().int().optional(),
};

export function registerListFindingsTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "list_findings",
    {
      title: "List Findings",
      description:
        "List findings for a project, optionally filtered. priority.index and criticality.index range 0-9 " +
        "where LOWER is more urgent/severe; maxPriorityIndex/maxCriticalityIndex return findings at or below " +
        "the given index (i.e. at least that urgent/severe).",
      inputSchema: listFindingsInputShape,
    },
    async ({ projectId, ...filters }) => {
      try {
        const findings = await service.listFindings(projectId, filters);
        return {
          content: [{ type: "text" as const, text: `${findings.length} finding(s).` }],
          structuredContent: { findings: findings as unknown[] },
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
