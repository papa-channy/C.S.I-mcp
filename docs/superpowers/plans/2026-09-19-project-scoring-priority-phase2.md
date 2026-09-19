# Project Scoring, Priority Mapping & Agent Workflow — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 1 JSON data foundation with the schemas needed to run a security review against a real project: `Project`, `AssessmentPlan`/`AssessmentRun`/`AssessmentBatch` (configurable agent grouping), a provenance-carrying `priority`/`criticality` dual index on `Finding`, a coverage-aware hierarchical `Score`, and an immutable-snapshot `ProjectReport`.

**Architecture:** Same as Phase 1 — hand-authored JSON Schema (draft 2020-12) documents plus reference data under `data/`, validated by the existing TypeScript + Ajv + Vitest harness (`src/validate.ts`, unchanged). One existing schema (`finding-schema.json`) is modified in place; everything else is additive. No server code, no database, no computed values — this plan only produces and validates the data contracts.

**Tech Stack:** Node.js, TypeScript, Ajv (`ajv/dist/2020`) + `ajv-formats`, Vitest — unchanged from Phase 1, already scaffolded in this repository.

**Spec:** `docs/superpowers/specs/2026-09-18-project-scoring-priority-design.md`

## Global Constraints

- All JSON Schema files use draft 2020-12 (`"$schema": "https://json-schema.org/draft/2020-12/schema"`).
- `criticality` on `Finding` is a **computed value** with provenance (`index`, `formulaId`, `formulaVersion`, `computedAt`) — never a bare agent-set integer.
- `priority` on `Finding` is an **agent-judgment value** with provenance (`index`, `source`, `rationale`, `assignedBy`, `assignedAt`) — never derived from `criticality` by a formula.
- Guardrail: a `Finding` with `criticality.index >= 8` and `priority.index >= 2` requires a non-empty `priorityOverrideReason`.
- `priority.index` is the primary sort key for any prioritized-findings ordering (ascending = more urgent first); `criticality.index` is the secondary/tie-break key (descending); `findingId` (ascending) is the final tie-break for total ordering.
- The renamed field is `detectionDifficulty` (0 = easy to detect, 2 = hard to detect), replacing Phase 1's `detectability` everywhere it appears in `finding-schema.json`.
- Every tunable formula (criticality weights, score model) lives in its own schema-validated reference data file under `data/core/`, never hardcoded into a JSON Schema or test.
- A weight/formula file's internal arithmetic invariants (e.g. weights summing to 1.0) are verified by a **test**, never by JSON Schema itself (JSON Schema cannot express a "sum of these properties" constraint).
- `AssessmentBatch` always belongs to exactly one `AssessmentRun` (`runId`, required); `AssessmentRun` always belongs to exactly one `AssessmentPlan` (`planId` + `planVersion`, both required).
- `Score.coverage` and every `domainScores[]` entry's coverage/status-count fields are always present alongside `overallScore`/`score` — a score is never reported without also stating how much of the catalog it covers.
- `ProjectReport` is an immutable snapshot: it always records `assessmentRunId`, `catalogVersion`, `profileRevision`, and `criticalityFormula` (id+version) alongside `score.scoreModel` (id+version), so a report stays reproducible after the catalog, profile, or formulas change later.
- All human-readable text values (`requirement`-equivalents, descriptions, rationale strings) are written in English.
- File paths never imply meaning — `domain`/`subdomain`/`layer`/`group` stay explicit fields on `Control` (unchanged from Phase 1); nothing in this phase changes that.

---

### Task 1: Modify `finding-schema.json` — rename, restructure P/C, add the override guardrail

