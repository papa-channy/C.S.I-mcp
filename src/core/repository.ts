import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadJson } from "../validate.js";
import type { AssessmentPlan, PlanControl as Control } from "./plan-expander.js";
import type { CriticalityFormula } from "./criticality.js";
import type { ScoreModel } from "./score.js";
import type { ProjectReport } from "./report-builder.js";

export interface Project {
  projectId: string;
  name: string;
  owner: string;
  createdAt: string;
  profileRevision: number;
  profile: unknown;
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
  status: string;
  [key: string]: unknown;
}

export interface Finding {
  findingId: string;
  [key: string]: unknown;
}

export interface AssessmentRun {
  runId: string;
  projectId: string;
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
  getControlAssessments(projectId: string, runId?: string): Promise<ControlAssessment[]>;
  getFindings(projectId: string): Promise<Finding[]>;
  saveRun(run: AssessmentRun): Promise<void>;
  saveBatch(batch: AssessmentBatch): Promise<void>;
  saveReport(report: ProjectReport): Promise<void>;
}

function writeJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, path);
}

export class JsonRepository implements SecurityRepository {
  constructor(private readonly dataDir: string = "data") {}

  async getProject(projectId: string): Promise<Project> {
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
    return loadJson<AssessmentPlan>(join(this.dataDir, "plans", `${planId}.json`));
  }

  async getControlAssessments(projectId: string, _runId?: string): Promise<ControlAssessment[]> {
    // ControlAssessment (control-assessment-schema.json) carries no runId field, so per-run filtering isn't
    // derivable from the assessment record alone — this returns the full project set regardless of runId.
    // Per-run linkage is a later spec's (the MCP/agent layer's) concern, not this Core Engine repository's.
    const path = join(this.dataDir, "projects", projectId, "assessments.json");
    return existsSync(path) ? loadJson<ControlAssessment[]>(path) : [];
  }

  async getFindings(projectId: string): Promise<Finding[]> {
    const path = join(this.dataDir, "projects", projectId, "findings.json");
    return existsSync(path) ? loadJson<Finding[]>(path) : [];
  }

  async saveRun(run: AssessmentRun): Promise<void> {
    writeJsonAtomic(join(this.dataDir, "projects", run.projectId, "runs", `${run.runId}.json`), run);
  }

  async saveBatch(batch: AssessmentBatch): Promise<void> {
    writeJsonAtomic(join(this.dataDir, "projects", batch.projectId, "batches", `${batch.batchId}.json`), batch);
  }

  async saveReport(report: ProjectReport): Promise<void> {
    writeJsonAtomic(join(this.dataDir, "projects", report.projectId, "reports", `${report.reportId}.json`), report);
  }
}
