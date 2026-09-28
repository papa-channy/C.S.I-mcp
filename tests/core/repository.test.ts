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
import type { AssessmentBatch, AssessmentRun } from "../../src/core/repository.js";
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
    const run: AssessmentRun = { runId: "RUN-1", projectId: "PRJ-1", status: "pending" };
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
      prioritizedFindings: [], releaseEvaluation: { gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, result: "approved" as const },
      summary: "ok",
    } satisfies ProjectReport;
    await repo.saveReport(report);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "reports", "REP-1.json")));
    expect(reloaded).toEqual(report);
  });

  it("saveRun does not leave a .tmp-* file behind after a successful write", async () => {
    await repo.saveRun({ runId: "RUN-1", projectId: "PRJ-1", status: "pending" });
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
});

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf-8");
}
