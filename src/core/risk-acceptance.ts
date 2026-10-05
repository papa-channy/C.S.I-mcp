import type { ControlAssessment, RiskAcceptance } from "./repository.js";

export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean {
  return ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt;
}

export function translateAssessmentsForTrust(
  assessments: ControlAssessment[],
  currentProfileRevision: number,
  riskAcceptances: RiskAcceptance[],
  nowIso: string
): { controlId: string; status: ControlAssessment["status"] }[] {
  const riskAcceptanceById = new Map(riskAcceptances.map((ra) => [ra.riskAcceptanceId, ra]));
  return assessments.map((a) => {
    const stale = a.profileRevision !== currentProfileRevision;
    const ra = a.riskAcceptanceId ? riskAcceptanceById.get(a.riskAcceptanceId) : undefined;
    const acceptedRiskInvalid = a.status === "ACCEPTED_RISK" && !(ra && isRiskAcceptanceEffectivelyValid(ra, nowIso));
    return { controlId: a.controlId, status: stale || acceptedRiskInvalid ? "NOT_TESTED" : a.status };
  });
}
