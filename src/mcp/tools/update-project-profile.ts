import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectService } from "../../service/project-service.js";
import { toErrorResult } from "./error-result.js";

export const updateProjectProfileInputShape = {
  projectId: z.string().min(1),
  securityLevel: z.enum(["SVL-0", "SVL-1", "SVL-2", "SVL-3"]).optional(),
  exposure: z.array(z.enum(["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"])).min(1).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  technologies: z.object({
    languages: z.array(z.string()).optional(), frameworks: z.array(z.string()).optional(),
    databases: z.array(z.string()).optional(), cloud: z.array(z.string()).optional(),
  }).optional(),
  components: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Three-valued: omit to leave the current value untouched; [] clears it to KNOWN-NONE; a populated " +
        "list sets it to KNOWN. Only these 8 values currently drive any control's applicability: backend_api, " +
        "browser_frontend, ci_pipeline, container_image, database, file_storage, mobile_app, release_pipeline " +
        "— other values are accepted but purely informational."
    ),
  identities: z
    .array(z.enum(["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"]))
    .optional()
    .describe("Three-valued: omit to leave the current value untouched; [] clears it to KNOWN-NONE; a populated list sets it to KNOWN."),
  dataClasses: z
    .array(z.enum(["D0", "D1", "D2", "D3"]))
    .optional()
    .describe("Three-valued: omit to leave the current value untouched; [] clears it to KNOWN-NONE; a populated list sets it to KNOWN."),
};

export function registerUpdateProjectProfileTool(server: McpServer, service: ProjectService): void {
  server.registerTool(
    "update_project_profile",
    {
      title: "Update Project Profile",
      description:
        "Patch a project's security profile. A field left out of this call is untouched; " +
        "sending [] for components/identities/dataClasses clears it to KNOWN-NONE. Every call bumps " +
        "the project's profileRevision, even a no-op or repeated patch — and every existing control " +
        "assessment recorded under a prior revision is treated as NOT_TESTED by evaluate_release and " +
        "generate_report_data from that point on. A new assessment run is required after this call before " +
        "release evaluation can show full coverage again.",
      inputSchema: updateProjectProfileInputShape,
    },
    async ({ projectId, ...patch }) => {
      try {
        const project = await service.updateProjectProfile(projectId, patch);
        return {
          content: [{ type: "text" as const, text: `Updated profile for "${project.name}" (revision ${project.profileRevision}).` }],
          structuredContent: project as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
