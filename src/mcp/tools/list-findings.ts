import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const listFindingsInputShape = {
  projectId: z.string().min(1),
  status: z.enum(["open", "in_progress", "resolved", "accepted", "false_positive"]).optional(),
  controlId: z.string().optional(),
  maxPriorityIndex: z.number().int().optional().describe("Return findings with priority.index at or below this value (0 = most urgent, so lower means more urgent)."),
  // NOT the same direction as maxPriorityIndex: criticality.index counts UP to more severe (9 = most
  // severe), the opposite of priority.index's "0 = most urgent" — so the "give me the worst findings"
  // filter here is a MINIMUM, not a maximum, even though it answers the same intent as maxPriorityIndex.
  minCriticalityIndex: z.number().int().optional().describe("Return findings with criticality.index at or above this value (0 = least severe, 9 = most severe, so this returns the most severe findings, not the mildest)."),
};

export function registerListFindingsTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "list_findings",
    {
      title: "List Findings",
      description:
        "List findings for a project, optionally filtered. priority.index and criticality.index BOTH range " +
        "0-9 but point opposite directions: priority.index counts down to more urgent (0 = most urgent), " +
        "criticality.index counts up to more severe (9 = most severe). maxPriorityIndex returns findings at " +
        "or below the given index (most urgent); minCriticalityIndex returns findings at or above the given " +
        "index (most severe) — both answer \"give me the worst findings\", but one is a max and the other a " +
        "min because the two scales run in opposite directions.",
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
