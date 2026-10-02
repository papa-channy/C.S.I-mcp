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
        "Only confirmed_vulnerability findings count toward the production_release gate's " +
        "criticalFindings/highFindings thresholds — picking the right type is not cosmetic. " +
        "Work through these questions IN ORDER and stop at the first one that applies:\n" +
        "1. Did you trace a concrete, attacker-reachable path to impact end-to-end, with code " +
        "evidence for every step (not just the starting weakness)? -> confirmed_vulnerability.\n" +
        "2. Is there a real weakness and a plausible path, but you could not fully verify " +
        "reachability or finish tracing it (time-boxed, upstream caller not found in this " +
        "snapshot, etc.) -- honestly, not as a hedge? -> likely_vulnerability.\n" +
        "3. Is a concrete technical security mechanism (auth check, encryption, input " +
        "validation, SSRF/egress filtering, rate limiting, access control, audit-log write " +
        "call, etc.) that the control's OWN passCriteria requires simply absent, disabled, or " +
        "unenforced in the code/config/infra -- something you could point a remediation PR at? " +
        "-> control_gap. This applies even when exploiting the gap needs a separate " +
        "precondition (e.g. the attacker must already have a stolen password or database read " +
        "access) -- a precondition does not downgrade a missing mechanism to 'hardening'. The " +
        "test is 'does the control's text require this mechanism to exist', not 'is this " +
        "immediately exploitable from zero access'. Missing audit-log entries for admin " +
        "actions ARE control_gap under this test -- the remediation is still a concrete code " +
        "change (add the log-write call), not a process change.\n" +
        "4. Is the remediation inherently a human/organizational practice rather than a code " +
        "or config change -- a review that was never performed, a triage queue that was never " +
        "worked, a drill that was never run, a document that was never written -- where the " +
        "underlying mechanism may already exist (e.g. a scanner runs, but nobody triages what " +
        "it finds)? -> process_gap.\n" +
        "5. Does a working control already satisfy its passCriteria, and is this about making " +
        "defense genuinely deeper (not about meeting an unmet requirement)? -> hardening.\n" +
        "6. Did it look like a gap at first but turn out to be an intentional, justified " +
        "architecture choice once you traced it fully? -> accepted_design.\n" +
        "7. None of the above fit with confidence given the evidence you have? -> needs_validation. " +
        "Honest uncertainty beats forcing a confident-sounding label.\n" +
        "One finding should be one distinct defect with one remediation; if you're describing two " +
        "unrelated weaknesses (e.g. 'container runs as root' and 'TLS not enforced by default') " +
        "with different fixes, record them as two separate findings, not one combined finding."
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
