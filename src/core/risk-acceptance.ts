import type { ControlAssessment, RiskAcceptance } from "./repository.js";

export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean {
  return ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt;
}

export type EffectiveStatusReasonCode =
  | "stale_profile"
  | "risk_acceptance_missing"
  | "risk_acceptance_expired"
  | "risk_acceptance_revoked"
  | "risk_acceptance_scope_mismatch";

export interface EffectiveStatusReason {
  code: EffectiveStatusReasonCode;
  detail?: string;
}

export interface TrustNormalizedAssessment {
  assessmentId: string;
  controlId: string;
  runId: string;
  recordedStatus: ControlAssessment["status"];
  status: ControlAssessment["status"]; // kept as "status" — calculateScore/evaluateRelease consume ControlAssessmentInput = {controlId, status}
  effectiveStatusReason: EffectiveStatusReason | null;
}

export function translateAssessmentsForTrust(
  assessments: ControlAssessment[],
  currentProfileRevision: number,
  riskAcceptances: RiskAcceptance[],
  nowIso: string
): TrustNormalizedAssessment[] {
  const riskAcceptanceById = new Map(riskAcceptances.map((ra) => [ra.riskAcceptanceId, ra]));

  return assessments.map((a) => {
    const stale = a.profileRevision !== currentProfileRevision;
    let reason: EffectiveStatusReason | null = null;
    let forceNotTested = false;

    if (stale) {
      forceNotTested = true;
      reason = { code: "stale_profile" };
    } else if (a.status === "ACCEPTED_RISK") {
      const ra = a.riskAcceptanceId ? riskAcceptanceById.get(a.riskAcceptanceId) : undefined;
      if (!ra) {
        forceNotTested = true;
        reason = { code: "risk_acceptance_missing" };
      } else if (ra.controlId !== a.controlId) {
        forceNotTested = true;
        reason = {
          code: "risk_acceptance_scope_mismatch",
          detail: `riskAcceptanceId ${ra.riskAcceptanceId} is scoped to control ${ra.controlId}, not ${a.controlId}`,
        };
      } else if (ra.status === "revoked") {
        forceNotTested = true;
        reason = { code: "risk_acceptance_revoked" };
      } else if (ra.status === "expired" || nowIso >= ra.expiresAt) {
        forceNotTested = true;
        reason = { code: "risk_acceptance_expired" };
      } else if (nowIso < ra.approvedAt) {
        forceNotTested = true;
        reason = { code: "risk_acceptance_expired", detail: "risk acceptance not yet approved" };
      }
    }

    const effectiveStatus = forceNotTested ? "NOT_TESTED" : a.status;

    return {
      assessmentId: a.assessmentId,
      controlId: a.controlId,
      runId: a.runId,
      recordedStatus: a.status,
      status: effectiveStatus,
      effectiveStatusReason: effectiveStatus === a.status ? null : reason,
    };
  });
}
