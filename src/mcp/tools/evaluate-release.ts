import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "../../service/analysis-service.js";
import { toErrorResult } from "./error-result.js";

// projectId only, deliberately — securityLevel is read server-side from the project's own
// profile (spec §6): accepting it as a parameter here would let a call silently evaluate
// against a weaker gate than the project's real one.
export const evaluateReleaseInputShape = { projectId: z.string().min(1) };

export function registerEvaluateReleaseTool(server: McpServer, service: AnalysisService): void {
  server.registerTool(
    "evaluate_release",
    {
      title: "Evaluate Release",
      description:
        "Evaluate gate-4 production-release readiness for a project. `result` (\"approved\"|\"blocked\"|" +
        "\"indeterminate\") is the worst-wins combination of three gates: a Finding Gate (open/in-progress " +
        "confirmed_vulnerability findings at critical/high severity — any blocks), a Control Gate (a fixed " +
        "set of release-blocking controls — any at FAIL blocks; any PARTIAL/NOT_TESTED/unassessed makes it " +
        "indeterminate instead of approved), and a Coverage Gate (assessment coverage below threshold makes " +
        "it indeterminate, never downgrading an already-blocked result). `blockingControlFailures` and " +
        "`blockingControlsNotVerified` are arrays of controlIds — the release-blocking controls that are " +
        "currently FAILing / not yet verified (PARTIAL, NOT_TESTED, or never assessed), respectively — so " +
        "callers can see exactly which controls drove the Control Gate's contribution to `result`. " +
        "`incidentResponseVerified` and `backupRestoreVerified` are informational booleans for two of those " +
        "same controls specifically (GOV-IR-001/OPS-BACKUP-TEST-001 PASSed) — redundant with, but narrower " +
        "than, the two array fields above (which cover all release-blocking controls, not just these two); " +
        "both controls DO now gate `result` via the Control Gate, so a FAIL on either forces `result: " +
        "\"blocked\"`. Check the array fields for the full picture; check these two booleans only if your " +
        "use case specifically cares about incident-response/backup-restore readiness by name.",
      inputSchema: evaluateReleaseInputShape,
    },
    async ({ projectId }) => {
      try {
        const evaluation = await service.evaluateRelease(projectId);
        return {
          content: [{ type: "text" as const, text: `Release evaluation: ${evaluation.result}.` }],
          structuredContent: evaluation as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
