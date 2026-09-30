import type { SecurityRepository, Finding, ControlAssessment } from "../core/repository.js";
import { buildReport, type ProjectReport } from "../core/report-builder.js";
import { calculateScore, type Score, type FindingInput as ScoreFindingInput } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation, type FindingInput } from "../core/release-evaluator.js";
import { ServiceError, withNotFound } from "./errors.js";
import { generateUuid } from "./ids.js";
import { CRITICALITY_FORMULA_ID, SCORE_MODEL_ID } from "./constants.js";

export interface GenerateReportInput {
  projectId: string;
  runId: string;
  summary: string;
}

function normalizeFindingSeverity(severity: Finding["severity"]): FindingInput["severity"] {
  return severity === "informational" ? "info" : severity;
}

function normalizeFinding(finding: Finding): FindingInput {
  return {
    findingId: finding.findingId,
    controlIds: finding.controlIds,
    status: finding.status,
    severity: normalizeFindingSeverity(finding.severity),
  };
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

    let score: Score;
    try {
      score = calculateScore(assessments, controls, normalizedFindingsForScore, scoreModel);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId: input.projectId });
    }

    const normalizedFindingsForRelease: FindingInput[] = findings.map(normalizeFinding);
    const normalizedAssessments = assessments.map((a: ControlAssessment) => ({
      controlId: a.controlId,
      status: a.status,
    }));

    let releaseEvaluation: ReleaseEvaluation;
    try {
      releaseEvaluation = evaluateRelease({ score, findings: normalizedFindingsForRelease, attackPaths: [], assessments: normalizedAssessments, securityLevel: project.profile.securityLevel });
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
