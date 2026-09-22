# Catalog Integrity Hardening & Cross-Domain Pilot Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a semantic/catalog validator for cross-document referential integrity, resolve the two open Phase 1 design questions (assurance/verification linkage, ProjectProfile unknown semantics), and add a ~27-control cross-domain pilot catalog — closing the gaps and open questions documented in `PROGRESS.md` before any further control content is written at scale.

**Architecture:** A new `src/validate-catalog.ts` module adds a second, orthogonal validation layer on top of the existing Ajv structural validation (`src/validate.ts`): it checks referential/semantic integrity *across* documents (unique IDs, valid cross-references, assurance/verification consistency) that a single-document JSON Schema cannot express. Two existing schemas get small, targeted field-level changes. Five new Control domain files extend the catalog established by `identity-access.json` in Phase 1, deliberately selected to exercise every shape of the Applicability rule DSL at least once.

**Tech Stack:** TypeScript + Vitest + Ajv (draft 2020-12), matching the existing `src/validate.ts` (`loadJson`, `createAjv`, `compileSchemaFromFile`). No new dependencies, npm scripts, or CI wiring.

**Spec:** `docs/superpowers/specs/2026-09-22-catalog-integrity-and-pilot-design.md`

## Global Constraints

- No cross-file `$ref` between schema files — every schema stays self-contained (deliberate Phase 1 convention, reaffirmed in the spec's §8 adoption log after being explicitly weighed against and rejected).
- All new tests run under plain `npm test` (`vitest run`) — no new npm scripts, no new CI configuration.
- `data/manifest.json` and `tests/manifest.test.ts` are modified **only** in Task 11 (the final task). No earlier task touches either file, even though earlier tasks add files those files will eventually need to list. This mirrors the pattern Phase 2 used for the same reason: touching the manifest incrementally across many tasks causes needless merge friction, since Task 11 replaces the relevant sections wholesale anyway.
- **Known, expected, structural test failures during Tasks 6-10:** `tests/manifest.test.ts` has an assertion ("has a file set on disk matching the manifest for each category directory") that compares every file physically present under `data/controls/` against `data/manifest.json`'s `controls.files` list. From the moment Task 6 creates `data/controls/appsec.json` until Task 11 updates the manifest, this assertion **will fail** — this is expected and structural, not a defect introduced by Tasks 6-10. Every task dispatch from Task 6 onward must mention this by name so implementers and reviewers don't misreport "full green" or treat it as an unexplained regression.
- `control-schema.json`'s `controlId` pattern is `^[A-Z]+(-[A-Z]+)*-[0-9]{3}$` (uppercase-letter groups separated by hyphens, ending in exactly 3 digits — no digits or underscores inside a letter group). `threatId` pattern is `^THR-[A-Z0-9-]+$` (more permissive). Every new ID in this plan already satisfies these; an implementer inventing an additional ID must too.
- `verification.methods[].type` doubles as the de facto identity `assurance[svl]` entries point at (per spec §4): **within one control, no two verification methods may share a `type`**, and every `assurance[svl]` value must be one of that control's own `verification.methods[].type` values. Every piece of control content in this plan (Task 1's fixes and Tasks 6-10's new controls) was hand-verified against this rule before being written into this plan — an implementer changing any assurance or verification content must re-verify it.
- Assurance is cumulative (spec §3 rule 7): for any control defining more than one of `SVL-1`/`SVL-2`/`SVL-3`, each higher SVL's assurance array must be a superset of the next-lower one's.

---

## Task 1: Fix `identity-access.json`'s Assurance/Verification Gaps

**Context:** While designing Task 2's semantic validator, a dry run of its planned rules against the current real data surfaced that 11 of `identity-access.json`'s 12 controls reference a verification method `type` in their `assurance` block that no `verification.methods` entry on that same control actually defines (34 individual gaps in total — e.g. `IAM-AUTH-001`'s `assurance.SVL-3` includes `"adversarial_test"`, but its `verification.methods` only defines `anonymous_api_test` and `route_review`). The spec's §4 claim that "the existing convention already works... zero migration cost" was correct about *schema structure* (no field changes needed) but did not anticipate that the *content* itself was incomplete against the rule once it's actually enforced. This task closes that gap by adding the missing `verification.methods` entries — completing the verification story these controls were already gesturing at, not just satisfying a validator.

Doing this first (before Task 2 exists) means Task 2's "current real data is clean" baseline test is green from the moment it's written, rather than needing to reopen this file mid-way through building the validator.

**Files:**
- Modify: `data/controls/identity-access.json`

**Interfaces:**
- Consumes: nothing (pure content fix)
- Produces: a `data/controls/identity-access.json` where, for every control, `assurance[svl] ⊆ verification.methods[].type` and all `verification.methods[].type` values are unique per control — the baseline Task 2's validator tests against.

- [ ] **Step 1: Add the missing `verification.methods` entries**

For each `controlId` below, append the listed objects to that control's existing `verification.methods` array (do not remove or reorder the existing entries).

`IAM-AUTH-001` — append:
```json
{
  "type": "adversarial_test",
  "procedure": "Attempt common authentication bypass techniques (header injection, method override, alternate path casing) against protected routes and confirm none succeed.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTH-002` — append:
```json
{
  "type": "manual_review",
  "procedure": "A reviewer independently inspects the production credential store (or a representative export) to confirm no recoverable password value is present.",
  "requiredEvidenceTypes": ["MANUAL_REVIEW"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTH-003` — append:
```json
{
  "type": "manual_review",
  "procedure": "A reviewer independently confirms the hashing algorithm and cost parameters in the production configuration match the validated algorithm approved for this security level.",
  "requiredEvidenceTypes": ["MANUAL_REVIEW"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTH-004` — append both:
```json
{
  "type": "config_review",
  "procedure": "Inspect the rate-limiting or account-lockout configuration and confirm thresholds and windows are set for the login endpoint.",
  "requiredEvidenceTypes": ["CONFIG"],
  "minimumSvl": "SVL-1",
  "automatable": false
},
{
  "type": "adversarial_test",
  "procedure": "Attempt to bypass the throttle using distributed source IPs or credential-stuffing patterns and confirm the defense still triggers.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTH-005` — append both:
```json
{
  "type": "config_review",
  "procedure": "Inspect the identity provider or authentication configuration and confirm MFA is enforced (not merely offered) for every privileged role.",
  "requiredEvidenceTypes": ["CONFIG"],
  "minimumSvl": "SVL-1",
  "automatable": false
},
{
  "type": "adversarial_test",
  "procedure": "Attempt to bypass or downgrade the MFA step (e.g. via a legacy endpoint or a remember-device flaw) for a privileged account.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTH-006` — append:
```json
{
  "type": "config_review",
  "procedure": "Inspect the password reset token generation configuration and confirm the token is single-use and has a bounded expiry window.",
  "requiredEvidenceTypes": ["CONFIG"],
  "minimumSvl": "SVL-1",
  "automatable": false
}
```

`IAM-AUTH-007` — append:
```json
{
  "type": "config_review",
  "procedure": "Inspect the session store configuration and confirm a password change or account recovery event triggers invalidation of all other active sessions.",
  "requiredEvidenceTypes": ["CONFIG"],
  "minimumSvl": "SVL-1",
  "automatable": false
}
```

`IAM-AUTHZ-001` — append both:
```json
{
  "type": "code_review",
  "procedure": "Review each protected endpoint's handler code and confirm an authorization check executes on the server before the protected action runs.",
  "requiredEvidenceTypes": ["CODE"],
  "minimumSvl": "SVL-1",
  "automatable": false
},
{
  "type": "adversarial_test",
  "procedure": "Attempt to reach protected functionality through undocumented or legacy API paths that may bypass the primary authorization layer.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTHZ-002` — append both:
```json
{
  "type": "code_review",
  "procedure": "Review each data-access handler and confirm ownership or grant is checked against the authenticated identity before returning or modifying an object.",
  "requiredEvidenceTypes": ["CODE"],
  "minimumSvl": "SVL-1",
  "automatable": false
},
{
  "type": "adversarial_test",
  "procedure": "Enumerate adjacent object identifiers (sequential IDs, predictable UUIDs) across multiple resource types and confirm cross-user access remains denied.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTHZ-003` — append both:
```json
{
  "type": "code_review",
  "procedure": "Review the administrator API's routing and middleware configuration and confirm a role check gates every administrator endpoint.",
  "requiredEvidenceTypes": ["CODE"],
  "minimumSvl": "SVL-1",
  "automatable": false
},
{
  "type": "adversarial_test",
  "procedure": "Attempt to reach administrator functionality via parameter pollution, verb tampering, or an unlisted administrator route.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTHZ-004` — append both:
```json
{
  "type": "code_review",
  "procedure": "Review request-binding code for privileged models and confirm an explicit allow-list, not a deny-list, governs which fields a client request may set.",
  "requiredEvidenceTypes": ["CODE"],
  "minimumSvl": "SVL-1",
  "automatable": false
},
{
  "type": "adversarial_test",
  "procedure": "Submit nested or alternately-cased privileged field names (e.g. user[role], ROLE, is_admin) to probe for allow-list gaps.",
  "requiredEvidenceTypes": ["MANUAL_TEST"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

`IAM-AUTHZ-005` — append:
```json
{
  "type": "manual_review",
  "procedure": "A reviewer traces a sample of routes with no explicit authorization rule and confirms each is denied rather than silently allowed.",
  "requiredEvidenceTypes": ["MANUAL_REVIEW"],
  "minimumSvl": "SVL-3",
  "automatable": false
}
```

- [ ] **Step 2: Run the existing test suite to confirm nothing regressed**

Run: `npm test`
Expected: all 107 previously-passing tests still pass (the file remains schema-valid — these are additive `verification.methods` entries, and `control-schema.test.ts`/`tests/controls/identity-access.test.ts` only assert schema validity, uniqueness, and threat-reference validity, none of which this change affects).

- [ ] **Step 3: Write a temporary confirmation script and verify zero linkage gaps remain**

This step has no permanent test file (Task 2 builds the real, permanent test for this rule) — it's a one-time check that this task's content fix is actually complete before moving on.

Run this and confirm it prints nothing:
```bash
node -e "
const fs = require('fs');
const controls = JSON.parse(fs.readFileSync('data/controls/identity-access.json', 'utf-8'));
for (const c of controls) {
  const types = new Set(c.verification.methods.map(m => m.type));
  for (const [svl, values] of Object.entries(c.assurance || {})) {
    for (const v of values) {
      if (!types.has(v)) console.log('MISSING', c.controlId, svl, v);
    }
  }
}
"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add data/controls/identity-access.json
git commit -m "fix: complete verification.methods for identity-access.json's assurance references"
```

---

## Task 2: Semantic Catalog Validator

**Files:**
- Create: `src/validate-catalog.ts`
- Test: `tests/semantic-validate.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts` (`import { loadJson } from "./validate.js"`)
- Produces: `export interface CatalogViolation { code: string; severity: "error"; source: string; entityId: string; path: string; message: string }` and `export function validateCatalog(dataDir: string): CatalogViolation[]` — later tasks and any future consumer (CI, an MCP tool) call this function and this shape.

- [ ] **Step 1: Write the failing test**

Create `tests/semantic-validate.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCatalog } from "../src/validate-catalog.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function baseControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    controlId: "TEST-001",
    status: "active",
    threatIds: ["THR-TEST-001"],
    relationships: {},
    verification: { methods: [{ type: "manual_test" }] },
    assurance: {},
    ...overrides,
  };
}

