# Core Security Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seven `src/core/*.ts` modules the Core Engine spec defines — six pure functions (applicability, criticality, score, plan expansion, release evaluation, report assembly) plus the `SecurityRepository`/`JsonRepository` data-access layer — each with its own test file, so the project's schemas stop being documentation-only and become executable.

**Architecture:** One file per module, exactly matching the spec's `src/core/` layout. Every function in `applicability.ts` through `report-builder.ts` is pure (plain data in, plain data out, no I/O, no `SecurityRepository` parameter anywhere). `repository.ts` is the only file that touches the filesystem, implementing `SecurityRepository` against the existing `data/` tree via the already-existing `loadJson`/`createAjv` helpers in `src/validate.ts`. Tasks are ordered so each new module either has no dependency on prior tasks, or depends only on already-completed ones (`plan-expander.ts` reuses `applicability.ts`'s `evaluateApplicability`; `repository.ts` imports the concrete types every other module already defined rather than redeclaring them).

**Tech Stack:** TypeScript (strict mode) compiled as ES modules, Vitest (`npm test` = `vitest run`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-core-engine-design.md` (committed `1acab21`, already revised through one external-review adoption pass) — read both documents; this plan argues from that spec and does not repeat its rationale, only its concrete requirements.

## Global Constraints

- TypeScript strict mode (`tsconfig.json`: `"strict": true`) and ES module import syntax with explicit `.js` extensions on relative imports (matching `src/validate-catalog.ts`'s existing `from "./validate.js"` style) — this is a Node ESM project, not CommonJS, and the compiler will not resolve extensionless relative imports.
- No shared `src/core/types.ts`. Each module defines its own minimal local TypeScript interfaces for its own inputs/outputs (spec §2). Where this plan has one module import a *type* from another (e.g. `plan-expander.ts` importing `ProjectProfile`/`RuleNode` from `applicability.ts` to call `evaluateApplicability`), that is reuse of an already-defined shape, not a new shared-types file — never introduce `src/core/types.ts` to work around this.
- No function in `applicability.ts` through `report-builder.ts` takes a `SecurityRepository` parameter, calls one of its methods, or performs file I/O (`readFileSync`, `loadJson`, etc.) — pure functions only (spec §2). Only `repository.ts` touches the filesystem.
- No changes to any file under `data/schemas/`, `data/controls/`, `data/core/`, `data/process/`, or `data/catalogs/`. This plan builds an executable layer over already-frozen Phase 1/Phase 2/pilot/devops-supply-chain/governance data — it does not modify that data (spec §1, §11).
- `ReleaseEvaluation.result` stays the two-valued `"approved" | "blocked"` enum already fixed by `data/schemas/release-evaluation-schema.json` and `data/schemas/project-report-schema.json` (both `additionalProperties: false`, `result` enum exactly `["approved", "blocked"]`) — do not introduce a third value.
- After every task, run the **full** `npm test` (not just the new task's file) and confirm 0 regressions against the 154 tests across 31 files that passed before this plan started.

## Design Rulings Made While Grounding This Plan

The spec (§3–§9) is precise about behavior but written before this plan cross-checked every function signature against the real, frozen JSON Schemas. Four places needed a concrete resolution the spec itself didn't spell out at the signature level. Recorded here so the reasoning travels with the code, not just this plan:

1. **`all`/`any` empty-array validation is already enforced by Ajv, not by `applicability.ts`.** `data/schemas/control-schema.json`'s `ruleNode` `$def` already declares `"all": { "minItems": 1, ... }` and the same for `any`. The spec's boundary-condition text ("an empty condition list is a catalog validation error") is satisfied by that existing schema constraint — `evaluateApplicability` does not need special-case code for it, and Task 1 below does not add any. (Documented, not silently dropped: Task 1 includes one test recording this and pointing at the schema constraint, so a future reader doesn't wonder why no runtime guard exists.)
2. **`calculateScore` needs a `findings` parameter the spec's §5 signature omitted.** `data/schemas/score-schema.json`'s `domainScores[]` items require `criticalFindings`/`highFindings` — fields that can only be computed by cross-referencing `Finding[]` records against each domain's controlIds, which `assessments`/`controls`/`model` alone cannot supply. Task 3 adds `findings: FindingInput[]` as `calculateScore`'s third parameter (before `model`). This changes nothing about the formula the spec already fully specified; it supplies the one input category the schema requires that the original signature was missing.
3. **`expandPlan`'s `project: Project` parameter is replaced with `profile: ProjectProfile` and a new `assessments` parameter.** The spec's `selection.applicability` filter requires evaluating each control's applicability against a profile (so `expandPlan` needs `ProjectProfile`, which is all it actually uses from `Project` — reusing `evaluateApplicability` from Task 1 internally), and `selection.assessmentStatuses` requires knowing each control's current `ControlAssessment.status`, which neither `Control` nor `Project` carries. Task 4's `expandPlan(plan, controls, profile, assessments)` supplies both.
4. **The SVL-2 `"highFindings": "0_or_accepted_risk"` gate-4 threshold (`data/process/release-gates.json`) is given a precise per-finding rule, not a project-wide one.** The raw data string doesn't define what "covered by an accepted risk" means at the individual-finding level. Task 5 defines it as: a high-severity active Finding counts as covered only if *every* `controlId` in its `controlIds[]` has a `ControlAssessment.status` of `ACCEPTED_RISK` — not "any accepted risk exists anywhere in the project," which would let one unrelated accepted risk silently waive every high finding. This only changes the `result` verdict computation; the `highFindings` field itself (spec §7's table) stays a raw open/in_progress count, unaffected by this exception.

Two more decisions, lower-stakes, made the same way:

5. **`buildReport` takes `reportId` and `summary` as required caller-supplied inputs.** `project-report-schema.json` requires both, and neither is discussed in spec §8. `reportId` follows the same "ID generation is a side-effecting concern the caller owns" reasoning the spec already applies to `batchId`/`runId` in §6. `summary` is free-form prose with no formula anywhere in this project's data files to derive it from, so it is an input, not a derived value, consistent with `report-builder.ts`'s already-stated role of assembling given values rather than inventing them.
6. **`repository.ts` needs a project-instance file layout this project has never defined before** (every prior phase only ever built catalog/reference *schemas*, never a runtime storage convention for project instances). Task 7 introduces:
   ```
   data/plans/<planId>.json                        # AssessmentPlan — flat, keyed only by planId (see below)
   data/projects/<projectId>/project.json           # Project
   data/projects/<projectId>/runs/<runId>.json      # AssessmentRun
   data/projects/<projectId>/batches/<batchId>.json # AssessmentBatch
   data/projects/<projectId>/assessments.json       # ControlAssessment[] (single array file)
   data/projects/<projectId>/findings.json          # Finding[] (single array file)
   data/projects/<projectId>/reports/<reportId>.json # ProjectReport
   ```
   Plans are stored flat under `data/plans/` rather than nested under a project, specifically because `SecurityRepository.getPlan(planId)` (spec §9) takes only a `planId` — no `projectId` to build a nested path from — while `AssessmentPlan` already carries its own `projectId` field internally, so nesting it under a project directory would make it unreachable by the interface as specified. `saveRun`/`saveBatch`/`saveReport` all take full objects that already embed `projectId`, so those *can* and do nest under `data/projects/<projectId>/`. This layout is provisional and owned by this plan, not the spec — flag it to the user for confirmation before or shortly after Task 7, since it's the one part of this plan inventing something genuinely new rather than resolving an existing gap.

---

### Task 1: `src/core/applicability.ts` — Three-Valued Applicability Evaluation

**Files:**
- Create: `src/core/applicability.ts`
- Test: `tests/core/applicability.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces (for later tasks to import):
  ```ts
  export type Verdict = "applicable" | "not_applicable" | "unknown";
  export interface FactCondition { fact: string; operator: "eq" | "ne" | "in" | "not_in" | "contains" | "intersects" | "gt" | "gte" | "lt" | "lte"; value: unknown; }
  export type RuleNode = { all: RuleNode[] } | { any: RuleNode[] } | FactCondition;
  export interface Control { controlId: string; applicability: { when: RuleNode }; }
  export interface ProjectProfile {
    securityLevel: string;
    exposure: string[];
    components?: string[];
    identities?: string[];
    dataClasses?: string[];
    features?: Record<string, boolean>;
    technologies?: { languages?: string[]; frameworks?: string[]; databases?: string[]; cloud?: string[] };
  }
  export interface ApplicabilityResult { autoResult: Verdict; matchedRules: string[]; }
  export function evaluateApplicability(control: Control, profile: ProjectProfile): ApplicabilityResult;
  ```

- [ ] **Step 1: Write the failing tests — leaf evaluation and the three-valued `components`/`identities`/`dataClasses` contract**

Create `tests/core/applicability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateApplicability, type Control, type ProjectProfile } from "../../src/core/applicability.js";

function control(when: Control["applicability"]["when"]): Control {
  return { controlId: "TEST-001", applicability: { when } };
}

const baseProfile: ProjectProfile = {
  securityLevel: "SVL-2",
  exposure: ["internet_public"],
  components: ["backend_api"],
  features: { authentication: true },
  technologies: {},
};

describe("evaluateApplicability — leaf conditions", () => {
  it("eq: true when the fact equals the target value", () => {
    const c = control({ fact: "features.authentication", operator: "eq", value: true });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("eq: not_applicable when the fact does not equal the target value", () => {
    const c = control({ fact: "features.authentication", operator: "eq", value: false });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("not_applicable");
  });

  it("contains: applicable when the fact array contains the target", () => {
    const c = control({ fact: "components", operator: "contains", value: "backend_api" });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("intersects: applicable when fact and target arrays share any element", () => {
    const c = control({ fact: "components", operator: "intersects", value: ["browser_frontend", "backend_api"] });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("in: applicable when the fact value is a member of the target array", () => {
    const c = control({ fact: "securityLevel", operator: "in", value: ["SVL-2", "SVL-3"] });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("components omitted entirely (not []) evaluates the leaf to unknown", () => {
    const { components, ...rest } = baseProfile;
    const profileWithoutComponents: ProjectProfile = rest;
    const c = control({ fact: "components", operator: "contains", value: "backend_api" });
    expect(evaluateApplicability(c, profileWithoutComponents).autoResult).toBe("unknown");
  });

  it("components as [] (known-none) evaluates the leaf to not_applicable, not unknown", () => {
    const profile: ProjectProfile = { ...baseProfile, components: [] };
    const c = control({ fact: "components", operator: "contains", value: "backend_api" });
    expect(evaluateApplicability(c, profile).autoResult).toBe("not_applicable");
  });

  it("an omitted boolean feature flag is treated as its literal undefined value, not as unknown (features is a required object; only components/identities/dataClasses get the omitted-means-unknown treatment)", () => {
    const profile: ProjectProfile = { ...baseProfile, features: {} };
    const c = control({ fact: "features.fileUpload", operator: "eq", value: true });
    expect(evaluateApplicability(c, profile).autoResult).toBe("not_applicable");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/applicability.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/applicability.js'`

- [ ] **Step 3: Implement `evaluateApplicability`, including Kleene composition**

Leaf evaluation and `all`/`any` composition are tightly coupled — `evaluateNode`'s recursion needs both branches to exist for either to be reachable through the public `evaluateApplicability` entry point, so this step writes the whole module at once rather than an artificially split leaf-only version. Step 1's tests (leaf conditions) exercise only the leaf branch of the code below; Step 6 adds tests for the `all`/`any` branches this same implementation already contains.

Create `src/core/applicability.ts`:

```ts
export type Verdict = "applicable" | "not_applicable" | "unknown";

export interface FactCondition {
  fact: string;
  operator: "eq" | "ne" | "in" | "not_in" | "contains" | "intersects" | "gt" | "gte" | "lt" | "lte";
  value: unknown;
}

export type RuleNode = { all: RuleNode[] } | { any: RuleNode[] } | FactCondition;

export interface Control {
  controlId: string;
  applicability: { when: RuleNode };
}

export interface ProjectProfile {
  securityLevel: string;
  exposure: string[];
  components?: string[];
  identities?: string[];
  dataClasses?: string[];
  features?: Record<string, boolean>;
  technologies?: { languages?: string[]; frameworks?: string[]; databases?: string[]; cloud?: string[] };
}

export interface ApplicabilityResult {
  autoResult: Verdict;
  matchedRules: string[];
}

// Only these three fields carry the three-valued (omitted=UNKNOWN, []=NONE, [...]=KNOWN) contract per
// project-profile-schema.json's descriptions. `features` itself is required, so an omitted features.* boolean
// is its literal undefined value, not UNKNOWN — see the spec's §3.
const THREE_VALUED_ROOT_FIELDS = new Set(["components", "identities", "dataClasses"]);

function getFactValue(profile: ProjectProfile, fact: string): unknown {
  let current: unknown = profile;
  for (const segment of fact.split(".")) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function evaluateOperator(operator: FactCondition["operator"], factValue: unknown, target: unknown): boolean {
  switch (operator) {
    case "eq":
      return factValue === target;
    case "ne":
      return factValue !== target;
    case "in":
      return Array.isArray(target) && target.includes(factValue);
    case "not_in":
      return Array.isArray(target) && !target.includes(factValue);
    case "contains":
      return Array.isArray(factValue) && factValue.includes(target);
    case "intersects":
      return Array.isArray(factValue) && Array.isArray(target) && factValue.some((v) => target.includes(v));
    case "gt":
      return typeof factValue === "number" && typeof target === "number" && factValue > target;
    case "gte":
      return typeof factValue === "number" && typeof target === "number" && factValue >= target;
    case "lt":
      return typeof factValue === "number" && typeof target === "number" && factValue < target;
    case "lte":
      return typeof factValue === "number" && typeof target === "number" && factValue <= target;
  }
}

function evaluateLeaf(condition: FactCondition, profile: ProjectProfile): Verdict {
  const rootField = condition.fact.split(".")[0];
  const factValue = getFactValue(profile, condition.fact);
  if (factValue === undefined && THREE_VALUED_ROOT_FIELDS.has(rootField)) {
    return "unknown";
  }
  return evaluateOperator(condition.operator, factValue, condition.value) ? "applicable" : "not_applicable";
}

interface NodeResult {
  verdict: Verdict;
  matchedRules: string[];
}

function prefixChild(kind: "all" | "any", index: number, child: NodeResult): string[] {
  if (child.matchedRules.length === 0) return [`${kind}[${index}]`];
  return child.matchedRules.map((p) => `${kind}[${index}].${p}`);
}

function evaluateNode(node: RuleNode, profile: ProjectProfile): NodeResult {
  if ("all" in node) {
    const results = node.all.map((child, i) => ({ i, result: evaluateNode(child, profile) }));
    const notApplicable = results.filter((r) => r.result.verdict === "not_applicable");
    if (notApplicable.length > 0) {
      return { verdict: "not_applicable", matchedRules: notApplicable.flatMap((r) => prefixChild("all", r.i, r.result)) };
    }
    if (results.every((r) => r.result.verdict === "applicable")) {
      return { verdict: "applicable", matchedRules: results.flatMap((r) => prefixChild("all", r.i, r.result)) };
    }
    const unknowns = results.filter((r) => r.result.verdict === "unknown");
    return { verdict: "unknown", matchedRules: unknowns.flatMap((r) => prefixChild("all", r.i, r.result)) };
  }
  if ("any" in node) {
    const results = node.any.map((child, i) => ({ i, result: evaluateNode(child, profile) }));
    const applicable = results.filter((r) => r.result.verdict === "applicable");
    if (applicable.length > 0) {
      return { verdict: "applicable", matchedRules: applicable.flatMap((r) => prefixChild("any", r.i, r.result)) };
    }
    if (results.every((r) => r.result.verdict === "not_applicable")) {
      return { verdict: "not_applicable", matchedRules: results.flatMap((r) => prefixChild("any", r.i, r.result)) };
    }
    const unknowns = results.filter((r) => r.result.verdict === "unknown");
    return { verdict: "unknown", matchedRules: unknowns.flatMap((r) => prefixChild("any", r.i, r.result)) };
  }
  return { verdict: evaluateLeaf(node, profile), matchedRules: [] };
}

export function evaluateApplicability(control: Control, profile: ProjectProfile): ApplicabilityResult {
  const result = evaluateNode(control.applicability.when, profile);
  return { autoResult: result.verdict, matchedRules: result.matchedRules };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/applicability.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/applicability.ts tests/core/applicability.test.ts
git commit -m "feat(core): applicability leaf evaluation with three-valued contract"
```

- [ ] **Step 6: Write tests — Kleene composition truth table + the spec's own worked example**

These verify logic Step 3 already implemented (see Step 3's note) — this step proves it thoroughly rather than driving new implementation. Append to `tests/core/applicability.test.ts`:

```ts
import { loadJson } from "../../src/validate.js";
import type { RuleNode } from "../../src/core/applicability.js";

// T/F/U leaves built from the real DSL: components is one of only two fields whose omission this project
// treats as UNKNOWN, so these three constants exercise the actual three-valued contract, not a fake one.
const T: RuleNode = { fact: "components", operator: "contains", value: "backend_api" }; // applicable (baseProfile has it)
const F: RuleNode = { fact: "components", operator: "contains", value: "nonexistent" }; // not_applicable
const U: RuleNode = { fact: "identities", operator: "contains", value: "admin" }; // identities omitted -> unknown

describe("evaluateApplicability — Kleene composition truth table", () => {
  it.each([
    [[T, T], "applicable"],
    [[T, U], "unknown"],
    [[T, F], "not_applicable"],
    [[U, F], "not_applicable"],
    [[U, U], "unknown"],
  ] as const)("all(%o) = %s", (children, expected) => {
    expect(evaluateApplicability(control({ all: [...children] }), baseProfile).autoResult).toBe(expected);
  });

  it.each([
    [[F, F], "not_applicable"],
    [[F, U], "unknown"],
    [[F, T], "applicable"],
    [[U, T], "applicable"],
    [[U, U], "unknown"],
  ] as const)("any(%o) = %s", (children, expected) => {
    expect(evaluateApplicability(control({ any: [...children] }), baseProfile).autoResult).toBe(expected);
  });

  it("nested: all(applicable, any(not_applicable, unknown)) = unknown", () => {
    const rule: RuleNode = { all: [T, { any: [F, U] }] };
    expect(evaluateApplicability(control(rule), baseProfile).autoResult).toBe("unknown");
  });

  it("the spec's §3 worked example: all[authentication eq true, dataClasses contains D3] with authentication:false and dataClasses omitted -> not_applicable, matchedRules identifies all[0]", () => {
    const profile: ProjectProfile = { ...baseProfile, features: { authentication: false } };
    const rule: RuleNode = {
      all: [
        { fact: "features.authentication", operator: "eq", value: true },
        { fact: "dataClasses", operator: "contains", value: "D3" },
      ],
    };
    const result = evaluateApplicability(control(rule), profile);
    expect(result.autoResult).toBe("not_applicable");
    expect(result.matchedRules).toEqual(["all[0]"]);
  });

  it("same rule with authentication:true and dataClasses omitted -> unknown, matchedRules identifies all[1]", () => {
    const profile: ProjectProfile = { ...baseProfile, features: { authentication: true } };
    const rule: RuleNode = {
      all: [
        { fact: "features.authentication", operator: "eq", value: true },
        { fact: "dataClasses", operator: "contains", value: "D3" },
      ],
    };
    const result = evaluateApplicability(control(rule), profile);
    expect(result.autoResult).toBe("unknown");
    expect(result.matchedRules).toEqual(["all[1]"]);
  });

  it("empty all[]/any[] is rejected upstream by control-schema.json's minItems:1, not by this module (see this plan's Design Rulings, item 1)", () => {
    const schema = loadJson<{ $defs: { ruleNode: { oneOf: [{ properties: { all: { minItems: number } } }, { properties: { any: { minItems: number } } }, unknown] } } }>(
      "data/schemas/control-schema.json"
    );
    const [allBranch, anyBranch] = schema.$defs.ruleNode.oneOf;
    expect(allBranch.properties.all.minItems).toBe(1);
    expect(anyBranch.properties.any.minItems).toBe(1);
  });
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/core/applicability.test.ts`
Expected: PASS (22 tests total in the file: 8 from Step 1 + 14 new). These assertions are the authoritative expected values derived directly from the Kleene rules in spec §3 — if any fails, the bug is in Step 3's `evaluateNode`, not in the test.

- [ ] **Step 8: Commit**

```bash
git add tests/core/applicability.test.ts
git commit -m "test(core): applicability Kleene truth table + spec worked example"
```

- [ ] **Step 9: Write the failing test — real 48-control catalog compatibility smoke test**

Append to `tests/core/applicability.test.ts`:

```ts
import { loadJson } from "../../src/validate.js";

describe("evaluateApplicability — catalog-engine compatibility smoke test", () => {
  it("evaluates all 48 real controls without throwing or producing an unrecognized-grammar error", () => {
    const manifest = loadJson<{ controls: { files: string[] } }>("data/manifest.json");
    const allControls = manifest.controls.files.flatMap((f) => loadJson<Control[]>(`data/${f}`));
    expect(allControls.length).toBe(48);

    const placeholderProfile: ProjectProfile = {
      securityLevel: "SVL-2",
      exposure: ["internet_public"],
      components: ["backend_api", "browser_frontend", "mobile_app", "ci_pipeline", "container_image", "release_pipeline"],
      identities: ["anonymous", "user", "administrator"],
      dataClasses: ["D0", "D1", "D2", "D3"],
      features: {
        authentication: true, authorization: true, adminInterface: true, fileUpload: true,
        payment: true, webhook: true, oauth: true, ai: true,
      },
      technologies: { languages: ["typescript"], frameworks: ["nextjs"], databases: ["postgresql"], cloud: ["aws"] },
    };

    for (const control of allControls) {
      expect(() => evaluateApplicability(control, placeholderProfile)).not.toThrow();
      const result = evaluateApplicability(control, placeholderProfile);
      expect(["applicable", "not_applicable", "unknown"]).toContain(result.autoResult);
    }
  });
});
```

- [ ] **Step 10: Run to verify it fails, then passes**

Run: `npx vitest run tests/core/applicability.test.ts`
Expected first: FAIL if `evaluateNode`/`evaluateLeaf` throws on any real control's rule shape (e.g. an operator or nesting pattern Step 3's implementation didn't anticipate). If it fails, read the thrown error's control/fact/operator and extend `evaluateOperator`/`evaluateNode` to handle it — every operator in `control-schema.json`'s `factCondition.operator` enum (`eq`/`ne`/`in`/`not_in`/`contains`/`intersects`/`gt`/`gte`/`lt`/`lte`) is already implemented in Step 3, so a failure here most likely means a nesting depth or fact-path assumption needs fixing, not a missing operator.
Expected after any fix: PASS (23 tests total: 22 from Step 7 + 1 new)

- [ ] **Step 11: Commit**

```bash
git add tests/core/applicability.test.ts
git commit -m "test(core): applicability catalog-engine compatibility smoke test"
```

---

### Task 2: `src/core/criticality.ts` — Criticality Calculation

**Files:**
- Create: `src/core/criticality.ts`
- Test: `tests/core/criticality.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface SeverityFactors { impact: number; exploitability: number; exposure: number; privilegeRequired: number; detectionDifficulty: number; }
  export interface CriticalityFormula {
    formulaId: string; version: string; scaleMax: number;
    directions: Record<keyof SeverityFactors, "higher_is_worse" | "lower_is_worse">;
    ranges: Record<keyof SeverityFactors, { min: number; max: number }>;
    weights: Record<keyof SeverityFactors, number>;
    rounding: "round" | "floor" | "ceil";
  }
  export interface CriticalityResult { index: number; formulaId: string; formulaVersion: string; computedAt: string; }
  export function calculateCriticality(factors: SeverityFactors, formula: CriticalityFormula, now: () => string): CriticalityResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/core/criticality.test.ts`. The formula fixture below copies `data/core/criticality-weights.json`'s real values exactly (weights sum to 1.0, `scaleMax: 9`), so the expected `index` values are the same numbers a real assessment would produce:

```ts
import { describe, expect, it } from "vitest";
import { calculateCriticality, type CriticalityFormula, type SeverityFactors } from "../../src/core/criticality.js";

const formula: CriticalityFormula = {
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
  weights: { impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.1 },
  rounding: "round",
};

const fixedNow = () => "2026-09-28T00:00:00.000Z";

describe("calculateCriticality", () => {
  it("all-minimum-severity factors (best case, including max privilegeRequired since lower_is_worse) produce index 0", () => {
    const factors: SeverityFactors = { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 };
    expect(calculateCriticality(factors, formula, fixedNow).index).toBe(0);
  });

  it("all-maximum-severity factors (worst case, including privilegeRequired 0 since lower_is_worse) produce index 9", () => {
    const factors: SeverityFactors = { impact: 5, exploitability: 5, exposure: 3, privilegeRequired: 0, detectionDifficulty: 2 };
    expect(calculateCriticality(factors, formula, fixedNow).index).toBe(9);
  });

  it("all-midpoint factors produce a weighted sum of exactly 4.5, rounded to 5 (JS Math.round rounds .5 up)", () => {
    const factors: SeverityFactors = { impact: 3, exploitability: 3, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 };
    expect(calculateCriticality(factors, formula, fixedNow).index).toBe(5);
  });

  it("the same midpoint factors with rounding:'floor' produce 4", () => {
    const factors: SeverityFactors = { impact: 3, exploitability: 3, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 };
    expect(calculateCriticality(factors, { ...formula, rounding: "floor" }, fixedNow).index).toBe(4);
  });

  it("the same midpoint factors with rounding:'ceil' produce 5", () => {
    const factors: SeverityFactors = { impact: 3, exploitability: 3, exposure: 2, privilegeRequired: 1, detectionDifficulty: 1 };
    expect(calculateCriticality(factors, { ...formula, rounding: "ceil" }, fixedNow).index).toBe(5);
  });

  it("stamps computedAt from the injected now() rather than the real clock", () => {
    const factors: SeverityFactors = { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 };
    expect(calculateCriticality(factors, formula, fixedNow).computedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("carries formulaId/formulaVersion from the formula input", () => {
    const factors: SeverityFactors = { impact: 1, exploitability: 1, exposure: 1, privilegeRequired: 2, detectionDifficulty: 0 };
    const result = calculateCriticality(factors, formula, fixedNow);
    expect(result.formulaId).toBe("CRIT-DEFAULT");
    expect(result.formulaVersion).toBe("1.0.0");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/criticality.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/core/criticality.ts`:

```ts
export interface SeverityFactors {
  impact: number;
  exploitability: number;
  exposure: number;
  privilegeRequired: number;
  detectionDifficulty: number;
}

export interface CriticalityFormula {
  formulaId: string;
  version: string;
  scaleMax: number;
  directions: Record<keyof SeverityFactors, "higher_is_worse" | "lower_is_worse">;
  ranges: Record<keyof SeverityFactors, { min: number; max: number }>;
  weights: Record<keyof SeverityFactors, number>;
  rounding: "round" | "floor" | "ceil";
}

export interface CriticalityResult {
  index: number;
  formulaId: string;
  formulaVersion: string;
  computedAt: string;
}

const FACTOR_KEYS: (keyof SeverityFactors)[] = ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"];

function normalize(value: number, range: { min: number; max: number }, direction: "higher_is_worse" | "lower_is_worse"): number {
  const span = range.max - range.min;
  return direction === "higher_is_worse" ? (value - range.min) / span : (range.max - value) / span;
}

function applyRounding(value: number, rounding: "round" | "floor" | "ceil"): number {
  if (rounding === "floor") return Math.floor(value);
  if (rounding === "ceil") return Math.ceil(value);
  return Math.round(value);
}

export function calculateCriticality(factors: SeverityFactors, formula: CriticalityFormula, now: () => string): CriticalityResult {
  const weightedSum = FACTOR_KEYS.reduce((sum, key) => {
    const normalized = normalize(factors[key], formula.ranges[key], formula.directions[key]);
    return sum + normalized * formula.weights[key];
  }, 0);
  const index = applyRounding(weightedSum * formula.scaleMax, formula.rounding);
  return { index, formulaId: formula.formulaId, formulaVersion: formula.version, computedAt: now() };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/criticality.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/criticality.ts tests/core/criticality.test.ts
git commit -m "feat(core): criticality calculation from formula data"
```

---

### Task 3: `src/core/score.ts` — Score Calculation

**Files:**
- Create: `src/core/score.ts`
- Test: `tests/core/score.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface ControlAssessmentInput { controlId: string; status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK"; }
  export interface ControlDomainInput { controlId: string; domain: string; }
  export interface FindingInput { controlIds: string[]; severity: "critical" | "high" | "medium" | "low" | "info"; status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive"; }
  export interface ScoreModel { modelId: string; version: string; statusWeights: Record<"PASS" | "PARTIAL" | "FAIL" | "NOT_TESTED", number>; excludedStatuses: ("N/A" | "ACCEPTED_RISK")[]; }
  export interface DomainScore { domain: string; score: number; totalControls: number; applicableControls: number; assessedControls: number; coveragePercent: number; passCount: number; failCount: number; partialCount: number; notTestedCount: number; notApplicableCount: number; acceptedRiskCount: number; criticalFindings: number; highFindings: number; }
  export interface Score { overallScore: number; coverage: { applicableControls: number; assessedControls: number; coveragePercent: number }; scoreModel: { id: string; version: string }; domainScores: DomainScore[]; }
  export function calculateScore(assessments: ControlAssessmentInput[], controls: ControlDomainInput[], findings: FindingInput[], model: ScoreModel): Score;
  ```
  (Note the `findings` parameter — see this plan's Design Rulings, item 2.)

- [ ] **Step 1: Write the failing tests — overall score and the NOT_TESTED/exclusion edge cases**

Create `tests/core/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateScore, type ControlAssessmentInput, type ControlDomainInput, type FindingInput, type ScoreModel } from "../../src/core/score.js";

const model: ScoreModel = {
  modelId: "USSVS-SCORE-DEFAULT",
  version: "1.0.0",
  statusWeights: { PASS: 1.0, PARTIAL: 0.5, FAIL: 0, NOT_TESTED: 0 },
  excludedStatuses: ["N/A", "ACCEPTED_RISK"],
};

const controls: ControlDomainInput[] = [
  { controlId: "A-001", domain: "appsec" },
  { controlId: "A-002", domain: "appsec" },
  { controlId: "A-003", domain: "appsec" },
  { controlId: "A-004", domain: "appsec" },
];

describe("calculateScore — overall formula", () => {
  it("2 PASS + 1 FAIL + 1 NOT_TESTED = 100 * 2 / 4 = 50", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "A-003", status: "FAIL" },
      { controlId: "A-004", status: "NOT_TESTED" },
    ];
    expect(calculateScore(assessments, controls, [], model).overallScore).toBe(50);
  });

  it("all-NOT_TESTED must not read as 100% — it reads as 0", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "NOT_TESTED" },
      { controlId: "A-002", status: "NOT_TESTED" },
      { controlId: "A-003", status: "NOT_TESTED" },
    ];
    const threeControls = controls.slice(0, 3);
    expect(calculateScore(assessments, threeControls, [], model).overallScore).toBe(0);
  });

  it("3 tested (PASS) + 7 NOT_TESTED does not read as near-100% — it reads as 30, not silently rounding up to full coverage's worth of confidence", () => {
    const tenControls: ControlDomainInput[] = Array.from({ length: 10 }, (_, i) => ({ controlId: `C-${i}`, domain: "d" }));
    const assessments: ControlAssessmentInput[] = tenControls.map((c, i) => ({
      controlId: c.controlId,
      status: i < 3 ? "PASS" : "NOT_TESTED",
    }));
    expect(calculateScore(assessments, tenControls, [], model).overallScore).toBe(30);
  });

  it("N/A and ACCEPTED_RISK are removed from both numerator and denominator entirely", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "FAIL" },
      { controlId: "A-003", status: "N/A" },
    ];
    // non-excluded: PASS + FAIL = 2 controls, sum weights = 1 -> 100*1/2 = 50 (A-003 counted nowhere)
    expect(calculateScore(assessments, controls.slice(0, 3), [], model).overallScore).toBe(50);
  });

  it("throws when every assessment is excluded (no non-excluded applicable control to score at all)", () => {
    const assessments: ControlAssessmentInput[] = [{ controlId: "A-001", status: "N/A" }];
    expect(() => calculateScore(assessments, controls.slice(0, 1), [], model)).toThrow();
  });

  it("coverage.coveragePercent excludes NOT_TESTED from assessedControls", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "FAIL" },
      { controlId: "A-003", status: "NOT_TESTED" },
      { controlId: "A-004", status: "N/A" },
    ];
    // applicableControls = 3 (A-001,A-002,A-003; A-004 excluded), assessedControls = 2 (A-001,A-002)
    const result = calculateScore(assessments, controls, [], model);
    expect(result.coverage.applicableControls).toBe(3);
    expect(result.coverage.assessedControls).toBe(2);
    expect(result.coverage.coveragePercent).toBeCloseTo((2 / 3) * 100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/score.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the overall-score half**

Create `src/core/score.ts`:

```ts
export interface ControlAssessmentInput {
  controlId: string;
  status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";
}

export interface ControlDomainInput {
  controlId: string;
  domain: string;
}

export interface FindingInput {
  controlIds: string[];
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
}

export interface ScoreModel {
  modelId: string;
  version: string;
  statusWeights: Record<"PASS" | "PARTIAL" | "FAIL" | "NOT_TESTED", number>;
  excludedStatuses: ("N/A" | "ACCEPTED_RISK")[];
}

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
  criticalFindings: number;
  highFindings: number;
}

export interface Score {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: DomainScore[];
}

function isExcluded(status: ControlAssessmentInput["status"], model: ScoreModel): boolean {
  return (model.excludedStatuses as string[]).includes(status);
}

function computeScore(subset: ControlAssessmentInput[], model: ScoreModel): number | null {
  const eligible = subset.filter((a) => !isExcluded(a.status, model));
  if (eligible.length === 0) return null;
  const sum = eligible.reduce((s, a) => s + (model.statusWeights[a.status as keyof ScoreModel["statusWeights"]] ?? 0), 0);
  return (100 * sum) / eligible.length;
}

function countActiveFindings(findings: FindingInput[], controlIds: Set<string>, severity: FindingInput["severity"]): number {
  return findings.filter(
    (f) =>
      (f.status === "open" || f.status === "in_progress") &&
      f.severity === severity &&
      f.controlIds.some((id) => controlIds.has(id))
  ).length;
}

export function calculateScore(
  assessments: ControlAssessmentInput[],
  controls: ControlDomainInput[],
  findings: FindingInput[],
  model: ScoreModel
): Score {
  const overallScore = computeScore(assessments, model);
  if (overallScore === null) {
    throw new Error("calculateScore: every assessment is an excluded status (N/A/ACCEPTED_RISK) — nothing to score");
  }

  const applicableAssessments = assessments.filter((a) => !isExcluded(a.status, model));
  const applicableControls = applicableAssessments.length;
  const assessedControls = applicableAssessments.filter((a) => a.status !== "NOT_TESTED").length;
  const coveragePercent = (assessedControls / applicableControls) * 100;

  const domains = [...new Set(controls.map((c) => c.domain))].sort();
  const domainScores: DomainScore[] = [];
  for (const domain of domains) {
    const domainControlIds = new Set(controls.filter((c) => c.domain === domain).map((c) => c.controlId));
    const domainAssessments = assessments.filter((a) => domainControlIds.has(a.controlId));
    const domainScoreValue = computeScore(domainAssessments, model);
    if (domainScoreValue === null) continue; // zero non-excluded controls in this domain: omit it entirely

    const domainApplicable = domainAssessments.filter((a) => !isExcluded(a.status, model));
    domainScores.push({
      domain,
      score: domainScoreValue,
      totalControls: domainAssessments.length,
      applicableControls: domainApplicable.length,
      assessedControls: domainApplicable.filter((a) => a.status !== "NOT_TESTED").length,
      coveragePercent: (domainApplicable.filter((a) => a.status !== "NOT_TESTED").length / domainApplicable.length) * 100,
      passCount: domainAssessments.filter((a) => a.status === "PASS").length,
      failCount: domainAssessments.filter((a) => a.status === "FAIL").length,
      partialCount: domainAssessments.filter((a) => a.status === "PARTIAL").length,
      notTestedCount: domainAssessments.filter((a) => a.status === "NOT_TESTED").length,
      notApplicableCount: domainAssessments.filter((a) => a.status === "N/A").length,
      acceptedRiskCount: domainAssessments.filter((a) => a.status === "ACCEPTED_RISK").length,
      criticalFindings: countActiveFindings(findings, domainControlIds, "critical"),
      highFindings: countActiveFindings(findings, domainControlIds, "high"),
    });
  }

  return {
    overallScore,
    coverage: { applicableControls, assessedControls, coveragePercent },
    scoreModel: { id: model.modelId, version: model.version },
    domainScores,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/score.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/score.ts tests/core/score.test.ts
git commit -m "feat(core): overall score calculation"
```

- [ ] **Step 6: Write tests — domain scores, zero-denominator omission, and Finding cross-referencing**

Append to `tests/core/score.test.ts`:

```ts
describe("calculateScore — domainScores", () => {
  const twoDomainControls: ControlDomainInput[] = [
    { controlId: "A-001", domain: "appsec" },
    { controlId: "A-002", domain: "appsec" },
    { controlId: "B-001", domain: "infra" },
  ];

  it("a domain with zero non-excluded controls is omitted from domainScores entirely, not scored 100 or 0", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "B-001", status: "N/A" }, // infra's only control is excluded -> zero-denominator domain
    ];
    const result = calculateScore(assessments, twoDomainControls, [], model);
    expect(result.domainScores.map((d) => d.domain)).toEqual(["appsec"]);
    expect(result.overallScore).toBe(100); // unaffected by infra's exclusion since it's excluded project-wide too
  });

  it("domainScores are sorted by domain name ascending", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "B-001", status: "PASS" },
    ];
    const reordered: ControlDomainInput[] = [twoDomainControls[2], twoDomainControls[0], twoDomainControls[1]];
    const result = calculateScore(assessments, reordered, [], model);
    expect(result.domainScores.map((d) => d.domain)).toEqual(["appsec", "infra"]);
  });

  it("counts an open critical finding against the domain of any control it references", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "A-001", status: "PASS" },
      { controlId: "A-002", status: "PASS" },
      { controlId: "B-001", status: "PASS" },
    ];
    const findings: FindingInput[] = [
      { controlIds: ["A-001"], severity: "critical", status: "open" },
      { controlIds: ["B-001"], severity: "high", status: "resolved" }, // resolved: not counted
    ];
    const result = calculateScore(assessments, twoDomainControls, findings, model);
    const appsec = result.domainScores.find((d) => d.domain === "appsec")!;
    const infra = result.domainScores.find((d) => d.domain === "infra")!;
    expect(appsec.criticalFindings).toBe(1);
    expect(infra.highFindings).toBe(0);
  });
});
```

- [ ] **Step 7: Run to verify it passes (implementation from Step 3 already covers this)**

Run: `npx vitest run tests/core/score.test.ts`
Expected: PASS (9 tests total). If any assertion fails, the domain-loop or `countActiveFindings` logic from Step 3 needs adjusting to match — these test expectations are the authoritative source of truth for this step.

- [ ] **Step 8: Commit**

```bash
git add tests/core/score.test.ts
git commit -m "test(core): score domain breakdown, zero-denominator omission, finding cross-reference"
```

---

### Task 4: `src/core/plan-expander.ts` — Plan → Batch Expansion

**Files:**
- Create: `src/core/plan-expander.ts`
- Test: `tests/core/plan-expander.test.ts`

**Interfaces:**
- Consumes: `evaluateApplicability`, `type RuleNode`, `type ProjectProfile`, `type Verdict` from `./applicability.js` (Task 1).
- Produces:
  ```ts
  export interface AssessmentPlanSelection { applicability?: Verdict[]; assessmentStatuses?: string[]; domains?: string[]; controlIds?: string[]; }
  export interface GroupOverride { groupValue: string; maxParallelAgents?: number; skip?: boolean; }
  export interface AssessmentPlan { planId: string; selection?: AssessmentPlanSelection; groupBy: "domain" | "subdomain" | "layer" | "group" | "controlId"; defaultMaxParallelAgents: number; groupOverrides?: GroupOverride[]; }
  export interface PlanControl { controlId: string; domain: string; subdomain: string; layer: string; group: string; applicability: { when: RuleNode }; }
  export interface AssessmentStatusInput { controlId: string; status: string; }
  export interface BatchDraft { groupBy: string; groupValue: string; controlIds: string[]; maxParallelAgents?: number; }
  export function expandPlan(plan: AssessmentPlan, controls: PlanControl[], profile: ProjectProfile, assessments: AssessmentStatusInput[]): BatchDraft[];
  ```
  (Signature departs from the spec's `expandPlan(plan, controls, project)` — see this plan's Design Rulings, item 3.)

- [ ] **Step 1: Write the failing tests — grouping and selection filters**

Create `tests/core/plan-expander.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { expandPlan, type AssessmentPlan, type AssessmentStatusInput, type PlanControl } from "../../src/core/plan-expander.js";
import type { ProjectProfile } from "../../src/core/applicability.js";

