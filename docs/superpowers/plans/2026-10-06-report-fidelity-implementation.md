# Report Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ProjectReport` a self-contained, externally-legible artifact that preserves the engine's actual judgment (finding type, severity, controls, attack scenario, exploitability evidence) and its own provenance (what code, what profile, what engine version produced it) — without inventing new engine capability the system doesn't actually have.

**Architecture:** Three independent layers, each its own task. (1) `AssessmentRun` gains three new provenance fields (`target`, `profileSnapshot`, `engineVersionAtRunStart`), captured once at `start_assessment_run` time — never re-read later. (2) `score.ts` and `release-evaluator.ts` rename their ambiguous `criticalFindings`/`highFindings` fields at the source, since the same name currently means two different things in the two files. (3) `ReportBuilder` is extended to copy all of this forward into `ProjectReport` faithfully: a new `projectFindingSnapshots[]` field carrying the full finding record, the three provenance fields copied verbatim from the run, three dead/misleading fields dropped from the report only (core stays untouched), and a new `roundReportNumber` helper applied only at the report-serialization boundary, never before a gate-threshold comparison.

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema draft 2020-12), Zod (MCP tool input validation) — same stack as the rest of this repo.

**Spec:** `docs/superpowers/specs/2026-10-06-report-fidelity-design.md`

## Global Constraints

- `AssessmentRun`'s 3 new fields are **optional-and-nullable**: `target?: Target | null`, `profileSnapshot?: ProjectProfile | null`, `engineVersionAtRunStart?: string | null` — never `field: Type | null`. Optional accepts a legacy record missing the key entirely; nullable lets a new run explicitly record "not declared" (this matters most for `target`, since a caller can legitimately omit it on a brand-new run).
- `ProjectReport`'s 4 mirror fields (`target`, `profileSnapshot`, `engineVersionAtRunStart`, plus `projectFindingSnapshots` which is always an array, never omitted) are **required-but-nullable** — `ReportBuilder` always constructs a fresh object and always sets an explicit value (`run.target ?? null`, etc.), so there is never a "missing key" case on the output side.
- `roundReportNumber(value: number): number`: `if (!Number.isFinite(value)) throw new Error(...)`, then `Math.round((value + Number.EPSILON) * 100) / 100`, then `Object.is(rounded, -0) ? 0 : rounded`.
- Rounding is applied **only** when `ReportBuilder` copies numeric fields into `ProjectReport` — **never** before `release-evaluator.ts`'s gate-threshold comparisons (`coverageOk = score.coverage.coveragePercent >= MIN_COVERAGE_FOR_APPROVAL_PERCENT`). Rounding first could flip a borderline verdict.
- `projectFindingSnapshots` is sorted ascending by `findingId` (plain string comparison) — purely for reproducibility (two reports from the same finding set are byte-identical), not because `findingId`s happen to be sequential today.
- `ReportService.generate` fetches `Finding[]` **exactly once** (one `repository.getFindings(projectId)` call) and passes that same array to `calculateScore`, `evaluateRelease`, and `buildReport`. `ReportBuilder` itself performs **zero** repository reads — it is a pure function over the data its caller supplies.
- `engineVersionAtRunStart` is captured via an **injected `AssessmentService` constructor parameter**, never a fresh `package.json` read inside `startAssessmentRun` on every call. The one real read of `package.json` happens once, at the composition root (`src/mcp/server.ts`'s `buildServer()`).
- **No migration script** backfills `target`/`profileSnapshot`/`engineVersionAtRunStart` on existing `AssessmentRun`s — `profileSnapshot` in particular cannot be honestly backfilled (there is no way to know what a project's profile actually was at a past moment once it has since changed). A `ProjectReport` generated from a legacy run carries all three forward as `null`.
- Old on-disk `ProjectReport`s are **never** migrated and **never** read back into the new type — only newly-generated reports carry `reportSchemaVersion: "2.0.0"`.
- This implementation bumps `package.json`'s `version` from `"0.8.0"` to `"0.9.0"`, per the project's existing versioning policy (established commit `bf13774`) — required for `engineVersionAtRunStart` to mean anything starting from its first release.
- `data/schemas/*.json`: `additionalProperties: false` preserved throughout; `target`/`profileSnapshot`/`engineVersionAtRunStart` stay absent from `assessment-run-schema.json`'s `required` array (not merely typed nullable).
- **Do not touch** `ReleaseGateData.ReleaseGate.requiresByLevel?: Record<string, { criticalFindings?: number; highFindings?: number | string }>` in `src/core/repository.ts`, or `data/process/release-gates.json`'s raw threshold data, or `tests/core/repository.test.ts`'s `getReleaseGates` test. This is a **separate, unrelated field** that happens to share the same name as the fields being renamed in `score.ts`/`release-evaluator.ts` — it describes gate-4 threshold metadata from a different data file and is read by `getReleaseGates()`, which no production code path currently consumes. Renaming it is out of scope and would be a spurious, unrequested change.
- `src/core/release-evaluator.ts` and `src/core/score.ts` keep their **calculation logic** completely unchanged throughout this plan — only their **output field names** change (Task 2). Nothing about what either function computes is different before and after this plan.

---

### Task 1: `AssessmentRun` provenance — `target`, `profileSnapshot`, `engineVersionAtRunStart`

**Files:**
- Modify: `src/core/repository.ts`
- Modify: `src/service/assessment-service.ts`
- Modify: `src/mcp/tools/start-assessment-run.ts`
- Modify: `data/schemas/assessment-run-schema.json`
- Test: `tests/core/repository.test.ts`
- Test: `tests/schemas/assessment-run-schema.test.ts`
- Test: `tests/service/assessment-service.test.ts`
- Test: `tests/mcp/tools/assessment-tools.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (this is the foundational task).
- Produces (for Task 3): `AssessmentRun.target?: Target | null`, `AssessmentRun.profileSnapshot?: ProjectProfile | null`, `AssessmentRun.engineVersionAtRunStart?: string | null` — all populated by `AssessmentService.startAssessmentRun` going forward. `export interface Target { repository: string; commitSha: string | null; branchOrTag: string | null; dirty: boolean | null }` in `src/core/repository.ts`.

- [ ] **Step 1: Add `Target` and the three new `AssessmentRun` fields to `src/core/repository.ts`**

Add this new interface right before `export interface AssessmentRun {` in `src/core/repository.ts`:

```ts
export interface Target {
  repository: string;
  commitSha: string | null;
  branchOrTag: string | null;
  dirty: boolean | null;
}
```

Change `AssessmentRun` from:

```ts
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
  [key: string]: unknown;
}
```

to:

```ts
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
```

Add the import this needs, at the top of the file alongside the other `import type` lines:

```ts
import type { ProjectProfile } from "./applicability.js";
```

(`repository.ts` does not currently import from `applicability.ts` — check the existing import block first; if `ProjectProfile` already has some other import path in this file, use that instead. As of this plan's writing, no such import exists, so add a new line.)

- [ ] **Step 2: Write the failing repository round-trip test**

Add this test to `tests/core/repository.test.ts`, inside the existing `describe("JsonRepository — project-instance read/write (temp data/ tree)", ...)` block, right after the existing `"saveRun then reload round-trips the AssessmentRun"` test. Add `Target` to the existing type-only import line from `../../src/core/repository.js`.

```ts
  it("saveRun then reload round-trips an AssessmentRun with target/profileSnapshot/engineVersionAtRunStart populated", async () => {
    const run: AssessmentRun = {
      runId: "RUN-2", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "pending",
      target: { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false },
      profileSnapshot: { securityLevel: "SVL-2", exposure: ["internet_public"] },
      engineVersionAtRunStart: "0.9.0",
    };
    await repo.saveRun(run);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "runs", "RUN-2.json")));
    expect(reloaded).toEqual(run);
  });

  it("a legacy AssessmentRun JSON file with target/profileSnapshot/engineVersionAtRunStart entirely absent still loads via getRun", async () => {
    const legacyRun = {
      runId: "RUN-LEGACY", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "2.1.0", batchIds: [], status: "pending",
    };
    mkdirSync(join(dir, "projects", "PRJ-1", "runs"), { recursive: true });
    writeFileSync(join(dir, "projects", "PRJ-1", "runs", "RUN-LEGACY.json"), JSON.stringify(legacyRun));
    const loaded = await repo.getRun("PRJ-1", "RUN-LEGACY");
    expect(loaded.target).toBeUndefined();
    expect(loaded.profileSnapshot).toBeUndefined();
    expect(loaded.engineVersionAtRunStart).toBeUndefined();
  });