**Files:**
- Modify: `data/schemas/finding-schema.json`
- Modify: `tests/schemas/finding-attack-path-schemas.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Phase 1, unchanged).
- Produces: the updated `Finding` shape (`criticality`/`priority` as objects, `detectionDifficulty`, `priorityOverrideReason`) that Tasks 2 and 9 reference conceptually (Task 2's formula field names must match `detectionDifficulty`; Task 9's `prioritizedFindings` preview field names `priorityIndex`/`criticalityIndex` come from this task's `priority.index`/`criticality.index`).

This task modifies a schema Phase 1 already shipped and tested. The existing Finding fixture in `tests/schemas/finding-attack-path-schemas.test.ts` uses the old flat `detectability`/no-`criticality`/no-`priority` shape — it must be updated in the same commit or Phase 1's tests regress. The file also contains an unrelated `attack-path-schema` test block — reproduce it unchanged.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `tests/schemas/finding-attack-path-schemas.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("finding-schema", () => {
  const valid = {
    findingId: "FND-001",
    title: "Admin API reachable without authentication",
    controlIds: ["IAM-AUTH-001", "IAM-AUTHZ-003"],
    threatIds: ["THR-IAM-UNAUTHENTICATED-ACCESS"],
    attackScenario: "An unauthenticated request to /admin/users returns the full user list.",
    impact: 5,
    exploitability: 4,
    exposure: 3,
    privilegeRequired: 0,
    detectionDifficulty: 1,
    criticality: {
      index: 9,
      formulaId: "CRIT-DEFAULT",
      formulaVersion: "1.0.0",
      computedAt: "2026-09-19T05:00:00Z",
    },
    priority: {
      index: 0,
      source: "agent",
      rationale: "Unauthenticated admin data exposure is actively exploitable right now.",
      assignedBy: "agent-security-01",
      assignedAt: "2026-09-19T05:00:00Z",
    },
    severity: "critical",
    status: "open",
  };

  it("accepts a well-formed finding referencing multiple controls", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a finding with no controlIds", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    expect(validate({ ...valid, controlIds: [] })).toBe(false);
  });

  it("rejects an out-of-range impact score", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    expect(validate({ ...valid, impact: 9 })).toBe(false);
  });

  it("rejects a priority object missing rationale", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const { rationale, ...restPriority } = valid.priority;
    expect(validate({ ...valid, priority: restPriority })).toBe(false);
  });

  it("rejects a criticality object missing formulaVersion", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const { formulaVersion, ...restCriticality } = valid.criticality;
    expect(validate({ ...valid, criticality: restCriticality })).toBe(false);
  });

  it("requires priorityOverrideReason when criticality.index>=8 and priority.index>=2", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const highCLowUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 9 },
      priority: { ...valid.priority, index: 3 },
    };
    expect(validate(highCLowUrgency)).toBe(false);
  });

  it("accepts priorityOverrideReason satisfying the guardrail", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const highCLowUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 9 },
      priority: { ...valid.priority, index: 3 },
      priorityOverrideReason: "Exploitation requires an already-authenticated session; scheduled for next sprint.",
    };
    expect(validate(highCLowUrgency), JSON.stringify(validate.errors)).toBe(true);
  });

  it("does not require priorityOverrideReason when priority.index is below 2, even at high criticality", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const highCHighUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 9 },
      priority: { ...valid.priority, index: 1 },
    };
    expect(validate(highCHighUrgency), JSON.stringify(validate.errors)).toBe(true);
  });

  it("does not require priorityOverrideReason when criticality.index is below 8, even at low urgency", () => {
    const validate = compileSchemaFromFile("data/schemas/finding-schema.json");
    const lowCLowUrgency = {
      ...valid,
      criticality: { ...valid.criticality, index: 5 },
      priority: { ...valid.priority, index: 9 },
    };
    expect(validate(lowCLowUrgency), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("attack-path-schema", () => {
  const valid = {
    attackPathId: "AP-001",
    entryPoint: "Public marketing site contact form",
    initialPrivilege: "anonymous",
    steps: ["Reflected XSS in contact form", "Steal admin session cookie", "Access admin API", "Export customer data"],
    targetAsset: "AST-017",
    existingControls: ["APPSEC-XSS-002"],
    failedControls: ["IAM-SESSION-003"],
    result: "possible",
    relatedFindingIds: ["FND-001"],
  };

  it("accepts a well-formed attack path", () => {
    const validate = compileSchemaFromFile("data/schemas/attack-path-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an attack path with no steps", () => {
    const validate = compileSchemaFromFile("data/schemas/attack-path-schema.json");
    expect(validate({ ...valid, steps: [] })).toBe(false);
  });

  it("rejects an invalid result value", () => {
    const validate = compileSchemaFromFile("data/schemas/attack-path-schema.json");
    expect(validate({ ...valid, result: "maybe" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/finding-schema.json` still has the old flat `detectability`/no-object `criticality`/`priority` shape, so most of the new Finding assertions fail.

- [ ] **Step 3: Replace the full contents of `data/schemas/finding-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/finding-schema.json",
  "title": "Finding",
  "type": "object",
  "properties": {
    "findingId": { "type": "string", "pattern": "^FND-[0-9]+$" },
    "title": { "type": "string", "minLength": 1 },
    "affectedAsset": { "type": "string" },
    "controlIds": { "type": "array", "minItems": 1, "items": { "type": "string" } },
    "threatIds": { "type": "array", "items": { "type": "string", "pattern": "^THR-[A-Z0-9-]+$" } },
    "attackSurface": { "type": "string" },
    "precondition": { "type": "string" },
    "attackScenario": { "type": "string", "minLength": 1 },
    "technicalImpact": { "type": "string" },
    "businessImpact": { "type": "string" },
    "impact": { "type": "integer", "minimum": 1, "maximum": 5 },
    "exploitability": { "type": "integer", "minimum": 1, "maximum": 5 },
    "exposure": { "type": "integer", "minimum": 1, "maximum": 3 },
    "privilegeRequired": { "type": "integer", "minimum": 0, "maximum": 2 },
    "detectionDifficulty": { "type": "integer", "minimum": 0, "maximum": 2 },
    "criticality": {
      "type": "object",
      "properties": {
        "index": { "type": "integer", "minimum": 0, "maximum": 9 },
        "formulaId": { "type": "string", "minLength": 1 },
        "formulaVersion": { "type": "string", "minLength": 1 },
        "computedAt": { "type": "string", "format": "date-time" }
      },
      "required": ["index", "formulaId", "formulaVersion", "computedAt"],
      "additionalProperties": false
    },
    "priority": {
      "type": "object",
      "properties": {
        "index": { "type": "integer", "minimum": 0, "maximum": 9 },
        "source": { "type": "string", "enum": ["agent", "human"] },
        "rationale": { "type": "string", "minLength": 1 },
        "assignedBy": { "type": "string", "minLength": 1 },
        "assignedAt": { "type": "string", "format": "date-time" }
      },
      "required": ["index", "source", "rationale", "assignedBy", "assignedAt"],
      "additionalProperties": false
    },
    "priorityOverrideReason": { "type": "string", "minLength": 1 },
    "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "informational"] },
    "evidenceIds": { "type": "array", "items": { "type": "string" } },
    "remediation": { "type": "string" },
    "compensatingControls": { "type": "array", "items": { "type": "string" } },
    "owner": { "type": "string" },
    "status": { "type": "string", "enum": ["open", "in_progress", "resolved", "accepted", "false_positive"] },
    "dueDate": { "type": ["string", "null"], "format": "date-time" },
    "retestResult": { "type": ["string", "null"] }
  },
  "required": [
    "findingId", "title", "controlIds", "attackScenario", "impact",
    "exploitability", "exposure", "privilegeRequired", "detectionDifficulty",
    "criticality", "priority", "severity", "status"
  ],
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "criticality": { "properties": { "index": { "minimum": 8 } }, "required": ["index"] },
          "priority": { "properties": { "index": { "minimum": 2 } }, "required": ["index"] }
        },
        "required": ["criticality", "priority"]
      },
      "then": {
        "required": ["priorityOverrideReason"]
      }
    }
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 12 assertions in this test file pass (9 Finding + 3 AttackPath), full suite green.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/finding-schema.json tests/schemas/finding-attack-path-schemas.test.ts
git commit -m "feat: restructure Finding priority/criticality as provenance objects with override guardrail"
```

---

### Task 2: `criticality-formula-schema.json` + `core/criticality-weights.json`

**Files:**
- Create: `data/schemas/criticality-formula-schema.json`
- Create: `data/core/criticality-weights.json`
- Create: `tests/schemas/criticality-formula-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`.
- Produces: `data/core/criticality-weights.json`, whose `formulaId`/`version` (`"CRIT-DEFAULT"`/`"1.0.0"`) are the exact values Task 1's Finding fixtures use in `criticality.formulaId`/`criticality.formulaVersion`.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/criticality-formula-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";

describe("criticality-formula-schema", () => {
  const valid = {
    formulaId: "CRIT-DEFAULT",
    version: "1.0.0",
    scaleMax: 9,
    directions: {
      impact: "higher_is_worse",
      exploitability: "higher_is_worse",
      exposure: "higher_is_worse",
      privilegeRequired: "lower_is_worse",
      detectionDifficulty: "higher_is_worse",
    },
    ranges: {
      impact: { min: 1, max: 5 },
      exploitability: { min: 1, max: 5 },
      exposure: { min: 1, max: 3 },
      privilegeRequired: { min: 0, max: 2 },
      detectionDifficulty: { min: 0, max: 2 },
    },
    weights: {
      impact: 0.35,
      exploitability: 0.25,
      exposure: 0.15,
      privilegeRequired: 0.15,
      detectionDifficulty: 0.1,
    },
    rounding: "round",
  };

  it("accepts a well-formed formula definition", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a formula missing a weight", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    const { impact, ...restWeights } = valid.weights;
    expect(validate({ ...valid, weights: restWeights })).toBe(false);
  });

  it("rejects a scaleMax other than 9", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    expect(validate({ ...valid, scaleMax: 10 })).toBe(false);
  });
});

describe("core/criticality-weights.json", () => {
  it("validates against criticality-formula-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/criticality-formula-schema.json");
    const data = loadJson<object>("data/core/criticality-weights.json");
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });

  it("has weights that sum to 1.0 within a small tolerance", () => {
    const data = loadJson<{ weights: Record<string, number> }>("data/core/criticality-weights.json");
    const sum = Object.values(data.weights).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — neither `data/schemas/criticality-formula-schema.json` nor `data/core/criticality-weights.json` exists.

- [ ] **Step 3: Write `data/schemas/criticality-formula-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/criticality-formula-schema.json",
  "title": "CriticalityFormula",
  "type": "object",
  "properties": {
    "formulaId": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "minLength": 1 },
    "scaleMax": { "const": 9 },
    "directions": {
      "type": "object",
      "properties": {
        "impact": { "const": "higher_is_worse" },
        "exploitability": { "const": "higher_is_worse" },
        "exposure": { "const": "higher_is_worse" },
        "privilegeRequired": { "const": "lower_is_worse" },
        "detectionDifficulty": { "const": "higher_is_worse" }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"],
      "additionalProperties": false
    },
    "ranges": {
      "type": "object",
      "properties": {
        "impact": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 5 } }, "required": ["min", "max"], "additionalProperties": false },
        "exploitability": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 5 } }, "required": ["min", "max"], "additionalProperties": false },
        "exposure": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 3 } }, "required": ["min", "max"], "additionalProperties": false },
        "privilegeRequired": { "type": "object", "properties": { "min": { "const": 0 }, "max": { "const": 2 } }, "required": ["min", "max"], "additionalProperties": false },
        "detectionDifficulty": { "type": "object", "properties": { "min": { "const": 0 }, "max": { "const": 2 } }, "required": ["min", "max"], "additionalProperties": false }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"],
      "additionalProperties": false
    },
    "weights": {
      "type": "object",
      "properties": {
        "impact": { "type": "number", "minimum": 0, "maximum": 1 },
        "exploitability": { "type": "number", "minimum": 0, "maximum": 1 },
        "exposure": { "type": "number", "minimum": 0, "maximum": 1 },
        "privilegeRequired": { "type": "number", "minimum": 0, "maximum": 1 },
        "detectionDifficulty": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"],
      "additionalProperties": false
    },
    "rounding": { "type": "string", "enum": ["round", "floor", "ceil"] }
  },
  "required": ["formulaId", "version", "scaleMax", "directions", "ranges", "weights", "rounding"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Write `data/core/criticality-weights.json`**

```json
{
  "formulaId": "CRIT-DEFAULT",
  "version": "1.0.0",
  "scaleMax": 9,
  "directions": {
    "impact": "higher_is_worse",
    "exploitability": "higher_is_worse",
    "exposure": "higher_is_worse",
    "privilegeRequired": "lower_is_worse",
    "detectionDifficulty": "higher_is_worse"
  },
  "ranges": {
    "impact": { "min": 1, "max": 5 },
    "exploitability": { "min": 1, "max": 5 },
    "exposure": { "min": 1, "max": 3 },
    "privilegeRequired": { "min": 0, "max": 2 },
    "detectionDifficulty": { "min": 0, "max": 2 }
  },
  "weights": {
    "impact": 0.35,
    "exploitability": 0.25,
    "exposure": 0.15,
    "privilegeRequired": 0.15,
    "detectionDifficulty": 0.1
  },
  "rounding": "round"
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: all 5 assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/criticality-formula-schema.json data/core/criticality-weights.json tests/schemas/criticality-formula-schema.test.ts
git commit -m "feat: add criticality formula schema and default weights"
```

---

### Task 3: `project-schema.json`

**Files:**
- Create: `data/schemas/project-schema.json`
- Create: `tests/schemas/project-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts`.
- Produces: `data/schemas/project-schema.json`. No other task in this plan depends on it directly, but it establishes `Project.profileRevision`, which `AssessmentRun` (Task 5) and `ProjectReport` (Task 9) reference conceptually (both have their own `profileRevision` integer field — not schema-linked across files, matching this project's established convention of self-contained schemas).

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/project-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("project-schema", () => {
  const valid = {
    projectId: "PRJ-001",
    name: "Example Storefront",
    owner: "security-team",
    createdAt: "2026-09-19T05:00:00Z",
    profileRevision: 1,
    profile: {
      securityLevel: "SVL-2",
      exposure: ["internet_public"],
      components: ["browser_frontend", "backend_api", "database"],
      identities: ["anonymous", "user", "administrator"],
      dataClasses: ["D1", "D2"],
      features: {
        authentication: true,
        authorization: true,
        adminInterface: true,
        fileUpload: false,
        payment: true,
        webhook: false,
        oauth: false,
        ai: false,
      },
      technologies: {
        languages: ["typescript"],
        frameworks: ["nextjs"],
        databases: ["postgresql"],
        cloud: ["aws"],
      },
    },
  };

  it("accepts a well-formed project", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a profile that embeds a projectId", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const withProjectId = { ...valid, profile: { ...valid.profile, projectId: "PRJ-001" } };
    expect(validate(withProjectId)).toBe(false);
  });

  it("rejects a project missing profileRevision", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const { profileRevision, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("accepts a profile with some feature flags omitted (unknown, not false)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const { fileUpload, ai, ...restFeatures } = valid.profile.features;
    const partial = { ...valid, profile: { ...valid.profile, features: restFeatures } };
    expect(validate(partial), JSON.stringify(validate.errors)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/project-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/project-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/project-schema.json",
  "title": "Project",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "owner": { "type": "string", "minLength": 1 },
    "repositoryUrl": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "profileRevision": { "type": "integer", "minimum": 1 },
    "profile": {
      "type": "object",
      "properties": {
        "securityLevel": { "type": "string", "enum": ["SVL-0", "SVL-1", "SVL-2", "SVL-3"] },
        "exposure": {
          "type": "array", "minItems": 1,
          "items": { "type": "string", "enum": ["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"] }
        },
        "components": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "identities": {
          "type": "array",
          "items": { "type": "string", "enum": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"] }
        },
        "dataClasses": { "type": "array", "items": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] } },
        "features": {
          "type": "object",
          "properties": {
            "authentication": { "type": "boolean" }, "authorization": { "type": "boolean" },
            "adminInterface": { "type": "boolean" }, "fileUpload": { "type": "boolean" },
            "payment": { "type": "boolean" }, "webhook": { "type": "boolean" },
            "oauth": { "type": "boolean" }, "ai": { "type": "boolean" }
          },
          "additionalProperties": { "type": "boolean" }
        },
        "technologies": {
          "type": "object",
          "properties": {
            "languages": { "type": "array", "items": { "type": "string" } },
            "frameworks": { "type": "array", "items": { "type": "string" } },
            "databases": { "type": "array", "items": { "type": "string" } },
            "cloud": { "type": "array", "items": { "type": "string" } }
          },
          "additionalProperties": false
        }
      },
      "required": ["securityLevel", "exposure", "components", "identities", "dataClasses", "features", "technologies"],
      "additionalProperties": false
    }
  },
  "required": ["projectId", "name", "owner", "createdAt", "profileRevision", "profile"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/project-schema.json tests/schemas/project-schema.test.ts
git commit -m "feat: add project-schema.json"
```

---

### Task 4: `assessment-plan-schema.json`

**Files:**
- Create: `data/schemas/assessment-plan-schema.json`
- Create: `tests/schemas/assessment-plan-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts`.
- Produces: `data/schemas/assessment-plan-schema.json` — Task 5 (`AssessmentRun`) references `planId`/`planVersion` conceptually (not via schema `$ref`), and Task 6 (`AssessmentBatch`) reuses the same `groupBy` enum verbatim.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/assessment-plan-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("assessment-plan-schema", () => {
  const valid = {
    planId: "PLAN-DEFAULT",
    version: 1,
    projectId: "PRJ-001",
    groupBy: "domain",
    defaultMaxParallelAgents: 4,
    createdAt: "2026-09-19T05:00:00Z",
  };

  it("accepts a minimal well-formed plan", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a plan with selection and groupOverrides", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    const withExtras = {
      ...valid,
      selection: {
        assessmentStatuses: ["FAIL", "PARTIAL"],
        domains: ["authentication"],
      },
      groupOverrides: [{ groupValue: "authentication", maxParallelAgents: 2 }],
    };
    expect(validate(withExtras), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts groupBy: controlId for one-agent-per-control", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    expect(validate({ ...valid, groupBy: "controlId" }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown groupBy value", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    expect(validate({ ...valid, groupBy: "threat" })).toBe(false);
  });

  it("rejects a plan missing version", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-plan-schema.json");
    const { version, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/assessment-plan-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/assessment-plan-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-plan-schema.json",
  "title": "AssessmentPlan",
  "type": "object",
  "properties": {
    "planId": { "type": "string", "minLength": 1 },
    "version": { "type": "integer", "minimum": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "selection": {
      "type": "object",
      "properties": {
        "applicability": { "type": "array", "items": { "type": "string", "enum": ["applicable", "not_applicable", "unknown"] } },
        "assessmentStatuses": { "type": "array", "items": { "type": "string", "enum": ["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"] } },
        "domains": { "type": "array", "items": { "type": "string" } },
        "controlIds": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "groupBy": { "type": "string", "enum": ["domain", "subdomain", "layer", "group", "controlId"] },
    "defaultMaxParallelAgents": { "type": "integer", "minimum": 1 },
    "groupOverrides": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "groupValue": { "type": "string", "minLength": 1 },
          "maxParallelAgents": { "type": "integer", "minimum": 1 },
          "skip": { "type": "boolean" }
        },
        "required": ["groupValue"],
        "additionalProperties": false
      }
    },
    "createdAt": { "type": "string", "format": "date-time" }
  },
  "required": ["planId", "version", "projectId", "groupBy", "defaultMaxParallelAgents", "createdAt"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 5 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/assessment-plan-schema.json tests/schemas/assessment-plan-schema.test.ts
git commit -m "feat: add assessment-plan-schema.json with selection and groupBy"
```

---

### Task 5: `assessment-run-schema.json`

**Files:**
- Create: `data/schemas/assessment-run-schema.json`
- Create: `tests/schemas/assessment-run-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts`.
- Produces: `data/schemas/assessment-run-schema.json` — Task 6 (`AssessmentBatch`) references `runId` values shaped like `"RUN-20260919-001"` conceptually.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/assessment-run-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("assessment-run-schema", () => {
  const valid = {
    runId: "RUN-20260919-001",
    projectId: "PRJ-001",
    planId: "PLAN-DEFAULT",
    planVersion: 1,
    profileRevision: 1,
    catalogVersion: "2.1.0",
    batchIds: ["BAT-001", "BAT-002"],
    status: "running",
  };

  it("accepts a well-formed run", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts status partial for a run with mixed batch outcomes", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate({ ...valid, status: "partial" }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    expect(validate({ ...valid, status: "cancelled" })).toBe(false);
  });

  it("rejects a run missing planVersion", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-run-schema.json");
    const { planVersion, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/assessment-run-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/assessment-run-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-run-schema.json",
  "title": "AssessmentRun",
  "type": "object",
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "planId": { "type": "string", "minLength": 1 },
    "planVersion": { "type": "integer", "minimum": 1 },
    "profileRevision": { "type": "integer", "minimum": 1 },
    "catalogVersion": { "type": "string", "minLength": 1 },
    "batchIds": { "type": "array", "items": { "type": "string" } },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed", "partial"] },
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" }
  },
  "required": ["runId", "projectId", "planId", "planVersion", "profileRevision", "catalogVersion", "batchIds", "status"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/assessment-run-schema.json tests/schemas/assessment-run-schema.test.ts
git commit -m "feat: add assessment-run-schema.json"
```

---

### Task 6: `assessment-batch-schema.json` (with `runId`)

**Files:**
- Create: `data/schemas/assessment-batch-schema.json`
- Create: `tests/schemas/assessment-batch-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts`.
- Produces: `data/schemas/assessment-batch-schema.json`. No other task in this plan depends on it directly.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/assessment-batch-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("assessment-batch-schema", () => {
  const valid = {
    batchId: "BAT-001",
    runId: "RUN-20260919-001",
    planId: "PLAN-DEFAULT",
    projectId: "PRJ-001",
    groupBy: "domain",
    groupValue: "authentication",
    controlIds: ["IAM-AUTH-001", "IAM-AUTH-002"],
    assignedAgent: null,
    status: "pending",
    startedAt: null,
    completedAt: null,
    resultingAssessmentIds: [],
    resultingFindingIds: [],
  };

  it("accepts a well-formed batch", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a batch missing runId", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    const { runId, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a batch with no controlIds", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    expect(validate({ ...valid, controlIds: [] })).toBe(false);
  });

  it("rejects an unknown status value", () => {
    const validate = compileSchemaFromFile("data/schemas/assessment-batch-schema.json");
    expect(validate({ ...valid, status: "queued" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/assessment-batch-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/assessment-batch-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-batch-schema.json",
  "title": "AssessmentBatch",
  "type": "object",
  "properties": {
    "batchId": { "type": "string", "minLength": 1 },
    "runId": { "type": "string", "minLength": 1 },
    "planId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "groupBy": { "type": "string", "enum": ["domain", "subdomain", "layer", "group", "controlId"] },
    "groupValue": { "type": "string", "minLength": 1 },
    "controlIds": { "type": "array", "minItems": 1, "items": { "type": "string" } },
    "assignedAgent": { "type": ["string", "null"] },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" },
    "resultingAssessmentIds": { "type": "array", "items": { "type": "string" } },
    "resultingFindingIds": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["batchId", "runId", "planId", "projectId", "groupBy", "groupValue", "controlIds", "status", "resultingAssessmentIds", "resultingFindingIds"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/assessment-batch-schema.json tests/schemas/assessment-batch-schema.test.ts
git commit -m "feat: add assessment-batch-schema.json with required runId"
```

---

### Task 7: `score-model-schema.json` + `core/scoring-model.json`

**Files:**
- Create: `data/schemas/score-model-schema.json`
- Create: `data/core/scoring-model.json`
- Create: `tests/schemas/score-model-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`.
- Produces: `data/core/scoring-model.json`, whose `modelId`/`version` (`"USSVS-SCORE-DEFAULT"`/`"1.0.0"`) are the exact values Task 8's `Score` fixture and Task 9's `ProjectReport` fixture use in `scoreModel.id`/`scoreModel.version`.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/score-model-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";

describe("score-model-schema", () => {
  const valid = {
    modelId: "USSVS-SCORE-DEFAULT",
    version: "1.0.0",
    statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
    excludedStatuses: ["N/A", "ACCEPTED_RISK"],
    description: "overallScore = weighted pass rate over applicable, non-excluded controls.",
  };

  it("accepts a well-formed score model", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a model missing a status weight", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    const { FAIL, ...rest } = valid.statusWeights;
    expect(validate({ ...valid, statusWeights: rest })).toBe(false);
  });

  it("rejects an excludedStatuses value outside N/A or ACCEPTED_RISK", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    expect(validate({ ...valid, excludedStatuses: ["FAIL"] })).toBe(false);
  });
});

describe("core/scoring-model.json", () => {
  it("validates against score-model-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/score-model-schema.json");
    const data = loadJson<object>("data/core/scoring-model.json");
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — neither `data/schemas/score-model-schema.json` nor `data/core/scoring-model.json` exists.

- [ ] **Step 3: Write `data/schemas/score-model-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/score-model-schema.json",
  "title": "ScoreModel",
  "type": "object",
  "properties": {
    "modelId": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "minLength": 1 },
    "statusWeights": {
      "type": "object",
      "properties": {
        "PASS": { "type": "number", "minimum": 0, "maximum": 1 },
        "PARTIAL": { "type": "number", "minimum": 0, "maximum": 1 },
        "FAIL": { "type": "number", "minimum": 0, "maximum": 1 },
        "NOT_TESTED": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["PASS", "PARTIAL", "FAIL", "NOT_TESTED"],
      "additionalProperties": false
    },
    "excludedStatuses": {
      "type": "array",
      "items": { "type": "string", "enum": ["N/A", "ACCEPTED_RISK"] }
    },
    "description": { "type": "string", "minLength": 1 }
  },
  "required": ["modelId", "version", "statusWeights", "excludedStatuses", "description"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Write `data/core/scoring-model.json`**

```json
{
  "modelId": "USSVS-SCORE-DEFAULT",
  "version": "1.0.0",
  "statusWeights": { "PASS": 1.0, "PARTIAL": 0.5, "FAIL": 0, "NOT_TESTED": 0 },
  "excludedStatuses": ["N/A", "ACCEPTED_RISK"],
  "description": "overallScore = 100 * sum(statusWeights[status] for each non-excluded applicable ControlAssessment) / count(non-excluded applicable ControlAssessments). coveragePercent = assessedControls / applicableControls * 100, where assessedControls counts everything except NOT_TESTED (N/A and ACCEPTED_RISK are excluded from applicableControls entirely, matching excludedStatuses)."
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/score-model-schema.json data/core/scoring-model.json tests/schemas/score-model-schema.test.ts
git commit -m "feat: add score model schema and default scoring model"
```

---

### Task 8: `score-schema.json`

**Files:**
- Create: `data/schemas/score-schema.json`
- Create: `tests/schemas/score-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts`.
- Produces: `data/schemas/score-schema.json` — Task 9's `ProjectReport` embeds an inline copy of this shape (minus `projectId`/`computedAt`).

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/score-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("score-schema", () => {
  const validDomainScore = {
    domain: "authentication",
    score: 87,
    totalControls: 20,
    applicableControls: 16,
    assessedControls: 14,
    coveragePercent: 87.5,
    passCount: 11,
    failCount: 2,
    partialCount: 1,
    notTestedCount: 2,
    notApplicableCount: 4,
    acceptedRiskCount: 1,
    criticalFindings: 0,
    highFindings: 1,
  };

  const valid = {
    projectId: "PRJ-001",
    overallScore: 82,
    coverage: {
      applicableControls: 120,
      assessedControls: 110,
      coveragePercent: 91.67,
    },
    scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
    domainScores: [validDomainScore],
    computedAt: "2026-09-19T05:00:00Z",
  };

  it("accepts a well-formed score", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a score missing coverage", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    const { coverage, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a domainScores entry missing notTestedCount", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    const { notTestedCount, ...restDomainScore } = validDomainScore;
    expect(validate({ ...valid, domainScores: [restDomainScore] })).toBe(false);
  });

  it("rejects an overallScore above 100", () => {
    const validate = compileSchemaFromFile("data/schemas/score-schema.json");
    expect(validate({ ...valid, overallScore: 101 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/score-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/score-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/score-schema.json",
  "title": "Score",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
    "coverage": {
      "type": "object",
      "properties": {
        "applicableControls": { "type": "integer", "minimum": 0 },
        "assessedControls": { "type": "integer", "minimum": 0 },
        "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 }
      },
      "required": ["applicableControls", "assessedControls", "coveragePercent"],
      "additionalProperties": false
    },
    "scoreModel": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "version": { "type": "string", "minLength": 1 }
      },
      "required": ["id", "version"],
      "additionalProperties": false
    },
    "domainScores": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "domain": { "type": "string", "minLength": 1 },
          "score": { "type": "number", "minimum": 0, "maximum": 100 },
          "totalControls": { "type": "integer", "minimum": 0 },
          "applicableControls": { "type": "integer", "minimum": 0 },
          "assessedControls": { "type": "integer", "minimum": 0 },
          "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 },
          "passCount": { "type": "integer", "minimum": 0 },
          "failCount": { "type": "integer", "minimum": 0 },
          "partialCount": { "type": "integer", "minimum": 0 },
          "notTestedCount": { "type": "integer", "minimum": 0 },
          "notApplicableCount": { "type": "integer", "minimum": 0 },
          "acceptedRiskCount": { "type": "integer", "minimum": 0 },
          "criticalFindings": { "type": "integer", "minimum": 0 },
          "highFindings": { "type": "integer", "minimum": 0 }
        },
        "required": ["domain", "score", "totalControls", "applicableControls", "assessedControls", "coveragePercent", "passCount", "failCount", "partialCount", "notTestedCount", "notApplicableCount", "acceptedRiskCount", "criticalFindings", "highFindings"],
        "additionalProperties": false
      }
    },
    "computedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["projectId", "overallScore", "coverage", "scoreModel", "domainScores", "computedAt"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/score-schema.json tests/schemas/score-schema.test.ts
git commit -m "feat: add score-schema.json with coverage and full status breakout"
```

---

### Task 9: `project-report-schema.json`

**Files:**
- Create: `data/schemas/project-report-schema.json`
- Create: `tests/schemas/project-report-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts`.
- Produces: `data/schemas/project-report-schema.json`. No other task in this plan depends on it; it is the final consumer-facing schema of this phase.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/project-report-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("project-report-schema", () => {
  const valid = {
    reportId: "RPT-001",
    projectId: "PRJ-001",
    assessmentRunId: "RUN-20260919-001",
    catalogVersion: "2.1.0",
    profileRevision: 1,
    criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-09-19T05:00:00Z",
    score: {
      overallScore: 82,
      coverage: { applicableControls: 120, assessedControls: 110, coveragePercent: 91.67 },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
      domainScores: [
        {
          domain: "authentication",
          score: 87,
          totalControls: 20,
          applicableControls: 16,
          assessedControls: 14,
          coveragePercent: 87.5,
          passCount: 11,
          failCount: 2,
          partialCount: 1,
          notTestedCount: 2,
          notApplicableCount: 4,
          acceptedRiskCount: 1,
          criticalFindings: 0,
          highFindings: 1,
        },
      ],
    },
    prioritizedFindings: [
      { findingId: "FND-001", priorityIndex: 0, criticalityIndex: 9, title: "Admin API reachable without authentication" },
      { findingId: "FND-002", priorityIndex: 0, criticalityIndex: 7, title: "Predictable session token" },
      { findingId: "FND-003", priorityIndex: 1, criticalityIndex: 9, title: "SQL injection in search endpoint" },
    ],
    releaseEvaluation: {
      gate: 4,
      controlCoverage: 91.67,
      criticalFindings: 1,
      highFindings: 2,
      unblockedCriticalAttackPaths: 0,
      residualRisksAccepted: 0,
      incidentResponseVerified: true,
      backupRestoreVerified: true,
      result: "blocked",
    },
    summary: "Two critical findings remain open; release blocked until resolved.",
  };

  it("accepts a well-formed report", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a report missing assessmentRunId", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const { assessmentRunId, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("rejects a report missing criticalityFormula", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const { criticalityFormula, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("enforces the prioritizedFindings sort invariant: priorityIndex asc, criticalityIndex desc, findingId asc", () => {
    const sorted = [...valid.prioritizedFindings].sort((a, b) => {
      if (a.priorityIndex !== b.priorityIndex) return a.priorityIndex - b.priorityIndex;
      if (a.criticalityIndex !== b.criticalityIndex) return b.criticalityIndex - a.criticalityIndex;
      return a.findingId.localeCompare(b.findingId);
    });
    expect(valid.prioritizedFindings.map((f) => f.findingId)).toEqual(sorted.map((f) => f.findingId));
  });

  it("rejects a prioritizedFindings entry missing title", () => {
    const validate = compileSchemaFromFile("data/schemas/project-report-schema.json");
    const badFindings = [{ findingId: "FND-001", priorityIndex: 0, criticalityIndex: 9 }];
    expect(validate({ ...valid, prioritizedFindings: badFindings })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/project-report-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/project-report-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/project-report-schema.json",
  "title": "ProjectReport",
  "type": "object",
  "properties": {
    "reportId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "assessmentRunId": { "type": "string", "minLength": 1 },
    "catalogVersion": { "type": "string", "minLength": 1 },
    "profileRevision": { "type": "integer", "minimum": 1 },
    "criticalityFormula": {
      "type": "object",
      "properties": { "id": { "type": "string", "minLength": 1 }, "version": { "type": "string", "minLength": 1 } },
      "required": ["id", "version"], "additionalProperties": false
    },
    "generatedAt": { "type": "string", "format": "date-time" },
    "score": {
      "type": "object",
      "properties": {
        "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
        "coverage": {
          "type": "object",
          "properties": {
            "applicableControls": { "type": "integer", "minimum": 0 },
            "assessedControls": { "type": "integer", "minimum": 0 },
            "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 }
          },
          "required": ["applicableControls", "assessedControls", "coveragePercent"],
          "additionalProperties": false
        },
        "scoreModel": {
          "type": "object",
          "properties": { "id": { "type": "string", "minLength": 1 }, "version": { "type": "string", "minLength": 1 } },
          "required": ["id", "version"], "additionalProperties": false
        },
        "domainScores": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "domain": { "type": "string", "minLength": 1 },
              "score": { "type": "number", "minimum": 0, "maximum": 100 },
              "totalControls": { "type": "integer", "minimum": 0 },
              "applicableControls": { "type": "integer", "minimum": 0 },
              "assessedControls": { "type": "integer", "minimum": 0 },
              "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 },
              "passCount": { "type": "integer", "minimum": 0 },
              "failCount": { "type": "integer", "minimum": 0 },
              "partialCount": { "type": "integer", "minimum": 0 },
              "notTestedCount": { "type": "integer", "minimum": 0 },
              "notApplicableCount": { "type": "integer", "minimum": 0 },
              "acceptedRiskCount": { "type": "integer", "minimum": 0 },
              "criticalFindings": { "type": "integer", "minimum": 0 },
              "highFindings": { "type": "integer", "minimum": 0 }
            },
            "required": ["domain", "score", "totalControls", "applicableControls", "assessedControls", "coveragePercent", "passCount", "failCount", "partialCount", "notTestedCount", "notApplicableCount", "acceptedRiskCount", "criticalFindings", "highFindings"],
            "additionalProperties": false
          }
        }
      },
      "required": ["overallScore", "coverage", "scoreModel", "domainScores"],
      "additionalProperties": false
    },
    "prioritizedFindings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "findingId": { "type": "string", "minLength": 1 },
          "priorityIndex": { "type": "integer", "minimum": 0, "maximum": 9 },
          "criticalityIndex": { "type": "integer", "minimum": 0, "maximum": 9 },
          "title": { "type": "string", "minLength": 1 }
        },
        "required": ["findingId", "priorityIndex", "criticalityIndex", "title"],
        "additionalProperties": false
      }
    },
    "releaseEvaluation": {
      "type": "object",
      "properties": {
        "gate": { "type": "integer", "minimum": 0, "maximum": 4 },
        "controlCoverage": { "type": "number", "minimum": 0, "maximum": 100 },
        "criticalFindings": { "type": "integer", "minimum": 0 },
        "highFindings": { "type": "integer", "minimum": 0 },
        "unblockedCriticalAttackPaths": { "type": "integer", "minimum": 0 },
        "residualRisksAccepted": { "type": "integer", "minimum": 0 },
        "incidentResponseVerified": { "type": "boolean" },
        "backupRestoreVerified": { "type": "boolean" },
        "result": { "type": "string", "enum": ["approved", "blocked"] }
      },
      "required": ["gate", "controlCoverage", "criticalFindings", "highFindings", "unblockedCriticalAttackPaths", "residualRisksAccepted", "incidentResponseVerified", "backupRestoreVerified", "result"],
      "additionalProperties": false
    },
    "summary": { "type": "string", "minLength": 1 }
  },
  "required": ["reportId", "projectId", "assessmentRunId", "catalogVersion", "profileRevision", "criticalityFormula", "generatedAt", "score", "prioritizedFindings", "releaseEvaluation", "summary"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 5 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/project-report-schema.json tests/schemas/project-report-schema.test.ts
git commit -m "feat: add project-report-schema.json as an immutable reproducible snapshot"
```

---

### Task 10: Update `manifest.json` and the manifest test for the 8 new schemas + 2 new core files

**Files:**
- Modify: `data/manifest.json`
- Modify: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts`; the complete `data/` tree produced by Tasks 1-9 plus everything from Phase 1.
- Produces: an updated `data/manifest.json` that accurately reflects every file on disk after this phase, and the final proof that the whole `data/` tree (Phase 1 + Phase 2) is internally consistent.

Read the current `tests/manifest.test.ts` before editing — it already has 4 tests from Phase 1 (including a disk↔manifest bidirectional check added during Phase 1's final-review fix wave). Only the hardcoded schema-file list inside the "lists exactly the N schema files defined by the spec" test changes; everything else in the file (the bidirectional disk-scan test, the `controls.count` test, the "lists only files that exist" test) stays structurally the same and needs no logic changes — only the schema list assertion grows from 10 entries to 18.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `tests/manifest.test.ts` with:

```ts
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadJson } from "../src/validate.js";

interface Manifest {
  catalog: string;
  catalogVersion: string;
  schemaVersion: string;
  core: { files: string[] };
  catalogs: { files: string[] };
  controls: { count: number; files: string[] };
  schemas: { files: string[] };
  process: { files: string[] };
}

describe("data/manifest.json", () => {
  it("lists only files that actually exist on disk", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    const allListed = [
      ...manifest.core.files,
      ...manifest.catalogs.files,
      ...manifest.controls.files,
      ...manifest.schemas.files,
      ...manifest.process.files,
    ];
    expect(allListed.length).toBeGreaterThan(0);
    for (const relativePath of allListed) {
      expect(existsSync(`data/${relativePath}`), `missing file: data/${relativePath}`).toBe(true);
    }
  });

  it("lists exactly the 18 schema files defined by the spec", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    expect(new Set(manifest.schemas.files)).toEqual(
      new Set([
        "schemas/control-schema.json",
        "schemas/threat-schema.json",
        "schemas/project-profile-schema.json",
        "schemas/asset-schema.json",
        "schemas/control-assessment-schema.json",
        "schemas/evidence-schema.json",
        "schemas/finding-schema.json",
        "schemas/attack-path-schema.json",
        "schemas/risk-acceptance-schema.json",
        "schemas/release-evaluation-schema.json",
        "schemas/project-schema.json",
        "schemas/criticality-formula-schema.json",
        "schemas/assessment-plan-schema.json",
        "schemas/assessment-run-schema.json",
        "schemas/assessment-batch-schema.json",
        "schemas/score-model-schema.json",
        "schemas/score-schema.json",
        "schemas/project-report-schema.json",
      ])
    );
  });

  it("controls.count matches the total number of control records across controls.files", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    let total = 0;
    for (const relativePath of manifest.controls.files) {
      const records = loadJson<unknown[]>(`data/${relativePath}`);
      total += records.length;
    }
    expect(manifest.controls.count).toBe(total);
  });

  it("has a file set on disk matching the manifest for each category directory", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    const categories: { dir: string; prefix: string; files: string[] }[] = [
      { dir: "data/core", prefix: "core/", files: manifest.core.files },
      { dir: "data/catalogs", prefix: "catalogs/", files: manifest.catalogs.files },
      { dir: "data/controls", prefix: "controls/", files: manifest.controls.files },
      { dir: "data/schemas", prefix: "schemas/", files: manifest.schemas.files },
      { dir: "data/process", prefix: "process/", files: manifest.process.files },
    ];
    for (const { dir, prefix, files } of categories) {
      const onDisk = new Set(
        readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => `${prefix}${f}`)
      );
      expect(onDisk, `mismatch in ${dir}`).toEqual(new Set(files));
    }
  });
});
```

If the current file on disk differs structurally from what's shown above (e.g. different test count, different helper shape), keep its existing structure and apply only the minimal change described in the paragraph above the code block — report DONE_WITH_CONCERNS noting the discrepancy rather than silently discarding working Phase 1 logic.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the "lists exactly the 18 schema files" test fails because `data/manifest.json` still only lists 10, and the disk↔manifest bidirectional test fails because `data/schemas/` now has 18 files on disk but the manifest only lists 10 (and `data/core/` has 5 files on disk but the manifest only lists 3).

- [ ] **Step 3: Replace the full contents of `data/manifest.json`**

```json
{
  "catalog": "USSVS",
  "catalogVersion": "2.1.0",
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-09-19T00:00:00Z",
  "core": {
    "files": ["core/principles.json", "core/security-levels.json", "core/profile-taxonomy.json", "core/criticality-weights.json", "core/scoring-model.json"]
  },
  "catalogs": {
    "files": ["catalogs/threats.json", "catalogs/references.json", "catalogs/evidence-types.json", "catalogs/owner-roles.json", "catalogs/asset-types.json"]
  },
  "controls": {
    "count": 12,
    "files": ["controls/identity-access.json"]
  },
  "schemas": {
    "files": [
      "schemas/control-schema.json",
      "schemas/threat-schema.json",
      "schemas/project-profile-schema.json",
      "schemas/asset-schema.json",
      "schemas/control-assessment-schema.json",
      "schemas/evidence-schema.json",
      "schemas/finding-schema.json",
      "schemas/attack-path-schema.json",
      "schemas/risk-acceptance-schema.json",
      "schemas/release-evaluation-schema.json",
      "schemas/project-schema.json",
      "schemas/criticality-formula-schema.json",
      "schemas/assessment-plan-schema.json",
      "schemas/assessment-run-schema.json",
      "schemas/assessment-batch-schema.json",
      "schemas/score-model-schema.json",
      "schemas/score-schema.json",
      "schemas/project-report-schema.json"
    ]
  },
  "process": {
    "files": [
      "process/verification-flow.json",
      "process/release-gates.json",
      "process/incident-response.json",
      "process/exception-policy.json",
      "process/metrics.json",
      "process/deliverables.json"
    ]
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 manifest assertions PASS.

- [ ] **Step 5: Run the entire test suite one final time**

Run: `npm test`
Expected: every test file from Phase 1 and Phase 2 passes, with zero failures (roughly 107 tests across 23 files — exact count may differ slightly by a few assertions depending on minor implementation choices in earlier tasks; the bar is 100% pass, not an exact number).

- [ ] **Step 6: Commit**

```bash
git add data/manifest.json tests/manifest.test.ts
git commit -m "feat: register phase 2 schemas and core data in manifest.json"
```

---

## Notes for Execution

- Tasks 1-2 are tightly coupled (Task 2's formula field names must match Task 1's `detectionDifficulty` rename) — do not reorder.
- Tasks 4-5-6 are tightly coupled (`AssessmentPlan` → `AssessmentRun` → `AssessmentBatch`, each referencing the previous by id/version) — do not reorder.
- Tasks 7-8-9 are tightly coupled (`ScoreModel` → `Score` → `ProjectReport`) — do not reorder.
- Task 3 (`project-schema.json`) has no dependency on any other task in this plan and could run in parallel with Tasks 1-2 or 4-6 if executing with more concurrency than a single sequential queue — not required, just an option.
- Task 10 must run last — it depends on every schema file from Tasks 1-9 existing on disk.
- No task in this plan touches `data/controls/*.json` or the remaining Phase 1 follow-up work (7 more control domains) — both remain fully independent and can proceed on a separate branch/plan without conflict.