const controls: PlanControl[] = [
  {
    controlId: "A-002", domain: "appsec", subdomain: "injection", layer: "prevent", group: "appsec",
    applicability: { when: { fact: "components", operator: "contains", value: "backend_api" } },
  },
  {
    controlId: "A-001", domain: "appsec", subdomain: "injection", layer: "prevent", group: "appsec",
    applicability: { when: { fact: "components", operator: "contains", value: "backend_api" } },
  },
  {
    controlId: "B-001", domain: "infra", subdomain: "network", layer: "prevent", group: "infra",
    applicability: { when: { fact: "components", operator: "contains", value: "backend_api" } },
  },
];

const profile: ProjectProfile = {
  securityLevel: "SVL-2",
  exposure: ["internet_public"],
  components: ["backend_api"],
  features: {},
  technologies: {},
};

function plan(overrides: Partial<AssessmentPlan> = {}): AssessmentPlan {
  return { planId: "P-1", groupBy: "domain", defaultMaxParallelAgents: 1, ...overrides };
}

describe("expandPlan — grouping", () => {
  it("groups by domain, one batch per distinct domain value, sorted by groupValue", () => {
    const drafts = expandPlan(plan(), controls, profile, []);
    expect(drafts).toEqual([
      { groupBy: "domain", groupValue: "appsec", controlIds: ["A-001", "A-002"] },
      { groupBy: "domain", groupValue: "infra", controlIds: ["B-001"] },
    ]);
  });

  it("controlIds within a batch are sorted ascending regardless of input order", () => {
    const drafts = expandPlan(plan(), controls, profile, []);
    const appsec = drafts.find((d) => d.groupValue === "appsec")!;
    expect(appsec.controlIds).toEqual(["A-001", "A-002"]);
  });

  it("groupBy:'controlId' produces one batch per control", () => {
    const drafts = expandPlan(plan({ groupBy: "controlId" }), controls, profile, []);
    expect(drafts.map((d) => d.groupValue).sort()).toEqual(["A-001", "A-002", "B-001"]);
    expect(drafts.every((d) => d.controlIds.length === 1)).toBe(true);
  });
});

