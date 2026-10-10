import { describe, expect, it } from "vitest";
import { sortPrioritizedFindings, buildReport, roundReportNumber, buildRunControlAssessmentSnapshots, buildEvidenceSnapshots, buildRiskAcceptanceSnapshots, buildAssessmentScopes, type PrioritizedFindingInput, type FindingForReport, type ReleaseEvaluationForReport, type ScoreForReport, type ControlAssessmentSnapshot, type EvidenceSnapshot, type RiskAcceptanceSnapshot } from "../../src/core/report-builder.js";
import type { ReleaseEvaluation } from "../../src/core/release-evaluator.js";
import type { ControlAssessment, Control, Evidence, RiskAcceptance } from "../../src/core/repository.js";
import type { TrustNormalizedAssessment } from "../../src/core/risk-acceptance.js";

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

const releaseEvaluation: ReleaseEvaluation = {
  gate: 4, controlCoverage: 80, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true,
  blockingControlFailures: [], blockingControlsNotVerified: [],
  result: "approved",
};

const run = { runId: "RUN-1", projectId: "PRJ-1", catalogVersion: "1.0.0", profileRevision: 1 };

describe("buildReport", () => {
  it("pins projectId/assessmentRunId/catalogVersion/profileRevision from the run input", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.projectId).toBe("PRJ-1");
    expect(report.assessmentRunId).toBe("RUN-1");
    expect(report.catalogVersion).toBe("1.0.0");
    expect(report.profileRevision).toBe(1);
  });

  it("passes score through unchanged and releaseEvaluation through (minus the 3 report-excluded fields) rather than recomputing them", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.score).toEqual(score);
    const { unblockedCriticalAttackPaths, incidentResponseVerified, backupRestoreVerified, ...expectedReleaseEvaluation } = releaseEvaluation;
    expect(report.releaseEvaluation).toEqual(expectedReleaseEvaluation);
  });

  it("includes only open/in_progress findings in prioritizedFindings, dropping resolved/accepted/false_positive", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", type: "confirmed_vulnerability", controlIds: ["A-001"], status: "open", severity: "high", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-progress", title: "in progress one", type: "control_gap", controlIds: ["A-001"], status: "in_progress", severity: "medium", priority: { index: 2 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", type: "confirmed_vulnerability", controlIds: ["A-002"], status: "resolved", severity: "critical", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-accepted", title: "accepted one", type: "accepted_design", controlIds: ["A-002"], status: "accepted", severity: "low", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-fp", title: "false positive", type: "needs_validation", controlIds: ["A-003"], status: "false_positive", severity: "informational", priority: { index: 0 }, criticality: { index: 9 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.prioritizedFindings.map((f) => f.findingId)).toEqual(["F-open", "F-progress"]);
  });

  it("projects findings to the prioritizedFindings summary shape and sorts them", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-low", title: "low priority", type: "control_gap", controlIds: ["A-001"], status: "open", severity: "medium", priority: { index: 5 }, criticality: { index: 5 } },
      { findingId: "F-high", title: "high priority", type: "confirmed_vulnerability", controlIds: ["A-001"], status: "open", severity: "high", priority: { index: 1 }, criticality: { index: 5 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
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
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.reportId).toBe("REP-42");
    expect(report.generatedAt).toBe("2026-09-28T12:00:00.000Z");
    expect(report.criticalityFormula).toEqual({ id: "CRIT-DEFAULT", version: "2.0.0" });
    expect(report.summary).toBe("all clear");
  });
});

