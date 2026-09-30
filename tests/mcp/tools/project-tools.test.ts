import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProjectService } from "../../../src/service/project-service.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { registerCreateProjectTool } from "../../../src/mcp/tools/create-project.js";
import { registerGetProjectTool } from "../../../src/mcp/tools/get-project.js";
import { registerUpdateProjectProfileTool } from "../../../src/mcp/tools/update-project-profile.js";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  const service = new ProjectService(repo, () => "2026-09-30T00:00:00.000Z");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCreateProjectTool(server, service);
  registerGetProjectTool(server, service);
  registerUpdateProjectProfileTool(server, service);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, repo };
}

describe("create_project tool", () => {
  it("creates a project and returns content + structuredContent", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({
      name: "create_project",
      arguments: { name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {} },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect((result.structuredContent as any).name).toBe("Demo");
    expect((result.structuredContent as any).projectId).toHaveLength(36);
  });
});

describe("get_project tool", () => {
  it("returns NOT_FOUND as a structured tool error for an unknown projectId", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "get_project", arguments: { projectId: "nope" } });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("NOT_FOUND");
  });
});

describe("update_project_profile tool", () => {
  it("omitting a field leaves it untouched; sending [] clears it", async () => {
    const { client } = await makeConnectedClient();
    const created = await client.callTool({
      name: "create_project",
      arguments: { name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {}, components: ["web"] },
    });
    const projectId = (created.structuredContent as any).projectId as string;

    const afterOmit = await client.callTool({ name: "update_project_profile", arguments: { projectId, securityLevel: "SVL-3" } });
    expect((afterOmit.structuredContent as any).profile.components).toEqual(["web"]);

    const afterClear = await client.callTool({ name: "update_project_profile", arguments: { projectId, components: [] } });
    expect((afterClear.structuredContent as any).profile.components).toEqual([]);
  });
});
