import type { Finding } from "../core/repository.js";
import type { FindingInput } from "../core/release-evaluator.js";

export function normalizeFindingSeverity(severity: Finding["severity"]): FindingInput["severity"] {
  return severity === "informational" ? "info" : severity;
}

export function normalizeFinding(finding: Finding): FindingInput {
  return {
    findingId: finding.findingId,
    controlIds: finding.controlIds,
    status: finding.status,
    severity: normalizeFindingSeverity(finding.severity),
  };
}
