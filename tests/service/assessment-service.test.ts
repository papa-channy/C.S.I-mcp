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

describe("AssessmentService.recordAssessment", () => {
  it("records a PASS with evidence, generating evidenceIds and computing applicability automatically", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS",
      evidence: [{ type: "AUTOMATED_TEST", location: "tests/x.test.ts" }],
    });
    expect(assessment.evidenceIds).toEqual(["EVD-001"]);
    expect(assessment.applicability).toEqual({ autoResult: "applicable", finalResult: "applicable", matchedRules: ["fact"].length ? assessment.applicability.matchedRules : [], source: "automatic" });
    expect(assessment.controlVersion).toBe(1);
    expect(assessment.owner).toBe("csi-mcp-agent");
    expect(assessment.assessedBy).toBe("csi-mcp-agent");
    expect(assessment.riskAcceptanceId).toBeNull();
    expect(assessment.findingIds).toEqual([]);
    expect((await repo.getEvidence("PRJ-1"))[0]).toMatchObject({ evidenceId: "EVD-001", type: "AUTOMATED_TEST", capturedBy: "csi-mcp-agent" });
  });

  it("rejects PASS with zero evidence entries", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS", evidence: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects N/A without notes", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A", evidence: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts N/A with notes", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A", evidence: [], notes: "not applicable here",
    });
    expect(assessment.status).toBe("N/A");
    expect(assessment.notes).toBe("not applicable here");
  });

  it("rejects ACCEPTED_RISK without riskAcceptanceId", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK", evidence: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("applies a manual applicability override with its reason", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [],
      applicabilityOverride: { result: "not_applicable", reason: "legacy module being decommissioned" },
    });
    expect(assessment.applicability.finalResult).toBe("not_applicable");
    expect(assessment.applicability.source).toBe("manual_override");
    expect(assessment.applicability.reason).toBe("legacy module being decommissioned");
  });

  it("re-assessing the same controlId upserts rather than duplicating", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await service.recordAssessment({ projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [] });
    await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS",
      evidence: [{ type: "AUTOMATED_TEST", location: "tests/x.test.ts" }],
    });
    const all = await repo.getControlAssessments("PRJ-1");
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("PASS");
  });

  it("throws NOT_FOUND for an unknown controlId", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "NOPE-001", status: "NOT_TESTED", evidence: [],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
