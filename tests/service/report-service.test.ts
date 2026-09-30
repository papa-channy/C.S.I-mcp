import { describe, expect, it } from "vitest";
import { ReportService } from "../../src/service/report-service.js";
import { FakeRepository } from "./fake-repository.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function makeGeneratableProject(repo: FakeRepository) {
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
  });
  repo.scoreModel = { modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0", statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 }, excludedStatuses: ["N/A", "ACCEPTED_RISK"] };
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
  repo.controls = [];
  await repo.saveRun({
    runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
    catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: NOW, completedAt: null,
  });
  await repo.saveControlAssessment({
    assessmentId: "A-1", projectId: "PRJ-1", controlId: "GOV-IR-001", controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
  });
  await repo.saveControlAssessment({
    assessmentId: "A-2", projectId: "PRJ-1", controlId: "OPS-BACKUP-TEST-001", controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
  });
}

describe("ReportService.generate", () => {
  it("produces a ProjectReport built from one loaded snapshot and persists it", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "all clear" });
    expect(report.projectId).toBe("PRJ-1");
    expect(report.assessmentRunId).toBe("RUN-1");
    expect(report.catalogVersion).toBe("9.9.9");
    expect(report.releaseEvaluation.result).toBe("approved");
    expect(report.summary).toBe("all clear");
    expect(await repo.reports.get(report.reportId)).toEqual(report);
  });

  it("throws NOT_FOUND for an unknown runId", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW);
    await expect(service.generate({ projectId: "PRJ-1", runId: "NOPE", summary: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
