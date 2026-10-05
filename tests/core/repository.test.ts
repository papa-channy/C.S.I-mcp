import { describe, expect, it } from "vitest";
import { JsonRepository } from "../../src/core/repository.js";

describe("JsonRepository — catalog reads (real data/ tree)", () => {
  const repo = new JsonRepository("data");

  it("getControls returns all 48 real controls", async () => {
    const controls = await repo.getControls();
    expect(controls.length).toBe(48);
  });

  it("getThreats returns the real threat catalog", async () => {
    const threats = await repo.getThreats();
    expect(threats.length).toBeGreaterThan(0);
  });

  it("getCriticalityFormula returns the real formula for its own id", async () => {
    const formula = await repo.getCriticalityFormula("CRIT-DEFAULT");
    expect(formula.weights.impact).toBe(0.35);
  });

  it("getCriticalityFormula throws for an unknown formulaId", async () => {
    await expect(repo.getCriticalityFormula("NOPE")).rejects.toThrow();
  });

  it("getScoreModel returns the real model for its own id", async () => {
    const model = await repo.getScoreModel("USSVS-SCORE-DEFAULT");
    expect(model.statusWeights.PASS).toBe(1.0);
  });

  it("getScoreModel throws for an unknown modelId", async () => {
    await expect(repo.getScoreModel("NOPE")).rejects.toThrow();
  });

  it("getReleaseGates returns gate 4's requiresByLevel thresholds", async () => {
    const gates = await repo.getReleaseGates();
    const gate4 = gates.gates.find((g) => g.gate === 4);
    expect(gate4?.requiresByLevel?.["SVL-3"]).toEqual({ criticalFindings: 0, highFindings: 0 });
  });
});

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import type { AssessmentBatch, AssessmentRun, ControlAssessment, Evidence, Finding, Project, RiskAcceptance } from "../../src/core/repository.js";
import type { ProjectReport } from "../../src/core/report-builder.js";
import type { AssessmentPlan } from "../../src/core/plan-expander.js";

