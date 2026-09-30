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
      description: "List catalog controls with their applicability and assessment status for a project.",
      inputSchema: listControlsInputShape,
    },
    async ({ projectId, ...filters }) => {
      try {
        // The service's listControls is overloaded on filters.detail ("summary" vs "full") to pick
        // its return type. Here `detail` arrives as a runtime-determined "summary" | "full" | undefined,
        // so no single overload matches at compile time; we don't need the return-type narrowing here
        // anyway since both shapes are just serialized into structuredContent below.
        const controls = await service.listControls(projectId, filters as ListControlsFilters & { detail?: "summary" });
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
