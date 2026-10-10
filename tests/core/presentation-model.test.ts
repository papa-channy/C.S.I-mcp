import { describe, expect, it } from "vitest";
import { buildPresentationModel, EFFECTIVE_STATUS_REASON_LABELS } from "../../src/core/presentation-model.js";
import type { ProjectReport, ControlAssessmentSnapshot, EvidenceSnapshot, RiskAcceptanceSnapshot, FindingSnapshot } from "../../src/core/report-builder.js";

const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

function controlSnapshot(controlId: string, overrides: Partial<ControlAssessmentSnapshot> = {}): ControlAssessmentSnapshot {
  return {
    assessmentId: `A-${controlId}`, runId: "RUN-1", controlId, controlVersion: 1,
    title: `Title ${controlId}`, domain: "appsec", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
    evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "x", assessedBy: "x", assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    ...overrides,
  };
}

function findingSnapshot(findingId: string, overrides: Partial<FindingSnapshot> = {}): FindingSnapshot {
  return {
    findingId, title: `Finding ${findingId}`, type: "control_gap", severity: "medium",
    controlIds: [], status: "open", priorityIndex: 5, criticalityIndex: 5,
    ...overrides,
  };
}

function sampleReport(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return {
    reportId: "REP-1", projectId: "PRJ-1", projectName: "Demo Project", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-07T00:00:00.000Z",
    score: {
      overallScore: 100,
      coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
      domainScores: [{
        domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1,
        coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0,
        notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0,
      }],
    },
    prioritizedFindings: [],
    projectFindingSnapshots: [],
    releaseEvaluation: {
      gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0,
      residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved",
    },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [controlSnapshot("CTRL-001")],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" },
      score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
      riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
    ...overrides,
  };
}

describe("buildPresentationModel — purity and determinism", () => {
  it("produces deep-equal output for the same (report, opts) called twice", () => {
    const report = sampleReport();
    expect(buildPresentationModel(report, OPTS)).toEqual(buildPresentationModel(report, OPTS));
  });

  it("does not mutate the input report", () => {
    const report = sampleReport();
    const before = JSON.stringify(report);
    buildPresentationModel(report, OPTS);
    expect(JSON.stringify(report)).toBe(before);
  });
});

describe("buildPresentationModel — metadata.target", () => {
  it("available: false, provenanceKind: legacy-unavailable when report.target is null", () => {
    const model = buildPresentationModel(sampleReport({ target: null }), OPTS);
    expect(model.metadata.target).toEqual({ available: false, repository: null, commitSha: null, branchOrTag: null, dirty: null, provenanceKind: "legacy-unavailable" });
  });

  it("available: true, provenanceKind: caller-asserted, fields copied verbatim when report.target is set", () => {
    const target = { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false };
    const model = buildPresentationModel(sampleReport({ target }), OPTS);
    expect(model.metadata.target).toEqual({ available: true, ...target, provenanceKind: "caller-asserted" });
  });

  it("injects rendererVersion/rendererRenderedAt/sourceReportSha256 from opts, never computing them internally", () => {
    const model = buildPresentationModel(sampleReport(), { rendererVersion: "9.9.9", rendererRenderedAt: "2030-01-01T00:00:00.000Z", sourceReportSha256: "b".repeat(64) });
    expect(model.metadata.rendererVersion).toBe("9.9.9");
    expect(model.metadata.rendererRenderedAt).toBe("2030-01-01T00:00:00.000Z");
    expect(model.metadata.sourceReportSha256).toBe("b".repeat(64));
  });
});

describe("buildPresentationModel — metamorphic invariants (spec §8.5)", () => {
  it("domains[i].score === report.score.domainScores[i].score, never recomputed", () => {
    const report = sampleReport();
    const model = buildPresentationModel(report, OPTS);
    expect(model.domains[0].score).toBe(report.score.domainScores[0].score);
  });

  it("executive.verdict === report.releaseEvaluation.result, never re-evaluated", () => {
    const report = sampleReport({ releaseEvaluation: { gate: 4, controlCoverage: 50, confirmedCriticalVulnerabilities: 1, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: ["X"], blockingControlsNotVerified: [], result: "blocked" } });
    const model = buildPresentationModel(report, OPTS);
    expect(model.executive.verdict).toBe("blocked");
  });
});