```

- [ ] **Step 3: Run to verify the type-checks and round-trip test pass, the legacy test passes trivially**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS — `JsonRepository` does no field-level validation on write/read (it's a plain `JSON.stringify`/`JSON.parse` pass-through), so both new tests should pass immediately once the type changes from Step 1 compile. This step confirms the type change didn't break anything, not true TDD red/green (there's no new application logic yet — that's Steps 4+).

- [ ] **Step 4: Add the three fields to the schema, write the failing schema tests**

In `data/schemas/assessment-run-schema.json`, add a new `Target` sub-schema reused by the `target` property, and the three new top-level properties. Change:

```json
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" }
  },
  "required": ["runId", "projectId", "planId", "planVersion", "profileRevision", "catalogVersion", "batchIds", "status"],
  "additionalProperties": false
}
```

to:

```json
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" },
    "target": {
      "type": ["object", "null"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "commitSha": { "type": ["string", "null"] },
        "branchOrTag": { "type": ["string", "null"] },
        "dirty": { "type": ["boolean", "null"] }
      },
      "required": ["repository", "commitSha", "branchOrTag", "dirty"],
      "additionalProperties": false
    },
    "profileSnapshot": { "type": ["object", "null"] },
    "engineVersionAtRunStart": { "type": ["string", "null"] }
  },
  "required": ["runId", "projectId", "planId", "planVersion", "profileRevision", "catalogVersion", "batchIds", "status"],
  "additionalProperties": false
}
```

(`target`/`profileSnapshot`/`engineVersionAtRunStart` are deliberately **absent** from `required` — this is what lets a legacy record missing the keys entirely validate. `profileSnapshot` is schema'd as a bare `["object", "null"]` rather than a full nested `ProjectProfile` shape, matching how `project-schema.json` already embeds `profile` loosely elsewhere in this codebase's schema style for this kind of pass-through snapshot; this plan does not duplicate `project-profile-schema.json`'s full property list a second time inside `assessment-run-schema.json`.)

Add these tests to `tests/schemas/assessment-run-schema.test.ts`:

```ts
  it("accepts a run with target/profileSnapshot/engineVersionAtRunStart populated", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    const doc = {
      ...valid,
      target: { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false },
      profileSnapshot: { securityLevel: "SVL-2", exposure: ["internet_public"] },
      engineVersionAtRunStart: "0.9.0",
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a run with target/profileSnapshot/engineVersionAtRunStart keys entirely absent (legacy compatibility)", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts target: null explicitly (a new run whose caller declined to declare provenance)", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate({ ...valid, target: null }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a target object missing repository", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    const doc = { ...valid, target: { commitSha: null, branchOrTag: null, dirty: null } };
    expect(validate(doc)).toBe(false);
  });
```

- [ ] **Step 5: Run to verify the schema tests pass**

Run: `npx vitest run tests/schemas/assessment-run-schema.test.ts`
Expected: PASS, all tests (the schema edit in Step 4 already implements every case — this confirms the edit, not red/green on new application logic).

- [ ] **Step 6: Write the failing `AssessmentService` tests for the injected `engineVersionAtRunStart` constructor parameter and `target`/`profileSnapshot` capture**

In `tests/service/assessment-service.test.ts`, add these tests inside the existing `describe("AssessmentService.startAssessmentRun", ...)` block, after the existing `"throws NOT_FOUND for an unknown projectId"` test:

```ts
  it("captures a declared target verbatim onto the new run", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW, "0.9.0");
    const target = { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false };
    const result = await service.startAssessmentRun("PRJ-1", { target });
    const run = await repo.getRun("PRJ-1", result.runId);
    expect(run.target).toEqual(target);
  });

  it("defaults target to null when the caller omits it entirely", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW, "0.9.0");
    const result = await service.startAssessmentRun("PRJ-1");
    const run = await repo.getRun("PRJ-1", result.runId);
    expect(run.target).toBeNull();
  });

  it("captures a deep copy of the project's profile at run-start — later mutation of the live profile does not affect the stored snapshot", async () => {
    // This test's validity depends on observing the exact object saveRun() was called with, not
    // a value re-read through a repository that might itself copy on read or write (a
    // JSON-serializing repository, for instance, would accidentally "deep copy" everything on
    // every read, masking a missing structuredClone in the service). Wrapping saveRun to capture
    // its argument directly proves the invariant regardless of which SecurityRepository
    // implementation backs this test — do not weaken this to a plain getRun() re-read.
    const repo = await makeProjectRepo();
    let capturedRun: import("../../src/core/repository.js").AssessmentRun | undefined;
    const originalSaveRun = repo.saveRun.bind(repo);
    repo.saveRun = async (run) => {
      capturedRun = run;
      return originalSaveRun(run);
    };
    const service = new AssessmentService(repo, () => FIXED_NOW, "0.9.0");
    await service.startAssessmentRun("PRJ-1");
    expect(capturedRun?.profileSnapshot).toEqual({ securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} });

    const project = await repo.getProject("PRJ-1");
    (project.profile as { exposure: string[] }).exposure.push("mutated-after-run-start");
    expect((capturedRun?.profileSnapshot as { exposure: string[] }).exposure).toEqual(["internet_public"]);
  });

  it("captures the injected engineVersion onto the new run as engineVersionAtRunStart", async () => {
    const repo = await makeProjectRepo();
    const service = new AssessmentService(repo, () => FIXED_NOW, "0.9.0");
    const result = await service.startAssessmentRun("PRJ-1");
    const run = await repo.getRun("PRJ-1", result.runId);
    expect(run.engineVersionAtRunStart).toBe("0.9.0");
  });

  it("a TypeScript object literal omitting the third constructor argument does not compile (type-level check, not a runtime assertion)", () => {
    // @ts-expect-error — engineVersionAtRunStart is required, not optional; this line exists so
    // `npx tsc --noEmit` fails loudly if a future edit accidentally gives it a default again.
    const service = new AssessmentService(new FakeRepository(), () => FIXED_NOW);
    expect(service).toBeDefined(); // unreachable at the type level; keeps the file a valid test
  });
```

- [ ] **Step 7: Run to verify these fail**

Run: `npx vitest run tests/service/assessment-service.test.ts`
Expected: FAIL — `startAssessmentRun` doesn't accept a second parameter yet, `AssessmentService`'s constructor doesn't accept a third parameter yet, and the stored run never sets `target`/`profileSnapshot`/`engineVersionAtRunStart` at all. Confirm the failures are about missing behavior, not a typo.

- [ ] **Step 8: Implement the constructor injection and `startAssessmentRun` changes**

In `src/service/assessment-service.ts`, change the class constructor from:

```ts
export class AssessmentService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}
```

to:

```ts
export class AssessmentService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly engineVersionAtRunStart: string
  ) {}
```

`engineVersionAtRunStart` is **required, with no default** — deliberately unlike `now`. A silent default (e.g. `string | null = null`) would let a future call site construct a production `AssessmentService` without ever noticing it forgot to wire the real version, silently degrading every run's provenance forever. Requiring it forces every construction site (including this plan's own composition-root wiring, Step 9 below) to make an explicit choice. This is strictly about the *constructor parameter* — `AssessmentRun.engineVersionAtRunStart` itself (the stored field) stays optional-and-nullable per the Global Constraints, since a legacy persisted run genuinely has no value to report.

Add this import:

```ts
import type { Target } from "../core/repository.js";
```

(`Target` may already be reachable via the existing `import type { AssessmentRun, ... } from "../core/repository.js";` line — add it to that existing import list instead of a new line if so.)

Change `startAssessmentRun`'s signature and body from:

```ts
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
```

to:

```ts
  async startAssessmentRun(
    projectId: string,
    input?: { target?: Target }
  ): Promise<StartAssessmentRunResult> {
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
      target: input?.target ?? null,
      profileSnapshot: structuredClone(project.profile),
      engineVersionAtRunStart: this.engineVersionAtRunStart,
    };
    await this.repository.saveRun(run);
    return { runId, startedAt };
  }
```

- [ ] **Step 9: Run to verify the new tests pass (expect other pre-existing tests in this file to now fail)**

Run: `npx vitest run tests/service/assessment-service.test.ts`
Expected: the tests added in Step 6 PASS. Every *other*, pre-existing test in this file that constructs `new AssessmentService(repo, someNow)` with only two arguments now FAILS to compile (`engineVersionAtRunStart` is required, per Step 8) — this is expected and is what Step 10 below fixes. Confirm the failures are TypeScript compile errors on the missing third argument, not a different kind of failure.

- [ ] **Step 10: Mechanical sweep — supply a literal test engine version to every other pre-existing `AssessmentService` construction**

Making `engineVersionAtRunStart` required (Step 8) breaks every pre-existing call site across the test suite that constructs `new AssessmentService(...)` with fewer than three arguments. Find every occurrence:

Run: `rg -n "new AssessmentService\(" tests/ src/`

As of this plan's writing there are roughly 53 such occurrences, concentrated in `tests/service/assessment-service.test.ts`, `tests/mcp/tools/assessment-tools.test.ts`, and `tests/integration/full-workflow.test.ts` (`src/mcp/server.ts`'s own construction is handled separately, in Step 11). For every call site with fewer than three arguments, add a literal third argument `"0.9.0-test"` — a placeholder version string distinct from both the real `package.json` version and from any specific version string an individual test already asserts against (so it's visually obvious in a failure message that this is the sweep's filler value, not a meaningful fixture). Do **not** touch call sites that already pass a specific third argument for their own test's reasons (e.g. this task's own new `"0.9.0"`-asserting tests from Step 6) — only add the argument where it's currently missing.

This is a pure mechanical edit — no test's assertions, fixture data, or expected values change, only the `AssessmentService` constructor calls each test already makes.

- [ ] **Step 11: Run to verify it passes**

Run: `npx tsc --noEmit`
Expected: clean — confirms every `new AssessmentService(...)` call site in `tests/` now supplies all three arguments. If this still fails, `rg -n "new AssessmentService\("` again and check for a call site the sweep missed.

Run: `npx vitest run`
Expected: PASS, every test file (the sweep is purely additive — no assertion anywhere changed).

- [ ] **Step 12: Wire the real `engineVersionAtRunStart` value at the composition root (`server.ts`), bump `package.json`'s version**

This step was originally planned for Task 3, but belongs here: Task 1 introduces the `engineVersionAtRunStart` constructor requirement, so Task 1's own commit should leave the real server wired end-to-end, not depend on a later task to supply the only non-test construction of `AssessmentService`.

In `package.json`, change `"version": "0.8.0"` to `"version": "0.9.0"`.

In `src/mcp/server.ts`, add these imports at the top:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
```

Add this near the top of the file, after the imports, before `export function buildServer`:

```ts
const __dirname = dirname(fileURLToPath(import.meta.url));

function readEngineVersion(): string {
  const packageJsonPath = join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
  return pkg.version;
}
```

Change the `AssessmentService` construction line inside `buildServer` from:

```ts
  const assessmentService = new AssessmentService(repository);
```

to:

```ts
  const assessmentService = new AssessmentService(repository, undefined, readEngineVersion());
```

