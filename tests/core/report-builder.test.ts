import { describe, expect, it } from "vitest";
import { sortPrioritizedFindings, buildReport, type PrioritizedFindingInput, type FindingForReport, type ReleaseEvaluationForReport, type ScoreForReport } from "../../src/core/report-builder.js";

describe("sortPrioritizedFindings", () => {
  it("sorts by priorityIndex ascending", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-2", priorityIndex: 5, criticalityIndex: 0, title: "b" },
      { findingId: "F-1", priorityIndex: 1, criticalityIndex: 0, title: "a" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-1", "F-2"]);
  });

  it("breaks a priorityIndex tie by criticalityIndex descending", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-low", priorityIndex: 1, criticalityIndex: 3, title: "low" },
      { findingId: "F-high", priorityIndex: 1, criticalityIndex: 9, title: "high" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-high", "F-low"]);
  });

  it("breaks a priorityIndex+criticalityIndex tie by findingId ascending, guaranteeing a deterministic total order", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-Z", priorityIndex: 2, criticalityIndex: 7, title: "z" },
      { findingId: "F-A", priorityIndex: 2, criticalityIndex: 7, title: "a" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-A", "F-Z"]);
  });

  it("does not mutate the input array", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-2", priorityIndex: 5, criticalityIndex: 0, title: "b" },
      { findingId: "F-1", priorityIndex: 1, criticalityIndex: 0, title: "a" },
    ];
    const original = [...findings];
    sortPrioritizedFindings(findings);
    expect(findings).toEqual(original);
  });
});

const score: ScoreForReport = {
  overallScore: 80,
  coverage: { applicableControls: 10, assessedControls: 8, coveragePercent: 80 },
  scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
  domainScores: [],
};

const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, criticalFindings: 0, highFindings: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true, result: "approved",
};

const run = { runId: "RUN-1", projectId: "PRJ-1", catalogVersion: "1.0.0", profileRevision: 1 };

describe("buildReport", () => {
  it("pins projectId/assessmentRunId/catalogVersion/profileRevision from the run input", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.projectId).toBe("PRJ-1");
    expect(report.assessmentRunId).toBe("RUN-1");
    expect(report.catalogVersion).toBe("1.0.0");
    expect(report.profileRevision).toBe(1);
  });

  it("passes score and releaseEvaluation through unchanged rather than recomputing them", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.score).toEqual(score);
    expect(report.releaseEvaluation).toEqual(releaseEvaluation);
  });

  it("includes only open/in_progress findings in prioritizedFindings, dropping resolved/accepted/false_positive", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", status: "open", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-progress", title: "in progress one", status: "in_progress", priority: { index: 2 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", status: "resolved", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-accepted", title: "accepted one", status: "accepted", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-fp", title: "false positive", status: "false_positive", priority: { index: 0 }, criticality: { index: 9 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect(report.prioritizedFindings.map((f) => f.findingId)).toEqual(["F-open", "F-progress"]);
  });

  it("projects findings to the prioritizedFindings summary shape and sorts them", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-low", title: "low priority", status: "open", priority: { index: 5 }, criticality: { index: 5 } },
      { findingId: "F-high", title: "high priority", status: "open", priority: { index: 1 }, criticality: { index: 5 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect(report.prioritizedFindings).toEqual([
      { findingId: "F-high", priorityIndex: 1, criticalityIndex: 5, title: "high priority" },
      { findingId: "F-low", priorityIndex: 5, criticalityIndex: 5, title: "low priority" },
    ]);
  });

  it("stamps generatedAt from the injected function and carries reportId/criticalityFormula/summary through", () => {
    const report = buildReport({
      reportId: "REP-42", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "2.0.0" },
      generatedAt: () => "2026-09-28T12:00:00.000Z", score, findings: [], releaseEvaluation, summary: "all clear",
    });
    expect(report.reportId).toBe("REP-42");
    expect(report.generatedAt).toBe("2026-09-28T12:00:00.000Z");
    expect(report.criticalityFormula).toEqual({ id: "CRIT-DEFAULT", version: "2.0.0" });
    expect(report.summary).toBe("all clear");
  });
});