describe("buildReport — projectFindingSnapshots", () => {
  it("includes every finding regardless of status, unlike prioritizedFindings' open/in_progress-only filter", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", type: "confirmed_vulnerability", controlIds: ["A-001"], status: "open", severity: "high", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", type: "control_gap", controlIds: ["A-002"], status: "resolved", severity: "medium", priority: { index: 0 }, criticality: { index: 3 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.projectFindingSnapshots.map((f) => f.findingId)).toEqual(["F-open", "F-resolved"]);
    expect(report.prioritizedFindings.map((f) => f.findingId)).toEqual(["F-open"]);
  });

  it("carries type/severity/controlIds/attackScenario/exploitabilityEvidence through, not just the prioritizedFindings subset", () => {
    const findings: FindingForReport[] = [
      {
        findingId: "F-1", title: "Admin API reachable without auth", type: "confirmed_vulnerability",
        controlIds: ["IAM-AUTHZ-001", "IAM-AUTHZ-002"], status: "open", severity: "critical",
        priority: { index: 0 }, criticality: { index: 9 },
        attackScenario: "An unauthenticated attacker calls the admin API directly.",
        exploitabilityEvidence: "curl -X POST /admin/users succeeds with no Authorization header.",
      },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.projectFindingSnapshots[0]).toEqual({
      findingId: "F-1", title: "Admin API reachable without auth", type: "confirmed_vulnerability",
      severity: "critical", controlIds: ["IAM-AUTHZ-001", "IAM-AUTHZ-002"], status: "open",
      priorityIndex: 0, criticalityIndex: 9,
      attackScenario: "An unauthenticated attacker calls the admin API directly.",
      exploitabilityEvidence: "curl -X POST /admin/users succeeds with no Authorization header.",
    });
  });

  it("omits attackScenario/exploitabilityEvidence keys entirely when the finding doesn't have them, rather than writing undefined", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-1", title: "x", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect("attackScenario" in report.projectFindingSnapshots[0]).toBe(false);
    expect("exploitabilityEvidence" in report.projectFindingSnapshots[0]).toBe(false);
  });

  it("is sorted ascending by findingId regardless of input order, and two reports from the same findings are byte-identical", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-003", title: "c", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
      { findingId: "F-001", title: "a", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
      { findingId: "F-002", title: "b", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
    ];
    const buildOnce = () => buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    const first = buildOnce();
    expect(first.projectFindingSnapshots.map((f) => f.findingId)).toEqual(["F-001", "F-002", "F-003"]);
    const second = buildOnce();
    expect(JSON.stringify(second.projectFindingSnapshots)).toEqual(JSON.stringify(first.projectFindingSnapshots));
  });
});

describe("roundReportNumber", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundReportNumber(57.49999999999999)).toBe(57.5);
    expect(roundReportNumber(79.995)).toBe(80);
  });

  it("normalizes -0 to 0", () => {
    expect(Object.is(roundReportNumber(-0.001), 0)).toBe(true);
  });

  it("throws on non-finite input", () => {
    expect(() => roundReportNumber(NaN)).toThrow();
    expect(() => roundReportNumber(Infinity)).toThrow();
    expect(() => roundReportNumber(-Infinity)).toThrow();
  });
});

describe("buildReport — rounding applied at serialization only", () => {
  it("rounds score.overallScore, score.coverage.coveragePercent, domain score/coveragePercent, and releaseEvaluation.controlCoverage to 2 decimals", () => {
    const unroundedScore: ScoreForReport = {
      overallScore: 66.66666666666667,
      coverage: { applicableControls: 3, assessedControls: 2, coveragePercent: 66.66666666666667 },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
      domainScores: [{
        domain: "appsec", score: 33.33333333333333, totalControls: 3, applicableControls: 3, assessedControls: 1,
        coveragePercent: 33.33333333333333, passCount: 1, failCount: 1, partialCount: 0, notTestedCount: 1,
        notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0,
      }],
    };
    const unroundedRelease: ReleaseEvaluation = { ...releaseEvaluation, controlCoverage: 66.66666666666667 };
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score: unroundedScore, findings: [], releaseEvaluation: unroundedRelease, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.score.overallScore).toBe(66.67);
    expect(report.score.coverage.coveragePercent).toBe(66.67);
    expect(report.score.domainScores[0].score).toBe(33.33);
    expect(report.score.domainScores[0].coveragePercent).toBe(33.33);
    expect(report.releaseEvaluation.controlCoverage).toBe(66.67);
  });

  it("rounding the report's displayed coverage does not change what the gate decided — a synthetic just-under-threshold score stays non-approved even though its rounded display reads 80.0", () => {
    const justUnder: ScoreForReport = { ...score, coverage: { ...score.coverage, coveragePercent: 79.996 } };
    const blockedRelease: ReleaseEvaluation = { ...releaseEvaluation, controlCoverage: 79.996, result: "indeterminate" };
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score: justUnder, findings: [], releaseEvaluation: blockedRelease, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.score.coverage.coveragePercent).toBe(80);
    expect(report.releaseEvaluation.result).toBe("indeterminate");
  });
});

describe("buildReport — provenance fields copied verbatim from the run", () => {
  const target = { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false };
  const profileSnapshot = { securityLevel: "SVL-2", exposure: ["internet_public"] };

  it("copies target/profileSnapshot/engineVersionAtRunStart from the run when present", () => {
    const report = buildReport({
      reportId: "REP-1",
      run: { ...run, target, profileSnapshot, engineVersionAtRunStart: "0.9.0" },
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.target).toEqual(target);
    expect(report.profileSnapshot).toEqual(profileSnapshot);
    expect(report.engineVersionAtRunStart).toBe("0.9.0");
  });

  it("defaults all three to null when the run has them as null or entirely absent (legacy run)", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.target).toBeNull();
    expect(report.profileSnapshot).toBeNull();
    expect(report.engineVersionAtRunStart).toBeNull();
  });
});