function writeCatalog(
  controlsFiles: Record<string, unknown[]>,
  threats: { threatId: string }[] = [{ threatId: "THR-TEST-001" }],
  weights: Record<string, number> = { a: 0.5, b: 0.5 }
): string {
  const dir = mkdtempSync(join(tmpdir(), "csi-mcp-catalog-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "controls"));
  mkdirSync(join(dir, "catalogs"));
  mkdirSync(join(dir, "core"));
  for (const [name, controls] of Object.entries(controlsFiles)) {
    writeFileSync(join(dir, "controls", name), JSON.stringify(controls));
  }
  writeFileSync(join(dir, "catalogs", "threats.json"), JSON.stringify({ threats }));
  writeFileSync(join(dir, "core", "criticality-weights.json"), JSON.stringify({ weights }));
  return dir;
}

describe("validateCatalog", () => {
  it("returns no violations for the real data/ tree", () => {
    expect(validateCatalog("data")).toEqual([]);
  });

  it("catches duplicate controlIds across files", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ controlId: "DUP-001" })],
      "b.json": [baseControl({ controlId: "DUP-001" })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_DUPLICATE_CONTROL_ID")).toBe(true);
  });

  it("catches duplicate threatIds", () => {
    const dir = writeCatalog(
      { "a.json": [baseControl()] },
      [{ threatId: "THR-DUP" }, { threatId: "THR-DUP" }]
    );
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_DUPLICATE_THREAT_ID")).toBe(true);
  });

  it("catches a threatId referenced by a control but absent from the threat catalog", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ threatIds: ["THR-MISSING"] })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_UNKNOWN_THREAT")).toBe(true);
  });

  it("catches a relationships target that doesn't exist", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ relationships: { dependsOn: ["NOPE-001"] } })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_UNKNOWN_RELATIONSHIP_TARGET")).toBe(true);
  });

  it("catches a control naming itself in replacedBy", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ controlId: "SELF-001", replacedBy: "SELF-001" })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_REPLACED_BY_SELF")).toBe(true);
  });

  it("catches a replacedBy chain that cycles", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({ controlId: "CYC-A", replacedBy: "CYC-B" }),
        baseControl({ controlId: "CYC-B", replacedBy: "CYC-A" }),
      ],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_REPLACED_BY_CYCLE")).toBe(true);
  });

  it("catches two verification methods sharing a type within one control", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ verification: { methods: [{ type: "manual_test" }, { type: "manual_test" }] } })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_DUPLICATE_VERIFICATION_TYPE")).toBe(true);
  });

  it("catches assurance referencing a verification method type the control doesn't define", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ assurance: { "SVL-1": ["nonexistent_method"] } })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_UNKNOWN_ASSURANCE_METHOD")).toBe(true);
  });

  it("catches assurance that drops a requirement at a higher SVL", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({
          verification: { methods: [{ type: "config_review" }, { type: "manual_test" }] },
          assurance: { "SVL-1": ["config_review", "manual_test"], "SVL-2": ["config_review"] },
        }),
      ],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_ASSURANCE_NOT_CUMULATIVE")).toBe(true);
  });

  it("catches criticality weights that don't sum to 1.0", () => {
    const dir = writeCatalog({ "a.json": [baseControl()] }, undefined, { a: 0.3, b: 0.3 });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_WEIGHTS_NOT_NORMALIZED")).toBe(true);
  });

  it("sorts violations deterministically by severity, source, entityId, code", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({ controlId: "Z-001", threatIds: ["THR-MISSING-Z"] }),
        baseControl({ controlId: "A-001", threatIds: ["THR-MISSING-A"] }),
      ],
    });
    const violations = validateCatalog(dir);
    const relevant = violations.filter((v) => v.code === "CATALOG_UNKNOWN_THREAT");
    expect(relevant.map((v) => v.entityId)).toEqual(["A-001", "Z-001"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/semantic-validate.test.ts`
Expected: FAIL — `Cannot find module '../src/validate-catalog.js'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/validate-catalog.ts`:

```ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJson } from "./validate.js";

export interface CatalogViolation {
  code: string;
  severity: "error";
  source: string;
  entityId: string;
  path: string;
  message: string;
}

interface VerificationMethod {
  type: string;
}

interface Control {
  controlId: string;
  replacedBy?: string;
  threatIds: string[];
  relationships?: {
    dependsOn?: string[];
    relatedTo?: string[];
    supersedes?: string[];
    compensatesFor?: string[];
    conflictsWith?: string[];
  };
  assurance?: Record<string, string[]>;
  verification: { methods: VerificationMethod[] };
}

interface ThreatCatalog {
  threats: { threatId: string }[];
}

interface CriticalityWeights {
  weights: Record<string, number>;
}

const RELATIONSHIP_KEYS = ["dependsOn", "relatedTo", "supersedes", "compensatesFor", "conflictsWith"] as const;
const SVL_ORDER = ["SVL-1", "SVL-2", "SVL-3"] as const;

export function validateCatalog(dataDir: string): CatalogViolation[] {
  const violations: CatalogViolation[] = [];

  const controlsDir = join(dataDir, "controls");
  const controlFiles = readdirSync(controlsDir).filter((f) => f.endsWith(".json"));
  const controlsBySource = controlFiles.map((f) => ({
    source: `controls/${f}`,
    controls: loadJson<Control[]>(join(controlsDir, f)),
  }));
  const allControls = controlsBySource.flatMap(({ source, controls }) =>
    controls.map((control) => ({ source, control }))
  );
  const controlIds = new Set(allControls.map(({ control }) => control.controlId));

  const threatsData = loadJson<ThreatCatalog>(join(dataDir, "catalogs/threats.json"));
  const knownThreatIds = new Set(threatsData.threats.map((t) => t.threatId));

  // controlId uniqueness
  const seenControlIds = new Map<string, string>();
  for (const { source, control } of allControls) {
    if (seenControlIds.has(control.controlId)) {
      violations.push({
        code: "CATALOG_DUPLICATE_CONTROL_ID",
        severity: "error",
        source,
        entityId: control.controlId,
        path: "controlId",
        message: `Duplicate controlId ${control.controlId} (also in ${seenControlIds.get(control.controlId)})`,
      });
    } else {
      seenControlIds.set(control.controlId, source);
    }
  }

  // threatId uniqueness
  const seenThreatIds = new Map<string, number>();
  threatsData.threats.forEach((t, i) => {
    if (seenThreatIds.has(t.threatId)) {
      violations.push({
        code: "CATALOG_DUPLICATE_THREAT_ID",
        severity: "error",
        source: "catalogs/threats.json",
        entityId: t.threatId,
        path: `threats[${i}].threatId`,
        message: `Duplicate threatId ${t.threatId}`,
      });
    } else {
      seenThreatIds.set(t.threatId, i);
    }
  });

  // threatIds-exist
  for (const { source, control } of allControls) {
    control.threatIds.forEach((tid, i) => {
      if (!knownThreatIds.has(tid)) {
        violations.push({
          code: "CATALOG_UNKNOWN_THREAT",
          severity: "error",
          source,
          entityId: control.controlId,
          path: `threatIds[${i}]`,
          message: `Unknown threatId ${tid}`,
        });
      }
    });
  }

  // relationships-exist
  for (const { source, control } of allControls) {
    for (const key of RELATIONSHIP_KEYS) {
      const ids = control.relationships?.[key] ?? [];
      ids.forEach((rid, i) => {
        if (!controlIds.has(rid)) {
          violations.push({
            code: "CATALOG_UNKNOWN_RELATIONSHIP_TARGET",
            severity: "error",
            source,
            entityId: control.controlId,
            path: `relationships.${key}[${i}]`,
            message: `Unknown controlId ${rid} referenced in relationships.${key}`,
          });
        }
      });
    }
  }

  // replacedBy-valid: exists, no self-reference, no cycle
  const replacedByMap = new Map<string, string>();
  for (const { control } of allControls) {
    if (control.replacedBy) replacedByMap.set(control.controlId, control.replacedBy);
  }
  for (const { source, control } of allControls) {
    if (!control.replacedBy) continue;
    if (control.replacedBy === control.controlId) {
      violations.push({
        code: "CATALOG_REPLACED_BY_SELF",
        severity: "error",
        source,
        entityId: control.controlId,
        path: "replacedBy",
        message: `Control ${control.controlId} names itself in replacedBy`,
      });
      continue;
    }
    if (!controlIds.has(control.replacedBy)) {
      violations.push({
        code: "CATALOG_UNKNOWN_REPLACED_BY",
        severity: "error",
        source,
        entityId: control.controlId,
        path: "replacedBy",
        message: `Unknown controlId ${control.replacedBy} referenced in replacedBy`,
      });
      continue;
    }
    const visited = new Set<string>([control.controlId]);
    let current: string | undefined = control.replacedBy;
    while (current) {
      if (visited.has(current)) {
        violations.push({
          code: "CATALOG_REPLACED_BY_CYCLE",
          severity: "error",
          source,
          entityId: control.controlId,
          path: "replacedBy",
          message: `replacedBy chain starting at ${control.controlId} contains a cycle at ${current}`,
        });
        break;
      }
      visited.add(current);
      current = replacedByMap.get(current);
    }
  }

  // assurance-verification-linkage: type uniqueness + assurance subset
  for (const { source, control } of allControls) {
    const types = control.verification.methods.map((m) => m.type);
    const seenTypes = new Set<string>();
    types.forEach((t, i) => {
      if (seenTypes.has(t)) {
        violations.push({
          code: "CATALOG_DUPLICATE_VERIFICATION_TYPE",
          severity: "error",
          source,
          entityId: control.controlId,
          path: `verification.methods[${i}].type`,
          message: `Duplicate verification method type "${t}" within control ${control.controlId}`,
        });
      }
      seenTypes.add(t);
    });
    const typeSet = new Set(types);
    for (const [svl, values] of Object.entries(control.assurance ?? {})) {
      values.forEach((v, i) => {
        if (!typeSet.has(v)) {
          violations.push({
            code: "CATALOG_UNKNOWN_ASSURANCE_METHOD",
            severity: "error",
            source,
            entityId: control.controlId,
            path: `assurance.${svl}[${i}]`,
            message: `assurance.${svl} references verification method type "${v}" not defined in verification.methods`,
          });
        }
      });
    }
  }

  // assurance-cumulative: SVL-1 subset of SVL-2 subset of SVL-3
  for (const { source, control } of allControls) {
    const assurance = control.assurance ?? {};
    for (let i = 1; i < SVL_ORDER.length; i++) {
      const lower = assurance[SVL_ORDER[i - 1]];
      const higher = assurance[SVL_ORDER[i]];
      if (!lower || !higher) continue;
      const higherSet = new Set(higher);
      const missing = lower.filter((v) => !higherSet.has(v));
      if (missing.length > 0) {
        violations.push({
          code: "CATALOG_ASSURANCE_NOT_CUMULATIVE",
          severity: "error",
          source,
          entityId: control.controlId,
          path: `assurance.${SVL_ORDER[i]}`,
          message: `assurance.${SVL_ORDER[i]} drops requirement(s) [${missing.join(", ")}] present in assurance.${SVL_ORDER[i - 1]}`,
        });
      }
    }
  }

  // criticality-weights-sum
  const weightsData = loadJson<CriticalityWeights>(join(dataDir, "core/criticality-weights.json"));
  const sum = Object.values(weightsData.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) >= 1e-9) {
    violations.push({
      code: "CATALOG_WEIGHTS_NOT_NORMALIZED",
      severity: "error",
      source: "core/criticality-weights.json",
      entityId: "CRIT-DEFAULT",
      path: "weights",
      message: `Criticality weights sum to ${sum}, expected 1.0`,
    });
  }

  violations.sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.source.localeCompare(b.source) ||
      a.entityId.localeCompare(b.entityId) ||
      a.code.localeCompare(b.code)
  );
  return violations;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/semantic-validate.test.ts`
Expected: PASS, all 12 test cases. If "returns no violations for the real data/ tree" fails, confirm Task 1 was completed first (this test depends on it).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all previously-passing tests plus this file's 12 new tests pass (107 + 12 = 119; the exact prior baseline count may differ slightly if Task 1 added no new tests — confirm against the count reported by your own `npm test` run, not this fixed number).

- [ ] **Step 6: Commit**

```bash
git add src/validate-catalog.ts tests/semantic-validate.test.ts
git commit -m "feat: add semantic catalog validator for cross-document referential integrity"
```

---

## Task 3: Schema Drift-Guard Tests

**Files:**
- Test: `tests/schema-drift.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `src/validate.ts`
- Produces: nothing consumed by later tasks (a standalone guard test)

