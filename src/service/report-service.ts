import type { SecurityRepository } from "../core/repository.js";
import { buildReport, type ProjectReport } from "../core/report-builder.js";
import { calculateScore, type Score, type FindingInput as ScoreFindingInput } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation, type FindingInput } from "../core/release-evaluator.js";
import { translateAssessmentsForTrust } from "../core/risk-acceptance.js";
import { ServiceError, withNotFound } from "./errors.js";
import { generateUuid } from "./ids.js";
import { CRITICALITY_FORMULA_ID, SCORE_MODEL_ID } from "./constants.js";
import { normalizeFindingSeverity, normalizeFinding } from "./severity.js";

export interface GenerateReportInput {
  projectId: string;
  runId: string;
  summary: string;
}

export class ReportService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async generate(input: GenerateReportInput): Promise<ProjectReport> {
    const project = await withNotFound(this.repository.getProject(input.projectId), `Project "${input.projectId}" not found`, { projectId: input.projectId });
    const run = await withNotFound(this.repository.getRun(input.projectId, input.runId), `AssessmentRun "${input.runId}" not found`, { runId: input.runId });

    const [assessments, findings, controls] = await Promise.all([
      this.repository.getControlAssessments(input.projectId),
      this.repository.getFindings(input.projectId),
      this.repository.getControls(),
    ]);
    const [scoreModel, criticalityFormula] = await Promise.all([
      this.repository.getScoreModel(SCORE_MODEL_ID),
      this.repository.getCriticalityFormula(CRITICALITY_FORMULA_ID),
    ]);

    const normalizedFindingsForScore: ScoreFindingInput[] = findings.map((f) => ({
      controlIds: f.controlIds,
      severity: normalizeFindingSeverity(f.severity),
      status: f.status,
    }));

    const riskAcceptances = await this.repository.getRiskAcceptances(input.projectId);
    const translatedAssessments = translateAssessmentsForTrust(assessments, project.profileRevision, riskAcceptances, this.now());

    let score: Score;
    try {
      score = calculateScore(translatedAssessments, controls, normalizedFindingsForScore, scoreModel);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId: input.projectId });
    }

    const normalizedFindingsForRelease: FindingInput[] = findings.map(normalizeFinding);

    let releaseEvaluation: ReleaseEvaluation;
    try {
      releaseEvaluation = evaluateRelease({
        score, findings: normalizedFindingsForRelease, attackPaths: [], assessments: translatedAssessments,
        securityLevel: project.profile.securityLevel,
      });
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId: input.projectId });
    }

    const report = buildReport({
      reportId: generateUuid(),
      run: { runId: run.runId, projectId: run.projectId, catalogVersion: run.catalogVersion, profileRevision: run.profileRevision },
      criticalityFormula: { id: criticalityFormula.formulaId, version: criticalityFormula.version },
      generatedAt: this.now,
      score, findings, releaseEvaluation, summary: input.summary,
    });
    await this.repository.saveReport(report);
    return report;
  }
}