describe("buildPresentationModel — executive.topPrioritizedFinding", () => {
  it("joins prioritizedFindings[0] with projectFindingSnapshots for severity/type, without inventing a new ranking", () => {
    const report = sampleReport({
      prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 9, title: "Top finding" }],
      projectFindingSnapshots: [findingSnapshot("FND-1", { severity: "critical", type: "confirmed_vulnerability" })],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.executive.topPrioritizedFinding).toEqual({ findingId: "FND-1", title: "Finding FND-1", severity: "critical", type: "confirmed_vulnerability" });
  });

  it("is null when prioritizedFindings is empty", () => {
    const model = buildPresentationModel(sampleReport({ prioritizedFindings: [] }), OPTS);
    expect(model.executive.topPrioritizedFinding).toBeNull();
  });
});

describe("buildPresentationModel — controls", () => {
  it("resolves evidence/riskAcceptance and keeps raw ids alongside the resolved views", () => {
    const report = sampleReport({
      runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { evidenceIds: ["EVD-001"], riskAcceptanceId: "RA-001" })],
      evidenceSnapshots: [{ evidenceId: "EVD-001", type: "CODE", location: "x", description: null, capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "x" }],
      riskAcceptanceSnapshots: [{ riskAcceptanceId: "RA-001", controlId: "CTRL-001", findingIds: [], reason: "r", compensatingControls: [], approvedBy: "x", approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z", reviewDate: null, status: "active", revokedAt: null, revokedReason: null }],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].evidenceIds).toEqual(["EVD-001"]);
    expect(model.controls[0].evidence[0].evidenceId).toBe("EVD-001");
    expect(model.controls[0].riskAcceptanceId).toBe("RA-001");
    expect(model.controls[0].riskAcceptance?.riskAcceptanceId).toBe("RA-001");
  });

  it("flags controlDefinitionVersionMismatch and records it in referenceIntegrity.unresolvedControlDefinitions when title is null", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { title: null, domain: null })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].controlDefinitionVersionMismatch).toBe(true);
    expect(model.referenceIntegrity.unresolvedControlDefinitions).toEqual(["CTRL-001"]);
  });

  it("records a missing evidence reference in referenceIntegrity.missingEvidenceIds and omits it from the resolved evidence[] array", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { evidenceIds: ["EVD-404"] })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].evidence).toEqual([]);
    expect(model.referenceIntegrity.missingEvidenceIds).toEqual(["EVD-404"]);
  });

  it("records a missing risk acceptance reference in referenceIntegrity.missingRiskAcceptanceIds", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { riskAcceptanceId: "RA-404" })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].riskAcceptance).toBeNull();
    expect(model.referenceIntegrity.missingRiskAcceptanceIds).toEqual(["RA-404"]);
  });

  it("records a missing finding reference in referenceIntegrity.missingFindingIds", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { findingIds: ["FND-404"] })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.referenceIntegrity.missingFindingIds).toEqual(["FND-404"]);
  });

  it("maps effectiveStatusReason.code through EFFECTIVE_STATUS_REASON_LABELS, never generating prose", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { effectiveStatus: "NOT_TESTED", effectiveStatusReason: { code: "stale_profile" } })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].effectiveStatusReason).toEqual({ code: "stale_profile", label: EFFECTIVE_STATUS_REASON_LABELS.stale_profile });
  });

  it("is sorted by (domain, controlId), with null-domain rows (mismatch cases) sorted after all resolved-domain rows", () => {
    const report = sampleReport({
      runControlAssessmentSnapshots: [
        controlSnapshot("CTRL-003", { domain: "network" }),
        controlSnapshot("CTRL-001", { title: null, domain: null }),
        controlSnapshot("CTRL-002", { domain: "appsec" }),
      ],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls.map((c) => c.controlId)).toEqual(["CTRL-002", "CTRL-003", "CTRL-001"]);
  });
});