- [ ] **Step 1: Write the test**

Create `tests/schema-drift.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadJson } from "../src/validate.js";

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
}

describe("schema-drift", () => {
  it("Project.profile matches project-profile-schema.json (minus projectId)", () => {
    const projectSchema = loadJson<{ properties: { profile: JsonSchemaObject } }>(
      "data/schemas/project-schema.json"
    );
    const profileSchema = loadJson<JsonSchemaObject>("data/schemas/project-profile-schema.json");
    const embedded = projectSchema.properties.profile;

    const { projectId, ...standaloneProps } = profileSchema.properties ?? {};
    expect(embedded.properties).toEqual(standaloneProps);

    const standaloneRequired = (profileSchema.required ?? []).filter((k) => k !== "projectId");
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });

  it("ProjectReport.score matches score-schema.json (minus projectId and computedAt)", () => {
    const reportSchema = loadJson<{ properties: { score: JsonSchemaObject } }>(
      "data/schemas/project-report-schema.json"
    );
    const scoreSchema = loadJson<JsonSchemaObject>("data/schemas/score-schema.json");
    const embedded = reportSchema.properties.score;

    const { projectId, computedAt, ...standaloneProps } = scoreSchema.properties ?? {};
    expect(embedded.properties).toEqual(standaloneProps);

    const standaloneRequired = (scoreSchema.required ?? []).filter((k) => k !== "projectId" && k !== "computedAt");
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });

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

  it("AssessmentPlan.groupBy enum matches AssessmentBatch.groupBy enum (temporary mirror invariant — spec §3 rule 12)", () => {
    const planSchema = loadJson<{ properties: { groupBy: { enum: string[] } } }>(
      "data/schemas/assessment-plan-schema.json"
    );
    const batchSchema = loadJson<{ properties: { groupBy: { enum: string[] } } }>(
      "data/schemas/assessment-batch-schema.json"
    );
    expect([...planSchema.properties.groupBy.enum].sort()).toEqual(
      [...batchSchema.properties.groupBy.enum].sort()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/schema-drift.test.ts`
Expected: PASS, all 4 tests — these compare files that already agree today, so this test should pass immediately on first write (there is no "make it fail then pass" cycle here since it's a guard against a form of *future* drift, not a new capability).

- [ ] **Step 3: Commit**

```bash
git add tests/schema-drift.test.ts
git commit -m "test: add drift-guard tests for 4 hand-duplicated schema structures"
```

---

## Task 4: Fix `finding-schema.json` Ajv `strict:true` Failure

**Files:**
- Modify: `data/schemas/finding-schema.json`
- Test: `tests/schemas/finding-attack-path-schemas.test.ts` (add one test)

**Interfaces:**
- Consumes: nothing
- Produces: `finding-schema.json` compiles under `new Ajv2020({strict: true})` like the other 17 schemas.

- [ ] **Step 1: Write the failing test**

Open `tests/schemas/finding-attack-path-schemas.test.ts`. This project uses ESM (`package.json` has `"type": "module"`), so add these two imports at the top of the file, alongside the existing ones (do not remove the existing `describe`/`expect`/`it`/`compileSchemaFromFile` imports):

```ts
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadJson } from "../../src/validate.js";
```

Then add this `describe` block at the end of the file (after the existing content — do not remove or modify any existing test in this file):

```ts
describe("all 18 schemas compile under Ajv strict:true", () => {
  it("finding-schema.json compiles under strict:true", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const schema = loadJson<object>("data/schemas/finding-schema.json");
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schemas/finding-attack-path-schemas.test.ts`
Expected: FAIL with `strict mode: missing type "object" for keyword "required" at ".../allOf/0/if/properties/criticality" (strictTypes)`.

- [ ] **Step 3: Fix the schema**

In `data/schemas/finding-schema.json`, replace the existing `allOf` block:

```json
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
```

with:

```json
  "allOf": [
    {
      "if": {
        "properties": {
          "criticality": {
            "type": "object",
            "properties": { "index": { "type": "integer", "minimum": 8 } },
            "required": ["index"]
          },
          "priority": {
            "type": "object",
            "properties": { "index": { "type": "integer", "minimum": 2 } },
            "required": ["index"]
          }
        },
        "required": ["criticality", "priority"]
      },
      "then": {
        "properties": { "priorityOverrideReason": { "type": "string" } },
        "required": ["priorityOverrideReason"]
      }
    }
  ]
```

This only adds explicit `type` declarations that were already implied by the top-level `criticality`/`priority`/`priorityOverrideReason` property definitions elsewhere in the same file — it does not change what the schema accepts or rejects at runtime.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/schemas/finding-attack-path-schemas.test.ts`
Expected: PASS, including all pre-existing tests in this file (confirm none regressed — the guardrail's actual accept/reject behavior is unchanged).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/finding-schema.json tests/schemas/finding-attack-path-schemas.test.ts
git commit -m "fix: make finding-schema.json compile under Ajv strict:true"
```

---

## Task 5: `ProjectProfile` Three-Valued Array Fields

**Files:**
- Modify: `data/schemas/project-profile-schema.json`
- Modify: `data/schemas/project-schema.json`
- Modify: `tests/schemas/project-profile-schema.test.ts`
- Modify: `tests/schemas/project-schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: both schemas accept a document that omits `components`, `identities`, or `dataClasses` entirely (in addition to already accepting `[]` and populated arrays, which they already did).

- [ ] **Step 1: Write the failing tests**

In `tests/schemas/project-profile-schema.test.ts`, add this test inside the existing `describe("project-profile-schema", ...)` block (after the last existing `it`, before the closing `});`):

```ts
  it("accepts a profile with components/identities/dataClasses omitted entirely (unknown, not empty)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    const { components, identities, dataClasses, ...rest } = validProfile;
    expect(validate(rest), JSON.stringify(validate.errors)).toBe(true);
  });
```

In `tests/schemas/project-schema.test.ts`, add this test inside the existing `describe("project-schema", ...)` block (after the last existing `it`, before the closing `});`):

```ts
  it("accepts a profile with components/identities/dataClasses omitted entirely (unknown, not empty)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const { components, identities, dataClasses, ...restProfile } = valid.profile;
    const partial = { ...valid, profile: restProfile };
    expect(validate(partial), JSON.stringify(validate.errors)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/schemas/project-profile-schema.test.ts tests/schemas/project-schema.test.ts`
Expected: both new tests FAIL (the schemas currently require these three fields).

- [ ] **Step 3: Fix `project-profile-schema.json`**

Change the `components`, `identities`, `dataClasses` property definitions to add a `description`, and remove all three from `required`:

Replace:
```json
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
```
with:
```json
    "components": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "description": "Three-valued: omitted = not yet profiled (UNKNOWN); [] = profiled, no components apply (KNOWN NONE); [...] = profiled with these values (KNOWN)."
    },
    "identities": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"]
      },
      "description": "Three-valued: omitted = not yet profiled (UNKNOWN); [] = profiled, no identities apply (KNOWN NONE); [...] = profiled with these values (KNOWN)."
    },
    "dataClasses": {
      "type": "array",
      "items": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] },
      "description": "Three-valued: omitted = not yet profiled (UNKNOWN); [] = profiled, no data classes apply (KNOWN NONE); [...] = profiled with these values (KNOWN)."
    },
```

And change:
```json
  "required": ["projectId", "securityLevel", "exposure", "components", "identities", "dataClasses", "features", "technologies"],
```
to:
```json
  "required": ["projectId", "securityLevel", "exposure", "features", "technologies"],
```

- [ ] **Step 4: Fix `project-schema.json`**

Apply the identical change to the embedded `profile.properties.components`/`.identities`/`.dataClasses` (same `description` text as above, and remove the same three keys from `profile.required`). Do not touch `profile.properties.exposure` — it stays required with its existing `minItems: 1`.

Before:
```json
        "components": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "identities": {
          "type": "array",
          "items": { "type": "string", "enum": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"] }
        },
        "dataClasses": { "type": "array", "items": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] } },
```
After:
```json
        "components": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "description": "Three-valued: omitted = not yet profiled (UNKNOWN); [] = profiled, no components apply (KNOWN NONE); [...] = profiled with these values (KNOWN)."
        },
        "identities": {
          "type": "array",
          "items": { "type": "string", "enum": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"] },
          "description": "Three-valued: omitted = not yet profiled (UNKNOWN); [] = profiled, no identities apply (KNOWN NONE); [...] = profiled with these values (KNOWN)."
        },
        "dataClasses": {
          "type": "array",
          "items": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] },
          "description": "Three-valued: omitted = not yet profiled (UNKNOWN); [] = profiled, no data classes apply (KNOWN NONE); [...] = profiled with these values (KNOWN)."
        },
```

And change:
```json
      "required": ["securityLevel", "exposure", "components", "identities", "dataClasses", "features", "technologies"],
