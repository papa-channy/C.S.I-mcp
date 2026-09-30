# MCP Server (Tool/Handler Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Application/Service layer (`src/service/`) and the MCP tool/handler layer (`src/mcp/`) on top of the already-merged Core Security Engine, giving an AI agent 11 MCP tools to conversationally assess one real project over stdio.

**Architecture:** Four thin service classes (`ProjectService`, `AssessmentService`, `AnalysisService`, `ReportService`) are the only code that touches `SecurityRepository`; they call Core Engine's pure functions and never modify them. Eleven MCP tool files, one per tool, each parse input with a zod raw shape, call exactly one service method, and shape the result into `content` + `structuredContent`. `src/mcp/server.ts` wires an `McpServer` to a `StdioServerTransport` and registers all eleven.

**Tech Stack:** TypeScript (ES2022, ESNext modules, strict), Vitest, `@modelcontextprotocol/sdk@^1.31.0`, `zod@^4.6.5` (SDK's peer range is `^3.25 || ^4.0`, confirmed against the published package).

**Spec:** `docs/superpowers/specs/2026-09-30-mcp-server-design.md`

## Global Constraints

- No tool handler calls another tool handler; `generate_report` computes `Score`/`ReleaseEvaluation` from one loaded snapshot via direct service calls, never by invoking `get_score`'s or `evaluate_release`'s tool handlers (spec §2).
- No `console.log` anywhere under `src/mcp/` or `src/service/` — `StdioServerTransport` uses stdout as the JSON-RPC channel; any stdout write corrupts it. Use `console.error` only, and only for genuine operational logging (this plan adds none by default).
- Exactly three error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `PRECONDITION_FAILED` (spec §5). No task may introduce a fourth without amending the spec first.
- Every tool's success response includes both `content` (one human-readable `text` block) and `structuredContent` (the typed JSON payload) — never `content`-only.
- ID generation: `crypto.randomUUID()` for `projectId`/`runId`/`reportId`/`assessmentId`/`planId`; `PREFIX-NNN` (zero-padded to 3 digits, via `nextSequentialId`) for `findingId` (`FND-`) and `evidenceId` (`EVD-`) (spec §4).
- `ControlAssessment` upsert model: one record per `(projectId, controlId)` — `saveControlAssessment` replaces the existing entry sharing `controlId`, never appends a second (spec §3).
- Core functions (`evaluateApplicability`, `calculateCriticality`, `calculateScore`, `evaluateRelease`, `buildReport`, `sortPrioritizedFindings`) are called, never modified.
- This phase assumes a single agent, single writer, no auth — no idempotency keys, no concurrency handling beyond what `JsonRepository` already provides.

**Grounding corrections made while writing this plan** (the spec's §3 sketch of `SecurityRepository`'s extension was necessarily abbreviated; grounding it against the real schemas, `repository.ts`, and `report-builder.ts`/`release-evaluator.ts` surfaced concrete gaps the spec's prose already implied but didn't spell out as method signatures — each is mechanical and non-ambiguous, not a new design tension, so it's resolved here rather than kicked back for approval):

1. `saveFinding`/`saveEvidence` take an explicit `projectId` parameter — `Finding` and `Evidence` have no `projectId` field of their own in the real schemas (unlike `Project`/`ControlAssessment`, which do), so it can't be derived from the entity the way the spec's abbreviated sketch implied.
2. Four more repository methods are needed beyond the spec's four `save*` additions: `getEvidence(projectId)` (to compute the next `EVD-N`), `getCatalogVersion()` (manifest's `catalogVersion`, needed by `start_assessment_run`), `savePlan(plan)` (to persist the auto-created default `AssessmentPlan`), and `getRun(projectId, runId)` (to re-read the run `generate_report` needs — nothing wrote a corresponding read method when `saveRun` was added in Core Engine).
3. `getControls()`'s return type (`PlanControl`, aliased `Control` in `repository.ts`) is missing `version`, `status`, and `title` — fields `list_controls` and `record_assessment` genuinely need and the real catalog JSON already has. Widened via `interface Control extends PlanControl { version; status; title }`; `PlanControl` itself is untouched, so `expandPlan` needs no changes.
4. `Finding.priority`/`Finding.criticality` were typed as bare `{ index: number }` — too narrow to accept the literal objects `record_finding` constructs (`calculateCriticality`'s full result; `{index, source, rationale, assignedBy, assignedAt}`) without a TypeScript excess-property error. Widened to the real schema shape.
5. `Finding.severity`'s type used `"info"` where `finding-schema.json`'s real enum value is `"informational"` — a previously-parked, inert Core Engine follow-up item (`PROGRESS.md`) that this phase now actually populates, so it's fixed here as documented.
6. `record_assessment`'s real schema requires `controlVersion`, `owner`, and `assessedBy` — fields the spec's §6 tool description never listed as inputs. `controlVersion` is read server-side from the looked-up `Control` record (mirrors how `catalogVersion`/`profileRevision` are already resolved server-side elsewhere); `owner` and `assessedBy` both default to a single fixed `AGENT_IDENTITY` constant, applying the same single-identity simplification the spec's §8 already approved for `capturedBy`/`assignedBy` to these two additional fields.
7. `record_assessment` never updates a `ControlAssessment.findingIds` array — no tool in this phase links a `Finding` back onto the `ControlAssessment` that produced it; findings link forward via `controlIds` only. `findingIds` stays `[]` on every `ControlAssessment` this phase writes. Documented, not silently omitted.
8. `list_controls`' `assessmentStatus` output for a control with no `ControlAssessment` record at all uses a sentinel value `"NOT_ASSESSED"` — not part of `ControlAssessment`'s own status enum, never persisted, output-only. This resolves the same "control absent from assessments entirely" ambiguity Core Engine's follow-up item #2 already flagged for `calculateScore`, applied here to a read-only listing.

---

### Task 1: Extend `SecurityRepository` and `JsonRepository`

**Files:**
- Modify: `src/core/repository.ts`
- Test: `tests/core/repository.test.ts`

**Interfaces:**
- Consumes: `PlanControl` from `src/core/plan-expander.ts` (extended, not replaced); `AssessmentPlan` from the same file (already imported).
- Produces: `Control` (repository-local, extends `PlanControl` with `version`/`status`/`title`), `Evidence`, widened `Finding` (`severity: "critical"|"high"|"medium"|"low"|"informational"`; `priority`/`criticality` fully typed), and these new/changed `SecurityRepository` methods, consumed by every service task from Task 5 onward:
  - `getEvidence(projectId: string): Promise<Evidence[]>`
  - `getCatalogVersion(): Promise<string>`
  - `getRun(projectId: string, runId: string): Promise<AssessmentRun>`
  - `savePlan(plan: AssessmentPlan): Promise<void>`
  - `saveProject(project: Project): Promise<void>`
  - `saveControlAssessment(assessment: ControlAssessment): Promise<void>` (upsert by `controlId`)
  - `saveFinding(projectId: string, finding: Finding): Promise<void>`
  - `saveEvidence(projectId: string, evidence: Evidence): Promise<void>`

First, verify no other file depends on `Control` (the alias) being exactly `PlanControl`:

```bash
grep -rn "Control" src/core/repository.ts tests/core/plan-expander.test.ts tests/core/repository.test.ts
```

Only `src/core/repository.ts` itself uses the `Control` alias; `tests/core/plan-expander.test.ts` imports `PlanControl` directly from `plan-expander.js`, not `Control` from `repository.ts`. Widening is safe.

- [ ] **Step 1: Write the failing tests**

Add to `tests/core/repository.test.ts`, inside the existing `"JsonRepository — project-instance read/write (temp data/ tree)"` describe block (after the existing `getPlan` tests, before the closing `});`):

```ts
  it("getEvidence returns [] for a project with no evidence.json yet", async () => {
    expect(await repo.getEvidence("PRJ-1")).toEqual([]);
  });

  it("getCatalogVersion reads the real manifest's catalogVersion", async () => {
    const realRepo = new JsonRepository("data");
    expect(await realRepo.getCatalogVersion()).toBe("2.1.0");
  });

  it("getRun rejects a path-traversal runId rather than reading outside the data dir", async () => {
    await expect(repo.getRun("PRJ-1", "../../../etc/passwd")).rejects.toThrow();
  });

  it("saveProject then reload round-trips the Project", async () => {
    const project: Project = {
      projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: "2026-09-30T00:00:00.000Z",
      profileRevision: 1,
      profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {} },
    };
    await repo.saveProject(project);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "project.json")));
    expect(reloaded).toEqual(project);
  });

  it("saveFinding then reload round-trips the Finding under the project's findings.json", async () => {
    const finding: Finding = {
      findingId: "FND-001", title: "SQLi", controlIds: ["APP-INPUT-VAL-001"], attackScenario: "x",
      impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2,
      criticality: { index: 9, formulaId: "CRIT-DEFAULT", formulaVersion: "1.0.0", computedAt: "2026-09-30T00:00:00.000Z" },
      priority: { index: 0, source: "agent", rationale: "r", assignedBy: "csi-mcp-agent", assignedAt: "2026-09-30T00:00:00.000Z" },
      severity: "critical", status: "open",
    };
    await repo.saveFinding("PRJ-1", finding);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "findings.json")));
    expect(reloaded).toEqual([finding]);
  });

  it("saveEvidence then reload round-trips the Evidence under the project's evidence.json", async () => {
    const evidence: Evidence = {
      evidenceId: "EVD-001", type: "SCREENSHOT", location: "s3://x", capturedAt: "2026-09-30T00:00:00.000Z", capturedBy: "csi-mcp-agent",
    };
    await repo.saveEvidence("PRJ-1", evidence);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "evidence.json")));
    expect(reloaded).toEqual([evidence]);
  });

  it("saveControlAssessment appends a new controlId but replaces an existing one (upsert)", async () => {
    const first: ControlAssessment = {
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "NOT_TESTED", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    };
    await repo.saveControlAssessment(first);
    const second = { ...first, assessmentId: "A-2", status: "PASS" as const };
    await repo.saveControlAssessment(second);
    const all = await repo.getControlAssessments("PRJ-1");
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(second);

    const other: ControlAssessment = { ...first, assessmentId: "A-3", controlId: "APP-INPUT-VAL-002" };
    await repo.saveControlAssessment(other);
    expect(await repo.getControlAssessments("PRJ-1")).toHaveLength(2);
  });

  it("savePlan then getPlan round-trips the AssessmentPlan", async () => {
    const plan: AssessmentPlan = {
      planId: "PLAN-DEFAULT-PRJ-1", version: 1, projectId: "PRJ-1", groupBy: "controlId",
      defaultMaxParallelAgents: 1, createdAt: "2026-09-30T00:00:00.000Z",
    };
    await repo.savePlan(plan);
    expect(await repo.getPlan("PLAN-DEFAULT-PRJ-1")).toEqual(plan);
  });

  it("saveRun then getRun round-trips the AssessmentRun", async () => {
    const run: AssessmentRun = {
      runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "running", startedAt: "2026-09-30T00:00:00.000Z", completedAt: null,
    };
    await repo.saveRun(run);
    expect(await repo.getRun("PRJ-1", "RUN-1")).toEqual(run);
  });
```

Add `ControlAssessment, Evidence, Finding` to the existing `import type { AssessmentBatch, AssessmentRun } from "../../src/core/repository.js";` line, and add `import type { Project } from "../../src/core/repository.js";` (or fold into the same line).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core/repository.test.ts`
Expected: FAIL — `getEvidence`, `getCatalogVersion`, `getRun`, `savePlan`, `saveProject`, `saveFinding`, `saveEvidence` are not functions on `JsonRepository`; `Evidence` is not exported.

- [ ] **Step 3: Implement the extensions**

In `src/core/repository.ts`, change the import line:

```ts
import type { AssessmentPlan, PlanControl } from "./plan-expander.js";
```

Add the `Control` and `Evidence` types (near the top, after the existing type exports):

```ts
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
  capturedAt: string;
  capturedBy: string;
}
```

Update `Finding`'s `severity` and widen `priority`/`criticality`:

```ts
export interface Finding {
  findingId: string;
  title: string;
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  priority: { index: number; source: "agent" | "human"; rationale: string; assignedBy: string; assignedAt: string };
  criticality: { index: number; formulaId: string; formulaVersion: string; computedAt: string };
  [key: string]: unknown;
}
```

Replace every occurrence of `Control[]`/`Control` (there are exactly two: `getControls(): Promise<Control[]>` in the interface, and `getControls(): Promise<Control[]>` in `JsonRepository`) — no change needed to the return type text itself since `Control` now refers to the new local interface, not the old alias; only the import line changed.

Extend the `SecurityRepository` interface:

```ts
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
  getRun(projectId: string, runId: string): Promise<AssessmentRun>;
  saveRun(run: AssessmentRun): Promise<void>;
  saveBatch(batch: AssessmentBatch): Promise<void>;
  saveReport(report: ProjectReport): Promise<void>;
  savePlan(plan: AssessmentPlan): Promise<void>;
  saveProject(project: Project): Promise<void>;
  saveControlAssessment(assessment: ControlAssessment): Promise<void>;
  saveFinding(projectId: string, finding: Finding): Promise<void>;
  saveEvidence(projectId: string, evidence: Evidence): Promise<void>;
}
```

Add implementations to `JsonRepository` (after `getPlan`, before `getControlAssessments` is a fine spot for the new getters; save methods go after the existing `saveReport`):

```ts
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
```

And after the existing `saveReport` method:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/core/repository.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — every existing Core Engine test (244 baseline) still green; widening `Finding`/`Control` and adding methods is additive.

- [ ] **Step 6: Commit**

```bash
git add src/core/repository.ts tests/core/repository.test.ts
git commit -m "feat(core): extend SecurityRepository for the MCP service layer

