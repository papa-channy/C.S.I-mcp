import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RiskAcceptanceService } from "../../service/risk-acceptance-service.js";
import { toErrorResult } from "./error-result.js";

export const revokeRiskAcceptanceInputShape = {
  projectId: z.string().min(1),
  riskAcceptanceId: z.string().min(1),
  revokedReason: z.string().min(1),
};

export function registerRevokeRiskAcceptanceTool(server: McpServer, service: RiskAcceptanceService): void {
  server.registerTool(
    "revoke_risk_acceptance",
    {
      title: "Revoke Risk Acceptance",
      description:
        "Revoke a RiskAcceptance before its natural expiry. Idempotent: revoking an already-revoked " +
        "record returns it unchanged rather than erroring, so a retried call never fails just because " +
        "it already succeeded.",
      inputSchema: revokeRiskAcceptanceInputShape,
    },
    async (input) => {
      try {
        const revoked = await service.revoke(input);
        return {
          content: [{ type: "text" as const, text: `Revoked risk acceptance ${revoked.riskAcceptanceId}.` }],
          structuredContent: revoked as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
