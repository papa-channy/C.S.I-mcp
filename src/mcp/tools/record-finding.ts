import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const recordFindingInputShape = {
  projectId: z.string().min(1),
  controlIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  type: z
    .enum([
      "confirmed_vulnerability",
      "likely_vulnerability",
      "control_gap",
      "hardening",
      "process_gap",
      "accepted_design",
      "needs_validation",
    ])
    .describe(
      "What kind of thing this finding actually is, independent of severity. " +
        "confirmed_vulnerability: an attack path traced end-to-end with code evidence. " +
        "likely_vulnerability: a plausible weakness identified but not fully traced/verified. " +
        "control_gap: a required security control is simply missing or unenforced. " +
        "hardening: the control exists but could be strengthened; not exploitable as-is. " +
        "process_gap: an organizational/operational control is missing (e.g. no audit log), not an app defect. " +
        "accepted_design: looks like a gap but is actually an intentional architecture choice. " +
        "needs_validation: evidence is insufficient to classify confidently yet. " +
        "Only confirmed_vulnerability findings count toward the production_release gate's criticalFindings/highFindings thresholds."
    ),
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
  exploitabilityEvidence: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Required when the computed severity is critical or high. The concrete, end-to-end attack path (with code citation) that makes this finding exploitable — not a restatement of the severity factors."
    ),
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