describe("expandPlan — selection filters", () => {
  it("selection.domains narrows to matching domains only", () => {
    const drafts = expandPlan(plan({ selection: { domains: ["appsec"] } }), controls, profile, []);
    expect(drafts.map((d) => d.groupValue)).toEqual(["appsec"]);
  });

  it("selection.controlIds narrows to matching controls only", () => {
    const drafts = expandPlan(plan({ selection: { controlIds: ["B-001"] } }), controls, profile, []);
    expect(drafts).toEqual([{ groupBy: "domain", groupValue: "infra", controlIds: ["B-001"] }]);
  });

  it("selection.assessmentStatuses filters by current status, defaulting missing assessments to NOT_TESTED", () => {
    const assessments: AssessmentStatusInput[] = [{ controlId: "A-001", status: "FAIL" }];
    const drafts = expandPlan(plan({ selection: { assessmentStatuses: ["FAIL"] } }), controls, profile, assessments);
    expect(drafts).toEqual([{ groupBy: "domain", groupValue: "appsec", controlIds: ["A-001"] }]);
  });

  it("selection.applicability filters by resolved applicability verdict against the profile", () => {
    const unknownProfile: ProjectProfile = { ...profile, identities: undefined };
    const controlsWithUnknown: PlanControl[] = [
      { ...controls[0], applicability: { when: { fact: "identities", operator: "contains", value: "admin" } } },
    ];
    const drafts = expandPlan(plan({ selection: { applicability: ["unknown"] } }), controlsWithUnknown, unknownProfile, []);
    expect(drafts).toEqual([{ groupBy: "domain", groupValue: "appsec", controlIds: ["A-002"] }]);
  });
});

