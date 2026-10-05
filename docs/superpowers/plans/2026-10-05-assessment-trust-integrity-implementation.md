# Assessment Trust & Validity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a stored `ControlAssessment`'s status mean what it claims for as long as it's trusted, not just at the moment it was recorded — by wiring up the long-dormant `RiskAcceptance` entity with real record-time and release-time validation, closing the evidence-free `N/A` bypass, and detecting (and acting on) assessments that have gone stale relative to the project's current profile.

**Architecture:** Three closely related fixes to the write path (`AssessmentService.recordAssessment`) and read path (`AnalysisService.evaluateRelease`) of `ControlAssessment`. `src/core/release-evaluator.ts` and `src/core/score.ts` are not modified — all trust/validity translation happens in the service layer, which builds a translated assessments array once and feeds it to both the core release-gate function and `score.ts`'s `calculateScore`, so the Coverage Gate and Control Gate always see the same freshness-aware view in a single `evaluateRelease` call.

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema draft 2020-12), Zod (MCP tool input validation) — same stack as the rest of this repo.

**Spec:** `docs/superpowers/specs/2026-10-05-assessment-trust-integrity-design.md`

## Global Constraints

- `isRiskAcceptanceEffectivelyValid(ra, nowIso)`: `ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt` — all three conditions checked independently, never just `status` alone.
- `src/core/release-evaluator.ts` and `src/core/score.ts`: **zero changes** to either file's exported signatures or internal logic. All staleness/validity translation lives in `src/service/analysis-service.ts` and the new `src/core/risk-acceptance.ts`.
- `ControlAssessment` gains exactly two new required fields: `runId: string`, `profileRevision: number`. Both are captured from the run object `recordAssessment` already fetches at write time — never a fresh project read.
- `RiskAcceptance` (schema already exists from Phase 1) gains exactly two new fields beyond what's already there: `revokedAt: string | null`, `revokedReason: string | null` — both required (always present, nullable), matching this codebase's existing convention for always-present-but-nullable fields.
- The `now` value inside `AnalysisService.evaluateRelease` is captured exactly once per call and reused for every `RiskAcceptance` validity check in that same call.
- `revoke_risk_acceptance` is idempotent on an already-`"revoked"` record: returns the existing record unchanged, not an error.
- The migration script is one-time and standalone — not wired into `npm test`, `npm run build`, or the MCP server's runtime.
- `RiskAcceptance` scope is profile-revision-independent: once approved, it holds until `expiresAt` (or revocation) regardless of profile changes in between — no new field encodes this, it's a property of how the validity check works (§3.3 of the spec).

---

### Task 1: RiskAcceptance entity — schema, repository, pure validity helper, two MCP tools

**Files:**
- Modify: `data/schemas/risk-acceptance-schema.json`
- Modify: `src/core/repository.ts`
- Create: `src/core/risk-acceptance.ts`
- Create: `src/service/risk-acceptance-service.ts`
- Create: `src/mcp/tools/record-risk-acceptance.ts`
- Create: `src/mcp/tools/revoke-risk-acceptance.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/service/fake-repository.ts`
- Test: `tests/core/risk-acceptance.test.ts` (new)
- Test: `tests/service/risk-acceptance-service.test.ts` (new)
- Test: `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`
- Test: `tests/core/repository.test.ts`
- Test: `tests/mcp/tools/risk-acceptance-tools.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks (this is the foundational task).
- Produces (for Tasks 2 and 3):
  - `export interface RiskAcceptance` in `src/core/repository.ts`: `{ riskAcceptanceId: string; projectId: string; controlId: string; findingIds: string[]; reason: string; compensatingControls: string[]; approvedBy: string; approvedAt: string; expiresAt: string; reviewDate: string | null; status: "active" | "expired" | "revoked"; revokedAt: string | null; revokedReason: string | null }`.
  - `SecurityRepository.getRiskAcceptances(projectId: string): Promise<RiskAcceptance[]>` and `SecurityRepository.saveRiskAcceptance(projectId: string, ra: RiskAcceptance): Promise<void>` (upsert by `riskAcceptanceId`).
  - `export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean` from `src/core/risk-acceptance.ts` — **Task 3 also adds a second export, `translateAssessmentsForTrust`, to this same file** (not written in this task, since it needs `ControlAssessment.profileRevision` from Task 2 first — see Task 3 Step 1).
  - `RiskAcceptanceService` (`src/service/risk-acceptance-service.ts`) with `record(input): Promise<RiskAcceptance>` and `revoke(input): Promise<RiskAcceptance>`.
  - MCP tools `record_risk_acceptance` and `revoke_risk_acceptance`, registered in `buildServer()`.

- [ ] **Step 1: Add `revokedAt`/`revokedReason` to the risk-acceptance schema, write the failing schema test**

In `data/schemas/risk-acceptance-schema.json`, change:

```json
    "reviewDate": { "type": ["string", "null"], "format": "date-time" },
    "status": { "type": "string", "enum": ["active", "expired", "revoked"] }
  },
  "required": ["riskAcceptanceId", "projectId", "controlId", "reason", "approvedBy", "approvedAt", "expiresAt", "status"],
```

to:

```json
    "reviewDate": { "type": ["string", "null"], "format": "date-time" },
    "status": { "type": "string", "enum": ["active", "expired", "revoked"] },
    "revokedAt": { "type": ["string", "null"], "format": "date-time" },
    "revokedReason": { "type": ["string", "null"], "minLength": 1 }
  },
  "required": [
    "riskAcceptanceId", "projectId", "controlId", "reason", "approvedBy", "approvedAt", "expiresAt",
    "status", "revokedAt", "revokedReason"
  ],
```

(`revokedReason`'s type allows `null` but, when it's a string, disallows empty — a revoke always needs a real reason, but an un-revoked record's `revokedReason` is `null`, not an empty string.)

In `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`, update the `valid` fixture in the `describe("risk-acceptance-schema", ...)` block:

```ts
  const valid = {
    riskAcceptanceId: "RA-001",
    projectId: "proj-001",
    controlId: "IAM-AUTH-005",
    findingIds: ["FND-004"],
    reason: "Compensating network-level control mitigates this in the short term.",
    compensatingControls: ["NET-ADMIN-003"],
    approvedBy: "ciso@example.com",
    approvedAt: "2026-09-16T05:00:00Z",
    expiresAt: "2026-12-16T05:00:00Z",
    status: "active",
    revokedAt: null,
    revokedReason: null,
  };
