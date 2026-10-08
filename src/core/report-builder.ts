import type { Target, ControlAssessment, Control, Evidence, RiskAcceptance } from "./repository.js";
import type { ProjectProfile } from "./applicability.js";
import type { ReleaseEvaluation } from "./release-evaluator.js";
import type { EffectiveStatusReason, TrustNormalizedAssessment } from "./risk-acceptance.js";

export const REPORT_SCHEMA_VERSION = "2.1.0";

export function roundReportNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`roundReportNumber: non-finite value ${value} cannot be serialized into a ProjectReport`);
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export interface PrioritizedFindingInput {
  findingId: string;
  priorityIndex: number;
  criticalityIndex: number;
  title: string;
}

export function sortPrioritizedFindings(findings: PrioritizedFindingInput[]): PrioritizedFindingInput[] {
  return [...findings].sort(
    (a, b) => a.priorityIndex - b.priorityIndex || b.criticalityIndex - a.criticalityIndex || a.findingId.localeCompare(b.findingId)
  );
}

export interface FindingSnapshot {
  findingId: string;
  title: string;
  type: FindingForReport["type"];
  severity: FindingForReport["severity"];
  controlIds: string[];
  status: FindingForReport["status"];
  priorityIndex: number;
  criticalityIndex: number;
  attackScenario?: string;
  exploitabilityEvidence?: string;
}

export function buildProjectFindingSnapshots(findings: FindingForReport[]): FindingSnapshot[] {
  const snapshots: FindingSnapshot[] = findings.map((f) => ({
    findingId: f.findingId,
    title: f.title,
    type: f.type,
    severity: f.severity,
    controlIds: [...f.controlIds], // defensive copy — ProjectReport is an immutable snapshot and must not share array references with its input
    status: f.status,
    priorityIndex: f.priority.index,
    criticalityIndex: f.criticality.index,
    ...(f.attackScenario !== undefined ? { attackScenario: f.attackScenario } : {}),
    ...(f.exploitabilityEvidence !== undefined ? { exploitabilityEvidence: f.exploitabilityEvidence } : {}),
  }));
  // Explicit ASCII/code-unit comparison, not localeCompare — localeCompare's result can vary with
  // the running environment's ICU/locale configuration, which would undermine the byte-reproducible
  // ordering this sort exists to guarantee.
  return snapshots.sort((a, b) => (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0));
}

export interface ControlAssessmentSnapshot {
  assessmentId: string;
  runId: string;
  controlId: string;
  controlVersion: number;
  title: string | null;
  domain: string | null;
  profileRevision: number;
  applicability: ControlAssessment["applicability"];
  recordedStatus: ControlAssessment["status"];
  effectiveStatus: ControlAssessment["status"];
  effectiveStatusReason: EffectiveStatusReason | null;
  evidenceIds: string[];
  findingIds: string[];
  riskAcceptanceId: string | null;
  owner: string;
  assessedBy: string;
  assessedAt: string;
  nextReviewAt: string | null;
  notes: string | null;
}

export function buildRunControlAssessmentSnapshots(
  allAssessments: ControlAssessment[],
  translatedAssessments: TrustNormalizedAssessment[],
  controls: Control[],
  runId: string
): ControlAssessmentSnapshot[] {
  const normalizedByAssessmentId = new Map(translatedAssessments.map((n) => [n.assessmentId, n]));
  const controlByIdAndVersion = new Map(controls.map((c) => [`${c.controlId}@${c.version}`, c]));

  const snapshots: ControlAssessmentSnapshot[] = allAssessments
    .filter((a) => a.runId === runId)
    .map((a) => {
      const normalized = normalizedByAssessmentId.get(a.assessmentId);
      if (!normalized) {
        throw new Error(
          `buildRunControlAssessmentSnapshots: assessment "${a.assessmentId}" has no matching entry in translatedAssessments — ` +
            `every ControlAssessment fed to translateAssessmentsForTrust must appear exactly once in its result`
        );
      }
      const control = controlByIdAndVersion.get(`${a.controlId}@${a.controlVersion}`);
      return {
        assessmentId: a.assessmentId,
        runId: a.runId,
        controlId: a.controlId,
        controlVersion: a.controlVersion,
        title: control?.title ?? null,
        domain: control?.domain ?? null,
        profileRevision: a.profileRevision,
        applicability: a.applicability,
        recordedStatus: normalized.recordedStatus,
        effectiveStatus: normalized.status,
        effectiveStatusReason: normalized.effectiveStatusReason,
        evidenceIds: [...a.evidenceIds],
        findingIds: [...a.findingIds],
        riskAcceptanceId: a.riskAcceptanceId,
        owner: a.owner,
        assessedBy: a.assessedBy,
        assessedAt: a.assessedAt,
        nextReviewAt: a.nextReviewAt,
        notes: a.notes,
      };
    });

  return snapshots.sort((a, b) => (a.controlId < b.controlId ? -1 : a.controlId > b.controlId ? 1 : 0));
}

