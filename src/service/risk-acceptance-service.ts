import type { SecurityRepository, RiskAcceptance } from "../core/repository.js";
import { ServiceError } from "./errors.js";
import { nextSequentialId } from "./ids.js";
import { AGENT_IDENTITY } from "./constants.js";

export interface RecordRiskAcceptanceInput {
  projectId: string;
  controlId: string;
  findingIds?: string[];
  reason: string;
  compensatingControls?: string[];
  expiresAt: string;
  reviewDate?: string;
}

export interface RevokeRiskAcceptanceInput {
  projectId: string;
  riskAcceptanceId: string;
  revokedReason: string;
}

export class RiskAcceptanceService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async record(input: RecordRiskAcceptanceInput): Promise<RiskAcceptance> {
    if (Number.isNaN(Date.parse(input.expiresAt))) {
      throw new ServiceError("VALIDATION_ERROR", `expiresAt "${input.expiresAt}" is not a valid date-time`, { expiresAt: input.expiresAt });
    }
    if (input.reviewDate != null && Number.isNaN(Date.parse(input.reviewDate))) {
      throw new ServiceError("VALIDATION_ERROR", `reviewDate "${input.reviewDate}" is not a valid date-time`, { reviewDate: input.reviewDate });
    }
    const existing = await this.repository.getRiskAcceptances(input.projectId);
    const riskAcceptanceId = nextSequentialId("RA", existing.length);
    const ra: RiskAcceptance = {
      riskAcceptanceId, projectId: input.projectId, controlId: input.controlId,
      findingIds: input.findingIds ?? [], reason: input.reason,
      compensatingControls: input.compensatingControls ?? [],
      approvedBy: AGENT_IDENTITY, approvedAt: this.now(), expiresAt: input.expiresAt,
      reviewDate: input.reviewDate ?? null, status: "active", revokedAt: null, revokedReason: null,
    };
    await this.repository.saveRiskAcceptance(input.projectId, ra);
    return ra;
  }

  async revoke(input: RevokeRiskAcceptanceInput): Promise<RiskAcceptance> {
    const all = await this.repository.getRiskAcceptances(input.projectId);
    const existing = all.find((r) => r.riskAcceptanceId === input.riskAcceptanceId);
    if (!existing) {
      throw new ServiceError(
        "NOT_FOUND", `RiskAcceptance "${input.riskAcceptanceId}" not found`,
        { projectId: input.projectId, riskAcceptanceId: input.riskAcceptanceId }
      );
    }
    if (existing.status === "revoked") {
      return existing;
    }
    const revoked: RiskAcceptance = {
      ...existing, status: "revoked", revokedAt: this.now(), revokedReason: input.revokedReason,
    };
    await this.repository.saveRiskAcceptance(input.projectId, revoked);
    return revoked;
  }
}
