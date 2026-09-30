import { describe, expect, it } from "vitest";
import { AnalysisService } from "../../src/service/analysis-service.js";
import { FakeRepository } from "./fake-repository.js";

function setScoreModel(repo: FakeRepository) {
  repo.scoreModel = {
    modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0",
    statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
    excludedStatuses: ["N/A", "ACCEPTED_RISK"],
  };
}

async function makeProject(repo: FakeRepository, securityLevel: string) {
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: "2026-09-30T00:00:00.000Z", profileRevision: 1,
    profile: { securityLevel, exposure: ["internet_public"], features: {}, technologies: {} },
  });
}

describe("AnalysisService.getScore", () => {
  it("computes a score from the project's assessments and controls", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-2");
    repo.controls = [{ controlId: "C-001", version: 1, status: "active", title: "t", domain: "appsec", subdomain: "s", layer: "prevent", group: "g", applicability: { when: { fact: "x", operator: "eq", value: 1 } } }];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "C-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    const service = new AnalysisService(repo);
    const score = await service.getScore("PRJ-1");
    expect(score.overallScore).toBe(100);
    expect(score.coverage.coveragePercent).toBe(100);
  });

  it("wraps calculateScore's zero-denominator throw as PRECONDITION_FAILED", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-2");
    await expect(new AnalysisService(repo).getScore("PRJ-1")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("AnalysisService.evaluateRelease", () => {
  it("reads securityLevel from the project, never from the caller", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-3");
    repo.controls = [];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "GOV-IR-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    await repo.saveControlAssessment({
      assessmentId: "A-2", projectId: "PRJ-1", controlId: "OPS-BACKUP-TEST-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    const evaluation = await new AnalysisService(repo).evaluateRelease("PRJ-1");
    expect(evaluation.result).toBe("approved");
    expect(evaluation.incidentResponseVerified).toBe(true);
    expect(evaluation.backupRestoreVerified).toBe(true);
  });

  it("has no securityLevel parameter at the type level", () => {
    const service = new AnalysisService(new FakeRepository());
    // @ts-expect-error evaluateRelease takes only a projectId — accepting a caller-supplied
    // securityLevel would let a call silently evaluate against a weaker gate than the
    // project's real one (spec §6's explicit security rationale).
    service.evaluateRelease("PRJ-1", "SVL-0").catch(() => {});
  });

  it("maps the SVL-0/SVL-1 precondition throw to PRECONDITION_FAILED", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-0");
    repo.controls = [{ controlId: "C-001", version: 1, status: "active", title: "t", domain: "appsec", subdomain: "s", layer: "prevent", group: "g", applicability: { when: { fact: "x", operator: "eq", value: 1 } } }];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "C-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    await expect(new AnalysisService(repo).evaluateRelease("PRJ-1")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
