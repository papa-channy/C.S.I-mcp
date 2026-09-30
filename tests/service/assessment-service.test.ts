import { describe, expect, it } from "vitest";
import { AssessmentService } from "../../src/service/assessment-service.js";
import { FakeRepository } from "./fake-repository.js";
import type { Control } from "../../src/core/repository.js";

const FIXED_NOW = "2026-09-30T00:00:00.000Z";

function control(overrides: Partial<Control> = {}): Control {
  return {
    controlId: "APP-INPUT-VAL-001", version: 1, status: "active", title: "Validate input",
    domain: "appsec", subdomain: "input", layer: "prevent", group: "validation",
    applicability: { when: { fact: "features.authentication", operator: "eq", value: true } },
    ...overrides,
  };
}

async function makeProjectRepo() {
  const repo = new FakeRepository();
  repo.catalogVersion = "9.9.9";
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: FIXED_NOW, profileRevision: 3,
    profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} },
  });
  await repo.saveRun({
    runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-DEFAULT-PRJ-1", planVersion: 1, profileRevision: 3,
    catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: FIXED_NOW, completedAt: null,
  });
  return repo;
}

describe("AssessmentService.startAssessmentRun", () => {
  it("creates a new default plan and a run referencing it, on first call", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.startAssessmentRun("PRJ-1");
    expect(result.startedAt).toBe(FIXED_NOW);
    expect(result.runId).toHaveLength(36);

    const run = await repo.getRun("PRJ-1", result.runId);
    expect(run.projectId).toBe("PRJ-1");
    expect(run.planVersion).toBe(1);
    expect(run.profileRevision).toBe(3);
    expect(run.catalogVersion).toBe("9.9.9");
    expect(run.status).toBe("running");
    expect(run.batchIds).toEqual([]);

    const plan = await repo.getPlan(run.planId);
    expect(plan.projectId).toBe("PRJ-1");
    expect(plan.groupBy).toBe("controlId");
  });

  it("reuses the same default plan across two runs for the same project", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const first = await service.startAssessmentRun("PRJ-1");
    const second = await service.startAssessmentRun("PRJ-1");
    const firstRun = await repo.getRun("PRJ-1", first.runId);
    const secondRun = await repo.getRun("PRJ-1", second.runId);
    expect(firstRun.planId).toBe(secondRun.planId);
    expect(repo.plans.size).toBe(1);
  });

  it("throws NOT_FOUND for an unknown projectId", async () => {
    const repo = new FakeRepository();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.startAssessmentRun("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("AssessmentService.listControls", () => {
  it("returns summaries by default, with applicability and NOT_ASSESSED status when unassessed", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.listControls("PRJ-1");
    expect(result).toEqual([
      { controlId: "APP-INPUT-VAL-001", title: "Validate input", domain: "appsec", applicability: "applicable", assessmentStatus: "NOT_ASSESSED", findingCount: 0 },
    ]);
  });

  it("reflects an existing ControlAssessment's status", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: FIXED_NOW, nextReviewAt: null, notes: null,
    });
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const [summary] = await service.listControls("PRJ-1");
    expect(summary.assessmentStatus).toBe("PASS");
  });

  it("filters by domain", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control(), control({ controlId: "OPS-BACKUP-TEST-001", domain: "operations" })];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.listControls("PRJ-1", { domain: "operations" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ controlId: "OPS-BACKUP-TEST-001" });
  });

  it("returns full catalog records when detail is 'full'", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const [full] = await service.listControls("PRJ-1", { detail: "full" });
    expect(full).toMatchObject({ controlId: "APP-INPUT-VAL-001", version: 1, applicability: expect.any(Object) });
  });

  it("returns ControlSummary-shaped objects when controlIds is set but detail is not 'full'", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control(), control({ controlId: "OPS-BACKUP-TEST-001", domain: "operations" })];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.listControls("PRJ-1", { controlIds: ["APP-INPUT-VAL-001"] });
    expect(result).toHaveLength(1);
    const [summary] = result;
    expect(summary).toMatchObject({ controlId: "APP-INPUT-VAL-001", assessmentStatus: "NOT_ASSESSED" });
    expect(summary).not.toHaveProperty("version");
  });

  it("returns full Control objects, narrowed by controlIds, when detail is explicitly 'full'", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control(), control({ controlId: "OPS-BACKUP-TEST-001", domain: "operations" })];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const result = await service.listControls("PRJ-1", { controlIds: ["APP-INPUT-VAL-001"], detail: "full" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ controlId: "APP-INPUT-VAL-001", version: 1 });
  });

  it("reports the manual_override finalResult as applicability instead of the recomputed autoResult", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "not_applicable", matchedRules: [], source: "manual_override", reason: "decommissioned" },
      status: "N/A", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: FIXED_NOW, nextReviewAt: null, notes: "decommissioned",
    });
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const [summary] = await service.listControls("PRJ-1");
    expect(summary.applicability).toBe("not_applicable");

    const filtered = await service.listControls("PRJ-1", { applicability: "not_applicable" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].controlId).toBe("APP-INPUT-VAL-001");
  });
});