```
to:
```json
      "required": ["securityLevel", "exposure", "features", "technologies"],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/schemas/project-profile-schema.test.ts tests/schemas/project-schema.test.ts`
Expected: PASS, all tests in both files (including every pre-existing test — removing fields from `required` only loosens the schema, so nothing that passed before should now fail).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass, including `tests/schema-drift.test.ts` from Task 3 (this task did not change either schema's `required` list in a way that affects the drift comparisons, since both `project-profile-schema.json` and `project-schema.json`'s embedded profile were changed identically).

- [ ] **Step 7: Commit**

```bash
git add data/schemas/project-profile-schema.json data/schemas/project-schema.json tests/schemas/project-profile-schema.test.ts tests/schemas/project-schema.test.ts
git commit -m "feat: make ProjectProfile array fields three-valued (omitted/empty/populated)"
```

---

## Task 6: AppSec Pilot Domain

**Context:** From this task onward, `tests/manifest.test.ts`'s "has a file set on disk matching the manifest for each category directory" assertion **will fail** for the `data/controls` category — this is expected (see Global Constraints) and is resolved only in Task 11. Do not attempt to fix it in this task, and do not modify `data/manifest.json` or `tests/manifest.test.ts`.

**Files:**
- Modify: `data/catalogs/threats.json` (add 5 new threat entries)
- Create: `data/controls/appsec.json`
- Test: `tests/controls/appsec.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`; `validateCatalog` from `src/validate-catalog.ts` (Task 2)
- Produces: 6 new Control records with `controlId`s `APP-XSS-001`, `APP-UPLOAD-001`, `APP-SSRF-001`, `APP-INJ-001`, `APP-ADMIN-001`, `APP-DESER-001` — `APP-ADMIN-001` is referenced by Task 6's own content only (`relatedTo: ["IAM-AUTHZ-003"]`, a forward reference resolved because `IAM-AUTHZ-003` already exists from Phase 1).

**Applicability patterns this domain exercises** (per spec §6's coverage table): `components`-based (`APP-XSS-001`, `APP-DESER-001`), `features.*`-based (`APP-UPLOAD-001`, `APP-SSRF-001`), `any` disjunction (`APP-INJ-001`), multi-threat (`APP-INJ-001`), `all` conjunction + `identities`-based (`APP-ADMIN-001`), multi-level assurance escalation (`APP-INJ-001`).

- [ ] **Step 1: Add 5 new threats to `data/catalogs/threats.json`**

Append these 5 objects to the existing `threats` array (after the last existing entry, `THR-INJ-001`):

```json
    { "threatId": "THR-APP-XSS", "title": "Cross-Site Scripting", "description": "An attacker injects script into a page viewed by other users because user-controlled content is rendered without proper output encoding.", "category": "appsec" },
    { "threatId": "THR-APP-UNRESTRICTED-UPLOAD", "title": "Unrestricted File Upload", "description": "An attacker uploads a file of an unexpected type or size that is later executed, served, or used to exhaust storage.", "category": "appsec" },
    { "threatId": "THR-APP-SSRF", "title": "Server-Side Request Forgery", "description": "An attacker causes the server to make an outbound request to an internal or unintended destination on the attacker's behalf.", "category": "appsec" },
    { "threatId": "THR-INJ-NOSQL", "title": "NoSQL Injection", "description": "External input changes the structure or semantics of a query executed against a non-relational data store.", "category": "injection" },
    { "threatId": "THR-APP-INSECURE-DESERIALIZATION", "title": "Insecure Deserialization", "description": "Untrusted serialized data is deserialized into objects without validation, allowing an attacker to influence application state or achieve code execution.", "category": "appsec" }