(`undefined` for the second argument keeps `now`'s existing default; the third argument is no longer optional, so it must be passed explicitly here.)

- [ ] **Step 13: Manually verify `start_assessment_run` now captures the real package version end-to-end**

Run: `node --experimental-strip-types -e "
import { buildServer } from './src/mcp/server.ts';
const server = buildServer();
console.log('server built OK');
"`

Expected: prints `server built OK` with no error (confirms `readEngineVersion()` resolves `package.json`'s real path correctly from `src/mcp/server.ts`'s location — if this throws an `ENOENT`, the relative path in `readEngineVersion` needs adjusting). If `--experimental-strip-types` isn't available in the installed Node version, instead run `npx tsx -e "import('./src/mcp/server.ts').then(m => { m.buildServer(); console.log('server built OK'); })"`.

- [ ] **Step 14: Wire the `target` input into `start_assessment_run`'s MCP tool, write the failing tool test**

Add this test to `tests/mcp/tools/assessment-tools.test.ts`, near wherever `start_assessment_run` is already exercised (search the file for `"start_assessment_run"` to find the right `describe` block):

```ts
  it("start_assessment_run accepts an optional target and rejects a target object missing repository", async () => {
    const { client } = await makeConnectedClient();
    const ok = await client.callTool({
      name: "start_assessment_run",
      arguments: { projectId: "PRJ-1", target: { repository: "example/repo", commitSha: null, branchOrTag: null, dirty: null } },
    });
    expect(ok.isError).toBeFalsy();

    const bad = await client.callTool({
      name: "start_assessment_run",
      arguments: { projectId: "PRJ-1", target: { commitSha: null, branchOrTag: null, dirty: null } },
    });
    expect(bad.isError).toBe(true);
  });
```

(If `makeConnectedClient` in this file doesn't already seed a project with id `PRJ-1`, use whatever project id the file's existing helper already seeds instead.)

- [ ] **Step 15: Run to verify it fails**

Run: `npx vitest run tests/mcp/tools/assessment-tools.test.ts`
Expected: FAIL — `start_assessment_run`'s zod input shape doesn't declare `target` yet, so a missing-`repository` target object is silently accepted (zod would just ignore the unrecognized shape or MCP validation wouldn't reject it) rather than being rejected.

- [ ] **Step 16: Implement the zod input and handler change**

In `src/mcp/tools/start-assessment-run.ts`, change:

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
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

to:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AssessmentService } from "../../service/assessment-service.js";
import { toErrorResult } from "./error-result.js";

const targetInputShape = z.object({
  repository: z.string().min(1),
  commitSha: z.string().nullable(),
  branchOrTag: z.string().nullable(),
  dirty: z.boolean().nullable(),
});

export const startAssessmentRunInputShape = {
  projectId: z.string().min(1),
  target: targetInputShape.optional(),
};

export function registerStartAssessmentRunTool(server: McpServer, service: AssessmentService): void {
  server.registerTool(
    "start_assessment_run",
    {
      title: "Start Assessment Run",
      description:
        "Start a new assessment run for a project. The optional target input declares what code this " +
        "run is assessing (repository, commitSha, branchOrTag, dirty) — this is caller-asserted " +
        "provenance, not independently verified by the server. When supplied, repository is required; " +
        "the other three fields may be null. A project's current profile is deep-copied onto the run " +
        "at this moment, so a later profile change cannot retroactively alter what this run recorded.",
      inputSchema: startAssessmentRunInputShape,
    },
    async ({ projectId, target }) => {
      try {
        const result = await service.startAssessmentRun(projectId, target ? { target } : undefined);
        return {
          content: [{ type: "text" as const, text: `Started run ${result.runId} at ${result.startedAt}.` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

- [ ] **Step 17: Run to verify it passes**

Run: `npx vitest run tests/mcp/tools/assessment-tools.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 18: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean — this also confirms Step 10's mechanical sweep caught every pre-existing `AssessmentService` construction.

Run: `npx vitest run`
Expected: PASS, every test file.

- [ ] **Step 19: Commit**

```bash
git add src/core/repository.ts src/service/assessment-service.ts src/mcp/tools/start-assessment-run.ts \
  src/mcp/server.ts package.json \
  data/schemas/assessment-run-schema.json \
  tests/core/repository.test.ts tests/schemas/assessment-run-schema.test.ts \
  tests/service/assessment-service.test.ts tests/mcp/tools/assessment-tools.test.ts \
  tests/integration/full-workflow.test.ts
git commit -m "feat(core,service,mcp): capture target/profileSnapshot/engineVersionAtRunStart on AssessmentRun

Three new AssessmentRun fields, all captured once at start_assessment_run
time rather than re-read later: target (caller-asserted repository/commit
provenance), profileSnapshot (a deep copy of the project's profile at
that moment), and engineVersionAtRunStart (this package's version).
AssessmentRun's own fields are optional-and-nullable, so a legacy run
missing these keys entirely still validates, and a new run can still
explicitly record target: null when the caller declines to declare it.
engineVersionAtRunStart is injected via a required (non-defaulted)
AssessmentService constructor parameter, wired to the real package.json
version at the composition root (server.ts) in this same commit — a
silent default would have let a future call site forget to wire a real
version without any error. package.json bumped to 0.9.0 so the injected
version means something starting from this release.

See docs/superpowers/specs/2026-10-06-report-fidelity-design.md §3.3"
```

---

### Task 2: Rename `criticalFindings`/`highFindings` at the source

**Files:**
- Modify: `src/core/score.ts`
- Modify: `src/core/release-evaluator.ts`
- Modify: `src/core/report-builder.ts`
- Modify: `src/mcp/tools/record-finding.ts`
- Modify: `data/schemas/score-schema.json`
- Modify: `data/schemas/release-evaluation-schema.json`
- Modify: `data/schemas/project-report-schema.json`
- Test: `tests/core/score.test.ts`
- Test: `tests/core/release-evaluator.test.ts`
- Test: `tests/core/report-builder.test.ts`
- Test: `tests/core/repository.test.ts`
- Test: `tests/schemas/score-schema.test.ts`
- Test: `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`
- Test: `tests/schemas/project-report-schema.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces (for Task 3): `score.ts`'s `DomainScore.criticalSeverityFindings`/`highSeverityFindings`; `release-evaluator.ts`'s `ReleaseEvaluation.confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`; `report-builder.ts`'s `ReleaseEvaluationForReport.confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities` (same rename, so `buildReport`'s pass-through of the engine's `ReleaseEvaluation` still compiles).

- [ ] **Step 1: Rename in `src/core/score.ts`, write the failing semantic-predicate test**

In `tests/core/score.test.ts`, add this test to the end of the `describe("calculateScore — domainScores", ...)` block — it asserts the *predicate* the new name claims (any active finding by severity, independent of `Finding.type`), not just that the field exists under a new name:

```ts
  it("criticalSeverityFindings counts an active hardening-type finding at severity critical — it is not limited to confirmed_vulnerability", () => {
    const assessments: ControlAssessmentInput[] = [{ controlId: "A-001", status: "PASS" }];
    const findings: FindingInput[] = [
      { controlIds: ["A-001"], severity: "critical", status: "open" },
    ];
    const result = calculateScore(assessments, [controls[0]], findings, model);
    const appsec = result.domainScores.find((d) => d.domain === "appsec")!;
    expect(appsec.criticalSeverityFindings).toBe(1);
  });
```

Run: `npx vitest run tests/core/score.test.ts`
Expected: FAIL — `appsec.criticalSeverityFindings` is `undefined` (the field is still named `criticalFindings`).

Now rename in `src/core/score.ts`. Change `DomainScore`:

```ts
export interface DomainScore {
  domain: string;
  score: number;
  totalControls: number;
  applicableControls: number;
  assessedControls: number;
  coveragePercent: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  notTestedCount: number;
  notApplicableCount: number;
  acceptedRiskCount: number;
  criticalSeverityFindings: number;
  highSeverityFindings: number;
}
```

and the two assignments inside `calculateScore`:

```ts
      criticalSeverityFindings: countActiveFindings(findings, domainControlIds, "critical"),
      highSeverityFindings: countActiveFindings(findings, domainControlIds, "high"),
```

Run: `npx vitest run tests/core/score.test.ts`
Expected: PASS, every test (update the one pre-existing assertion `expect(appsec.criticalFindings).toBe(1); expect(infra.highFindings).toBe(0);` in `"counts an open critical finding against the domain of any control it references"` to use the new field names too).

- [ ] **Step 2: Rename in `src/core/release-evaluator.ts`, write the failing semantic-predicate test**

In `tests/core/release-evaluator.test.ts`, add this test (place it near the file's existing `confirmed_vulnerability`-vs-other-type tests — search for `"mixed set: only the confirmed_vulnerability finding counts"` to find the right neighborhood):

```ts
  it("confirmedCriticalVulnerabilities does NOT count an active hardening-type finding at severity critical — only confirmed_vulnerability counts", () => {
    const findings: FindingInput[] = [
      { findingId: "F-1", controlIds: ["A-001"], severity: "critical", status: "open", type: "hardening" },
    ];
    const result = evaluateRelease({
      score: { coverage: { coveragePercent: 100 } },
      findings, attackPaths: [], assessments: [], securityLevel: "SVL-3",
    });
    expect(result.confirmedCriticalVulnerabilities).toBe(0);
  });
```

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: FAIL — `result.confirmedCriticalVulnerabilities` is `undefined`.

Now rename every occurrence in `src/core/release-evaluator.ts`. Change the `ReleaseEvaluation` interface:

```ts
export interface ReleaseEvaluation {
  gate: 4;
  controlCoverage: number;
  confirmedCriticalVulnerabilities: number;
  confirmedHighVulnerabilities: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  blockingControlFailures: string[];
  blockingControlsNotVerified: string[];
  result: "approved" | "blocked" | "indeterminate";
}
```

and inside `evaluateRelease`, change:

```ts
  const criticalFindings = activeCritical.length;
  const highFindings = activeHigh.length;

  const criticalFindingIds = new Set(activeCritical.map((f) => f.findingId));
```

to:

```ts
  const confirmedCriticalVulnerabilities = activeCritical.length;
  const confirmedHighVulnerabilities = activeHigh.length;

  const criticalFindingIds = new Set(activeCritical.map((f) => f.findingId));
```

and:

```ts
  const highFindingsSatisfied = securityLevel === "SVL-3" ? highFindings === 0 : uncoveredHigh.length === 0;

  const findingThresholdsPass = criticalFindings === 0 && highFindingsSatisfied;
```

to:

```ts
  const highFindingsSatisfied = securityLevel === "SVL-3" ? confirmedHighVulnerabilities === 0 : uncoveredHigh.length === 0;

  const findingThresholdsPass = confirmedCriticalVulnerabilities === 0 && highFindingsSatisfied;
```

and the final return block, change:

```ts
  return {
    gate: 4,
    controlCoverage: score.coverage.coveragePercent,
    criticalFindings,
    highFindings,
```

to:

```ts
  return {
    gate: 4,
    controlCoverage: score.coverage.coveragePercent,
    confirmedCriticalVulnerabilities,
    confirmedHighVulnerabilities,
```

(`highFindingsSatisfied`/`findingThresholdsPass`/`uncoveredHigh` local variable names stay as-is — only the two field names that end up on the `ReleaseEvaluation` object itself are renamed.)

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: FAIL still, with compile or assertion errors from every pre-existing `result.criticalFindings`/`result.highFindings` assertion in the file (around a dozen occurrences). Rename every one of them in `tests/core/release-evaluator.test.ts` from `result.criticalFindings`/`result.highFindings` to `result.confirmedCriticalVulnerabilities`/`result.confirmedHighVulnerabilities` — this is a mechanical, file-wide find-and-replace; do not change any other part of the assertions (expected values, fixture data, test names) since the underlying computation is unchanged.

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: PASS, every test.

- [ ] **Step 3: Propagate the rename into `report-builder.ts`'s `ReleaseEvaluationForReport`, write the failing test**

`ReleaseEvaluationForReport` currently mirrors `ReleaseEvaluation`'s shape field-for-field, and `buildReport` passes the caller's `ReleaseEvaluation` value straight through as a `ReleaseEvaluationForReport` — so this must be renamed too, or the codebase won't compile once Step 2 lands.

In `tests/core/report-builder.test.ts`, change the module-level `releaseEvaluation` fixture from:

```ts
const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, criticalFindings: 0, highFindings: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true,
  blockingControlFailures: [], blockingControlsNotVerified: [],
  result: "approved",
};
```

to:

```ts
const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true,
  blockingControlFailures: [], blockingControlsNotVerified: [],
  result: "approved",
};
```

Run: `npx tsc --noEmit`
Expected: FAIL — this fixture now satisfies the *old* `ReleaseEvaluationForReport` type (which still declares `criticalFindings`/`highFindings`), and nothing calls the new field names yet, so TypeScript should flag a mismatch once `ReleaseEvaluationForReport` itself is renamed in the next sub-step. (If running this before editing `report-builder.ts` shows a different error — e.g. unused old fields — that's expected at this exact midpoint; the point of this step is just to have the fixture already updated before the interface changes under it.)

Now rename in `src/core/report-builder.ts`. Change `ReleaseEvaluationForReport`:

```ts
export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  confirmedCriticalVulnerabilities: number;
  confirmedHighVulnerabilities: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  blockingControlFailures: string[];
  blockingControlsNotVerified: string[];
  result: "approved" | "blocked" | "indeterminate";
}
```

(Nothing else in `report-builder.ts` references these two field names directly — `buildReport` passes `releaseEvaluation: input.releaseEvaluation` through untouched — so no further code change is needed in this file for this step.)

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS, every test.

- [ ] **Step 4: Rename the fixture in `tests/core/repository.test.ts`'s `ProjectReport` round-trip test**

In `tests/core/repository.test.ts`'s `"saveReport then reload round-trips the ProjectReport"` test, change the `releaseEvaluation` literal from:

```ts
      prioritizedFindings: [], releaseEvaluation: { gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" as const },
```

to:

```ts
      prioritizedFindings: [], releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" as const },
```

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS (this fixture uses `satisfies ProjectReport`, so it must stay in lockstep with `ProjectReport`'s current shape — Task 3 will change this same fixture again when `ProjectReport` grows its new fields).

- [ ] **Step 5: Rename in the three affected schemas, update their tests**

In `data/schemas/score-schema.json`, inside the `domainScores` item's `properties`, rename `criticalFindings`/`highFindings` to `criticalSeverityFindings`/`highSeverityFindings` (both in `properties` and in the item's `required` array).

In `data/schemas/release-evaluation-schema.json`, rename `criticalFindings`/`highFindings` to `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities` (both in `properties` and in `required`).

In `data/schemas/project-report-schema.json`, apply the **same two renames in both embedded locations** — inside `score.domainScores`'s item `properties`/`required`, and inside `releaseEvaluation`'s `properties`/`required` — but do **not** remove `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` yet (Task 3 owns that removal). This step is a pure rename in all three files, keeping `tests/schema-drift.test.ts`'s exact-match assertions between `project-report-schema.json`'s embedded sub-schemas and the two standalone schemas passing throughout.

Update `tests/schemas/score-schema.test.ts`'s fixture(s) to use `criticalSeverityFindings`/`highSeverityFindings`.

Update `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`'s `describe("release-evaluation-schema", ...)` block's fixture(s) to use `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`.

Update `tests/schemas/project-report-schema.test.ts`'s `valid` fixture: inside `score.domainScores[0]`, rename `criticalFindings: 0, highFindings: 1` to `criticalSeverityFindings: 0, highSeverityFindings: 1`; inside `releaseEvaluation`, rename `criticalFindings: 1, highFindings: 2` to `confirmedCriticalVulnerabilities: 1, confirmedHighVulnerabilities: 2`.

Run: `npx vitest run tests/schemas/score-schema.test.ts tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts tests/schemas/project-report-schema.test.ts tests/schema-drift.test.ts`
Expected: PASS, every test in all four files.

- [ ] **Step 6: Update `record-finding.ts`'s stale field-name reference in its tool description**

In `src/mcp/tools/record-finding.ts`, find the `type` field's zod `.describe(...)` string (it currently reads in part: `"Only confirmed_vulnerability findings count toward the production_release gate's criticalFindings/highFindings thresholds — picking the right type is not cosmetic."`). Change `criticalFindings/highFindings` to `confirmedCriticalVulnerabilities/confirmedHighVulnerabilities` in that sentence. This is a prose-only change (no behavior change) — fixing a tool description that would otherwise reference field names that no longer exist on `evaluate_release`'s live output.

- [ ] **Step 7: Scoped reconciliation grep — confirm every remaining `criticalFindings`/`highFindings` occurrence is intentional**

Run: `rg -n '\bcriticalFindings\b|\bhighFindings\b' src tests data`

Classify every hit into exactly one of these three buckets:

- **Intentional, keep as-is:** `data/process/release-gates.json` and any reference to it (`ReleaseGateData.ReleaseGate.requiresByLevel`, `src/core/repository.ts`'s type declaration, `tests/core/repository.test.ts`'s `"getReleaseGates returns gate 4's requiresByLevel thresholds"` test) — this is the unrelated field the Global Constraints explicitly say not to touch (§ "Do not touch `ReleaseGateData...`").
- **Bug — rename it:** any occurrence in `src/core/score.ts`, `src/core/release-evaluator.ts`, `src/core/report-builder.ts`, or their test files that this task's Steps 1-5 should have already renamed but missed.
- **Historical/documentary, may keep:** prose inside `## 6. Adoption Log` of `docs/superpowers/specs/2026-10-06-report-fidelity-design.md` or similar spec/plan documents that are deliberately describing the *old* names as historical context (e.g. "renamed `criticalFindings` to ..."). Do not edit these.

If anything falls into the second bucket, fix it now and re-run this grep until only the first and third buckets remain.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, every test file.

- [ ] **Step 9: Commit**

```bash
git add src/core/score.ts src/core/release-evaluator.ts src/core/report-builder.ts src/mcp/tools/record-finding.ts \
  data/schemas/score-schema.json data/schemas/release-evaluation-schema.json data/schemas/project-report-schema.json \
  tests/core/score.test.ts tests/core/release-evaluator.test.ts tests/core/report-builder.test.ts tests/core/repository.test.ts \
  tests/schemas/score-schema.test.ts tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts tests/schemas/project-report-schema.test.ts
git commit -m "refactor(core,schemas): rename criticalFindings/highFindings at the source

score.ts's DomainScore.criticalFindings/highFindings (every active
finding by severity, independent of Finding.type) and
release-evaluator.ts's ReleaseEvaluation.criticalFindings/highFindings
(only active confirmed_vulnerability findings, the subset that drives
the Finding Gate) shared the same field name for two different
meanings — one report showed domain-level highFindings: 6 alongside
releaseEvaluation.highFindings: 0 for the same assessment with nothing
explaining why. Renamed to criticalSeverityFindings/highSeverityFindings
(score.ts) and confirmedCriticalVulnerabilities/confirmedHighVulnerabilities
(release-evaluator.ts) — calculation logic in both files is completely
unchanged, only the output field names differ.

See docs/superpowers/specs/2026-10-06-report-fidelity-design.md §3.2"
```

---

### Task 3: `ReportBuilder` — `projectFindingSnapshots`, provenance fields, dropped fields, rounding, `reportSchemaVersion`

**Files:**
- Modify: `src/core/report-builder.ts`
- Modify: `src/service/report-service.ts`
- Modify: `data/schemas/project-report-schema.json`
- Test: `tests/core/report-builder.test.ts`
- Test: `tests/service/report-service.test.ts`
- Test: `tests/core/repository.test.ts`
- Test: `tests/schemas/project-report-schema.test.ts`
- Test: `tests/schema-drift.test.ts`

(`src/mcp/server.ts` and `package.json` are **not** touched by this task — Task 1 already wires `engineVersionAtRunStart` at the composition root and bumps the version, since Task 1 is what introduces the required constructor parameter in the first place.)

**Interfaces:**
- Consumes (from Task 1): `AssessmentRun.target`/`profileSnapshot`/`engineVersionAtRunStart`. Consumes (from Task 2): `ReleaseEvaluationForReport.confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities` already renamed.
- Produces: the final `ProjectReport` shape — `projectFindingSnapshots: FindingSnapshot[]`, `target: Target | null`, `profileSnapshot: ProjectProfile | null`, `engineVersionAtRunStart: string | null`, `reportSchemaVersion: string`; `ReleaseEvaluationForReport` with `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` dropped; `roundReportNumber(value: number): number` exported from `report-builder.ts`.

- [ ] **Step 1: Widen `FindingForReport`, add `FindingSnapshot` and `buildProjectFindingSnapshots`, write the failing tests**

In `tests/core/report-builder.test.ts`, every existing `FindingForReport` object literal (in the `"includes only open/in_progress findings..."` and `"projects findings to the prioritizedFindings summary shape..."` tests) needs three new required fields once `FindingForReport` is widened in the next sub-step. Update all of them — for example the first one, change:

```ts
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", status: "open", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-progress", title: "in progress one", status: "in_progress", priority: { index: 2 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", status: "resolved", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-accepted", title: "accepted one", status: "accepted", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-fp", title: "false positive", status: "false_positive", priority: { index: 0 }, criticality: { index: 9 } },
    ];
```

to (adding `type`, `controlIds`, `severity` to every entry):

```ts
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", type: "confirmed_vulnerability", controlIds: ["A-001"], status: "open", severity: "high", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-progress", title: "in progress one", type: "control_gap", controlIds: ["A-001"], status: "in_progress", severity: "medium", priority: { index: 2 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", type: "confirmed_vulnerability", controlIds: ["A-002"], status: "resolved", severity: "critical", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-accepted", title: "accepted one", type: "accepted_design", controlIds: ["A-002"], status: "accepted", severity: "low", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-fp", title: "false positive", type: "needs_validation", controlIds: ["A-003"], status: "false_positive", severity: "informational", priority: { index: 0 }, criticality: { index: 9 } },
    ];
```

Apply the same three additions to the second existing fixture array, in the `"projects findings to the prioritizedFindings summary shape and sorts them"` test — change:

```ts
    const findings: FindingForReport[] = [
      { findingId: "F-low", title: "low priority", status: "open", priority: { index: 5 }, criticality: { index: 5 } },
      { findingId: "F-high", title: "high priority", status: "open", priority: { index: 1 }, criticality: { index: 5 } },
    ];
```

to:

```ts
    const findings: FindingForReport[] = [
      { findingId: "F-low", title: "low priority", type: "control_gap", controlIds: ["A-001"], status: "open", severity: "medium", priority: { index: 5 }, criticality: { index: 5 } },
      { findingId: "F-high", title: "high priority", type: "confirmed_vulnerability", controlIds: ["A-001"], status: "open", severity: "high", priority: { index: 1 }, criticality: { index: 5 } },
    ];
```

Add a new `describe` block with the actual new-behavior tests, after the existing `describe("buildReport", ...)` block closes:

```ts
describe("buildReport — projectFindingSnapshots", () => {
  it("includes every finding regardless of status, unlike prioritizedFindings' open/in_progress-only filter", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", type: "confirmed_vulnerability", controlIds: ["A-001"], status: "open", severity: "high", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", type: "control_gap", controlIds: ["A-002"], status: "resolved", severity: "medium", priority: { index: 0 }, criticality: { index: 3 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect(report.projectFindingSnapshots.map((f) => f.findingId)).toEqual(["F-open", "F-resolved"]);
    expect(report.prioritizedFindings.map((f) => f.findingId)).toEqual(["F-open"]);
  });

  it("carries type/severity/controlIds/attackScenario/exploitabilityEvidence through, not just the prioritizedFindings subset", () => {
    const findings: FindingForReport[] = [
      {
        findingId: "F-1", title: "Admin API reachable without auth", type: "confirmed_vulnerability",
        controlIds: ["IAM-AUTHZ-001", "IAM-AUTHZ-002"], status: "open", severity: "critical",
        priority: { index: 0 }, criticality: { index: 9 },
        attackScenario: "An unauthenticated attacker calls the admin API directly.",
        exploitabilityEvidence: "curl -X POST /admin/users succeeds with no Authorization header.",
      },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect(report.projectFindingSnapshots[0]).toEqual({
      findingId: "F-1", title: "Admin API reachable without auth", type: "confirmed_vulnerability",
      severity: "critical", controlIds: ["IAM-AUTHZ-001", "IAM-AUTHZ-002"], status: "open",
      priorityIndex: 0, criticalityIndex: 9,
      attackScenario: "An unauthenticated attacker calls the admin API directly.",
      exploitabilityEvidence: "curl -X POST /admin/users succeeds with no Authorization header.",
    });
  });

  it("omits attackScenario/exploitabilityEvidence keys entirely when the finding doesn't have them, rather than writing undefined", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-1", title: "x", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect("attackScenario" in report.projectFindingSnapshots[0]).toBe(false);
    expect("exploitabilityEvidence" in report.projectFindingSnapshots[0]).toBe(false);
  });

  it("is sorted ascending by findingId regardless of input order, and two reports from the same findings are byte-identical", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-003", title: "c", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
      { findingId: "F-001", title: "a", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
      { findingId: "F-002", title: "b", type: "hardening", controlIds: ["A-001"], status: "open", severity: "low", priority: { index: 5 }, criticality: { index: 1 } },
    ];
    const buildOnce = () => buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    const first = buildOnce();
    expect(first.projectFindingSnapshots.map((f) => f.findingId)).toEqual(["F-001", "F-002", "F-003"]);
    const second = buildOnce();
    expect(JSON.stringify(second.projectFindingSnapshots)).toEqual(JSON.stringify(first.projectFindingSnapshots));
  });
});
```

- [ ] **Step 2: Run to verify these fail**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: FAIL — compile errors (`FindingForReport` doesn't have `type`/`controlIds`/`severity` yet), and `report.projectFindingSnapshots` is `undefined`.

- [ ] **Step 3: Implement the widened `FindingForReport`, `FindingSnapshot`, and `buildProjectFindingSnapshots`**

In `src/core/report-builder.ts`, change `FindingForReport` from:

```ts
export interface FindingForReport {
  findingId: string;
  title: string;
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  priority: { index: number };
  criticality: { index: number };
}
```

to:

```ts
export interface FindingForReport {
  findingId: string;
  title: string;
  type: "confirmed_vulnerability" | "likely_vulnerability" | "control_gap" | "hardening" | "process_gap" | "accepted_design" | "needs_validation";
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  priority: { index: number };
  criticality: { index: number };
  attackScenario?: string;
  exploitabilityEvidence?: string;
}
```

Add `FindingSnapshot` and `buildProjectFindingSnapshots` right after `sortPrioritizedFindings`:

```ts
export interface FindingSnapshot {
  findingId: string;
  title: string;
  type: FindingForReport["type"];
  severity: FindingForReport["severity"];
  controlIds: string[];
  status: FindingForReport["status"];
  priorityIndex: number;
  criticalityIndex: number;
  attackScenario?: string;
  exploitabilityEvidence?: string;
}

export function buildProjectFindingSnapshots(findings: FindingForReport[]): FindingSnapshot[] {
  const snapshots: FindingSnapshot[] = findings.map((f) => ({
    findingId: f.findingId,
    title: f.title,
    type: f.type,
    severity: f.severity,
    controlIds: [...f.controlIds], // defensive copy — ProjectReport is an immutable snapshot and must not share array references with its input
    status: f.status,
    priorityIndex: f.priority.index,
    criticalityIndex: f.criticality.index,
    ...(f.attackScenario !== undefined ? { attackScenario: f.attackScenario } : {}),
    ...(f.exploitabilityEvidence !== undefined ? { exploitabilityEvidence: f.exploitabilityEvidence } : {}),
  }));
  // Explicit ASCII/code-unit comparison, not localeCompare — localeCompare's result can vary with
  // the running environment's ICU/locale configuration, which would undermine the byte-reproducible
  // ordering this sort exists to guarantee.
  return snapshots.sort((a, b) => (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0));
}
```

Add `projectFindingSnapshots: FindingSnapshot[];` to the `ProjectReport` interface, right after `prioritizedFindings: PrioritizedFindingInput[];`, and wire it into `buildReport`'s return object right after `prioritizedFindings: sortPrioritizedFindings(projected),`:

```ts
    projectFindingSnapshots: buildProjectFindingSnapshots(input.findings),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Write the failing tests for `roundReportNumber`, the provenance fields, `reportSchemaVersion`, and the three dropped fields**

First, retype the module-level `releaseEvaluation` fixture (established in Task 2 Step 3, reused by every `buildReport` test in this file) from `ReleaseEvaluationForReport` to the core `ReleaseEvaluation` type, since `buildReport`'s `releaseEvaluation` input parameter changes to that wider type later in this task (Step 7). Change:

```ts
const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true,
  blockingControlFailures: [], blockingControlsNotVerified: [],
  result: "approved",
};
```

to:

```ts
import type { ReleaseEvaluation } from "../../src/core/release-evaluator.js";

const releaseEvaluation: ReleaseEvaluation = {
  gate: 4, controlCoverage: 80, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true,
  blockingControlFailures: [], blockingControlsNotVerified: [],
  result: "approved",
};
```

(The object literal's fields are unchanged — only the declared type widens. This fixture still genuinely carries `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified`, which is exactly what makes the "drops unblockedCriticalAttackPaths/..." test below meaningful: the input truly has those fields, and the test proves the output doesn't.)

Add this to `tests/core/report-builder.test.ts`:

```ts
import { roundReportNumber } from "../../src/core/report-builder.js";

describe("roundReportNumber", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundReportNumber(57.49999999999999)).toBe(57.5);
    expect(roundReportNumber(79.995)).toBe(80);
  });

  it("normalizes -0 to 0", () => {
    expect(Object.is(roundReportNumber(-0.001), 0)).toBe(true);
  });

  it("throws on non-finite input", () => {
    expect(() => roundReportNumber(NaN)).toThrow();
    expect(() => roundReportNumber(Infinity)).toThrow();
    expect(() => roundReportNumber(-Infinity)).toThrow();
  });
});

describe("buildReport — rounding applied at serialization only", () => {
  it("rounds score.overallScore, score.coverage.coveragePercent, domain score/coveragePercent, and releaseEvaluation.controlCoverage to 2 decimals", () => {
    const unroundedScore: ScoreForReport = {
      overallScore: 66.66666666666667,
      coverage: { applicableControls: 3, assessedControls: 2, coveragePercent: 66.66666666666667 },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
      domainScores: [{
        domain: "appsec", score: 33.33333333333333, totalControls: 3, applicableControls: 3, assessedControls: 1,
        coveragePercent: 33.33333333333333, passCount: 1, failCount: 1, partialCount: 0, notTestedCount: 1,
        notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0,
      }],
    };
    const unroundedRelease: ReleaseEvaluation = { ...releaseEvaluation, controlCoverage: 66.66666666666667 };
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score: unroundedScore, findings: [], releaseEvaluation: unroundedRelease, summary: "ok",
    });
    expect(report.score.overallScore).toBe(66.67);
    expect(report.score.coverage.coveragePercent).toBe(66.67);
    expect(report.score.domainScores[0].score).toBe(33.33);
    expect(report.score.domainScores[0].coveragePercent).toBe(33.33);
    expect(report.releaseEvaluation.controlCoverage).toBe(66.67);
  });

  it("rounding the report's displayed coverage does not change what the gate decided — a synthetic just-under-threshold score stays non-approved even though its rounded display reads 80.0", () => {
    const justUnder: ScoreForReport = { ...score, coverage: { ...score.coverage, coveragePercent: 79.996 } };
    const blockedRelease: ReleaseEvaluation = { ...releaseEvaluation, controlCoverage: 79.996, result: "indeterminate" };
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score: justUnder, findings: [], releaseEvaluation: blockedRelease, summary: "ok",
    });
    expect(report.score.coverage.coveragePercent).toBe(80);
    expect(report.releaseEvaluation.result).toBe("indeterminate");
  });
});

describe("buildReport — provenance fields copied verbatim from the run", () => {
  const target = { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false };
  const profileSnapshot = { securityLevel: "SVL-2", exposure: ["internet_public"] };

  it("copies target/profileSnapshot/engineVersionAtRunStart from the run when present", () => {
    const report = buildReport({
      reportId: "REP-1",
      run: { ...run, target, profileSnapshot, engineVersionAtRunStart: "0.9.0" },
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.target).toEqual(target);
    expect(report.profileSnapshot).toEqual(profileSnapshot);
    expect(report.engineVersionAtRunStart).toBe("0.9.0");
  });

  it("defaults all three to null when the run has them as null or entirely absent (legacy run)", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.target).toBeNull();
    expect(report.profileSnapshot).toBeNull();
    expect(report.engineVersionAtRunStart).toBeNull();
  });
});

describe("buildReport — reportSchemaVersion and dropped fields", () => {
  it("stamps reportSchemaVersion 2.0.0 on every generated report", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.reportSchemaVersion).toBe("2.0.0");
  });

  it("drops unblockedCriticalAttackPaths/incidentResponseVerified/backupRestoreVerified from the report's releaseEvaluation", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect("unblockedCriticalAttackPaths" in report.releaseEvaluation).toBe(false);
    expect("incidentResponseVerified" in report.releaseEvaluation).toBe(false);
    expect("backupRestoreVerified" in report.releaseEvaluation).toBe(false);
  });
});
```

Update the module-level `score`/`releaseEvaluation`/`run` fixtures to match the final shapes these tests assume: `score.domainScores` stays `[]` (unaffected), `releaseEvaluation` keeps its Task 2 shape for now (the dropped-fields test above constructs its own expectations against the real `buildReport` output, not the fixture, so no fixture change is required here beyond what Task 2 already did).

- [ ] **Step 6: Run to verify these fail**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: FAIL — `roundReportNumber` doesn't exist yet; `report.score.overallScore` is unrounded; `report.target`/`profileSnapshot`/`engineVersionAtRunStart`/`reportSchemaVersion` are all `undefined`; `report.releaseEvaluation` still has the three fields this step wants dropped.

- [ ] **Step 7: Implement `roundReportNumber`, the provenance copy-through, `reportSchemaVersion`, and the three-field drop**

In `src/core/report-builder.ts`, add near the top of the file (after the type definitions, before `sortPrioritizedFindings` or after it — either position is fine, group it with the other exported helpers):

```ts
export const REPORT_SCHEMA_VERSION = "2.0.0";

