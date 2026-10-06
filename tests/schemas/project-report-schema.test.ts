import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";
import { sortPrioritizedFindings } from "../../src/core/report-builder.js";

describe("project-report-schema", () => {
  const valid = {
    reportId: "RPT-001",
    projectId: "PRJ-001",
    assessmentRunId: "RUN-20260919-001",
    catalogVersion: "2.1.0",
    profileRevision: 1,
    criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-09-19T05:00:00Z",
    score: {
      overallScore: 82,
      coverage: { applicableControls: 120, assessedControls: 110, coveragePercent: 91.67 },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
      domainScores: [
        {
          domain: "authentication",
          score: 87,
          totalControls: 21,
          applicableControls: 16,
          assessedControls: 14,
          coveragePercent: 87.5,
          passCount: 11,
          failCount: 2,
          partialCount: 1,
          notTestedCount: 2,
          notApplicableCount: 4,
          acceptedRiskCount: 1,
          criticalSeverityFindings: 0,
          highSeverityFindings: 1,
        },
      ],
    },
    prioritizedFindings: [
      { findingId: "FND-001", priorityIndex: 0, criticalityIndex: 9, title: "Admin API reachable without authentication" },
      { findingId: "FND-002", priorityIndex: 0, criticalityIndex: 7, title: "Predictable session token" },
      { findingId: "FND-003", priorityIndex: 1, criticalityIndex: 9, title: "SQL injection in search endpoint" },
    ],
    releaseEvaluation: {
      gate: 4,
      controlCoverage: 91.67,
      confirmedCriticalVulnerabilities: 1,
      confirmedHighVulnerabilities: 2,
      unblockedCriticalAttackPaths: 0,
      residualRisksAccepted: 0,
      incidentResponseVerified: true,
      backupRestoreVerified: true,
      blockingControlFailures: ["IAM-AUTH-005"],
      blockingControlsNotVerified: [],
      result: "blocked",
    },
    summary: "Two critical findings remain open; release blocked until resolved.",
  };

  it("accepts a well-formed report", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a report missing assessmentRunId", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const { assessmentRunId, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a report missing criticalityFormula", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const { criticalityFormula, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("sortPrioritizedFindings produces the prioritizedFindings sort invariant: priorityIndex asc, criticalityIndex desc, findingId asc", () => {
    // Deliberately unsorted input — a genuine behavioral test of the real sort function, not a
    // self-referential fixture that already happens to be sorted.
    const unsorted = [
      { findingId: "FND-003", priorityIndex: 1, criticalityIndex: 9, title: "SQL injection in search endpoint" },
      { findingId: "FND-002", priorityIndex: 0, criticalityIndex: 7, title: "Predictable session token" },
      { findingId: "FND-001", priorityIndex: 0, criticalityIndex: 9, title: "Admin API reachable without authentication" },
    ];
    const sorted = sortPrioritizedFindings(unsorted);
    expect(sorted.map((f) => f.findingId)).toEqual(["FND-001", "FND-002", "FND-003"]);
    // sortPrioritizedFindings must not mutate its input.
    expect(unsorted.map((f) => f.findingId)).toEqual(["FND-003", "FND-002", "FND-001"]);
  });

  it("rejects a prioritizedFindings entry missing title", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const badFindings = [{ findingId: "FND-001", priorityIndex: 0, criticalityIndex: 9 }];
    expect(validate({ ...valid, prioritizedFindings: badFindings })).toBe(false);
  });
});
