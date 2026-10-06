import type { Target } from "./repository.js";
import type { ProjectProfile } from "./applicability.js";
import type { ReleaseEvaluation } from "./release-evaluator.js";

export const REPORT_SCHEMA_VERSION = "2.0.0";

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
  assessmentRunId: string;
  catalogVersion: string;
  profileRevision: number;
  criticalityFormula: { id: string; version: string };
  generatedAt: string;
  score: ScoreForReport;
  prioritizedFindings: PrioritizedFindingInput[];
  projectFindingSnapshots: FindingSnapshot[];
  releaseEvaluation: ReleaseEvaluationForReport;
  target: Target | null;
  profileSnapshot: ProjectProfile | null;
  engineVersionAtRunStart: string | null;
  reportSchemaVersion: string;
  summary: string;
}

export function buildReport(input: {
  reportId: string;
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

  return {
    reportId: input.reportId,
    projectId: input.run.projectId,
    assessmentRunId: input.run.runId,
    catalogVersion: input.run.catalogVersion,
    profileRevision: input.run.profileRevision,
    criticalityFormula: input.criticalityFormula,
    generatedAt: input.generatedAt(),
    score: roundedScore,
    prioritizedFindings: sortPrioritizedFindings(projected),
    projectFindingSnapshots: buildProjectFindingSnapshots(input.findings),
    releaseEvaluation: roundedReleaseEvaluation,
    target: input.run.target ?? null,
    profileSnapshot: input.run.profileSnapshot ?? null,
    engineVersionAtRunStart: input.run.engineVersionAtRunStart ?? null,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    summary: input.summary,
  };
}
