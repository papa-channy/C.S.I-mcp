# Security Check MCP — JSON Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the validated JSON data foundation (schemas + reference data + one fully-populated proof-of-concept control domain) that a future Security Check MCP server will read and write, per the approved design spec.

**Architecture:** A `data/` tree of hand-authored JSON files (manifest, core reference data, controlled-vocabulary catalogs, domain-grouped Controls, JSON Schema documents, and process reference data), validated by a small TypeScript + Ajv (JSON Schema draft 2020-12) test suite run with Vitest. No server code and no database in this phase — this plan only produces the data and the harness that proves it is internally consistent.

**Tech Stack:** Node.js, TypeScript, Ajv (`ajv/dist/2020` build) + `ajv-formats`, Vitest. Chosen so the validation harness's runtime matches the language the future MCP server will almost certainly use (`@modelcontextprotocol/sdk` is TypeScript-first).

**Spec:** `docs/superpowers/specs/2026-09-16-security-mcp-data-foundation-design.md`

## Global Constraints

- All JSON Schema files use draft 2020-12 (`"$schema": "https://json-schema.org/draft/2020-12/schema"`).
- A `Control` record never contains a project-specific status field (no `status: "pass"` inside catalog data) — project state lives only in `ControlAssessment` records (spec §2).
- Applicability always resolves to exactly one of `applicable | not_applicable | unknown` — missing profile information must never silently resolve to `not_applicable` (spec §4).
- Every `Control` carries `version` (integer) and `status` (`draft|active|deprecated|retired`); every `ControlAssessment` pins the `controlVersion` it was evaluated against (spec §3).
- All human-readable text values (`requirement`, `rationale`, `title`, descriptions, etc.) are written in English (spec §10).
- A control's `domain`/`subdomain`/`group` are explicit fields on the record — the file path it lives in is an authoring convenience only, never a source of truth (spec §6, §9).
- JSON shape is "flat record + nested attributes": each domain file is a JSON array of Control objects; small value-objects (`applicability`, `verification`, `baselineRisk`, `assurance`, `relationships`) may nest, but a Control is never nested inside another Control (spec §11).
- `threats.json` lives under `catalogs/`, not `controls/` (spec §9).

---

### Task 1: Project scaffolding and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working `npm test` command (Vitest) that every later task's tests run under; the `data/`, `src/`, `tests/` directory convention.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "csi-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

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
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created.

- [ ] **Step 6: Write a smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the test suite and verify it passes**

Run: `npm test`
Expected: 1 test file, 1 test, PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts
git commit -m "chore: scaffold TypeScript + Vitest + Ajv project"
```

---

### Task 2: Generic JSON Schema validation utility

**Files:**
- Create: `src/validate.ts`
- Create: `tests/fixtures/sample-schema.json`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Consumes: nothing beyond `ajv`/`ajv-formats` (Task 1 dependencies).
- Produces: `loadJson<T>(path: string): T`, `createAjv(): Ajv`, `compileSchemaFromFile(schemaPath: string): ValidateFunction` — every later schema/content test imports these three from `src/validate.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, createAjv, loadJson } from "../src/validate.js";

