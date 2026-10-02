import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

const evidenceTypeEnum = z.enum([
  "CODE", "CONFIG", "AUTOMATED_TEST", "MANUAL_TEST", "SCAN", "LOG", "AUDIT_LOG", "ARCHITECTURE",
  "CI_ARTIFACT", "DEPLOYMENT_RECORD", "SCREENSHOT", "TICKET", "REPORT", "MANUAL_REVIEW",
]);

export const recordAssessmentInputShape = {
  projectId: z.string().min(1),
  runId: z.string().min(1),
  controlId: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"]),
  evidence: z.array(
    z.object({
      type: evidenceTypeEnum,
      location: z.string().min(1),
      description: z.string().optional(),
      searchScope: z
        .string()
        .min(1)
        .optional()
        .describe("What was actually searched (directories/files/packages) — required on at least one evidence item when status is PASS."),
      searchMethod: z
        .string()
        .min(1)
        .optional()
        .describe("The concrete search method used (e.g. a grep pattern) — required on at least one evidence item when status is PASS."),
      candidateCount: z.number().int().min(0).optional().describe("How many candidate matches the search turned up before exclusion."),
      excludedCandidates: z.string().optional().describe("Why each candidate (if any) was excluded as not exploitable/not applicable."),
    })
  ),
  notes: z.string().optional(),
  riskAcceptanceId: z.string().optional(),
  applicabilityOverride: z.object({ result: z.enum(["applicable", "not_applicable", "unknown"]), reason: z.string().min(1) }).optional(),
};

export function registerRecordAssessmentTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "record_assessment",
    { title: "Record Assessment", description: "Record (or update) a control's assessment for a project.", inputSchema: recordAssessmentInputShape },
    async (input) => {
      try {
        const assessment = await service.recordAssessment(input);
        return {
          content: [{ type: "text" as const, text: `Recorded "${assessment.controlId}" as ${assessment.status}.` }],
          structuredContent: assessment as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