```

- [ ] **Step 2: Create `data/controls/appsec.json`**

```json
[
  {
    "controlId": "APP-XSS-001",
    "version": 1,
    "status": "active",
    "title": "Output Encoding for User-Controlled Content",
    "group": "appsec",
    "domain": "appsec",
    "subdomain": "output_encoding",
    "layer": "prevent",
    "requirement": "User-controlled content rendered in a browser context must be output-encoded for that context.",
    "rationale": "Rendering user-controlled content without context-appropriate encoding lets an attacker inject script that executes in another user's browser session.",
    "threatIds": ["THR-APP-XSS"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "browser_frontend" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["code_review"], "SVL-2": ["code_review"], "SVL-3": ["code_review"] },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review templates and rendering code and confirm user-controlled values pass through a context-aware encoder (HTML, attribute, URL, or JS, as appropriate) before rendering.",
          "requiredEvidenceTypes": ["CODE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["User-controlled content cannot execute as script when rendered in a browser context."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "frontend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["appsec", "xss"]
  },
  {
    "controlId": "APP-UPLOAD-001",
    "version": 1,
    "status": "active",
    "title": "Uploaded File Type and Size Restriction",
    "group": "appsec",
    "domain": "appsec",
    "subdomain": "file_upload",
    "layer": "prevent",
    "requirement": "File uploads must be restricted to an allow-list of file types and a maximum size, validated by content rather than by filename or client-supplied MIME type alone.",
    "rationale": "Accepting arbitrary file types or sizes lets an attacker upload an executable payload or exhaust storage capacity.",
    "threatIds": ["THR-APP-UNRESTRICTED-UPLOAD"],
    "applicability": {
      "when": { "all": [{ "fact": "features.fileUpload", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the upload handler configuration and confirm an allow-list of file types and a maximum size are enforced.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Attempt to upload a disallowed file type with a spoofed extension and MIME type, and a file exceeding the size limit, and confirm both are rejected.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": [
      "An upload outside the allowed file types is rejected regardless of its claimed extension or MIME type.",
      "An upload exceeding the configured size limit is rejected."
    ],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["appsec", "file_upload"]
  },
  {
    "controlId": "APP-SSRF-001",
    "version": 1,
    "status": "active",
    "title": "Outbound Webhook Request Allow-listing",
    "group": "appsec",
    "domain": "appsec",
    "subdomain": "outbound_requests",
    "layer": "prevent",
    "requirement": "Server-initiated outbound requests to a user-supplied URL (e.g. a webhook target) must be restricted to an allow-listed set of destinations and must not reach internal network ranges.",
    "rationale": "A server that fetches a user-supplied URL without restriction can be made to reach internal-only services or metadata endpoints on the attacker's behalf.",
    "threatIds": ["THR-APP-SSRF"],
    "applicability": {
      "when": { "all": [{ "fact": "features.webhook", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the outbound HTTP client configuration used for webhook delivery and confirm requests to private/internal IP ranges and the cloud metadata address are blocked.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Register a webhook target pointing at an internal address and the cloud metadata endpoint, and confirm the request is blocked before it leaves the server.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["A webhook or outbound-fetch target resolving to an internal address or the cloud metadata endpoint is rejected before the request is sent."],
    "evidenceRequirements": [{ "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend", "infrastructure"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["appsec", "ssrf"]
  },
  {
    "controlId": "APP-INJ-001",
    "version": 1,
    "status": "active",
    "title": "Parameterized Query Execution",
    "group": "appsec",
    "domain": "appsec",
    "subdomain": "query_construction",
    "layer": "prevent",
    "requirement": "Database queries must be constructed with parameterized statements or an equivalent safe query builder, never by concatenating untrusted input into a query string.",
    "rationale": "Concatenating untrusted input into a query string lets an attacker change the query's structure and read, modify, or destroy data outside their authorization.",
    "threatIds": ["THR-INJ-001", "THR-INJ-NOSQL"],
    "applicability": {
      "when": {
        "any": [
          { "fact": "technologies.databases", "operator": "contains", "value": "postgresql" },
          { "fact": "technologies.databases", "operator": "contains", "value": "mysql" },
          { "fact": "technologies.databases", "operator": "contains", "value": "mongodb" }
        ]
      }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["code_review"], "SVL-2": ["code_review", "dynamic_test"], "SVL-3": ["code_review", "dynamic_test", "adversarial_test"] },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review every database call site and confirm untrusted input is always passed as a bound parameter, never concatenated into the query string or command.",
          "requiredEvidenceTypes": ["CODE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Submit standard injection probe strings into every input that reaches a database query and confirm none alter query structure or return unauthorized data.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        },
        {
          "type": "adversarial_test",
          "procedure": "Attempt blind and time-based injection techniques against inputs that do not directly reflect query results, to catch injection paths automated scanning misses.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-3",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No injection probe changes query structure, returns unauthorized data, or produces a database error revealing query structure."],
    "evidenceRequirements": [
      { "type": "CODE", "required": true },
      { "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }
    ],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["appsec", "injection"]
  },
  {
    "controlId": "APP-ADMIN-001",
    "version": 1,
    "status": "active",
    "title": "Admin Interface Restricted to Privileged Identities",
    "group": "appsec",
    "domain": "appsec",
    "subdomain": "admin_interface",
    "layer": "prevent",
    "requirement": "An administrative interface must be reachable only by identities holding an administrator role, in addition to any other authorization checks.",
    "rationale": "An admin interface that is reachable by non-administrator identities, even if individual actions are separately checked, widens the attack surface an attacker can probe.",
    "threatIds": ["THR-IAM-PRIVILEGE-ESCALATION"],
    "applicability": {
      "when": {
        "all": [
          { "fact": "features.adminInterface", "operator": "eq", "value": true },
          { "fact": "identities", "operator": "contains", "value": "administrator" }
        ]
      }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the routing or gateway configuration for the admin interface and confirm every route under it requires an administrator role, independent of individual endpoint logic.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Every route under the administrative interface rejects a non-administrator identity before reaching endpoint logic."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["application", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["IAM-AUTHZ-003"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["appsec", "admin"]
  },
  {
    "controlId": "APP-DESER-001",
    "version": 1,
    "status": "active",
    "title": "Safe Deserialization of Untrusted Input",
    "group": "appsec",
    "domain": "appsec",
    "subdomain": "deserialization",
    "layer": "prevent",
    "requirement": "Untrusted input must not be deserialized using a format or library capable of instantiating arbitrary types or invoking code during deserialization.",
    "rationale": "A deserializer that can instantiate arbitrary types from untrusted input gives an attacker a path to remote code execution without needing a separate memory-corruption bug.",
    "threatIds": ["THR-APP-INSECURE-DESERIALIZATION"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "backend_api" }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["code_review"], "SVL-2": ["code_review"], "SVL-3": ["code_review"] },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review every place untrusted input is deserialized and confirm a safe, schema-constrained format is used, or that a general-purpose deserializer is configured to reject arbitrary type instantiation.",
          "requiredEvidenceTypes": ["CODE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Deserializing untrusted input cannot instantiate a type outside an explicit allow-list."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["appsec", "deserialization"]
  }
]
```

- [ ] **Step 3: Create `tests/controls/appsec.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/appsec.json", () => {
  it("has exactly 6 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/appsec.json");
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the appsec domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/appsec.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["appsec"]));
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/appsec.json");
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/controls/appsec.test.ts`
Expected: PASS, all 3 tests.

Run: `npx vitest run tests/semantic-validate.test.ts`
Expected: the "returns no violations for the real data/ tree" test still PASSES (confirming the new controls and threats introduce no referential-integrity gaps).

- [ ] **Step 5: Commit**

```bash
git add data/catalogs/threats.json data/controls/appsec.json tests/controls/appsec.test.ts
git commit -m "feat: add AppSec pilot control domain (6 controls, 5 new threats)"
```

---

## Task 7: Infrastructure Pilot Domain

**Context:** Same manifest-staleness note as Task 6 applies — do not modify `data/manifest.json` or `tests/manifest.test.ts`.

**Files:**
- Modify: `data/catalogs/threats.json` (add 5 new threat entries)
- Create: `data/controls/infrastructure.json`
- Test: `tests/controls/infrastructure.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`; `validateCatalog` from `src/validate-catalog.ts`
- Produces: 6 new Control records: `INFRA-EXPOSURE-001`, `INFRA-LEASTPRIV-001`, `INFRA-PATCH-001`, `INFRA-PATCH-002`, `INFRA-NETSEG-001`, `INFRA-BACKUP-001`. `INFRA-PATCH-002` depends on `INFRA-PATCH-001` (same file). `INFRA-BACKUP-001` is referenced by Task 8's `OPS-BACKUP-TEST-001` — this task must land before or alongside Task 8's own control validity (both add controls to `data/controls/`, and `validateCatalog` scans the whole directory, so the ordering between Tasks 7 and 8 does not itself matter, but `OPS-BACKUP-TEST-001` in Task 8 will only pass its own `relationships-exist` check once this task's `INFRA-BACKUP-001` exists on disk).

**Applicability patterns this domain exercises:** `exposure`-based (`INFRA-EXPOSURE-001`), `components`-based reinforcement, `relationships.dependsOn` (`INFRA-PATCH-002` → `INFRA-PATCH-001`), `securityLevel` (SVL)-based (`INFRA-NETSEG-001`), multi-level assurance escalation (`INFRA-EXPOSURE-001`).

- [ ] **Step 1: Add 5 new threats to `data/catalogs/threats.json`**

Append (after Task 6's `THR-APP-INSECURE-DESERIALIZATION` entry, if Task 6 already ran; otherwise after the last existing entry):

```json
    { "threatId": "THR-INFRA-EXCESS-EXPOSURE", "title": "Excess Network Exposure", "description": "A service or management interface is reachable from the public internet when it does not need to be, widening the attack surface.", "category": "infrastructure" },
    { "threatId": "THR-INFRA-OVERPRIVILEGED-IAM", "title": "Overprivileged Cloud IAM Role", "description": "A workload or user identity holds broader cloud permissions than its function requires, increasing the impact of any single compromise.", "category": "infrastructure" },
    { "threatId": "THR-INFRA-UNPATCHED-DEPENDENCY", "title": "Unpatched Known-Vulnerable Dependency", "description": "A component runs a version with a publicly known vulnerability because it was not updated within a reasonable window.", "category": "infrastructure" },
    { "threatId": "THR-INFRA-LATERAL-MOVEMENT", "title": "Lateral Movement via Flat Network", "description": "An attacker who compromises one host uses an unsegmented network to reach other hosts, including data stores, directly.", "category": "infrastructure" },
    { "threatId": "THR-INFRA-BACKUP-LOSS", "title": "Unrecoverable Data Loss", "description": "Backups do not exist, are not encrypted, or cannot be restored, so a destructive incident causes permanent data loss.", "category": "infrastructure" }
```

- [ ] **Step 2: Create `data/controls/infrastructure.json`**

```json
[
  {
    "controlId": "INFRA-EXPOSURE-001",
    "version": 1,
    "status": "active",
    "title": "Internet-Facing Service Hardening Baseline",
    "group": "infrastructure",
    "domain": "infrastructure",
    "subdomain": "network_exposure",
    "layer": "prevent",
    "requirement": "Any service reachable from the public internet must expose only the ports and endpoints required for its function, with all other management or debug interfaces bound to a private network.",
    "rationale": "A service that exposes management or debug interfaces to the public internet gives an attacker a direct path to functionality never meant to be reachable externally.",
    "threatIds": ["THR-INFRA-EXCESS-EXPOSURE"],
    "applicability": {
      "when": { "all": [{ "fact": "exposure", "operator": "contains", "value": "internet_public" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "scan"], "SVL-3": ["config_review", "scan", "adversarial_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the security group, firewall, or ingress configuration and confirm only required ports are reachable from the public internet.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "scan",
          "procedure": "Run an external port scan against the service's public address and confirm only the expected ports respond.",
          "requiredEvidenceTypes": ["SCAN"],
          "minimumSvl": "SVL-2",
          "automatable": true
        },
        {
          "type": "adversarial_test",
          "procedure": "Attempt to reach management or debug endpoints (e.g. metrics, admin consoles, orchestration APIs) directly from the public internet.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-3",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No management, debug, or internal-only endpoint is reachable from the public internet."],
    "evidenceRequirements": [
      { "type": "CONFIG", "required": true },
      { "type": "SCAN", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }
    ],
    "ownerRoles": ["infrastructure", "devops"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["infrastructure", "network"]
  },
  {
    "controlId": "INFRA-LEASTPRIV-001",
    "version": 1,
    "status": "active",
    "title": "Least-Privilege Cloud IAM Roles",
    "group": "infrastructure",
    "domain": "infrastructure",
    "subdomain": "cloud_iam",
    "layer": "prevent",
    "requirement": "A workload's cloud IAM role must grant only the permissions that workload requires, not broad or wildcard permissions.",
    "rationale": "A workload holding broad cloud permissions turns any single compromise of that workload into a compromise of everything its role can reach.",
    "threatIds": ["THR-INFRA-OVERPRIVILEGED-IAM"],
    "applicability": {
      "when": { "all": [{ "fact": "technologies.cloud", "operator": "intersects", "value": ["aws", "gcp", "azure"] }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Review each workload's IAM policy and confirm it lists specific actions and resources rather than wildcard actions or resources.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No workload IAM role grants a wildcard action or resource it does not require."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["infrastructure", "devops"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["infrastructure", "iam"]
  },
  {
    "controlId": "INFRA-PATCH-001",
    "version": 1,
    "status": "active",
    "title": "Dependency and OS Patch Currency",
    "group": "infrastructure",
    "domain": "infrastructure",
    "subdomain": "patch_management",
    "layer": "prevent",
    "requirement": "Operating system packages and application dependencies must be tracked for known vulnerabilities and updated within a defined window of a fix becoming available.",
    "rationale": "A component with a publicly known vulnerability is a target attackers can identify and exploit without any custom research.",
    "threatIds": ["THR-INFRA-UNPATCHED-DEPENDENCY"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "intersects", "value": ["backend_api", "database", "file_storage"] }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "scan"], "SVL-3": ["config_review", "scan"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm a dependency and OS package scanning tool runs on a defined schedule and its findings are tracked to remediation.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "scan",
          "procedure": "Run a dependency and OS package vulnerability scan and confirm no known-vulnerable component is past its remediation window.",
          "requiredEvidenceTypes": ["SCAN"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["No dependency or OS package with a known vulnerability is past the defined remediation window."],
    "evidenceRequirements": [{ "type": "SCAN", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["infrastructure", "devops"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["infrastructure", "patching"]
  },
  {
    "controlId": "INFRA-PATCH-002",
    "version": 1,
    "status": "active",
    "title": "Emergency Patch SLA for Critical Vulnerabilities",
    "group": "infrastructure",
    "domain": "infrastructure",
    "subdomain": "patch_management",
    "layer": "contain_recover",
    "requirement": "A dependency or OS vulnerability rated critical must be remediated faster than the standard patch window defined by INFRA-PATCH-001.",
    "rationale": "A critical vulnerability under active exploitation elsewhere does not wait for a routine patch cycle; the response time must scale with severity.",
    "threatIds": ["THR-INFRA-UNPATCHED-DEPENDENCY"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "intersects", "value": ["backend_api", "database", "file_storage"] }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm a documented emergency patch SLA exists for critical-severity findings and review the most recent critical finding against it.",
          "requiredEvidenceTypes": ["TICKET", "REPORT"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A critical-severity dependency or OS vulnerability is remediated within the emergency SLA, shorter than the standard patch window."],
    "evidenceRequirements": [{ "type": "TICKET", "required": true }],
    "ownerRoles": ["infrastructure", "devops", "security"],
    "references": [],
    "relationships": { "dependsOn": ["INFRA-PATCH-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["infrastructure", "patching", "incident_response"]
  },
  {
    "controlId": "INFRA-NETSEG-001",
    "version": 1,
    "status": "active",
    "title": "Database Network Segmentation",
    "group": "infrastructure",
    "domain": "infrastructure",
    "subdomain": "network_segmentation",
    "layer": "prevent",
    "requirement": "At SVL-3, a database must be reachable only from the specific application hosts that require it, not from the broader internal network.",
    "rationale": "At higher assurance levels, a flat internal network is treated as already compromised in part; segmentation limits how far an attacker who reaches one host can move.",
    "threatIds": ["THR-INFRA-LATERAL-MOVEMENT"],
    "applicability": {
      "when": { "all": [{ "fact": "securityLevel", "operator": "eq", "value": "SVL-3" }, { "fact": "components", "operator": "contains", "value": "database" }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect network ACLs or security groups for the database and confirm only the application hosts that require access are permitted, not the full internal network range.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-3",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["The database is unreachable from any internal host other than the application hosts that require it."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["infrastructure"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["infrastructure", "network", "segmentation"]
  },
  {
    "controlId": "INFRA-BACKUP-001",
    "version": 1,
    "status": "active",
    "title": "Encrypted, Scheduled Backups",
    "group": "infrastructure",
    "domain": "infrastructure",
    "subdomain": "backup",
    "layer": "contain_recover",
    "requirement": "A database must be backed up on a defined schedule, and backups must be encrypted at rest.",
    "rationale": "Without a scheduled, encrypted backup, a destructive incident (ransomware, accidental deletion, storage failure) can cause permanent data loss.",
    "threatIds": ["THR-INFRA-BACKUP-LOSS"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "database" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the backup schedule and storage configuration and confirm backups run on the defined interval and are encrypted at rest.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A backup completed within the defined schedule interval exists and is encrypted at rest."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["infrastructure", "devops"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["infrastructure", "backup"]
  }
]
```

- [ ] **Step 3: Create `tests/controls/infrastructure.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/infrastructure.json", () => {
  it("has exactly 6 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/infrastructure.json");
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the infrastructure domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/infrastructure.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["infrastructure"]));
  });

  it("INFRA-PATCH-002 depends on INFRA-PATCH-001", () => {
    const controls = loadJson<{ controlId: string; relationships?: { dependsOn?: string[] } }[]>(
      "data/controls/infrastructure.json"
    );
    const patch002 = controls.find((c) => c.controlId === "INFRA-PATCH-002");
    expect(patch002?.relationships?.dependsOn).toEqual(["INFRA-PATCH-001"]);
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/infrastructure.json");
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/controls/infrastructure.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add data/catalogs/threats.json data/controls/infrastructure.json tests/controls/infrastructure.test.ts
git commit -m "feat: add Infrastructure pilot control domain (6 controls, 5 new threats)"
```

---

## Task 8: Operations Pilot Domain

**Context:** Same manifest-staleness note as Task 6 applies.

**Files:**
- Modify: `data/catalogs/threats.json` (add 4 new threat entries)
- Create: `data/controls/operations.json`
- Test: `tests/controls/operations.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`; `validateCatalog` from `src/validate-catalog.ts`
- Produces: 5 new Control records: `OPS-LOG-001`, `OPS-LOG-002`, `OPS-IR-001`, `OPS-BACKUP-TEST-001`, `OPS-ADMIN-ACCESS-LOG-001`. `OPS-LOG-002` depends on `OPS-LOG-001` (same file). `OPS-BACKUP-TEST-001` depends on `INFRA-BACKUP-001` (Task 7) — **Task 7 must be completed before this task's tests will pass**, since `validateCatalog`'s `relationships-exist` rule needs `INFRA-BACKUP-001` to already exist on disk.

**Applicability patterns this domain exercises:** `relationships.dependsOn` reinforcement (`OPS-LOG-002`, cross-domain `OPS-BACKUP-TEST-001`), `securityLevel` (SVL)-based reinforcement via the `in` operator (`OPS-IR-001`), `identities`-based reinforcement via the `intersects` operator (`OPS-ADMIN-ACCESS-LOG-001`).

- [ ] **Step 1: Add 4 new threats to `data/catalogs/threats.json`**

Append:

```json
    { "threatId": "THR-OPS-INSUFFICIENT-LOGGING", "title": "Insufficient Security Logging", "description": "A security-relevant event occurs without producing a log record, preventing detection or investigation after the fact.", "category": "operations" },
    { "threatId": "THR-OPS-LOG-TAMPERING", "title": "Log Tampering or Deletion", "description": "An attacker with access to a compromised host modifies or deletes local logs to cover their tracks.", "category": "operations" },
    { "threatId": "THR-OPS-UNVERIFIED-IR-PLAN", "title": "Untested Incident Response Plan", "description": "An incident response runbook exists on paper but has never been exercised, so it fails or is too slow when a real incident occurs.", "category": "operations" },
    { "threatId": "THR-OPS-UNAUDITED-PRIVILEGED-ACTION", "title": "Unaudited Privileged Action", "description": "A privileged identity performs a sensitive action with no record of who did it or when, preventing accountability and forensic review.", "category": "operations" }
```

- [ ] **Step 2: Create `data/controls/operations.json`**

```json
[
  {
    "controlId": "OPS-LOG-001",
    "version": 1,
    "status": "active",
    "title": "Security-Relevant Event Logging",
    "group": "operations",
    "domain": "operations",
    "subdomain": "logging",
    "layer": "detect",
    "requirement": "Authentication, authorization failures, and privileged actions must produce a log record including actor, action, target, and timestamp.",
    "rationale": "Without a record of who did what and when, detecting and investigating a security incident after the fact is not possible.",
    "threatIds": ["THR-OPS-INSUFFICIENT-LOGGING"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "backend_api" }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the logging configuration and confirm authentication events, authorization failures, and privileged actions are configured to produce log records.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Trigger a login, a login failure, an authorization failure, and a privileged action, and confirm each produces a log record with actor, action, target, and timestamp.",
          "requiredEvidenceTypes": ["LOG"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["Each of a login, a login failure, an authorization failure, and a privileged action produces a log record identifying actor, action, target, and timestamp."],
    "evidenceRequirements": [{ "type": "LOG", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "backend", "operations"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["operations", "logging"]
  },
  {
    "controlId": "OPS-LOG-002",
    "version": 1,
    "status": "active",
    "title": "Centralized, Tamper-resistant Log Retention",
    "group": "operations",
    "domain": "operations",
    "subdomain": "logging",
    "layer": "detect",
    "requirement": "Security-relevant logs produced by OPS-LOG-001 must be shipped to a centralized store the originating host cannot modify or delete, and retained for a defined minimum period.",
    "rationale": "A log that only exists on the host that produced it can be altered or deleted by an attacker who compromises that host, defeating its purpose.",
    "threatIds": ["THR-OPS-LOG-TAMPERING"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "backend_api" }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm logs are shipped to a centralized store that the originating host has no delete or modify permission on, and confirm the configured retention period.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A host that produces a security-relevant log cannot modify or delete that log once it reaches the centralized store."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["operations", "infrastructure"],
    "references": [],
    "relationships": { "dependsOn": ["OPS-LOG-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["operations", "logging"]
  },
  {
    "controlId": "OPS-IR-001",
    "version": 1,
    "status": "active",
    "title": "Incident Response Runbook Verification",
    "group": "operations",
    "domain": "operations",
    "subdomain": "incident_response",
    "layer": "contain_recover",
    "requirement": "At SVL-2 and above, a documented incident response runbook must exist and have been exercised through at least a tabletop exercise within the last 12 months.",
    "rationale": "An incident response plan that has never been exercised routinely fails on first real use, in ways a tabletop exercise would have surfaced cheaply.",
    "threatIds": ["THR-OPS-UNVERIFIED-IR-PLAN"],
    "applicability": {
      "when": { "all": [{ "fact": "securityLevel", "operator": "in", "value": ["SVL-2", "SVL-3"] }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-2": ["manual_review"], "SVL-3": ["manual_review"] },
    "verification": {
      "methods": [
        {
          "type": "manual_review",
          "procedure": "Review the incident response runbook and confirm a tabletop or live exercise record exists dated within the last 12 months.",
          "requiredEvidenceTypes": ["MANUAL_REVIEW", "REPORT"],
          "minimumSvl": "SVL-2",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A documented incident response runbook exists and its most recent exercise record is dated within the last 12 months."],
    "evidenceRequirements": [{ "type": "REPORT", "required": true }],
    "ownerRoles": ["security", "operations"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["operations", "incident_response"]
  },
  {
    "controlId": "OPS-BACKUP-TEST-001",
    "version": 1,
    "status": "active",
    "title": "Backup Restore Drill",
    "group": "operations",
    "domain": "operations",
    "subdomain": "backup",
    "layer": "contain_recover",
    "requirement": "A restore from the backups required by INFRA-BACKUP-001 must be successfully performed and verified on a defined schedule.",
    "rationale": "A backup that has never been restored is only a hypothesis; corruption, misconfiguration, or an incomplete backup is only discovered by actually restoring it.",
    "threatIds": ["THR-INFRA-BACKUP-LOSS"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "database" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["manual_review"], "SVL-2": ["manual_review"], "SVL-3": ["manual_review"] },
    "verification": {
      "methods": [
        {
          "type": "manual_review",
          "procedure": "Review the most recent backup restore drill record and confirm the restored data was verified against the source and the drill occurred within the defined schedule.",
          "requiredEvidenceTypes": ["REPORT"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A backup restore drill completed within the defined schedule, with the restored data verified against the source."],
    "evidenceRequirements": [{ "type": "REPORT", "required": true }],
    "ownerRoles": ["operations", "infrastructure"],
    "references": [],
    "relationships": { "dependsOn": ["INFRA-BACKUP-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["operations", "backup"]
  },
  {
    "controlId": "OPS-ADMIN-ACCESS-LOG-001",
    "version": 1,
    "status": "active",
    "title": "Privileged Action Audit Trail",
    "group": "operations",
    "domain": "operations",
    "subdomain": "audit_trail",
    "layer": "detect",
    "requirement": "Every action performed by an administrator or operator identity against another user's data or account must be recorded in an audit trail reviewable by security.",
    "rationale": "Privileged identities are a common target and a common insider-risk vector; without an audit trail, misuse of privileged access is invisible until its consequences surface elsewhere.",
    "threatIds": ["THR-OPS-UNAUDITED-PRIVILEGED-ACTION"],
    "applicability": {
      "when": { "all": [{ "fact": "identities", "operator": "intersects", "value": ["administrator", "operator"] }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the audit logging configuration and confirm administrator and operator actions against another user's data or account are captured.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Perform an administrative action against a test user's account and confirm an audit trail entry identifying the actor, action, and target is created.",
          "requiredEvidenceTypes": ["AUDIT_LOG"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["An administrator or operator action against another user's data or account produces a reviewable audit trail entry."],
    "evidenceRequirements": [{ "type": "AUDIT_LOG", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["security", "operations"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["operations", "audit"]
  }
]
```

- [ ] **Step 3: Create `tests/controls/operations.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/operations.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/operations.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the operations domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/operations.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["operations"]));
  });

  it("OPS-BACKUP-TEST-001 depends on INFRA-BACKUP-001 (cross-domain reference)", () => {
    const controls = loadJson<{ controlId: string; relationships?: { dependsOn?: string[] } }[]>(
      "data/controls/operations.json"
    );
    const drill = controls.find((c) => c.controlId === "OPS-BACKUP-TEST-001");
    expect(drill?.relationships?.dependsOn).toEqual(["INFRA-BACKUP-001"]);
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/operations.json");
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/controls/operations.test.ts`
Expected: PASS, all 4 tests. If "produces no semantic-validator violations" or the cross-domain dependency check fails with an unknown-relationship-target violation, confirm Task 7 (which creates `INFRA-BACKUP-001`) has already landed.

- [ ] **Step 5: Commit**

```bash
git add data/catalogs/threats.json data/controls/operations.json tests/controls/operations.test.ts
git commit -m "feat: add Operations pilot control domain (5 controls, 4 new threats)"
```

---

## Task 9: Platform-specific Pilot Domain

**Context:** Same manifest-staleness note as Task 6 applies.

**Files:**
- Modify: `data/catalogs/threats.json` (add 5 new threat entries)
- Create: `data/controls/platform-specific.json`
- Test: `tests/controls/platform-specific.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`; `validateCatalog` from `src/validate-catalog.ts`
- Produces: 5 new Control records: `PLAT-AI-001`, `PLAT-AI-002`, `PLAT-AI-003`, `PLAT-MOBILE-001`, `PLAT-MOBILE-002`. No dependency on any other task's output.

**Applicability patterns this domain exercises:** `features.*`-based reinforcement (`PLAT-AI-001`), `all` conjunction reinforcement with different fact combinations (`PLAT-AI-002`: features+components; `PLAT-AI-003`: features+dataClasses; `PLAT-MOBILE-002`: components+dataClasses), `dataClasses`-based reinforcement (`PLAT-AI-003`, `PLAT-MOBILE-002`), `components`-based reinforcement (`PLAT-MOBILE-001`), multi-level assurance escalation (`PLAT-AI-001`).

- [ ] **Step 1: Add 5 new threats to `data/catalogs/threats.json`**

Append:

```json
    { "threatId": "THR-AI-PROMPT-INJECTION", "title": "Prompt Injection", "description": "Untrusted content included in an LLM prompt overrides or manipulates the model's intended instructions.", "category": "platform_ai" },
    { "threatId": "THR-AI-INSECURE-OUTPUT-HANDLING", "title": "Insecure LLM Output Handling", "description": "LLM-generated output is executed, rendered, or used as a command without treating it as untrusted input.", "category": "platform_ai" },
    { "threatId": "THR-AI-SENSITIVE-DATA-LEAKAGE", "title": "Sensitive Data Leakage via LLM Context", "description": "Restricted data included in an LLM prompt or context is retained, logged, or surfaced by the model provider or in model output.", "category": "platform_ai" },
    { "threatId": "THR-MOBILE-MITM", "title": "Mobile Man-in-the-Middle via Certificate Spoofing", "description": "An attacker on the network path presents a spoofed or attacker-controlled certificate to a mobile app that does not verify the server's identity beyond standard CA trust.", "category": "platform_mobile" },
    { "threatId": "THR-MOBILE-INSECURE-STORAGE", "title": "Insecure Local Data Storage", "description": "Sensitive data stored on a mobile device is left unencrypted or accessible to other apps or a device backup.", "category": "platform_mobile" }
```

- [ ] **Step 2: Create `data/controls/platform-specific.json`**

```json
[
  {
    "controlId": "PLAT-AI-001",
    "version": 1,
    "status": "active",
    "title": "LLM Prompt Injection Mitigation",
    "group": "platform_specific",
    "domain": "platform_specific",
    "subdomain": "llm_input_handling",
    "layer": "prevent",
    "requirement": "User- or tool-sourced content included in an LLM prompt must be treated as untrusted and must not be able to override system-level instructions.",
    "rationale": "An LLM that treats all prompt content as equally authoritative lets untrusted content redirect the model into ignoring its intended constraints.",
    "threatIds": ["THR-AI-PROMPT-INJECTION"],
    "applicability": {
      "when": { "all": [{ "fact": "features.ai", "operator": "eq", "value": true }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["code_review"], "SVL-2": ["code_review", "dynamic_test"], "SVL-3": ["code_review", "dynamic_test", "adversarial_test"] },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review prompt construction and confirm untrusted content is structurally separated from system instructions (e.g. via role separation or delimiting) rather than concatenated into one instruction block.",
          "requiredEvidenceTypes": ["CODE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Submit standard prompt-injection probe strings as user input and confirm the model's behavior does not deviate from its system-level constraints.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        },
        {
          "type": "adversarial_test",
          "procedure": "Attempt indirect prompt injection via content the model retrieves or is given as a tool result, rather than direct user input.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-3",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No tested prompt injection probe, direct or indirect, causes the model to deviate from its system-level constraints."],
    "evidenceRequirements": [
      { "type": "CODE", "required": true },
      { "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }
    ],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["platform_specific", "ai", "llm"]
  },
  {
    "controlId": "PLAT-AI-002",
    "version": 1,
    "status": "active",
    "title": "LLM Output Sanitization Before Execution",
    "group": "platform_specific",
    "domain": "platform_specific",
    "subdomain": "llm_output_handling",
    "layer": "prevent",
    "requirement": "LLM-generated output must not be executed as code, used as a shell or database command, or rendered without sanitization, when a backend service acts on that output.",
    "rationale": "Treating model output as inherently safe lets a successful prompt injection turn into code execution, command injection, or XSS wherever that output is consumed.",
    "threatIds": ["THR-AI-INSECURE-OUTPUT-HANDLING"],
    "applicability": {
      "when": {
        "all": [
          { "fact": "features.ai", "operator": "eq", "value": true },
          { "fact": "components", "operator": "contains", "value": "backend_api" }
        ]
      }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["code_review"], "SVL-2": ["code_review"], "SVL-3": ["code_review"] },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review every place LLM output is consumed by the backend and confirm it is sanitized or validated the same way any other untrusted input would be, before execution, command construction, or rendering.",
          "requiredEvidenceTypes": ["CODE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["LLM output cannot be executed as code or a system command, and is sanitized before rendering, without passing the same validation as any other untrusted input."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "backend"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["PLAT-AI-001"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["platform_specific", "ai", "llm"]
  },
  {
    "controlId": "PLAT-AI-003",
    "version": 1,
    "status": "active",
    "title": "Sensitive Data Exclusion from LLM Context",
    "group": "platform_specific",
    "domain": "platform_specific",
    "subdomain": "llm_context_data",
    "layer": "prevent",
    "requirement": "Restricted-classification data must not be included in a prompt or context sent to an LLM unless the model provider contractually guarantees it is not retained or used for training.",
    "rationale": "Data sent to an LLM may be logged, retained, or used to improve the model by the provider, which is a disclosure the data's classification may not permit.",
    "threatIds": ["THR-AI-SENSITIVE-DATA-LEAKAGE"],
    "applicability": {
      "when": {
        "all": [
          { "fact": "features.ai", "operator": "eq", "value": true },
          { "fact": "dataClasses", "operator": "contains", "value": "D3" }
        ]
      }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Review the data classification of every field included in prompts or context sent to the LLM provider, and confirm the provider's data retention terms for any restricted-classification field included.",
          "requiredEvidenceTypes": ["CONFIG", "REPORT"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No restricted-classification field reaches an LLM prompt or context unless the provider's terms confirm it is not retained or used for training."],
    "evidenceRequirements": [{ "type": "REPORT", "required": true }],
    "ownerRoles": ["privacy", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["PLAT-AI-001"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["platform_specific", "ai", "data_classification"]
  },
  {
    "controlId": "PLAT-MOBILE-001",
    "version": 1,
    "status": "active",
    "title": "Mobile Certificate Pinning",
    "group": "platform_specific",
    "domain": "platform_specific",
    "subdomain": "mobile_transport",
    "layer": "prevent",
    "requirement": "A mobile application must pin the certificate or public key of its backend API rather than trusting any certificate issued by a publicly trusted CA.",
    "rationale": "Without pinning, an attacker positioned on the network path can intercept traffic using any certificate the device's trust store accepts, including one from a compromised or coerced CA.",
    "threatIds": ["THR-MOBILE-MITM"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "mobile_app" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the mobile app's network layer configuration and confirm certificate or public-key pinning is configured for the backend API host.",
          "requiredEvidenceTypes": ["CODE", "CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Intercept the app's traffic with a proxy presenting a certificate trusted by the device but not matching the pinned value, and confirm the connection is rejected.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A connection presenting a certificate that does not match the pinned value is rejected by the app."],
    "evidenceRequirements": [{ "type": "MANUAL_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["application", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["platform_specific", "mobile"]
  },
  {
    "controlId": "PLAT-MOBILE-002",
    "version": 1,
    "status": "active",
    "title": "Mobile Local Storage Encryption",
    "group": "platform_specific",
    "domain": "platform_specific",
    "subdomain": "mobile_storage",
    "layer": "prevent",
    "requirement": "Confidential or restricted data cached or stored locally on a mobile device must be encrypted using the platform's secure storage mechanism, not a plain file or unencrypted database.",
    "rationale": "A lost, stolen, or backed-up device can expose locally stored data directly, without needing to compromise the backend at all.",
    "threatIds": ["THR-MOBILE-INSECURE-STORAGE"],
    "applicability": {
      "when": {
        "all": [
          { "fact": "components", "operator": "contains", "value": "mobile_app" },
          { "fact": "dataClasses", "operator": "intersects", "value": ["D2", "D3"] }
        ]
      }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["code_review"], "SVL-2": ["code_review"], "SVL-3": ["code_review"] },
    "verification": {
      "methods": [
        {
          "type": "code_review",
          "procedure": "Review local storage and caching code paths that handle confidential or restricted data and confirm they use the platform's secure storage API rather than a plain file or unencrypted database.",
          "requiredEvidenceTypes": ["CODE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No confidential or restricted data is stored on-device outside the platform's secure storage mechanism."],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["application", "privacy"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["platform_specific", "mobile", "data_classification"]
  }
]
```

- [ ] **Step 3: Create `tests/controls/platform-specific.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/platform-specific.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/platform-specific.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the platform_specific domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/platform-specific.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["platform_specific"]));
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/platform-specific.json");
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/controls/platform-specific.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add data/catalogs/threats.json data/controls/platform-specific.json tests/controls/platform-specific.test.ts
git commit -m "feat: add Platform-specific pilot control domain (5 controls, 5 new threats)"
```

---

## Task 10: Data/Crypto Pilot Domain

**Context:** Same manifest-staleness note as Task 6 applies. This is the **last** pilot-content task — after this task, all 27 pilot controls and 24 new threats exist on disk, and `data/manifest.json` is still stale until Task 11.

**Files:**
- Modify: `data/catalogs/threats.json` (add 5 new threat entries)
- Create: `data/controls/data-crypto.json`
- Test: `tests/controls/data-crypto.test.ts`

**Interfaces:**
- Consumes: `compileSchemaFromFile`, `loadJson` from `src/validate.ts`; `validateCatalog` from `src/validate-catalog.ts`
- Produces: 5 new Control records: `DATA-ENC-001`, `DATA-ENC-002`, `DATA-KEYSEP-001`, `DATA-RETENTION-001`, `DATA-MASK-001`. `DATA-KEYSEP-001` depends on `DATA-ENC-001` (same file).

**Applicability patterns this domain exercises:** `dataClasses`-based (`DATA-ENC-001`, primary showcase; `DATA-RETENTION-001` via `intersects`), `exposure`-based reinforcement (`DATA-ENC-002`), `relationships.dependsOn` reinforcement (`DATA-KEYSEP-001`), `all` conjunction reinforcement (`DATA-MASK-001`: dataClasses+components).

- [ ] **Step 1: Add 5 new threats to `data/catalogs/threats.json`**

Append:

```json
    { "threatId": "THR-DATA-UNENCRYPTED-AT-REST", "title": "Unencrypted Data at Rest", "description": "Restricted data is stored without encryption, so access to the underlying storage medium or a backup directly exposes it.", "category": "data_crypto" },
    { "threatId": "THR-DATA-UNENCRYPTED-IN-TRANSIT", "title": "Unencrypted Data in Transit", "description": "Data is transmitted over a network without transport encryption, allowing an on-path attacker to read or modify it.", "category": "data_crypto" },
    { "threatId": "THR-DATA-KEY-COLOCATION", "title": "Encryption Key Co-located with Encrypted Data", "description": "An encryption key is stored alongside or accessible through the same access path as the data it protects, so compromising the data store also yields the key.", "category": "data_crypto" },
    { "threatId": "THR-DATA-EXCESSIVE-RETENTION", "title": "Excessive Data Retention", "description": "Data is retained beyond the period needed for its purpose, increasing the amount of sensitive data exposed by any future breach.", "category": "data_crypto" },
    { "threatId": "THR-DATA-NONPROD-EXPOSURE", "title": "Sensitive Data Exposure in Non-Production Environments", "description": "Production data containing restricted values is copied into a lower-security development or test environment without masking.", "category": "data_crypto" }
```

- [ ] **Step 2: Create `data/controls/data-crypto.json`**

```json
[
  {
    "controlId": "DATA-ENC-001",
    "version": 1,
    "status": "active",
    "title": "Encryption at Rest for Restricted Data",
    "group": "data_crypto",
    "domain": "data_crypto",
    "subdomain": "encryption_at_rest",
    "layer": "prevent",
    "requirement": "Data classified D3 must be encrypted at rest using a strong, current algorithm.",
    "rationale": "Restricted data stored in plaintext is directly exposed by any compromise of the underlying storage, backup, or physical medium.",
    "threatIds": ["THR-DATA-UNENCRYPTED-AT-REST"],
    "applicability": {
      "when": { "all": [{ "fact": "dataClasses", "operator": "contains", "value": "D3" }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect storage configuration for every field or store holding D3 data and confirm encryption at rest is enabled using a current, strong algorithm.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Every store holding D3 data is encrypted at rest with a current, strong algorithm."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["infrastructure", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["data_crypto", "encryption"]
  },
  {
    "controlId": "DATA-ENC-002",
    "version": 1,
    "status": "active",
    "title": "Encryption in Transit for Internet-Facing Traffic",
    "group": "data_crypto",
    "domain": "data_crypto",
    "subdomain": "encryption_in_transit",
    "layer": "prevent",
    "requirement": "All traffic to and from an internet-facing service must use transport encryption (TLS), with plaintext connections rejected or redirected.",
    "rationale": "Traffic sent over the public internet without transport encryption can be read or modified by any on-path attacker.",
    "threatIds": ["THR-DATA-UNENCRYPTED-IN-TRANSIT"],
    "applicability": {
      "when": { "all": [{ "fact": "exposure", "operator": "contains", "value": "internet_public" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "scan"], "SVL-3": ["config_review", "scan"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the load balancer or edge configuration and confirm plaintext HTTP connections are redirected or rejected, and a current TLS version is enforced.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "scan",
          "procedure": "Run a TLS configuration scan against the public endpoint and confirm no deprecated protocol version or weak cipher suite is accepted.",
          "requiredEvidenceTypes": ["SCAN"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["A plaintext connection attempt is rejected or redirected, and the TLS scan reports no deprecated protocol version or weak cipher suite."],
    "evidenceRequirements": [{ "type": "SCAN", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["infrastructure", "devops"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["data_crypto", "encryption", "tls"]
  },
  {
    "controlId": "DATA-KEYSEP-001",
    "version": 1,
    "status": "active",
    "title": "Encryption Key Separation from Encrypted Data",
    "group": "data_crypto",
    "domain": "data_crypto",
    "subdomain": "key_management",
    "layer": "prevent",
    "requirement": "The key used to encrypt data required by DATA-ENC-001 must be managed by a separate service (e.g. a dedicated key management service or HSM), not stored in the same database or file store as the data it protects.",
    "rationale": "If the encryption key is reachable through the same compromise that exposes the encrypted data, encryption at rest provides no real protection.",
    "threatIds": ["THR-DATA-KEY-COLOCATION"],
    "applicability": {
      "when": { "all": [{ "fact": "dataClasses", "operator": "contains", "value": "D3" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm encryption keys for D3 data are managed by a dedicated key management service or HSM, and that no encryption key is stored alongside the data it encrypts.",
          "requiredEvidenceTypes": ["CONFIG", "ARCHITECTURE"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No encryption key for D3 data is reachable through the same access path as the data it protects."],
    "evidenceRequirements": [{ "type": "ARCHITECTURE", "required": true }],
    "ownerRoles": ["infrastructure", "security"],
    "references": [],
    "relationships": { "dependsOn": ["DATA-ENC-001"], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["data_crypto", "key_management"]
  },
  {
    "controlId": "DATA-RETENTION-001",
    "version": 1,
    "status": "active",
    "title": "Data Retention and Deletion Limits",
    "group": "data_crypto",
    "domain": "data_crypto",
    "subdomain": "data_retention",
    "layer": "contain_recover",
    "requirement": "Confidential or restricted data must have a defined retention period, after which it is deleted or irreversibly anonymized.",
    "rationale": "Data kept beyond its useful purpose has no benefit but adds to the exposure of any future breach.",
    "threatIds": ["THR-DATA-EXCESSIVE-RETENTION"],
    "applicability": {
      "when": { "all": [{ "fact": "dataClasses", "operator": "intersects", "value": ["D2", "D3"] }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm a defined retention period exists for each store of confidential or restricted data, and that a deletion or anonymization job enforces it.",
          "requiredEvidenceTypes": ["CONFIG", "REPORT"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Confidential or restricted data past its defined retention period has been deleted or irreversibly anonymized."],
    "evidenceRequirements": [{ "type": "REPORT", "required": true }],
    "ownerRoles": ["privacy", "operations"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["data_crypto", "retention", "privacy"]
  },
  {
    "controlId": "DATA-MASK-001",
    "version": 1,
    "status": "active",
    "title": "Sensitive Data Masking in Non-Production Environments",
    "group": "data_crypto",
    "domain": "data_crypto",
    "subdomain": "data_masking",
    "layer": "prevent",
    "requirement": "Confidential or restricted data copied into a development or test database must be masked or synthetic, not a raw copy of production values.",
    "rationale": "Non-production environments are typically held to a lower security bar than production, so a raw copy of production data there is exposed to a wider set of people and weaker controls.",
    "threatIds": ["THR-DATA-NONPROD-EXPOSURE"],
    "applicability": {
      "when": {
        "all": [
          { "fact": "dataClasses", "operator": "intersects", "value": ["D2", "D3"] },
          { "fact": "components", "operator": "contains", "value": "database" }
        ]
      }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the process used to populate development or test databases and confirm confidential or restricted fields are masked, synthetic, or excluded rather than copied from production as-is.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["No development or test database contains an unmasked copy of a confidential or restricted production value."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["privacy", "devops"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["data_crypto", "masking"]
  }
]
```

- [ ] **Step 3: Create `tests/controls/data-crypto.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/data-crypto.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/data-crypto.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the data_crypto domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/data-crypto.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["data_crypto"]));
  });

  it("DATA-KEYSEP-001 depends on DATA-ENC-001", () => {
    const controls = loadJson<{ controlId: string; relationships?: { dependsOn?: string[] } }[]>(
      "data/controls/data-crypto.json"
    );
    const keysep = controls.find((c) => c.controlId === "DATA-KEYSEP-001");
    expect(keysep?.relationships?.dependsOn).toEqual(["DATA-ENC-001"]);
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/data-crypto.json");
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/controls/data-crypto.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add data/catalogs/threats.json data/controls/data-crypto.json tests/controls/data-crypto.test.ts
git commit -m "feat: add Data/Crypto pilot control domain (5 controls, 5 new threats)"
```

---

## Task 11: Update Manifest, Verify Pattern Coverage, Full Suite

**Files:**
- Modify: `data/manifest.json`
- Modify: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: a `data/manifest.json` whose `controls.count` and `controls.files` match what's actually on disk (6 files: `identity-access.json` plus the 5 new domain files; 12 + 27 = 39 total control records).

- [ ] **Step 1: Update `data/manifest.json`**

Change the `controls` block from:
```json
  "controls": {
    "count": 12,
    "files": ["controls/identity-access.json"]
  },
```
to:
```json
  "controls": {
    "count": 39,
    "files": [
      "controls/identity-access.json",
      "controls/appsec.json",
      "controls/infrastructure.json",
      "controls/operations.json",
      "controls/platform-specific.json",
      "controls/data-crypto.json"
    ]
  },
```

Leave `catalog`, `catalogVersion`, `schemaVersion`, `core`, `catalogs`, `schemas`, and `process` untouched — none of the preceding tasks added or removed a core/catalog/schema/process file, only added entries within `catalogs/threats.json`'s existing file and new files under `data/controls/`.

- [ ] **Step 2: Update `tests/manifest.test.ts`**

Find this test:
```ts
  it("controls.count matches the total number of control records across controls.files", () => {
```
No change needed to this test's body — it already computes the expected count dynamically from whatever `controls.files` lists, so it will automatically validate the new total against the new manifest. Leave it as-is.

No other test in `tests/manifest.test.ts` needs modification — the schema-file-list assertion, the "lists only files that actually exist" assertion, and the "has a file set on disk matching the manifest for each category directory" assertion all read `manifest.controls.files` dynamically and will now pass because the manifest and disk agree again.

- [ ] **Step 3: Run the manifest tests**

Run: `npx vitest run tests/manifest.test.ts`
Expected: PASS, all 4 tests (this is the test that was expected to fail from Task 6 through Task 10 — it should be green again now).

- [ ] **Step 4: Verify the pilot's applicability-pattern coverage table (spec §6) is actually satisfied**

This is a one-time confirmation, not a permanent test (the spec's coverage table is a design-time planning tool, not a runtime invariant to enforce forever). Run:

```bash
node -e "
const fs = require('fs');
const files = ['appsec','infrastructure','operations','platform-specific','data-crypto'].map(f => JSON.parse(fs.readFileSync('data/controls/'+f+'.json','utf-8'))).flat();
const has = (pred) => files.some(pred);
console.log('components-based:', has(c => JSON.stringify(c.applicability).includes('\"fact\":\"components\"')));
console.log('features-based:', has(c => JSON.stringify(c.applicability).includes('\"fact\":\"features.')));
console.log('identities-based:', has(c => JSON.stringify(c.applicability).includes('\"fact\":\"identities\"')));
console.log('dataClasses-based:', has(c => JSON.stringify(c.applicability).includes('\"fact\":\"dataClasses\"')));
console.log('exposure-based:', has(c => JSON.stringify(c.applicability).includes('\"fact\":\"exposure\"')));
console.log('SVL-based:', has(c => JSON.stringify(c.applicability).includes('\"fact\":\"securityLevel\"')));
console.log('all-conjunction:', has(c => 'all' in c.applicability.when));
console.log('any-disjunction:', has(c => 'any' in c.applicability.when));
console.log('multi-threat:', has(c => c.threatIds.length >= 2));
console.log('relationships:', has(c => (c.relationships?.dependsOn?.length || 0) + (c.relationships?.relatedTo?.length || 0) > 0));
console.log('multi-level assurance:', has(c => Object.keys(c.assurance || {}).length === 3 && new Set(Object.values(c.assurance).flat()).size > (c.assurance['SVL-1']||[]).length));
"
```
Expected: every line prints `true`. If any prints `false`, the corresponding pattern from spec §6's coverage table was not actually exercised by the content written in Tasks 6-10 — stop and add a control (or amend an existing one) that exercises it before proceeding, since the whole point of the pilot is to have stress-tested every pattern shape at least once.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: every test passes — the original Phase 1/Phase 2 tests, Task 1 through Task 10's new tests, and this task's manifest updates, all green with no known-failing exceptions remaining.

- [ ] **Step 6: Commit**

```bash
git add data/manifest.json
git commit -m "chore: register 5 pilot control domains in manifest.json"
```

---

## Self-Review Notes

(Recorded here per the writing-plans skill's self-review step, not for execution.)

- **Spec coverage:** §2/§3 → Task 2. §3 rules 9-12 → Task 3. §3's `finding-schema.json` strict fix → Task 4. §4 → Task 2 (rules 6-7) + Task 1 (the content it turned out to require). §5 → Task 5. §6 → Tasks 6-10 + Task 11 Step 4. §7 (testing strategy) → distributed across every task's own test file. §8 (adoption log) → no task; it's already-completed spec work, referenced only as rationale. §9 (out of scope) → correctly has no task.
- **Placeholder scan:** no task contains "TBD", "similar to Task N", or an under-specified "add appropriate X" instruction — every JSON payload, test file, and code change is given in full.
- **Type consistency:** `CatalogViolation`'s shape (`code`/`severity`/`source`/`entityId`/`path`/`message`) is defined once in Task 2 and referenced identically by name in every later task that imports it (Tasks 6-10). `validateCatalog(dataDir: string)` is called identically everywhere it's used.
- **New finding beyond the spec, surfaced during planning (not spec scope creep — a necessary correction discovered while making the spec executable):** Task 1 exists because dry-running Task 2's rules against real data during planning surfaced that `identity-access.json`'s content — not its schema — was incomplete against the assurance/verification linkage rule. This was verified by an actual Node script run against the real repository before being written into this plan (not assumed), and the fix was verified to close every gap with no remaining or duplicate entries.
