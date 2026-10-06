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

export interface FindingForReport {
  findingId: string;
  title: string;
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  priority: { index: number };
  criticality: { index: number };
}

export interface ScoreForReport {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: unknown[];
}

export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  confirmedCriticalVulnerabilities: number;
  confirmedHighVulnerabilities: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
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
  releaseEvaluation: ReleaseEvaluationForReport;
  summary: string;
}

export function buildReport(input: {
  reportId: string;
  run: { runId: string; projectId: string; catalogVersion: string; profileRevision: number };
  criticalityFormula: { id: string; version: string };
  generatedAt: () => string;
  score: ScoreForReport;
  findings: FindingForReport[];
  releaseEvaluation: ReleaseEvaluationForReport;
  summary: string;
}): ProjectReport {
  const actionable = input.findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const projected: PrioritizedFindingInput[] = actionable.map((f) => ({
    findingId: f.findingId,
    priorityIndex: f.priority.index,
    criticalityIndex: f.criticality.index,
    title: f.title,
  }));

  return {
    reportId: input.reportId,
    projectId: input.run.projectId,
    assessmentRunId: input.run.runId,
    catalogVersion: input.run.catalogVersion,
    profileRevision: input.run.profileRevision,
    criticalityFormula: input.criticalityFormula,
    generatedAt: input.generatedAt(),
    score: input.score,
    prioritizedFindings: sortPrioritizedFindings(projected),
    releaseEvaluation: input.releaseEvaluation,
    summary: input.summary,
  };
}
