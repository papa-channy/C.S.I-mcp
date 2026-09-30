import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectService } from "../../service/project-service.js";
import { toErrorResult } from "./error-result.js";

export const getProjectInputShape = { projectId: z.string().min(1) };

export function registerGetProjectTool(server: McpServer, service: ProjectService): void {
  server.registerTool(
    "get_project",
    { title: "Get Project", description: "Fetch a project by id.", inputSchema: getProjectInputShape },
    async ({ projectId }) => {
      try {
        const project = await service.getProject(projectId);
        return {
          content: [{ type: "text" as const, text: `Project "${project.name}" (${project.projectId}).` }],
          structuredContent: project as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
