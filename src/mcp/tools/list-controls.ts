import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService, ListControlsFilters } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const listControlsInputShape = {
  projectId: z.string().min(1),
  domain: z.string().optional(),
  catalogStatus: z.enum(["draft", "active", "deprecated", "retired"]).optional(),
  applicability: z.enum(["applicable", "not_applicable", "unknown"]).optional(),
  assessmentStatus: z.enum(["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK", "NOT_ASSESSED"]).optional(),
  detail: z.enum(["summary", "full"]).optional(),
  controlIds: z.array(z.string()).optional(),
};

export function registerListControlsTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "list_controls",
    {
      title: "List Controls",
      description:
        "List catalog controls with their applicability and assessment status for a project. By default " +
        "(or detail: \"summary\") each entry is {controlId, title, domain, applicability, assessmentStatus, " +
        "findingCount} — enough to triage what to assess next, but not the full requirement text. Pass " +
        "detail: \"full\" (optionally combined with controlIds to scope it) to get the complete catalog " +
        "record instead (requirement, passCriteria, verification.methods, etc.) — this is a different " +
        "response shape for the same tool, not an addition to the summary fields.",
      inputSchema: listControlsInputShape,
    },
    async ({ projectId, ...filters }) => {
      try {
        // The service's listControls is overloaded on filters.detail ("summary" vs "full") to pick
        // its return type. Branch on the actual runtime value (via a plain local, so TS control-flow
        // narrowing applies) so each call site resolves to its own correct overload, rather than
        // casting filters to force a single overload regardless of the real detail value.
        const { detail, ...rest } = filters;
        const controls = detail === "full"
          ? await service.listControls(projectId, { ...rest, detail: "full" as const })
          : await service.listControls(projectId, { ...rest, detail });
        return {
          content: [{ type: "text" as const, text: `${controls.length} control(s).` }],
          structuredContent: { controls },
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
