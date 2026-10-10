import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadJson } from "../validate.js";
import type { AssessmentPlan, PlanControl } from "./plan-expander.js";
import type { CriticalityFormula } from "./criticality.js";
import type { ScoreModel } from "./score.js";
import type { ProjectReport } from "./report-builder.js";
import type { ProjectProfile } from "./applicability.js";

export interface Project {
  projectId: string;
  name: string;
  owner: string;
  createdAt: string;
  profileRevision: number;
  profile: ProjectProfile;
}

export interface Control extends PlanControl {
  version: number;
  status: "draft" | "active" | "deprecated" | "retired";
  title: string;
}

export type EvidenceType =
  | "CODE" | "CONFIG" | "AUTOMATED_TEST" | "MANUAL_TEST" | "SCAN" | "LOG"
  | "AUDIT_LOG" | "ARCHITECTURE" | "CI_ARTIFACT" | "DEPLOYMENT_RECORD"
  | "SCREENSHOT" | "TICKET" | "REPORT" | "MANUAL_REVIEW";

export interface Evidence {
  evidenceId: string;
  type: EvidenceType;
  location: string;
  description?: string;
  searchScope?: string;
  searchMethod?: string;
  candidateCount?: number;
  excludedCandidates?: string;
  capturedAt: string;
  capturedBy: string;
}

export interface Threat {
  threatId: string;
  [key: string]: unknown;
}

export interface ReleaseGate {
  gate: number;
  name: string;
  requires?: string[];
  requiresByLevel?: Record<string, { criticalFindings?: number; highFindings?: number | string }>;
}

export interface ReleaseGateData {
  gates: ReleaseGate[];
  releaseBlockers: string[];
  revalidationTriggers: string[];
}

export interface ControlAssessment {
  assessmentId: string;
  projectId: string;
  controlId: string;
  controlVersion: number;
  runId: string;
  profileRevision: number;
  applicability: { autoResult: string; finalResult: string; matchedRules: string[]; source: "automatic" | "manual_override"; reason?: string };
  status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";
  evidenceIds: string[];
  findingIds: string[];
  riskAcceptanceId: string | null;
  owner: string;
  assessedBy: string;
  assessedAt: string;
  nextReviewAt: string | null;
  notes: string | null;
  [key: string]: unknown;
}

export interface Finding {
  findingId: string;
  title: string;
  type: "confirmed_vulnerability" | "likely_vulnerability" | "control_gap" | "hardening" | "process_gap" | "accepted_design" | "needs_validation";
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  priority: { index: number; source: "agent" | "human"; rationale: string; assignedBy: string; assignedAt: string };
  criticality: { index: number; formulaId: string; formulaVersion: string; computedAt: string };
  exploitabilityEvidence?: string;
  [key: string]: unknown;
}

export interface RiskAcceptance {
  riskAcceptanceId: string;
  projectId: string;
  controlId: string;
  findingIds: string[];
  reason: string;
  compensatingControls: string[];
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  reviewDate: string | null;
  status: "active" | "expired" | "revoked";
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface Target {
  repository: string;
  commitSha: string | null;
  branchOrTag: string | null;
  dirty: boolean | null;
}

export interface AssessmentRun {
  runId: string;
  projectId: string;
  planId: string;
  planVersion: number;
  profileRevision: number;
  catalogVersion: string;
  batchIds: string[];
  status: "pending" | "running" | "completed" | "failed" | "partial";
  startedAt?: string | null;
  completedAt?: string | null;
  target?: Target | null;
  profileSnapshot?: ProjectProfile | null;
  engineVersionAtRunStart?: string | null;
  [key: string]: unknown;
}

export interface AssessmentBatch {
  batchId: string;
  projectId: string;
  [key: string]: unknown;
}

export interface SecurityRepository {
  getProject(projectId: string): Promise<Project>;
  getControls(): Promise<Control[]>;
  getThreats(): Promise<Threat[]>;
  getCriticalityFormula(formulaId: string): Promise<CriticalityFormula>;
  getScoreModel(modelId: string): Promise<ScoreModel>;
  getReleaseGates(): Promise<ReleaseGateData>;
  getPlan(planId: string): Promise<AssessmentPlan>;
  getCatalogVersion(): Promise<string>;
  getControlAssessments(projectId: string, runId?: string): Promise<ControlAssessment[]>;
  getFindings(projectId: string): Promise<Finding[]>;
  getEvidence(projectId: string): Promise<Evidence[]>;
  getRiskAcceptances(projectId: string): Promise<RiskAcceptance[]>;
  getRun(projectId: string, runId: string): Promise<AssessmentRun>;
  saveRun(run: AssessmentRun): Promise<void>;
  saveBatch(batch: AssessmentBatch): Promise<void>;
  saveReport(report: ProjectReport): Promise<void>;
  getReportRawBytes(projectId: string, reportId: string): Promise<Buffer>;
  saveReportHtml(projectId: string, reportId: string, html: string): Promise<string>;
  savePlan(plan: AssessmentPlan): Promise<void>;
  saveProject(project: Project): Promise<void>;
  saveControlAssessment(assessment: ControlAssessment): Promise<void>;
  saveFinding(projectId: string, finding: Finding): Promise<void>;
  saveEvidence(projectId: string, evidence: Evidence): Promise<void>;
  saveRiskAcceptance(projectId: string, ra: RiskAcceptance): Promise<void>;
}

function assertSafeIdSegment(id: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") {
    throw new Error(`JsonRepository: unsafe ${label} "${id}" — must match /^[A-Za-z0-9._-]+$/ and not be "." or ".."`);
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, path);
}