export function roundReportNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`roundReportNumber: non-finite value ${value} cannot be serialized into a ProjectReport`);
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}
```

Add the `import type { Target } from "./repository.js";`, `import type { ProjectProfile } from "./applicability.js";`, and `import type { ReleaseEvaluation } from "./release-evaluator.js";` lines at the top of the file (check first whether any are already imported from Task 1/2's changes before adding a duplicate).

**Why `ReleaseEvaluation` (the core, un-narrowed type) needs importing here:** `ReportService.generate` always passes the real value `evaluateRelease()` returned — the full core `ReleaseEvaluation`, which (per Task 2) still carries `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` — not a value already narrowed to `ReleaseEvaluationForReport`. If `buildReport`'s `releaseEvaluation` input parameter were typed as the narrowed `ReleaseEvaluationForReport`, that would be dishonest about what's actually passed at runtime, and — critically — TypeScript's excess-property checking does **not** apply to object-spread expressions. A construction like `{ ...input.releaseEvaluation, controlCoverage: x }` assigned to a `ReleaseEvaluationForReport`-typed `const` would compile cleanly even though the spread silently carries all 3 "removed" fields through into the real runtime object, which then serializes into the actual JSON — completely defeating §3.4/§3.5's removal. Typing the input parameter as the honest, wider `ReleaseEvaluation` and then building the output via **explicit field-by-field projection** (never a spread) is what actually guarantees the 3 fields are dropped.

Widen `ScoreForReport`'s `domainScores` from `unknown[]` to a real type, since rounding needs to touch each domain's `score`/`coveragePercent`. Change:

```ts
export interface ScoreForReport {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: unknown[];
}
```

to:

```ts
export interface DomainScoreForReport {
  domain: string;
  score: number;
  totalControls: number;
  applicableControls: number;
  assessedControls: number;
  coveragePercent: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  notTestedCount: number;
  notApplicableCount: number;
  acceptedRiskCount: number;
  criticalSeverityFindings: number;
  highSeverityFindings: number;
}

