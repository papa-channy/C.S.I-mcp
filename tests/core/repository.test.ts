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
import type { AssessmentBatch, AssessmentRun, ControlAssessment, Evidence, Finding, Project, RiskAcceptance, Target, SecurityRepository } from "../../src/core/repository.js";
import type { ProjectReport } from "../../src/core/report-builder.js";
import type { AssessmentPlan } from "../../src/core/plan-expander.js";
import { ReportService } from "../../src/service/report-service.js";
import { RELEASE_BLOCKING_CONTROLS } from "../../src/core/release-evaluator.js";

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

  it("saveRun then reload round-trips an AssessmentRun with target/profileSnapshot/engineVersionAtRunStart populated", async () => {
    const run: AssessmentRun = {
      runId: "RUN-2", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "pending",
      target: { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false },
      profileSnapshot: { securityLevel: "SVL-2", exposure: ["internet_public"] },
      engineVersionAtRunStart: "0.9.0",
    };
    await repo.saveRun(run);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "runs", "RUN-2.json")));
    expect(reloaded).toEqual(run);
  });

  it("a legacy AssessmentRun JSON file with target/profileSnapshot/engineVersionAtRunStart entirely absent still loads via getRun", async () => {
    const legacyRun = {
      runId: "RUN-LEGACY", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "pending",
    };
    mkdirSync(join(dir, "projects", "PRJ-1", "runs"), { recursive: true });
    writeFileSync(join(dir, "projects", "PRJ-1", "runs", "RUN-LEGACY.json"), JSON.stringify(legacyRun));
    const loaded = await repo.getRun("PRJ-1", "RUN-LEGACY");
    expect(loaded.target).toBeUndefined();
    expect(loaded.profileSnapshot).toBeUndefined();
    expect(loaded.engineVersionAtRunStart).toBeUndefined();
  });

  it("saveBatch then reload round-trips the AssessmentBatch", async () => {
    const batch: AssessmentBatch = { batchId: "BATCH-1", projectId: "PRJ-1", status: "pending" };
    await repo.saveBatch(batch);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "batches", "BATCH-1.json")));
    expect(reloaded).toEqual(batch);
  });

  it("saveReport then reload round-trips the ProjectReport", async () => {
    const report = {
      reportId: "REP-1", projectId: "PRJ-1", projectName: "Demo", assessmentRunId: "RUN-1", catalogVersion: "1.0.0", profileRevision: 1,
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" }, generatedAt: "2026-09-28T00:00:00.000Z",
      score: { overallScore: 80, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "M", version: "1" }, domainScores: [] },
      prioritizedFindings: [], projectFindingSnapshots: [], runControlAssessmentSnapshots: [],
      evidenceSnapshots: [], riskAcceptanceSnapshots: [],
      assessmentScopes: {
        projectFindingSnapshots: { kind: "project" as const },
        score: { kind: "project-assessment-set" as const, contributingRunIds: ["RUN-1"] },
        releaseEvaluation: { kind: "project-assessment-set" as const, contributingRunIds: ["RUN-1"] },
        runControlAssessmentSnapshots: { kind: "run" as const, runId: "RUN-1" },
        evidenceSnapshots: { kind: "referenced-by-run" as const, runId: "RUN-1" },
        riskAcceptanceSnapshots: { kind: "referenced-by-run" as const, runId: "RUN-1" },
      },
      releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" as const },
      target: null, profileSnapshot: null, engineVersionAtRunStart: null, reportSchemaVersion: "2.1.0",
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

function mixedRepository(projectRepo: JsonRepository, catalogRepo: JsonRepository): SecurityRepository {
  return {
    getProject: projectRepo.getProject.bind(projectRepo),
    getControls: catalogRepo.getControls.bind(catalogRepo),
    getThreats: catalogRepo.getThreats.bind(catalogRepo),
    getCriticalityFormula: catalogRepo.getCriticalityFormula.bind(catalogRepo),
    getScoreModel: catalogRepo.getScoreModel.bind(catalogRepo),
    getReleaseGates: catalogRepo.getReleaseGates.bind(catalogRepo),
    getPlan: projectRepo.getPlan.bind(projectRepo),
    getCatalogVersion: catalogRepo.getCatalogVersion.bind(catalogRepo),
    getControlAssessments: projectRepo.getControlAssessments.bind(projectRepo),
    getFindings: projectRepo.getFindings.bind(projectRepo),
    getEvidence: projectRepo.getEvidence.bind(projectRepo),
    getRiskAcceptances: projectRepo.getRiskAcceptances.bind(projectRepo),
    getRun: projectRepo.getRun.bind(projectRepo),
    saveRun: projectRepo.saveRun.bind(projectRepo),
    saveBatch: projectRepo.saveBatch.bind(projectRepo),
    saveReport: projectRepo.saveReport.bind(projectRepo),
    getReportRawBytes: projectRepo.getReportRawBytes.bind(projectRepo),
    saveReportHtml: projectRepo.saveReportHtml.bind(projectRepo),
    savePlan: projectRepo.savePlan.bind(projectRepo),
    saveProject: projectRepo.saveProject.bind(projectRepo),
    saveControlAssessment: projectRepo.saveControlAssessment.bind(projectRepo),
    saveFinding: projectRepo.saveFinding.bind(projectRepo),
    saveEvidence: projectRepo.saveEvidence.bind(projectRepo),
    saveRiskAcceptance: projectRepo.saveRiskAcceptance.bind(projectRepo),
  };
}

describe("JsonRepository — old ProjectReport files are never touched by ReportService.generateData()'s normal path", () => {
  const NOW = "2026-10-06T00:00:00.000Z";
  let dir: string;
  let repo: JsonRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csi-mcp-repo-"));
    repo = new JsonRepository(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a legacy-shaped report on disk is byte-for-byte unchanged after ReportService.generateData() creates a new report for the same project", async () => {
    const legacyReportPath = join(dir, "projects", "PRJ-1", "reports", "REP-LEGACY.json");
    mkdirSync(join(dir, "projects", "PRJ-1", "reports"), { recursive: true });
    const legacyReport = {
      reportId: "REP-LEGACY", projectId: "PRJ-1", projectName: "Demo", assessmentRunId: "RUN-OLD", catalogVersion: "1.0.0", profileRevision: 1,
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" }, generatedAt: "2026-08-01T00:00:00.000Z",
      score: { overallScore: 90, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "M", version: "1" }, domainScores: [] },
      prioritizedFindings: [],
      projectFindingSnapshots: [],
      runControlAssessmentSnapshots: [],
      releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
      target: null,
      profileSnapshot: null,
      engineVersionAtRunStart: null,
      reportSchemaVersion: "2.1.0",
      summary: "a pre-2.0.0 report with the old field names and no reportSchemaVersion at all",
    };
    writeFileSync(legacyReportPath, JSON.stringify(legacyReport, null, 2));
    const before = readFileSyncUtf8(legacyReportPath);

    const realCatalog = new JsonRepository("data");
    const mixed = mixedRepository(repo, realCatalog);
    await repo.saveProject({
      projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
      profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
    });
    await repo.saveRun({
      runId: "RUN-NEW", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: (await realCatalog.getCatalogVersion()), batchIds: [], status: "running", startedAt: NOW, completedAt: null,
    });
    const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
    for (let i = 0; i < blockingControls.length; i++) {
      await repo.saveControlAssessment({
        assessmentId: `A-${i + 1}`, projectId: "PRJ-1", controlId: blockingControls[i], controlVersion: 1,
        runId: "RUN-NEW", profileRevision: 1,
        applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
        status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
      });
    }
    const reportService = new ReportService(mixed, () => NOW);
    const newReport = await reportService.generateData({ projectId: "PRJ-1", runId: "RUN-NEW", summary: "a fresh 2.0.0 report for the same project" });

    const after = readFileSyncUtf8(legacyReportPath);
    expect(after).toBe(before);
    expect(newReport.reportSchemaVersion).toBe("2.1.0");
    const newReportOnDisk = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "reports", `${newReport.reportId}.json`)));
    expect(newReportOnDisk.reportSchemaVersion).toBe("2.1.0");
  });
});