function writeTextAtomic(path: string, data: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, path);
}

export class JsonRepository implements SecurityRepository {
  constructor(private readonly dataDir: string = "data") {}

  async getProject(projectId: string): Promise<Project> {
    assertSafeIdSegment(projectId, "projectId");
    return loadJson<Project>(join(this.dataDir, "projects", projectId, "project.json"));
  }

  async getControls(): Promise<Control[]> {
    const manifest = loadJson<{ controls: { files: string[] } }>(join(this.dataDir, "manifest.json"));
    return manifest.controls.files.flatMap((f) => loadJson<Control[]>(join(this.dataDir, f)));
  }

  async getThreats(): Promise<Threat[]> {
    const catalog = loadJson<{ threats: Threat[] }>(join(this.dataDir, "catalogs/threats.json"));
    return catalog.threats;
  }

  async getCriticalityFormula(formulaId: string): Promise<CriticalityFormula> {
    const formula = loadJson<CriticalityFormula>(join(this.dataDir, "core/criticality-weights.json"));
    if (formula.formulaId !== formulaId) {
      throw new Error(`JsonRepository: no criticality formula found for id "${formulaId}" (only "${formula.formulaId}" exists)`);
    }
    return formula;
  }

  async getScoreModel(modelId: string): Promise<ScoreModel> {
    const model = loadJson<ScoreModel>(join(this.dataDir, "core/scoring-model.json"));
    if (model.modelId !== modelId) {
      throw new Error(`JsonRepository: no score model found for id "${modelId}" (only "${model.modelId}" exists)`);
    }
    return model;
  }

  async getReleaseGates(): Promise<ReleaseGateData> {
    return loadJson<ReleaseGateData>(join(this.dataDir, "process/release-gates.json"));
  }

  async getPlan(planId: string): Promise<AssessmentPlan> {
    assertSafeIdSegment(planId, "planId");
    return loadJson<AssessmentPlan>(join(this.dataDir, "plans", `${planId}.json`));
  }

  async getCatalogVersion(): Promise<string> {
    const manifest = loadJson<{ catalogVersion: string }>(join(this.dataDir, "manifest.json"));
    return manifest.catalogVersion;
  }