Adds getEvidence/getCatalogVersion/getRun/savePlan/saveProject/
saveControlAssessment(upsert)/saveFinding/saveEvidence, widens Control
(version/status/title) and Finding (priority/criticality/severity)
to match the real schemas the service layer needs to satisfy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/service/errors.ts`

**Files:**
- Create: `src/service/errors.ts`
- Test: `tests/service/errors.test.ts`

**Interfaces:**
- Produces: `ErrorCode`, `ServiceError` (used by every later service task), `withNotFound<T>(promise, message, details?)` (used by `ProjectService`, `AssessmentService`, `ReportService`).

- [ ] **Step 1: Write the failing test**

Create `tests/service/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ServiceError, withNotFound } from "../../src/service/errors.js";

describe("ServiceError", () => {
  it("carries code, message, and optional details", () => {
    const err = new ServiceError("VALIDATION_ERROR", "bad input", { field: "x" });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
    expect(err.details).toEqual({ field: "x" });
  });

  it("details is undefined when omitted", () => {
    const err = new ServiceError("NOT_FOUND", "missing");
    expect(err.details).toBeUndefined();
  });
});

describe("withNotFound", () => {
  it("returns the resolved value when the promise succeeds", async () => {
    await expect(withNotFound(Promise.resolve(42), "missing")).resolves.toBe(42);
  });

  it("converts any rejection into a ServiceError NOT_FOUND with the given message", async () => {
    await expect(withNotFound(Promise.reject(new Error("enoent")), "Project not found", { projectId: "X" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found", details: { projectId: "X" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/service/errors.test.ts`
Expected: FAIL — `src/service/errors.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/service/errors.ts`:

```ts
export type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "PRECONDITION_FAILED";

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }
}

export async function withNotFound<T>(
  promise: Promise<T>,
  message: string,
  details?: Record<string, unknown>
): Promise<T> {
  try {
    return await promise;
  } catch {
    throw new ServiceError("NOT_FOUND", message, details);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/service/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/errors.ts tests/service/errors.test.ts
git commit -m "feat(service): add ServiceError taxonomy and withNotFound helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `src/service/ids.ts` and `src/service/constants.ts`

**Files:**
- Create: `src/service/ids.ts`
- Create: `src/service/constants.ts`
- Test: `tests/service/ids.test.ts`

**Interfaces:**
- Produces: `generateUuid()`, `nextSequentialId(prefix, existingCount)` from `ids.ts`; `CRITICALITY_FORMULA_ID`, `SCORE_MODEL_ID`, `AGENT_IDENTITY` from `constants.ts` — both consumed starting Task 6.

- [ ] **Step 1: Write the failing test**

Create `tests/service/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateUuid, nextSequentialId } from "../../src/service/ids.js";

describe("generateUuid", () => {
  it("returns a v4 UUID string", () => {
    expect(generateUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("returns a different value on each call", () => {
    expect(generateUuid()).not.toBe(generateUuid());
  });
});

describe("nextSequentialId", () => {
  it("returns PREFIX-001 for the first id (existingCount 0)", () => {
    expect(nextSequentialId("FND", 0)).toBe("FND-001");
  });

  it("zero-pads to 3 digits", () => {
    expect(nextSequentialId("EVD", 11)).toBe("EVD-012");
  });

  it("does not truncate beyond 3 digits", () => {
    expect(nextSequentialId("FND", 999)).toBe("FND-1000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/service/ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/service/ids.ts`:

```ts
import { randomUUID } from "node:crypto";

export function generateUuid(): string {
  return randomUUID();
}

export function nextSequentialId(prefix: string, existingCount: number): string {
  return `${prefix}-${String(existingCount + 1).padStart(3, "0")}`;
}
```

Create `src/service/constants.ts`:

```ts
// The only CriticalityFormula and ScoreModel this phase's data tree defines — fixed by the
// real files under data/core/, not caller-configurable (see criticality-weights.json,
// scoring-model.json). AGENT_IDENTITY is this single-agent phase's one fixed attribution
// string, applied everywhere a person/agent identity is recorded (evidence.capturedBy,
// finding.priority.assignedBy, controlAssessment.owner/assessedBy) — see spec §8.
export const CRITICALITY_FORMULA_ID = "CRIT-DEFAULT";
export const SCORE_MODEL_ID = "USSVS-SCORE-DEFAULT";
export const AGENT_IDENTITY = "csi-mcp-agent";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/service/ids.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/ids.ts src/service/constants.ts tests/service/ids.test.ts
git commit -m "feat(service): add ID generation and fixed system constants

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Shared `FakeRepository` test helper

**Files:**
- Create: `tests/service/fake-repository.ts`

**Interfaces:**
- Consumes: `SecurityRepository` and every entity type from `src/core/repository.ts`; `PlanControl` from `plan-expander.ts`; `CriticalityFormula` from `criticality.ts`; `ScoreModel` from `score.ts`; `ProjectReport` from `report-builder.ts`; `AssessmentPlan` from `plan-expander.ts`.
- Produces: `FakeRepository` class, an in-memory `SecurityRepository` implementation, imported by every service test task from Task 5 onward. Not itself a test file (no `.test.` in the name), so Vitest won't try to run it as a suite.

This is a plain implementation task with no independent behavior to TDD against — its correctness is proven by the tests that use it in later tasks. Write it directly and verify by importing it once.

- [ ] **Step 1: Write the helper**

Create `tests/service/fake-repository.ts`:

```ts
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
  async getControlAssessments(projectId: string): Promise<ControlAssessment[]> {
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
```

- [ ] **Step 2: Verify it type-checks and is usable**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `tests/service/fake-repository.ts`. (It is not exercised by any test yet — Task 5 is the first consumer — so `npm test` alone would not catch a broken implementation; the type-check is this step's verification.)

- [ ] **Step 3: Commit**

```bash
git add tests/service/fake-repository.ts
git commit -m "test(service): add shared in-memory FakeRepository test helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `src/service/project-service.ts`

**Files:**
- Create: `src/service/project-service.ts`
- Test: `tests/service/project-service.test.ts`

**Interfaces:**
- Consumes: `SecurityRepository`, `Project` from `repository.ts`; `ProjectProfile` from `applicability.ts`; `ServiceError`, `withNotFound` from `errors.ts`; `generateUuid` from `ids.ts`; `FakeRepository` from `tests/service/fake-repository.ts`.
- Produces: `ProjectService` class with `createProject(input: CreateProjectInput): Promise<Project>`, `getProject(projectId: string): Promise<Project>`, `updateProjectProfile(projectId: string, patch: ProjectProfilePatch): Promise<Project>`. `CreateProjectInput` and `ProjectProfilePatch` types, consumed by Task 11's `create_project`/`get_project`/`update_project_profile` tools.

- [ ] **Step 1: Write the failing tests**

Create `tests/service/project-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProjectService } from "../../src/service/project-service.js";
import { FakeRepository } from "./fake-repository.js";

const FIXED_NOW = "2026-09-30T00:00:00.000Z";
function makeService() {
  const repo = new FakeRepository();
  const service = new ProjectService(repo, () => FIXED_NOW);
  return { repo, service };
}

describe("ProjectService.createProject", () => {
  it("creates a project with profileRevision 1 and a generated projectId", async () => {
    const { service, repo } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: { authentication: true }, technologies: { languages: ["ts"] },
    });
    expect(project.name).toBe("Demo");
    expect(project.profileRevision).toBe(1);
    expect(project.createdAt).toBe(FIXED_NOW);
    expect(project.projectId).toHaveLength(36);
    expect(await repo.getProject(project.projectId)).toEqual(project);
  });

  it("omits components/identities/dataClasses when not provided (UNKNOWN, not KNOWN-NONE)", async () => {
    const { service } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: {}, technologies: {},
    });
    expect(project.profile).not.toHaveProperty("components");
    expect(project.profile).not.toHaveProperty("identities");
    expect(project.profile).not.toHaveProperty("dataClasses");
  });

  it("carries components/identities/dataClasses through as KNOWN when provided, including []", async () => {
    const { service } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: {}, technologies: {}, components: [], identities: ["user"], dataClasses: ["D1"],
    });
    expect(project.profile.components).toEqual([]);
    expect(project.profile.identities).toEqual(["user"]);
    expect(project.profile.dataClasses).toEqual(["D1"]);
  });
});

describe("ProjectService.getProject", () => {
  it("returns the project when it exists", async () => {
    const { service, repo } = makeService();
    const created = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {},
    });
    expect(await service.getProject(created.projectId)).toEqual(await repo.getProject(created.projectId));
  });

  it("throws a NOT_FOUND ServiceError when the project does not exist", async () => {
    const { service } = makeService();
    await expect(service.getProject("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ProjectService.updateProjectProfile — three-valued patch semantics", () => {
  async function makeProject() {
    const { service, repo } = makeService();
    const project = await service.createProject({
      name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"],
      features: { authentication: true }, technologies: { languages: ["ts"] }, components: ["web-app"],
    });
    return { service, repo, project };
  }

  it("a field absent from the patch leaves the stored value untouched", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { securityLevel: "SVL-3" });
    expect(updated.profile.components).toEqual(["web-app"]);
    expect(updated.profile.securityLevel).toBe("SVL-3");
  });

  it("a field present as [] clears it to KNOWN-NONE", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { components: [] });
    expect(updated.profile.components).toEqual([]);
  });

  it("a field present with values sets it to KNOWN-VALUES", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { components: ["api", "worker"] });
    expect(updated.profile.components).toEqual(["api", "worker"]);
  });

  it("increments profileRevision by 1 on every successful update", async () => {
    const { service, project } = await makeProject();
    const updated = await service.updateProjectProfile(project.projectId, { securityLevel: "SVL-3" });
    expect(updated.profileRevision).toBe(project.profileRevision + 1);
  });

  it("persists the update via saveProject", async () => {
    const { service, repo, project } = await makeProject();
    await service.updateProjectProfile(project.projectId, { securityLevel: "SVL-1" });
    expect((await repo.getProject(project.projectId)).profile.securityLevel).toBe("SVL-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/service/project-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/service/project-service.ts`:

```ts
import type { Project, SecurityRepository } from "../core/repository.js";
import type { ProjectProfile } from "../core/applicability.js";
import { withNotFound } from "./errors.js";
import { generateUuid } from "./ids.js";

export interface CreateProjectInput {
  name: string;
  owner: string;
  securityLevel: string;
  exposure: string[];
  features: Record<string, boolean>;
  technologies: ProjectProfile["technologies"];
  components?: string[];
  identities?: string[];
  dataClasses?: string[];
}

export type ProjectProfilePatch = Partial<{
  securityLevel: string;
  exposure: string[];
  features: Record<string, boolean>;
  technologies: ProjectProfile["technologies"];
  components: string[];
  identities: string[];
  dataClasses: string[];
}>;

export class ProjectService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const profile: ProjectProfile = {
      securityLevel: input.securityLevel,
      exposure: input.exposure,
      features: input.features,
      technologies: input.technologies,
      ...(input.components !== undefined ? { components: input.components } : {}),
      ...(input.identities !== undefined ? { identities: input.identities } : {}),
      ...(input.dataClasses !== undefined ? { dataClasses: input.dataClasses } : {}),
    };
    const project: Project = {
      projectId: generateUuid(),
      name: input.name,
      owner: input.owner,
      createdAt: this.now(),
      profileRevision: 1,
      profile,
    };
    await this.repository.saveProject(project);
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    return withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
  }

  // Distinguishes "key absent from patch" (leave untouched) from "key present as []" (KNOWN-NONE)
  // via `"key" in patch` — a `patch.components ?? existing` fallback would collapse both cases into
  // one, the exact three-valued-profile bug this project's practice forbids one layer down.
  async updateProjectProfile(projectId: string, patch: ProjectProfilePatch): Promise<Project> {
    const project = await this.getProject(projectId);
    const profile: ProjectProfile = { ...project.profile };

    if ("securityLevel" in patch) profile.securityLevel = patch.securityLevel!;
    if ("exposure" in patch) profile.exposure = patch.exposure!;
    if ("features" in patch) profile.features = patch.features!;
    if ("technologies" in patch) profile.technologies = patch.technologies!;
    if ("components" in patch) profile.components = patch.components!;
    if ("identities" in patch) profile.identities = patch.identities!;
    if ("dataClasses" in patch) profile.dataClasses = patch.dataClasses!;

    const updated: Project = { ...project, profileRevision: project.profileRevision + 1, profile };
    await this.repository.saveProject(updated);
    return updated;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/service/project-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/project-service.ts tests/service/project-service.test.ts
git commit -m "feat(service): add ProjectService with three-valued profile patch semantics

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `src/service/assessment-service.ts` — `startAssessmentRun`, `listControls`

**Files:**
- Create: `src/service/assessment-service.ts`
- Test: `tests/service/assessment-service.test.ts`

**Interfaces:**
- Consumes: `SecurityRepository`, `Control`, `ControlAssessment`, `AssessmentRun` from `repository.ts`; `AssessmentPlan` from `plan-expander.ts`; `evaluateApplicability`, `ProjectProfile`, `Verdict` from `applicability.ts`; `ServiceError`, `withNotFound` from `errors.ts`; `generateUuid` from `ids.ts`; `FakeRepository` from the test helper.
- Produces (this task): `AssessmentService` class (constructed here, extended by Tasks 7-8) with `startAssessmentRun(projectId): Promise<StartAssessmentRunResult>` and `listControls(projectId, filters?): Promise<ControlSummary[] | Control[]>`. `StartAssessmentRunResult`, `ListControlsFilters`, `ControlSummary` types, consumed by Task 12's `start_assessment_run`/`list_controls` tools.

- [ ] **Step 1: Write the failing tests**

Create `tests/service/assessment-service.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/service/assessment-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/service/assessment-service.ts`:

```ts
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
export type AssessmentStatus = "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";

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
      const assessmentStatus: AssessmentStatus | "NOT_ASSESSED" = assessment ? (assessment.status as AssessmentStatus) : "NOT_ASSESSED";
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/service/assessment-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/assessment-service.ts tests/service/assessment-service.test.ts
git commit -m "feat(service): add AssessmentService.startAssessmentRun and listControls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `AssessmentService.recordAssessment`

**Files:**
- Modify: `src/service/assessment-service.ts`
- Test: `tests/service/assessment-service.test.ts`

**Interfaces:**
- Consumes: `Evidence`, `EvidenceType`, `ControlAssessment` from `repository.ts`; `nextSequentialId`, `generateUuid` from `ids.ts`; `AGENT_IDENTITY` from `constants.ts`; `ServiceError` from `errors.ts`. Builds on `AssessmentService` from Task 6 (same class, same file).
- Produces: `recordAssessment(input: RecordAssessmentInput): Promise<ControlAssessment>`, `RecordAssessmentInput` type, consumed by Task 12's `record_assessment` tool.

- [ ] **Step 1: Write the failing tests**

Append to `tests/service/assessment-service.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/service/assessment-service.test.ts`
Expected: FAIL — `recordAssessment` is not a function.

- [ ] **Step 3: Implement**

Add to `src/service/assessment-service.ts` — extend the imports:

```ts
import type { AssessmentRun, Control, ControlAssessment, Evidence, EvidenceType, SecurityRepository } from "../core/repository.js";
import type { AssessmentPlan } from "../core/plan-expander.js";
import { evaluateApplicability, type Verdict } from "../core/applicability.js";
import { withNotFound, ServiceError } from "./errors.js";
import { generateUuid, nextSequentialId } from "./ids.js";
import { AGENT_IDENTITY } from "./constants.js";
```

Add the input type and method to the `AssessmentService` class:

```ts
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
```

```ts
  async recordAssessment(input: RecordAssessmentInput): Promise<ControlAssessment> {
    const controls = await this.repository.getControls();
    const control = controls.find((c) => c.controlId === input.controlId);
    if (!control) {
      throw new ServiceError("NOT_FOUND", `Control "${input.controlId}" not found`, { controlId: input.controlId });
    }
    const project = await withNotFound(
      this.repository.getProject(input.projectId), `Project "${input.projectId}" not found`, { projectId: input.projectId }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/service/assessment-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/assessment-service.ts tests/service/assessment-service.test.ts
git commit -m "feat(service): add AssessmentService.recordAssessment with upsert and evidence creation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `AssessmentService.recordFinding`, `listFindings`

**Files:**
- Modify: `src/service/assessment-service.ts`
- Test: `tests/service/assessment-service.test.ts`

**Interfaces:**
- Consumes: `calculateCriticality`, `SeverityFactors`, `CriticalityFormula` from `criticality.ts`; `Finding` from `repository.ts`; `nextSequentialId` from `ids.ts`; `CRITICALITY_FORMULA_ID`, `AGENT_IDENTITY` from `constants.ts`.
- Produces: `recordFinding(input: RecordFindingInput): Promise<Finding>`, `listFindings(projectId, filters?): Promise<Finding[]>`, `RecordFindingInput`, `ListFindingsFilters` types, consumed by Task 12's `record_finding`/`list_findings` tools.

- [ ] **Step 1: Write the failing tests**

Append to `tests/service/assessment-service.test.ts`:

```ts
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
      { factors: { impact: 4, exploitability: 4, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 }, expected: "medium" },
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/service/assessment-service.test.ts`
Expected: FAIL — `recordFinding`/`listFindings` are not functions.

- [ ] **Step 3: Implement**

Extend the imports in `src/service/assessment-service.ts` — add the criticality/`Finding` imports, and
widen the existing `constants.js` import (added in Task 7 as `AGENT_IDENTITY` only) to include
`CRITICALITY_FORMULA_ID` too, rather than replacing that line and losing `AGENT_IDENTITY`:

```ts
import { calculateCriticality, type SeverityFactors } from "../core/criticality.js";
import type { Finding } from "../core/repository.js";
import { AGENT_IDENTITY, CRITICALITY_FORMULA_ID } from "./constants.js";
```

Add types and methods:

```ts
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
  minPriority?: number;
  minCriticality?: number;
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
```

```ts
  async recordFinding(input: RecordFindingInput): Promise<Finding> {
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
    const findings = await this.repository.getFindings(projectId);
    return findings
      .filter((f) => !filters.status || f.status === filters.status)
      .filter((f) => !filters.controlId || f.controlIds.includes(filters.controlId!))
      .filter((f) => filters.minPriority === undefined || f.priority.index >= filters.minPriority!)
      .filter((f) => filters.minCriticality === undefined || f.criticality.index >= filters.minCriticality!);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/service/assessment-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/assessment-service.ts tests/service/assessment-service.test.ts
git commit -m "feat(service): add AssessmentService.recordFinding and listFindings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `src/service/analysis-service.ts`

**Files:**
- Create: `src/service/analysis-service.ts`
- Test: `tests/service/analysis-service.test.ts`

**Interfaces:**
- Consumes: `calculateScore`, `Score`, `ScoreModel` from `score.ts`; `evaluateRelease`, `ReleaseEvaluation` from `release-evaluator.ts`; `SCORE_MODEL_ID` from `constants.ts`; `ServiceError`, `withNotFound` from `errors.ts`.
- Produces: `AnalysisService` class with `getScore(projectId): Promise<Score>`, `evaluateRelease(projectId): Promise<ReleaseEvaluation>` — consumed by Task 10 (`ReportService`) and Task 13's `get_score`/`evaluate_release` tools.

- [ ] **Step 1: Write the failing tests**

Create `tests/service/analysis-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AnalysisService } from "../../src/service/analysis-service.js";
import { FakeRepository } from "./fake-repository.js";

function setScoreModel(repo: FakeRepository) {
  repo.scoreModel = {
    modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0",
    statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
    excludedStatuses: ["N/A", "ACCEPTED_RISK"],
  };
}

async function makeProject(repo: FakeRepository, securityLevel: string) {
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: "2026-09-30T00:00:00.000Z", profileRevision: 1,
    profile: { securityLevel, exposure: ["internet_public"], features: {}, technologies: {} },
  });
}

describe("AnalysisService.getScore", () => {
  it("computes a score from the project's assessments and controls", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-2");
    repo.controls = [{ controlId: "C-001", version: 1, status: "active", title: "t", domain: "appsec", subdomain: "s", layer: "prevent", group: "g", applicability: { when: { fact: "x", operator: "eq", value: 1 } } }];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "C-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    const service = new AnalysisService(repo);
    const score = await service.getScore("PRJ-1");
    expect(score.overallScore).toBe(100);
    expect(score.coverage.coveragePercent).toBe(100);
  });

  it("wraps calculateScore's zero-denominator throw as PRECONDITION_FAILED", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-2");
    await expect(new AnalysisService(repo).getScore("PRJ-1")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("AnalysisService.evaluateRelease", () => {
  it("reads securityLevel from the project, never from the caller", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-3");
    repo.controls = [];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "GOV-IR-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    await repo.saveControlAssessment({
      assessmentId: "A-2", projectId: "PRJ-1", controlId: "OPS-BACKUP-TEST-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    const evaluation = await new AnalysisService(repo).evaluateRelease("PRJ-1");
    expect(evaluation.result).toBe("approved");
    expect(evaluation.incidentResponseVerified).toBe(true);
    expect(evaluation.backupRestoreVerified).toBe(true);
  });

  it("has no securityLevel parameter at the type level", () => {
    const service = new AnalysisService(new FakeRepository());
    // @ts-expect-error evaluateRelease takes only a projectId — accepting a caller-supplied
    // securityLevel would let a call silently evaluate against a weaker gate than the
    // project's real one (spec §6's explicit security rationale).
    service.evaluateRelease("PRJ-1", "SVL-0");
  });

  it("maps the SVL-0/SVL-1 precondition throw to PRECONDITION_FAILED", async () => {
    const repo = new FakeRepository();
    setScoreModel(repo);
    await makeProject(repo, "SVL-0");
    repo.controls = [{ controlId: "C-001", version: 1, status: "active", title: "t", domain: "appsec", subdomain: "s", layer: "prevent", group: "g", applicability: { when: { fact: "x", operator: "eq", value: 1 } } }];
    await repo.saveControlAssessment({
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "C-001", controlVersion: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    });
    await expect(new AnalysisService(repo).evaluateRelease("PRJ-1")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/service/analysis-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/service/analysis-service.ts`:

```ts
import type { SecurityRepository } from "../core/repository.js";
import { calculateScore, type Score } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation } from "../core/release-evaluator.js";
import { ServiceError, withNotFound } from "./errors.js";
import { SCORE_MODEL_ID } from "./constants.js";

export class AnalysisService {
  constructor(private readonly repository: SecurityRepository) {}

  async getScore(projectId: string): Promise<Score> {
    const [assessments, findings, controls] = await Promise.all([
      this.repository.getControlAssessments(projectId),
      this.repository.getFindings(projectId),
      this.repository.getControls(),
    ]);
    const model = await this.repository.getScoreModel(SCORE_MODEL_ID);
    try {
      return calculateScore(assessments, controls, findings, model);
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
    try {
      return evaluateRelease({ score, findings, attackPaths: [], assessments, securityLevel: project.profile.securityLevel });
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId, securityLevel: project.profile.securityLevel });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/service/analysis-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/analysis-service.ts tests/service/analysis-service.test.ts
git commit -m "feat(service): add AnalysisService.getScore and evaluateRelease

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `src/service/report-service.ts`

**Files:**
- Create: `src/service/report-service.ts`
- Test: `tests/service/report-service.test.ts`

**Interfaces:**
- Consumes: `buildReport`, `ProjectReport` from `report-builder.ts`; `calculateScore` from `score.ts`; `evaluateRelease` from `release-evaluator.ts`; `SCORE_MODEL_ID`, `CRITICALITY_FORMULA_ID` from `constants.ts`; `generateUuid` from `ids.ts`; `ServiceError`, `withNotFound` from `errors.ts`.
- Produces: `ReportService` class with `generate(input: GenerateReportInput): Promise<ProjectReport>`, consumed by Task 13's `generate_report` tool.

- [ ] **Step 1: Write the failing tests**

Create `tests/service/report-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ReportService } from "../../src/service/report-service.js";
import { FakeRepository } from "./fake-repository.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function makeGeneratableProject(repo: FakeRepository) {
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
  });
  repo.scoreModel = { modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0", statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 }, excludedStatuses: ["N/A", "ACCEPTED_RISK"] };
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
  repo.controls = [];
  await repo.saveRun({
    runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
    catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: NOW, completedAt: null,
  });
  await repo.saveControlAssessment({
    assessmentId: "A-1", projectId: "PRJ-1", controlId: "GOV-IR-001", controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
  });
  await repo.saveControlAssessment({
    assessmentId: "A-2", projectId: "PRJ-1", controlId: "OPS-BACKUP-TEST-001", controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
  });
}

describe("ReportService.generate", () => {
  it("produces a ProjectReport built from one loaded snapshot and persists it", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "all clear" });
    expect(report.projectId).toBe("PRJ-1");
    expect(report.assessmentRunId).toBe("RUN-1");
    expect(report.catalogVersion).toBe("9.9.9");
    expect(report.releaseEvaluation.result).toBe("approved");
    expect(report.summary).toBe("all clear");
    expect(await repo.reports.get(report.reportId)).toEqual(report);
  });

  it("throws NOT_FOUND for an unknown runId", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW);
    await expect(service.generate({ projectId: "PRJ-1", runId: "NOPE", summary: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/service/report-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/service/report-service.ts`:

```ts
import type { SecurityRepository } from "../core/repository.js";
import { buildReport, type ProjectReport } from "../core/report-builder.js";
import { calculateScore, type Score } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation } from "../core/release-evaluator.js";
import { ServiceError, withNotFound } from "./errors.js";
import { generateUuid } from "./ids.js";
import { CRITICALITY_FORMULA_ID, SCORE_MODEL_ID } from "./constants.js";

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

    let score: Score;
    try {
      score = calculateScore(assessments, controls, findings, scoreModel);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId: input.projectId });
    }

    let releaseEvaluation: ReleaseEvaluation;
    try {
      releaseEvaluation = evaluateRelease({ score, findings, attackPaths: [], assessments, securityLevel: project.profile.securityLevel });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/service/report-service.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all service tests plus every existing Core Engine test.

- [ ] **Step 6: Commit**

```bash
git add src/service/report-service.ts tests/service/report-service.test.ts
git commit -m "feat(service): add ReportService.generate from a single loaded snapshot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: MCP tools — Project (`create_project`, `get_project`, `update_project_profile`)

**Files:**
- Create: `src/mcp/tools/error-result.ts`
- Create: `src/mcp/tools/create-project.ts`
- Create: `src/mcp/tools/get-project.ts`
- Create: `src/mcp/tools/update-project-profile.ts`
- Test: `tests/mcp/tools/project-tools.test.ts`
- Modify: `package.json` (add `@modelcontextprotocol/sdk` and `zod` as dependencies)

**Interfaces:**
- Consumes: `ProjectService` and its input types from `project-service.ts`; `ServiceError` from `errors.ts`; `FakeRepository` from the test helper.
- Produces: `toErrorResult(err)` (shared by every remaining tool task); `registerCreateProjectTool`, `registerGetProjectTool`, `registerUpdateProjectProfileTool`, each `(server: McpServer, service: ProjectService) => void`, consumed by Task 14's `server.ts`.

- [ ] **Step 1: Add the MCP SDK and zod dependencies**

```bash
npm install @modelcontextprotocol/sdk@^1.31.0 zod@^4.6.5
```

This moves them into `package.json`'s `dependencies` (not `devDependencies` — the server itself is runtime code, not tooling).

- [ ] **Step 2: Write the shared error-result helper (no test — pure pass-through verified by the tool tests below)**

Create `src/mcp/tools/error-result.ts`:

```ts
import { ServiceError } from "../../service/errors.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// A ServiceError becomes a structured tool-error result. Anything else is a bug in this layer,
// not a call the taxonomy in the spec covers — rethrow it and let the MCP SDK's own handler-error
// path turn it into a protocol-level error, rather than inventing a fourth error code here.
export function toErrorResult(err: unknown): ToolResult {
  if (err instanceof ServiceError) {
    return {
      content: [{ type: "text", text: err.message }],
      structuredContent: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      isError: true,
    };
  }
  throw err;
}
```

- [ ] **Step 3: Write the failing tool tests**

Create `tests/mcp/tools/project-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProjectService } from "../../../src/service/project-service.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { registerCreateProjectTool } from "../../../src/mcp/tools/create-project.js";
import { registerGetProjectTool } from "../../../src/mcp/tools/get-project.js";
import { registerUpdateProjectProfileTool } from "../../../src/mcp/tools/update-project-profile.js";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  const service = new ProjectService(repo, () => "2026-09-30T00:00:00.000Z");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCreateProjectTool(server, service);
  registerGetProjectTool(server, service);
  registerUpdateProjectProfileTool(server, service);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, repo };
}

describe("create_project tool", () => {
  it("creates a project and returns content + structuredContent", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({
      name: "create_project",
      arguments: { name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {} },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect((result.structuredContent as any).name).toBe("Demo");
    expect((result.structuredContent as any).projectId).toHaveLength(36);
  });
});

describe("get_project tool", () => {
  it("returns NOT_FOUND as a structured tool error for an unknown projectId", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "get_project", arguments: { projectId: "nope" } });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("NOT_FOUND");
  });
});

describe("update_project_profile tool", () => {
  it("omitting a field leaves it untouched; sending [] clears it", async () => {
    const { client } = await makeConnectedClient();
    const created = await client.callTool({
      name: "create_project",
      arguments: { name: "Demo", owner: "alice", securityLevel: "SVL-2", exposure: ["internet_public"], features: {}, technologies: {}, components: ["web"] },
    });
    const projectId = (created.structuredContent as any).projectId as string;

    const afterOmit = await client.callTool({ name: "update_project_profile", arguments: { projectId, securityLevel: "SVL-3" } });
    expect((afterOmit.structuredContent as any).profile.components).toEqual(["web"]);

    const afterClear = await client.callTool({ name: "update_project_profile", arguments: { projectId, components: [] } });
    expect((afterClear.structuredContent as any).profile.components).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- tests/mcp/tools/project-tools.test.ts`
Expected: FAIL — the three tool modules don't exist yet.

- [ ] **Step 5: Implement the three tools**

Create `src/mcp/tools/create-project.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectService } from "../../service/project-service.js";
import { toErrorResult } from "./error-result.js";

export const createProjectInputShape = {
  name: z.string().min(1),
  owner: z.string().min(1),
  securityLevel: z.enum(["SVL-0", "SVL-1", "SVL-2", "SVL-3"]),
  exposure: z.array(z.enum(["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"])).min(1),
  features: z.record(z.string(), z.boolean()),
  technologies: z.object({
    languages: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
    databases: z.array(z.string()).optional(),
    cloud: z.array(z.string()).optional(),
  }),
  components: z.array(z.string().min(1)).optional(),
  identities: z.array(z.enum(["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"])).optional(),
  dataClasses: z.array(z.enum(["D0", "D1", "D2", "D3"])).optional(),
};

export function registerCreateProjectTool(server: McpServer, service: ProjectService): void {
  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description: "Create a new project with its initial security profile.",
      inputSchema: createProjectInputShape,
    },
    async (input) => {
      try {
        const project = await service.createProject(input);
        return {
          content: [{ type: "text" as const, text: `Created project "${project.name}" (${project.projectId}).` }],
          structuredContent: project as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/get-project.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectService } from "../../service/project-service.js";
import { toErrorResult } from "./error-result.js";

export const getProjectInputShape = { projectId: z.string().min(1) };

export function registerGetProjectTool(server: McpServer, service: ProjectService): void {
  server.registerTool(
    "get_project",
    { title: "Get Project", description: "Fetch a project by id.", inputSchema: getProjectInputShape },
    async ({ projectId }) => {
      try {
        const project = await service.getProject(projectId);
        return {
          content: [{ type: "text" as const, text: `Project "${project.name}" (${project.projectId}).` }],
          structuredContent: project as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/update-project-profile.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectService } from "../../service/project-service.js";
import { toErrorResult } from "./error-result.js";

export const updateProjectProfileInputShape = {
  projectId: z.string().min(1),
  securityLevel: z.enum(["SVL-0", "SVL-1", "SVL-2", "SVL-3"]).optional(),
  exposure: z.array(z.enum(["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"])).min(1).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  technologies: z.object({
    languages: z.array(z.string()).optional(), frameworks: z.array(z.string()).optional(),
    databases: z.array(z.string()).optional(), cloud: z.array(z.string()).optional(),
  }).optional(),
  components: z.array(z.string().min(1)).optional(),
  identities: z.array(z.enum(["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"])).optional(),
  dataClasses: z.array(z.enum(["D0", "D1", "D2", "D3"])).optional(),
};

export function registerUpdateProjectProfileTool(server: McpServer, service: ProjectService): void {
  server.registerTool(
    "update_project_profile",
    {
      title: "Update Project Profile",
      description:
        "Patch a project's security profile. A field left out of this call is untouched; " +
        "sending [] for components/identities/dataClasses clears it to KNOWN-NONE.",
      inputSchema: updateProjectProfileInputShape,
    },
    async ({ projectId, ...patch }) => {
      try {
        const project = await service.updateProjectProfile(projectId, patch);
        return {
          content: [{ type: "text" as const, text: `Updated profile for "${project.name}" (revision ${project.profileRevision}).` }],
          structuredContent: project as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

The `async ({ projectId, ...patch })` destructure is what makes the omitted-vs-present distinction survive the tool boundary: zod's parsed result only has keys for fields the caller actually sent (no `.default()` is used anywhere in this shape), so `patch` naturally has exactly the keys `ProjectService.updateProjectProfile`'s `"key" in patch` checks need — never an object with every key present-but-`undefined`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/mcp/tools/project-tools.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/mcp/tools/error-result.ts src/mcp/tools/create-project.ts src/mcp/tools/get-project.ts src/mcp/tools/update-project-profile.ts tests/mcp/tools/project-tools.test.ts
git commit -m "feat(mcp): add create_project, get_project, update_project_profile tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: MCP tools — Assessment (`start_assessment_run`, `list_controls`, `record_assessment`, `record_finding`, `list_findings`)

**Files:**
- Create: `src/mcp/tools/start-assessment-run.ts`
- Create: `src/mcp/tools/list-controls.ts`
- Create: `src/mcp/tools/record-assessment.ts`
- Create: `src/mcp/tools/record-finding.ts`
- Create: `src/mcp/tools/list-findings.ts`
- Test: `tests/mcp/tools/assessment-tools.test.ts`

**Interfaces:**
- Consumes: `AssessmentService` and its input types from Tasks 6-8; `toErrorResult` from Task 11.
- Produces: `registerStartAssessmentRunTool`, `registerListControlsTool`, `registerRecordAssessmentTool`, `registerRecordFindingTool`, `registerListFindingsTool`, each `(server: McpServer, service: AssessmentService) => void`, consumed by Task 14.

- [ ] **Step 1: Write the failing tests**

Create `tests/mcp/tools/assessment-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AssessmentService } from "../../../src/service/assessment-service.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { registerStartAssessmentRunTool } from "../../../src/mcp/tools/start-assessment-run.js";
import { registerListControlsTool } from "../../../src/mcp/tools/list-controls.js";
import { registerRecordAssessmentTool } from "../../../src/mcp/tools/record-assessment.js";
import { registerRecordFindingTool } from "../../../src/mcp/tools/record-finding.js";
import { registerListFindingsTool } from "../../../src/mcp/tools/list-findings.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} },
  });
  repo.controls = [{
    controlId: "APP-INPUT-VAL-001", version: 1, status: "active", title: "Validate input", domain: "appsec",
    subdomain: "input", layer: "prevent", group: "validation",
    applicability: { when: { fact: "features.authentication", operator: "eq", value: true } },
  }];
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
  const service = new AssessmentService(repo, () => NOW);
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerStartAssessmentRunTool(server, service);
  registerListControlsTool(server, service);
  registerRecordAssessmentTool(server, service);
  registerRecordFindingTool(server, service);
  registerListFindingsTool(server, service);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, repo };
}

describe("assessment tools", () => {
  it("start_assessment_run returns a runId and startedAt", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "start_assessment_run", arguments: { projectId: "PRJ-1" } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).runId).toHaveLength(36);
  });

  it("list_controls returns summaries by default", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "list_controls", arguments: { projectId: "PRJ-1" } });
    expect((result.structuredContent as any).controls).toHaveLength(1);
    expect((result.structuredContent as any).controls[0].assessmentStatus).toBe("NOT_ASSESSED");
  });

  it("record_assessment rejects PASS with no evidence as a VALIDATION_ERROR", async () => {
    const { client } = await makeConnectedClient();
    const run = await client.callTool({ name: "start_assessment_run", arguments: { projectId: "PRJ-1" } });
    const result = await client.callTool({
      name: "record_assessment",
      arguments: { projectId: "PRJ-1", runId: (run.structuredContent as any).runId, controlId: "APP-INPUT-VAL-001", status: "PASS", evidence: [] },
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("VALIDATION_ERROR");
  });

  it("record_assessment then record_finding then list_findings round-trips", async () => {
    const { client } = await makeConnectedClient();
    const run = await client.callTool({ name: "start_assessment_run", arguments: { projectId: "PRJ-1" } });
    await client.callTool({
      name: "record_assessment",
      arguments: {
        projectId: "PRJ-1", runId: (run.structuredContent as any).runId, controlId: "APP-INPUT-VAL-001", status: "FAIL", evidence: [],
      },
    });
    const finding = await client.callTool({
      name: "record_finding",
      arguments: {
        projectId: "PRJ-1", controlIds: ["APP-INPUT-VAL-001"], title: "SQLi", attackScenario: "attacker injects",
        severityFactors: { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 },
        priorityIndex: 0, priorityRationale: "worst case",
      },
    });
    expect((finding.structuredContent as any).findingId).toBe("FND-001");
    const list = await client.callTool({ name: "list_findings", arguments: { projectId: "PRJ-1" } });
    expect((list.structuredContent as any).findings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/mcp/tools/assessment-tools.test.ts`
Expected: FAIL — the five tool modules don't exist yet.

- [ ] **Step 3: Implement the five tools**

Create `src/mcp/tools/start-assessment-run.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const startAssessmentRunInputShape = { projectId: z.string().min(1) };

export function registerStartAssessmentRunTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "start_assessment_run",
    { title: "Start Assessment Run", description: "Start a new assessment run for a project.", inputSchema: startAssessmentRunInputShape },
    async ({ projectId }) => {
      try {
        const result = await service.startAssessmentRun(projectId);
        return {
          content: [{ type: "text" as const, text: `Started run ${result.runId} at ${result.startedAt}.` }],
          structuredContent: result,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/list-controls.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const listControlsInputShape = {
  projectId: z.string().min(1),
  domain: z.string().optional(),
  catalogStatus: z.enum(["draft", "active", "deprecated", "retired"]).optional(),
  applicability: z.enum(["applicable", "not_applicable", "unknown"]).optional(),
  assessmentStatus: z.enum(["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK", "NOT_ASSESSED"]).optional(),
  detail: z.enum(["summary", "full"]).optional(),
  controlIds: z.array(z.string()).optional(),
};

export function registerListControlsTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "list_controls",
    {
      title: "List Controls",
      description: "List catalog controls with their applicability and assessment status for a project.",
      inputSchema: listControlsInputShape,
    },
    async ({ projectId, ...filters }) => {
      try {
        const controls = await service.listControls(projectId, filters);
        return {
          content: [{ type: "text" as const, text: `${controls.length} control(s).` }],
          structuredContent: { controls },
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/record-assessment.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

const evidenceTypeEnum = z.enum([
  "CODE", "CONFIG", "AUTOMATED_TEST", "MANUAL_TEST", "SCAN", "LOG", "AUDIT_LOG", "ARCHITECTURE",
  "CI_ARTIFACT", "DEPLOYMENT_RECORD", "SCREENSHOT", "TICKET", "REPORT", "MANUAL_REVIEW",
]);

export const recordAssessmentInputShape = {
  projectId: z.string().min(1),
  runId: z.string().min(1),
  controlId: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"]),
  evidence: z.array(z.object({ type: evidenceTypeEnum, location: z.string().min(1), description: z.string().optional() })),
  notes: z.string().optional(),
  riskAcceptanceId: z.string().optional(),
  applicabilityOverride: z.object({ result: z.enum(["applicable", "not_applicable", "unknown"]), reason: z.string().min(1) }).optional(),
};

export function registerRecordAssessmentTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "record_assessment",
    { title: "Record Assessment", description: "Record (or update) a control's assessment for a project.", inputSchema: recordAssessmentInputShape },
    async (input) => {
      try {
        const assessment = await service.recordAssessment(input);
        return {
          content: [{ type: "text" as const, text: `Recorded "${assessment.controlId}" as ${assessment.status}.` }],
          structuredContent: assessment as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/record-finding.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const recordFindingInputShape = {
  projectId: z.string().min(1),
  controlIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  attackScenario: z.string().min(1),
  severityFactors: z.object({
    impact: z.number().int().min(1).max(5),
    exploitability: z.number().int().min(1).max(5),
    exposure: z.number().int().min(1).max(3),
    privilegeRequired: z.number().int().min(0).max(2),
    detectionDifficulty: z.number().int().min(0).max(2),
  }),
  priorityIndex: z.number().int().min(0).max(9),
  priorityRationale: z.string().min(1),
  priorityOverrideReason: z.string().optional(),
};

export function registerRecordFindingTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "record_finding",
    { title: "Record Finding", description: "Record a new security finding linked to one or more controls.", inputSchema: recordFindingInputShape },
    async (input) => {
      try {
        const finding = await service.recordFinding(input);
        return {
          content: [{ type: "text" as const, text: `Recorded finding ${finding.findingId} (${finding.severity}).` }],
          structuredContent: finding as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/list-findings.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

export const listFindingsInputShape = {
  projectId: z.string().min(1),
  status: z.enum(["open", "in_progress", "resolved", "accepted", "false_positive"]).optional(),
  controlId: z.string().optional(),
  minPriority: z.number().int().optional(),
  minCriticality: z.number().int().optional(),
};

export function registerListFindingsTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "list_findings",
    { title: "List Findings", description: "List findings for a project, optionally filtered.", inputSchema: listFindingsInputShape },
    async ({ projectId, ...filters }) => {
      try {
        const findings = await service.listFindings(projectId, filters);
        return {
          content: [{ type: "text" as const, text: `${findings.length} finding(s).` }],
          structuredContent: { findings: findings as unknown[] },
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/mcp/tools/assessment-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/start-assessment-run.ts src/mcp/tools/list-controls.ts src/mcp/tools/record-assessment.ts src/mcp/tools/record-finding.ts src/mcp/tools/list-findings.ts tests/mcp/tools/assessment-tools.test.ts
git commit -m "feat(mcp): add assessment tools (run/list/record-assessment/record-finding/list-findings)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: MCP tools — Analysis and Report (`get_score`, `evaluate_release`, `generate_report`)

**Files:**
- Create: `src/mcp/tools/get-score.ts`
- Create: `src/mcp/tools/evaluate-release.ts`
- Create: `src/mcp/tools/generate-report.ts`
- Test: `tests/mcp/tools/analysis-report-tools.test.ts`

**Interfaces:**
- Consumes: `AnalysisService` from Task 9, `ReportService` from Task 10, `toErrorResult` from Task 11.
- Produces: `registerGetScoreTool`, `registerEvaluateReleaseTool`, `registerGenerateReportTool`, each `(server, service) => void`, consumed by Task 14.

- [ ] **Step 1: Write the failing tests**

Create `tests/mcp/tools/analysis-report-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AnalysisService } from "../../../src/service/analysis-service.js";
import { ReportService } from "../../../src/service/report-service.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { registerGetScoreTool } from "../../../src/mcp/tools/get-score.js";
import { registerEvaluateReleaseTool } from "../../../src/mcp/tools/evaluate-release.js";
import { registerGenerateReportTool } from "../../../src/mcp/tools/generate-report.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
    profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
  });
  repo.scoreModel = { modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0", statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 }, excludedStatuses: ["N/A", "ACCEPTED_RISK"] };
  repo.criticalityFormula = {
    formulaId: "CRIT-DEFAULT", version: "1.0.0", scaleMax: 9,
    directions: { impact: "higher_is_worse", exploitability: "higher_is_worse", exposure: "higher_is_worse", privilegeRequired: "lower_is_worse", detectionDifficulty: "higher_is_worse" },
    ranges: { impact: { min: 1, max: 5 }, exploitability: { min: 1, max: 5 }, exposure: { min: 1, max: 3 }, privilegeRequired: { min: 0, max: 2 }, detectionDifficulty: { min: 0, max: 2 } },
    weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10 },
    rounding: "round",
  };
  repo.controls = [];
  await repo.saveRun({ runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1, catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: NOW, completedAt: null });
  await repo.saveControlAssessment({
    assessmentId: "A-1", projectId: "PRJ-1", controlId: "GOV-IR-001", controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
  });
  await repo.saveControlAssessment({
    assessmentId: "A-2", projectId: "PRJ-1", controlId: "OPS-BACKUP-TEST-001", controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
  });

  const analysisService = new AnalysisService(repo);
  const reportService = new ReportService(repo, () => NOW);
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerGetScoreTool(server, analysisService);
  registerEvaluateReleaseTool(server, analysisService);
  registerGenerateReportTool(server, reportService);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client };
}

describe("analysis and report tools", () => {
  it("get_score returns a Score", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "get_score", arguments: { projectId: "PRJ-1" } });
    expect((result.structuredContent as any).overallScore).toBe(100);
  });

  it("evaluate_release takes only projectId — no securityLevel field in its input schema", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "evaluate_release", arguments: { projectId: "PRJ-1" } });
    expect((result.structuredContent as any).result).toBe("approved");
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "evaluate_release")!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["projectId"]);
  });

  it("generate_report produces a ProjectReport", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({ name: "generate_report", arguments: { projectId: "PRJ-1", runId: "RUN-1", summary: "all clear" } });
    expect((result.structuredContent as any).summary).toBe("all clear");
    expect((result.structuredContent as any).releaseEvaluation.result).toBe("approved");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/mcp/tools/analysis-report-tools.test.ts`
Expected: FAIL — the three tool modules don't exist yet.

- [ ] **Step 3: Implement the three tools**

Create `src/mcp/tools/get-score.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "../../service/analysis-service.js";
import { toErrorResult } from "./error-result.js";

export const getScoreInputShape = { projectId: z.string().min(1) };

export function registerGetScoreTool(server: McpServer, service: AnalysisService): void {
  server.registerTool(
    "get_score",
    { title: "Get Score", description: "Compute the current security score for a project.", inputSchema: getScoreInputShape },
    async ({ projectId }) => {
      try {
        const score = await service.getScore(projectId);
        return {
          content: [{ type: "text" as const, text: `Overall score: ${score.overallScore}.` }],
          structuredContent: score as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/evaluate-release.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "../../service/analysis-service.js";
import { toErrorResult } from "./error-result.js";

// projectId only, deliberately — securityLevel is read server-side from the project's own
// profile (spec §6): accepting it as a parameter here would let a call silently evaluate
// against a weaker gate than the project's real one.
export const evaluateReleaseInputShape = { projectId: z.string().min(1) };

export function registerEvaluateReleaseTool(server: McpServer, service: AnalysisService): void {
  server.registerTool(
    "evaluate_release",
    { title: "Evaluate Release", description: "Evaluate gate-4 production-release readiness for a project.", inputSchema: evaluateReleaseInputShape },
    async ({ projectId }) => {
      try {
        const evaluation = await service.evaluateRelease(projectId);
        return {
          content: [{ type: "text" as const, text: `Release evaluation: ${evaluation.result}.` }],
          structuredContent: evaluation as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/generate-report.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportService } from "../../service/report-service.js";
import { toErrorResult } from "./error-result.js";

export const generateReportInputShape = {
  projectId: z.string().min(1),
  runId: z.string().min(1),
  summary: z.string().min(1),
};

export function registerGenerateReportTool(server: McpServer, service: ReportService): void {
  server.registerTool(
    "generate_report",
    { title: "Generate Report", description: "Generate the final project report for an assessment run.", inputSchema: generateReportInputShape },
    async (input) => {
      try {
        const report = await service.generate(input);
        return {
          content: [{ type: "text" as const, text: `Generated report ${report.reportId} — ${report.releaseEvaluation.result}.` }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/mcp/tools/analysis-report-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/get-score.ts src/mcp/tools/evaluate-release.ts src/mcp/tools/generate-report.ts tests/mcp/tools/analysis-report-tools.test.ts
git commit -m "feat(mcp): add get_score, evaluate_release, generate_report tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: `src/mcp/server.ts` — wiring, build, and run scripts

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `package.json` (add `build`/`start` scripts, `bin` entry)
- Modify: `tsconfig.json` (add `outDir`)

**Interfaces:**
- Consumes: every `register*Tool` function from Tasks 11-13; `JsonRepository` from `repository.ts`; `ProjectService`/`AssessmentService`/`AnalysisService`/`ReportService` from Tasks 5-10.
- Produces: a runnable `dist/mcp/server.js` entry point. Nothing downstream in this plan consumes `server.ts` itself — Task 15's integration test builds its own `McpServer` instance directly, matching Tasks 11-13's own test pattern, rather than spawning the real stdio process (spec §7: "the MCP stdio transport itself" is explicitly not tested here).

- [ ] **Step 1: Write `server.ts`**

Create `src/mcp/server.ts`:

```ts
// This module's only I/O boundary with the outside world is stdio, and StdioServerTransport
// uses stdout as the JSON-RPC message channel — do not add any console.log here or in anything
// this file imports. console.error (stderr) is safe if logging is ever needed.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JsonRepository } from "../core/repository.js";
import { ProjectService } from "../service/project-service.js";
import { AssessmentService } from "../service/assessment-service.js";
import { AnalysisService } from "../service/analysis-service.js";
import { ReportService } from "../service/report-service.js";
import { registerCreateProjectTool } from "./tools/create-project.js";
import { registerGetProjectTool } from "./tools/get-project.js";
import { registerUpdateProjectProfileTool } from "./tools/update-project-profile.js";
import { registerStartAssessmentRunTool } from "./tools/start-assessment-run.js";
import { registerListControlsTool } from "./tools/list-controls.js";
import { registerRecordAssessmentTool } from "./tools/record-assessment.js";
import { registerRecordFindingTool } from "./tools/record-finding.js";
import { registerListFindingsTool } from "./tools/list-findings.js";
import { registerGetScoreTool } from "./tools/get-score.js";
import { registerEvaluateReleaseTool } from "./tools/evaluate-release.js";
import { registerGenerateReportTool } from "./tools/generate-report.js";

export function buildServer(dataDir = "data"): McpServer {
  const repository = new JsonRepository(dataDir);
  const projectService = new ProjectService(repository);
  const assessmentService = new AssessmentService(repository);
  const analysisService = new AnalysisService(repository);
  const reportService = new ReportService(repository);

  const server = new McpServer({ name: "csi-mcp", version: "0.1.0" });

  registerCreateProjectTool(server, projectService);
  registerGetProjectTool(server, projectService);
  registerUpdateProjectProfileTool(server, projectService);
  registerStartAssessmentRunTool(server, assessmentService);
  registerListControlsTool(server, assessmentService);
  registerRecordAssessmentTool(server, assessmentService);
  registerRecordFindingTool(server, assessmentService);
  registerListFindingsTool(server, assessmentService);
  registerGetScoreTool(server, analysisService);
  registerEvaluateReleaseTool(server, analysisService);
  registerGenerateReportTool(server, reportService);

  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Wire the build/run scripts**

Edit `tsconfig.json`, adding `outDir`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

Edit `package.json`'s `scripts`:

```json
{
  "scripts": {
    "test": "vitest run",
    "build": "tsc",
    "start": "node dist/mcp/server.js"
  }
}
```

- [ ] **Step 3: Verify it builds and starts cleanly**

```bash
npm run build
```

Expected: no TypeScript errors; `dist/mcp/server.js` exists.

```bash
node dist/mcp/server.js < /dev/null &
sleep 1
kill %1 2>/dev/null; wait 2>/dev/null
```

Expected: the process starts without throwing (it will sit waiting on stdin for a JSON-RPC message; feeding it `/dev/null` closes stdin immediately, which the SDK treats as a disconnect and exits cleanly rather than hanging — confirm no stack trace was printed to stderr before that).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tsconfig.json package.json
git commit -m "feat(mcp): wire McpServer to StdioServerTransport with all 11 tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: Integration test — full realistic tool-call sequence

**Files:**
- Test: `tests/integration/full-workflow.test.ts`

**Interfaces:**
- Consumes: `buildServer` is not reused here (it hardcodes `JsonRepository`, and this test needs a temp directory) — instead, this test builds its own `McpServer` + all four services against a temp-directory `JsonRepository`, registering every tool exactly as `server.ts` does, then drives it through an in-memory-transport `Client`, mirroring the pattern already proven in Tasks 11-13's tool tests but end-to-end. Also consumes `compileSchemaFromFile` from `src/validate.ts`.
- Produces: nothing further downstream — this is the plan's final task.

- [ ] **Step 1: Write the test**

Create `tests/integration/full-workflow.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JsonRepository } from "../../src/core/repository.js";
import { ProjectService } from "../../src/service/project-service.js";
import { AssessmentService } from "../../src/service/assessment-service.js";
import { AnalysisService } from "../../src/service/analysis-service.js";
import { ReportService } from "../../src/service/report-service.js";
import { registerCreateProjectTool } from "../../src/mcp/tools/create-project.js";
import { registerUpdateProjectProfileTool } from "../../src/mcp/tools/update-project-profile.js";
import { registerStartAssessmentRunTool } from "../../src/mcp/tools/start-assessment-run.js";
import { registerListControlsTool } from "../../src/mcp/tools/list-controls.js";
import { registerRecordAssessmentTool } from "../../src/mcp/tools/record-assessment.js";
import { registerRecordFindingTool } from "../../src/mcp/tools/record-finding.js";
import { registerGetScoreTool } from "../../src/mcp/tools/get-score.js";
import { registerEvaluateReleaseTool } from "../../src/mcp/tools/evaluate-release.js";
import { registerGenerateReportTool } from "../../src/mcp/tools/generate-report.js";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("full MCP workflow, against the real data/ catalog", () => {
  let dataDir: string;
  let client: Client;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "csi-mcp-integration-"));
    const repository = new JsonRepository(dataDir);
    // The real catalog/core/process files live under the repo's own data/ tree — only the
    // project-instance tree (data/projects/, data/plans/) is temp-directory-scoped, matching how
    // JsonRepository already separates the two in the Core Engine spec's file layout.
    const realCatalog = new JsonRepository("data");
    (repository as any).dataDir = dataDir;

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const projectService = new ProjectService(repository);
    const assessmentService = new AssessmentService(mixedRepository(repository, realCatalog));
    const analysisService = new AnalysisService(mixedRepository(repository, realCatalog));
    const reportService = new ReportService(mixedRepository(repository, realCatalog));

    registerCreateProjectTool(server, projectService);
    registerUpdateProjectProfileTool(server, projectService);
    registerStartAssessmentRunTool(server, assessmentService);
    registerListControlsTool(server, assessmentService);
    registerRecordAssessmentTool(server, assessmentService);
    registerRecordFindingTool(server, assessmentService);
    registerGetScoreTool(server, analysisService);
    registerEvaluateReleaseTool(server, analysisService);
    registerGenerateReportTool(server, reportService);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("walks create → profile → run → list → assess → find → score → release → report", async () => {
    const created = await client.callTool({
      name: "create_project",
      arguments: {
        name: "Integration Demo", owner: "alice", securityLevel: "SVL-3", exposure: ["internet_public"],
        features: { authentication: true }, technologies: { languages: ["typescript"] },
      },
    });
    expect(created.isError).toBeFalsy();
    const projectId = (created.structuredContent as any).projectId as string;

    await client.callTool({ name: "update_project_profile", arguments: { projectId, components: ["web-app"] } });

    const run = await client.callTool({ name: "start_assessment_run", arguments: { projectId } });
    expect(run.isError).toBeFalsy();
    const runId = (run.structuredContent as any).runId as string;

    const listed = await client.callTool({ name: "list_controls", arguments: { projectId } });
    const controls = (listed.structuredContent as any).controls as { controlId: string }[];
    expect(controls.length).toBe(48);

    const targetControlId = "GOV-IR-001";
    const backupControlId = "OPS-BACKUP-TEST-001";
    for (const controlId of new Set([targetControlId, backupControlId, ...controls.map((c) => c.controlId)])) {
      await client.callTool({
        name: "record_assessment",
        arguments: {
          projectId, runId, controlId, status: "PASS",
          evidence: [{ type: "MANUAL_TEST", location: "manual test log" }],
        },
      });
    }

    const finding = await client.callTool({
      name: "record_finding",
      arguments: {
        projectId, controlIds: [targetControlId], title: "Weak incident runbook", attackScenario: "delayed response",
        severityFactors: { impact: 2, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 },
        priorityIndex: 5, priorityRationale: "low urgency",
      },
    });
    expect(finding.isError).toBeFalsy();
    const findingId = (finding.structuredContent as any).findingId as string;

    const score = await client.callTool({ name: "get_score", arguments: { projectId } });
    expect(score.isError).toBeFalsy();
    expect((score.structuredContent as any).overallScore).toBe(100);

    const release = await client.callTool({ name: "evaluate_release", arguments: { projectId } });
    expect(release.isError).toBeFalsy();

    const report = await client.callTool({
      name: "generate_report",
      arguments: { projectId, runId, summary: "Integration test run — all controls PASS, one low finding." },
    });
    expect(report.isError).toBeFalsy();
    const reportPayload = report.structuredContent as any;
    expect(reportPayload.prioritizedFindings.some((f: { findingId: string }) => f.findingId === findingId)).toBe(true);

    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const valid = validate(reportPayload);
    expect(valid, JSON.stringify(validate.errors)).toBe(true);
  });
});

function mixedRepository(projectRepo: JsonRepository, catalogRepo: JsonRepository) {
  return {
    getProject: projectRepo.getProject.bind(projectRepo),
    getControls: catalogRepo.getControls.bind(catalogRepo),
    getThreats: catalogRepo.getThreats.bind(catalogRepo),
    getCriticalityFormula: catalogRepo.getCriticalityFormula.bind(catalogRepo),
    getScoreModel: catalogRepo.getScoreModel.bind(catalogRepo),
    getReleaseGates: catalogRepo.getReleaseGates.bind(catalogRepo),
    getPlan: projectRepo.getPlan.bind(projectRepo),
    getCatalogVersion: catalogRepo.getCatalogVersion.bind(catalogRepo),
    getControlAssessments: projectRepo.getControlAssessments.bind(projectRepo),
    getFindings: projectRepo.getFindings.bind(projectRepo),
    getEvidence: projectRepo.getEvidence.bind(projectRepo),
    getRun: projectRepo.getRun.bind(projectRepo),
    saveRun: projectRepo.saveRun.bind(projectRepo),
    saveBatch: projectRepo.saveBatch.bind(projectRepo),
    saveReport: projectRepo.saveReport.bind(projectRepo),
    savePlan: projectRepo.savePlan.bind(projectRepo),
    saveProject: projectRepo.saveProject.bind(projectRepo),
    saveControlAssessment: projectRepo.saveControlAssessment.bind(projectRepo),
    saveFinding: projectRepo.saveFinding.bind(projectRepo),
    saveEvidence: projectRepo.saveEvidence.bind(projectRepo),
  };
}
```

This test deliberately splits reads across two `JsonRepository` instances — one rooted at the real `data/` tree (for the frozen catalog/core/process files) and one rooted at a temp directory (for everything project-instance-scoped) — because `JsonRepository` itself has no concept of splitting roots; `mixedRepository` is a thin manual composition satisfying `SecurityRepository` structurally, built once for this test rather than added to `JsonRepository` itself (a permanent split-root repository is out of this plan's scope; nothing else needs it).

- [ ] **Step 2: Run the test to verify it fails first for the right reason, then passes**

Run: `npm test -- tests/integration/full-workflow.test.ts`
Expected: on a clean tree this should PASS on the first run once all prior tasks are done — there's no separate red/green cycle here since every piece under test already has its own unit-level red/green from Tasks 5-13. If it fails, the failure will point at whichever tool/service call broke the chain; fix forward rather than treating this as a TDD step.

- [ ] **Step 3: Run the full suite one final time**

Run: `npm test`
Expected: PASS — every unit test from Tasks 1-14 plus this integration test.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/full-workflow.test.ts
git commit -m "test(integration): add full create-to-report MCP workflow test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