describe("buildPresentationModel — findings", () => {
  it("includes every projectFindingSnapshots entry, not just the prioritized subset", () => {
    const report = sampleReport({
      prioritizedFindings: [{ findingId: "FND-OPEN", priorityIndex: 0, criticalityIndex: 5, title: "x" }],
      projectFindingSnapshots: [findingSnapshot("FND-OPEN", { status: "open" }), findingSnapshot("FND-RESOLVED", { status: "resolved" })],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.findings.map((f) => f.findingId).sort()).toEqual(["FND-OPEN", "FND-RESOLVED"]);
  });

  it("preserves prioritizedFindings' exact order for the findings it covers, appending the remainder sorted by findingId ascending", () => {
    const report = sampleReport({
      prioritizedFindings: [
        { findingId: "FND-B", priorityIndex: 0, criticalityIndex: 9, title: "b" },
        { findingId: "FND-A", priorityIndex: 1, criticalityIndex: 1, title: "a" },
      ],
      projectFindingSnapshots: [
        findingSnapshot("FND-A"), findingSnapshot("FND-B"), findingSnapshot("FND-Z", { status: "resolved" }), findingSnapshot("FND-C", { status: "resolved" }),
      ],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.findings.map((f) => f.findingId)).toEqual(["FND-B", "FND-A", "FND-C", "FND-Z"]);
  });

  it("carries linkedControlIds straight from controlIds, with no resolution or filtering performed here", () => {
    const report = sampleReport({ projectFindingSnapshots: [findingSnapshot("FND-1", { controlIds: ["CTRL-OUTSIDE-THIS-RUN"] })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.findings[0].linkedControlIds).toEqual(["CTRL-OUTSIDE-THIS-RUN"]);
  });
});

describe("buildPresentationModel — limitations", () => {
  it("emits legacy_provenance_unavailable (info) when target is null, and target_caller_asserted (info) when it is set", () => {
    const legacy = buildPresentationModel(sampleReport({ target: null }), OPTS);
    expect(legacy.limitations.some((l) => l.code === "legacy_provenance_unavailable" && l.severity === "info")).toBe(true);
    const fresh = buildPresentationModel(sampleReport({ target: { repository: "x", commitSha: null, branchOrTag: null, dirty: null } }), OPTS);
    expect(fresh.limitations.some((l) => l.code === "target_caller_asserted" && l.severity === "info")).toBe(true);
  });

  it("emits project_scoped_score_release only when contributingRunIds spans more than one run", () => {
    const single = buildPresentationModel(sampleReport(), OPTS);
    expect(single.limitations.some((l) => l.code === "project_scoped_score_release")).toBe(false);
    const multi = buildPresentationModel(sampleReport({
      assessmentScopes: {
        ...sampleReport().assessmentScopes,
        score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] },
        releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] },
      },
    }), OPTS);
    expect(multi.limitations.some((l) => l.code === "project_scoped_score_release" && l.severity === "info")).toBe(true);
  });

  it("emits control_definition_version_mismatch (warning) only when a mismatch exists", () => {
    const clean = buildPresentationModel(sampleReport(), OPTS);
    expect(clean.limitations.some((l) => l.code === "control_definition_version_mismatch")).toBe(false);
    const mismatched = buildPresentationModel(sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { title: null, domain: null })] }), OPTS);
    expect(mismatched.limitations.some((l) => l.code === "control_definition_version_mismatch" && l.severity === "warning")).toBe(true);
  });

  it("emits missing_evidence/missing_risk_acceptance/missing_finding_reference (warning) only when the corresponding referenceIntegrity list is non-empty", () => {
    const model = buildPresentationModel(sampleReport({
      runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { evidenceIds: ["EVD-404"], riskAcceptanceId: "RA-404", findingIds: ["FND-404"] })],
    }), OPTS);
    expect(model.limitations.filter((l) => l.severity === "warning").map((l) => l.code).sort()).toEqual(
      ["missing_evidence", "missing_finding_reference", "missing_risk_acceptance"]
    );
  });

  it("is sorted with every warning before every info", () => {
    const model = buildPresentationModel(sampleReport({
      target: null,
      runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { title: null, domain: null })],
    }), OPTS);
    const severities = model.limitations.map((l) => l.severity);
    const firstInfoIndex = severities.indexOf("info");
    const lastWarningIndex = severities.lastIndexOf("warning");
    expect(firstInfoIndex === -1 || lastWarningIndex === -1 || lastWarningIndex < firstInfoIndex).toBe(true);
  });

  it("always includes rounded_display_values (info)", () => {
    const model = buildPresentationModel(sampleReport(), OPTS);
    expect(model.limitations.some((l) => l.code === "rounded_display_values" && l.severity === "info")).toBe(true);
  });
});