```

Add one new test in the same `describe` block:

```ts
  it("rejects a risk acceptance missing revokedAt", () => {
    const validate = compileSchemaFromFile("data/schemas/risk-acceptance-schema.json");
    const { revokedAt, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
```

- [ ] **Step 2: Run to verify current state**

Run: `npx vitest run tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`
Expected: the pre-existing 2 tests in `describe("risk-acceptance-schema", ...)` still PASS (the fixture change is additive and the schema change is backward-compatible with `additionalProperties: false`'s absence of the two new props being now required — wait: since the two new fields are now `required`, the *old* fixture without them would fail; you already updated the fixture in Step 1, so this run should show all 3 tests in that `describe` block passing). The new "rejects a risk acceptance missing revokedAt" test should PASS immediately since it's just confirming the `required` array addition — if it fails, the schema edit in Step 1 has a mistake.

- [ ] **Step 3: Add `RiskAcceptance` to `src/core/repository.ts`, write the failing repository test**

Add this interface to `src/core/repository.ts`, near `ControlAssessment` (same file, same style):

```ts
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
```

Add two methods to the `SecurityRepository` interface (after `saveControlAssessment`):

```ts
  getRiskAcceptances(projectId: string): Promise<RiskAcceptance[]>;
  saveRiskAcceptance(projectId: string, ra: RiskAcceptance): Promise<void>;
```

Add this test to `tests/core/repository.test.ts`, inside the existing `describe("JsonRepository — project-instance read/write (temp data/ tree)", ...)` block (add the import `RiskAcceptance` to the existing type-only import line from `../../src/core/repository.js`):

```ts
  it("getRiskAcceptances returns [] for a project with no risk-acceptances.json yet", async () => {
    expect(await repo.getRiskAcceptances("PRJ-1")).toEqual([]);
  });

  it("saveRiskAcceptance appends a new riskAcceptanceId but replaces an existing one (upsert)", async () => {
    const first: RiskAcceptance = {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "IAM-AUTH-005", findingIds: [],
      reason: "compensating control in place", compensatingControls: ["NET-ADMIN-003"],
      approvedBy: "csi-mcp-agent", approvedAt: "2026-09-30T00:00:00.000Z", expiresAt: "2026-12-30T00:00:00.000Z",
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    };
    await repo.saveRiskAcceptance("PRJ-1", first);
    const revoked = { ...first, status: "revoked" as const, revokedAt: "2026-10-01T00:00:00.000Z", revokedReason: "no longer needed" };
    await repo.saveRiskAcceptance("PRJ-1", revoked);
    const all = await repo.getRiskAcceptances("PRJ-1");
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(revoked);

    const other: RiskAcceptance = { ...first, riskAcceptanceId: "RA-002", controlId: "DATA-ENC-002" };
    await repo.saveRiskAcceptance("PRJ-1", other);
    expect(await repo.getRiskAcceptances("PRJ-1")).toHaveLength(2);
  });
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: FAIL — `repo.getRiskAcceptances` is not a function (the `JsonRepository` class doesn't implement the interface methods yet, so TypeScript itself should also flag `JsonRepository` as not satisfying `SecurityRepository` — the whole file may fail to compile/run, not just the two new tests. Confirm the failure is about the missing implementation, not a typo in the test.

- [ ] **Step 5: Implement `getRiskAcceptances`/`saveRiskAcceptance` on `JsonRepository`**

In `src/core/repository.ts`'s `JsonRepository` class, add these two methods (same pattern as `getFindings`/`saveFinding`, storing at `data/projects/<id>/risk-acceptances.json`):

```ts
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
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 7: Update `FakeRepository` to implement the widened interface**

In `tests/service/fake-repository.ts`, add `RiskAcceptance` to the existing type-only import from `../../src/core/repository.js`, add a new field alongside the other `Map`s:

```ts
  riskAcceptances = new Map<string, RiskAcceptance[]>();
```

and add the two methods (same pattern as `getFindings`/`saveFinding`):

```ts
  async getRiskAcceptances(projectId: string): Promise<RiskAcceptance[]> {
    return this.riskAcceptances.get(projectId) ?? [];
  }
  async saveRiskAcceptance(projectId: string, ra: RiskAcceptance): Promise<void> {
    const list = this.riskAcceptances.get(projectId) ?? [];
    const next = list.filter((r) => r.riskAcceptanceId !== ra.riskAcceptanceId);
    next.push(ra);
    this.riskAcceptances.set(projectId, next);
  }
```

Run: `npx tsc --noEmit`
Expected: clean — `FakeRepository` now satisfies the widened `SecurityRepository` interface. (If any other hand-written fake/mock of `SecurityRepository` exists elsewhere in `tests/`, it needs the same two methods; search with `grep -rln "implements SecurityRepository" tests/` and fix any you find the same way.)

- [ ] **Step 8: Write the failing test for `isRiskAcceptanceEffectivelyValid`**

Create `tests/core/risk-acceptance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isRiskAcceptanceEffectivelyValid } from "../../src/core/risk-acceptance.js";
import type { RiskAcceptance } from "../../src/core/repository.js";

const NOW = "2026-10-05T12:00:00.000Z";

function ra(overrides: Partial<RiskAcceptance> = {}): RiskAcceptance {
  return {
    riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "IAM-AUTH-005", findingIds: [],
    reason: "compensating control", compensatingControls: [],
    approvedBy: "csi-mcp-agent", approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
    reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    ...overrides,
  };
}

describe("isRiskAcceptanceEffectivelyValid", () => {
  it("true when active, approved in the past, and not yet expired", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra(), NOW)).toBe(true);
  });

  it("false when status is expired, even if the date range is otherwise valid", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ status: "expired" }), NOW)).toBe(false);
  });

  it("false when status is revoked, even if the date range is otherwise valid", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ status: "revoked" }), NOW)).toBe(false);
  });

  it("false when now is at or past expiresAt, even if status is still active", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ expiresAt: NOW }), NOW)).toBe(false);
    expect(isRiskAcceptanceEffectivelyValid(ra({ expiresAt: "2026-10-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("false when approvedAt is in the future relative to now (malformed/clock-skewed approval)", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ approvedAt: "2026-10-06T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("true at the exact approvedAt instant (inclusive boundary)", () => {
    expect(isRiskAcceptanceEffectivelyValid(ra({ approvedAt: NOW }), NOW)).toBe(true);
  });
});
```

- [ ] **Step 9: Run to verify it fails**

Run: `npx vitest run tests/core/risk-acceptance.test.ts`
Expected: FAIL — `src/core/risk-acceptance.ts` doesn't exist yet (module not found).

- [ ] **Step 10: Implement `src/core/risk-acceptance.ts`**

```ts
import type { RiskAcceptance } from "./repository.js";

export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean {
  return ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt;
}
```

- [ ] **Step 11: Run to verify it passes**

Run: `npx vitest run tests/core/risk-acceptance.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 12: Write the failing test for `RiskAcceptanceService`**

Create `tests/service/risk-acceptance-service.test.ts`. **Added after this plan's final GPT review round** — an earlier draft had the two new MCP tools call `SecurityRepository` directly; reviewer pushed back that `RiskAcceptance` already has real lifecycle/validity semantics that warrant the same service-layer boundary every other entity in this codebase gets:

```ts
import { describe, expect, it } from "vitest";
import { RiskAcceptanceService } from "../../src/service/risk-acceptance-service.js";
import { FakeRepository } from "./fake-repository.js";

const NOW = "2026-10-05T00:00:00.000Z";

describe("RiskAcceptanceService.record", () => {
  it("creates RA-001 with agent-populated approvedBy/approvedAt and status active", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    const ra = await service.record({
      projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "compensating control in place",
      expiresAt: "2026-12-05T00:00:00.000Z",
    });
    expect(ra.riskAcceptanceId).toBe("RA-001");
    expect(ra.status).toBe("active");
    expect(ra.approvedBy).toBe("csi-mcp-agent");
    expect(ra.approvedAt).toBe(NOW);
    expect(ra.revokedAt).toBeNull();
    const [stored] = await repo.getRiskAcceptances("PRJ-1");
    expect(stored).toEqual(ra);
  });

  it("assigns sequential IDs across calls within the same project", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    const second = await service.record({ projectId: "PRJ-1", controlId: "DATA-ENC-002", reason: "r2", expiresAt: "2026-12-05T00:00:00.000Z" });
    expect(second.riskAcceptanceId).toBe("RA-002");
  });

  it("defaults findingIds/compensatingControls/reviewDate when omitted", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    const ra = await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    expect(ra.findingIds).toEqual([]);
    expect(ra.compensatingControls).toEqual([]);
    expect(ra.reviewDate).toBeNull();
  });
});

describe("RiskAcceptanceService.revoke", () => {
  it("transitions active to revoked with revokedAt/revokedReason set", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    const revoked = await service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "control remediated" });
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe(NOW);
    expect(revoked.revokedReason).toBe("control remediated");
    const [stored] = await repo.getRiskAcceptances("PRJ-1");
    expect(stored.status).toBe("revoked");
  });

  it("is idempotent on an already-revoked record — returns it unchanged, not an error", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await service.record({ projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" });
    await service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "first revoke" });
    const second = await service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "second revoke attempt" });
    expect(second.status).toBe("revoked");
    expect(second.revokedReason).toBe("first revoke"); // unchanged by the second call
  });

  it("throws NOT_FOUND for an unknown riskAcceptanceId", async () => {
    const repo = new FakeRepository();
    const service = new RiskAcceptanceService(repo, () => NOW);
    await expect(service.revoke({ projectId: "PRJ-1", riskAcceptanceId: "RA-999", revokedReason: "x" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 13: Run to verify it fails**

Run: `npx vitest run tests/service/risk-acceptance-service.test.ts`
Expected: FAIL — `src/service/risk-acceptance-service.ts` doesn't exist yet.

- [ ] **Step 14: Implement `RiskAcceptanceService`**

Create `src/service/risk-acceptance-service.ts`, same constructor shape as `AssessmentService`/`AnalysisService`:

```ts
import type { SecurityRepository, RiskAcceptance } from "../core/repository.js";
import { ServiceError } from "./errors.js";
import { nextSequentialId } from "./ids.js";
import { AGENT_IDENTITY } from "./constants.js";

export interface RecordRiskAcceptanceInput {
  projectId: string;
  controlId: string;
  findingIds?: string[];
  reason: string;
  compensatingControls?: string[];
  expiresAt: string;
  reviewDate?: string;
}

export interface RevokeRiskAcceptanceInput {
  projectId: string;
  riskAcceptanceId: string;
  revokedReason: string;
}

export class RiskAcceptanceService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async record(input: RecordRiskAcceptanceInput): Promise<RiskAcceptance> {
    const existing = await this.repository.getRiskAcceptances(input.projectId);
    const riskAcceptanceId = nextSequentialId("RA", existing.length);
    const ra: RiskAcceptance = {
      riskAcceptanceId, projectId: input.projectId, controlId: input.controlId,
      findingIds: input.findingIds ?? [], reason: input.reason,
      compensatingControls: input.compensatingControls ?? [],
      approvedBy: AGENT_IDENTITY, approvedAt: this.now(), expiresAt: input.expiresAt,
      reviewDate: input.reviewDate ?? null, status: "active", revokedAt: null, revokedReason: null,
    };
    await this.repository.saveRiskAcceptance(input.projectId, ra);
    return ra;
  }

  async revoke(input: RevokeRiskAcceptanceInput): Promise<RiskAcceptance> {
    const all = await this.repository.getRiskAcceptances(input.projectId);
    const existing = all.find((r) => r.riskAcceptanceId === input.riskAcceptanceId);
    if (!existing) {
      throw new ServiceError(
        "NOT_FOUND", `RiskAcceptance "${input.riskAcceptanceId}" not found`,
        { projectId: input.projectId, riskAcceptanceId: input.riskAcceptanceId }
      );
    }
    if (existing.status === "revoked") {
      return existing;
    }
    const revoked: RiskAcceptance = {
      ...existing, status: "revoked", revokedAt: this.now(), revokedReason: input.revokedReason,
    };
    await this.repository.saveRiskAcceptance(input.projectId, revoked);
    return revoked;
  }
}
```

- [ ] **Step 15: Run to verify it passes**

Run: `npx vitest run tests/service/risk-acceptance-service.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 16: Write the failing test for the two new MCP tools**

Create `tests/mcp/tools/risk-acceptance-tools.test.ts` — these tests exercise the tool-registration/wiring layer specifically (zod input shape, error-result translation), constructing a real `RiskAcceptanceService` the same way `tests/mcp/tools/assessment-tools.test.ts` constructs a real `AssessmentService`, not a mock:

```ts
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeRepository } from "../../service/fake-repository.js";
import { RiskAcceptanceService } from "../../../src/service/risk-acceptance-service.js";
import { registerRecordRiskAcceptanceTool } from "../../../src/mcp/tools/record-risk-acceptance.js";
import { registerRevokeRiskAcceptanceTool } from "../../../src/mcp/tools/revoke-risk-acceptance.js";

async function makeConnectedClient() {
  const repo = new FakeRepository();
  const service = new RiskAcceptanceService(repo, () => "2026-10-05T00:00:00.000Z");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRecordRiskAcceptanceTool(server, service);
  registerRevokeRiskAcceptanceTool(server, service);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, repo };
}

describe("record_risk_acceptance / revoke_risk_acceptance", () => {
  it("record_risk_acceptance round-trips through the tool layer to a real RiskAcceptance", async () => {
    const { client, repo } = await makeConnectedClient();
    const result = await client.callTool({
      name: "record_risk_acceptance",
      arguments: {
        projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "compensating control in place",
        expiresAt: "2026-12-05T00:00:00.000Z",
      },
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).riskAcceptanceId).toBe("RA-001");
    const [stored] = await repo.getRiskAcceptances("PRJ-1");
    expect(stored.controlId).toBe("IAM-AUTH-005");
  });

  it("revoke_risk_acceptance round-trips through the tool layer", async () => {
    const { client } = await makeConnectedClient();
    await client.callTool({
      name: "record_risk_acceptance",
      arguments: { projectId: "PRJ-1", controlId: "IAM-AUTH-005", reason: "r1", expiresAt: "2026-12-05T00:00:00.000Z" },
    });
    const result = await client.callTool({
      name: "revoke_risk_acceptance",
      arguments: { projectId: "PRJ-1", riskAcceptanceId: "RA-001", revokedReason: "control remediated" },
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as any).status).toBe("revoked");
  });

  it("revoke_risk_acceptance surfaces NOT_FOUND through the tool layer's error-result translation", async () => {
    const { client } = await makeConnectedClient();
    const result = await client.callTool({
      name: "revoke_risk_acceptance",
      arguments: { projectId: "PRJ-1", riskAcceptanceId: "RA-999", revokedReason: "x" },
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).code).toBe("NOT_FOUND");
  });
});
```

(The service-level tests in Step 12 already cover sequential-ID assignment, default-field behavior, and idempotency in full — this file only needs to prove the tool layer itself wires zod input, the service, and error-result translation correctly, not re-prove the service's own logic.)

- [ ] **Step 17: Run to verify it fails**

Run: `npx vitest run tests/mcp/tools/risk-acceptance-tools.test.ts`
Expected: FAIL — `src/mcp/tools/record-risk-acceptance.ts` and `src/mcp/tools/revoke-risk-acceptance.ts` don't exist yet.

- [ ] **Step 18: Implement `record-risk-acceptance.ts` and `revoke-risk-acceptance.ts`**

Both are thin wrappers around `RiskAcceptanceService`, matching `record-finding.ts`'s exact shape (zod input, `registerTool`, `toErrorResult` on catch).

Create `src/mcp/tools/record-risk-acceptance.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RiskAcceptanceService } from "../../service/risk-acceptance-service.js";
import { toErrorResult } from "./error-result.js";

export const recordRiskAcceptanceInputShape = {
  projectId: z.string().min(1),
  controlId: z.string().min(1),
  findingIds: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  compensatingControls: z.array(z.string().min(1)).optional(),
  expiresAt: z.string().min(1),
  reviewDate: z.string().optional(),
};

export function registerRecordRiskAcceptanceTool(server: McpServer, service: RiskAcceptanceService): void {
  server.registerTool(
    "record_risk_acceptance",
    {
      title: "Record Risk Acceptance",
      description:
        "Create a RiskAcceptance for a control — required before record_assessment will accept status " +
        "\"ACCEPTED_RISK\" for that control. In the current single-user local stdio MCP deployment, " +
        "possession of local MCP access constitutes approval authority — this tool does not verify a " +
        "separate human approver identity.",
      inputSchema: recordRiskAcceptanceInputShape,
    },
    async (input) => {
      try {
        const ra = await service.record(input);
        return {
          content: [{ type: "text" as const, text: `Recorded risk acceptance ${ra.riskAcceptanceId} for ${ra.controlId}.` }],
          structuredContent: ra as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

Create `src/mcp/tools/revoke-risk-acceptance.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RiskAcceptanceService } from "../../service/risk-acceptance-service.js";
import { toErrorResult } from "./error-result.js";

export const revokeRiskAcceptanceInputShape = {
  projectId: z.string().min(1),
  riskAcceptanceId: z.string().min(1),
  revokedReason: z.string().min(1),
};

export function registerRevokeRiskAcceptanceTool(server: McpServer, service: RiskAcceptanceService): void {
  server.registerTool(
    "revoke_risk_acceptance",
    {
      title: "Revoke Risk Acceptance",
      description:
        "Revoke a RiskAcceptance before its natural expiry. Idempotent: revoking an already-revoked " +
        "record returns it unchanged rather than erroring, so a retried call never fails just because " +
        "it already succeeded.",
      inputSchema: revokeRiskAcceptanceInputShape,
    },
    async (input) => {
      try {
        const revoked = await service.revoke(input);
        return {
          content: [{ type: "text" as const, text: `Revoked risk acceptance ${revoked.riskAcceptanceId}.` }],
          structuredContent: revoked as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

- [ ] **Step 19: Run to verify it passes**

Run: `npx vitest run tests/mcp/tools/risk-acceptance-tools.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 20: Wire `RiskAcceptanceService` and both tools into `buildServer()`**

In `src/mcp/server.ts`, add two imports:

```ts
import { RiskAcceptanceService } from "../service/risk-acceptance-service.js";
import { registerRecordRiskAcceptanceTool } from "./tools/record-risk-acceptance.js";
import { registerRevokeRiskAcceptanceTool } from "./tools/revoke-risk-acceptance.js";
```

Inside `buildServer`, after `const assessmentService = new AssessmentService(repository);`, add:

```ts
  const riskAcceptanceService = new RiskAcceptanceService(repository);
```

and, after `registerRecordFindingTool(server, assessmentService);`, add:

```ts
  registerRecordRiskAcceptanceTool(server, riskAcceptanceService);
  registerRevokeRiskAcceptanceTool(server, riskAcceptanceService);
```

- [ ] **Step 21: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, every test file (no other file should be affected by this task — `ControlAssessment` itself is unchanged in this task, only `SecurityRepository`/`JsonRepository`/`FakeRepository` grew two new methods, which is purely additive).

- [ ] **Step 22: Commit**

```bash
git add data/schemas/risk-acceptance-schema.json src/core/repository.ts src/core/risk-acceptance.ts \
  src/service/risk-acceptance-service.ts \
  src/mcp/tools/record-risk-acceptance.ts src/mcp/tools/revoke-risk-acceptance.ts src/mcp/server.ts \
  tests/service/fake-repository.ts tests/core/risk-acceptance.test.ts tests/service/risk-acceptance-service.test.ts \
  tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts tests/core/repository.test.ts \
  tests/mcp/tools/risk-acceptance-tools.test.ts
git commit -m "feat(core,service,mcp): wire up the long-dormant RiskAcceptance entity

RiskAcceptance has had a full JSON schema since Phase 1 but zero lines
of code using it anywhere. Adds the TS interface, repository
persistence (upsert by riskAcceptanceId, same pattern as findings.json),
a pure isRiskAcceptanceEffectivelyValid() helper (checks status,
approvedAt, and expiresAt independently — never trusts status alone),
a RiskAcceptanceService (matching every other entity's service-layer
boundary in this codebase), and two new MCP tools:
record_risk_acceptance and revoke_risk_acceptance (idempotent on an
already-revoked record).

See docs/superpowers/specs/2026-10-05-assessment-trust-integrity-design.md"
```

---

### Task 2: `recordAssessment` hardening — ACCEPTED_RISK validation, N/A cross-check, runId/profileRevision capture

**Files:**
- Modify: `data/schemas/control-assessment-schema.json`
- Modify: `src/service/assessment-service.ts`
- Test: `tests/service/assessment-service.test.ts`
- Test: `tests/schemas/control-assessment-schema.test.ts`
- Test: `tests/core/repository.test.ts`

**Interfaces:**
- Consumes (from Task 1): `RiskAcceptance` type, `repository.getRiskAcceptances(projectId)`, `isRiskAcceptanceEffectivelyValid(ra, nowIso)` from `src/core/risk-acceptance.js`.
- Produces (for Task 3): `ControlAssessment.runId: string` and `ControlAssessment.profileRevision: number`, populated on every `recordAssessment` call going forward.

- [ ] **Step 1: Add `runId`/`profileRevision` to `ControlAssessment` and the N/A reverse invariant, write the failing schema tests**

In `data/schemas/control-assessment-schema.json`, add two properties (after `controlVersion`, before `applicability`):

```json
    "runId": { "type": "string", "minLength": 1 },
    "profileRevision": { "type": "integer", "minimum": 1 },
```

add both to `required`:

```json
  "required": [
    "assessmentId", "projectId", "controlId", "controlVersion", "runId", "profileRevision",
    "applicability", "status", "evidenceIds", "findingIds",
    "riskAcceptanceId", "owner", "assessedBy", "assessedAt"
  ],
```

and add a new entry to `allOf` (after the existing N/A→notes rule) declaring the reverse invariant:

```json
    {
      "if": { "properties": { "status": { "const": "N/A" } }, "required": ["status"] },
      "then": {
        "properties": {
          "applicability": {
            "type": "object",
            "properties": { "finalResult": { "const": "not_applicable" } },
            "required": ["finalResult"]
          }
        }
      }
    },
```

In `tests/schemas/control-assessment-schema.test.ts`, update `baseAssessment`:

```ts
const baseAssessment = {
  assessmentId: "ASM-001",
  projectId: "proj-001",
  controlId: "IAM-AUTH-005",
  controlVersion: 1,
  runId: "RUN-001",
  profileRevision: 1,
  applicability: {
    autoResult: "applicable",
    finalResult: "applicable",
    matchedRules: ["identities contains administrator"],
    source: "automatic",
  },
  status: "PASS",
  evidenceIds: ["EVD-001"],
  findingIds: [],
  riskAcceptanceId: null,
  owner: "security",
  assessedBy: "agent",
  assessedAt: "2026-09-16T05:00:00Z",
};
```

Add two new tests at the end of the `describe("control-assessment-schema", ...)` block:

```ts
  it("rejects status N/A with applicability.finalResult still 'applicable'", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment, status: "N/A", notes: "attempted bypass",
      applicability: { ...baseAssessment.applicability, finalResult: "applicable" },
    };
    expect(validate(doc)).toBe(false);
  });

  it("accepts status N/A when applicability.finalResult is 'not_applicable'", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment, status: "N/A", notes: "genuinely not applicable",
      applicability: {
        autoResult: "applicable", finalResult: "not_applicable", matchedRules: [],
        source: "manual_override", reason: "no admin interface exists in this deployment",
      },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify current state**

Run: `npx vitest run tests/schemas/control-assessment-schema.test.ts`
Expected: the two new tests should PASS immediately (the schema change in Step 1 already implements the invariant) — this is confirming the schema edit, not doing TDD red/green on new application logic. All pre-existing tests in the file must also still pass (the `baseAssessment` fixture addition of `runId`/`profileRevision` is required for every existing test to keep passing now that both are `required`). If any pre-existing test fails, the fixture update is incomplete somewhere in the file — check for a second, locally-overridden fixture object you missed.

- [ ] **Step 3: Write the failing `recordAssessment` tests for ACCEPTED_RISK validation**

In `tests/service/assessment-service.test.ts`, add a helper near the top (after `function control(...)`) and a new `describe` block after the existing `describe("AssessmentService.recordAssessment", ...)` block closes:

```ts
async function makeValidRiskAcceptance(repo: FakeRepository, overrides: Partial<import("../../src/core/repository.js").RiskAcceptance> = {}) {
  const ra = {
    riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", findingIds: [],
    reason: "compensating control in place", compensatingControls: [],
    approvedBy: "csi-mcp-agent", approvedAt: "2026-09-29T00:00:00.000Z", expiresAt: "2026-12-30T00:00:00.000Z",
    reviewDate: null, status: "active" as const, revokedAt: null, revokedReason: null,
    ...overrides,
  };
  await repo.saveRiskAcceptance("PRJ-1", ra);
  return ra;
}

describe("AssessmentService.recordAssessment — ACCEPTED_RISK validation", () => {
  it("accepts ACCEPTED_RISK when the RiskAcceptance exists, scopes to this control, and is effectively valid", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    await makeValidRiskAcceptance(repo);
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK",
      evidence: [], riskAcceptanceId: "RA-001",
    });
    expect(assessment.status).toBe("ACCEPTED_RISK");
    expect(assessment.riskAcceptanceId).toBe("RA-001");
  });

  it("rejects ACCEPTED_RISK when riskAcceptanceId does not resolve to an existing RiskAcceptance", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK",
      evidence: [], riskAcceptanceId: "RA-999",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects ACCEPTED_RISK when the RiskAcceptance's controlId does not match the control being assessed", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control(), control({ controlId: "OPS-BACKUP-TEST-001", domain: "operations" })];
    await makeValidRiskAcceptance(repo, { controlId: "OPS-BACKUP-TEST-001" });
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK",
      evidence: [], riskAcceptanceId: "RA-001",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects ACCEPTED_RISK when the RiskAcceptance is expired", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    await makeValidRiskAcceptance(repo, { expiresAt: "2026-09-29T00:00:00.000Z" }); // before FIXED_NOW
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK",
      evidence: [], riskAcceptanceId: "RA-001",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects ACCEPTED_RISK when the RiskAcceptance is revoked", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    await makeValidRiskAcceptance(repo, { status: "revoked", revokedAt: FIXED_NOW, revokedReason: "remediated" });
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "ACCEPTED_RISK",
      evidence: [], riskAcceptanceId: "RA-001",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("AssessmentService.recordAssessment — N/A cross-check against applicability", () => {
  it("accepts N/A with just notes when the engine already says not_applicable", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control({ applicability: { when: { fact: "features.authentication", operator: "eq", value: false } } })];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A",
      evidence: [], notes: "not applicable per profile",
    });
    expect(assessment.status).toBe("N/A");
    expect(assessment.applicability.finalResult).toBe("not_applicable");
  });

  it("rejects N/A when the engine says applicable and no applicabilityOverride is given", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()]; // project's features.authentication: true -> autoResult applicable
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A",
      evidence: [], notes: "trying to skip this",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects N/A when the engine says applicable and applicabilityOverride.result is not 'not_applicable'", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A",
      evidence: [], notes: "x", applicabilityOverride: { result: "unknown", reason: "unsure" },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts N/A when the engine says applicable but applicabilityOverride forces not_applicable with a reason", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A",
      evidence: [], notes: "x",
      applicabilityOverride: { result: "not_applicable", reason: "this instance has authentication disabled entirely despite the feature flag" },
    });
    expect(assessment.status).toBe("N/A");
    expect(assessment.applicability.finalResult).toBe("not_applicable");
    expect(assessment.applicability.source).toBe("manual_override");
  });
});
```

- [ ] **Step 4: Run to verify these new tests fail**

Run: `npx vitest run tests/service/assessment-service.test.ts`
Expected: FAIL — the ACCEPTED_RISK tests fail because `recordAssessment` doesn't look up `RiskAcceptance` at all yet (every case, including the ones that should reject, currently succeeds since the only check today is "non-empty string"). The N/A tests fail because there's no cross-check against `autoResult` yet (the "rejects N/A when engine says applicable" cases currently succeed). Confirm these are assertion failures on the new tests specifically, not compile errors — if `RiskAcceptance` type import fails, check Task 1 actually completed and merged.

- [ ] **Step 5: Implement the hardened `recordAssessment`**

In `src/service/assessment-service.ts`:

1. Add imports:

```ts
import { isRiskAcceptanceEffectivelyValid } from "../core/risk-acceptance.js";
```

2. Move the `evaluateApplicability` call to before the validation block, and change the validation block to use it. Replace the whole body of `recordAssessment` from the `const controls = ...` line through the `const { autoResult, matchedRules } = evaluateApplicability(...)` line with:

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
    const run = await withNotFound(
      this.repository.getRun(input.projectId, input.runId), `Run "${input.runId}" not found`, { projectId: input.projectId, runId: input.runId }
    );
    if (run.profileRevision !== project.profileRevision) {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        `Run "${input.runId}" was started against profileRevision ${run.profileRevision}, but project "${input.projectId}" is now at profileRevision ${project.profileRevision} — start a new assessment run instead of continuing this one`,
        { projectId: input.projectId, runId: input.runId, runProfileRevision: run.profileRevision, currentProfileRevision: project.profileRevision }
      );
    }

    const { autoResult, matchedRules } = evaluateApplicability(control, project.profile);

    // PASS, FAIL, and PARTIAL all assert a definitive, code-level fact about the
    // control's actual state — unlike NOT_TESTED (an honest abstention), N/A
    // (requires notes instead), or ACCEPTED_RISK (requires riskAcceptanceId
    // instead). A real incident (Chatwoot's APP-SSRF-001, initially marked FAIL
    // on evidence that cited a model-level regex but never traced the actual
    // outbound request path) showed that a shallow FAIL is exactly as
    // untrustworthy as a shallow PASS — so both verdict directions need the
    // same methodology rigor, not just the "looks safe" direction.
    const VERDICTS_REQUIRING_METHODOLOGY_EVIDENCE = ["PASS", "FAIL", "PARTIAL"];
    if (VERDICTS_REQUIRING_METHODOLOGY_EVIDENCE.includes(input.status) && input.evidence.length === 0) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        `status ${input.status} requires at least one evidence entry`,
        { controlId: input.controlId }
      );
    }
    if (
      VERDICTS_REQUIRING_METHODOLOGY_EVIDENCE.includes(input.status) &&
      !input.evidence.some((e) => e.searchScope && e.searchMethod)
    ) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        `status ${input.status} requires at least one evidence entry with both searchScope and searchMethod — document what was actually searched and how, not just the conclusion`,
        { controlId: input.controlId }
      );
    }
    if (input.status === "N/A" && !input.notes) {
      throw new ServiceError("VALIDATION_ERROR", 'status "N/A" requires non-empty notes', { controlId: input.controlId });
    }
    if (input.status === "N/A" && autoResult !== "not_applicable") {
      if (!input.applicabilityOverride || input.applicabilityOverride.result !== "not_applicable") {
        throw new ServiceError(
          "VALIDATION_ERROR",
          'status "N/A" on a control the engine considers applicable requires applicabilityOverride with result "not_applicable" and a reason explaining why',
          { controlId: input.controlId, autoResult }
        );
      }
    }
    if (input.status === "ACCEPTED_RISK") {
      if (!input.riskAcceptanceId) {
        throw new ServiceError("VALIDATION_ERROR", 'status "ACCEPTED_RISK" requires riskAcceptanceId', { controlId: input.controlId });
      }
      const riskAcceptances = await this.repository.getRiskAcceptances(input.projectId);
      const riskAcceptance = riskAcceptances.find((ra) => ra.riskAcceptanceId === input.riskAcceptanceId);
      if (!riskAcceptance) {
        throw new ServiceError(
          "VALIDATION_ERROR", `riskAcceptanceId "${input.riskAcceptanceId}" does not exist for this project`,
          { controlId: input.controlId, riskAcceptanceId: input.riskAcceptanceId }
        );
      }
      if (riskAcceptance.controlId !== input.controlId) {
        throw new ServiceError(
          "VALIDATION_ERROR",
          `riskAcceptanceId "${input.riskAcceptanceId}" is scoped to control "${riskAcceptance.controlId}", not "${input.controlId}"`,
          { controlId: input.controlId, riskAcceptanceId: input.riskAcceptanceId }
        );
      }
      if (!isRiskAcceptanceEffectivelyValid(riskAcceptance, this.now())) {
        throw new ServiceError(
          "VALIDATION_ERROR", `riskAcceptanceId "${input.riskAcceptanceId}" is not currently valid (expired, revoked, or not yet approved)`,
          { controlId: input.controlId, riskAcceptanceId: input.riskAcceptanceId }
        );
      }
    }

    const applicability = input.applicabilityOverride
      ? { autoResult, finalResult: input.applicabilityOverride.result, matchedRules, source: "manual_override" as const, reason: input.applicabilityOverride.reason }
      : { autoResult, finalResult: autoResult, matchedRules, source: "automatic" as const };
