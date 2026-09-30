import type {
  AssessmentBatch, AssessmentRun, Control, ControlAssessment, Evidence, Finding, Project,
  ReleaseGateData, SecurityRepository, Threat,
} from "../../src/core/repository.js";
import type { AssessmentPlan } from "../../src/core/plan-expander.js";
import type { CriticalityFormula } from "../../src/core/criticality.js";
import type { ScoreModel } from "../../src/core/score.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

export class FakeRepository implements SecurityRepository {
  projects = new Map<string, Project>();
  controls: Control[] = [];
  threats: Threat[] = [];
  criticalityFormula: CriticalityFormula | undefined;
  scoreModel: ScoreModel | undefined;
  releaseGates: ReleaseGateData = { gates: [], releaseBlockers: [], revalidationTriggers: [] };
  catalogVersion = "1.0.0-fake";
  plans = new Map<string, AssessmentPlan>();
  assessments = new Map<string, ControlAssessment[]>();
  findings = new Map<string, Finding[]>();
  evidence = new Map<string, Evidence[]>();
  runs = new Map<string, AssessmentRun>();
  batches = new Map<string, AssessmentBatch>();
  reports = new Map<string, ProjectReport>();

  async getProject(projectId: string): Promise<Project> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`FakeRepository: no such project "${projectId}"`);
    return project;
  }
  async getControls(): Promise<Control[]> {
    return this.controls;
  }
  async getThreats(): Promise<Threat[]> {
    return this.threats;
  }
  async getCriticalityFormula(formulaId: string): Promise<CriticalityFormula> {
    if (!this.criticalityFormula || this.criticalityFormula.formulaId !== formulaId) {
      throw new Error(`FakeRepository: no criticality formula "${formulaId}"`);
    }
    return this.criticalityFormula;
  }
  async getScoreModel(modelId: string): Promise<ScoreModel> {
    if (!this.scoreModel || this.scoreModel.modelId !== modelId) {
      throw new Error(`FakeRepository: no score model "${modelId}"`);
    }
    return this.scoreModel;
  }
  async getReleaseGates(): Promise<ReleaseGateData> {
    return this.releaseGates;
  }
  async getPlan(planId: string): Promise<AssessmentPlan> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`FakeRepository: no such plan "${planId}"`);
    return plan;
  }
  async getCatalogVersion(): Promise<string> {
    return this.catalogVersion;
  }
  async getControlAssessments(projectId: string, _runId?: string): Promise<ControlAssessment[]> {
    return this.assessments.get(projectId) ?? [];
  }
  async getFindings(projectId: string): Promise<Finding[]> {
    return this.findings.get(projectId) ?? [];
  }
  async getEvidence(projectId: string): Promise<Evidence[]> {
    return this.evidence.get(projectId) ?? [];
  }
  async getRun(_projectId: string, runId: string): Promise<AssessmentRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`FakeRepository: no such run "${runId}"`);
    return run;
  }
  async saveRun(run: AssessmentRun): Promise<void> {
    this.runs.set(run.runId, run);
  }
  async saveBatch(batch: AssessmentBatch): Promise<void> {
    this.batches.set(batch.batchId, batch);
  }
  async saveReport(report: ProjectReport): Promise<void> {
    this.reports.set(report.reportId, report);
  }
  async savePlan(plan: AssessmentPlan): Promise<void> {
    this.plans.set(plan.planId, plan);
  }
  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.projectId, project);
  }
  async saveControlAssessment(assessment: ControlAssessment): Promise<void> {
    const list = this.assessments.get(assessment.projectId) ?? [];
    const next = list.filter((a) => a.controlId !== assessment.controlId);
    next.push(assessment);
    this.assessments.set(assessment.projectId, next);
  }
  async saveFinding(projectId: string, finding: Finding): Promise<void> {
    const list = this.findings.get(projectId) ?? [];
    list.push(finding);
    this.findings.set(projectId, list);
  }
  async saveEvidence(projectId: string, evidence: Evidence): Promise<void> {
    const list = this.evidence.get(projectId) ?? [];
    list.push(evidence);
    this.evidence.set(projectId, list);
  }
}
