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
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  result: "approved" | "blocked";
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
