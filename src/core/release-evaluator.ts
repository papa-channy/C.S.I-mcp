export const RELEASE_GATE_CONTROL_MAP = {
  incidentResponseVerified: "GOV-IR-001",
  backupRestoreVerified: "OPS-BACKUP-TEST-001",
} as const;

// Below this coverage, an otherwise-clean finding set is not good evidence of a
// clean release — it may just mean most applicable controls were never assessed.
// "approved" is downgraded to "indeterminate" in that case; a result that was
// already "blocked" on findings/thresholds stays "blocked" regardless of coverage.
export const MIN_COVERAGE_FOR_APPROVAL_PERCENT = 80;

export interface ScoreInput {
  coverage: { coveragePercent: number };
}

export type FindingType =
  | "confirmed_vulnerability"
  | "likely_vulnerability"
  | "control_gap"
  | "hardening"
  | "process_gap"
  | "accepted_design"
  | "needs_validation";

export interface FindingInput {
  findingId: string;
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "info";
  type: FindingType;
}

export interface AttackPathInput {
  result: "blocked" | "possible";
  relatedFindingIds: string[];
}

export interface ControlAssessmentInput {
  controlId: string;
  status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";
}

export interface ReleaseEvaluation {
  gate: 4;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  result: "approved" | "blocked" | "indeterminate";
}

export function evaluateRelease(inputs: {
  score: ScoreInput;
  findings: FindingInput[];
  attackPaths: AttackPathInput[];
  assessments: ControlAssessmentInput[];
  securityLevel: string;
}): ReleaseEvaluation {
  const { score, findings, attackPaths, assessments, securityLevel } = inputs;

  if (securityLevel !== "SVL-2" && securityLevel !== "SVL-3") {
    throw new Error(
      `evaluateRelease: gate 4 (production_release) has no defined threshold for securityLevel "${securityLevel}" — only SVL-2/SVL-3 are covered by data/process/release-gates.json`
    );
  }

  // Gate counts only confirmed_vulnerability findings — a high/critical severity
  // control_gap, hardening, process_gap, etc. finding is real and worth fixing,
  // but it is not a demonstrated exploitable vulnerability and should not by
  // itself block a release the way a confirmed_vulnerability does.
  const activeFindings = findings.filter(
    (f) => (f.status === "open" || f.status === "in_progress") && f.type === "confirmed_vulnerability"
  );
  const activeCritical = activeFindings.filter((f) => f.severity === "critical");
  const activeHigh = activeFindings.filter((f) => f.severity === "high");
  const criticalFindings = activeCritical.length;
  const highFindings = activeHigh.length;

  const criticalFindingIds = new Set(activeCritical.map((f) => f.findingId));
  const unblockedCriticalAttackPaths = attackPaths.filter(
    (ap) => ap.result === "possible" && ap.relatedFindingIds.some((id) => criticalFindingIds.has(id))
  ).length;

  const residualRisksAccepted = assessments.filter((a) => a.status === "ACCEPTED_RISK").length;

  const assessmentByControl = new Map(assessments.map((a) => [a.controlId, a.status]));
  const incidentResponseVerified = assessmentByControl.get(RELEASE_GATE_CONTROL_MAP.incidentResponseVerified) === "PASS";
  const backupRestoreVerified = assessmentByControl.get(RELEASE_GATE_CONTROL_MAP.backupRestoreVerified) === "PASS";

  const uncoveredHigh = activeHigh.filter(
    (f) => !(f.controlIds.length > 0 && f.controlIds.every((id) => assessmentByControl.get(id) === "ACCEPTED_RISK"))
  );
  const highFindingsSatisfied = securityLevel === "SVL-3" ? highFindings === 0 : uncoveredHigh.length === 0;

  const findingThresholdsPass = criticalFindings === 0 && highFindingsSatisfied;
  const result: "approved" | "blocked" | "indeterminate" = !findingThresholdsPass
    ? "blocked"
    : score.coverage.coveragePercent < MIN_COVERAGE_FOR_APPROVAL_PERCENT
      ? "indeterminate"
      : "approved";

  return {
    gate: 4,
    controlCoverage: score.coverage.coveragePercent,
    criticalFindings,
    highFindings,
    unblockedCriticalAttackPaths,
    residualRisksAccepted,
    incidentResponseVerified,
    backupRestoreVerified,
    result,
  };
}