export interface EvidenceSnapshot {
  evidenceId: string;
  type: Evidence["type"];
  location: string;
  description: string | null;
  capturedAt: string;
  capturedBy: string;
}

export function buildEvidenceSnapshots(allEvidence: Evidence[], referencedIds: Set<string>): EvidenceSnapshot[] {
  const snapshots: EvidenceSnapshot[] = allEvidence
    .filter((e) => referencedIds.has(e.evidenceId))
    .map((e) => ({
      evidenceId: e.evidenceId,
      type: e.type,
      location: e.location,
      description: e.description ?? null,
      capturedAt: e.capturedAt,
      capturedBy: e.capturedBy,
    }));
  return snapshots.sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
}

export interface RiskAcceptanceSnapshot {
  riskAcceptanceId: string;
  controlId: string;
  findingIds: string[];
  reason: string;
  compensatingControls: string[];
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  reviewDate: string | null;
  status: "active" | "expired" | "revoked";
  revokedAt: string | null;
  revokedReason: string | null;
}

export function buildRiskAcceptanceSnapshots(allRiskAcceptances: RiskAcceptance[], referencedIds: Set<string>): RiskAcceptanceSnapshot[] {
  const snapshots: RiskAcceptanceSnapshot[] = allRiskAcceptances
    .filter((r) => referencedIds.has(r.riskAcceptanceId))
    .map((r) => ({
      riskAcceptanceId: r.riskAcceptanceId,
      controlId: r.controlId,
      findingIds: [...r.findingIds],
      reason: r.reason,
      compensatingControls: [...r.compensatingControls],
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
      expiresAt: r.expiresAt,
      reviewDate: r.reviewDate,
      status: r.status,
      revokedAt: r.revokedAt,
      revokedReason: r.revokedReason,
    }));
  return snapshots.sort((a, b) => (a.riskAcceptanceId < b.riskAcceptanceId ? -1 : a.riskAcceptanceId > b.riskAcceptanceId ? 1 : 0));
}

export interface AssessmentScope {
  kind: "project";
}
export interface AssessmentSetScope {
  kind: "project-assessment-set";
  contributingRunIds: string[];
}
export interface RunScope {
  kind: "run";
  runId: string;
}
export interface ReferencedByRunScope {
  kind: "referenced-by-run";
  runId: string;
}
export interface AssessmentScopes {
  projectFindingSnapshots: AssessmentScope;
  score: AssessmentSetScope;
  releaseEvaluation: AssessmentSetScope;
  runControlAssessmentSnapshots: RunScope;
  evidenceSnapshots: ReferencedByRunScope;
  riskAcceptanceSnapshots: ReferencedByRunScope;
}

export function buildAssessmentScopes(translatedAssessments: TrustNormalizedAssessment[], runId: string): AssessmentScopes {
  const contributingRunIds = [...new Set(translatedAssessments.map((a) => a.runId))].sort();
  return {
    projectFindingSnapshots: { kind: "project" },
    score: { kind: "project-assessment-set", contributingRunIds },
    releaseEvaluation: { kind: "project-assessment-set", contributingRunIds },
    runControlAssessmentSnapshots: { kind: "run", runId },
    evidenceSnapshots: { kind: "referenced-by-run", runId },
    riskAcceptanceSnapshots: { kind: "referenced-by-run", runId },
  };
}

export interface FindingForReport {
  findingId: string;
  title: string;
  type: "confirmed_vulnerability" | "likely_vulnerability" | "control_gap" | "hardening" | "process_gap" | "accepted_design" | "needs_validation";
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  priority: { index: number };
  criticality: { index: number };
  attackScenario?: string;
  exploitabilityEvidence?: string;
}

export interface DomainScoreForReport {
  domain: string;
  score: number;
  totalControls: number;
  applicableControls: number;
  assessedControls: number;
  coveragePercent: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  notTestedCount: number;
  notApplicableCount: number;
  acceptedRiskCount: number;
  criticalSeverityFindings: number;
  highSeverityFindings: number;
}

export interface ScoreForReport {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: DomainScoreForReport[];
}

export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  confirmedCriticalVulnerabilities: number;
  confirmedHighVulnerabilities: number;
  residualRisksAccepted: number;
  blockingControlFailures: string[];
  blockingControlsNotVerified: string[];
  result: "approved" | "blocked" | "indeterminate";
}

