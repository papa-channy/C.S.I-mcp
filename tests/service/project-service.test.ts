import { describe, expect, it } from "vitest";
import { ProjectService } from "../../src/service/project-service.js";
import { FakeRepository } from "./fake-repository.js";

const FIXED_NOW = "2026-09-30T00:00:00.000Z";
function makeService() {
  const repo = new FakeRepository();
  const service = new ProjectService(repo, () => FIXED_NOW);
  return { repo, service };
}

describe("ProjectService.createProject", () => {
  it("creates a project with profileRevision 1 and a generated projectId", async () => {
    const { service, repo } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: { authentication: true }, technologies: { languages: ["ts"] },
    });
    expect(project.name).toBe("Demo");
    expect(project.profileRevision).toBe(1);
    expect(project.createdAt).toBe(FIXED_NOW);
    expect(project.projectId).toHaveLength(36);
    expect(await repo.getProject(project.projectId)).toEqual(project);
  });

  it("omits components/identities/dataClasses when not provided (UNKNOWN, not KNOWN-NONE)", async () => {
    const { service } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: {}, technologies: {},
    });
    expect(project.profile).not.toHaveProperty("components");
    expect(project.profile).not.toHaveProperty("identities");
    expect(project.profile).not.toHaveProperty("dataClasses");
  });

  it("carries components/identities/dataClasses through as KNOWN when provided, including []", async () => {
    const { service } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: {}, technologies: {}, components: [], identities: ["user"], dataClasses: ["D1"],
    });
    expect(project.profile.components).toEqual([]);
    expect(project.profile.identities).toEqual(["user"]);
    expect(project.profile.dataClasses).toEqual(["D1"]);
  });
});

describe("ProjectService.getProject", () => {
  it("returns the project when it exists", async () => {
    const { service, repo } = makeService();
    const created = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {},
    });
    expect(await service.getProject(created.projectId)).toEqual(await repo.getProject(created.projectId));
  });

  it("throws a NOT_FOUND ServiceError when the project does not exist", async () => {
    const { service } = makeService();
    await expect(service.getProject("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ProjectService.updateProjectProfile — three-valued patch semantics", () => {
  async function makeProject() {
    const { service, repo } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: { authentication: true }, technologies: { languages: ["ts"] }, components: ["web-app"],
    });
    return { service, repo, project };
  }

  it("a field absent from the patch leaves the stored value untouched", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { securityLevel: "SVL-3" });
    expect(updated.profile.components).toEqual(["web-app"]);
    expect(updated.profile.securityLevel).toBe("SVL-3");
  });

  it("a field present as [] clears it to KNOWN-NONE", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { components: [] });
    expect(updated.profile.components).toEqual([]);
  });

  it("a field present with values sets it to KNOWN-VALUES", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { components: ["api", "worker"] });
    expect(updated.profile.components).toEqual(["api", "worker"]);
  });

  it("increments profileRevision by 1 on every successful update", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { securityLevel: "SVL-3" });
    expect(updated.profileRevision).toBe(project.profileRevision + 1);
  });

  it("persists the update via saveProject", async () => {
    const { service, repo, project } = await makeProject();
    await service.updateProjectProfile(project.projectId, { securityLevel: "SVL-1" });
    expect((await repo.getProject(project.projectId)).profile.securityLevel).toBe("SVL-1");
  });
});
