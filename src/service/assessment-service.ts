import type { AssessmentRun, Control, ControlAssessment, Evidence, EvidenceType, SecurityRepository, Finding } from "../core/repository.js";
import type { AssessmentPlan } from "../core/plan-expander.js";
import { evaluateApplicability, type Verdict } from "../core/applicability.js";
import { withNotFound, ServiceError } from "./errors.js";
import { generateUuid, nextSequentialId } from "./ids.js";
import { calculateCriticality, type SeverityFactors } from "../core/criticality.js";
import { AGENT_IDENTITY, CRITICALITY_FORMULA_ID } from "./constants.js";

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

export interface RecordAssessmentInput {
  projectId: string;
  runId: string;
  controlId: string;
  status: AssessmentStatus;
  evidence: { type: EvidenceType; location: string; description?: string }[];
  notes?: string;
  riskAcceptanceId?: string;
  applicabilityOverride?: { result: Verdict; reason: string };
}

export interface RecordFindingInput {
  projectId: string;
  controlIds: string[];
  title: string;
  attackScenario: string;
  severityFactors: SeverityFactors;
  priorityIndex: number;
  priorityRationale: string;
  priorityOverrideReason?: string;
}

export interface ListFindingsFilters {
  status?: Finding["status"];
  controlId?: string;
  maxPriorityIndex?: number;
  // NOT the same direction as maxPriorityIndex: priority.index counts DOWN to more urgent (0 = most
  // urgent), but criticality.index counts UP to more severe (9 = most severe). "give me the worst
  // findings" is therefore priority.index <= max, but criticality.index >= min — hence "min" here,
  // not "max", even though both filters answer the same "give me the worst ones" intent.
  minCriticalityIndex?: number;
}

const SEVERITY_THRESHOLDS: { min: number; severity: Finding["severity"] }[] = [
  { min: 8, severity: "critical" },
  { min: 6, severity: "high" },
  { min: 4, severity: "medium" },
  { min: 2, severity: "low" },
  { min: 0, severity: "informational" },
];

