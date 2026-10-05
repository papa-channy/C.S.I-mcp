import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RiskAcceptanceService } from "../../service/risk-acceptance-service.js";
import { toErrorResult } from "./error-result.js";

export const recordRiskAcceptanceInputShape = {
  projectId: z.string().min(1),
  controlId: z.string().min(1),
  findingIds: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  compensatingControls: z.array(z.string().min(1)).optional(),
  expiresAt: z.string().min(1),
  reviewDate: z.string().optional(),
};

export function registerRecordRiskAcceptanceTool(server: McpServer, service: RiskAcceptanceService): void {
  server.registerTool(
    "record_risk_acceptance",
    {
      title: "Record Risk Acceptance",
      description:
        "Create a RiskAcceptance for a control — required before record_assessment will accept status " +
        "\"ACCEPTED_RISK\" for that control. In the current single-user local stdio MCP deployment, " +
        "possession of local MCP access constitutes approval authority — this tool does not verify a " +
        "separate human approver identity.",
      inputSchema: recordRiskAcceptanceInputShape,
    },
    async (input) => {
      try {
        const ra = await service.record(input);
        return {
          content: [{ type: "text" as const, text: `Recorded risk acceptance ${ra.riskAcceptanceId} for ${ra.controlId}.` }],
          structuredContent: ra as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