```

3. Update the `ControlAssessment` object construction at the end of the function to add `runId`/`profileRevision`:

```ts
    const assessment: ControlAssessment = {
      assessmentId: generateUuid(), projectId: input.projectId, controlId: input.controlId, controlVersion: control.version,
      runId: input.runId, profileRevision: run.profileRevision,
      applicability, status: input.status, evidenceIds, findingIds: [], riskAcceptanceId: input.riskAcceptanceId ?? null,
      owner: AGENT_IDENTITY, assessedBy: AGENT_IDENTITY, assessedAt: this.now(), nextReviewAt: null, notes: input.notes ?? null,
    };
```

4. Add `runId: string` and `profileRevision: number` to the `ControlAssessment` interface in `src/core/repository.ts` (after `controlVersion`, before `applicability`):

```ts
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
```

- [ ] **Step 6: Run to verify the new tests pass**

Run: `npx vitest run tests/service/assessment-service.test.ts`
Expected: PASS for all new tests. Some pre-existing tests in this file will now FAIL — see Step 7.

- [ ] **Step 7: Fix pre-existing tests broken by the N/A reorder and the new required fields**

Three categories of fix needed in `tests/service/assessment-service.test.ts`:

1. The existing N/A tests ("rejects N/A without notes", "accepts N/A with notes") use `control()`'s default applicability (`features.authentication: true` in the project profile → `autoResult: "applicable"`). The "accepts N/A with notes" test will now FAIL because `autoResult` is `"applicable"`, not `"not_applicable"`, and no override was given. Fix: give that one test an `applicabilityOverride`:

```ts
  it("accepts N/A with notes when applicability is overridden to not_applicable", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "N/A", evidence: [],
      notes: "not applicable here", applicabilityOverride: { result: "not_applicable", reason: "not applicable here" },
    });
    expect(assessment.status).toBe("N/A");
    expect(assessment.notes).toBe("not applicable here");
  });
