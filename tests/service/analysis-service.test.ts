import { describe, expect, it } from "vitest";
import { AnalysisService } from "../../src/service/analysis-service.js";
import { RELEASE_BLOCKING_CONTROLS } from "../../src/core/release-evaluator.js";
import { FakeRepository } from "./fake-repository.js";
import type { Control } from "../../src/core/repository.js";

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
      runId: "RUN-1", profileRevision: 1,
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

  it("throws NOT_FOUND for an unknown projectId, distinct from the zero-assessments precondition failure", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await expect(new AnalysisService(repo).getScore("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("AnalysisService.evaluateRelease", () => {
  it("reads securityLevel from the project, never from the caller", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-3");
    repo.controls = [];
    // All 8 RELEASE_BLOCKING_CONTROLS must have assessments for an "approved" result
    const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
    for (let i = 0; i < blockingControls.length; i++) {
      await repo.saveControlAssessment({
        assessmentId: `A-${i + 1}`, projectId: "PRJ-1", controlId: blockingControls[i], controlVersion: 1,
        runId: "RUN-1", profileRevision: 1,
        applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
        status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
      });
    }
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
      runId: "RUN-1", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    await expect(new AnalysisService(repo).evaluateRelease("PRJ-1")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

const NOW = "2026-10-05T12:00:00.000Z";

function blockingControl(controlId: string, overrides: Partial<Control> = {}): Control {
  return {
    controlId, version: 1, status: "active", title: controlId, domain: "test", subdomain: "test",
    layer: "prevent", group: "test", applicability: { when: { fact: "features.authentication", operator: "eq", value: true } },
    ...overrides,
  };
}

async function makeProjectRepo(profileRevision = 1) {
  const repo = new FakeRepository();
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision,
    profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} },
  });
  await repo.saveRun({
    runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision,
    catalogVersion: "1.0.0", batchIds: [], status: "running", startedAt: NOW, completedAt: null,
  });
  repo.scoreModel = {
    modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0",
    statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
    excludedStatuses: ["N/A", "ACCEPTED_RISK"],
  };
  return repo;
}

function passAssessment(controlId: string, overrides: Partial<import("../../src/core/repository.js").ControlAssessment> = {}) {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-1", controlId, controlVersion: 1,
    runId: "RUN-1", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" as const },
    status: "PASS" as const, evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: NOW, nextReviewAt: null, notes: null,
    ...overrides,
  };
}

describe("AnalysisService.evaluateRelease — staleness translation", () => {
  it("a fresh PASS assessment (profileRevision matches project) contributes normally", async () => {
    const repo = await makeProjectRepo(1);
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveControlAssessment(passAssessment("TEST-001", { profileRevision: 1 }));
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(100);
  });

  it("a stale assessment (profileRevision does not match the project's current one) is translated to NOT_TESTED for this evaluation", async () => {
    const repo = await makeProjectRepo(2); // project moved to revision 2
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveControlAssessment(passAssessment("TEST-001", { profileRevision: 1 })); // recorded under revision 1
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(0); // the only control is now effectively NOT_TESTED
    const [stored] = await repo.getControlAssessments("PRJ-1");
    expect(stored.status).toBe("PASS"); // stored record is never mutated
  });
});

describe("AnalysisService.evaluateRelease — ACCEPTED_RISK re-validation", () => {
  it("an ACCEPTED_RISK assessment backed by a valid RiskAcceptance contributes normally (excluded from coverage denominator, same as before)", async () => {
    const repo = await makeProjectRepo(1);
    repo.controls = [blockingControl("TEST-001"), blockingControl("TEST-002")];
    await repo.saveRiskAcceptance("PRJ-1", {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    });
    await repo.saveControlAssessment(passAssessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" }));
    await repo.saveControlAssessment(passAssessment("TEST-002"));
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(100); // TEST-001 excluded (ACCEPTED_RISK), TEST-002 assessed -> 100% of applicable
  });

  it("an ACCEPTED_RISK assessment whose RiskAcceptance has since expired is translated to NOT_TESTED, without mutating the stored assessment", async () => {
    const repo = await makeProjectRepo(1);
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveRiskAcceptance("PRJ-1", {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", // expired before NOW (2026-10-05)
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    });
    await repo.saveControlAssessment(passAssessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" }));
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(0); // now effectively NOT_TESTED, no longer excluded
    const [stored] = await repo.getControlAssessments("PRJ-1");
    expect(stored.status).toBe("ACCEPTED_RISK"); // stored record is never mutated
  });
});

describe("AnalysisService.evaluateRelease — Coverage Gate uses the same translated view as the Control Gate", () => {
  it("coverage computed inside evaluateRelease reflects staleness, even though standalone getScore does not", async () => {
    const repo = await makeProjectRepo(2); // project at revision 2
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveControlAssessment(passAssessment("TEST-001", { profileRevision: 1 })); // stale
    const service = new AnalysisService(repo, () => NOW);

    const released = await service.evaluateRelease("PRJ-1");
    expect(released.controlCoverage).toBe(0); // freshness-aware: the stale PASS doesn't count as covered

    const standalone = await service.getScore("PRJ-1");
    expect(standalone.coverage.coveragePercent).toBe(100); // unaffected: getScore reads raw assessments
  });
});

describe("AnalysisService.evaluateRelease — staleness drives the verdict, not just the numbers", () => {
  it("all 8 blocking controls fresh and PASS, but enough non-blocking controls stale to drop translated coverage below the approval threshold: result is indeterminate, not approved", async () => {
    const repo = await makeProjectRepo(2); // project at revision 2
    const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
    repo.controls = [
      ...blockingControls.map((id) => blockingControl(id)),
      ...["NB-001", "NB-002", "NB-003", "NB-004"].map((id) => blockingControl(id)),
    ];
    for (const id of blockingControls) {
      await repo.saveControlAssessment(passAssessment(id, { assessmentId: `A-${id}`, profileRevision: 2 })); // fresh
    }
    for (const id of ["NB-001", "NB-002", "NB-003", "NB-004"]) {
      await repo.saveControlAssessment(passAssessment(id, { assessmentId: `A-${id}`, profileRevision: 1 })); // stale
    }
    const service = new AnalysisService(repo, () => NOW);

    const raw = await service.getScore("PRJ-1");
    expect(raw.coverage.coveragePercent).toBe(100); // raw view: every control looks assessed

    const released = await service.evaluateRelease("PRJ-1");
    expect(released.controlCoverage).toBeLessThan(80); // translated view: the 4 stale controls count as NOT_TESTED
    expect(released.blockingControlsNotVerified).toEqual([]); // every blocking control is fresh and PASS
    expect(released.result).toBe("indeterminate"); // coverage gate alone drives this, not the control gate
  });

  it("flipping exactly one blocking control's profileRevision to stale puts it in blockingControlsNotVerified and prevents approval", async () => {
    const repo = await makeProjectRepo(2); // project at revision 2
    const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
    repo.controls = blockingControls.map((id) => blockingControl(id));
    const staleControlId = blockingControls[0];
    for (const id of blockingControls) {
      await repo.saveControlAssessment(
        passAssessment(id, { assessmentId: `A-${id}`, profileRevision: id === staleControlId ? 1 : 2 })
      );
    }
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.blockingControlsNotVerified).toEqual([staleControlId]);
    expect(result.result).toBe("indeterminate");
    expect(result.result).not.toBe("approved");
  });
});
