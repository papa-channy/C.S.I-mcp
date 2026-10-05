import { describe, expect, it } from "vitest";
import { ReportService } from "../../src/service/report-service.js";
import { RELEASE_BLOCKING_CONTROLS } from "../../src/core/release-evaluator.js";
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
  // All 8 RELEASE_BLOCKING_CONTROLS must have assessments for an "approved" result
  const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
  for (let i = 0; i < blockingControls.length; i++) {
    await repo.saveControlAssessment({
      assessmentId: `A-${i + 1}`, projectId: "PRJ-1", controlId: blockingControls[i], controlVersion: 1,
      runId: "RUN-1", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
    });
  }
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

describe("ReportService.generate — freshness-aware trust translation", () => {
  it("a stale assessment on a non-blocking-irrelevant control still lowers this report's coverage, even though a direct getScore call would not reflect it", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo); // all 8 blocking controls PASS, fresh (profileRevision 1)
    // Move the project's profile on — every already-recorded assessment is now stale.
    const project = await repo.getProject("PRJ-1");
    await repo.saveProject({ ...project, profileRevision: 2 });
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.releaseEvaluation.result).not.toBe("approved"); // every blocking control is now effectively NOT_TESTED
    expect(report.score.coverage.coveragePercent).toBe(0); // the saved report's own score reflects staleness too
  });

  it("an ACCEPTED_RISK assessment whose RiskAcceptance has since expired is reflected as not-yet-verified in the saved report, without mutating the stored assessment", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const [firstBlockingControl] = [...RELEASE_BLOCKING_CONTROLS];
    await repo.saveRiskAcceptance("PRJ-1", {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: firstBlockingControl, findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z", // expired before NOW
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    });
    await repo.saveControlAssessment({
      assessmentId: "A-ACCEPTED", projectId: "PRJ-1", controlId: firstBlockingControl, controlVersion: 1,
      runId: "RUN-1", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "ACCEPTED_RISK", evidenceIds: [], findingIds: [], riskAcceptanceId: "RA-001",
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: NOW, nextReviewAt: null, notes: null,
    });
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.releaseEvaluation.blockingControlsNotVerified).toContain(firstBlockingControl);
    const [stored] = (await repo.getControlAssessments("PRJ-1")).filter((a) => a.controlId === firstBlockingControl);
    expect(stored.status).toBe("ACCEPTED_RISK"); // stored record is never mutated
  });
});