```

(the "rejects N/A without notes" test is unaffected — it already expects a `VALIDATION_ERROR`, and still gets one, now possibly for a different reason among several equally-valid ones; no change needed there.)

2. Every assertion in this file that checks an `assessment.applicability` object's exact shape (via `toEqual`) does NOT need a `runId`/`profileRevision` addition — those are `toMatchObject` or specific-field assertions in this file, not full-object `toEqual`. Spot-check: the test at line ~161 ("records a PASS with evidence...") does `expect(assessment.applicability).toEqual({...})` on the `applicability` sub-object specifically, not the whole assessment — unaffected. Confirm no test in this file does `expect(assessment).toEqual({...wholeObjectLiteral...})` that would need `runId`/`profileRevision` added; if one is found, add `runId: "RUN-1", profileRevision: 3` to its expected literal (matching `makeProjectRepo()`'s fixture run/project).

3. The "applies a manual applicability override with its reason" test uses `status: "NOT_TESTED"` with an override to `"not_applicable"` — this is unaffected by the N/A-specific rule (the new rule only fires when `status === "N/A"`), no change needed.

- [ ] **Step 8: Run to verify everything passes**

Run: `npx vitest run tests/service/assessment-service.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 9: Write the failing run-mismatch rejection test**

Add to `tests/service/assessment-service.test.ts`, in a new `describe` block:

```ts
describe("AssessmentService.recordAssessment — run/profile revision consistency", () => {
  it("rejects when the run's profileRevision no longer matches the project's current profileRevision", async () => {
    const repo = await makeProjectRepo(); // project at profileRevision 3, RUN-1 also at 3
    repo.controls = [control()];
    const project = await repo.getProject("PRJ-1");
    await repo.saveProject({ ...project, profileRevision: 4 }); // project moves on; RUN-1 still says 3
    const service = new AssessmentService(repo, () => FIXED_NOW);
    await expect(service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [],
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("stamps the saved assessment's profileRevision/runId from the run, not a fresh project read", async () => {
    const repo = await makeProjectRepo();
    repo.controls = [control()];
    const service = new AssessmentService(repo, () => FIXED_NOW);
    const assessment = await service.recordAssessment({
      projectId: "PRJ-1", runId: "RUN-1", controlId: "APP-INPUT-VAL-001", status: "NOT_TESTED", evidence: [],
    });
    expect(assessment.runId).toBe("RUN-1");
    expect(assessment.profileRevision).toBe(3);
  });
});
```

- [ ] **Step 10: Run to verify it passes**