export interface ProjectReport {
  reportId: string;
  projectId: string;
  projectName: string;
  assessmentRunId: string;
  catalogVersion: string;
  profileRevision: number;
  criticalityFormula: { id: string; version: string };
  generatedAt: string;
  score: ScoreForReport;
  prioritizedFindings: PrioritizedFindingInput[];
  projectFindingSnapshots: FindingSnapshot[];
  runControlAssessmentSnapshots: ControlAssessmentSnapshot[];
  evidenceSnapshots: EvidenceSnapshot[];
  riskAcceptanceSnapshots: RiskAcceptanceSnapshot[];
  assessmentScopes: AssessmentScopes;
  releaseEvaluation: ReleaseEvaluationForReport;
  target: Target | null;
  profileSnapshot: ProjectProfile | null;
  engineVersionAtRunStart: string | null;
  reportSchemaVersion: string;
  summary: string;
}

export function buildReport(input: {
  reportId: string;
  projectName: string;
  run: {
    runId: string;
    projectId: string;
    catalogVersion: string;
    profileRevision: number;
    target?: Target | null;
    profileSnapshot?: ProjectProfile | null;
    engineVersionAtRunStart?: string | null;
  };
  criticalityFormula: { id: string; version: string };
  generatedAt: () => string;
  score: ScoreForReport;
  findings: FindingForReport[];
  releaseEvaluation: ReleaseEvaluation;
  summary: string;
  allAssessments: ControlAssessment[];
  translatedAssessments: TrustNormalizedAssessment[];
  controls: Control[];
  allEvidence: Evidence[];
  allRiskAcceptances: RiskAcceptance[];
}): ProjectReport {
  const actionable = input.findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const projected: PrioritizedFindingInput[] = actionable.map((f) => ({
    findingId: f.findingId,
    priorityIndex: f.priority.index,
    criticalityIndex: f.criticality.index,
    title: f.title,
  }));

  const roundedScore: ScoreForReport = {
    ...input.score,
    overallScore: roundReportNumber(input.score.overallScore),
    coverage: { ...input.score.coverage, coveragePercent: roundReportNumber(input.score.coverage.coveragePercent) },
    domainScores: input.score.domainScores.map((d) => ({
      ...d,
      score: roundReportNumber(d.score),
      coveragePercent: roundReportNumber(d.coveragePercent),
    })),
  };
  // Explicit field-by-field projection — deliberately NOT a spread. input.releaseEvaluation is the
  // full core ReleaseEvaluation (it always still carries unblockedCriticalAttackPaths/
  // incidentResponseVerified/backupRestoreVerified, per Task 2/§3.4/§3.5); a spread would silently
  // carry those 3 fields through into the real JSON despite ReleaseEvaluationForReport's type no
  // longer declaring them, since TypeScript's excess-property checking does not apply to spreads.
  // Naming every field explicitly is what actually drops them.
  const roundedReleaseEvaluation: ReleaseEvaluationForReport = {
    gate: input.releaseEvaluation.gate,
    controlCoverage: roundReportNumber(input.releaseEvaluation.controlCoverage),
    confirmedCriticalVulnerabilities: input.releaseEvaluation.confirmedCriticalVulnerabilities,
    confirmedHighVulnerabilities: input.releaseEvaluation.confirmedHighVulnerabilities,
    residualRisksAccepted: input.releaseEvaluation.residualRisksAccepted,
    blockingControlFailures: input.releaseEvaluation.blockingControlFailures,
    blockingControlsNotVerified: input.releaseEvaluation.blockingControlsNotVerified,
    result: input.releaseEvaluation.result,
  };

  const runControlAssessmentSnapshots = buildRunControlAssessmentSnapshots(
    input.allAssessments, input.translatedAssessments, input.controls, input.run.runId
  );
  const referencedEvidenceIds = new Set(runControlAssessmentSnapshots.flatMap((s) => s.evidenceIds));
  const referencedRiskAcceptanceIds = new Set(
    runControlAssessmentSnapshots.map((s) => s.riskAcceptanceId).filter((id): id is string => id !== null)
  );

  return {
    reportId: input.reportId,
    projectId: input.run.projectId,
    projectName: input.projectName,
    assessmentRunId: input.run.runId,
    catalogVersion: input.run.catalogVersion,
    profileRevision: input.run.profileRevision,
    criticalityFormula: input.criticalityFormula,
    generatedAt: input.generatedAt(),
    score: roundedScore,
    prioritizedFindings: sortPrioritizedFindings(projected),
    projectFindingSnapshots: buildProjectFindingSnapshots(input.findings),
    runControlAssessmentSnapshots,
    evidenceSnapshots: buildEvidenceSnapshots(input.allEvidence, referencedEvidenceIds),
    riskAcceptanceSnapshots: buildRiskAcceptanceSnapshots(input.allRiskAcceptances, referencedRiskAcceptanceIds),
    assessmentScopes: buildAssessmentScopes(input.translatedAssessments, input.run.runId),
    releaseEvaluation: roundedReleaseEvaluation,
    target: input.run.target ?? null,
    profileSnapshot: input.run.profileSnapshot ?? null,
    engineVersionAtRunStart: input.run.engineVersionAtRunStart ?? null,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    summary: input.summary,
  };
}