describe("expandPlan — groupOverrides", () => {
  it("skip:true on a groupValue produces no batch for that group", () => {
    const drafts = expandPlan(plan({ groupOverrides: [{ groupValue: "infra", skip: true }] }), controls, profile, []);
    expect(drafts.map((d) => d.groupValue)).toEqual(["appsec"]);
  });

  it("maxParallelAgents on a groupValue is applied only to that group's batch", () => {
    const drafts = expandPlan(plan({ groupOverrides: [{ groupValue: "appsec", maxParallelAgents: 5 }] }), controls, profile, []);
    const appsec = drafts.find((d) => d.groupValue === "appsec")!;
    const infra = drafts.find((d) => d.groupValue === "infra")!;
    expect(appsec.maxParallelAgents).toBe(5);
    expect(infra.maxParallelAgents).toBeUndefined();
  });

  it("a duplicate groupOverrides entry for the same groupValue throws rather than picking one silently", () => {
    const p = plan({ groupOverrides: [{ groupValue: "appsec", skip: true }, { groupValue: "appsec", maxParallelAgents: 2 }] });
    expect(() => expandPlan(p, controls, profile, [])).toThrow();
  });

  it("an override naming a groupValue with no matching controls after selection is a no-op, not an error", () => {
    const p = plan({ groupOverrides: [{ groupValue: "mobile", skip: true }] });
    const drafts = expandPlan(p, controls, profile, []);
    expect(drafts.map((d) => d.groupValue)).toEqual(["appsec", "infra"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/plan-expander.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/core/plan-expander.ts`:

```ts
import { evaluateApplicability, type ProjectProfile, type RuleNode, type Verdict } from "./applicability.js";

export interface AssessmentPlanSelection {
  applicability?: Verdict[];
  assessmentStatuses?: string[];
  domains?: string[];
  controlIds?: string[];
}

export interface GroupOverride {
  groupValue: string;
  maxParallelAgents?: number;
  skip?: boolean;
}

export interface AssessmentPlan {
  planId: string;
  selection?: AssessmentPlanSelection;
  groupBy: "domain" | "subdomain" | "layer" | "group" | "controlId";
  defaultMaxParallelAgents: number;
  groupOverrides?: GroupOverride[];
}

export interface PlanControl {
  controlId: string;
  domain: string;
  subdomain: string;
  layer: string;
  group: string;
  applicability: { when: RuleNode };
}

export interface AssessmentStatusInput {
  controlId: string;
  status: string;
}

export interface BatchDraft {
  groupBy: string;
  groupValue: string;
  controlIds: string[];
  maxParallelAgents?: number;
}

function groupValueOf(control: PlanControl, groupBy: AssessmentPlan["groupBy"]): string {
  if (groupBy === "controlId") return control.controlId;
  return control[groupBy];
}

export function expandPlan(
  plan: AssessmentPlan,
  controls: PlanControl[],
  profile: ProjectProfile,
  assessments: AssessmentStatusInput[]
): BatchDraft[] {
  let selected = controls;
  const selection = plan.selection ?? {};

  if (selection.controlIds && selection.controlIds.length > 0) {
    const idSet = new Set(selection.controlIds);
    selected = selected.filter((c) => idSet.has(c.controlId));
  }
  if (selection.domains && selection.domains.length > 0) {
    const domainSet = new Set(selection.domains);
    selected = selected.filter((c) => domainSet.has(c.domain));
  }
  if (selection.assessmentStatuses && selection.assessmentStatuses.length > 0) {
    const statusByControl = new Map(assessments.map((a) => [a.controlId, a.status]));
    const statusSet = new Set(selection.assessmentStatuses);
    selected = selected.filter((c) => statusSet.has(statusByControl.get(c.controlId) ?? "NOT_TESTED"));
  }
  if (selection.applicability && selection.applicability.length > 0) {
    const verdictSet = new Set(selection.applicability);
    selected = selected.filter((c) => verdictSet.has(evaluateApplicability(c, profile).autoResult));
  }

  const overrideKeys = new Set<string>();
  for (const override of plan.groupOverrides ?? []) {
    if (overrideKeys.has(override.groupValue)) {
      throw new Error(`expandPlan: duplicate groupOverrides entry for groupValue "${override.groupValue}"`);
    }
    overrideKeys.add(override.groupValue);
  }
  const overridesByGroup = new Map((plan.groupOverrides ?? []).map((o) => [o.groupValue, o]));

  const groups = new Map<string, PlanControl[]>();
  for (const control of selected) {
    const key = groupValueOf(control, plan.groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(control);
  }

  const drafts: BatchDraft[] = [];
  for (const [groupValue, groupControls] of groups) {
    const override = overridesByGroup.get(groupValue);
    if (override?.skip) continue;
    const controlIds = groupControls.map((c) => c.controlId).sort();
    drafts.push({
      groupBy: plan.groupBy,
      groupValue,
      controlIds,
      ...(override?.maxParallelAgents !== undefined ? { maxParallelAgents: override.maxParallelAgents } : {}),
    });
  }

  drafts.sort((a, b) => a.groupValue.localeCompare(b.groupValue));
  return drafts;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/plan-expander.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/plan-expander.ts tests/core/plan-expander.test.ts
git commit -m "feat(core): plan expansion into deterministic batch drafts"
```

---

### Task 5: `src/core/release-evaluator.ts` — Release Gate Evaluation

**Files:**
- Create: `src/core/release-evaluator.ts`
- Test: `tests/core/release-evaluator.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `../validate.js` (Task 5's real-catalog drift-guard test only; the module itself takes no Repository dependency).
- Produces:
  ```ts
  export const RELEASE_GATE_CONTROL_MAP: { readonly incidentResponseVerified: "GOV-IR-001"; readonly backupRestoreVerified: "OPS-BACKUP-TEST-001" };
  export interface ScoreInput { coverage: { coveragePercent: number }; }
  export interface FindingInput { findingId: string; controlIds: string[]; status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive"; severity: "critical" | "high" | "medium" | "low" | "info"; }
  export interface AttackPathInput { result: "blocked" | "possible"; relatedFindingIds: string[]; }
  export interface ControlAssessmentInput { controlId: string; status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK"; }
  export interface ReleaseEvaluation { gate: 4; controlCoverage: number; criticalFindings: number; highFindings: number; unblockedCriticalAttackPaths: number; residualRisksAccepted: number; incidentResponseVerified: boolean; backupRestoreVerified: boolean; result: "approved" | "blocked"; }
  export function evaluateRelease(inputs: { score: ScoreInput; findings: FindingInput[]; attackPaths: AttackPathInput[]; assessments: ControlAssessmentInput[]; securityLevel: string }): ReleaseEvaluation;
  ```

- [ ] **Step 1: Write the failing tests — thresholds, verified-flags, and the SVL-2 accepted-risk exception**

Create `tests/core/release-evaluator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateRelease,
  RELEASE_GATE_CONTROL_MAP,
  type AttackPathInput,
  type ControlAssessmentInput,
  type FindingInput,
  type ScoreInput,
} from "../../src/core/release-evaluator.js";

const score: ScoreInput = { coverage: { coveragePercent: 92 } };

function baseInputs(overrides: Partial<Parameters<typeof evaluateRelease>[0]> = {}) {
  return {
    score,
    findings: [] as FindingInput[],
    attackPaths: [] as AttackPathInput[],
    assessments: [] as ControlAssessmentInput[],
    securityLevel: "SVL-3",
    ...overrides,
  };
}

describe("evaluateRelease — securityLevel precondition", () => {
  it("throws for SVL-0 (gate 4 has no defined threshold row for it)", () => {
    expect(() => evaluateRelease(baseInputs({ securityLevel: "SVL-0" }))).toThrow();
  });

  it("throws for SVL-1", () => {
    expect(() => evaluateRelease(baseInputs({ securityLevel: "SVL-1" }))).toThrow();
  });
});

describe("evaluateRelease — thresholds", () => {
  it("SVL-3, zero critical and zero high findings -> approved", () => {
    expect(evaluateRelease(baseInputs()).result).toBe("approved");
  });

  it("SVL-3, one open critical finding -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical" }];
    const result = evaluateRelease(baseInputs({ findings }));
    expect(result.criticalFindings).toBe(1);
    expect(result.result).toBe("blocked");
  });

  it("a resolved critical finding does not count toward criticalFindings or block the release", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "resolved", severity: "critical" }];
    const result = evaluateRelease(baseInputs({ findings }));
    expect(result.criticalFindings).toBe(0);
    expect(result.result).toBe("approved");
  });

  it("SVL-3, one open high finding -> blocked, even with an accepted-risk assessment on its control (no exception at SVL-3)", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }];
    expect(evaluateRelease(baseInputs({ findings, assessments })).result).toBe("blocked");
  });

  it("SVL-2, one open high finding uncovered by any accepted risk -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high" }];
    expect(evaluateRelease(baseInputs({ findings, securityLevel: "SVL-2" })).result).toBe("blocked");
  });

  it("SVL-2, one open high finding whose only control has an ACCEPTED_RISK assessment -> approved (the exception)", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "high" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }];
    const result = evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" }));
    expect(result.highFindings).toBe(1); // the raw count is unaffected by the exception
    expect(result.result).toBe("approved");
  });

  it("SVL-2, a high finding with two controlIds where only one has ACCEPTED_RISK is NOT covered -> blocked", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001", "X-002"], status: "open", severity: "high" }];
    const assessments: ControlAssessmentInput[] = [{ controlId: "X-001", status: "ACCEPTED_RISK" }, { controlId: "X-002", status: "FAIL" }];
    expect(evaluateRelease(baseInputs({ findings, assessments, securityLevel: "SVL-2" })).result).toBe("blocked");
  });
});

describe("evaluateRelease — incidentResponseVerified / backupRestoreVerified", () => {
  it("true only when the mapped control's assessment status is PASS", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: RELEASE_GATE_CONTROL_MAP.incidentResponseVerified, status: "PASS" },
      { controlId: RELEASE_GATE_CONTROL_MAP.backupRestoreVerified, status: "FAIL" },
    ];
    const result = evaluateRelease(baseInputs({ assessments }));
    expect(result.incidentResponseVerified).toBe(true);
    expect(result.backupRestoreVerified).toBe(false);
  });

  it("false when no assessment exists for the mapped control at all", () => {
    const result = evaluateRelease(baseInputs());
    expect(result.incidentResponseVerified).toBe(false);
    expect(result.backupRestoreVerified).toBe(false);
  });
});

describe("evaluateRelease — unblockedCriticalAttackPaths / residualRisksAccepted", () => {
  it("counts a possible attack path only when it relates to a critical finding", () => {
    const findings: FindingInput[] = [{ findingId: "F-1", controlIds: ["X-001"], status: "open", severity: "critical" }];
    const attackPaths: AttackPathInput[] = [
      { result: "possible", relatedFindingIds: ["F-1"] },
      { result: "blocked", relatedFindingIds: ["F-1"] },
      { result: "possible", relatedFindingIds: ["F-nonexistent"] },
    ];
    const result = evaluateRelease(baseInputs({ findings, attackPaths }));
    expect(result.unblockedCriticalAttackPaths).toBe(1);
  });

  it("counts ACCEPTED_RISK assessments as residualRisksAccepted", () => {
    const assessments: ControlAssessmentInput[] = [
      { controlId: "X-001", status: "ACCEPTED_RISK" },
      { controlId: "X-002", status: "ACCEPTED_RISK" },
      { controlId: "X-003", status: "PASS" },
    ];
    expect(evaluateRelease(baseInputs({ assessments })).residualRisksAccepted).toBe(2);
  });
});

describe("evaluateRelease — controlCoverage", () => {
  it("passes through score.coverage.coveragePercent without recomputation", () => {
    expect(evaluateRelease(baseInputs()).controlCoverage).toBe(92);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/core/release-evaluator.ts`:

```ts
export const RELEASE_GATE_CONTROL_MAP = {
  incidentResponseVerified: "GOV-IR-001",
  backupRestoreVerified: "OPS-BACKUP-TEST-001",
} as const;

export interface ScoreInput {
  coverage: { coveragePercent: number };
}

export interface FindingInput {
  findingId: string;
  controlIds: string[];
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  severity: "critical" | "high" | "medium" | "low" | "info";
}

export interface AttackPathInput {
  result: "blocked" | "possible";
  relatedFindingIds: string[];
}

export interface ControlAssessmentInput {
  controlId: string;
  status: "PASS" | "FAIL" | "PARTIAL" | "N/A" | "NOT_TESTED" | "ACCEPTED_RISK";
}

export interface ReleaseEvaluation {
  gate: 4;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  result: "approved" | "blocked";
}

export function evaluateRelease(inputs: {
  score: ScoreInput;
  findings: FindingInput[];
  attackPaths: AttackPathInput[];
  assessments: ControlAssessmentInput[];
  securityLevel: string;
}): ReleaseEvaluation {
  const { score, findings, attackPaths, assessments, securityLevel } = inputs;

  if (securityLevel !== "SVL-2" && securityLevel !== "SVL-3") {
    throw new Error(
      `evaluateRelease: gate 4 (production_release) has no defined threshold for securityLevel "${securityLevel}" — only SVL-2/SVL-3 are covered by data/process/release-gates.json`
    );
  }

  const activeFindings = findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const activeCritical = activeFindings.filter((f) => f.severity === "critical");
  const activeHigh = activeFindings.filter((f) => f.severity === "high");
  const criticalFindings = activeCritical.length;
  const highFindings = activeHigh.length;

  const criticalFindingIds = new Set(activeCritical.map((f) => f.findingId));
  const unblockedCriticalAttackPaths = attackPaths.filter(
    (ap) => ap.result === "possible" && ap.relatedFindingIds.some((id) => criticalFindingIds.has(id))
  ).length;

  const residualRisksAccepted = assessments.filter((a) => a.status === "ACCEPTED_RISK").length;

  const assessmentByControl = new Map(assessments.map((a) => [a.controlId, a.status]));
  const incidentResponseVerified = assessmentByControl.get(RELEASE_GATE_CONTROL_MAP.incidentResponseVerified) === "PASS";
  const backupRestoreVerified = assessmentByControl.get(RELEASE_GATE_CONTROL_MAP.backupRestoreVerified) === "PASS";

  const uncoveredHigh = activeHigh.filter(
    (f) => !(f.controlIds.length > 0 && f.controlIds.every((id) => assessmentByControl.get(id) === "ACCEPTED_RISK"))
  );
  const highFindingsSatisfied = securityLevel === "SVL-3" ? highFindings === 0 : uncoveredHigh.length === 0;

  const result: "approved" | "blocked" = criticalFindings === 0 && highFindingsSatisfied ? "approved" : "blocked";

  return {
    gate: 4,
    controlCoverage: score.coverage.coveragePercent,
    criticalFindings,
    highFindings,
    unblockedCriticalAttackPaths,
    residualRisksAccepted,
    incidentResponseVerified,
    backupRestoreVerified,
    result,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/release-evaluator.ts tests/core/release-evaluator.test.ts
git commit -m "feat(core): release gate 4 evaluation"
```

- [ ] **Step 6: Write the real-catalog drift guard test for RELEASE_GATE_CONTROL_MAP**

Append to `tests/core/release-evaluator.test.ts`:

```ts
import { loadJson } from "../../src/validate.js";

describe("evaluateRelease — RELEASE_GATE_CONTROL_MAP drift guard", () => {
  it("both mapped controlIds exist in the real catalog and are not replacedBy-superseded", () => {
    const manifest = loadJson<{ controls: { files: string[] } }>("data/manifest.json");
    const allControls = manifest.controls.files.flatMap((f) =>
      loadJson<{ controlId: string; replacedBy?: string }[]>(`data/${f}`)
    );
    const byId = new Map(allControls.map((c) => [c.controlId, c]));

    for (const controlId of Object.values(RELEASE_GATE_CONTROL_MAP)) {
      const control = byId.get(controlId);
      expect(control, `RELEASE_GATE_CONTROL_MAP references unknown controlId "${controlId}"`).toBeDefined();
      expect(control?.replacedBy, `RELEASE_GATE_CONTROL_MAP's "${controlId}" has been superseded by "${control?.replacedBy}"`).toBeUndefined();
    }
  });
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/core/release-evaluator.test.ts`
Expected: PASS (15 tests total) — this passes immediately against the real catalog as of this plan's writing (`GOV-IR-001`/`OPS-BACKUP-TEST-001` both exist, neither is superseded); it exists to fail loudly if that ever changes.

- [ ] **Step 8: Commit**

```bash
git add tests/core/release-evaluator.test.ts
git commit -m "test(core): RELEASE_GATE_CONTROL_MAP drift guard against real catalog"
```

---

### Task 6: `src/core/report-builder.ts` — Report Assembly

**Files:**
- Create: `src/core/report-builder.ts`
- Test: `tests/core/report-builder.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (takes already-computed `Score`/`ReleaseEvaluation` shapes as its own minimal projections — it never imports or calls `calculateScore`/`evaluateRelease`).
- Produces:
  ```ts
  export interface PrioritizedFindingInput { findingId: string; priorityIndex: number; criticalityIndex: number; title: string; }
  export function sortPrioritizedFindings(findings: PrioritizedFindingInput[]): PrioritizedFindingInput[];
  export interface FindingForReport { findingId: string; title: string; status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive"; priority: { index: number }; criticality: { index: number }; }
  export interface ScoreForReport { overallScore: number; coverage: { applicableControls: number; assessedControls: number; coveragePercent: number }; scoreModel: { id: string; version: string }; domainScores: unknown[]; }
  export interface ReleaseEvaluationForReport { gate: number; controlCoverage: number; criticalFindings: number; highFindings: number; unblockedCriticalAttackPaths: number; residualRisksAccepted: number; incidentResponseVerified: boolean; backupRestoreVerified: boolean; result: "approved" | "blocked"; }
  export interface ProjectReport { reportId: string; projectId: string; assessmentRunId: string; catalogVersion: string; profileRevision: number; criticalityFormula: { id: string; version: string }; generatedAt: string; score: ScoreForReport; prioritizedFindings: PrioritizedFindingInput[]; releaseEvaluation: ReleaseEvaluationForReport; summary: string; }
  export function buildReport(input: { reportId: string; run: { runId: string; projectId: string; catalogVersion: string; profileRevision: number }; criticalityFormula: { id: string; version: string }; generatedAt: () => string; score: ScoreForReport; findings: FindingForReport[]; releaseEvaluation: ReleaseEvaluationForReport; summary: string }): ProjectReport;
  ```
  (`reportId`/`summary` as required caller-supplied inputs — see this plan's Design Rulings, item 5.)

- [ ] **Step 1: Write the failing tests — sortPrioritizedFindings**

Create `tests/core/report-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortPrioritizedFindings, type PrioritizedFindingInput } from "../../src/core/report-builder.js";

describe("sortPrioritizedFindings", () => {
  it("sorts by priorityIndex ascending", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-2", priorityIndex: 5, criticalityIndex: 0, title: "b" },
      { findingId: "F-1", priorityIndex: 1, criticalityIndex: 0, title: "a" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-1", "F-2"]);
  });

  it("breaks a priorityIndex tie by criticalityIndex descending", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-low", priorityIndex: 1, criticalityIndex: 3, title: "low" },
      { findingId: "F-high", priorityIndex: 1, criticalityIndex: 9, title: "high" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-high", "F-low"]);
  });

  it("breaks a priorityIndex+criticalityIndex tie by findingId ascending, guaranteeing a deterministic total order", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-Z", priorityIndex: 2, criticalityIndex: 7, title: "z" },
      { findingId: "F-A", priorityIndex: 2, criticalityIndex: 7, title: "a" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-A", "F-Z"]);
  });

  it("does not mutate the input array", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-2", priorityIndex: 5, criticalityIndex: 0, title: "b" },
      { findingId: "F-1", priorityIndex: 1, criticalityIndex: 0, title: "a" },
    ];
    const original = [...findings];
    sortPrioritizedFindings(findings);
    expect(findings).toEqual(original);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `sortPrioritizedFindings` and the type scaffolding**

Create `src/core/report-builder.ts`:

```ts
export interface PrioritizedFindingInput {
  findingId: string;
  priorityIndex: number;
  criticalityIndex: number;
  title: string;
}

export function sortPrioritizedFindings(findings: PrioritizedFindingInput[]): PrioritizedFindingInput[] {
  return [...findings].sort(
    (a, b) => a.priorityIndex - b.priorityIndex || b.criticalityIndex - a.criticalityIndex || a.findingId.localeCompare(b.findingId)
  );
}

export interface FindingForReport {
  findingId: string;
  title: string;
  status: "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
  priority: { index: number };
  criticality: { index: number };
}

export interface ScoreForReport {
  overallScore: number;
  coverage: { applicableControls: number; assessedControls: number; coveragePercent: number };
  scoreModel: { id: string; version: string };
  domainScores: unknown[];
}

export interface ReleaseEvaluationForReport {
  gate: number;
  controlCoverage: number;
  criticalFindings: number;
  highFindings: number;
  unblockedCriticalAttackPaths: number;
  residualRisksAccepted: number;
  incidentResponseVerified: boolean;
  backupRestoreVerified: boolean;
  result: "approved" | "blocked";
}

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
  releaseEvaluation: ReleaseEvaluationForReport;
  summary: string;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/report-builder.ts tests/core/report-builder.test.ts
git commit -m "feat(core): prioritized findings sort"
```

- [ ] **Step 6: Write the failing tests — buildReport assembly and finding-status filtering**

Append to `tests/core/report-builder.test.ts`:

```ts
import { buildReport, type FindingForReport, type ReleaseEvaluationForReport, type ScoreForReport } from "../../src/core/report-builder.js";

const score: ScoreForReport = {
  overallScore: 80,
  coverage: { applicableControls: 10, assessedControls: 8, coveragePercent: 80 },
  scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
  domainScores: [],
};

const releaseEvaluation: ReleaseEvaluationForReport = {
  gate: 4, controlCoverage: 80, criticalFindings: 0, highFindings: 0,
  unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0,
  incidentResponseVerified: true, backupRestoreVerified: true, result: "approved",
};

const run = { runId: "RUN-1", projectId: "PRJ-1", catalogVersion: "1.0.0", profileRevision: 1 };

describe("buildReport", () => {
  it("pins projectId/assessmentRunId/catalogVersion/profileRevision from the run input", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.projectId).toBe("PRJ-1");
    expect(report.assessmentRunId).toBe("RUN-1");
    expect(report.catalogVersion).toBe("1.0.0");
    expect(report.profileRevision).toBe(1);
  });

  it("passes score and releaseEvaluation through unchanged rather than recomputing them", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
    });
    expect(report.score).toEqual(score);
    expect(report.releaseEvaluation).toEqual(releaseEvaluation);
  });

  it("includes only open/in_progress findings in prioritizedFindings, dropping resolved/accepted/false_positive", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-open", title: "open one", status: "open", priority: { index: 1 }, criticality: { index: 5 } },
      { findingId: "F-progress", title: "in progress one", status: "in_progress", priority: { index: 2 }, criticality: { index: 5 } },
      { findingId: "F-resolved", title: "resolved one", status: "resolved", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-accepted", title: "accepted one", status: "accepted", priority: { index: 0 }, criticality: { index: 9 } },
      { findingId: "F-fp", title: "false positive", status: "false_positive", priority: { index: 0 }, criticality: { index: 9 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect(report.prioritizedFindings.map((f) => f.findingId)).toEqual(["F-open", "F-progress"]);
  });

  it("projects findings to the prioritizedFindings summary shape and sorts them", () => {
    const findings: FindingForReport[] = [
      { findingId: "F-low", title: "low priority", status: "open", priority: { index: 5 }, criticality: { index: 5 } },
      { findingId: "F-high", title: "high priority", status: "open", priority: { index: 1 }, criticality: { index: 5 } },
    ];
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings, releaseEvaluation, summary: "ok",
    });
    expect(report.prioritizedFindings).toEqual([
      { findingId: "F-high", priorityIndex: 1, criticalityIndex: 5, title: "high priority" },
      { findingId: "F-low", priorityIndex: 5, criticalityIndex: 5, title: "low priority" },
    ]);
  });

  it("stamps generatedAt from the injected function and carries reportId/criticalityFormula/summary through", () => {
    const report = buildReport({
      reportId: "REP-42", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "2.0.0" },
      generatedAt: () => "2026-09-28T12:00:00.000Z", score, findings: [], releaseEvaluation, summary: "all clear",
    });
    expect(report.reportId).toBe("REP-42");
    expect(report.generatedAt).toBe("2026-09-28T12:00:00.000Z");
    expect(report.criticalityFormula).toEqual({ id: "CRIT-DEFAULT", version: "2.0.0" });
    expect(report.summary).toBe("all clear");
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: FAIL — `buildReport` is not exported yet

- [ ] **Step 8: Implement `buildReport`**

Append to `src/core/report-builder.ts`:

```ts
export function buildReport(input: {
  reportId: string;
  run: { runId: string; projectId: string; catalogVersion: string; profileRevision: number };
  criticalityFormula: { id: string; version: string };
  generatedAt: () => string;
  score: ScoreForReport;
  findings: FindingForReport[];
  releaseEvaluation: ReleaseEvaluationForReport;
  summary: string;
}): ProjectReport {
  const actionable = input.findings.filter((f) => f.status === "open" || f.status === "in_progress");
  const projected: PrioritizedFindingInput[] = actionable.map((f) => ({
    findingId: f.findingId,
    priorityIndex: f.priority.index,
    criticalityIndex: f.criticality.index,
    title: f.title,
  }));

  return {
    reportId: input.reportId,
    projectId: input.run.projectId,
    assessmentRunId: input.run.runId,
    catalogVersion: input.run.catalogVersion,
    profileRevision: input.run.profileRevision,
    criticalityFormula: input.criticalityFormula,
    generatedAt: input.generatedAt(),
    score: input.score,
    prioritizedFindings: sortPrioritizedFindings(projected),
    releaseEvaluation: input.releaseEvaluation,
    summary: input.summary,
  };
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS (9 tests total)

- [ ] **Step 10: Commit**

```bash
git add src/core/report-builder.ts tests/core/report-builder.test.ts
git commit -m "feat(core): report assembly with finding-status filtering"
```

---

### Task 7: `src/core/repository.ts` — Data Access Abstraction

**Files:**
- Create: `src/core/repository.ts`
- Test: `tests/core/repository.test.ts`

**Interfaces:**
- Consumes: `loadJson` from `../validate.js`; `type PlanControl` (aliased `Control`) and `type AssessmentPlan` from `./plan-expander.js` (Task 4); `type CriticalityFormula` from `./criticality.js` (Task 2); `type ScoreModel` from `./score.js` (Task 3); `type ProjectReport` from `./report-builder.js` (Task 6).
- Produces:
  ```ts
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
  export class JsonRepository implements SecurityRepository { constructor(dataDir?: string); /* ...methods above */ }
  ```
  File layout: see this plan's Design Rulings, item 6.

- [ ] **Step 1: Write the failing tests — catalog reads against the real `data/` tree**

Create `tests/core/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JsonRepository } from "../../src/core/repository.js";

describe("JsonRepository — catalog reads (real data/ tree)", () => {
  const repo = new JsonRepository("data");

  it("getControls returns all 48 real controls", async () => {
    const controls = await repo.getControls();
    expect(controls.length).toBe(48);
  });

  it("getThreats returns the real threat catalog", async () => {
    const threats = await repo.getThreats();
    expect(threats.length).toBeGreaterThan(0);
  });

  it("getCriticalityFormula returns the real formula for its own id", async () => {
    const formula = await repo.getCriticalityFormula("CRIT-DEFAULT");
    expect(formula.weights.impact).toBe(0.35);
  });

  it("getCriticalityFormula throws for an unknown formulaId", async () => {
    await expect(repo.getCriticalityFormula("NOPE")).rejects.toThrow();
  });

  it("getScoreModel returns the real model for its own id", async () => {
    const model = await repo.getScoreModel("USSVS-SCORE-DEFAULT");
    expect(model.statusWeights.PASS).toBe(1.0);
  });

  it("getScoreModel throws for an unknown modelId", async () => {
    await expect(repo.getScoreModel("NOPE")).rejects.toThrow();
  });

  it("getReleaseGates returns gate 4's requiresByLevel thresholds", async () => {
    const gates = await repo.getReleaseGates();
    const gate4 = gates.gates.find((g) => g.gate === 4);
    expect(gate4?.requiresByLevel?.["SVL-3"]).toEqual({ criticalFindings: 0, highFindings: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the catalog-read methods**

Create `src/core/repository.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/repository.ts tests/core/repository.test.ts
git commit -m "feat(core): SecurityRepository catalog reads"
```

- [ ] **Step 6: Write tests — project-instance read/write against a temp directory, and atomic-write behavior**

Append to `tests/core/repository.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import type { AssessmentBatch, AssessmentRun } from "../../src/core/repository.js";
import type { ProjectReport } from "../../src/core/report-builder.js";
import type { AssessmentPlan } from "../../src/core/plan-expander.js";

describe("JsonRepository — project-instance read/write (temp data/ tree)", () => {
  let dir: string;
  let repo: JsonRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csi-mcp-repo-"));
    repo = new JsonRepository(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("getControlAssessments returns [] for a project with no assessments.json yet", async () => {
    expect(await repo.getControlAssessments("PRJ-1")).toEqual([]);
  });

  it("getFindings returns [] for a project with no findings.json yet", async () => {
    expect(await repo.getFindings("PRJ-1")).toEqual([]);
  });

  it("saveRun then reload round-trips the AssessmentRun", async () => {
    const run: AssessmentRun = { runId: "RUN-1", projectId: "PRJ-1", status: "pending" };
    await repo.saveRun(run);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "runs", "RUN-1.json")));
    expect(reloaded).toEqual(run);
  });

  it("saveBatch then reload round-trips the AssessmentBatch", async () => {
    const batch: AssessmentBatch = { batchId: "BATCH-1", projectId: "PRJ-1", status: "pending" };
    await repo.saveBatch(batch);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "batches", "BATCH-1.json")));
    expect(reloaded).toEqual(batch);
  });

  it("saveReport then reload round-trips the ProjectReport", async () => {
    const report = {
      reportId: "REP-1", projectId: "PRJ-1", assessmentRunId: "RUN-1", catalogVersion: "1.0.0", profileRevision: 1,
      criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" }, generatedAt: "2026-09-28T00:00:00.000Z",
      score: { overallScore: 80, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "M", version: "1" }, domainScores: [] },
      prioritizedFindings: [], releaseEvaluation: { gate: 4, controlCoverage: 100, criticalFindings: 0, highFindings: 0, unblockedCriticalAttackPaths: 0, residualRisksAccepted: 0, incidentResponseVerified: true, backupRestoreVerified: true, result: "approved" as const },
      summary: "ok",
    } satisfies ProjectReport;
    await repo.saveReport(report);
    const reloaded = JSON.parse(readFileSyncUtf8(join(dir, "projects", "PRJ-1", "reports", "REP-1.json")));
    expect(reloaded).toEqual(report);
  });

  it("saveRun does not leave a .tmp-* file behind after a successful write", async () => {
    await repo.saveRun({ runId: "RUN-1", projectId: "PRJ-1", status: "pending" });
    const files = readdirSync(join(dir, "projects", "PRJ-1", "runs"));
    expect(files).toEqual(["RUN-1.json"]);
  });

  it("getPlan reads a flat data/plans/<planId>.json file", async () => {
    mkdirSync(join(dir, "plans"), { recursive: true });
    const plan: AssessmentPlan = { planId: "PLAN-1", groupBy: "domain", defaultMaxParallelAgents: 1 };
    writeFileSync(join(dir, "plans", "PLAN-1.json"), JSON.stringify(plan));
    expect(await repo.getPlan("PLAN-1")).toEqual(plan);
  });
});

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf-8");
}
```

- [ ] **Step 7: Run to verify it passes (implementation from Step 3 already covers this)**

Run: `npx vitest run tests/core/repository.test.ts`
Expected: PASS (14 tests total).

- [ ] **Step 8: Commit**

```bash
git add tests/core/repository.test.ts
git commit -m "test(core): repository project-instance round-trip and atomic-write"
```

- [ ] **Step 9: Run the full suite and confirm zero regressions**

Run: `npm test`
Expected: PASS — every prior test (154 as of this plan's writing, across 31 files) plus every new `tests/core/*.test.ts` file added by this plan (7 files, 88 new tests: 23+7+9+11+15+9+14) passes together.

- [ ] **Step 10: Commit (if Step 9 required any fix)**

```bash
git add -A
git commit -m "fix(core): resolve full-suite regression found in final verification"
```

(Skip this step entirely if Step 9 was already green with no changes.)

---

## Self-Review Notes

Run against the spec (`docs/superpowers/specs/2026-09-28-core-engine-design.md`) after writing this plan:

- **§2 (pure functions, no shared types.ts, no Repository param):** satisfied by every Task 1–6 module; verified no function signature in Tasks 1–6 takes a `SecurityRepository`.
- **§3 (Kleene composition, boundary conditions, worked example):** Task 1 covers leaf evaluation, the full truth table, the nested case, both directions of the spec's own worked example (asserting exact `matchedRules` values), the empty-array note, and the 48-control compatibility smoke test.
- **§4 (criticality normalization/rounding):** Task 2 covers both directions (`higher_is_worse`/`lower_is_worse`), all three rounding modes, and the 0/9 boundary values.
- **§5 (score formula, zero-denominator, unresolved-applicability):** Task 3 covers the overall formula, the NOT_TESTED-isn't-100% case, exclusion handling, the zero-denominator domain omission, and Finding cross-referencing for `criticalFindings`/`highFindings`.
- **§6 (BatchDraft return type, determinism rules):** Task 4 covers grouping, all four `selection` filters, `skip`, `maxParallelAgents`, duplicate-override rejection, and the no-op-on-unmatched-override rule.
- **§7 (fixed two-valued result, SVL-0/1 precondition, RELEASE_GATE_CONTROL_MAP drift guard):** Task 5 covers both thresholds, both verified flags, attack-path/residual-risk counting, the SVL-2 accepted-risk exception (with the plan's own precise per-finding definition), and the real-catalog drift test.
- **§8 (finding-status filtering, no recomputation):** Task 6 covers `sortPrioritizedFindings`'s three-level sort, the open/in_progress inclusion filter, and confirms `score`/`releaseEvaluation` pass through unchanged.
- **§9 (SecurityRepository, JsonRepository):** Task 7 implements every method in the spec's interface, with the two documented layout rulings (item 6) covering what the spec left unspecified.
- **§10 (testing strategy):** the truth-table suite and the compatibility smoke test are both in Task 1 as their own dedicated steps, distinct from each other and from the (still out-of-scope, unimplemented) full E2E assessment.
- **§11 (out of scope):** this plan does not touch the MCP tool/handler layer, agent orchestration, or `SqliteRepository` — confirmed no task references any of them.

No placeholder steps, no "TBD"/"add appropriate handling" text, no forward references to undefined types — every code block above is complete, and every type used in a later task's interface section is defined in an earlier task or in that same task's own implementation step.