export interface ScoreForReport {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: DomainScoreForReport[];
}
```

(`src/core/score.ts`'s `calculateScore` already returns exactly this shape after Task 2's rename — `Score.domainScores: DomainScore[]` is structurally identical to `DomainScoreForReport[]`, so `report-service.ts`'s existing `score, findings, releaseEvaluation, summary: input.summary` pass-through to `buildReport` needs no change here.)

Change `ReleaseEvaluationForReport` to drop the three fields:

```ts
export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  confirmedCriticalVulnerabilities: number;
  confirmedHighVulnerabilities: number;
  residualRisksAccepted: number;
  blockingControlFailures: string[];
  blockingControlsNotVerified: string[];
  result: "approved" | "blocked" | "indeterminate";
}
```

Add `target`, `profileSnapshot`, `engineVersionAtRunStart`, `reportSchemaVersion` to `ProjectReport`:

```ts
export interface ProjectReport {
  reportId: string;
  projectId: string;
  assessmentRunId: string;
  catalogVersion: string;
  profileRevision: number;
  criticalityFormula: { id: string; version: string };
  generatedAt: string;
  score: ScoreForReport;
  prioritizedFindings: PrioritizedFindingInput[];
  projectFindingSnapshots: FindingSnapshot[];
  releaseEvaluation: ReleaseEvaluationForReport;
  target: Target | null;
  profileSnapshot: ProjectProfile | null;
  engineVersionAtRunStart: string | null;
  reportSchemaVersion: string;
  summary: string;
}
```

Change `buildReport`'s input type's `run` field and body. The full function becomes:

```ts
export function buildReport(input: {
  reportId: string;
  run: {
    runId: string;
    projectId: string;
    catalogVersion: string;
    profileRevision: number;
    target?: Target | null;
    profileSnapshot?: ProjectProfile | null;
    engineVersionAtRunStart?: string | null;
  };
  criticalityFormula: { id: string; version: string };
  generatedAt: () => string;
  score: ScoreForReport;
  findings: FindingForReport[];
  releaseEvaluation: ReleaseEvaluation;
  summary: string;
}): ProjectReport {
  const actionable = input.findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const projected: PrioritizedFindingInput[] = actionable.map((f) => ({
    findingId: f.findingId,
    priorityIndex: f.priority.index,
    criticalityIndex: f.criticality.index,
    title: f.title,
  }));

  const roundedScore: ScoreForReport = {
    ...input.score,
    overallScore: roundReportNumber(input.score.overallScore),
    coverage: { ...input.score.coverage, coveragePercent: roundReportNumber(input.score.coverage.coveragePercent) },
    domainScores: input.score.domainScores.map((d) => ({
      ...d,
      score: roundReportNumber(d.score),
      coveragePercent: roundReportNumber(d.coveragePercent),
    })),
  };
  // Explicit field-by-field projection — deliberately NOT a spread. input.releaseEvaluation is the
  // full core ReleaseEvaluation (it always still carries unblockedCriticalAttackPaths/
  // incidentResponseVerified/backupRestoreVerified, per Task 2/§3.4/§3.5); a spread would silently
  // carry those 3 fields through into the real JSON despite ReleaseEvaluationForReport's type no
  // longer declaring them, since TypeScript's excess-property checking does not apply to spreads.
  // Naming every field explicitly is what actually drops them.
  const roundedReleaseEvaluation: ReleaseEvaluationForReport = {
    gate: input.releaseEvaluation.gate,
    controlCoverage: roundReportNumber(input.releaseEvaluation.controlCoverage),
    confirmedCriticalVulnerabilities: input.releaseEvaluation.confirmedCriticalVulnerabilities,
    confirmedHighVulnerabilities: input.releaseEvaluation.confirmedHighVulnerabilities,
    residualRisksAccepted: input.releaseEvaluation.residualRisksAccepted,
    blockingControlFailures: input.releaseEvaluation.blockingControlFailures,
    blockingControlsNotVerified: input.releaseEvaluation.blockingControlsNotVerified,
    result: input.releaseEvaluation.result,
  };

  return {
    reportId: input.reportId,
    projectId: input.run.projectId,
    assessmentRunId: input.run.runId,
    catalogVersion: input.run.catalogVersion,
    profileRevision: input.run.profileRevision,
    criticalityFormula: input.criticalityFormula,
    generatedAt: input.generatedAt(),
    score: roundedScore,
    prioritizedFindings: sortPrioritizedFindings(projected),
    projectFindingSnapshots: buildProjectFindingSnapshots(input.findings),
    releaseEvaluation: roundedReleaseEvaluation,
    target: input.run.target ?? null,
    profileSnapshot: input.run.profileSnapshot ?? null,
    engineVersionAtRunStart: input.run.engineVersionAtRunStart ?? null,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    summary: input.summary,
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 9: Update `ProjectReport`'s round-trip fixture in `tests/core/repository.test.ts` for the final shape**

In `tests/core/repository.test.ts`'s `"saveReport then reload round-trips the ProjectReport"` test, change the whole `report` object to include the new fields and drop the three removed ones:

```ts
  it("saveReport then reload round-trips the ProjectReport", async () => {
    const report = {
      reportId: "REP-1", projectId: "PRJ-1", assessmentRunId: "RUN-1", catalogVersion: "1.0.0", profileRevision: 1,
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" }, generatedAt: "2026-09-28T00:00:00.000Z",
      score: { overallScore: 80, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "M", version: "1" }, domainScores: [] },
      prioritizedFindings: [], projectFindingSnapshots: [],
      releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" as const },
      target: null, profileSnapshot: null, engineVersionAtRunStart: null, reportSchemaVersion: "2.0.0",
      summary: "ok",
    } satisfies ProjectReport;
    await repo.saveReport(report);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "reports", "REP-1.json")));
    expect(reloaded).toEqual(report);
  });
```

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS.

- [ ] **Step 10: Write the failing test for `ReportService.generate`'s single-findings-fetch and provenance pass-through**

In `tests/service/report-service.test.ts`, add a call-counting wrapper and new tests after the existing `describe("ReportService.generate", ...)` block:

```ts
class CountingRepository extends FakeRepository {
  getFindingsCallCount = 0;
  override async getFindings(projectId: string) {
    this.getFindingsCallCount++;
    return super.getFindings(projectId);
  }
}

describe("ReportService.generate — single findings fetch and provenance pass-through", () => {
  it("fetches findings exactly once per generate() call", async () => {
    const repo = new CountingRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW);
    await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(repo.getFindingsCallCount).toBe(1);
  });

  it("copies target/profileSnapshot/engineVersionAtRunStart from the run onto the generated report", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const target = { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false };
    const run = await repo.getRun("PRJ-1", "RUN-1");
    await repo.saveRun({ ...run, target, profileSnapshot: { securityLevel: "SVL-3", exposure: [] }, engineVersionAtRunStart: "0.9.0" });
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.target).toEqual(target);
    expect(report.profileSnapshot).toEqual({ securityLevel: "SVL-3", exposure: [] });
    expect(report.engineVersionAtRunStart).toBe("0.9.0");
  });

  it("a report generated from a run with target/profileSnapshot/engineVersionAtRunStart absent carries them forward as null (legacy run)", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.target).toBeNull();
    expect(report.profileSnapshot).toBeNull();
    expect(report.engineVersionAtRunStart).toBeNull();
  });
});

describe("ReportService.generate — projectFindingSnapshots is project-scoped, not run-scoped", () => {
  it("a report generated from an earlier run still includes findings associated with a later run on the same project", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo); // creates RUN-1
    await repo.saveRun({
      runId: "RUN-2", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: NOW, completedAt: null,
    });
    await repo.saveFinding("PRJ-1", {
      findingId: "FND-001", title: "Found under RUN-2's assessment work", type: "control_gap",
      controlIds: [], status: "open", severity: "low",
      priority: { index: 5, source: "agent", rationale: "x", assignedBy: "x", assignedAt: NOW },
      criticality: { index: 1, formulaId: "CRIT-DEFAULT", formulaVersion: "1.0.0", computedAt: NOW },
    });
    const service = new ReportService(repo, () => NOW);
    const reportForEarlierRun = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(reportForEarlierRun.projectFindingSnapshots.map((f) => f.findingId)).toContain("FND-001");
  });
});
```

- [ ] **Step 11: Run to verify these fail**

Run: `npx vitest run tests/service/report-service.test.ts`
Expected: FAIL — `report.target`/`profileSnapshot`/`engineVersionAtRunStart` are `undefined` because `report-service.ts` doesn't pass them to `buildReport` yet (the single-findings-fetch test should already PASS, since the existing code already fetches `findings` once and reuses it — this confirms that invariant was already satisfied before this task, not newly introduced; the `projectFindingSnapshots` project-scoping test should also already PASS once Step 1-9's `buildReport` changes landed, since `getFindings` is inherently project-scoped already).

- [ ] **Step 12: Wire `ReportService.generate` to pass `target`/`profileSnapshot`/`engineVersionAtRunStart` through**

In `src/service/report-service.ts`, change the `buildReport` call from:

```ts
    const report = buildReport({
      reportId: generateUuid(),
      run: { runId: run.runId, projectId: run.projectId, catalogVersion: run.catalogVersion, profileRevision: run.profileRevision },
      criticalityFormula: { id: criticalityFormula.formulaId, version: criticalityFormula.version },
      generatedAt: this.now,
      score, findings, releaseEvaluation, summary: input.summary,
    });
```

to:

```ts
    const report = buildReport({
      reportId: generateUuid(),
      run: {
        runId: run.runId, projectId: run.projectId, catalogVersion: run.catalogVersion, profileRevision: run.profileRevision,
        target: run.target ?? null, profileSnapshot: run.profileSnapshot ?? null, engineVersionAtRunStart: run.engineVersionAtRunStart ?? null,
      },
      criticalityFormula: { id: criticalityFormula.formulaId, version: criticalityFormula.version },
      generatedAt: this.now,
      score, findings, releaseEvaluation, summary: input.summary,
    });
```

(No other change is needed in this file — `findings` is already fetched exactly once via the existing `Promise.all([this.repository.getControlAssessments(...), this.repository.getFindings(...), this.repository.getControls()])` call and reused for `normalizedFindingsForScore`, `normalizedFindingsForRelease`, and this `buildReport` call. The `releaseEvaluation` variable passed here is already declared `let releaseEvaluation: ReleaseEvaluation;` in this file's existing code — `buildReport`'s widened input type from Step 7 above matches what this call site already passes with no further edit needed here.)

- [ ] **Step 13: Run to verify it passes**

Run: `npx vitest run tests/service/report-service.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 14: Write the failing old-report-compatibility (hash-preservation) test, exercised through the real `ReportService.generate()` path**

The spec's acceptance criterion is specifically "a new report generated through the **normal generation path** doesn't touch an existing legacy report" — a test that calls `repo.saveReport(newReport)` directly only proves `saveReport` itself doesn't collide on filenames (true by construction, since it always writes to `reports/<reportId>.json`), not that `ReportService.generate()` as a whole never reads or rewrites existing reports. This test must go through `ReportService.generate()` for real.

Add this `describe` block to `tests/core/repository.test.ts`. It needs a real, generatable project (controls, a run, assessments for every `RELEASE_BLOCKING_CONTROLS` entry) backed by a `JsonRepository` whose project-instance tree is a temp directory but whose catalog/core reads (`getControls`, `getScoreModel`, `getCriticalityFormula`, `getCatalogVersion`) come from the real `data/` tree — the same `mixedRepository`-style split already established in `tests/integration/full-workflow.test.ts`:

```ts
import { ReportService } from "../../src/service/report-service.js";
import { RELEASE_BLOCKING_CONTROLS } from "../../src/core/release-evaluator.js";

function mixedRepository(projectRepo: JsonRepository, catalogRepo: JsonRepository): SecurityRepository {
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
    getRiskAcceptances: projectRepo.getRiskAcceptances.bind(projectRepo),
    getRun: projectRepo.getRun.bind(projectRepo),
    saveRun: projectRepo.saveRun.bind(projectRepo),
    saveBatch: projectRepo.saveBatch.bind(projectRepo),
    saveReport: projectRepo.saveReport.bind(projectRepo),
    savePlan: projectRepo.savePlan.bind(projectRepo),
    saveProject: projectRepo.saveProject.bind(projectRepo),
    saveControlAssessment: projectRepo.saveControlAssessment.bind(projectRepo),
    saveFinding: projectRepo.saveFinding.bind(projectRepo),
    saveEvidence: projectRepo.saveEvidence.bind(projectRepo),
    saveRiskAcceptance: projectRepo.saveRiskAcceptance.bind(projectRepo),
  };
}