Run: `npx vitest run tests/service/assessment-service.test.ts`
Expected: PASS, all tests including the 2 new ones (Step 5's implementation already covers this — this step confirms it).

- [ ] **Step 11: Fix `tests/core/repository.test.ts`'s `ControlAssessment` fixtures**

In the `"saveControlAssessment appends a new controlId but replaces an existing one (upsert)"` test, add `runId`/`profileRevision` to the `first` fixture:

```ts
    const first: ControlAssessment = {
      assessmentId: "A-1", projectId: "PRJ-1", controlId: "APP-INPUT-VAL-001", controlVersion: 1,
      runId: "RUN-1", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "NOT_TESTED", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-09-30T00:00:00.000Z", nextReviewAt: null, notes: null,
    };
```

(`second` and `other` both spread `...first`, so they inherit the new fields automatically — no further change needed.)

- [ ] **Step 12: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, every test file.

- [ ] **Step 13: Commit**

```bash
git add data/schemas/control-assessment-schema.json src/service/assessment-service.ts src/core/repository.ts \
  tests/service/assessment-service.test.ts tests/schemas/control-assessment-schema.test.ts tests/core/repository.test.ts
git commit -m "feat(service): harden recordAssessment — real ACCEPTED_RISK validation, N/A cross-check, profile staleness capture

ACCEPTED_RISK now requires the riskAcceptanceId to resolve to an
existing RiskAcceptance scoped to this control and currently
effectively valid (status, approval date, and expiry all checked
independently), instead of just being a non-empty string. N/A on a
control the engine still considers applicable now requires an explicit
applicabilityOverride forcing not_applicable, with a reason — the
schema gains the symmetric invariant as a defense-in-depth backstop.
ControlAssessment now also captures runId/profileRevision from the run
object (previously fetched but discarded), and recordAssessment
rejects with PRECONDITION_FAILED if the run's pinned profileRevision
no longer matches the project's current one, forcing a new run instead
of silently mixing profile snapshots within one.

See docs/superpowers/specs/2026-10-05-assessment-trust-integrity-design.md"
```

---

### Task 3: Shared trust translation, `AnalysisService`, and `ReportService` — freshness-aware Coverage Gate everywhere a release decision is computed

**Files:**
- Modify: `src/core/risk-acceptance.ts`
- Modify: `src/service/analysis-service.ts`
- Modify: `src/service/report-service.ts`
- Modify: `src/mcp/tools/evaluate-release.ts`
- Test: `tests/core/risk-acceptance.test.ts`
- Test: `tests/service/analysis-service.test.ts`
- Test: `tests/service/report-service.test.ts`
- Test: `tests/mcp/tools/analysis-report-tools.test.ts`

**Interfaces:**
- Consumes (from Task 1): `RiskAcceptance`, `isRiskAcceptanceEffectivelyValid`. (from Task 2): `ControlAssessment.profileRevision`/`runId`.
- Produces: `translateAssessmentsForTrust(assessments, currentProfileRevision, riskAcceptances, nowIso)` added to `src/core/risk-acceptance.ts`. No changes to `AnalysisService`'s or `ReportService`'s public method signatures — only `AnalysisService`'s constructor gains an optional second parameter (`ReportService`'s already has one).

**Why this task covers two services, not one.** `ReportService.generate` (backing `generate_report`) was found during this plan's final review round to independently duplicate the exact same `calculateScore` + `evaluateRelease` pattern `AnalysisService.evaluateRelease` has, from its own separate raw `getControlAssessments` read — confirmed by reading `src/service/report-service.ts` directly, which never calls `AnalysisService` at all. Fixing only `AnalysisService` would leave `generate_report` producing a stale-blind `releaseEvaluation`/`score` inside every saved `ProjectReport`, reintroducing the exact inconsistency this whole task exists to close, just one layer over. Both services' fixes share one function (`translateAssessmentsForTrust`) rather than duplicating the translation logic a second time across two call sites.

- [ ] **Step 1: Write the failing test for `translateAssessmentsForTrust`**

Add to `tests/core/risk-acceptance.test.ts` (same file Task 1 created — add the import `ControlAssessment` to the existing type-only import from `../../src/core/repository.js`, alongside `RiskAcceptance`):

```ts
import { isRiskAcceptanceEffectivelyValid, translateAssessmentsForTrust } from "../../src/core/risk-acceptance.js";
import type { ControlAssessment, RiskAcceptance } from "../../src/core/repository.js";

function assessment(controlId: string, overrides: Partial<ControlAssessment> = {}): ControlAssessment {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-1", controlId, controlVersion: 1,
    runId: "RUN-1", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: NOW, nextReviewAt: null, notes: null,
    ...overrides,
  };
}

describe("translateAssessmentsForTrust", () => {
  it("a fresh assessment (profileRevision matches) passes through with its real status", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 1, [], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "PASS" }]);
  });

  it("a stale assessment (profileRevision does not match) is translated to NOT_TESTED", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 2, [], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "NOT_TESTED" }]);
  });

  it("ACCEPTED_RISK backed by a valid RiskAcceptance passes through unchanged", () => {
    const ra: RiskAcceptance = {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    };
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [ra], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "ACCEPTED_RISK" }]);
  });

  it("ACCEPTED_RISK whose RiskAcceptance has since expired is translated to NOT_TESTED", () => {
    const ra: RiskAcceptance = {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", // expired before NOW
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    };
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [ra], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "NOT_TESTED" }]);
  });

  it("ACCEPTED_RISK whose riskAcceptanceId resolves to nothing at all is translated to NOT_TESTED", () => {
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-404" });
    const result = translateAssessmentsForTrust([a], 1, [], NOW);
    expect(result).toEqual([{ controlId: "TEST-001", status: "NOT_TESTED" }]);
  });

  it("never mutates the input ControlAssessment objects", () => {
    const a = assessment("TEST-001", { profileRevision: 1 });
    translateAssessmentsForTrust([a], 2, [], NOW);
    expect(a.status).toBe("PASS");
    expect(a.profileRevision).toBe(1);
  });
});
```

(`NOW` is already defined as a module-level constant at the top of this file from Task 1's `isRiskAcceptanceEffectivelyValid` tests — reuse it, don't redefine it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/risk-acceptance.test.ts`
Expected: FAIL — `translateAssessmentsForTrust` is not exported from `src/core/risk-acceptance.ts` yet.

- [ ] **Step 3: Implement `translateAssessmentsForTrust`**

Add to `src/core/risk-acceptance.ts` (alongside the existing `isRiskAcceptanceEffectivelyValid`):

```ts
import type { ControlAssessment, RiskAcceptance } from "./repository.js";

export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean {
  return ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt;
}

export function translateAssessmentsForTrust(
  assessments: ControlAssessment[],
  currentProfileRevision: number,
  riskAcceptances: RiskAcceptance[],
  nowIso: string
): { controlId: string; status: ControlAssessment["status"] }[] {
  const riskAcceptanceById = new Map(riskAcceptances.map((ra) => [ra.riskAcceptanceId, ra]));
  return assessments.map((a) => {
    const stale = a.profileRevision !== currentProfileRevision;
    const ra = a.riskAcceptanceId ? riskAcceptanceById.get(a.riskAcceptanceId) : undefined;
    const acceptedRiskInvalid = a.status === "ACCEPTED_RISK" && !(ra && isRiskAcceptanceEffectivelyValid(ra, nowIso));
    return { controlId: a.controlId, status: stale || acceptedRiskInvalid ? "NOT_TESTED" : a.status };
  });
}
```

(Note the `import type { RiskAcceptance }` at the top of the existing file becomes `import type { ControlAssessment, RiskAcceptance }` — add `ControlAssessment` to it rather than introducing a second import line.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/risk-acceptance.test.ts`
Expected: PASS, all tests (Task 1's 6 original tests plus this step's 6 new ones).

- [ ] **Step 5: Fix `tests/service/analysis-service.test.ts`'s 3 existing fixtures, then add the new translation-behavior tests**

This file already exists (6 tests across `AnalysisService.getScore`/`AnalysisService.evaluateRelease`) — do not recreate it from scratch. Two changes to the existing content, then one addition.

**(a) Fix the 3 existing `ControlAssessment` literals.** Each of `"computes a score from the project's assessments and controls"`, the loop inside `"reads securityLevel from the project, never from the caller"`, and `"maps the SVL-0/SVL-1 precondition throw to PRECONDITION_FAILED"` constructs a `ControlAssessment` literal directly via `repo.saveControlAssessment({...})` with no `runId`/`profileRevision` — both now required by Task 2's interface change. Every project in this file is created via `makeProject(repo, securityLevel)` with `profileRevision: 1`, so add `runId: "RUN-1", profileRevision: 1,` to each of the 3 literals (the exact run doesn't need to exist in the repo for these — Task 2's `recordAssessment`-level run-mismatch guard isn't triggered here since these tests call `repo.saveControlAssessment` directly, bypassing `AssessmentService` entirely).