describe("buildReport — reportSchemaVersion and dropped fields", () => {
  it("stamps reportSchemaVersion 2.1.0 on every generated report", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.reportSchemaVersion).toBe("2.1.0");
  });

  it("drops unblockedCriticalAttackPaths/incidentResponseVerified/backupRestoreVerified from the report's releaseEvaluation", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect("unblockedCriticalAttackPaths" in report.releaseEvaluation).toBe(false);
    expect("incidentResponseVerified" in report.releaseEvaluation).toBe(false);
    expect("backupRestoreVerified" in report.releaseEvaluation).toBe(false);
  });
});

function rawAssessment(controlId: string, overrides: Partial<ControlAssessment> = {}): ControlAssessment {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-1", controlId, controlVersion: 1,
    runId: "RUN-1", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-10-07T00:00:00.000Z",
    nextReviewAt: null, notes: null,
    ...overrides,
  };
}

function normalized(a: ControlAssessment, overrides: Partial<TrustNormalizedAssessment> = {}): TrustNormalizedAssessment {
  return {
    assessmentId: a.assessmentId, controlId: a.controlId, runId: a.runId,
    recordedStatus: a.status, status: a.status, effectiveStatusReason: null,
    ...overrides,
  };
}

function catalogControl(controlId: string, version: number, overrides: Partial<Control> = {}): Control {
  return {
    controlId, version, status: "active", title: `Title for ${controlId}`,
    domain: "appsec", subdomain: "x", layer: "application", group: "x",
    applicability: { defaultResult: "applicable", rules: [] },
    ...overrides,
  } as Control;
}

describe("buildRunControlAssessmentSnapshots", () => {
  it("filters to only the requested runId", () => {
    const a1 = rawAssessment("CTRL-001", { runId: "RUN-1" });
    const a2 = rawAssessment("CTRL-002", { runId: "RUN-2" });
    const result = buildRunControlAssessmentSnapshots([a1, a2], [normalized(a1), normalized(a2)], [catalogControl("CTRL-001", 1), catalogControl("CTRL-002", 1)], "RUN-1");
    expect(result.map((s) => s.controlId)).toEqual(["CTRL-001"]);
  });

  it("joins title/domain on an exact (controlId, controlVersion) match", () => {
    const a = rawAssessment("CTRL-001", { controlVersion: 2 });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [catalogControl("CTRL-001", 2, { title: "Exact match title", domain: "identity-access" })], "RUN-1");
    expect(result[0].title).toBe("Exact match title");
    expect(result[0].domain).toBe("identity-access");
  });

  it("sets title/domain to null when controlVersion doesn't match the current catalog entry", () => {
    const a = rawAssessment("CTRL-001", { controlVersion: 1 });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [catalogControl("CTRL-001", 2, { title: "Current (newer) title" })], "RUN-1");
    expect(result[0].title).toBeNull();
    expect(result[0].domain).toBeNull();
  });

  it("sets title/domain to null when the controlId has no catalog entry at all", () => {
    const a = rawAssessment("CTRL-GONE", { controlVersion: 1 });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [], "RUN-1");
    expect(result[0].title).toBeNull();
    expect(result[0].domain).toBeNull();
  });

  it("carries recordedStatus/effectiveStatus/effectiveStatusReason from the matching normalized entry", () => {
    const a = rawAssessment("CTRL-001", { status: "ACCEPTED_RISK" });
    const n = normalized(a, { status: "NOT_TESTED", effectiveStatusReason: { code: "risk_acceptance_missing" } });
    const result = buildRunControlAssessmentSnapshots([a], [n], [catalogControl("CTRL-001", 1)], "RUN-1");
    expect(result[0].recordedStatus).toBe("ACCEPTED_RISK");
    expect(result[0].effectiveStatus).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_missing" });
  });

  it("carries evidenceIds/findingIds/riskAcceptanceId/owner/assessedBy/assessedAt/nextReviewAt/notes/applicability/profileRevision straight from the raw assessment", () => {
    const a = rawAssessment("CTRL-001", {
      evidenceIds: ["EVD-001"], findingIds: ["FND-001"], riskAcceptanceId: "RA-001",
      owner: "owner-x", assessedBy: "assessor-x", nextReviewAt: "2027-01-01T00:00:00.000Z", notes: "n",
    });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [catalogControl("CTRL-001", 1)], "RUN-1");
    expect(result[0]).toMatchObject({
      evidenceIds: ["EVD-001"], findingIds: ["FND-001"], riskAcceptanceId: "RA-001",
      owner: "owner-x", assessedBy: "assessor-x", nextReviewAt: "2027-01-01T00:00:00.000Z", notes: "n",
      applicability: a.applicability, profileRevision: a.profileRevision,
    });
  });

  it("is sorted ascending by controlId regardless of input order", () => {
    const a1 = rawAssessment("CTRL-003");
    const a2 = rawAssessment("CTRL-001");
    const a3 = rawAssessment("CTRL-002");
    const controls = [catalogControl("CTRL-001", 1), catalogControl("CTRL-002", 1), catalogControl("CTRL-003", 1)];
    const result = buildRunControlAssessmentSnapshots([a1, a2, a3], [normalized(a1), normalized(a2), normalized(a3)], controls, "RUN-1");
    expect(result.map((s) => s.controlId)).toEqual(["CTRL-001", "CTRL-002", "CTRL-003"]);
  });

  it("throws if a filtered assessment has no matching normalized entry (invariant violation — every assessment must have been normalized)", () => {
    const a = rawAssessment("CTRL-001");
    expect(() => buildRunControlAssessmentSnapshots([a], [], [catalogControl("CTRL-001", 1)], "RUN-1")).toThrow();
  });
});

