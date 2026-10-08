import { createHash } from "node:crypto";
import type { SecurityRepository } from "../core/repository.js";
import { buildReport, type ProjectReport } from "../core/report-builder.js";
import { calculateScore, type Score, type FindingInput as ScoreFindingInput } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation, type FindingInput } from "../core/release-evaluator.js";
import { translateAssessmentsForTrust } from "../core/risk-acceptance.js";
import { buildPresentationModel } from "../core/presentation-model.js";
import { renderReportHtml, REPORT_HTML_RENDERER_VERSION } from "../core/report-html-renderer.js";
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
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly d3Source?: string
  ) {}

  async generateData(input: GenerateReportInput): Promise<ProjectReport> {
    const project = await withNotFound(this.repository.getProject(input.projectId), `Project "${input.projectId}" not found`, { projectId: input.projectId });
    const run = await withNotFound(this.repository.getRun(input.projectId, input.runId), `AssessmentRun "${input.runId}" not found`, { runId: input.runId });

    const [assessments, findings, controls, evidence] = await Promise.all([
      this.repository.getControlAssessments(input.projectId),
      this.repository.getFindings(input.projectId),
      this.repository.getControls(),
      this.repository.getEvidence(input.projectId),
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
      projectName: project.name,
      run: {
        runId: run.runId, projectId: run.projectId, catalogVersion: run.catalogVersion, profileRevision: run.profileRevision,
        target: run.target ?? null, profileSnapshot: run.profileSnapshot ?? null, engineVersionAtRunStart: run.engineVersionAtRunStart ?? null,
      },
      criticalityFormula: { id: criticalityFormula.formulaId, version: criticalityFormula.version },
      generatedAt: this.now,
      score, findings, releaseEvaluation, summary: input.summary,
      allAssessments: assessments,
      translatedAssessments: translatedAssessments,
      controls,
      allEvidence: evidence,
      allRiskAcceptances: riskAcceptances,
    });
    await this.repository.saveReport(report);
    return report;
  }

  async generateHtml(input: { projectId: string; reportId: string }): Promise<{ html: string; path: string; sourceReportSha256: string }> {
    if (this.d3Source === undefined) {
      throw new Error("ReportService.generateHtml: no d3Source was injected into this ReportService instance");
    }
    const rawBytes = await withNotFound(
      this.repository.getReportRawBytes(input.projectId, input.reportId),
      `ProjectReport "${input.reportId}" not found`,
      { reportId: input.reportId }
    );
    const report = JSON.parse(rawBytes.toString("utf-8")) as ProjectReport;
    if (report.reportSchemaVersion !== "2.1.0") {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        `generate_report_html requires reportSchemaVersion "2.1.0", got "${report.reportSchemaVersion}" — regenerate this report via generate_report_data first`,
        { reportId: input.reportId, reportSchemaVersion: report.reportSchemaVersion }
      );
    }
    const sourceReportSha256 = createHash("sha256").update(rawBytes).digest("hex");
    const model = buildPresentationModel(report, {
      rendererVersion: REPORT_HTML_RENDERER_VERSION,
      rendererRenderedAt: this.now(),
      sourceReportSha256,
    });
    const html = renderReportHtml(model, { d3Source: this.d3Source });
    const path = await this.repository.saveReportHtml(input.projectId, input.reportId, html);
    return { html, path, sourceReportSha256 };
  }
}