describe("JsonRepository — old ProjectReport files are never touched by ReportService.generate()'s normal path", () => {
  const NOW = "2026-10-06T00:00:00.000Z";
  let dir: string;
  let repo: JsonRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csi-mcp-repo-"));
    repo = new JsonRepository(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a legacy-shaped report on disk is byte-for-byte unchanged after ReportService.generate() creates a new report for the same project", async () => {
    const legacyReportPath = join(dir, "projects", "PRJ-1", "reports", "REP-LEGACY.json");
    mkdirSync(join(dir, "projects", "PRJ-1", "reports"), { recursive: true });
    const legacyReport = {
      reportId: "REP-LEGACY", projectId: "PRJ-1", assessmentRunId: "RUN-OLD", catalogVersion: "1.0.0", profileRevision: 1,
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" }, generatedAt: "2026-08-01T00:00:00.000Z",
      score: { overallScore: 90, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "M", version: "1" }, domainScores: [] },
      prioritizedFindings: [],
      releaseEvaluation: { gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
      summary: "a pre-2.0.0 report with the old field names and no reportSchemaVersion at all",
    };
    writeFileSync(legacyReportPath, JSON.stringify(legacyReport, null, 2));
    const before = readFileSyncUtf8(legacyReportPath);

    const realCatalog = new JsonRepository("data");
    const mixed = mixedRepository(repo, realCatalog);
    await repo.saveProject({
      projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision: 1,
      profile: { securityLevel: "SVL-3", exposure: ["internet_public"], features: {}, technologies: {} },
    });
    await repo.saveRun({
      runId: "RUN-NEW", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: (await realCatalog.getCatalogVersion()), batchIds: [], status: "running", startedAt: NOW, completedAt: null,
    });
    const blockingControls = [...RELEASE_BLOCKING_CONTROLS];
    for (let i = 0; i < blockingControls.length; i++) {
      await repo.saveControlAssessment({
        assessmentId: `A-${i + 1}`, projectId: "PRJ-1", controlId: blockingControls[i], controlVersion: 1,
        runId: "RUN-NEW", profileRevision: 1,
        applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
        status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
      });
    }
    const reportService = new ReportService(mixed, () => NOW);
    const newReport = await reportService.generate({ projectId: "PRJ-1", runId: "RUN-NEW", summary: "a fresh 2.0.0 report for the same project" });

    const after = readFileSyncUtf8(legacyReportPath);
    expect(after).toBe(before);
    expect(newReport.reportSchemaVersion).toBe("2.0.0");
    const newReportOnDisk = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "reports", `${newReport.reportId}.json`)));
    expect(newReportOnDisk.reportSchemaVersion).toBe("2.0.0");
  });
});
```

- [ ] **Step 15: Run to verify it passes**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS. `ReportService.generate()` only ever calls `saveReport`, which only ever writes `reports/<reportId>.json` for the `reportId` it generates — a pre-existing, differently-named legacy report file is never read or touched anywhere along that path. This test should pass on the first try; its purpose is to pin the invariant with a direct, concrete, full-path assertion, not to drive new implementation work.

- [ ] **Step 16: Update `project-report-schema.json` for the final shape, write the failing schema tests**

In `data/schemas/project-report-schema.json`:

1. Add a `projectFindingSnapshots` property (place it after `prioritizedFindings`):

```json
    "projectFindingSnapshots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "findingId": { "type": "string", "minLength": 1 },
          "title": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "enum": ["confirmed_vulnerability", "likely_vulnerability", "control_gap", "hardening", "process_gap", "accepted_design", "needs_validation"] },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "informational"] },
          "controlIds": { "type": "array", "items": { "type": "string", "minLength": 1 } },
          "status": { "type": "string", "enum": ["open", "in_progress", "resolved", "accepted", "false_positive"] },
          "priorityIndex": { "type": "integer", "minimum": 0, "maximum": 9 },
          "criticalityIndex": { "type": "integer", "minimum": 0, "maximum": 9 },
          "attackScenario": { "type": "string", "minLength": 1 },
          "exploitabilityEvidence": { "type": "string", "minLength": 1 }
        },
        "required": ["findingId", "title", "type", "severity", "controlIds", "status", "priorityIndex", "criticalityIndex"],
        "additionalProperties": false
      }
    },
