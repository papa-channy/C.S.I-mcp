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
    impact: z.number().int().min(1).max(5),
    exploitability: z.number().int().min(1).max(5),
    exposure: z.number().int().min(1).max(3),
    privilegeRequired: z.number().int().min(0).max(2),
    detectionDifficulty: z.number().int().min(0).max(2),
  }),
  priorityIndex: z.number().int().min(0).max(9),
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