describe("JsonRepository — project-instance read/write (temp data/ tree)", () => {
  let dir: string;
  let repo: JsonRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csi-mcp-repo-"));
    repo = new JsonRepository(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("getControlAssessments returns [] for a project with no assessments.json yet", async () => {
    expect(await repo.getControlAssessments("PRJ-1")).toEqual([]);
  });

  it("getFindings returns [] for a project with no findings.json yet", async () => {
    expect(await repo.getFindings("PRJ-1")).toEqual([]);
  });

  it("saveRun then reload round-trips the AssessmentRun", async () => {
    const run: AssessmentRun = {
      runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "pending",
    };
    await repo.saveRun(run);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "runs", "RUN-1.json")));
    expect(reloaded).toEqual(run);
  });

  it("saveBatch then reload round-trips the AssessmentBatch", async () => {
    const batch: AssessmentBatch = { batchId: "BATCH-1", projectId: "PRJ-1", status: "pending" };
    await repo.saveBatch(batch);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "batches", "BATCH-1.json")));
    expect(reloaded).toEqual(batch);
  });

  it("saveReport then reload round-trips the ProjectReport", async () => {
    const report = {
      reportId: "REP-1", projectId: "PRJ-1", assessmentRunId: "RUN-1", catalogVersion: "1.0.0", profileRevision: 1,
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" }, generatedAt: "2026-09-28T00:00:00.000Z",
      score: { overallScore: 80, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "M", version: "1" }, domainScores: [] },
      prioritizedFindings: [], releaseEvaluation: { gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" as const },
      summary: "ok",
    } satisfies ProjectReport;
    await repo.saveReport(report);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "reports", "REP-1.json")));
    expect(reloaded).toEqual(report);
  });

  it("saveRun does not leave a .tmp-* file behind after a successful write", async () => {
    await repo.saveRun({
      runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "pending",
    });
    const files = readdirSync(join(dir, "projects", "PRJ-1", "runs"));
    expect(files).toEqual(["RUN-1.json"]);
  });

  it("getPlan reads a flat data/plans/<planId>.json file", async () => {
    mkdirSync(join(dir, "plans"), { recursive: true });
    const plan: AssessmentPlan = { planId: "PLAN-1", groupBy: "domain", defaultMaxParallelAgents: 1 };
    writeFileSync(join(dir, "plans", "PLAN-1.json"), JSON.stringify(plan));
    expect(await repo.getPlan("PLAN-1")).toEqual(plan);
  });

  it("getPlan rejects a path-traversal planId rather than reading outside the data dir", async () => {
    await expect(repo.getPlan("../../../etc/passwd")).rejects.toThrow();
  });

  it("getEvidence returns [] for a project with no evidence.json yet", async () => {
    expect(await repo.getEvidence("PRJ-1")).toEqual([]);
  });

  it("getCatalogVersion reads the real manifest's catalogVersion", async () => {
    const realRepo = new JsonRepository("data");
    expect(await realRepo.getCatalogVersion()).toBe("2.1.0");
  });

  it("getRun rejects a path-traversal runId rather than reading outside the data dir", async () => {
    await expect(repo.getRun("PRJ-1", "../../../etc/passwd")).rejects.toThrow();
  });

  it("saveProject then reload round-trips the Project", async () => {
    const project: Project = {
      projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: "2026-09-30T00:00:00.000Z",
      profileRevision: 1,
      profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {} },
    };
    await repo.saveProject(project);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "project.json")));
    expect(reloaded).toEqual(project);
  });

  it("saveFinding then reload round-trips the Finding under the project's findings.json", async () => {
    const finding: Finding = {
      findingId: "FND-001", title: "SQLi", type: "confirmed_vulnerability", controlIds: ["APP-INPUT-VAL-001"], attackScenario: "x",
      impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2,
      criticality: { index: 9, formulaId: "CRIT-DEFAULT", formulaVersion: "1.0.0", computedAt: "2026-09-30T00:00:00.000Z" },
      priority: { index: 0, source: "agent", rationale: "r", assignedBy: "csi-mcp-agent", assignedAt: "2026-09-30T00:00:00.000Z" },
      severity: "critical", status: "open",
    };
    await repo.saveFinding("PRJ-1", finding);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "findings.json")));
    expect(reloaded).toEqual([finding]);
  });

  it("saveEvidence then reload round-trips the Evidence under the project's evidence.json", async () => {
    const evidence: Evidence = {
      evidenceId: "EVD-001", type: "SCREENSHOT", location: "s3://x", capturedAt: "2026-09-30T00:00:00.000Z", capturedBy: "csi-mcp-agent",
    };
    await repo.saveEvidence("PRJ-1", evidence);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "evidence.json")));
    expect(reloaded).toEqual([evidence]);
  });

  it("saveControlAssessment appends a new controlId but replaces an existing one (upsert)", async () => {
    const first: ControlAssessment = {
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", controlVersion: 1,
      runId: "RUN-1", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "NOT_TESTED", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    };
    await repo.saveControlAssessment(first);
    const second = { ...first, assessmentId: "A-2", status: "PASS" as const };
    await repo.saveControlAssessment(second);
    const all = await repo.getControlAssessments("PRJ-1");
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(second);

    const other: ControlAssessment = { ...first, assessmentId: "A-3", controlId: "APP-INPUT-VAL-002" };
    await repo.saveControlAssessment(other);
    expect(await repo.getControlAssessments("PRJ-1")).toHaveLength(2);
  });

  it("savePlan then getPlan round-trips the AssessmentPlan", async () => {
    const plan: AssessmentPlan = {
      planId: "PLAN-DEFAULT-PRJ-1", version: 1, projectId: "PRJ-1", groupBy: "controlId",
      defaultMaxParallelAgents: 1, createdAt: "2026-09-30T00:00:00.000Z",
    };
    await repo.savePlan(plan);
    expect(await repo.getPlan("PLAN-DEFAULT-PRJ-1")).toEqual(plan);
  });

  it("saveRun then getRun round-trips the AssessmentRun", async () => {
    const run: AssessmentRun = {
      runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "running", startedAt: "2026-09-30T00:00:00.000Z", completedAt: null,
    };
    await repo.saveRun(run);
    expect(await repo.getRun("PRJ-1", "RUN-1")).toEqual(run);
  });

  it("getRiskAcceptances returns [] for a project with no risk-acceptances.json yet", async () => {
    expect(await repo.getRiskAcceptances("PRJ-1")).toEqual([]);
  });

  it("saveRiskAcceptance appends a new riskAcceptanceId but replaces an existing one (upsert)", async () => {
    const first: RiskAcceptance = {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "IAM-AUTH-005", findingIds: [],
      reason: "compensating control in place", compensatingControls: ["NET-ADMIN-003"],
      approvedBy: "csi-mcp-agent", approvedAt: "2026-09-30T00:00:00.000Z", expiresAt: "2026-12-30T00:00:00.000Z",
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    };
    await repo.saveRiskAcceptance("PRJ-1", first);
    const revoked = { ...first, status: "revoked" as const, revokedAt: "2026-10-01T00:00:00.000Z", revokedReason: "no longer needed" };
    await repo.saveRiskAcceptance("PRJ-1", revoked);
    const all = await repo.getRiskAcceptances("PRJ-1");
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(revoked);

    const other: RiskAcceptance = { ...first, riskAcceptanceId: "RA-002", controlId: "DATA-ENC-002" };
    await repo.saveRiskAcceptance("PRJ-1", other);
    expect(await repo.getRiskAcceptances("PRJ-1")).toHaveLength(2);
  });
});

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf-8");
}
