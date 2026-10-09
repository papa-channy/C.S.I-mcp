import type {
  ProjectReport, EvidenceSnapshot, RiskAcceptanceSnapshot, AssessmentScopes,
} from "./report-builder.js";
import type { EffectiveStatusReasonCode } from "./risk-acceptance.js";

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const EFFECTIVE_STATUS_REASON_LABELS: Record<EffectiveStatusReasonCode, string> = {
  stale_profile: "Assessment predates the report run's current profile state",
  risk_acceptance_missing: "No risk acceptance record found for this control",
  risk_acceptance_expired: "Risk acceptance was no longer valid at evaluation time",
  risk_acceptance_revoked: "Risk acceptance was revoked before evaluation time",
  risk_acceptance_scope_mismatch: "Risk acceptance does not cover this control/finding",
};

export interface PresentationModelMetadataTarget {
  available: boolean;
  repository: string | null;
  commitSha: string | null;
  branchOrTag: string | null;
  dirty: boolean | null;
  provenanceKind: "caller-asserted" | "legacy-unavailable";
}

export interface PresentationModelMetadata {
  reportId: string;
  reportSchemaVersion: string;
  projectId: string;
  projectName: string;
  assessmentRunId: string;
  reportGeneratedAt: string;
  engineVersionAtRunStart: string | null;
  profileRevision: number;
  catalogVersion: string;
  criticalityFormula: { id: string; version: string };
  scoreModel: { id: string; version: string };
  rendererVersion: string;
  rendererRenderedAt: string;
  sourceReportSha256: string;
  target: PresentationModelMetadataTarget;
}

export interface DomainPresentation {
  domain: string;
  score: number;
  coverage: { percent: number; assessed: number; applicable: number };
}

export interface ControlRowEffectiveStatusReason {
  code: EffectiveStatusReasonCode;
  label: string;
  detail?: string;
}

export interface ControlRow {
  assessmentId: string;
  controlId: string;
  controlVersion: number;
  runId: string;
  title: string | null;
  domain: string | null;
  controlDefinitionVersionMismatch: boolean;
  recordedStatus: ProjectReport["runControlAssessmentSnapshots"][number]["recordedStatus"];
  effectiveStatus: ProjectReport["runControlAssessmentSnapshots"][number]["effectiveStatus"];
  effectiveStatusReason: ControlRowEffectiveStatusReason | null;
  assessedAt: string;
  assessedBy: string;
  owner: string;
  nextReviewAt: string | null;
  notes: string | null;
  evidenceIds: string[];
  evidence: EvidenceSnapshot[];
  riskAcceptanceId: string | null;
  riskAcceptance: RiskAcceptanceSnapshot | null;
  findingIds: string[];
}

export interface FindingCard {
  findingId: string;
  title: string;
  type: ProjectReport["projectFindingSnapshots"][number]["type"];
  severity: ProjectReport["projectFindingSnapshots"][number]["severity"];
  status: ProjectReport["projectFindingSnapshots"][number]["status"];
  priorityIndex: number;
  criticalityIndex: number;
  attackScenario: string | null;
  exploitabilityEvidence: string | null;
  linkedControlIds: string[];
}

export interface ReferenceIntegrity {
  missingEvidenceIds: string[];
  missingRiskAcceptanceIds: string[];
  missingFindingIds: string[];
  unresolvedControlDefinitions: string[];
}

export type PresentationLimitationCode =
  | "legacy_provenance_unavailable"
  | "target_caller_asserted"
  | "project_scoped_findings"
  | "project_scoped_score_release"
  | "control_definition_version_mismatch"
  | "rounded_display_values"
  | "missing_evidence"
  | "missing_risk_acceptance"
  | "missing_finding_reference";

export interface PresentationLimitation {
  code: PresentationLimitationCode;
  severity: "info" | "warning";
  message: string;
}