  async getEvidence(projectId: string): Promise<Evidence[]> {
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "evidence.json");
    return existsSync(path) ? loadJson<Evidence[]>(path) : [];
  }

  async getRun(projectId: string, runId: string): Promise<AssessmentRun> {
    assertSafeIdSegment(projectId, "projectId");
    assertSafeIdSegment(runId, "runId");
    return loadJson<AssessmentRun>(join(this.dataDir, "projects", projectId, "runs", `${runId}.json`));
  }

  async getControlAssessments(projectId: string, _runId?: string): Promise<ControlAssessment[]> {
    // ControlAssessment now carries a runId field (added for staleness tracking — see
    // docs/superpowers/specs/2026-10-05-assessment-trust-integrity-design.md), but no caller currently
    // needs per-run filtering, so this still returns the full project set regardless of runId. The
    // parameter is kept (and intentionally unused) so the signature is ready when a caller needs it.
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "assessments.json");
    return existsSync(path) ? loadJson<ControlAssessment[]>(path) : [];
  }

  async getFindings(projectId: string): Promise<Finding[]> {
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "findings.json");
    return existsSync(path) ? loadJson<Finding[]>(path) : [];
  }

  async saveRun(run: AssessmentRun): Promise<void> {
    assertSafeIdSegment(run.projectId, "projectId");
    assertSafeIdSegment(run.runId, "runId");
    writeJsonAtomic(join(this.dataDir, "projects", run.projectId, "runs", `${run.runId}.json`), run);
  }

  async saveBatch(batch: AssessmentBatch): Promise<void> {
    assertSafeIdSegment(batch.projectId, "projectId");
    assertSafeIdSegment(batch.batchId, "batchId");
    writeJsonAtomic(join(this.dataDir, "projects", batch.projectId, "batches", `${batch.batchId}.json`), batch);
  }

  async saveReport(report: ProjectReport): Promise<void> {
    assertSafeIdSegment(report.projectId, "projectId");
    assertSafeIdSegment(report.reportId, "reportId");
    writeJsonAtomic(join(this.dataDir, "projects", report.projectId, "reports", `${report.reportId}.json`), report);
  }

  async getReportRawBytes(projectId: string, reportId: string): Promise<Buffer> {
    assertSafeIdSegment(projectId, "projectId");
    assertSafeIdSegment(reportId, "reportId");
    const path = join(this.dataDir, "projects", projectId, "reports", `${reportId}.json`);
    if (!existsSync(path)) {
      throw new Error(`JsonRepository: no report found at "${path}"`);
    }
    return readFileSync(path);
  }

  async saveReportHtml(projectId: string, reportId: string, html: string): Promise<string> {
    assertSafeIdSegment(projectId, "projectId");
    assertSafeIdSegment(reportId, "reportId");
    const path = join(this.dataDir, "projects", projectId, "reports", `${reportId}.html`);
    writeTextAtomic(path, html);
    return path;
  }

  async savePlan(plan: AssessmentPlan): Promise<void> {
    assertSafeIdSegment(plan.planId, "planId");
    writeJsonAtomic(join(this.dataDir, "plans", `${plan.planId}.json`), plan);
  }

  async saveProject(project: Project): Promise<void> {
    assertSafeIdSegment(project.projectId, "projectId");
    writeJsonAtomic(join(this.dataDir, "projects", project.projectId, "project.json"), project);
  }

  async saveControlAssessment(assessment: ControlAssessment): Promise<void> {
    assertSafeIdSegment(assessment.projectId, "projectId");
    const path = join(this.dataDir, "projects", assessment.projectId, "assessments.json");
    const existing = existsSync(path) ? loadJson<ControlAssessment[]>(path) : [];
    const next = existing.filter((a) => a.controlId !== assessment.controlId);
    next.push(assessment);
    writeJsonAtomic(path, next);
  }

  async saveFinding(projectId: string, finding: Finding): Promise<void> {
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "findings.json");
    const existing = existsSync(path) ? loadJson<Finding[]>(path) : [];
    existing.push(finding);
    writeJsonAtomic(path, existing);
  }

  async saveEvidence(projectId: string, evidence: Evidence): Promise<void> {
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "evidence.json");
    const existing = existsSync(path) ? loadJson<Evidence[]>(path) : [];
    existing.push(evidence);
    writeJsonAtomic(path, existing);
  }

  async getRiskAcceptances(projectId: string): Promise<RiskAcceptance[]> {
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "risk-acceptances.json");
    return existsSync(path) ? loadJson<RiskAcceptance[]>(path) : [];
  }

  async saveRiskAcceptance(projectId: string, ra: RiskAcceptance): Promise<void> {
    assertSafeIdSegment(projectId, "projectId");
    const path = join(this.dataDir, "projects", projectId, "risk-acceptances.json");
    const existing = existsSync(path) ? loadJson<RiskAcceptance[]>(path) : [];
    const next = existing.filter((r) => r.riskAcceptanceId !== ra.riskAcceptanceId);
    next.push(ra);
    writeJsonAtomic(path, next);
  }
}
