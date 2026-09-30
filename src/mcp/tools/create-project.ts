import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectService } from "../../service/project-service.js";
import { toErrorResult } from "./error-result.js";

export const createProjectInputShape = {
  name: z.string().min(1),
  owner: z.string().min(1),
  securityLevel: z.enum(["SVL-0", "SVL-1", "SVL-2", "SVL-3"]),
  exposure: z.array(z.enum(["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"])).min(1),
  features: z.record(z.string(), z.boolean()),
  technologies: z.object({
    languages: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
    databases: z.array(z.string()).optional(),
    cloud: z.array(z.string()).optional(),
  }),
  components: z.array(z.string().min(1)).optional(),
  identities: z.array(z.enum(["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"])).optional(),
  dataClasses: z.array(z.enum(["D0", "D1", "D2", "D3"])).optional(),
};

export function registerCreateProjectTool(server: McpServer, service: ProjectService): void {
  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description: "Create a new project with its initial security profile.",
      inputSchema: createProjectInputShape,
    },
    async (input) => {
      try {
        const project = await service.createProject(input);
        return {
          content: [{ type: "text" as const, text: `Created project "${project.name}" (${project.projectId}).` }],
          structuredContent: project as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