export interface PresentationModel {
  metadata: PresentationModelMetadata;
  executive: {
    verdict: ProjectReport["releaseEvaluation"]["result"];
    coverage: { percent: number; assessed: number; applicable: number };
    overallScore: number;
    confirmedCritical: number;
    confirmedHigh: number;
    blockingControlFailures: string[];
    blockingControlsNotVerified: string[];
    topPrioritizedFinding: {
      findingId: string;
      title: string;
      severity: ProjectReport["projectFindingSnapshots"][number]["severity"];
      type: ProjectReport["projectFindingSnapshots"][number]["type"];
    } | null;
  };
  domains: DomainPresentation[];
  controls: ControlRow[];
  findings: FindingCard[];
  evidence: EvidenceSnapshot[];
  riskAcceptances: RiskAcceptanceSnapshot[];
  referenceIntegrity: ReferenceIntegrity;
  limitations: PresentationLimitation[];
  assessmentScopes: AssessmentScopes;
}

const LIMITATION_CODE_ORDER: PresentationLimitationCode[] = [
  "legacy_provenance_unavailable", "target_caller_asserted", "project_scoped_findings",
  "project_scoped_score_release", "control_definition_version_mismatch", "rounded_display_values",
  "missing_evidence", "missing_risk_acceptance", "missing_finding_reference",
];
const SEVERITY_RANK: Record<"warning" | "info", number> = { warning: 0, info: 1 };

function buildLimitations(report: ProjectReport, referenceIntegrity: ReferenceIntegrity): PresentationLimitation[] {
  const limitations: PresentationLimitation[] = [];

  if (report.target === null) {
    limitations.push({
      code: "legacy_provenance_unavailable", severity: "info",
      message: "This report was generated from a legacy assessment run with no recorded target/profile/engine-version provenance.",
    });
  } else {
    limitations.push({
      code: "target_caller_asserted", severity: "info",
      message: "The assessment target (repository/commit/branch) is caller-asserted and not independently verified by this server.",
    });
  }

  limitations.push({
    code: "project_scoped_findings", severity: "info",
    message: "Findings are project-scoped and may include findings recorded under a different assessment run than this report's.",
  });

  if (report.assessmentScopes.score.contributingRunIds.length > 1) {
    limitations.push({
      code: "project_scoped_score_release", severity: "info",
      message: `The score and release verdict draw on control assessments from ${report.assessmentScopes.score.contributingRunIds.length} assessment runs (${report.assessmentScopes.score.contributingRunIds.join(", ")}), not only this report's own run.`,
    });
  }

  if (referenceIntegrity.unresolvedControlDefinitions.length > 0) {
    limitations.push({
      code: "control_definition_version_mismatch", severity: "warning",
      message: `The current control catalog no longer matches the assessed version for: ${referenceIntegrity.unresolvedControlDefinitions.join(", ")}. Title/domain are withheld for these controls rather than showing a possibly-different later definition.`,
    });
  }

  limitations.push({
    code: "rounded_display_values", severity: "info",
    message: "Score and coverage percentages are rounded to 2 decimal places for display; the release verdict was computed from unrounded values.",
  });

  if (referenceIntegrity.missingEvidenceIds.length > 0) {
    limitations.push({ code: "missing_evidence", severity: "warning", message: `Referenced but not found in this report: ${referenceIntegrity.missingEvidenceIds.join(", ")}.` });
  }
  if (referenceIntegrity.missingRiskAcceptanceIds.length > 0) {
    limitations.push({ code: "missing_risk_acceptance", severity: "warning", message: `Referenced but not found in this report: ${referenceIntegrity.missingRiskAcceptanceIds.join(", ")}.` });
  }
  if (referenceIntegrity.missingFindingIds.length > 0) {
    limitations.push({ code: "missing_finding_reference", severity: "warning", message: `Referenced but not found in this report: ${referenceIntegrity.missingFindingIds.join(", ")}.` });
  }

  return limitations.sort((a, b) => {
    const severityCompare = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityCompare !== 0) return severityCompare;
    return LIMITATION_CODE_ORDER.indexOf(a.code) - LIMITATION_CODE_ORDER.indexOf(b.code);
  });
}