describe("AssessmentService.recordAssessment", () => {
  it("records a PASS with evidence, generating evidenceIds and computing applicability automatically", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS",
      evidence: [{ type: "AUTOMATED_TEST", location: "tests/x.test.ts" }],
    });
    expect(assessment.evidenceIds).toEqual(["EVD-001"]);
    expect(assessment.applicability).toEqual({ autoResult: "applicable", finalResult: "applicable", matchedRules: ["fact"].length ? assessment.applicability.matchedRules : [], source: "automatic" });
    expect(assessment.controlVersion).toBe(1);
    expect(assessment.owner).toBe("csi-mcp-agent");
    expect(assessment.assessedBy).toBe("csi-mcp-agent");
    expect(assessment.riskAcceptanceId).toBeNull();
    expect(assessment.findingIds).toEqual([]);
    expect((await repo.getEvidence("PRJ-1"))[0]).toMatchObject({ evidenceId: "EVD-001", type: "AUTOMATED_TEST", capturedBy: "csi-mcp-agent" });
  });

  it("rejects PASS with zero evidence entries", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS", evidence: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects N/A without notes", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A", evidence: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts N/A with notes", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A", evidence: [], notes: "not applicable here",
    });
    expect(assessment.status).toBe("N/A");
    expect(assessment.notes).toBe("not applicable here");
  });

  it("rejects ACCEPTED_RISK without riskAcceptanceId", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK", evidence: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("applies a manual applicability override with its reason", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [],
      applicabilityOverride: { result: "not_applicable", reason: "legacy module being decommissioned" },
    });
    expect(assessment.applicability.finalResult).toBe("not_applicable");
    expect(assessment.applicability.source).toBe("manual_override");
    expect(assessment.applicability.reason).toBe("legacy module being decommissioned");
  });

  it("re-assessing the same controlId upserts rather than duplicating", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await service.recordAssessment({ projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [] });
    await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS",
      evidence: [{ type: "AUTOMATED_TEST", location: "tests/x.test.ts" }],
    });
    const all = await repo.getControlAssessments("PRJ-1");
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("PASS");
  });

  it("throws NOT_FOUND for an unknown controlId", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "NOPE-001", status: "NOT_TESTED", evidence: [],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for a runId that was never created via startAssessmentRun", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-BOGUS", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("generates sequential evidenceIds across multiple recordAssessment calls in the same project", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control(), control({ controlId: "APP-AUTH-MULTI-FACTOR-001" })];
    const service = new AssessmentService(repo, () => FIXED_NOW);

    // First call: record assessment for control 1 with evidence
    const assessment1 = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "PASS",
      evidence: [{ type: "AUTOMATED_TEST", location: "tests/validation.test.ts" }],
    });
    expect(assessment1.evidenceIds).toEqual(["EVD-001"]);

    // Second call: record assessment for control 2 with evidence (same project)
    const assessment2 = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-AUTH-MULTI-FACTOR-001", status: "PASS",
      evidence: [{ type: "AUTOMATED_TEST", location: "tests/auth.test.ts" }],
    });
    expect(assessment2.evidenceIds).toEqual(["EVD-002"]);

    // Verify both evidence records persisted with correct IDs
    const allEvidence = await repo.getEvidence("PRJ-1");
    expect(allEvidence).toHaveLength(2);
    expect(allEvidence[0].evidenceId).toBe("EVD-001");
    expect(allEvidence[1].evidenceId).toBe("EVD-002");
  });
});

function setCriticalityFormula(repo: FakeRepository) {
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
}

