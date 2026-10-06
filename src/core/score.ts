export interface ControlAssessmentInput {
  controlId: string;
  status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";
}

export interface ControlDomainInput {
  controlId: string;
  domain: string;
}

export interface FindingInput {
  controlIds: string[];
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
}

export interface ScoreModel {
  modelId: string;
  version: string;
  statusWeights: Record<"PASS" | "PARTIAL" | "FAIL" | "NOT_TESTED", number>;
  excludedStatuses: ("N/A" | "ACCEPTED_RISK")[];
}

export interface DomainScore {
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

export interface Score {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: DomainScore[];
}

function isExcluded(status: ControlAssessmentInput["status"], model: ScoreModel): boolean {
  return (model.excludedStatuses as string[]).includes(status);
}

function computeScore(subset: ControlAssessmentInput[], model: ScoreModel): number | null {
  const eligible = subset.filter((a) => !isExcluded(a.status, model));
  if (eligible.length === 0) return null;
  const sum = eligible.reduce((s, a) => s + (model.statusWeights[a.status as keyof ScoreModel["statusWeights"]] ?? 0), 0);
  return (100 * sum) / eligible.length;
}

function countActiveFindings(findings: FindingInput[], controlIds: Set<string>, severity: FindingInput["severity"]): number {
  return findings.filter(
    (f) =>
      (f.status === "open" || f.status === "in_progress") &&
      f.severity === severity &&
      f.controlIds.some((id) => controlIds.has(id))
  ).length;
}

/**
 * Precondition (not enforced): every control the caller considers applicable/in-scope must have a
 * corresponding entry in `assessments` (even if its status is `"NOT_TESTED"`) — a control present in
 * `controls` but entirely absent from `assessments` is silently excluded from both the domain's counts
 * and the score, rather than being treated as untested.
 */
export function calculateScore(
  assessments: ControlAssessmentInput[],
  controls: ControlDomainInput[],
  findings: FindingInput[],
  model: ScoreModel
): Score {
  const overallScore = computeScore(assessments, model);
  if (overallScore === null) {
    throw new Error("calculateScore: every assessment is an excluded status (N/A/ACCEPTED_RISK) — nothing to score");
  }

  const applicableAssessments = assessments.filter((a) => !isExcluded(a.status, model));
  const applicableControls = applicableAssessments.length;
  const assessedControls = applicableAssessments.filter((a) => a.status !== "NOT_TESTED").length;
  const coveragePercent = (assessedControls / applicableControls) * 100;

  const domains = [...new Set(controls.map((c) => c.domain))].sort();
  const domainScores: DomainScore[] = [];
  for (const domain of domains) {
    const domainControlIds = new Set(controls.filter((c) => c.domain === domain).map((c) => c.controlId));
    const domainAssessments = assessments.filter((a) => domainControlIds.has(a.controlId));
    const domainScoreValue = computeScore(domainAssessments, model);
    if (domainScoreValue === null) continue; // zero non-excluded controls in this domain: omit it entirely

    const domainApplicable = domainAssessments.filter((a) => !isExcluded(a.status, model));
    domainScores.push({
      domain,
      score: domainScoreValue,
      totalControls: domainAssessments.length,
      applicableControls: domainApplicable.length,
      assessedControls: domainApplicable.filter((a) => a.status !== "NOT_TESTED").length,
      coveragePercent: (domainApplicable.filter((a) => a.status !== "NOT_TESTED").length / domainApplicable.length) * 100,
      passCount: domainAssessments.filter((a) => a.status === "PASS").length,
      failCount: domainAssessments.filter((a) => a.status === "FAIL").length,
      partialCount: domainAssessments.filter((a) => a.status === "PARTIAL").length,
      notTestedCount: domainAssessments.filter((a) => a.status === "NOT_TESTED").length,
      notApplicableCount: domainAssessments.filter((a) => a.status === "N/A").length,
      acceptedRiskCount: domainAssessments.filter((a) => a.status === "ACCEPTED_RISK").length,
      criticalSeverityFindings: countActiveFindings(findings, domainControlIds, "critical"),
      highSeverityFindings: countActiveFindings(findings, domainControlIds, "high"),
    });
  }

  return {
    overallScore,
    coverage: { applicableControls, assessedControls, coveragePercent },
    scoreModel: { id: model.modelId, version: model.version },
    domainScores,
  };
}