export function buildPresentationModel(
  report: ProjectReport,
  opts: { rendererVersion: string; rendererRenderedAt: string; sourceReportSha256: string }
): PresentationModel {
  const metadata: PresentationModelMetadata = {
    reportId: report.reportId,
    reportSchemaVersion: report.reportSchemaVersion,
    projectId: report.projectId,
    projectName: report.projectName,
    assessmentRunId: report.assessmentRunId,
    reportGeneratedAt: report.generatedAt,
    engineVersionAtRunStart: report.engineVersionAtRunStart,
    profileRevision: report.profileRevision,
    catalogVersion: report.catalogVersion,
    criticalityFormula: report.criticalityFormula,
    scoreModel: report.score.scoreModel,
    rendererVersion: opts.rendererVersion,
    rendererRenderedAt: opts.rendererRenderedAt,
    sourceReportSha256: opts.sourceReportSha256,
    target: report.target === null
      ? { available: false, repository: null, commitSha: null, branchOrTag: null, dirty: null, provenanceKind: "legacy-unavailable" }
      : {
          available: true, repository: report.target.repository, commitSha: report.target.commitSha,
          branchOrTag: report.target.branchOrTag, dirty: report.target.dirty, provenanceKind: "caller-asserted",
        },
  };

  const findingById = new Map(report.projectFindingSnapshots.map((f) => [f.findingId, f]));
  const topEntry = report.prioritizedFindings[0];
  const topFinding = topEntry ? findingById.get(topEntry.findingId) : undefined;

  const executive = {
    verdict: report.releaseEvaluation.result,
    coverage: {
      percent: report.score.coverage.coveragePercent,
      assessed: report.score.coverage.assessedControls,
      applicable: report.score.coverage.applicableControls,
    },
    overallScore: report.score.overallScore,
    confirmedCritical: report.releaseEvaluation.confirmedCriticalVulnerabilities,
    confirmedHigh: report.releaseEvaluation.confirmedHighVulnerabilities,
    blockingControlFailures: [...report.releaseEvaluation.blockingControlFailures],
    blockingControlsNotVerified: [...report.releaseEvaluation.blockingControlsNotVerified],
    topPrioritizedFinding: topFinding
      ? { findingId: topFinding.findingId, title: topFinding.title, severity: topFinding.severity, type: topFinding.type }
      : null,
  };

  const domains: DomainPresentation[] = report.score.domainScores
    .map((d) => ({
      domain: d.domain,
      score: d.score,
      coverage: { percent: d.coveragePercent, assessed: d.assessedControls, applicable: d.applicableControls },
    }))
    .sort((a, b) => compareAscii(a.domain, b.domain));

  const evidenceById = new Map(report.evidenceSnapshots.map((e) => [e.evidenceId, e]));
  const riskAcceptanceById = new Map(report.riskAcceptanceSnapshots.map((r) => [r.riskAcceptanceId, r]));
  const knownFindingIds = new Set(report.projectFindingSnapshots.map((f) => f.findingId));

  const missingEvidenceIds = new Set<string>();
  const missingRiskAcceptanceIds = new Set<string>();
  const missingFindingIds = new Set<string>();
  const unresolvedControlDefinitions = new Set<string>();

  const controls: ControlRow[] = report.runControlAssessmentSnapshots.map((snapshot) => {
    const mismatch = snapshot.title === null;
    if (mismatch) unresolvedControlDefinitions.add(snapshot.controlId);

    const evidence: EvidenceSnapshot[] = [];
    for (const id of snapshot.evidenceIds) {
      const found = evidenceById.get(id);
      if (found) evidence.push(found);
      else missingEvidenceIds.add(id);
    }
    evidence.sort((a, b) => compareAscii(a.evidenceId, b.evidenceId));

    let riskAcceptance: RiskAcceptanceSnapshot | null = null;
    if (snapshot.riskAcceptanceId !== null) {
      const found = riskAcceptanceById.get(snapshot.riskAcceptanceId);
      if (found) riskAcceptance = found;
      else missingRiskAcceptanceIds.add(snapshot.riskAcceptanceId);
    }

    for (const findingId of snapshot.findingIds) {
      if (!knownFindingIds.has(findingId)) missingFindingIds.add(findingId);
    }

    return {
      assessmentId: snapshot.assessmentId,
      controlId: snapshot.controlId,
      controlVersion: snapshot.controlVersion,
      runId: snapshot.runId,
      title: snapshot.title,
      domain: snapshot.domain,
      controlDefinitionVersionMismatch: mismatch,
      recordedStatus: snapshot.recordedStatus,
      effectiveStatus: snapshot.effectiveStatus,
      effectiveStatusReason: snapshot.effectiveStatusReason
        ? {
            code: snapshot.effectiveStatusReason.code,
            label: EFFECTIVE_STATUS_REASON_LABELS[snapshot.effectiveStatusReason.code],
            ...(snapshot.effectiveStatusReason.detail !== undefined ? { detail: snapshot.effectiveStatusReason.detail } : {}),
          }
        : null,
      assessedAt: snapshot.assessedAt,
      assessedBy: snapshot.assessedBy,
      owner: snapshot.owner,
      nextReviewAt: snapshot.nextReviewAt,
      notes: snapshot.notes,
      evidenceIds: [...snapshot.evidenceIds],
      evidence,
      riskAcceptanceId: snapshot.riskAcceptanceId,
      riskAcceptance,
      findingIds: [...snapshot.findingIds],
    };
  });

  controls.sort((a, b) => {
    if (a.domain === null && b.domain !== null) return 1;
    if (a.domain !== null && b.domain === null) return -1;
    if (a.domain !== null && b.domain !== null) {
      const domainCompare = compareAscii(a.domain, b.domain);
      if (domainCompare !== 0) return domainCompare;
    }
    return compareAscii(a.controlId, b.controlId);
  });

  const prioritizedIds = new Set(report.prioritizedFindings.map((f) => f.findingId));
  const prioritizedOrder = report.prioritizedFindings.map((f) => f.findingId);
  const remainder = report.projectFindingSnapshots
    .map((f) => f.findingId)
    .filter((id) => !prioritizedIds.has(id))
    .sort(compareAscii);
  const findingOrder = [...prioritizedOrder, ...remainder];

  const findings: FindingCard[] = findingOrder.map((findingId) => {
    const f = findingById.get(findingId)!;
    return {
      findingId: f.findingId,
      title: f.title,
      type: f.type,
      severity: f.severity,
      status: f.status,
      priorityIndex: f.priorityIndex,
      criticalityIndex: f.criticalityIndex,
      attackScenario: f.attackScenario ?? null,
      exploitabilityEvidence: f.exploitabilityEvidence ?? null,
      linkedControlIds: [...f.controlIds],
    };
  });

  const evidence = [...report.evidenceSnapshots].sort((a, b) => compareAscii(a.evidenceId, b.evidenceId));
  const riskAcceptances = [...report.riskAcceptanceSnapshots].sort((a, b) => compareAscii(a.riskAcceptanceId, b.riskAcceptanceId));

  const referenceIntegrity: ReferenceIntegrity = {
    missingEvidenceIds: [...missingEvidenceIds].sort(compareAscii),
    missingRiskAcceptanceIds: [...missingRiskAcceptanceIds].sort(compareAscii),
    missingFindingIds: [...missingFindingIds].sort(compareAscii),
    unresolvedControlDefinitions: [...unresolvedControlDefinitions].sort(compareAscii),
  };

  const limitations = buildLimitations(report, referenceIntegrity);

  return {
    metadata, executive, domains, controls, findings, evidence, riskAcceptances,
    referenceIntegrity, limitations, assessmentScopes: report.assessmentScopes,
  };
}
