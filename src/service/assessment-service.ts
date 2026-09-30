import type { AssessmentRun, Control, ControlAssessment, SecurityRepository } from "../core/repository.js";
import type { AssessmentPlan } from "../core/plan-expander.js";
import { evaluateApplicability, type Verdict } from "../core/applicability.js";
import { withNotFound } from "./errors.js";
import { generateUuid } from "./ids.js";

export interface StartAssessmentRunResult {
  runId: string;
  startedAt: string;
}

export type CatalogStatus = "draft" | "active" | "deprecated" | "retired";
export type AssessmentStatus = ControlAssessment["status"];

export interface ListControlsFilters {
  domain?: string;
  catalogStatus?: CatalogStatus;
  applicability?: Verdict;
  assessmentStatus?: AssessmentStatus | "NOT_ASSESSED";
  detail?: "summary" | "full";
  controlIds?: string[];
}

export interface ControlSummary {
  controlId: string;
  title: string;
  domain: string;
  applicability: Verdict;
  assessmentStatus: AssessmentStatus | "NOT_ASSESSED";
  findingCount: number;
}

function defaultPlanId(projectId: string): string {
  return `PLAN-DEFAULT-${projectId}`;
}

export class AssessmentService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async startAssessmentRun(projectId: string): Promise<StartAssessmentRunResult> {
    const project = await withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });

    const planId = defaultPlanId(projectId);
    let plan: AssessmentPlan;
    try {
      plan = await this.repository.getPlan(planId);
    } catch {
      plan = { planId, version: 1, projectId, groupBy: "controlId", defaultMaxParallelAgents: 1, createdAt: this.now() };
      await this.repository.savePlan(plan);
    }

    const catalogVersion = await this.repository.getCatalogVersion();
    const runId = generateUuid();
    const startedAt = this.now();
    const run: AssessmentRun = {
      runId, projectId, planId: plan.planId, planVersion: plan.version, profileRevision: project.profileRevision,
      catalogVersion, batchIds: [], status: "running", startedAt, completedAt: null,
    };
    await this.repository.saveRun(run);
    return { runId, startedAt };
  }

  async listControls(projectId: string, filters?: ListControlsFilters & { detail?: "summary" }): Promise<ControlSummary[]>;
  async listControls(projectId: string, filters: ListControlsFilters & { detail: "full" }): Promise<Control[]>;
  async listControls(projectId: string, filters: ListControlsFilters = {}): Promise<(ControlSummary | Control)[]> {
    const project = await withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
    const [controls, assessments, findings] = await Promise.all([
      this.repository.getControls(),
      this.repository.getControlAssessments(projectId),
      this.repository.getFindings(projectId),
    ]);
    const assessmentByControl = new Map(assessments.map((a) => [a.controlId, a]));

    let selected = controls;
    if (filters.controlIds) {
      const idSet = new Set(filters.controlIds);
      selected = selected.filter((c) => idSet.has(c.controlId));
    }
    if (filters.domain) selected = selected.filter((c) => c.domain === filters.domain);
    if (filters.catalogStatus) selected = selected.filter((c) => c.status === filters.catalogStatus);

    const withComputed = selected.map((c) => {
      const applicability = evaluateApplicability(c, project.profile).autoResult;
      const assessment = assessmentByControl.get(c.controlId);
      const assessmentStatus: AssessmentStatus | "NOT_ASSESSED" = assessment ? assessment.status : "NOT_ASSESSED";
      const findingCount = findings.filter((f) => f.status !== "resolved" && f.status !== "false_positive" && f.controlIds.includes(c.controlId)).length;
      return { control: c, applicability, assessmentStatus, findingCount };
    });

    const filtered = withComputed
      .filter((c) => !filters.applicability || c.applicability === filters.applicability)
      .filter((c) => !filters.assessmentStatus || c.assessmentStatus === filters.assessmentStatus);

    if (filters.detail === "full" || filters.controlIds) {
      return filtered.map((c) => c.control);
    }
    return filtered.map((c) => ({
      controlId: c.control.controlId, title: c.control.title, domain: c.control.domain,
      applicability: c.applicability, assessmentStatus: c.assessmentStatus, findingCount: c.findingCount,
    }));
  }
}