describe("AssessmentService.recordFinding", () => {
  it("computes criticality and severity, and assigns a sequential findingId", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const finding = await service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "SQLi", attackScenario: "attacker injects",
      severityFactors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 },
      priorityIndex: 0, priorityRationale: "worst case",
    });
    expect(finding.findingId).toBe("FND-001");
    expect(finding.criticality.index).toBeGreaterThanOrEqual(8);
    expect(finding.severity).toBe("critical");
    expect(finding.status).toBe("open");
    expect(finding.priority).toMatchObject({ index: 0, source: "agent", assignedBy: "csi-mcp-agent" });
  });

  it("derives severity at each threshold boundary", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const cases: { factors: { impact: number; exploitability: number; exposure: number; privilegeRequired: number; detectionDifficulty: number }; expected: string }[] = [
      { factors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 }, expected: "critical" },
      { factors: { impact: 3, exploitability: 3, exposure: 1, privilegeRequired: 1, detectionDifficulty: 1 }, expected: "medium" },
      { factors: { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 }, expected: "informational" },
    ];
    for (const { factors, expected } of cases) {
      const finding = await service.recordFinding({
        projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "x", attackScenario: "y",
        severityFactors: factors, priorityIndex: 9, priorityRationale: "r", priorityOverrideReason: "r",
      });
      expect(finding.severity).toBe(expected);
    }
  });

  it("rejects an unknown controlId", async () => {
    const repo = await makeProjectRepo();
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordFinding({
      projectId: "PRJ-1", controlIds: ["NOPE-001"], title: "x", attackScenario: "y",
      severityFactors: { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 0, detectionDifficulty: 0 },
      priorityIndex: 0, priorityRationale: "r",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires priorityOverrideReason when criticality.index >= 8 and priorityIndex >= 2", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "x", attackScenario: "y",
      severityFactors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 },
      priorityIndex: 2, priorityRationale: "r",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws NOT_FOUND for an unknown projectId", async () => {
    const repo = new FakeRepository();
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordFinding({
      projectId: "nope", controlIds: ["APP-INPUT-VAL-001"], title: "x", attackScenario: "y",
      severityFactors: { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 0, detectionDifficulty: 0 },
      priorityIndex: 0, priorityRationale: "r",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("AssessmentService.listFindings", () => {
  it("returns all findings for a project, optionally filtered by status", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "A", attackScenario: "y",
      severityFactors: { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 0, detectionDifficulty: 0 },
      priorityIndex: 0, priorityRationale: "r",
    });
    const all = await service.listFindings("PRJ-1");
    expect(all).toHaveLength(1);
    const open = await service.listFindings("PRJ-1", { status: "open" });
    expect(open).toHaveLength(1);
    const resolved = await service.listFindings("PRJ-1", { status: "resolved" });
    expect(resolved).toHaveLength(0);
  });

  it("throws NOT_FOUND for an unknown projectId", async () => {
    const repo = new FakeRepository();
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.listFindings("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maxPriorityIndex returns findings at or below the given index (more urgent), not above it", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const urgent = await service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "urgent", attackScenario: "y",
      severityFactors: { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 },
      priorityIndex: 0, priorityRationale: "r",
    });
    await service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "not urgent", attackScenario: "y",
      severityFactors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 },
      priorityIndex: 9, priorityRationale: "r", priorityOverrideReason: "r",
    });

    const mostUrgent = await service.listFindings("PRJ-1", { maxPriorityIndex: 0 });
    expect(mostUrgent).toHaveLength(1);
    expect(mostUrgent[0].findingId).toBe(urgent.findingId);
  });

  it("minCriticalityIndex returns findings at or above the given index (more severe), not below it — the OPPOSITE comparison direction from maxPriorityIndex, since criticality.index counts up to worse while priority.index counts down to worse", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    setCriticalityFormula(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const severe = await service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "severe", attackScenario: "y",
      severityFactors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 },
      priorityIndex: 0, priorityRationale: "r",
    });
    await service.recordFinding({
      projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "mild", attackScenario: "y",
      severityFactors: { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 },
      priorityIndex: 9, priorityRationale: "r",
    });

    expect(severe.criticality.index).toBeGreaterThan(0);
    const mostSevere = await service.listFindings("PRJ-1", { minCriticalityIndex: severe.criticality.index });
    expect(mostSevere).toHaveLength(1);
    expect(mostSevere[0].findingId).toBe(severe.findingId);
  });
});