describe("validate utility", () => {
  it("loadJson parses a JSON file", () => {
    const data = loadJson<{ hello: string }>("tests/fixtures/sample-schema.json");
    expect(data).toBeTypeOf("object");
  });

  it("createAjv returns a configured Ajv instance", () => {
    const ajv = createAjv();
    const validate = ajv.compile({ type: "string" });
    expect(validate("ok")).toBe(true);
    expect(validate(123)).toBe(false);
  });

  it("compileSchemaFromFile compiles a schema loaded from disk", () => {
    const validate = compileSchemaFromFile("tests/fixtures/sample-schema.json");
    expect(validate({ name: "widget" })).toBe(true);
    expect(validate({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `tests/fixtures/sample-schema.json` does not exist and `src/validate.ts` does not exist (module not found).

- [ ] **Step 3: Create the fixture schema**

Create `tests/fixtures/sample-schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": { "type": "string" }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Implement `src/validate.ts`**

```ts
import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function loadJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

// strict:false avoids Ajv strict-mode friction on constructs this project
// relies on (recursive $defs, if/then siblings, format keywords) while still
// enforcing full JSON Schema draft 2020-12 validation semantics.
export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

export function compileSchemaFromFile(schemaPath: string): ValidateFunction {
  const ajv = createAjv();
  const schema = loadJson<object>(schemaPath);
  return ajv.compile(schema);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: 4 test files (including Task 1's smoke test), all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/validate.ts tests/validate.test.ts tests/fixtures/sample-schema.json
git commit -m "feat: add generic JSON Schema validation utility"
```

---

### Task 3: Control schema and Applicability Rule DSL

**Files:**
- Create: `data/schemas/control-schema.json`
- Test: `tests/schemas/control-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Task 2).
- Produces: `data/schemas/control-schema.json` — every control authored in Task 13 (and any future domain file) validates against this.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/control-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

const validControl = {
  controlId: "IAM-AUTH-005",
  version: 1,
  status: "active",
  title: "Privileged MFA",
  group: "identity_access",
  domain: "authentication",
  subdomain: "privileged_authentication",
  layer: "prevent",
  requirement: "Privileged accounts must use multi-factor authentication.",
  rationale: "A compromised password alone must not grant privileged access.",
  threatIds: ["THR-IAM-ACCOUNT-TAKEOVER"],
  applicability: {
    when: { all: [{ fact: "identities", operator: "contains", value: "administrator" }] },
  },
  baselineRisk: { severity: "high" },
  verification: {
    methods: [
      {
        type: "manual_test",
        procedure: "Attempt privileged login with only the password factor.",
        requiredEvidenceTypes: ["MANUAL_TEST"],
        minimumSvl: "SVL-2",
        automatable: false,
      },
    ],
  },
  passCriteria: ["Privileged accounts cannot complete login with a password alone."],
  ownerRoles: ["application", "security"],
};

describe("control-schema", () => {
  it("accepts a well-formed control", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const ok = validate(validControl);
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a control missing requirement", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const { requirement, ...rest } = validControl as Record<string, unknown>;
    expect(validate(rest)).toBe(false);
  });

  it("rejects an invalid status value", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    expect(validate({ ...validControl, status: "sort_of_active" })).toBe(false);
  });

  it("rejects a malformed applicability rule tree", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const bad = { ...validControl, applicability: { when: { all: [], any: [] } } };
    expect(validate(bad)).toBe(false);
  });

  it("accepts a nested any/all applicability rule tree", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const nested = {
      ...validControl,
      applicability: {
        when: {
          any: [
            { all: [{ fact: "components", operator: "contains", value: "browser_frontend" }] },
            { fact: "features.ai", operator: "eq", value: true },
          ],
        },
      },
    };
    expect(validate(nested), JSON.stringify(validate.errors)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/control-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/control-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/control-schema.json",
  "title": "Control",
  "type": "object",
  "$defs": {
    "controlId": {
      "type": "string",
      "pattern": "^[A-Z]+(-[A-Z]+)*-[0-9]{3}$"
    },
    "svl": {
      "type": "string",
      "enum": ["SVL-0", "SVL-1", "SVL-2", "SVL-3"]
    },
    "evidenceType": {
      "type": "string",
      "enum": [
        "CODE", "CONFIG", "AUTOMATED_TEST", "MANUAL_TEST", "SCAN", "LOG",
        "AUDIT_LOG", "ARCHITECTURE", "CI_ARTIFACT", "DEPLOYMENT_RECORD",
        "SCREENSHOT", "TICKET", "REPORT", "MANUAL_REVIEW"
      ]
    },
    "ownerRole": {
      "type": "string",
      "enum": [
        "application", "frontend", "backend", "infrastructure", "devops",
        "security", "product", "privacy", "operations", "vendor"
      ]
    },
    "factCondition": {
      "type": "object",
      "properties": {
        "fact": { "type": "string", "minLength": 1 },
        "operator": {
          "type": "string",
          "enum": ["eq", "ne", "in", "not_in", "contains", "intersects", "gt", "gte", "lt", "lte"]
        },
        "value": {}
      },
      "required": ["fact", "operator", "value"],
      "additionalProperties": false
    },
    "ruleNode": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "all": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ruleNode" } }
          },
          "required": ["all"],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "any": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ruleNode" } }
          },
          "required": ["any"],
          "additionalProperties": false
        },
        { "$ref": "#/$defs/factCondition" }
      ]
    }
  },
  "properties": {
    "controlId": { "$ref": "#/$defs/controlId" },
    "version": { "type": "integer", "minimum": 1 },
    "status": { "type": "string", "enum": ["draft", "active", "deprecated", "retired"] },
    "replacedBy": { "$ref": "#/$defs/controlId" },
    "title": { "type": "string", "minLength": 1 },
    "group": { "type": "string", "minLength": 1 },
    "domain": { "type": "string", "minLength": 1 },
    "subdomain": { "type": "string", "minLength": 1 },
    "layer": {
      "type": "string",
      "enum": ["context", "prevent", "detect", "contain_recover", "assurance"]
    },
    "requirement": { "type": "string", "minLength": 1 },
    "rationale": { "type": "string", "minLength": 1 },
    "threatIds": {
      "type": "array",
      "items": { "type": "string", "pattern": "^THR-[A-Z0-9-]+$" }
    },
    "applicability": {
      "type": "object",
      "properties": { "when": { "$ref": "#/$defs/ruleNode" } },
      "required": ["when"],
      "additionalProperties": false
    },
    "baselineRisk": {
      "type": "object",
      "properties": {
        "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "informational"] }
      },
      "required": ["severity"],
      "additionalProperties": false
    },
    "assurance": {
      "type": "object",
      "properties": {
        "SVL-0": { "type": "array", "items": { "type": "string" } },
        "SVL-1": { "type": "array", "items": { "type": "string" } },
        "SVL-2": { "type": "array", "items": { "type": "string" } },
        "SVL-3": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "verification": {
      "type": "object",
      "properties": {
        "methods": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "minLength": 1 },
              "procedure": { "type": "string", "minLength": 1 },
              "requiredEvidenceTypes": {
                "type": "array",
                "items": { "$ref": "#/$defs/evidenceType" }
              },
              "minimumSvl": { "$ref": "#/$defs/svl" },
              "automatable": { "type": "boolean" }
            },
            "required": ["type", "procedure", "requiredEvidenceTypes", "automatable"],
            "additionalProperties": false
          }
        }
      },
      "required": ["methods"],
      "additionalProperties": false
    },
    "passCriteria": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "string", "minLength": 1 }
    },
    "evidenceRequirements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "$ref": "#/$defs/evidenceType" },
          "required": { "type": "boolean" },
          "requiredFor": { "type": "array", "items": { "$ref": "#/$defs/svl" } }
        },
        "required": ["type", "required"],
        "additionalProperties": false
      }
    },
    "ownerRoles": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/ownerRole" }
    },
    "references": {
      "type": "array",
      "items": { "type": "string" }
    },
    "relationships": {
      "type": "object",
      "properties": {
        "dependsOn": { "type": "array", "items": { "$ref": "#/$defs/controlId" } },
        "relatedTo": { "type": "array", "items": { "$ref": "#/$defs/controlId" } },
        "supersedes": { "type": "array", "items": { "$ref": "#/$defs/controlId" } },
        "compensatesFor": { "type": "array", "items": { "$ref": "#/$defs/controlId" } },
        "conflictsWith": { "type": "array", "items": { "$ref": "#/$defs/controlId" } }
      },
      "additionalProperties": false
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": [
    "controlId", "version", "status", "title", "group", "domain", "subdomain",
    "layer", "requirement", "rationale", "threatIds", "applicability",
    "baselineRisk", "verification", "passCriteria", "ownerRoles"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all test files PASS, including all 5 assertions in `control-schema.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/control-schema.json tests/schemas/control-schema.test.ts
git commit -m "feat: add control-schema.json with applicability rule DSL"
```

---

### Task 4: Project Profile schema

**Files:**
- Create: `data/schemas/project-profile-schema.json`
- Test: `tests/schemas/project-profile-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Task 2).
- Produces: `data/schemas/project-profile-schema.json` — the entity the future Applicability Engine reads; the `applicability.when` fact paths written in Task 13's controls (e.g. `features.authentication`, `identities`) are expected to resolve against this shape.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/project-profile-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

const validProfile = {
  projectId: "proj-001",
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
    payment: false,
    webhook: true,
    oauth: true,
    ai: false,
  },
  technologies: {
    languages: ["typescript"],
    frameworks: ["nextjs", "nestjs"],
    databases: ["postgresql"],
    cloud: ["aws"],
  },
};

describe("project-profile-schema", () => {
  it("accepts a fully-specified profile", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    expect(validate(validProfile), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a profile with some feature flags omitted (unknown, not false)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    const { fileUpload, ai, ...restFeatures } = validProfile.features;
    const partial = { ...validProfile, features: restFeatures };
    expect(validate(partial), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown securityLevel value", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    expect(validate({ ...validProfile, securityLevel: "SVL-9" })).toBe(false);
  });

  it("rejects a profile missing projectId", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    const { projectId, ...rest } = validProfile;
    expect(validate(rest)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/project-profile-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/project-profile-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/project-profile-schema.json",
  "title": "ProjectProfile",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "securityLevel": { "type": "string", "enum": ["SVL-0", "SVL-1", "SVL-2", "SVL-3"] },
    "exposure": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "enum": ["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"]
      }
    },
    "components": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "identities": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"]
      }
    },
    "dataClasses": {
      "type": "array",
      "items": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] }
    },
    "features": {
      "type": "object",
      "properties": {
        "authentication": { "type": "boolean" },
        "authorization": { "type": "boolean" },
        "adminInterface": { "type": "boolean" },
        "fileUpload": { "type": "boolean" },
        "payment": { "type": "boolean" },
        "webhook": { "type": "boolean" },
        "oauth": { "type": "boolean" },
        "ai": { "type": "boolean" }
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
  "required": ["projectId", "securityLevel", "exposure", "components", "identities", "dataClasses", "features", "technologies"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/project-profile-schema.json tests/schemas/project-profile-schema.test.ts
git commit -m "feat: add project-profile-schema.json"
```

---

### Task 5: Control Assessment schema (status lifecycle, versioning, manual override)

**Files:**
- Create: `data/schemas/control-assessment-schema.json`
- Test: `tests/schemas/control-assessment-schema.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Task 2).
- Produces: `data/schemas/control-assessment-schema.json` — the schema for the actual Control Matrix row entity a future MCP server writes per `(projectId, controlId)` pair.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/control-assessment-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

const baseAssessment = {
  assessmentId: "ASM-001",
  projectId: "proj-001",
  controlId: "IAM-AUTH-005",
  controlVersion: 1,
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

describe("control-assessment-schema", () => {
  it("accepts a PASS assessment", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    expect(validate(baseAssessment), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects status N/A without notes", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "N/A" };
    expect(validate(doc)).toBe(false);
  });

  it("accepts status N/A with notes", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "N/A", notes: "No admin interface exists in this project." };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects status ACCEPTED_RISK without riskAcceptanceId", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "ACCEPTED_RISK" };
    expect(validate(doc)).toBe(false);
  });

  it("accepts status ACCEPTED_RISK with riskAcceptanceId", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = { ...baseAssessment, status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a manual_override applicability without reason", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment,
      applicability: {
        autoResult: "applicable",
        finalResult: "not_applicable",
        source: "manual_override",
      },
    };
    expect(validate(doc)).toBe(false);
  });

  it("accepts a manual_override applicability with reason", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const doc = {
      ...baseAssessment,
      applicability: {
        autoResult: "applicable",
        finalResult: "not_applicable",
        source: "manual_override",
        reason: "Authentication is fully delegated to an external IdP.",
      },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    expect(validate({ ...baseAssessment, status: "MAYBE" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/schemas/control-assessment-schema.json` does not exist.

- [ ] **Step 3: Write `data/schemas/control-assessment-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/control-assessment-schema.json",
  "title": "ControlAssessment",
  "type": "object",
  "properties": {
    "assessmentId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "controlId": { "type": "string", "pattern": "^[A-Z]+(-[A-Z]+)*-[0-9]{3}$" },
    "controlVersion": { "type": "integer", "minimum": 1 },
    "applicability": {
      "type": "object",
      "properties": {
        "autoResult": { "type": "string", "enum": ["applicable", "not_applicable", "unknown"] },
        "finalResult": { "type": "string", "enum": ["applicable", "not_applicable", "unknown"] },
        "matchedRules": { "type": "array", "items": { "type": "string" } },
        "source": { "type": "string", "enum": ["automatic", "manual_override"] },
        "reason": { "type": "string" }
      },
      "required": ["autoResult", "finalResult", "source"],
      "additionalProperties": false,
      "if": {
        "properties": { "source": { "const": "manual_override" } },
        "required": ["source"]
      },
      "then": {
        "required": ["reason"]
      }
    },
    "status": {
      "type": "string",
      "enum": ["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"]
    },
    "evidenceIds": { "type": "array", "items": { "type": "string" } },
    "findingIds": { "type": "array", "items": { "type": "string" } },
    "riskAcceptanceId": { "type": ["string", "null"] },
    "owner": { "type": "string", "minLength": 1 },
    "assessedBy": { "type": "string", "minLength": 1 },
    "assessedAt": { "type": "string", "format": "date-time" },
    "nextReviewAt": { "type": ["string", "null"], "format": "date-time" },
    "notes": { "type": ["string", "null"] }
  },
  "required": [
    "assessmentId", "projectId", "controlId", "controlVersion",
    "applicability", "status", "evidenceIds", "findingIds",
    "riskAcceptanceId", "owner", "assessedBy", "assessedAt"
  ],
  "additionalProperties": false,
  "allOf": [
    {
      "if": { "properties": { "status": { "const": "N/A" } }, "required": ["status"] },
      "then": { "properties": { "notes": { "type": "string", "minLength": 1 } }, "required": ["notes"] }
    },
    {
      "if": { "properties": { "status": { "const": "ACCEPTED_RISK" } }, "required": ["status"] },
      "then": { "properties": { "riskAcceptanceId": { "type": "string", "minLength": 1 } }, "required": ["riskAcceptanceId"] }
    }
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 8 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/schemas/control-assessment-schema.json tests/schemas/control-assessment-schema.test.ts
git commit -m "feat: add control-assessment-schema.json with status lifecycle rules"
```

---

### Task 6: Threat, Asset, and Evidence schemas

**Files:**
- Create: `data/schemas/threat-schema.json`
- Create: `data/schemas/asset-schema.json`
- Create: `data/schemas/evidence-schema.json`
- Test: `tests/schemas/threat-asset-evidence-schemas.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Task 2).
- Produces: `data/schemas/threat-schema.json` (Task 10 validates `catalogs/threats.json` entries against it and Task 13 cross-checks against it), `data/schemas/asset-schema.json`, `data/schemas/evidence-schema.json`.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/threat-asset-evidence-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("threat-schema", () => {
  const valid = {
    threatId: "THR-IAM-ACCOUNT-TAKEOVER",
    title: "Account Takeover",
    description: "An attacker gains persistent control of a privileged account.",
    category: "authentication",
  };

  it("accepts a well-formed threat", () => {
    const validate = compileSchemaFromFile("data/schemas/threat-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a threatId that does not start with THR-", () => {
    const validate = compileSchemaFromFile("data/schemas/threat-schema.json");
    expect(validate({ ...valid, threatId: "ACCOUNT-TAKEOVER" })).toBe(false);
  });
});

describe("asset-schema", () => {
  const valid = {
    assetId: "AST-017",
    assetName: "Customer Credential",
    assetType: "credential",
    dataClassification: "D3",
    owner: "security",
    storage: "authentication_db",
    process: "auth_service",
    access: ["auth_service"],
    backup: true,
    encryption: "password_hash",
    businessImpact: "account_takeover",
  };

  it("accepts a well-formed asset", () => {
    const validate = compileSchemaFromFile("data/schemas/asset-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an invalid dataClassification", () => {
    const validate = compileSchemaFromFile("data/schemas/asset-schema.json");
    expect(validate({ ...valid, dataClassification: "D9" })).toBe(false);
  });
});

describe("evidence-schema", () => {
  const valid = {
    evidenceId: "EVD-001",
    type: "AUTOMATED_TEST",
    location: "ci://run/4821/artifacts/auth-mfa.json",
    capturedAt: "2026-09-16T05:00:00Z",
    capturedBy: "ci-pipeline",
  };

  it("accepts a well-formed evidence record", () => {
    const validate = compileSchemaFromFile("data/schemas/evidence-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown evidence type", () => {
    const validate = compileSchemaFromFile("data/schemas/evidence-schema.json");
    expect(validate({ ...valid, type: "VIBES" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — none of the three schema files exist yet.

- [ ] **Step 3: Write `data/schemas/threat-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/threat-schema.json",
  "title": "Threat",
  "type": "object",
  "properties": {
    "threatId": { "type": "string", "pattern": "^THR-[A-Z0-9-]+$" },
    "title": { "type": "string", "minLength": 1 },
    "description": { "type": "string", "minLength": 1 },
    "category": { "type": "string", "minLength": 1 }
  },
  "required": ["threatId", "title", "description", "category"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Write `data/schemas/asset-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/asset-schema.json",
  "title": "Asset",
  "type": "object",
  "properties": {
    "assetId": { "type": "string", "pattern": "^AST-[0-9]+$" },
    "assetName": { "type": "string", "minLength": 1 },
    "assetType": { "type": "string", "minLength": 1 },
    "dataClassification": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] },
    "owner": { "type": "string", "minLength": 1 },
    "storage": { "type": "string", "minLength": 1 },
    "process": { "type": "string" },
    "access": { "type": "array", "items": { "type": "string" } },
    "backup": { "type": "boolean" },
    "encryption": { "type": "string" },
    "businessImpact": { "type": "string", "minLength": 1 }
  },
  "required": ["assetId", "assetName", "assetType", "dataClassification", "owner", "storage", "access", "backup", "businessImpact"],
  "additionalProperties": false
}
```

- [ ] **Step 5: Write `data/schemas/evidence-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/evidence-schema.json",
  "title": "Evidence",
  "type": "object",
  "properties": {
    "evidenceId": { "type": "string", "pattern": "^EVD-[0-9]+$" },
    "type": {
      "type": "string",
      "enum": [
        "CODE", "CONFIG", "AUTOMATED_TEST", "MANUAL_TEST", "SCAN", "LOG",
        "AUDIT_LOG", "ARCHITECTURE", "CI_ARTIFACT", "DEPLOYMENT_RECORD",
        "SCREENSHOT", "TICKET", "REPORT", "MANUAL_REVIEW"
      ]
    },
    "location": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "capturedAt": { "type": "string", "format": "date-time" },
    "capturedBy": { "type": "string", "minLength": 1 }
  },
  "required": ["evidenceId", "type", "location", "capturedAt", "capturedBy"],
  "additionalProperties": false
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: all 6 assertions PASS.

- [ ] **Step 7: Commit**

```bash
git add data/schemas/threat-schema.json data/schemas/asset-schema.json data/schemas/evidence-schema.json tests/schemas/threat-asset-evidence-schemas.test.ts
git commit -m "feat: add threat, asset, and evidence schemas"
```

---

### Task 7: Finding and Attack Path schemas

**Files:**
- Create: `data/schemas/finding-schema.json`
- Create: `data/schemas/attack-path-schema.json`
- Test: `tests/schemas/finding-attack-path-schemas.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Task 2).
- Produces: `data/schemas/finding-schema.json`, `data/schemas/attack-path-schema.json`.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/finding-attack-path-schemas.test.ts`:

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
    detectability: 1,
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
Expected: FAIL — neither schema file exists yet.

- [ ] **Step 3: Write `data/schemas/finding-schema.json`**

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
    "detectability": { "type": "integer", "minimum": 0, "maximum": 2 },
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
    "exploitability", "exposure", "privilegeRequired", "detectability",
    "severity", "status"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 4: Write `data/schemas/attack-path-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/attack-path-schema.json",
  "title": "AttackPath",
  "type": "object",
  "properties": {
    "attackPathId": { "type": "string", "pattern": "^AP-[0-9]+$" },
    "entryPoint": { "type": "string", "minLength": 1 },
    "initialPrivilege": { "type": "string" },
    "steps": { "type": "array", "minItems": 1, "items": { "type": "string" } },
    "targetAsset": { "type": "string", "minLength": 1 },
    "existingControls": { "type": "array", "items": { "type": "string" } },
    "failedControls": { "type": "array", "items": { "type": "string" } },
    "detectionCapability": { "type": "string" },
    "impact": { "type": "string" },
    "result": { "type": "string", "enum": ["blocked", "possible"] },
    "relatedFindingIds": { "type": "array", "items": { "type": "string" } },
    "reviewer": { "type": "string" }
  },
  "required": ["attackPathId", "entryPoint", "steps", "targetAsset", "result"],
  "additionalProperties": false
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: all 6 assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/finding-schema.json data/schemas/attack-path-schema.json tests/schemas/finding-attack-path-schemas.test.ts
git commit -m "feat: add finding and attack-path schemas"
```

---

### Task 8: Risk Acceptance and Release Evaluation schemas

**Files:**
- Create: `data/schemas/risk-acceptance-schema.json`
- Create: `data/schemas/release-evaluation-schema.json`
- Test: `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile` from `src/validate.ts` (Task 2).
- Produces: `data/schemas/risk-acceptance-schema.json`, `data/schemas/release-evaluation-schema.json` — this completes all 10 schemas listed in the spec's `schemas/` directory.

- [ ] **Step 1: Write the failing test**

Create `tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("risk-acceptance-schema", () => {
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
  };

  it("accepts a well-formed risk acceptance with an expiration date", () => {
    const validate = compileSchemaFromFile("data/schemas/risk-acceptance-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a risk acceptance with no expiresAt", () => {
    const validate = compileSchemaFromFile("data/schemas/risk-acceptance-schema.json");
    const { expiresAt, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });
});

describe("release-evaluation-schema", () => {
  const valid = {
    projectId: "proj-001",
    gate: 4,
    controlCoverage: 97,
    criticalFindings: 0,
    highFindings: 0,
    unblockedCriticalAttackPaths: 0,
    residualRisksAccepted: 3,
    incidentResponseVerified: true,
    backupRestoreVerified: true,
    result: "approved",
    evaluatedAt: "2026-09-16T05:00:00Z",
  };

  it("accepts a well-formed release evaluation", () => {
    const validate = compileSchemaFromFile("data/schemas/release-evaluation-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a gate value outside 0-4", () => {
    const validate = compileSchemaFromFile("data/schemas/release-evaluation-schema.json");
    expect(validate({ ...valid, gate: 5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — neither schema file exists yet.

- [ ] **Step 3: Write `data/schemas/risk-acceptance-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/risk-acceptance-schema.json",
  "title": "RiskAcceptance",
  "type": "object",
  "properties": {
    "riskAcceptanceId": { "type": "string", "pattern": "^RA-[0-9]+$" },
    "projectId": { "type": "string", "minLength": 1 },
    "controlId": { "type": "string" },
    "findingIds": { "type": "array", "items": { "type": "string" } },
    "reason": { "type": "string", "minLength": 1 },
    "compensatingControls": { "type": "array", "items": { "type": "string" } },
    "approvedBy": { "type": "string", "minLength": 1 },
    "approvedAt": { "type": "string", "format": "date-time" },
    "expiresAt": { "type": "string", "format": "date-time" },
    "reviewDate": { "type": ["string", "null"], "format": "date-time" },
    "status": { "type": "string", "enum": ["active", "expired", "revoked"] }
  },
  "required": ["riskAcceptanceId", "projectId", "controlId", "reason", "approvedBy", "approvedAt", "expiresAt", "status"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Write `data/schemas/release-evaluation-schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/release-evaluation-schema.json",
  "title": "ReleaseEvaluation",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "gate": { "type": "integer", "minimum": 0, "maximum": 4 },
    "controlCoverage": { "type": "number", "minimum": 0, "maximum": 100 },
    "criticalFindings": { "type": "integer", "minimum": 0 },
    "highFindings": { "type": "integer", "minimum": 0 },
    "unblockedCriticalAttackPaths": { "type": "integer", "minimum": 0 },
    "residualRisksAccepted": { "type": "integer", "minimum": 0 },
    "incidentResponseVerified": { "type": "boolean" },
    "backupRestoreVerified": { "type": "boolean" },
    "result": { "type": "string", "enum": ["approved", "blocked"] },
    "evaluatedAt": { "type": "string", "format": "date-time" }
  },
  "required": [
    "projectId", "gate", "controlCoverage", "criticalFindings", "highFindings",
    "unblockedCriticalAttackPaths", "residualRisksAccepted",
    "incidentResponseVerified", "backupRestoreVerified", "result", "evaluatedAt"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/risk-acceptance-schema.json data/schemas/release-evaluation-schema.json tests/schemas/risk-acceptance-release-evaluation-schemas.test.ts
git commit -m "feat: add risk-acceptance and release-evaluation schemas"
```

---

### Task 9: `core/` reference data

**Files:**
- Create: `data/core/principles.json`
- Create: `data/core/security-levels.json`
- Create: `data/core/profile-taxonomy.json`
- Test: `tests/core/core-data.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts` (Task 2).
- Produces: `data/core/*.json` — no other task depends on these programmatically; they are reference data for a future MCP `core.*` read tool.

- [ ] **Step 1: Write the failing test**

Create `tests/core/core-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadJson } from "../../src/validate.js";

describe("core/principles.json", () => {
  it("has all 7 core principles and the final principle", () => {
    const data = loadJson<{ principles: unknown[]; antiPatterns: unknown[]; layers: unknown[]; finalPrinciple: unknown }>(
      "data/core/principles.json"
    );
    expect(data.principles).toHaveLength(7);
    expect(data.antiPatterns.length).toBeGreaterThan(0);
    expect(data.layers).toHaveLength(5);
    expect(data.finalPrinciple).toBeDefined();
  });
});

describe("core/security-levels.json", () => {
  it("has 4 security levels and escalation rules", () => {
    const data = loadJson<{ levels: unknown[]; autoEscalation: { minimumSvl2: unknown[]; requiresSvl3Review: unknown[] } }>(
      "data/core/security-levels.json"
    );
    expect(data.levels).toHaveLength(4);
    expect(data.autoEscalation.minimumSvl2.length).toBeGreaterThan(0);
    expect(data.autoEscalation.requiresSvl3Review.length).toBeGreaterThan(0);
  });
});

describe("core/profile-taxonomy.json", () => {
  it("has exposure, identities, and D0-D3 data classification", () => {
    const data = loadJson<{ exposure: unknown[]; identities: unknown[]; dataClassification: { id: string }[] }>(
      "data/core/profile-taxonomy.json"
    );
    expect(data.exposure.length).toBeGreaterThan(0);
    expect(data.identities.length).toBeGreaterThan(0);
    expect(data.dataClassification.map((d) => d.id)).toEqual(["D0", "D1", "D2", "D3"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — none of the three files exist.

- [ ] **Step 3: Write `data/core/principles.json`**

```json
{
  "principles": [
    { "id": "P1", "title": "Assume Breach", "statement": "No security control is assumed to be absolutely safe. Always ask: if this control fails, what is the next line of defense?" },
    { "id": "P2", "title": "Least Privilege", "statement": "Every subject (user, service, database, CI/CD, cloud IAM) is granted only the minimum privilege it requires." },
    { "id": "P3", "title": "Zero Implicit Trust", "statement": "Client, browser, mobile app, desktop app, internal network, third-party API, webhook, AI model output, user-supplied files, request headers, and internal services are never trusted automatically." },
    { "id": "P4", "title": "Defense in Depth", "statement": "No single security mechanism is relied upon. Controls are layered, e.g. input validation, parameterized query, least-privilege DB account, data encryption, key isolation, monitoring." },
    { "id": "P5", "title": "Fail Secure", "statement": "An error must never resolve toward disabling a security control. An authentication server error must reject the request, never allow it unauthenticated." },
    { "id": "P6", "title": "Verifiable Security", "statement": "A control being applied is not enough; it must be verifiable. Requirement, Verification, and Evidence must all exist together." },
    { "id": "P7", "title": "Risk-based Security", "statement": "Not every project is forced through the same controls. Applicable scope is determined by risk level and attack surface." }
  ],
  "antiPatterns": [
    { "id": "AP-JUDGE-1", "wrongAssumption": "95% of all checklist items PASS, therefore the system is safe.", "correctAssumption": "Completion rate does not equal security level." },
    { "id": "AP-JUDGE-2", "wrongAssumption": "The security scanner reported zero findings, therefore there are no vulnerabilities.", "correctAssumption": "A scanner's silence is not proof of absence." },
    { "id": "AP-JUDGE-3", "wrongAssumption": "A WAF is installed, therefore SQL injection is safe.", "correctAssumption": "A compensating control does not eliminate the underlying defect." },
    { "id": "AP-JUDGE-4", "wrongAssumption": "The admin button is hidden from the UI, therefore the admin function is protected.", "correctAssumption": "Client-side hiding is not authorization." },
    { "id": "AP-JUDGE-5", "wrongAssumption": "Encryption is applied, therefore sensitive data is safe.", "correctAssumption": "If the key is exposed at the same point as the data, the protection is limited." }
  ],
  "layers": [
    { "layer": "context", "name": "Context", "purpose": "Determine what is being protected.", "examples": ["assets", "data", "architecture", "trust_boundary", "attack_surface", "threat_model"] },
    { "layer": "prevent", "name": "Prevent", "purpose": "Lower the probability of a successful attack.", "examples": ["authentication", "authorization", "input_validation", "encryption", "secret_management", "infrastructure_hardening", "secure_coding", "supply_chain_security"] },
    { "layer": "detect", "name": "Detect", "purpose": "Detect an attack or anomalous behavior.", "examples": ["logging", "audit", "monitoring", "alerting", "anomaly_detection"] },
    { "layer": "contain_recover", "name": "Contain & Recover", "purpose": "Limit blast radius and recover after a breach.", "examples": ["segmentation", "least_privilege", "backup", "key_rotation", "session_revocation", "incident_response", "disaster_recovery"] },
    { "layer": "assurance", "name": "Assurance", "purpose": "Verify that security controls actually work.", "examples": ["code_review", "sast", "dast", "sca", "pentest", "fuzzing", "threat_based_test", "evidence_review", "release_gate"] }
  ],
  "finalPrinciple": {
    "attackerProgression": ["get_in", "escalate", "reach_critical_assets", "remain_undetected", "cause_irreversible_damage"],
    "defenseGoal": ["prevent", "detect", "contain", "respond", "recover", "verify"],
    "statement": "The goal is a system where the failure of one security control does not lead to full system compromise."
  }
}
```

- [ ] **Step 4: Write `data/core/security-levels.json`**

```json
{
  "levels": [
    { "id": "SVL-0", "name": "Experimental", "criteria": ["proof_of_concept", "no_real_users", "no_external_exposure", "no_sensitive_data"], "criteriaMatch": "all" },
    { "id": "SVL-1", "name": "Standard", "criteria": ["limited_users", "low_sensitivity", "general_business_data"], "criteriaMatch": "all" },
    { "id": "SVL-2", "name": "High", "criteria": ["internet_exposure", "login", "personal_data", "payment", "admin_functions", "important_apis", "enterprise_sensitive_data"], "criteriaMatch": "any" },
    { "id": "SVL-3", "name": "Critical", "criteria": ["financial_core_function", "medical_safety_critical_system", "large_scale_personal_data", "credential_management", "infrastructure_control_plane", "encryption_key_management", "software_supply_chain", "large_scale_user_asset_management"], "criteriaMatch": "any" }
  ],
  "autoEscalation": {
    "minimumSvl2": ["payment_processing", "administrator_interface", "personal_data", "external_user_authentication", "production_infrastructure_control", "secret_management"],
    "requiresSvl3Review": ["medical_safety", "financial_core", "encryption_key_infrastructure", "identity_provider", "software_update_infrastructure", "cicd_control_plane", "large_scale_credential_storage"]
  }
}
```

- [ ] **Step 5: Write `data/core/profile-taxonomy.json`**

```json
{
  "exposure": ["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"],
  "identities": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"],
  "dataClassification": [
    { "id": "D0", "name": "Public", "description": "May be disclosed externally." },
    { "id": "D1", "name": "Internal", "description": "For internal organizational use." },
    { "id": "D2", "name": "Confidential", "description": "Disclosure causes business or personal harm.", "examples": ["personal_data", "contract_information", "internal_documents"] },
    { "id": "D3", "name": "Restricted", "description": "Disclosure causes severe harm.", "examples": ["credentials", "financial_information", "medical_information", "secrets", "api_keys", "encryption_keys", "cash_equivalent_assets", "critical_trade_secrets"] }
  ]
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: all 3 assertions PASS.

- [ ] **Step 7: Commit**

```bash
git add data/core tests/core/core-data.test.ts
git commit -m "feat: add core reference data (principles, security levels, profile taxonomy)"
```

---

### Task 10: `catalogs/` reference data

**Files:**
- Create: `data/catalogs/threats.json`
- Create: `data/catalogs/references.json`
- Create: `data/catalogs/evidence-types.json`
- Create: `data/catalogs/owner-roles.json`
- Create: `data/catalogs/asset-types.json`
- Test: `tests/catalogs/catalogs.test.ts`

**Interfaces:**
- Consumes: `loadJson`, `createAjv` from `src/validate.ts` (Task 2); `data/schemas/threat-schema.json` (Task 6).
- Produces: `data/catalogs/threats.json` — Task 13's controls reference `threatIds` that must exist in this file; Task 14's cross-check test depends on it.

- [ ] **Step 1: Write the failing test**

Create `tests/catalogs/catalogs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAjv, loadJson } from "../../src/validate.js";

describe("catalogs/threats.json", () => {
  it("contains only threats that validate against threat-schema.json", () => {
    const schema = loadJson<object>("data/schemas/threat-schema.json");
    const ajv = createAjv();
    const validate = ajv.compile(schema);
    const data = loadJson<{ threats: unknown[] }>("data/catalogs/threats.json");
    expect(data.threats.length).toBeGreaterThan(0);
    for (const threat of data.threats) {
      expect(validate(threat), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("has unique threatIds", () => {
    const data = loadJson<{ threats: { threatId: string }[] }>("data/catalogs/threats.json");
    const ids = data.threats.map((t) => t.threatId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("catalogs/evidence-types.json", () => {
  it("lists all 14 evidence types and a priority tier order", () => {
    const data = loadJson<{ types: string[]; priorityTiers: { tier: number; types: string[] }[] }>(
      "data/catalogs/evidence-types.json"
    );
    expect(data.types).toHaveLength(14);
    expect(data.priorityTiers.length).toBeGreaterThan(0);
    const tieredTypes = data.priorityTiers.flatMap((t) => t.types);
    expect(new Set(tieredTypes)).toEqual(new Set(data.types));
  });
});

describe("catalogs/owner-roles.json", () => {
  it("lists the 10 owner roles used by control-schema.json's ownerRole enum", () => {
    const data = loadJson<{ roles: string[] }>("data/catalogs/owner-roles.json");
    expect(data.roles).toEqual([
      "application", "frontend", "backend", "infrastructure", "devops",
      "security", "product", "privacy", "operations", "vendor",
    ]);
  });
});

describe("catalogs/asset-types.json and references.json", () => {
  it("asset-types.json has a non-empty assetTypes list", () => {
    const data = loadJson<{ assetTypes: string[] }>("data/catalogs/asset-types.json");
    expect(data.assetTypes.length).toBeGreaterThan(0);
  });

  it("references.json parses as an object with a references array", () => {
    const data = loadJson<{ references: unknown[] }>("data/catalogs/references.json");
    expect(Array.isArray(data.references)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — none of the five catalog files exist.

- [ ] **Step 3: Write `data/catalogs/threats.json`**

```json
{
  "threats": [
    { "threatId": "THR-IAM-UNAUTHENTICATED-ACCESS", "title": "Unauthenticated Access", "description": "An attacker reaches a protected function without presenting valid credentials.", "category": "authentication" },
    { "threatId": "THR-IAM-CREDENTIAL-EXPOSURE", "title": "Credential Exposure", "description": "Stored credentials are recovered in plaintext or a reversible form after a data store compromise.", "category": "authentication" },
    { "threatId": "THR-IAM-OFFLINE-CRACKING", "title": "Offline Password Cracking", "description": "A stolen password hash is cracked offline because it used a weak or unsalted hashing scheme.", "category": "authentication" },
    { "threatId": "THR-IAM-BRUTE-FORCE", "title": "Brute Force Login", "description": "An attacker submits a large number of password guesses against the login endpoint.", "category": "authentication" },
    { "threatId": "THR-IAM-CREDENTIAL-STUFFING", "title": "Credential Stuffing", "description": "An attacker replays credentials leaked from other breaches against the login endpoint.", "category": "authentication" },
    { "threatId": "THR-IAM-ACCOUNT-TAKEOVER", "title": "Account Takeover", "description": "An attacker gains persistent control of a privileged account using a single compromised factor.", "category": "authentication" },
    { "threatId": "THR-IAM-TOKEN-REPLAY", "title": "Token Replay", "description": "A password reset or similar single-use token is reused or replayed after its intended window.", "category": "authentication" },
    { "threatId": "THR-IAM-SESSION-HIJACK", "title": "Session Hijack", "description": "An attacker continues to use a session that should have been invalidated after a security-relevant event.", "category": "session" },
    { "threatId": "THR-IAM-CLIENT-SIDE-BYPASS", "title": "Client-side Authorization Bypass", "description": "An attacker calls a protected API directly, bypassing authorization checks that only exist in client-side UI code.", "category": "authorization" },
    { "threatId": "THR-IAM-IDOR", "title": "Insecure Direct Object Reference", "description": "An attacker accesses another user's object by manipulating an identifier, without an accompanying ownership check.", "category": "authorization" },
    { "threatId": "THR-IAM-PRIVILEGE-ESCALATION", "title": "Privilege Escalation", "description": "A low-privilege identity gains access to functionality or data reserved for a higher-privilege role.", "category": "authorization" },
    { "threatId": "THR-IAM-MASS-ASSIGNMENT", "title": "Mass Assignment", "description": "An attacker sets a privileged field (e.g. role, isAdmin) by including it in a request body the server binds without filtering.", "category": "authorization" },
    { "threatId": "THR-INJ-001", "title": "SQL Injection", "description": "External input changes the structure of a SQL query executed by the application.", "category": "injection" }
  ]
}
```

- [ ] **Step 4: Write `data/catalogs/references.json`**

```json
{
  "references": []
}
```

- [ ] **Step 5: Write `data/catalogs/evidence-types.json`**

```json
{
  "types": [
    "CODE", "CONFIG", "AUTOMATED_TEST", "MANUAL_TEST", "SCAN", "LOG",
    "AUDIT_LOG", "ARCHITECTURE", "CI_ARTIFACT", "DEPLOYMENT_RECORD",
    "SCREENSHOT", "TICKET", "REPORT", "MANUAL_REVIEW"
  ],
  "priorityTiers": [
    { "tier": 1, "label": "automated_reproducible_evidence", "types": ["AUTOMATED_TEST", "SCAN", "CI_ARTIFACT"] },
    { "tier": 2, "label": "configuration_or_code", "types": ["CODE", "CONFIG", "ARCHITECTURE", "DEPLOYMENT_RECORD"] },
    { "tier": 3, "label": "manual_test_result", "types": ["MANUAL_TEST", "MANUAL_REVIEW", "AUDIT_LOG", "LOG"] },
    { "tier": 4, "label": "screenshot", "types": ["SCREENSHOT"] },
    { "tier": 5, "label": "ticket_or_report", "types": ["TICKET", "REPORT"] }
  ],
  "insufficientEvidenceExamples": ["A developer states the control was applied, with no artifact attached."]
}
```

- [ ] **Step 6: Write `data/catalogs/owner-roles.json`**

```json
{
  "roles": ["application", "frontend", "backend", "infrastructure", "devops", "security", "product", "privacy", "operations", "vendor"]
}
```

- [ ] **Step 7: Write `data/catalogs/asset-types.json`**

```json
{
  "assetTypes": ["data", "service", "key", "account", "credential", "document", "infrastructure_resource"],
  "example": {
    "assetId": "AST-017",
    "assetName": "Customer Credential",
    "assetType": "credential",
    "dataClassification": "D3",
    "storage": "authentication_db",
    "access": ["auth_service"],
    "encryption": "password_hash",
    "businessImpact": "account_takeover"
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: all 6 assertions PASS.

- [ ] **Step 9: Commit**

```bash
git add data/catalogs tests/catalogs/catalogs.test.ts
git commit -m "feat: add catalog reference data (threats, evidence types, owner roles, asset types)"
```

---

### Task 11: `process/` reference data — batch 1 (verification flow, release gates, incident response)

**Files:**
- Create: `data/process/verification-flow.json`
- Create: `data/process/release-gates.json`
- Create: `data/process/incident-response.json`
- Test: `tests/process/process-batch-1.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts` (Task 2).
- Produces: `data/process/verification-flow.json`, `data/process/release-gates.json`, `data/process/incident-response.json`.

- [ ] **Step 1: Write the failing test**

Create `tests/process/process-batch-1.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadJson } from "../../src/validate.js";

describe("process/verification-flow.json", () => {
  it("has all 13 flow steps in order and a testing matrix", () => {
    const data = loadJson<{ flow: { step: number }[]; testingMatrix: Record<string, unknown> }>(
      "data/process/verification-flow.json"
    );
    expect(data.flow.map((f) => f.step)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(Object.keys(data.testingMatrix).length).toBeGreaterThan(0);
  });
});

describe("process/release-gates.json", () => {
  it("has gates 0 through 4 and a release blocker list", () => {
    const data = loadJson<{ gates: { gate: number }[]; releaseBlockers: unknown[]; revalidationTriggers: unknown[] }>(
      "data/process/release-gates.json"
    );
    expect(data.gates.map((g) => g.gate)).toEqual([0, 1, 2, 3, 4]);
    expect(data.releaseBlockers.length).toBeGreaterThan(0);
    expect(data.revalidationTriggers.length).toBeGreaterThan(0);
  });
});

describe("process/incident-response.json", () => {
  it("has a readiness checklist and the key question", () => {
    const data = loadJson<{ readinessChecklist: unknown[]; keyQuestion: string }>(
      "data/process/incident-response.json"
    );
    expect(data.readinessChecklist.length).toBeGreaterThan(0);
    expect(data.keyQuestion.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — none of the three files exist.

- [ ] **Step 3: Write `data/process/verification-flow.json`**

```json
{
  "flow": [
    { "step": 1, "name": "project_context" },
    { "step": 2, "name": "asset_identification" },
    { "step": 3, "name": "architecture_data_flow" },
    { "step": 4, "name": "attack_surface_identification" },
    { "step": 5, "name": "threat_identification" },
    { "step": 6, "name": "applicable_controls_selection" },
    { "step": 7, "name": "security_verification" },
    { "step": 8, "name": "evidence_collection" },
    { "step": 9, "name": "finding_risk_analysis" },
    { "step": 10, "name": "attack_path_analysis" },
    { "step": 11, "name": "residual_risk_review" },
    { "step": 12, "name": "release_gate" },
    { "step": 13, "name": "continuous_monitoring" }
  ],
  "testingMatrix": {
    "code_layer": ["code_review", "security_review", "sast", "secret_scan"],
    "dependency_layer": ["sca", "cve_scan", "sbom"],
    "application_layer": ["dast", "api_test", "business_logic_test"],
    "runtime": ["configuration_test", "authentication_test", "authorization_test"],
    "infrastructure": ["cloud_scan", "container_scan", "iac_scan"],
    "adversarial": ["manual_pentest", "abuse_test", "threat_based_test", "fuzzing"]
  },
  "automationCoverage": {
    "toolsFindWell": ["known_cve", "secret", "dependency", "simple_injection", "configuration"],
    "requiresHumanVerification": ["authorization_logic", "business_logic", "attack_chain", "trust_boundary", "architecture", "abuse", "fraud"]
  }
}
```

- [ ] **Step 4: Write `data/process/release-gates.json`**

```json
{
  "gates": [
    { "gate": 0, "name": "security_scope", "requires": ["security_profile", "asset_registry", "architecture", "data_classification"] },
    { "gate": 1, "name": "architecture", "requires": ["trust_boundary", "threat_model", "privilege_model", "security_level", "critical_asset"] },
    { "gate": 2, "name": "merge", "requires": ["code_review", "sast", "secret_scan", "dependency_scan", "security_test"] },
    { "gate": 3, "name": "pre_production", "requires": ["authentication", "authorization", "configuration", "infrastructure", "backup", "logging", "monitoring"] },
    {
      "gate": 4,
      "name": "production_release",
      "requiresByLevel": {
        "common": { "criticalFindings": 0 },
        "SVL-2": { "criticalFindings": 0, "highFindings": "0_or_accepted_risk" },
        "SVL-3": { "criticalFindings": 0, "highFindings": 0 }
      }
    }
  ],
  "releaseBlockers": [
    "authentication_bypass", "administrator_privilege_escalation", "unauthenticated_rce",
    "critical_sql_injection", "production_secret_exposure", "full_user_data_access",
    "missing_backup", "unblocked_critical_attack_path", "production_admin_mfa_missing",
    "signing_or_encryption_key_exposure"
  ],
  "revalidationTriggers": [
    "authentication_change", "authorization_change", "database_change", "sensitive_data_addition",
    "payment_addition", "file_upload_addition", "admin_function_addition", "third_party_addition",
    "cloud_migration", "framework_major_upgrade", "new_mobile_or_desktop_app", "ai_adoption",
    "security_incident", "critical_cve", "infrastructure_change"
  ]
}
```

- [ ] **Step 5: Write `data/process/incident-response.json`**

```json
{
  "readinessChecklist": [
    "revoke_all_sessions", "revoke_admin_sessions", "lock_user", "rotate_api_key",
    "rotate_secret", "rotate_encryption_key", "isolate_server", "stop_malicious_deployment",
    "rollback", "preserve_logs", "restore_backup"
  ],
  "keyQuestion": "If production were fully compromised right now, what would you do in the first 30 minutes?"
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: all 3 assertions PASS.

- [ ] **Step 7: Commit**

```bash
git add data/process/verification-flow.json data/process/release-gates.json data/process/incident-response.json tests/process/process-batch-1.test.ts
git commit -m "feat: add process reference data (verification flow, release gates, incident response)"
```

---

### Task 12: `process/` reference data — batch 2 (exception policy, metrics, deliverables)

**Files:**
- Create: `data/process/exception-policy.json`
- Create: `data/process/metrics.json`
- Create: `data/process/deliverables.json`
- Test: `tests/process/process-batch-2.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts` (Task 2).
- Produces: `data/process/exception-policy.json`, `data/process/metrics.json`, `data/process/deliverables.json` — completes the `process/` directory from the spec.

- [ ] **Step 1: Write the failing test**

Create `tests/process/process-batch-2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadJson } from "../../src/validate.js";

describe("process/exception-policy.json", () => {
  it("defines the full exception lifecycle", () => {
    const data = loadJson<{ lifecycle: string[] }>("data/process/exception-policy.json");
    expect(data.lifecycle).toEqual([
      "request", "risk_analysis", "approval", "compensating_control",
      "expiration", "review", "fix_renew_or_reject",
    ]);
  });
});

describe("process/metrics.json", () => {
  it("lists forbidden interpretations and recommended metrics", () => {
    const data = loadJson<{ forbiddenInterpretations: unknown[]; recommendedMetrics: unknown[] }>(
      "data/process/metrics.json"
    );
    expect(data.forbiddenInterpretations.length).toBeGreaterThan(0);
    expect(data.recommendedMetrics.length).toBeGreaterThan(0);
  });
});

describe("process/deliverables.json", () => {
  it("lists final deliverables and the 10 final questions", () => {
    const data = loadJson<{ finalDeliverables: unknown[]; finalJudgmentDimensions: unknown[]; finalQuestions: unknown[] }>(
      "data/process/deliverables.json"
    );
    expect(data.finalDeliverables).toHaveLength(14);
    expect(data.finalJudgmentDimensions).toHaveLength(5);
    expect(data.finalQuestions).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — none of the three files exist.

- [ ] **Step 3: Write `data/process/exception-policy.json`**

```json
{
  "lifecycle": ["request", "risk_analysis", "approval", "compensating_control", "expiration", "review", "fix_renew_or_reject"]
}
```

- [ ] **Step 4: Write `data/process/metrics.json`**

```json
{
  "forbiddenInterpretations": [
    { "metric": "pass_percentage", "wrongConclusion": "A high pass percentage means the system is secure." },
    { "metric": "vulnerability_count", "wrongConclusion": "A low count means the system is secure." },
    { "metric": "scanner_finding_count", "wrongConclusion": "Zero scanner findings means the system is secure." },
    { "metric": "patch_count", "wrongConclusion": "A high patch count means the system is secure." }
  ],
  "recommendedMetrics": [
    "critical_open_findings", "high_open_findings", "mean_time_to_remediate",
    "unreviewed_attack_paths", "expired_risk_acceptances", "unpatched_critical_cve",
    "privileged_account_count", "secret_rotation_age", "backup_restore_success",
    "security_test_coverage"
  ]
}
```

- [ ] **Step 5: Write `data/process/deliverables.json`**

```json
{
  "finalDeliverables": [
    "security_scope", "security_profile", "asset_registry", "data_flow_diagram",
    "architecture_diagram", "threat_model", "control_matrix", "evidence_package",
    "findings_report", "attack_path_report", "residual_risk_register",
    "release_gate_report", "incident_response_plan", "security_operations_guide"
  ],
  "finalJudgmentDimensions": [
    "control_compliance", "attack_path_status", "open_findings", "residual_risk", "operational_readiness"
  ],
  "finalQuestions": [
    "What assets must we protect?",
    "Where do those assets exist?",
    "Who can access them?",
    "Where can an attacker get in?",
    "What defenses exist on each attack path?",
    "Have those defenses actually been verified?",
    "If one defense fails, how far can an attacker get?",
    "Can we detect the attack?",
    "Can we contain the spread of damage?",
    "Can we restore the system to a trustworthy state?"
  ]
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: all 3 assertions PASS.

- [ ] **Step 7: Commit**

```bash
git add data/process/exception-policy.json data/process/metrics.json data/process/deliverables.json tests/process/process-batch-2.test.ts
git commit -m "feat: add process reference data (exception policy, metrics, deliverables)"
```

---

### Task 13: `controls/identity-access.json` — proof-of-concept domain (Authentication + Authorization)

**Files:**
- Create: `data/controls/identity-access.json`
- Test: `tests/controls/identity-access.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson`, `createAjv` from `src/validate.ts` (Task 2); `data/schemas/control-schema.json` (Task 3); `data/catalogs/threats.json` (Task 10).
- Produces: `data/controls/identity-access.json` — the reference implementation every future domain file (appsec, data-crypto, infrastructure, platform-specific, devops-supplychain, operations, governance) and the remaining identity-access subdomains (session/token, OAuth/SSO, privileged access, identity lifecycle) should follow.

This task populates the **IAM-AUTH** (Authentication, USSVS §18) and **IAM-AUTHZ** (Authorization, USSVS §19) subdomains — 12 controls in total. This is the proof-of-concept slice that exercises every field of `control-schema.json` (applicability rules, multi-method verification, SVL-scaled assurance, relationships, evidence requirements) against real content. The remaining Session/Token, OAuth/SSO, Privileged Access, and Identity Lifecycle subdomains of `identity-access.json`, and the other 7 domain files, are explicitly follow-up work — see the note after this plan.

- [ ] **Step 1: Write the failing test**

Create `tests/controls/identity-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";

describe("controls/identity-access.json", () => {
  it("has exactly 12 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/identity-access.json");
    expect(controls).toHaveLength(12);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("has unique controlIds", () => {
    const controls = loadJson<{ controlId: string }[]>("data/controls/identity-access.json");
    const ids = controls.map((c) => c.controlId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only threatIds that exist in catalogs/threats.json", () => {
    const controls = loadJson<{ threatIds: string[] }[]>("data/controls/identity-access.json");
    const threats = loadJson<{ threats: { threatId: string }[] }>("data/catalogs/threats.json");
    const knownThreatIds = new Set(threats.threats.map((t) => t.threatId));
    for (const control of controls) {
      for (const threatId of control.threatIds) {
        expect(knownThreatIds.has(threatId), `unknown threatId: ${threatId}`).toBe(true);
      }
    }
  });

  it("covers both the authentication and authorization domains", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/identity-access.json");
    const domains = new Set(controls.map((c) => c.domain));
    expect(domains).toEqual(new Set(["authentication", "authorization"]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/controls/identity-access.json` does not exist.

- [ ] **Step 3: Write `data/controls/identity-access.json`**

```json
[
  {
    "controlId": "IAM-AUTH-001",
    "version": 1,
    "status": "active",
    "title": "Authenticated Access Only",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "access_control",
    "layer": "prevent",
    "requirement": "Protected functionality must only be reachable by an authenticated user.",
    "rationale": "If any protected route accepts unauthenticated requests, every other authentication control on that route is moot.",
    "threatIds": ["THR-IAM-UNAUTHENTICATED-ACCESS"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authentication", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": {
      "SVL-1": ["route_review"],
      "SVL-2": ["route_review", "anonymous_api_test"],
      "SVL-3": ["route_review", "anonymous_api_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "anonymous_api_test",
          "procedure": "Call every protected route with no credentials and confirm each is rejected.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        },
        {
          "type": "route_review",
          "procedure": "Review the route table or middleware configuration to confirm every protected route is covered by an authentication check.",
          "requiredEvidenceTypes": ["CODE", "CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["All unauthenticated access attempts to protected functionality are rejected."],
    "evidenceRequirements": [
      { "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] },
      { "type": "CODE", "required": true }
    ],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["IAM-AUTHZ-001"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authentication"]
  },
  {
    "controlId": "IAM-AUTH-002",
    "version": 1,
    "status": "active",
    "title": "No Recoverable Password Storage",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "credential_storage",
    "layer": "prevent",
    "requirement": "Passwords must not be stored in a recoverable form.",
    "rationale": "A database compromise must not directly yield usable plaintext passwords.",
    "threatIds": ["THR-IAM-CREDENTIAL-EXPOSURE"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authentication", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": {
      "SVL-1": ["config_review"],
      "SVL-2": ["config_review"],
      "SVL-3": ["config_review", "manual_review"]
    },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the credential storage schema and confirm no reversible encoding or plaintext column exists for passwords.",
          "requiredEvidenceTypes": ["CODE", "CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No plaintext or reversibly-encoded password value can be retrieved from storage."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["IAM-AUTH-003"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authentication", "credential"]
  },
  {
    "controlId": "IAM-AUTH-003",
    "version": 1,
    "status": "active",
    "title": "Validated Password Hashing",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "credential_storage",
    "layer": "prevent",
    "requirement": "Password storage must use a validated password hashing algorithm.",
    "rationale": "A weak or unsalted hash lets a stolen credential database be cracked offline at scale.",
    "threatIds": ["THR-IAM-CREDENTIAL-EXPOSURE", "THR-IAM-OFFLINE-CRACKING"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authentication", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["config_review"],
      "SVL-2": ["config_review"],
      "SVL-3": ["config_review", "manual_review"]
    },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm the hashing algorithm and parameters (e.g. bcrypt, scrypt, argon2 with an adequate cost factor) used for password storage.",
          "requiredEvidenceTypes": ["CODE", "CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Passwords are hashed with a validated, adaptive, salted hashing algorithm."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": ["IAM-AUTH-002"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authentication", "credential", "cryptography"]
  },
  {
    "controlId": "IAM-AUTH-004",
    "version": 1,
    "status": "active",
    "title": "Login Brute-force Protection",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "login_defense",
    "layer": "prevent",
    "requirement": "The login request must be protected against repeated automated attempts.",
    "rationale": "Without a throttle, an attacker can guess passwords or replay leaked credentials at unlimited speed.",
    "threatIds": ["THR-IAM-BRUTE-FORCE", "THR-IAM-CREDENTIAL-STUFFING"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authentication", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["config_review"],
      "SVL-2": ["config_review", "dynamic_test"],
      "SVL-3": ["config_review", "dynamic_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Submit repeated failed login attempts for a single account and from a single source, and confirm the request is throttled or the account/source is temporarily locked.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST", "MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": [
      "Repeated login attempts against a single account are rate-limited or trigger a lockout.",
      "Repeated login attempts from a single network source are rate-limited."
    ],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authentication", "rate_limit"]
  },
  {
    "controlId": "IAM-AUTH-005",
    "version": 1,
    "status": "active",
    "title": "Privileged MFA",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "privileged_authentication",
    "layer": "prevent",
    "requirement": "Administrator and other privileged accounts must use multi-factor authentication.",
    "rationale": "A compromised password alone must not grant privileged access.",
    "threatIds": ["THR-IAM-ACCOUNT-TAKEOVER"],
    "applicability": {
      "when": { "all": [{ "fact": "identities", "operator": "contains", "value": "administrator" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["config_review"],
      "SVL-2": ["config_review", "manual_test"],
      "SVL-3": ["config_review", "manual_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "manual_test",
          "procedure": "Attempt a privileged login using only the password factor and confirm the login does not complete.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Privileged accounts cannot complete login with a password alone."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["application", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "mfa", "privileged"]
  },
  {
    "controlId": "IAM-AUTH-006",
    "version": 1,
    "status": "active",
    "title": "Single-use Password Reset Token",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "account_recovery",
    "layer": "prevent",
    "requirement": "A password reset token must be single-use and have a limited lifetime.",
    "rationale": "A reusable or long-lived reset token widens the window in which it can be intercepted and replayed.",
    "threatIds": ["THR-IAM-TOKEN-REPLAY"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authentication", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": {
      "SVL-1": ["config_review"],
      "SVL-2": ["config_review", "dynamic_test"],
      "SVL-3": ["config_review", "dynamic_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Use a password reset token twice, and use one after its expiry window, and confirm both are rejected.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": [
      "A password reset token is rejected on second use.",
      "A password reset token is rejected after its expiry window."
    ],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authentication", "account_recovery"]
  },
  {
    "controlId": "IAM-AUTH-007",
    "version": 1,
    "status": "active",
    "title": "Session Invalidation on Credential Change",
    "group": "identity_access",
    "domain": "authentication",
    "subdomain": "session_lifecycle",
    "layer": "prevent",
    "requirement": "Existing sessions must be invalidated after a password change or account recovery.",
    "rationale": "If an attacker already holds a live session, changing the password alone does not remove their access.",
    "threatIds": ["THR-IAM-SESSION-HIJACK"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authentication", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["config_review"],
      "SVL-2": ["config_review", "dynamic_test"],
      "SVL-3": ["config_review", "dynamic_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Hold an active session, change the account password through a second channel, and confirm the original session is no longer valid.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["All sessions issued before a password change or account recovery are invalidated by that event."],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authentication", "session"]
  },
  {
    "controlId": "IAM-AUTHZ-001",
    "version": 1,
    "status": "active",
    "title": "Server-side Authorization",
    "group": "identity_access",
    "domain": "authorization",
    "subdomain": "enforcement_location",
    "layer": "prevent",
    "requirement": "Every protected action must perform server-side authorization.",
    "rationale": "An authorization check that exists only in client-side code can be bypassed by calling the API directly.",
    "threatIds": ["THR-IAM-CLIENT-SIDE-BYPASS"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authorization", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": {
      "SVL-1": ["code_review"],
      "SVL-2": ["code_review", "dynamic_test"],
      "SVL-3": ["code_review", "dynamic_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Call each protected API directly, bypassing the client UI, and confirm the server independently enforces authorization.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST", "MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["Every protected action is rejected server-side when the authorization condition is not met, regardless of client-side state."],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["IAM-AUTH-001"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authorization"]
  },
  {
    "controlId": "IAM-AUTHZ-002",
    "version": 1,
    "status": "active",
    "title": "Object-level Authorization",
    "group": "identity_access",
    "domain": "authorization",
    "subdomain": "object_level_access",
    "layer": "prevent",
    "requirement": "A user must not be able to access another user's object by manipulating an identifier.",
    "rationale": "Object identifiers are frequently guessable or enumerable; ownership must be checked independently of the identifier's validity.",
    "threatIds": ["THR-IAM-IDOR"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authorization", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["code_review"],
      "SVL-2": ["code_review", "dynamic_test"],
      "SVL-3": ["code_review", "dynamic_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Using user A's credentials, request an object owned by user B and confirm access is denied.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST", "MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["Requests for an object owned by another user are denied.", "Object identifiers alone do not grant access."],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": ["IAM-AUTHZ-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authorization", "idor"]
  },
  {
    "controlId": "IAM-AUTHZ-003",
    "version": 1,
    "status": "active",
    "title": "Admin API Isolation",
    "group": "identity_access",
    "domain": "authorization",
    "subdomain": "function_level_access",
    "layer": "prevent",
    "requirement": "A regular user must not be able to call an administrator API.",
    "rationale": "Function-level authorization gaps let a low-privilege account reach administrative functionality directly.",
    "threatIds": ["THR-IAM-PRIVILEGE-ESCALATION"],
    "applicability": {
      "when": { "all": [{ "fact": "features.adminInterface", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": {
      "SVL-1": ["code_review"],
      "SVL-2": ["code_review", "dynamic_test"],
      "SVL-3": ["code_review", "dynamic_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Using a regular user's credentials, call each administrator API and confirm access is denied.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST", "MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["Every administrator API rejects requests from non-administrator identities."],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": ["IAM-AUTHZ-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authorization", "admin"]
  },
  {
    "controlId": "IAM-AUTHZ-004",
    "version": 1,
    "status": "active",
    "title": "Privileged Field Assignment Protection",
    "group": "identity_access",
    "domain": "authorization",
    "subdomain": "property_level_access",
    "layer": "prevent",
    "requirement": "A client must not be able to escalate privilege by setting a privilege-related field directly (e.g. role, permission, isAdmin, owner, approved).",
    "rationale": "Binding a request body directly onto a privileged model without filtering allows an attacker to set fields the UI never exposes.",
    "threatIds": ["THR-IAM-MASS-ASSIGNMENT"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authorization", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["code_review"],
      "SVL-2": ["code_review", "dynamic_test"],
      "SVL-3": ["code_review", "dynamic_test", "adversarial_test"]
    },
    "verification": {
      "methods": [
        {
          "type": "dynamic_test",
          "procedure": "Submit a write request that includes a privileged field (role, permission, isAdmin, owner, approved) not exposed by the UI, and confirm the server ignores or rejects it.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST", "MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["Privileged fields included in a client request body do not change the stored value unless the requester is independently authorized to change them."],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": ["IAM-AUTHZ-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authorization", "mass_assignment"]
  },
  {
    "controlId": "IAM-AUTHZ-005",
    "version": 1,
    "status": "active",
    "title": "Default-deny Authorization",
    "group": "identity_access",
    "domain": "authorization",
    "subdomain": "authorization_model",
    "layer": "prevent",
    "requirement": "Authorization decisions must default to deny.",
    "rationale": "A default-allow model silently grants access to any route or field an authorization rule forgets to cover.",
    "threatIds": ["THR-IAM-PRIVILEGE-ESCALATION"],
    "applicability": {
      "when": { "all": [{ "fact": "features.authorization", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": {
      "SVL-1": ["code_review"],
      "SVL-2": ["code_review"],
      "SVL-3": ["code_review", "manual_review"]
    },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review the authorization middleware/framework configuration and confirm a request with no matching rule is denied rather than allowed.",
          "requiredEvidenceTypes": ["CODE", "CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A request that matches no explicit authorization rule is denied."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["IAM-AUTHZ-001"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["iam", "authorization"]
  }
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add data/controls/identity-access.json tests/controls/identity-access.test.ts
git commit -m "feat: add identity-access controls (IAM-AUTH, IAM-AUTHZ) as proof-of-concept domain"
```

---

### Task 14: `manifest.json` and full-suite integration check

**Files:**
- Create: `data/manifest.json`
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts` (Task 2); the complete `data/` tree produced by Tasks 3-13.
- Produces: `data/manifest.json` — the entry point a future MCP server reads first to discover every other file, plus the final proof that the whole `data/` tree is internally consistent.

- [ ] **Step 1: Write the failing test**

Create `tests/manifest.test.ts`:

```ts
import { existsSync } from "node:fs";
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

  it("lists exactly the 10 schema files defined by the spec", () => {
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `data/manifest.json` does not exist.

- [ ] **Step 3: Write `data/manifest.json`**

```json
{
  "catalog": "USSVS",
  "catalogVersion": "2.0.0",
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-09-16T00:00:00Z",
  "core": {
    "files": ["core/principles.json", "core/security-levels.json", "core/profile-taxonomy.json"]
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
      "schemas/release-evaluation-schema.json"
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
Expected: all 3 manifest assertions PASS.

- [ ] **Step 5: Run the entire test suite one final time**

Run: `npm test`
Expected: every test file created across Tasks 1-14 passes, with zero failures.

- [ ] **Step 6: Commit**

```bash
git add data/manifest.json tests/manifest.test.ts
git commit -m "feat: add manifest.json and full data-tree integration check"
```

---

## Follow-up work (explicitly not in this plan)

Per the design spec (§13) and the external design review, bulk content authoring is intentionally deferred until the 5 core contracts (frozen by Tasks 3-5: control-schema, project-profile-schema, control-assessment-schema, the applicability DSL, and versioning) are proven against real content (Task 13). Once this plan lands, a follow-up plan should populate, using the exact pattern established in Task 13 (one control per array entry, validated against `control-schema.json`, `threatIds` cross-checked against `catalogs/threats.json`, one task per logical subdomain group):

- The remaining `identity-access.json` subdomains: Session & Token Controls (USSVS §20), OAuth/SSO Controls (§48), Privileged Access (§59), Identity Lifecycle (§58).
- The 7 remaining domain files: `appsec.json` (§21-28), `data-crypto.json` (§29-32, §57, §62), `infrastructure.json` (§32-38), `platform-specific.json` (§42-49 — expect this one to eventually split into `platform-client.json` / `platform-native.json` / `platform-ai.json` per the design review), `devops-supplychain.json` (§39-41), `operations.json` (§50-56), `governance.json` (§60-61, §63).
- Expanding `catalogs/threats.json` as each new domain introduces threats not yet in the catalog.
- Updating `data/manifest.json`'s `controls.count` and `controls.files` as each new domain file lands.