```

2. In the embedded `releaseEvaluation` object, remove the `unblockedCriticalAttackPaths`, `incidentResponseVerified`, `backupRestoreVerified` properties and their `required` entries (the rename from Task 2, `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`, stays as-is):

```json
    "releaseEvaluation": {
      "type": "object",
      "properties": {
        "gate": { "type": "integer", "minimum": 0, "maximum": 4 },
        "controlCoverage": { "type": "number", "minimum": 0, "maximum": 100 },
        "confirmedCriticalVulnerabilities": { "type": "integer", "minimum": 0 },
        "confirmedHighVulnerabilities": { "type": "integer", "minimum": 0 },
        "residualRisksAccepted": { "type": "integer", "minimum": 0 },
        "blockingControlFailures": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "blockingControlsNotVerified": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "result": { "type": "string", "enum": ["approved", "blocked", "indeterminate"] }
      },
      "required": ["gate", "controlCoverage", "confirmedCriticalVulnerabilities", "confirmedHighVulnerabilities", "residualRisksAccepted", "blockingControlFailures", "blockingControlsNotVerified", "result"],
      "additionalProperties": false
    },
```

3. Add `target`, `profileSnapshot`, `engineVersionAtRunStart`, `reportSchemaVersion` properties (place them after `releaseEvaluation`, before `summary`):

```json
    "target": {
      "description": "Caller-asserted assessment target provenance, declared at start_assessment_run time; not independently verified by this server.",
      "type": ["object", "null"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "commitSha": { "type": ["string", "null"] },
        "branchOrTag": { "type": ["string", "null"] },
        "dirty": { "type": ["boolean", "null"] }
      },
      "required": ["repository", "commitSha", "branchOrTag", "dirty"],
      "additionalProperties": false
    },
    "profileSnapshot": { "type": ["object", "null"] },
    "engineVersionAtRunStart": { "type": ["string", "null"] },
    "reportSchemaVersion": { "const": "2.0.0" },
