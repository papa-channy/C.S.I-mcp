import type { SecurityRepository, ControlAssessment } from "../core/repository.js";
import { calculateScore, type Score, type FindingInput as ScoreFindingInput } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation, type FindingInput } from "../core/release-evaluator.js";
import { ServiceError, withNotFound } from "./errors.js";
import { SCORE_MODEL_ID } from "./constants.js";
import { normalizeFindingSeverity, normalizeFinding } from "./severity.js";

export class AnalysisService {
  constructor(private readonly repository: SecurityRepository) {}

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
    const score = await this.getScore(projectId);
    const [findings, assessments] = await Promise.all([
      this.repository.getFindings(projectId),
      this.repository.getControlAssessments(projectId),
    ]);
    const normalizedFindings: FindingInput[] = findings.map(normalizeFinding);
    const normalizedAssessments = assessments.map((a: ControlAssessment) => ({
      controlId: a.controlId,
      status: a.status,
    }));
    try {
      return evaluateRelease({ score, findings: normalizedFindings, attackPaths: [], assessments: normalizedAssessments, securityLevel: project.profile.securityLevel });
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId, securityLevel: project.profile.securityLevel });
    }
  }
}
