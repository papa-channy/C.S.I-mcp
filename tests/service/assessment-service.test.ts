import { describe, expect, it } from "vitest";
import { AssessmentService } from "../../src/service/assessment-service.js";
import { FakeRepository } from "./fake-repository.js";
import type { Control } from "../../src/core/repository.js";

const FIXED_NOW = "2026-09-30T00:00:00.000Z";

function control(overrides: Partial<Control> = {}): Control {
  return {
    controlId: "APP-INPUT-VAL-001", version: 1, status: "active", title: "Validate input",
    domain: "appsec", subdomain: "input", layer: "prevent", group: "validation",
    applicability: { when: { fact: "features.authentication", operator: "eq", value: true } },
    ...overrides,
  };
}

async function makeProjectRepo() {
  const repo = new FakeRepository();
  repo.catalogVersion = "9.9.9";
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: FIXED_NOW, profileRevision: 3,
    profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} },
  });
  return repo;
}

describe("AssessmentService.startAssessmentRun", () => {
  it("creates a new default plan and a run referencing it, on first call", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.startAssessmentRun("PRJ-1");
    expect(result.startedAt).toBe(FIXED_NOW);
    expect(result.runId).toHaveLength(36);

    const run = await repo.getRun("PRJ-1", result.runId);
    expect(run.projectId).toBe("PRJ-1");
    expect(run.planVersion).toBe(1);
    expect(run.profileRevision).toBe(3);
    expect(run.catalogVersion).toBe("9.9.9");
    expect(run.status).toBe("running");
    expect(run.batchIds).toEqual([]);

    const plan = await repo.getPlan(run.planId);
    expect(plan.projectId).toBe("PRJ-1");
    expect(plan.groupBy).toBe("controlId");
  });

  it("reuses the same default plan across two runs for the same project", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const first = await service.startAssessmentRun("PRJ-1");
    const second = await service.startAssessmentRun("PRJ-1");
    const firstRun = await repo.getRun("PRJ-1", first.runId);
    const secondRun = await repo.getRun("PRJ-1", second.runId);
    expect(firstRun.planId).toBe(secondRun.planId);
    expect(repo.plans.size).toBe(1);
  });

  it("throws NOT_FOUND for an unknown projectId", async () => {
    const repo = new FakeRepository();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.startAssessmentRun("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("AssessmentService.listControls", () => {
  it("returns summaries by default, with applicability and NOT_ASSESSED status when unassessed", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.listControls("PRJ-1");
    expect(result).toEqual([
      { controlId: "APP-INPUT-VAL-001", title: "Validate input", domain: "appsec", applicability: "applicable", assessmentStatus: "NOT_ASSESSED", findingCount: 0 },
    ]);
  });

  it("reflects an existing ControlAssessment's status", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: FIXED_NOW, nextReviewAt: null, notes: null,
    });
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const [summary] = await service.listControls("PRJ-1");
    expect(summary.assessmentStatus).toBe("PASS");
  });

  it("filters by domain", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control(), control({ controlId: "OPS-BACKUP-TEST-001", domain: "operations" })];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.listControls("PRJ-1", { domain: "operations" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ controlId: "OPS-BACKUP-TEST-001" });
  });

  it("returns full catalog records when detail is 'full'", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const [full] = await service.listControls("PRJ-1", { detail: "full" });
    expect(full).toMatchObject({ controlId: "APP-INPUT-VAL-001", version: 1, applicability: expect.any(Object) });
  });
});