**(b) Add new describe blocks and their own helpers at the end of the file.** These use different helper names (`makeProjectRepo`, `blockingControl`, `passAssessment`) than the file's existing `makeProject`/`setScoreModel`, so there's no collision — append rather than replace. Also add `Control` to the existing import line (`import type { Control } from "../../src/core/repository.js";` — the file currently has no type-only import from `repository.js` at all, so this is a new import line), and append a new top-level `const NOW = "2026-10-05T12:00:00.000Z";` (the existing tests use inline date-time string literals, not a shared constant, so this doesn't conflict with anything):

```ts
const NOW = "2026-10-05T12:00:00.000Z";

function blockingControl(controlId: string, overrides: Partial<Control> = {}): Control {
  return {
    controlId, version: 1, status: "active", title: controlId, domain: "test", subdomain: "test",
    layer: "prevent", group: "test", applicability: { when: { fact: "features.authentication", operator: "eq", value: true } },
    ...overrides,
  };
}

async function makeProjectRepo(profileRevision = 1) {
  const repo = new FakeRepository();
  await repo.saveProject({
    projectId: "PRJ-1", name: "Demo", owner: "alice", createdAt: NOW, profileRevision,
    profile: { securityLevel: "SVL-2", exposure: ["internet_public"], features: { authentication: true }, technologies: {} },
  });
  await repo.saveRun({
    runId: "RUN-1", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision,
    catalogVersion: "1.0.0", batchIds: [], status: "running", startedAt: NOW, completedAt: null,
  });
  repo.scoreModel = {
    modelId: "USSVS-SCORE-DEFAULT", version: "1.0.0",
    statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
    excludedStatuses: ["N/A", "ACCEPTED_RISK"],
  };
  return repo;
}

function passAssessment(controlId: string, overrides: Partial<import("../../src/core/repository.js").ControlAssessment> = {}) {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-1", controlId, controlVersion: 1,
    runId: "RUN-1", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" as const },
    status: "PASS" as const, evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: NOW, nextReviewAt: null, notes: null,
    ...overrides,
  };
}

describe("AnalysisService.evaluateRelease — staleness translation", () => {
  it("a fresh PASS assessment (profileRevision matches project) contributes normally", async () => {
    const repo = await makeProjectRepo(1);
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveControlAssessment(passAssessment("TEST-001", { profileRevision: 1 }));
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(100);
  });

  it("a stale assessment (profileRevision does not match the project's current one) is translated to NOT_TESTED for this evaluation", async () => {
    const repo = await makeProjectRepo(2); // project moved to revision 2
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveControlAssessment(passAssessment("TEST-001", { profileRevision: 1 })); // recorded under revision 1
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(0); // the only control is now effectively NOT_TESTED
    const [stored] = await repo.getControlAssessments("PRJ-1");
    expect(stored.status).toBe("PASS"); // stored record is never mutated
  });
});

describe("AnalysisService.evaluateRelease — ACCEPTED_RISK re-validation", () => {
  it("an ACCEPTED_RISK assessment backed by a valid RiskAcceptance contributes normally (excluded from coverage denominator, same as before)", async () => {
    const repo = await makeProjectRepo(1);
    repo.controls = [blockingControl("TEST-001"), blockingControl("TEST-002")];
    await repo.saveRiskAcceptance("PRJ-1", {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    });
    await repo.saveControlAssessment(passAssessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" }));
    await repo.saveControlAssessment(passAssessment("TEST-002"));
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(100); // TEST-001 excluded (ACCEPTED_RISK), TEST-002 assessed -> 100% of applicable
  });

  it("an ACCEPTED_RISK assessment whose RiskAcceptance has since expired is translated to NOT_TESTED, without mutating the stored assessment", async () => {
    const repo = await makeProjectRepo(1);
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveRiskAcceptance("PRJ-1", {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: "TEST-001", findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", // expired before NOW (2026-10-05)
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    });
    await repo.saveControlAssessment(passAssessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" }));
    const service = new AnalysisService(repo, () => NOW);
    const result = await service.evaluateRelease("PRJ-1");
    expect(result.controlCoverage).toBe(0); // now effectively NOT_TESTED, no longer excluded
    const [stored] = await repo.getControlAssessments("PRJ-1");
    expect(stored.status).toBe("ACCEPTED_RISK"); // stored record is never mutated
  });
});

describe("AnalysisService.evaluateRelease — Coverage Gate uses the same translated view as the Control Gate", () => {
  it("coverage computed inside evaluateRelease reflects staleness, even though standalone getScore does not", async () => {
    const repo = await makeProjectRepo(2); // project at revision 2
    repo.controls = [blockingControl("TEST-001")];
    await repo.saveControlAssessment(passAssessment("TEST-001", { profileRevision: 1 })); // stale
    const service = new AnalysisService(repo, () => NOW);

    const released = await service.evaluateRelease("PRJ-1");
    expect(released.controlCoverage).toBe(0); // freshness-aware: the stale PASS doesn't count as covered

    const standalone = await service.getScore("PRJ-1");
    expect(standalone.coverage.coveragePercent).toBe(100); // unaffected: getScore reads raw assessments
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/service/analysis-service.test.ts`
Expected: the 3 fixed pre-existing tests PASS (they're unaffected by `profileRevision`/`runId` beyond having valid values now). The new staleness/ACCEPTED_RISK/Coverage-Gate tests FAIL — `evaluateRelease` doesn't translate anything yet (it passes raw assessments straight through, and `controlCoverage` comes from the unmodified `getScore()` call). The constructor call `new AnalysisService(repo, () => NOW)` itself fails to typecheck/compile if the second parameter doesn't exist yet — confirm the failure includes that, not just assertion mismatches.

- [ ] **Step 7: Implement the injectable clock and switch to the shared translation helper**

Replace the entire contents of `src/service/analysis-service.ts`:

```ts
import type { SecurityRepository } from "../core/repository.js";
import { calculateScore, type Score, type FindingInput as ScoreFindingInput } from "../core/score.js";
import { evaluateRelease, type ReleaseEvaluation, type FindingInput } from "../core/release-evaluator.js";
import { translateAssessmentsForTrust } from "../core/risk-acceptance.js";
import { ServiceError, withNotFound } from "./errors.js";
import { SCORE_MODEL_ID } from "./constants.js";
import { normalizeFindingSeverity, normalizeFinding } from "./severity.js";

export class AnalysisService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async getScore(projectId: string): Promise<Score> {
    await withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
    const [assessments, findings, controls] = await Promise.all([
      this.repository.getControlAssessments(projectId),
      this.repository.getFindings(projectId),
      this.repository.getControls(),
    ]);
    const model = await this.repository.getScoreModel(SCORE_MODEL_ID);
    const normalizedFindings: ScoreFindingInput[] = findings.map((f) => ({
      controlIds: f.controlIds,
      severity: normalizeFindingSeverity(f.severity),
      status: f.status,
    }));
    try {
      return calculateScore(assessments, controls, normalizedFindings, model);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId });
    }
  }

  async evaluateRelease(projectId: string): Promise<ReleaseEvaluation> {
    const project = await withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
    const [findings, assessments, riskAcceptances, controls, model] = await Promise.all([
      this.repository.getFindings(projectId),
      this.repository.getControlAssessments(projectId),
      this.repository.getRiskAcceptances(projectId),
      this.repository.getControls(),
      this.repository.getScoreModel(SCORE_MODEL_ID),
    ]);
    const normalizedFindings: FindingInput[] = findings.map(normalizeFinding);
    const scoreFindings: ScoreFindingInput[] = findings.map((f) => ({
      controlIds: f.controlIds,
      severity: normalizeFindingSeverity(f.severity),
      status: f.status,
    }));

    // One `now` for the whole evaluation — translateAssessmentsForTrust uses this same instant
    // for every RiskAcceptance validity check, so a single evaluateRelease call can never see
    // two different answers for the same expiry boundary.
    const translatedAssessments = translateAssessmentsForTrust(assessments, project.profileRevision, riskAcceptances, this.now());

    let score: Score;
    try {
      score = calculateScore(translatedAssessments, controls, scoreFindings, model);
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId });
    }

    try {
      return evaluateRelease({
        score, findings: normalizedFindings, attackPaths: [], assessments: translatedAssessments,
        securityLevel: project.profile.securityLevel,
      });
    } catch (err) {
      throw new ServiceError("PRECONDITION_FAILED", (err as Error).message, { projectId, securityLevel: project.profile.securityLevel });
    }
  }
}
```

(`translateAssessmentsForTrust`'s return shape — `{ controlId: string; status: ControlAssessment["status"] }[]` — is structurally identical to both `score.ts`'s and `release-evaluator.ts`'s own `ControlAssessmentInput` types, so it satisfies both `calculateScore` and `evaluateRelease`'s parameter types directly with no reshaping or casting.)

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/service/analysis-service.test.ts`
Expected: PASS, all tests (the 3 fixed pre-existing ones plus the new describe blocks from Step 5).

- [ ] **Step 9: Write the failing test for `ReportService.generate`'s freshness-aware trust translation**

`tests/service/report-service.test.ts` already exists with 2 tests, using a `makeGeneratableProject(repo)` helper that seeds all 8 `RELEASE_BLOCKING_CONTROLS` with `PASS` assessments — but those assessment literals, like `tests/service/analysis-service.test.ts`'s, predate `runId`/`profileRevision`. Fix `makeGeneratableProject`'s loop to add `runId: "RUN-1", profileRevision: 1,` to each saved `ControlAssessment` (the fixture already creates `RUN-1` at `profileRevision: 1` and the project at `profileRevision: 1`, so this makes every seeded assessment fresh by construction — the 2 existing tests need no other change). Then append a new `describe` block proving the same staleness/ACCEPTED_RISK-invalidity translation Task 3 added to `AnalysisService` also applies here:

```ts
import { RELEASE_BLOCKING_CONTROLS } from "../../src/core/release-evaluator.js"; // already imported — do not duplicate

describe("ReportService.generate — freshness-aware trust translation", () => {
  it("a stale assessment on a non-blocking-irrelevant control still lowers this report's coverage, even though a direct getScore call would not reflect it", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo); // all 8 blocking controls PASS, fresh (profileRevision 1)
    // Move the project's profile on — every already-recorded assessment is now stale.
    const project = await repo.getProject("PRJ-1");
    await repo.saveProject({ ...project, profileRevision: 2 });
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.releaseEvaluation.result).not.toBe("approved"); // every blocking control is now effectively NOT_TESTED
    expect(report.score.coverage.coveragePercent).toBe(0); // the saved report's own score reflects staleness too
  });

  it("an ACCEPTED_RISK assessment whose RiskAcceptance has since expired is reflected as not-yet-verified in the saved report, without mutating the stored assessment", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const [firstBlockingControl] = [...RELEASE_BLOCKING_CONTROLS];
    await repo.saveRiskAcceptance("PRJ-1", {
      riskAcceptanceId: "RA-001", projectId: "PRJ-1", controlId: firstBlockingControl, findingIds: [],
      reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
      approvedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z", // expired before NOW
      reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    });
    await repo.saveControlAssessment({
      assessmentId: "A-ACCEPTED", projectId: "PRJ-1", controlId: firstBlockingControl, controlVersion: 1,
      runId: "RUN-1", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "ACCEPTED_RISK", evidenceIds: [], findingIds: [], riskAcceptanceId: "RA-001",
      owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: NOW, nextReviewAt: null, notes: null,
    });
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.releaseEvaluation.blockingControlsNotVerified).toContain(firstBlockingControl);
    const [stored] = (await repo.getControlAssessments("PRJ-1")).filter((a) => a.controlId === firstBlockingControl);
    expect(stored.status).toBe("ACCEPTED_RISK"); // stored record is never mutated
  });
});
```

Add `const NOW = "2026-10-06T00:00:00.000Z";` near the top of the file if it doesn't already define one at this exact value distinct from the existing module-level `NOW` — check first: the file already has `const NOW = "2026-09-30T00:00:00.000Z";` at the top, reuse that existing constant for both new tests (passing it as the service's injected clock, same as the file's existing tests already do) rather than introducing a second, confusingly-similar constant — the `"expired before NOW"` comment in the second test should reference whatever the file's real `NOW` constant value is.

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run tests/service/report-service.test.ts`
Expected: the 2 pre-existing tests PASS (now that their fixture's assessments are fresh). The 2 new tests FAIL — `ReportService.generate` doesn't translate anything yet.

- [ ] **Step 11: Implement the `ReportService.generate` fix**

In `src/service/report-service.ts`, add the import:

```ts
import { translateAssessmentsForTrust } from "../core/risk-acceptance.js";
```

Replace the body of `generate` from the `const normalizedFindingsForScore` line through the `evaluateRelease({...})` call with:

```ts
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
```

(The old `normalizedAssessments` variable — the raw, untranslated `{controlId, status}` map — is removed entirely; `translatedAssessments` replaces it as the single array fed to both `calculateScore` and `evaluateRelease`, matching `AnalysisService.evaluateRelease`'s structure exactly.)

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run tests/service/report-service.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 13: Run the full suite and fix any other tests that construct a service or call `evaluateRelease`/`getScore`/`generate` against fixtures lacking `profileRevision`-consistent data**

Run: `npx vitest run`
Expected: likely failures remain in `tests/mcp/tools/analysis-report-tools.test.ts` — any test whose fixture seeds `ControlAssessment`s without `profileRevision` matching the project's `profileRevision` will now see those assessments treated as stale, flipping previously-`"approved"` expectations. Find its fixture-construction helper and ensure every `ControlAssessment` literal it saves includes `profileRevision` equal to the project's own `profileRevision` in that same fixture, and `runId` matching a run the fixture also creates. Do not weaken any assertion to work around this — the fix is always "make the fixture data consistent," never "loosen the check."

- [ ] **Step 14: Update `evaluate_release`'s tool description**

In `src/mcp/tools/evaluate-release.ts`, the current description already correctly explains the three-gate worst-wins combination from the previous spec. Add one clause covering what this spec changes about what `"indeterminate"` can now mean. Change:

```ts
        "Evaluate gate-4 production-release readiness for a project. `result` (\"approved\"|\"blocked\"|" +
        "\"indeterminate\") is the worst-wins combination of three gates: a Finding Gate (open/in-progress " +
        "confirmed_vulnerability findings at critical/high severity — any blocks), a Control Gate (a fixed " +
        "set of release-blocking controls — any at FAIL blocks; any PARTIAL/NOT_TESTED/unassessed makes it " +
        "indeterminate instead of approved), and a Coverage Gate (assessment coverage below threshold makes " +
        "it indeterminate, never downgrading an already-blocked result). `blockingControlFailures` and " +
```

to:

```ts
        "Evaluate gate-4 production-release readiness for a project. `result` (\"approved\"|\"blocked\"|" +
        "\"indeterminate\") is the worst-wins combination of three gates: a Finding Gate (open/in-progress " +
        "confirmed_vulnerability findings at critical/high severity — any blocks), a Control Gate (a fixed " +
        "set of release-blocking controls — any at FAIL blocks; any PARTIAL/NOT_TESTED/unassessed makes it " +
        "indeterminate instead of approved), and a Coverage Gate (assessment coverage below threshold makes " +
        "it indeterminate, never downgrading an already-blocked result). An assessment recorded against a " +
        "profile revision the project has since moved past, or an ACCEPTED_RISK status whose backing " +
        "RiskAcceptance has since expired or been revoked, is treated as not-yet-verified for this " +
        "evaluation only (the stored record itself is unchanged) — this affects both the Control Gate and " +
        "this evaluation's own coverage number, which can therefore differ from a direct get_score call on " +
        "the same project. `blockingControlFailures` and " +
```

- [ ] **Step 15: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, every test file.

- [ ] **Step 16: Commit**

```bash
git add src/core/risk-acceptance.ts src/service/analysis-service.ts src/service/report-service.ts \
  src/mcp/tools/evaluate-release.ts \
  tests/core/risk-acceptance.test.ts tests/service/analysis-service.test.ts tests/service/report-service.test.ts \
  tests/mcp/tools/analysis-report-tools.test.ts
git commit -m "feat(core,service): make every release-evaluation path trust-aware

Both AnalysisService.evaluateRelease and ReportService.generate now
translate assessments through a shared translateAssessmentsForTrust()
before computing a score or release evaluation: is each assessment's
profileRevision still current, and (if ACCEPTED_RISK) is its backing
RiskAcceptance still effectively valid right now, not just when it was
recorded. A translated-to-NOT_TESTED assessment never mutates the
stored ControlAssessment — only each call's in-memory view changes.

ReportService.generate needed the identical fix AnalysisService did:
it independently duplicates the same calculateScore + evaluateRelease
pattern from its own raw assessments read, entirely separate from
AnalysisService. Left unfixed, generate_report would have kept
producing a stale-blind releaseEvaluation/score in every saved
ProjectReport — found during this plan's final review round by reading
report-service.ts directly, not anticipated in the original plan.

Also fixes the Coverage Gate consistency bug the translation step
would otherwise have introduced in AnalysisService: evaluateRelease
previously delegated to getScore() for its coverage number, which
reads raw assessments — inconsistent with the Control Gate's
freshness-aware view from the same evaluation. Both services now call
calculateScore() directly with the same translated assessments array
used for their Control Gate input. getScore() itself, and the
standalone get_score tool, are unchanged and continue reporting raw
coverage.

src/core/release-evaluator.ts and src/core/score.ts are both
untouched by this change — only how the two services call them.

See docs/superpowers/specs/2026-10-05-assessment-trust-integrity-design.md"
```

---

### Task 4: One-time migration script for existing project data

**Files:**
- Create: `scripts/migrate-control-assessment-profile-revision.ts`
- Modify: `tsconfig.json` (add `scripts` to `include` so it's actually typechecked)
- Modify: `package.json` / `package-lock.json` (add `tsx` as a dev dependency to run the script)
- Test: `tests/scripts/migrate-control-assessment-profile-revision.test.ts`

**Interfaces:**
- Consumes (from Task 2): `ControlAssessment.runId`/`profileRevision` as the fields being backfilled. Reads real `JsonRepository`-shaped data on disk directly (not through the repository class, since it needs to read/write assessments that don't yet satisfy the repository's own TS types until backfilled).
- Produces: nothing consumed by other tasks — this is a standalone, run-once operational script.

- [ ] **Step 1: Write the failing test against fixture project data**

Create `tests/scripts/migrate-control-assessment-profile-revision.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateProject } from "../../scripts/migrate-control-assessment-profile-revision.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "csi-mcp-migrate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(projectId: string, runs: { runId: string; profileRevision: number }[], assessments: Record<string, unknown>[]) {
  const projectDir = join(dir, "projects", projectId);
  mkdirSync(join(projectDir, "runs"), { recursive: true });
  for (const run of runs) {
    writeFileSync(join(projectDir, "runs", `${run.runId}.json`), JSON.stringify({ runId: run.runId, projectId, profileRevision: run.profileRevision }));
  }
  writeFileSync(join(projectDir, "assessments.json"), JSON.stringify(assessments));
}

function assessment(controlId: string): Record<string, unknown> {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-SINGLE-RUN", controlId, controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-09-16T00:00:00.000Z", nextReviewAt: null, notes: null,
  };
}

describe("migrateProject", () => {
  it("backfills every assessment with its project's single run's runId/profileRevision", () => {
    writeProject("PRJ-SINGLE-RUN", [{ runId: "RUN-1", profileRevision: 3 }], [assessment("A-001"), assessment("A-002")]);
    const result = migrateProject(dir, "PRJ-SINGLE-RUN");
    expect(result.migrated).toBe(2);
    expect(result.skipped).toEqual([]);
    const written = JSON.parse(readFileSync(join(dir, "projects", "PRJ-SINGLE-RUN", "assessments.json"), "utf-8"));
    expect(written).toHaveLength(2);
    for (const a of written) {
      expect(a.runId).toBe("RUN-1");
      expect(a.profileRevision).toBe(3);
    }
  });

  it("skips and reports every assessment in a project with zero runs", () => {
    const projectDir = join(dir, "projects", "PRJ-NO-RUNS");
    mkdirSync(join(projectDir, "runs"), { recursive: true });
    writeFileSync(join(projectDir, "assessments.json"), JSON.stringify([assessment("A-001")]));
    const result = migrateProject(dir, "PRJ-NO-RUNS");
    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual([{ controlId: "A-001", reason: "no runs found for this project" }]);
  });

  it("skips and reports every assessment in a project with more than one run (ambiguous join)", () => {
    writeProject("PRJ-TWO-RUNS", [{ runId: "RUN-1", profileRevision: 1 }, { runId: "RUN-2", profileRevision: 2 }], [assessment("A-001")]);
    const result = migrateProject(dir, "PRJ-TWO-RUNS");
    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual([{ controlId: "A-001", reason: "2 runs found for this project — ambiguous, needs manual review" }]);
  });

  it("skips and reports an assessment whose matched run has no profileRevision", () => {
    const projectDir = join(dir, "projects", "PRJ-BAD-RUN");
    mkdirSync(join(projectDir, "runs"), { recursive: true });
    writeFileSync(join(projectDir, "runs", "RUN-1.json"), JSON.stringify({ runId: "RUN-1", projectId: "PRJ-BAD-RUN" })); // no profileRevision
    writeFileSync(join(projectDir, "assessments.json"), JSON.stringify([assessment("A-001")]));
    const result = migrateProject(dir, "PRJ-BAD-RUN");
    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual([{ controlId: "A-001", reason: "matched run RUN-1 has no profileRevision" }]);
  });

  it("is idempotent: re-running on already-migrated data changes nothing and reports 0 migrated, 0 skipped", () => {
    writeProject("PRJ-SINGLE-RUN", [{ runId: "RUN-1", profileRevision: 3 }], [assessment("A-001")]);
    migrateProject(dir, "PRJ-SINGLE-RUN");
    const second = migrateProject(dir, "PRJ-SINGLE-RUN");
    expect(second.migrated).toBe(0);
    expect(second.skipped).toEqual([]);
  });

  it("throws and leaves the file untouched if a transformed assessment would fail schema validation (pre-existing corruption, not something the migration itself can introduce)", () => {
    const corrupt = { ...assessment("A-001") };
    delete (corrupt as Record<string, unknown>).assessedAt; // simulates pre-existing bad data, independent of this migration
    writeProject("PRJ-CORRUPT", [{ runId: "RUN-1", profileRevision: 3 }], [corrupt]);
    const before = readFileSync(join(dir, "projects", "PRJ-CORRUPT", "assessments.json"), "utf-8");
    expect(() => migrateProject(dir, "PRJ-CORRUPT")).toThrow(/schema validation/);
    const after = readFileSync(join(dir, "projects", "PRJ-CORRUPT", "assessments.json"), "utf-8");
    expect(after).toBe(before); // nothing written — the safety net aborts before any write
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/scripts/migrate-control-assessment-profile-revision.test.ts`
Expected: FAIL — `scripts/migrate-control-assessment-profile-revision.ts` doesn't exist yet.

- [ ] **Step 3: Implement the migration script**

Create `scripts/migrate-control-assessment-profile-revision.ts`. Two hardening details added after this plan's final GPT review round, beyond the original draft: an **atomic write** (tmp-file-then-rename, mirroring `writeJsonAtomic`'s existing pattern in `src/core/repository.ts` — inlined here rather than importing that function, since it isn't exported, and this script is already an intentional, narrowly-scoped exception to going through the repository class at all), and a **post-transformation schema validation pass** before writing anything, using this codebase's existing `compileSchemaFromFile` from `src/validate.ts` — if any transformed record would fail the real `control-assessment-schema.json`, the script aborts with no write at all, rather than persisting data it can't guarantee is valid:

```ts
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { compileSchemaFromFile } from "../src/validate.js";

interface MigrationResult {
  migrated: number;
  skipped: { controlId: string; reason: string }[];
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, path);
}

export function migrateProject(dataDir: string, projectId: string): MigrationResult {
  const projectDir = join(dataDir, "projects", projectId);
  const assessmentsPath = join(projectDir, "assessments.json");
  if (!existsSync(assessmentsPath)) {
    return { migrated: 0, skipped: [] };
  }
  const assessments: Record<string, unknown>[] = JSON.parse(readFileSync(assessmentsPath, "utf-8"));

  const runsDir = join(projectDir, "runs");
  const runFiles = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith(".json")) : [];
  const runs = runFiles.map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf-8")) as { runId: string; profileRevision?: number });

  const result: MigrationResult = { migrated: 0, skipped: [] };
  const next = assessments.map((a) => {
    // Already migrated: leave untouched, don't count as migrated or skipped (idempotent re-run).
    if (typeof a.runId === "string" && typeof a.profileRevision === "number") {
      return a;
    }
    const controlId = String(a.controlId ?? a.assessmentId ?? "<unknown>");
    if (runs.length === 0) {
      result.skipped.push({ controlId, reason: "no runs found for this project" });
      return a;
    }
    if (runs.length > 1) {
      result.skipped.push({ controlId, reason: `${runs.length} runs found for this project — ambiguous, needs manual review` });
      return a;
    }
    const [run] = runs;
    if (typeof run.profileRevision !== "number") {
      result.skipped.push({ controlId, reason: `matched run ${run.runId} has no profileRevision` });
      return a;
    }
    result.migrated++;
    return { ...a, runId: run.runId, profileRevision: run.profileRevision };
  });

  if (result.migrated > 0) {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const invalid = next.filter((a) => !validate(a));
    if (invalid.length > 0) {
      throw new Error(
        `migrateProject(${projectId}): ${invalid.length} transformed assessment(s) failed schema validation — ` +
        `aborting without writing. First error: ${JSON.stringify(validate.errors?.[0])}`
      );
    }
    writeJsonAtomic(assessmentsPath, next);
  }

  return result;
}

function main(): void {
  const dataDir = process.argv[2] ?? "data";
  const projectsDir = join(dataDir, "projects");
  if (!existsSync(projectsDir)) {
    console.error(`No projects directory found at ${projectsDir}`);
    process.exit(1);
  }
  const projectIds = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let totalMigrated = 0;
  const totalSkipped: { projectId: string; controlId: string; reason: string }[] = [];
  for (const projectId of projectIds) {
    const result = migrateProject(dataDir, projectId);
    totalMigrated += result.migrated;
    for (const s of result.skipped) totalSkipped.push({ projectId, ...s });
    if (result.migrated > 0 || result.skipped.length > 0) {
      console.error(`${projectId}: migrated ${result.migrated}, skipped ${result.skipped.length}`);
    }
  }
  console.error(`\nTotal: migrated ${totalMigrated} assessment(s) across ${projectIds.length} project(s).`);
  if (totalSkipped.length > 0) {
    console.error(`${totalSkipped.length} assessment(s) skipped — needs manual review:`);
    for (const s of totalSkipped) console.error(`  ${s.projectId} / ${s.controlId}: ${s.reason}`);
  }
}

if (process.argv[1]?.endsWith("migrate-control-assessment-profile-revision.ts")) {
  main();
}
```

(`console.error` is used throughout, not `console.log` — this project's `src/mcp/server.ts` has a hard rule against writing to stdout anywhere in the MCP server process since `StdioServerTransport` uses it as the JSON-RPC channel. This script is not part of the server process, but using `console.error` uniformly across the whole codebase avoids anyone copy-pasting a `console.log` from this file into server code later.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/scripts/migrate-control-assessment-profile-revision.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Make `scripts/` typecheckable and runnable**

`scripts/` is not in either `tsconfig.json`'s or `tsconfig.build.json`'s `include` array today — `npx tsc --noEmit` currently only covers `src` and `tests`, so without this step the new script would silently never be typechecked, and there is no installed tool to execute a `.ts` file directly yet. Two small, deliberate changes:

In `tsconfig.json`, change:

```json
  "include": ["src", "tests"]
```

to:

```json
  "include": ["src", "tests", "scripts"]
```

(`tsconfig.build.json`'s own `"include": ["src"]` is left unchanged — the migration script must never ship inside `dist/`, consistent with it being a standalone, run-once tool, not part of the ongoing MCP server.)

Add `tsx` as a dev dependency so the script can actually be run once (it's a thin, zero-config TS runner — this codebase has no other TS-execution tool installed outside Vitest's own internal transform, which only handles files under `tests/`, not a direct `node scripts/...` invocation):

```bash
npm install --save-dev tsx
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean — this now actually typechecks `scripts/migrate-control-assessment-profile-revision.ts` for the first time; fix any real type error it surfaces rather than narrowing the `tsconfig.json` change back down to avoid seeing it.

Run: `npx vitest run`
Expected: PASS, every test file.

- [ ] **Step 7: Run the migration against the real 6 validation projects and commit the script plus its results**

Run: `npx tsx scripts/migrate-control-assessment-profile-revision.ts data`
Expected: console output reporting how many assessments were migrated per project across the 6 real projects under `data/projects/` (gitignored — this run modifies files on disk but nothing new gets committed from `data/projects/` itself, consistent with LEGAL-GITIGNORE-001). If any assessments are reported skipped, note them in the commit message and in your task report for human follow-up — do not attempt to resolve an ambiguous or missing-run case programmatically.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate-control-assessment-profile-revision.ts tests/scripts/migrate-control-assessment-profile-revision.test.ts \
  tsconfig.json package.json package-lock.json
git commit -m "chore(scripts): one-time migration backfilling ControlAssessment.runId/profileRevision

Backfills the 6 existing real validation projects' assessment records
with the two new required fields Task 2 added, via an explicit
per-assessment join against each project's AssessmentRun data rather
than assuming every project has exactly one run. Any assessment with
no matching run, an ambiguous multi-run match, or a matched run
missing its own profileRevision is left untouched and reported for
manual review, not guessed at. Not wired into npm test, npm run
build, or the MCP server — a standalone, run-once script.

See docs/superpowers/specs/2026-10-05-assessment-trust-integrity-design.md"
```

---

## Self-Review Notes (for whoever runs this plan)

- **Spec coverage:** §3.1 (RiskAcceptance) → Task 1 + the ACCEPTED_RISK-validation half of Task 2. §3.2 (N/A cross-check) → the N/A half of Task 2. §3.3 (staleness, shared trust translation, Coverage Gate fix in both `AnalysisService` and `ReportService`, migration) → the runId/profileRevision-capture half of Task 2, all of Task 3, and Task 4. §4 (Interface Changes) → covered across Tasks 1-3's Interfaces blocks. §5 (Testing Strategy) → every bullet maps to a step above (RiskAcceptance validity parameterized tests: Task 1 Step 8; record-time ACCEPTED_RISK cases: Task 2 Step 3; record-time N/A cases: Task 2 Step 3; runId/profileRevision capture + run-mismatch rejection: Task 2 Step 9; `translateAssessmentsForTrust` unit tests: Task 3 Step 1; staleness/ACCEPTED_RISK-re-validation/no-mutation behavior at the service level, for both `AnalysisService` and `ReportService`: Task 3 Steps 5 and 9; Coverage Gate freshness (the single most important condition from the final review): Task 3 Step 5's dedicated `describe` block, and Task 3 Step 9's first `ReportService` test; migration script, including the schema-validation safety net: Task 4 Step 1). §7 (Out of Scope) → nothing in this plan touches audit trail/`assessedBy` identity, concurrent-write locking, a multi-party RiskAcceptance approval workflow, `src/core/score.ts`'s own logic, the standalone `get_score` tool's behavior, or per-control dependency tracking — confirmed by each task's file list above.
- **Task ordering is a real dependency chain, not just numbering:** Task 2 imports `isRiskAcceptanceEffectivelyValid` and calls `repository.getRiskAcceptances` from Task 1 (via the new `RiskAcceptanceService`'s sibling helper module, not the service itself — Task 2's own validation calls `isRiskAcceptanceEffectivelyValid` directly). Task 3 depends on both Task 1 (same helper, extended with `translateAssessmentsForTrust`) and Task 2 (`ControlAssessment.profileRevision`/`runId` existing). Task 4 depends only on Task 2's schema change existing, but is sequenced last since it's the one task whose "test" is partly "run it for real against production data" (Step 7), which should happen once the rest of the trust-hardening logic that *reads* those fields is already in place and tested.
- **A known, intentional transient state inside Task 2:** between Task 2 Step 1 (schema requires `runId`/`profileRevision`) and Step 5 (the TS interface and service logic actually populate them), `npx tsc --noEmit` is not run — Step 1 is purely a JSON Schema + Ajv-test change, which doesn't affect TypeScript compilation at all (the schema and the TS interface are validated independently in this codebase, as evidenced by `tests/schemas/*.test.ts` being Ajv-only and separate from the `.ts` interfaces). This is why Step 1's "run to verify" step is scoped to the schema test file only, not the whole suite.
- **Why Task 3 touches two services instead of one, and why both go through a shared core helper instead of each having its own inline translation:** the Coverage Gate bug (score computed from raw assessments while the Control Gate sees a translated view) can only be fixed by computing both gates' inputs from the same array — there is no smaller change that fixes the inconsistency without doing this, for *each* caller independently. `ReportService.generate` was found, during this plan's final review round, to be a second independent caller of the exact same `calculateScore` + `evaluateRelease` pattern — confirmed by reading `src/service/report-service.ts` directly before writing Task 3, not assumed. Putting `translateAssessmentsForTrust` in `src/core/risk-acceptance.ts` (pure, no I/O) rather than inlining the same logic separately in both `AnalysisService` and `ReportService` was a deliberate DRY choice: two independent inline copies would have been exactly the kind of drift-prone duplication this plan's own motivating bug (the original dead `incidentResponseVerified`/`backupRestoreVerified` calculation, from the prior spec) came from. The alternative of teaching `getScore()` itself to accept a pre-translated assessments array as an optional parameter was considered and rejected: it would make `getScore()`'s public contract more complex for a capability only the two release-decision call sites need, whereas calling the already-exported `calculateScore()` directly keeps `getScore()` exactly as simple as it already is.
- **Nothing in `src/core/release-evaluator.ts`, `src/core/score.ts`, `src/mcp/tools/record-assessment.ts`, `src/mcp/tools/get-score.ts`, `src/mcp/tools/generate-report.ts`, or `src/core/report-builder.ts` needs modification** — all were checked against this plan's scope before writing it. `record-assessment.ts` (the MCP tool wrapper) needs no change because its `inputSchema` and handler both already pass `input` straight through to `AssessmentService.recordAssessment`, whose *signature* (`RecordAssessmentInput`) is unchanged by this plan — only its internal validation and what it stamps onto the saved `ControlAssessment` changed. `report-builder.ts` was confirmed to never construct or read a raw `ControlAssessment` — it consumes only `ScoreForReport`/`ReleaseEvaluationForReport`, both already-computed output shapes unaffected by this plan's input-side changes. **`src/service/report-service.ts` is explicitly NOT on this list** — an earlier draft of this plan incorrectly included it, on the mistaken belief (never actually verified by reading the file) that it behaved like `report-builder.ts`. Task 3 modifies it. This line is left here as a record of that correction, not a claim it's untouched.
- **If a plan executor finds a reason to touch any of the "no modification needed" files above, stop and re-check against the real current source** — this plan's authors verified they don't need it as of commit `24ca2db`.
