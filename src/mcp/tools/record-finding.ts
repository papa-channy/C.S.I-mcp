import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const recordFindingInputShape = {
  projectId: z.string().min(1),
  controlIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  attackScenario: z.string().min(1),
  severityFactors: z.object({
    impact: z.number().int().min(1).max(5).describe("1-5, higher is worse. How much damage successful exploitation would cause."),
    exploitability: z.number().int().min(1).max(5).describe("1-5, higher is worse. How easy the vulnerability is to exploit."),
    exposure: z.number().int().min(1).max(3).describe("1-3, higher is worse. How reachable the vulnerable surface is (e.g. internet-facing vs internal-only)."),
    privilegeRequired: z.number().int().min(0).max(2).describe("0-2, LOWER is worse — 0 means no privilege is needed before exploiting this, the worst case."),
    detectionDifficulty: z.number().int().min(0).max(2).describe("0-2, higher is worse. How hard successful exploitation would be to detect."),
  }),
  priorityIndex: z.number().int().min(0).max(9).describe("0-9, LOWER is more urgent — 0 is the most urgent priority, not the least."),
  priorityRationale: z.string().min(1),
  priorityOverrideReason: z.string().optional(),
};

export function registerRecordFindingTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "record_finding",
    { title: "Record Finding", description: "Record a new security finding linked to one or more controls.", inputSchema: recordFindingInputShape },
    async (input) => {
      try {
        const finding = await service.recordFinding(input);
        return {
          content: [{ type: "text" as const, text: `Recorded finding ${finding.findingId} (${finding.severity}).` }],
          structuredContent: finding as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