describe("buildReport — projectName and runControlAssessmentSnapshots", () => {
  it("carries projectName through verbatim", () => {
    const a = rawAssessment("CTRL-001");
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [a], translatedAssessments: [normalized(a)], controls: [catalogControl("CTRL-001", 1)],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.projectName).toBe("Demo Project");
  });

  it("filters runControlAssessmentSnapshots to the run's own runId, excluding assessments from other runs on the same project", () => {
    const a1 = rawAssessment("CTRL-001", { runId: "RUN-1" });
    const a2 = rawAssessment("CTRL-002", { runId: "RUN-2" });
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [a1, a2], translatedAssessments: [normalized(a1), normalized(a2)],
      controls: [catalogControl("CTRL-001", 1), catalogControl("CTRL-002", 1)],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.runControlAssessmentSnapshots.map((s) => s.controlId)).toEqual(["CTRL-001"]);
  });

  it("stamps reportSchemaVersion 2.1.0", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.reportSchemaVersion).toBe("2.1.0");
  });
});

function rawEvidence(evidenceId: string, overrides: Partial<Evidence> = {}): Evidence {
  return { evidenceId, type: "CODE", location: "src/x.ts:10", capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "csi-mcp-agent", ...overrides };
}

function rawRiskAcceptance(riskAcceptanceId: string, overrides: Partial<RiskAcceptance> = {}): RiskAcceptance {
  return {
    riskAcceptanceId, projectId: "PRJ-1", controlId: "CTRL-001", findingIds: [],
    reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
    approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
    reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    ...overrides,
  };
}

describe("buildEvidenceSnapshots", () => {
  it("includes only evidence referenced by the given id set, dropping unreferenced evidence", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-001"), rawEvidence("EVD-002")], new Set(["EVD-001"]));
    expect(result.map((e) => e.evidenceId)).toEqual(["EVD-001"]);
  });

  it("silently omits a referenced id that has no matching Evidence record, rather than throwing", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-001")], new Set(["EVD-001", "EVD-404"]));
    expect(result.map((e) => e.evidenceId)).toEqual(["EVD-001"]);
  });

  it("projects only type/location/description/capturedAt/capturedBy, dropping searchScope/searchMethod/candidateCount/excludedCandidates", () => {
    const result = buildEvidenceSnapshots(
      [rawEvidence("EVD-001", { description: "d", searchScope: "src/", searchMethod: "grep", candidateCount: 3, excludedCandidates: "none" })],
      new Set(["EVD-001"])
    );
    expect(result[0]).toEqual({
      evidenceId: "EVD-001", type: "CODE", location: "src/x.ts:10", description: "d",
      capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "csi-mcp-agent",
    });
  });

  it("sets description to null when the source Evidence record omits it", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-001")], new Set(["EVD-001"]));
    expect(result[0].description).toBeNull();
  });

  it("is sorted ascending by evidenceId regardless of input order", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-002"), rawEvidence("EVD-001")], new Set(["EVD-001", "EVD-002"]));
    expect(result.map((e) => e.evidenceId)).toEqual(["EVD-001", "EVD-002"]);
  });
});