```

4. Add `projectFindingSnapshots`, `target`, `profileSnapshot`, `engineVersionAtRunStart`, `reportSchemaVersion` to the top-level `required` array:

```json
  "required": [
    "reportId", "projectId", "assessmentRunId", "catalogVersion", "profileRevision", "criticalityFormula",
    "generatedAt", "score", "prioritizedFindings", "projectFindingSnapshots", "releaseEvaluation",
    "target", "profileSnapshot", "engineVersionAtRunStart", "reportSchemaVersion", "summary"
  ],
```

Update `tests/schemas/project-report-schema.test.ts`'s `valid` fixture to the new shape — add `projectFindingSnapshots: []`, remove `unblockedCriticalAttackPaths`/`incidentResponseVerified`/`backupRestoreVerified` from `releaseEvaluation`, add `target: null, profileSnapshot: null, engineVersionAtRunStart: null, reportSchemaVersion: "2.0.0"` at the top level. Add these new tests at the end of the file:

```ts
  it("accepts a report with a populated projectFindingSnapshots entry", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const withSnapshot = {
      ...valid,
      projectFindingSnapshots: [{
        findingId: "FND-001", title: "x", type: "confirmed_vulnerability", severity: "critical",
        controlIds: ["IAM-AUTHZ-001"], status: "open", priorityIndex: 0, criticalityIndex: 9,
      }],
    };
    expect(validate(withSnapshot), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a report with unblockedCriticalAttackPaths present (dropped field)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const withDropped = { ...valid, releaseEvaluation: { ...valid.releaseEvaluation, unblockedCriticalAttackPaths: 0 } };
    expect(validate(withDropped)).toBe(false);
  });

  it("rejects a report missing reportSchemaVersion", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const { reportSchemaVersion, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a report with any reportSchemaVersion other than the current '2.0.0'", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    expect(validate({ ...valid, reportSchemaVersion: "1.0.0" })).toBe(false);
  });

  it("accepts target/profileSnapshot/engineVersionAtRunStart as null", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    expect(validate({ ...valid, target: null, profileSnapshot: null, engineVersionAtRunStart: null }), JSON.stringify(validate.errors)).toBe(true);
  });
```

- [ ] **Step 17: Run to verify the new tests fail appropriately, then pass**

Run: `npx vitest run tests/schemas/project-report-schema.test.ts`
Expected: with the fixture updated but before the schema edits, several tests fail (missing `projectFindingSnapshots` in `required`, dropped fields still accepted). After applying the Step 16 schema edits, run again:

Run: `npx vitest run tests/schemas/project-report-schema.test.ts`
Expected: PASS, every test.

- [ ] **Step 18: Update `tests/schema-drift.test.ts`'s `releaseEvaluation` drift assertion to account for the 3 intentionally-excluded fields**

The existing drift test asserts `ProjectReport.releaseEvaluation` matches `release-evaluation-schema.json` **exactly** (minus `projectId`/`evaluatedAt`) — but Task 3 deliberately breaks that exact match by dropping 3 fields from the report-embedded copy only, while core `release-evaluation-schema.json` keeps all three (per spec §3.4/§3.5, core stays untouched). Change the test from:

```ts
  it("ProjectReport.releaseEvaluation matches release-evaluation-schema.json (minus projectId and evaluatedAt)", () => {
    const reportSchema = loadJson<{ properties: { releaseEvaluation: JsonSchemaObject } }>(
      "data/schemas/project-report-schema.json"
    );
    const releaseSchema = loadJson<JsonSchemaObject>("data/schemas/release-evaluation-schema.json");
    const embedded = reportSchema.properties.releaseEvaluation;

    const { projectId, evaluatedAt, ...standaloneProps } = releaseSchema.properties ?? {};
    expect(embedded.properties).toEqual(standaloneProps);

    const standaloneRequired = (releaseSchema.required ?? []).filter(
      (k) => k !== "projectId" && k !== "evaluatedAt"
    );
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });
```

to:

```ts
  it("ProjectReport.releaseEvaluation matches release-evaluation-schema.json minus projectId/evaluatedAt and minus the 3 fields report-fidelity intentionally excludes from the report (unblockedCriticalAttackPaths, incidentResponseVerified, backupRestoreVerified — see docs/superpowers/specs/2026-10-06-report-fidelity-design.md §3.4/§3.5)", () => {
    const reportSchema = loadJson<{ properties: { releaseEvaluation: JsonSchemaObject } }>(
      "data/schemas/project-report-schema.json"
    );
    const releaseSchema = loadJson<JsonSchemaObject>("data/schemas/release-evaluation-schema.json");
    const embedded = reportSchema.properties.releaseEvaluation;

    const EXCLUDED_FROM_REPORT = ["unblockedCriticalAttackPaths", "incidentResponseVerified", "backupRestoreVerified"];
    const { projectId, evaluatedAt, ...standaloneProps } = releaseSchema.properties ?? {};
    const expectedProps = Object.fromEntries(
      Object.entries(standaloneProps).filter(([key]) => !EXCLUDED_FROM_REPORT.includes(key))
    );
    expect(embedded.properties).toEqual(expectedProps);

    const standaloneRequired = (releaseSchema.required ?? []).filter(
      (k) => k !== "projectId" && k !== "evaluatedAt" && !EXCLUDED_FROM_REPORT.includes(k)
    );
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });
```

(The `score` drift test and the `AssessmentPlan`/`AssessmentBatch` drift test are untouched — only `releaseEvaluation`'s drift check needs this exclusion list, since `score`'s embedded copy stays an exact mirror of `score-schema.json` throughout this plan.)

- [ ] **Step 19: Run to verify it passes**

Run: `npx vitest run tests/schema-drift.test.ts`
Expected: PASS, every test.

(`package.json`'s version bump and `server.ts`'s `engineVersionAtRunStart` wiring already landed in Task 1 Step 12 — Task 1 introduced the required constructor parameter, so it also wired the one real production construction site in the same commit. Nothing left to do here.)

- [ ] **Step 20: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, every test file.

- [ ] **Step 21: Commit**

```bash
git add src/core/report-builder.ts src/service/report-service.ts \
  data/schemas/project-report-schema.json \
  tests/core/report-builder.test.ts tests/service/report-service.test.ts tests/core/repository.test.ts \
  tests/schemas/project-report-schema.test.ts tests/schema-drift.test.ts
git commit -m "feat(core,service): ProjectReport gains projectFindingSnapshots, provenance, rounding, reportSchemaVersion

ProjectReport is now a self-contained, externally-legible artifact:
projectFindingSnapshots carries every finding's full record (type,
severity, controlIds, attackScenario, exploitabilityEvidence) sorted
deterministically by findingId; target/profileSnapshot/
engineVersionAtRunStart are copied verbatim from the AssessmentRun that
produced the report, never re-read from current state;
unblockedCriticalAttackPaths/incidentResponseVerified/
backupRestoreVerified are dropped from the report only (core
ReleaseEvaluation keeps all three unchanged); a new roundReportNumber
helper rounds display numbers to 2 decimals at the report-serialization
boundary only, never before a gate-threshold comparison; reportSchemaVersion
'2.0.0' marks the new shape, with old on-disk reports left permanently
untouched.

See docs/superpowers/specs/2026-10-06-report-fidelity-design.md"
```

---

## Post-Plan Note

After all three tasks land and the final whole-branch review passes, the 8 real open-source validation projects' `ProjectReport`s should be regenerated against the new `reportSchemaVersion: "2.0.0"` shape — this requires starting fresh `AssessmentRun`s for each (existing runs predate `target`/`profileSnapshot`/`engineVersionAtRunStart` and will produce reports with those three fields `null`, which is correct and honest, but a fully-populated demonstration report benefits from a fresh run declaring `target`). This regeneration is tracked as a separate follow-up step in the project's standing pipeline instruction, not a task in this plan.
