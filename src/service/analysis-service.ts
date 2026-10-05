import type { SecurityRepository } from "../core/repository.js";
import { calculateScore, type Score, type FindingInput as ScoreFindingInput } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation, type FindingInput } from "../core/release-evaluator.js";
import { translateAssessmentsForTrust } from "../core/risk-acceptance.js";
import { ServiceError, withNotFound } from "./errors.js";
import { SCORE_MODEL_ID } from "./constants.js";
import { normalizeFindingSeverity, normalizeFinding } from "./severity.js";

export class AnalysisService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async getScore(projectId: string): Promise<Score> {
    await withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
    const [assessments, findings, controls] = await Promise.all([
      this.repository.getControlAssessments(projectId),
      this.repository.getFindings(projectId),
      this.repository.getControls(),
    ]);
    const model = await this.repository.getScoreModel(SCORE_MODEL_ID);
    const normalizedFindings: ScoreFindingInput[] = findings.map((f) => ({
      controlIds: f.controlIds,
      severity: normalizeFindingSeverity(f.severity),
      status: f.status,
    }));
    try {
      return calculateScore(assessments, controls, normalizedFindings, model);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId });
    }
  }

  async evaluateRelease(projectId: string): Promise<ReleaseEvaluation> {
    const project = await withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
    const [findings, assessments, riskAcceptances, controls, model] = await Promise.all([
      this.repository.getFindings(projectId),
      this.repository.getControlAssessments(projectId),
      this.repository.getRiskAcceptances(projectId),
      this.repository.getControls(),
      this.repository.getScoreModel(SCORE_MODEL_ID),
    ]);
    const normalizedFindings: FindingInput[] = findings.map(normalizeFinding);
    const scoreFindings: ScoreFindingInput[] = findings.map((f) => ({
      controlIds: f.controlIds,
      severity: normalizeFindingSeverity(f.severity),
      status: f.status,
    }));

    // One `now` for the whole evaluation — translateAssessmentsForTrust uses this same instant
    // for every RiskAcceptance validity check, so a single evaluateRelease call can never see
    // two different answers for the same expiry boundary.
    const translatedAssessments = translateAssessmentsForTrust(assessments, project.profileRevision, riskAcceptances, this.now());

    let score: Score;
    try {
      score = calculateScore(translatedAssessments, controls, scoreFindings, model);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId });
    }

    try {
      return evaluateRelease({
        score, findings: normalizedFindings, attackPaths: [], assessments: translatedAssessments,
        securityLevel: project.profile.securityLevel,
      });
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId, securityLevel: project.profile.securityLevel });
    }
  }
}