function deriveSeverity(criticalityIndex: number): Finding["severity"] {
  return SEVERITY_THRESHOLDS.find((t) => criticalityIndex >= t.min)!.severity;
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
      runId, projectId, planId: plan.planId, planVersion: plan.version ?? 1, profileRevision: project.profileRevision,
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
      const autoResult = evaluateApplicability(c, project.profile).autoResult;
      const assessment = assessmentByControl.get(c.controlId);
      const applicability: Verdict = assessment ? (assessment.applicability.finalResult as Verdict) : autoResult;
      const assessmentStatus: AssessmentStatus | "NOT_ASSESSED" = assessment ? assessment.status : "NOT_ASSESSED";
      const findingCount = findings.filter((f) => f.status !== "resolved" && f.status !== "false_positive" && f.controlIds.includes(c.controlId)).length;
      return { control: c, applicability, assessmentStatus, findingCount };
    });

    const filtered = withComputed
      .filter((c) => !filters.applicability || c.applicability === filters.applicability)
      .filter((c) => !filters.assessmentStatus || c.assessmentStatus === filters.assessmentStatus);

    if (filters.detail === "full") {
      return filtered.map((c) => c.control);
    }
    return filtered.map((c) => ({
      controlId: c.control.controlId, title: c.control.title, domain: c.control.domain,
      applicability: c.applicability, assessmentStatus: c.assessmentStatus, findingCount: c.findingCount,
    }));
  }

  async recordAssessment(input: RecordAssessmentInput): Promise<ControlAssessment> {
    const controls = await this.repository.getControls();
    const control = controls.find((c) => c.controlId === input.controlId);
    if (!control) {
      throw new ServiceError("NOT_FOUND", `Control "${input.controlId}" not found`, { controlId: input.controlId });
    }
    const project = await withNotFound(
      this.repository.getProject(input.projectId), `Project "${input.projectId}" not found`, { projectId: input.projectId }
    );
    await withNotFound(
      this.repository.getRun(input.projectId, input.runId), `Run "${input.runId}" not found`, { projectId: input.projectId, runId: input.runId }
    );

    if (input.status === "PASS" && input.evidence.length === 0) {
      throw new ServiceError("VALIDATION_ERROR", "status PASS requires at least one evidence entry", { controlId: input.controlId });
    }
    if (input.status === "N/A" && !input.notes) {
      throw new ServiceError("VALIDATION_ERROR", 'status "N/A" requires non-empty notes', { controlId: input.controlId });
    }
    if (input.status === "ACCEPTED_RISK" && !input.riskAcceptanceId) {
      throw new ServiceError("VALIDATION_ERROR", 'status "ACCEPTED_RISK" requires riskAcceptanceId', { controlId: input.controlId });
    }

    const { autoResult, matchedRules } = evaluateApplicability(control, project.profile);
    const applicability = input.applicabilityOverride
      ? { autoResult, finalResult: input.applicabilityOverride.result, matchedRules, source: "manual_override" as const, reason: input.applicabilityOverride.reason }
      : { autoResult, finalResult: autoResult, matchedRules, source: "automatic" as const };

    const existingEvidence = await this.repository.getEvidence(input.projectId);
    const evidenceIds: string[] = [];
    for (let i = 0; i < input.evidence.length; i++) {
      const item = input.evidence[i];
      const evidenceId = nextSequentialId("EVD", existingEvidence.length + i);
      const evidence: Evidence = {
        evidenceId, type: item.type, location: item.location,
        ...(item.description !== undefined ? { description: item.description } : {}),
        capturedAt: this.now(), capturedBy: AGENT_IDENTITY,
      };
      await this.repository.saveEvidence(input.projectId, evidence);
      evidenceIds.push(evidenceId);
    }

    const assessment: ControlAssessment = {
      assessmentId: generateUuid(), projectId: input.projectId, controlId: input.controlId, controlVersion: control.version,
      applicability, status: input.status, evidenceIds, findingIds: [], riskAcceptanceId: input.riskAcceptanceId ?? null,
      owner: AGENT_IDENTITY, assessedBy: AGENT_IDENTITY, assessedAt: this.now(), nextReviewAt: null, notes: input.notes ?? null,
    };
    await this.repository.saveControlAssessment(assessment);
    return assessment;
  }

  async recordFinding(input: RecordFindingInput): Promise<Finding> {
    await withNotFound(
      this.repository.getProject(input.projectId), `Project "${input.projectId}" not found`, { projectId: input.projectId }
    );
    const controls = await this.repository.getControls();
    const knownIds = new Set(controls.map((c) => c.controlId));
    const unknown = input.controlIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new ServiceError("VALIDATION_ERROR", `Unknown controlIds: ${unknown.join(", ")}`, { controlIds: unknown });
    }

    const formula = await this.repository.getCriticalityFormula(CRITICALITY_FORMULA_ID);
    const criticality = calculateCriticality(input.severityFactors, formula, this.now);
    const severity = deriveSeverity(criticality.index);

    if (criticality.index >= 8 && input.priorityIndex >= 2 && !input.priorityOverrideReason) {
      throw new ServiceError(
        "VALIDATION_ERROR", "priorityOverrideReason is required when criticality.index >= 8 and priorityIndex >= 2",
        { criticalityIndex: criticality.index, priorityIndex: input.priorityIndex }
      );
    }

    const existingFindings = await this.repository.getFindings(input.projectId);
    const finding: Finding = {
      findingId: nextSequentialId("FND", existingFindings.length),
      title: input.title, controlIds: input.controlIds, attackScenario: input.attackScenario,
      impact: input.severityFactors.impact, exploitability: input.severityFactors.exploitability,
      exposure: input.severityFactors.exposure, privilegeRequired: input.severityFactors.privilegeRequired,
      detectionDifficulty: input.severityFactors.detectionDifficulty, criticality,
      priority: { index: input.priorityIndex, source: "agent", rationale: input.priorityRationale, assignedBy: AGENT_IDENTITY, assignedAt: this.now() },
      ...(input.priorityOverrideReason !== undefined ? { priorityOverrideReason: input.priorityOverrideReason } : {}),
      severity, status: "open",
    };
    await this.repository.saveFinding(input.projectId, finding);
    return finding;
  }

  async listFindings(projectId: string, filters: ListFindingsFilters = {}): Promise<Finding[]> {
    await withNotFound(
      this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId }
    );
    const findings = await this.repository.getFindings(projectId);
    return findings
      .filter((f) => !filters.status || f.status === filters.status)
      .filter((f) => !filters.controlId || f.controlIds.includes(filters.controlId!))
      .filter((f) => filters.maxPriorityIndex === undefined || f.priority.index <= filters.maxPriorityIndex!)
      .filter((f) => filters.minCriticalityIndex === undefined || f.criticality.index >= filters.minCriticalityIndex!);
  }
}