describe("buildRiskAcceptanceSnapshots", () => {
  it("includes only risk acceptances referenced by the given id set", () => {
    const result = buildRiskAcceptanceSnapshots([rawRiskAcceptance("RA-001"), rawRiskAcceptance("RA-002")], new Set(["RA-001"]));
    expect(result.map((r) => r.riskAcceptanceId)).toEqual(["RA-001"]);
  });

  it("silently omits a referenced id that has no matching RiskAcceptance record", () => {
    const result = buildRiskAcceptanceSnapshots([rawRiskAcceptance("RA-001")], new Set(["RA-001", "RA-404"]));
    expect(result.map((r) => r.riskAcceptanceId)).toEqual(["RA-001"]);
  });

  it("strips projectId, keeping every other RiskAcceptance field verbatim", () => {
    const ra = rawRiskAcceptance("RA-001", { status: "revoked", revokedAt: "2026-10-05T00:00:00.000Z", revokedReason: "superseded" });
    const result = buildRiskAcceptanceSnapshots([ra], new Set(["RA-001"]));
    expect(result[0]).toEqual({
      riskAcceptanceId: "RA-001", controlId: "CTRL-001", findingIds: [], reason: "r", compensatingControls: [],
      approvedBy: "csi-mcp-agent", approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
      reviewDate: null, status: "revoked", revokedAt: "2026-10-05T00:00:00.000Z", revokedReason: "superseded",
    });
    expect("projectId" in result[0]).toBe(false);
  });

  it("is sorted ascending by riskAcceptanceId regardless of input order", () => {
    const result = buildRiskAcceptanceSnapshots([rawRiskAcceptance("RA-002"), rawRiskAcceptance("RA-001")], new Set(["RA-001", "RA-002"]));
    expect(result.map((r) => r.riskAcceptanceId)).toEqual(["RA-001", "RA-002"]);
  });
});

describe("buildAssessmentScopes", () => {
  it("sets the 3 fixed-kind scopes (projectFindingSnapshots, runControlAssessmentSnapshots, evidenceSnapshots/riskAcceptanceSnapshots) and the given runId", () => {
    const result = buildAssessmentScopes([], "RUN-1");
    expect(result.projectFindingSnapshots).toEqual({ kind: "project" });
    expect(result.runControlAssessmentSnapshots).toEqual({ kind: "run", runId: "RUN-1" });
    expect(result.evidenceSnapshots).toEqual({ kind: "referenced-by-run", runId: "RUN-1" });
    expect(result.riskAcceptanceSnapshots).toEqual({ kind: "referenced-by-run", runId: "RUN-1" });
  });

  it("computes contributingRunIds as the distinct, sorted set of runIds across the full normalized assessment set, for both score and releaseEvaluation", () => {
    const a1 = normalized(rawAssessment("CTRL-001", { runId: "RUN-2" }));
    const a2 = normalized(rawAssessment("CTRL-002", { runId: "RUN-1" }));
    const a3 = normalized(rawAssessment("CTRL-003", { runId: "RUN-1" }));
    const result = buildAssessmentScopes([a1, a2, a3], "RUN-1");
    expect(result.score).toEqual({ kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] });
    expect(result.releaseEvaluation).toEqual({ kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] });
  });

  it("contributingRunIds is a single-element array when every assessment in the project comes from one run", () => {
    const a1 = normalized(rawAssessment("CTRL-001", { runId: "RUN-1" }));
    const result = buildAssessmentScopes([a1], "RUN-1");
    expect(result.score.contributingRunIds).toEqual(["RUN-1"]);
  });
});

describe("buildReport — evidenceSnapshots/riskAcceptanceSnapshots/assessmentScopes", () => {
  it("scopes evidenceSnapshots/riskAcceptanceSnapshots to only what runControlAssessmentSnapshots references", () => {
    const a = rawAssessment("CTRL-001", { evidenceIds: ["EVD-001"], riskAcceptanceId: "RA-001" });
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [a], translatedAssessments: [normalized(a)],
      controls: [catalogControl("CTRL-001", 1)],
      allEvidence: [rawEvidence("EVD-001"), rawEvidence("EVD-UNREFERENCED")],
      allRiskAcceptances: [rawRiskAcceptance("RA-001"), rawRiskAcceptance("RA-UNREFERENCED")],
    });
    expect(report.evidenceSnapshots.map((e) => e.evidenceId)).toEqual(["EVD-001"]);
    expect(report.riskAcceptanceSnapshots.map((r) => r.riskAcceptanceId)).toEqual(["RA-001"]);
  });

  it("includes assessmentScopes with this report's runId", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.assessmentScopes.runControlAssessmentSnapshots).toEqual({ kind: "run", runId: "RUN-1" });
  });
});
