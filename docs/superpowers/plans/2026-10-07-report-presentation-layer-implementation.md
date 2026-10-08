# Report Presentation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine judgment already captured in `ControlAssessment`/`Evidence`/`RiskAcceptance` legible to a human reader (a project's security officer) by projecting it into `ProjectReport` and rendering a self-contained, zero-network HTML report — closing the "good canonical JSON artifact, poor first screen" gap external review found, without the presentation layer inventing any new engine judgment.

**Architecture:** Three layers, matching the spec's own structure. (1) `ProjectReport` grows to schema `2.1.0`: `projectName`, run-scoped `runControlAssessmentSnapshots[]` (mirroring `report-fidelity`'s `projectFindingSnapshots` pattern, but scoped to this report's single `assessmentRunId`), referenced-only `evidenceSnapshots[]`/`riskAcceptanceSnapshots[]`, and a fixed-key `assessmentScopes` object that makes the project-scoped-vs-run-scoped split machine-readable (Tasks 1–2). (2) A new pure function `buildPresentationModel(report, opts)` projects `ProjectReport` into a display-ready `PresentationModel` — selection, aggregation, and reverse-reference only, never new judgment — computing `referenceIntegrity` (dangling-reference tracking) and `limitations[]` along the way (Task 3). (3) A new `generate_report_html` MCP tool renders `PresentationModel` into one self-contained HTML file: a semantic-table-first Control Matrix, progressive-disclosure finding cards, vendored-and-inlined D3 used for the Priority×Criticality scatter (the spec's optional Control Matrix mini-heatmap is **not** implemented in this plan — see Task 4's scope note), strict escaping discipline, and a zero-network CSP (Task 4) — wired alongside a `generate_report` → `generate_report_data` rename (Task 5) and backed by a security/accessibility/determinism test suite (Task 6).

**Tech Stack:** TypeScript (ESM, `NodeNext`-style `.js` import specifiers), Vitest, Ajv (JSON Schema draft 2020-12, `additionalProperties: false` throughout), Zod (MCP tool input validation) — same stack as the rest of this repo. New for this cycle: **jsdom** (devDependency, Task 6 — real DOM + inline-`<script>` execution for the XSS and zero-network tests; no `vitest.config.ts` environment change needed, since tests construct a `JSDOM` instance directly rather than switching the global test environment). Vendored **D3 v7** as a static asset file (Task 4 — downloaded once into the repo, never fetched from a CDN at runtime or at report-view time).

**Spec:** `docs/superpowers/specs/2026-10-07-report-presentation-layer-design.md`

**Decomposition note (deviation from the spec-review brief's suggested split, decided during this plan's own file-structure pass):** the brief's suggested Task 2 bundled "Evidence/RiskAcceptance snapshots" together with "the `referenceIntegrity` structure in §4." Having now read the finished spec in full, `referenceIntegrity` is a `PresentationModel` field (§4), computed by `buildPresentationModel` — it is never stored in the `ProjectReport` JSON itself. This plan's Task 2 is therefore `ProjectReport`-only (`evidenceSnapshots[]`/`riskAcceptanceSnapshots[]`/`assessmentScopes`, all three completed together since `AssessmentScopes`'s 6 keys only make sense once every snapshot array they describe exists), and `referenceIntegrity` moves into Task 3 where the spec actually defines it. This keeps each task's type definitions self-contained rather than reopening the same TypeScript interface across two tasks' files.

## Global Constraints

- `buildPresentationModel(report: ProjectReport, opts: { rendererVersion: string; rendererRenderedAt: string; sourceReportSha256: string })` is a **pure function** — those two parameters are its only inputs. No `Date.now()`, no `package.json` read, no live `getControls()` catalog read, no filesystem access of any kind inside this function or anything it calls.
- `ControlAssessmentSnapshot.title`/`.domain` are `null` (never backfilled with the current catalog's values) whenever the `(controlId, controlVersion)` exact-match catalog join fails. No `currentCatalogTitle` convenience field exists anywhere in this codebase — it was removed during spec review for violating the pure-function invariant above.
- `recordedStatus` and `effectiveStatus` on every `ControlAssessmentSnapshot` come from the **same single fetch-and-normalize pass**: one `getControlAssessments(projectId)` call, one `translateAssessmentsForTrust` call. The identical discipline applies to `RiskAcceptance`: the records `translateAssessmentsForTrust` uses internally and the records projected into `riskAcceptanceSnapshots[]` come from the same single loaded `RiskAcceptance` set — never two independent fetches.
- `effectiveStatusReason` is `null` when `recordedStatus === effectiveStatus` — there is no `"unchanged"` enum value. Two representations of "no reason" (a null field and a sentinel enum value) is the exact ambiguity this spec exists to eliminate; it is not reintroduced here.
- `assessmentScopes` is a **fixed-key TypeScript interface**, never a generic array — `score`/`releaseEvaluation` carry `contributingRunIds: string[]` (the distinct, sorted `runId`s actually present in the normalized assessment set that fed `calculateScore`/`evaluateRelease`), since `ControlAssessment` is project-scoped and can span more than one `AssessmentRun` per project.
- `PresentationModel.findings` contains **every** `projectFindingSnapshots` entry, not just the prioritized subset — nothing is dropped from the data model, even though the HTML's default view surfaces prioritized findings first.
- **No new tie-break or ranking logic** anywhere in `buildPresentationModel`. `prioritizedFindings`'s existing order is preserved exactly for the subset it covers; only the *remaining* `projectFindingSnapshots` entries (not in `prioritizedFindings`) get a new, explicit sort key (`findingId` ascending) — and that sort key only governs findings `ProjectReport` itself never ordered.
- `ControlRow` keeps **both** raw reference ids (`evidenceIds`, `riskAcceptanceId`, `findingIds`) **and** resolved views (`evidence[]`, `riskAcceptance`) side by side — never only the resolved view. A resolved-only field cannot distinguish "never referenced anything" from "referenced something missing."
- Server-side HTML string assembly uses named escaping functions (`escapeHtmlText()`, `escapeHtmlAttribute()`) — never `textContent`/`innerHTML`, which are DOM APIs that do not exist in a Node.js string-building context with no live DOM. Client-side inline-`<script>` code (D3, the JS the browser actually runs) legitimately uses `textContent`/D3's `.text()`.
- **Zero network at view time:** D3 is vendored and inlined into the generated HTML file, never CDN-loaded, either at report-generation time or at report-viewing time. The CSP meta tag in §8.2 of the spec is included verbatim.
- `generate_report_html` rejects (a `PRECONDITION_FAILED` `ServiceError`) any `ProjectReport` whose `reportSchemaVersion !== "2.1.0"` — no partial-rendering fallback for legacy `2.0.0` reports.
- `ReportService.generateHtml` reads the source `ProjectReport` JSON file's raw bytes exactly **once** and uses that same buffer for both purposes that need it: `createHash("sha256")` for `sourceReportSha256`, and `JSON.parse(buffer.toString("utf-8"))` for the `ProjectReport` object passed into `buildPresentationModel`. Never a second file read, and never computing the hash from a re-`JSON.stringify`'d object (that would hash different bytes than the file actually contains).
- The `generate_report` → `generate_report_data` rename is a breaking MCP tool-name change with **no backwards-compatibility shim**, consistent with this project's established convention (the `criticalFindings`/`highFindings` rename in `report-fidelity`). It requires a repo-wide `rg '\bgenerate_report\b'` sweep of **live** source/tests (never rewriting historical specs/plans/ADRs/CHANGELOG entries that describe already-completed past work) plus a new `CHANGELOG.md` entry and a `package.json` version bump, following the exact precedent of `report-fidelity`'s own `0.9.0` entry.
- **Out of scope for this entire plan** (do not let any task quietly expand into these): AttackPath graph visualization; making core `calculateScore`/`evaluateRelease` run-scoped; fresh engine re-assessment of the 8 real validation projects to produce populated (non-null) provenance.

---

### Task 1: `ProjectReport` 2.1 — `projectName`, `runControlAssessmentSnapshots[]`, and trust-normalization provenance

**Files:**
- Modify: `src/core/risk-acceptance.ts`
- Modify: `src/core/report-builder.ts`
- Modify: `src/service/report-service.ts`
- Modify: `data/schemas/project-report-schema.json`
- Test: `tests/core/risk-acceptance.test.ts`
- Test: `tests/core/report-builder.test.ts`
- Test: `tests/service/report-service.test.ts`
- Test: `tests/schemas/project-report-schema.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (this is the foundational task).
- Produces (for Task 2): `src/core/risk-acceptance.ts` exports `EffectiveStatusReasonCode`, `EffectiveStatusReason`, `TrustNormalizedAssessment` (now carrying `assessmentId`, `controlId`, `runId`, `recordedStatus`, `status`, `effectiveStatusReason`), and the extended `translateAssessmentsForTrust(assessments: ControlAssessment[], currentProfileRevision: number, riskAcceptances: RiskAcceptance[], nowIso: string): TrustNormalizedAssessment[]`. `src/core/report-builder.ts` exports `ControlAssessmentSnapshot`, `buildRunControlAssessmentSnapshots(assessments: ControlAssessment[], normalized: TrustNormalizedAssessment[], controls: Control[], runId: string): ControlAssessmentSnapshot[]`, and `ProjectReport` now has `projectName: string` and `runControlAssessmentSnapshots: ControlAssessmentSnapshot[]`. `buildReport`'s input grows `projectName: string`, `allAssessments: ControlAssessment[]`, `translatedAssessments: TrustNormalizedAssessment[]`, `controls: Control[]`.

- [ ] **Step 1: Write failing tests for the extended `translateAssessmentsForTrust`**

Replace the full contents of `tests/core/risk-acceptance.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { isRiskAcceptanceEffectivelyValid, translateAssessmentsForTrust } from "../../src/core/risk-acceptance.js";
import type { ControlAssessment, RiskAcceptance } from "../../src/core/repository.js";

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

describe("translateAssessmentsForTrust — recordedStatus/status/effectiveStatusReason shape", () => {
  it("a fresh assessment (profileRevision matches) passes through with recordedStatus === status and a null reason", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 1, [], NOW);
    expect(result).toEqual([{
      assessmentId: "A-TEST-001", controlId: "TEST-001", runId: "RUN-1",
      recordedStatus: "PASS", status: "PASS", effectiveStatusReason: null,
    }]);
  });

  it("a stale assessment (profileRevision does not match) is translated to NOT_TESTED with reason stale_profile, recordedStatus preserved", () => {
    const result = translateAssessmentsForTrust([assessment("TEST-001", { profileRevision: 1 })], 2, [], NOW);
    expect(result).toEqual([{
      assessmentId: "A-TEST-001", controlId: "TEST-001", runId: "RUN-1",
      recordedStatus: "PASS", status: "NOT_TESTED", effectiveStatusReason: { code: "stale_profile" },
    }]);
  });

  it("ACCEPTED_RISK backed by a valid, scope-matched RiskAcceptance passes through unchanged with a null reason", () => {
    const riskAcceptance = ra({ controlId: "TEST-001" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result).toEqual([{
      assessmentId: "A-TEST-001", controlId: "TEST-001", runId: "RUN-1",
      recordedStatus: "ACCEPTED_RISK", status: "ACCEPTED_RISK", effectiveStatusReason: null,
    }]);
  });

  it("ACCEPTED_RISK whose RiskAcceptance has since expired is translated to NOT_TESTED with reason risk_acceptance_expired", () => {
    const riskAcceptance = ra({ controlId: "TEST-001", approvedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].recordedStatus).toBe("ACCEPTED_RISK");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_expired" });
  });

  it("ACCEPTED_RISK whose riskAcceptanceId resolves to nothing at all is translated to NOT_TESTED with reason risk_acceptance_missing", () => {
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-404" });
    const result = translateAssessmentsForTrust([a], 1, [], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_missing" });
  });

  it("ACCEPTED_RISK whose RiskAcceptance has status revoked is translated to NOT_TESTED with reason risk_acceptance_revoked, even inside the still-unexpired date range", () => {
    const riskAcceptance = ra({ controlId: "TEST-001", status: "revoked" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_revoked" });
  });

  it("ACCEPTED_RISK whose RiskAcceptance is scoped to a different controlId is translated to NOT_TESTED with reason risk_acceptance_scope_mismatch and a detail string naming both ids", () => {
    const riskAcceptance = ra({ controlId: "OTHER-CONTROL-001" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason?.code).toBe("risk_acceptance_scope_mismatch");
    expect(result[0].effectiveStatusReason?.detail).toContain("RA-001");
    expect(result[0].effectiveStatusReason?.detail).toContain("OTHER-CONTROL-001");
  });

  it("ACCEPTED_RISK whose RiskAcceptance has an approvedAt in the future (not yet approved) is translated to NOT_TESTED with reason risk_acceptance_expired and an explanatory detail", () => {
    const riskAcceptance = ra({ controlId: "TEST-001", approvedAt: "2026-11-01T00:00:00.000Z" });
    const a = assessment("TEST-001", { status: "ACCEPTED_RISK", riskAcceptanceId: "RA-001" });
    const result = translateAssessmentsForTrust([a], 1, [riskAcceptance], NOW);
    expect(result[0].status).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason?.code).toBe("risk_acceptance_expired");
    expect(result[0].effectiveStatusReason?.detail).toBeTruthy();
  });

  it("stale_profile takes precedence when both staleness and an ACCEPTED_RISK problem would independently apply", () => {
    const a = assessment("TEST-001", { profileRevision: 1, status: "ACCEPTED_RISK", riskAcceptanceId: "RA-404" });
    const result = translateAssessmentsForTrust([a], 2, [], NOW);
    expect(result[0].effectiveStatusReason).toEqual({ code: "stale_profile" });
  });

  it("never mutates the input ControlAssessment objects", () => {
    const a = assessment("TEST-001", { profileRevision: 1 });
    translateAssessmentsForTrust([a], 2, [], NOW);
    expect(a.status).toBe("PASS");
    expect(a.profileRevision).toBe(1);
  });

  it("carries each assessment's own runId through, for a mixed-run input array", () => {
    const a1 = assessment("TEST-001", { runId: "RUN-1" });
    const a2 = assessment("TEST-002", { runId: "RUN-2" });
    const result = translateAssessmentsForTrust([a1, a2], 1, [], NOW);
    expect(result.find((r) => r.controlId === "TEST-001")?.runId).toBe("RUN-1");
    expect(result.find((r) => r.controlId === "TEST-002")?.runId).toBe("RUN-2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/risk-acceptance.test.ts`
Expected: FAIL — the current `translateAssessmentsForTrust` returns only `{ controlId, status }`, so every `toEqual`/`.recordedStatus`/`.effectiveStatusReason` assertion above fails (missing fields, not thrown errors).

- [ ] **Step 3: Implement the extended `translateAssessmentsForTrust`**

Replace the full contents of `src/core/risk-acceptance.ts` with:

```ts
import type { ControlAssessment, RiskAcceptance } from "./repository.js";

export function isRiskAcceptanceEffectivelyValid(ra: RiskAcceptance, nowIso: string): boolean {
  return ra.status === "active" && ra.approvedAt <= nowIso && nowIso < ra.expiresAt;
}

export type EffectiveStatusReasonCode =
  | "stale_profile"
  | "risk_acceptance_missing"
  | "risk_acceptance_expired"
  | "risk_acceptance_revoked"
  | "risk_acceptance_scope_mismatch";

export interface EffectiveStatusReason {
  code: EffectiveStatusReasonCode;
  detail?: string;
}

export interface TrustNormalizedAssessment {
  assessmentId: string;
  controlId: string;
  runId: string;
  recordedStatus: ControlAssessment["status"];
  status: ControlAssessment["status"]; // kept as "status" — calculateScore/evaluateRelease consume ControlAssessmentInput = {controlId, status}
  effectiveStatusReason: EffectiveStatusReason | null;
}

export function translateAssessmentsForTrust(
  assessments: ControlAssessment[],
  currentProfileRevision: number,
  riskAcceptances: RiskAcceptance[],
  nowIso: string
): TrustNormalizedAssessment[] {
  const riskAcceptanceById = new Map(riskAcceptances.map((ra) => [ra.riskAcceptanceId, ra]));

  return assessments.map((a) => {
    const stale = a.profileRevision !== currentProfileRevision;
    let reason: EffectiveStatusReason | null = null;
    let forceNotTested = false;

    if (stale) {
      forceNotTested = true;
      reason = { code: "stale_profile" };
    } else if (a.status === "ACCEPTED_RISK") {
      const ra = a.riskAcceptanceId ? riskAcceptanceById.get(a.riskAcceptanceId) : undefined;
      if (!ra) {
        forceNotTested = true;
        reason = { code: "risk_acceptance_missing" };
      } else if (ra.controlId !== a.controlId) {
        forceNotTested = true;
        reason = {
          code: "risk_acceptance_scope_mismatch",
          detail: `riskAcceptanceId ${ra.riskAcceptanceId} is scoped to control ${ra.controlId}, not ${a.controlId}`,
        };
      } else if (ra.status === "revoked") {
        forceNotTested = true;
        reason = { code: "risk_acceptance_revoked" };
      } else if (ra.status === "expired" || nowIso >= ra.expiresAt) {
        forceNotTested = true;
        reason = { code: "risk_acceptance_expired" };
      } else if (nowIso < ra.approvedAt) {
        forceNotTested = true;
        reason = { code: "risk_acceptance_expired", detail: "risk acceptance not yet approved" };
      }
    }

    return {
      assessmentId: a.assessmentId,
      controlId: a.controlId,
      runId: a.runId,
      recordedStatus: a.status,
      status: forceNotTested ? "NOT_TESTED" : a.status,
      effectiveStatusReason: reason,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/risk-acceptance.test.ts`
Expected: PASS (20 tests)

- [ ] **Step 5: Confirm `score.ts`/`release-evaluator.ts` still accept the richer return type unchanged**

Run: `npx tsc --noEmit`
Expected: PASS. `calculateScore`/`evaluateRelease` declare their `assessments` parameter as `ControlAssessmentInput[]` (`{ controlId, status }`), and TypeScript's structural typing permits a `TrustNormalizedAssessment[]` variable (which has `controlId`/`status` plus extra fields) to flow into a parameter of that narrower type — excess-property checking only rejects object *literals*, never variables. No change is needed in `src/core/score.ts`, `src/core/release-evaluator.ts`, or their tests. Do not modify those two files in this task.

- [ ] **Step 6: Write failing tests for `ControlAssessmentSnapshot`/`buildRunControlAssessmentSnapshots`/`projectName` on `ProjectReport`**

Add this new `describe` block to the end of `tests/core/report-builder.test.ts` (keep the existing imports; add `buildRunControlAssessmentSnapshots`, `type ControlAssessmentSnapshot` to the import from `../../src/core/report-builder.js`, and add imports for `type ControlAssessment, type Control` from `../../src/core/repository.js` and `type TrustNormalizedAssessment` from `../../src/core/risk-acceptance.js`):

```ts
import { /* existing names */ sortPrioritizedFindings, buildReport, roundReportNumber, buildRunControlAssessmentSnapshots, type PrioritizedFindingInput, type FindingForReport, type ReleaseEvaluationForReport, type ScoreForReport, type ControlAssessmentSnapshot } from "../../src/core/report-builder.js";
import type { ControlAssessment, Control } from "../../src/core/repository.js";
import type { TrustNormalizedAssessment } from "../../src/core/risk-acceptance.js";

function rawAssessment(controlId: string, overrides: Partial<ControlAssessment> = {}): ControlAssessment {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-1", controlId, controlVersion: 1,
    runId: "RUN-1", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-10-07T00:00:00.000Z",
    nextReviewAt: null, notes: null,
    ...overrides,
  };
}

function normalized(a: ControlAssessment, overrides: Partial<TrustNormalizedAssessment> = {}): TrustNormalizedAssessment {
  return {
    assessmentId: a.assessmentId, controlId: a.controlId, runId: a.runId,
    recordedStatus: a.status, status: a.status, effectiveStatusReason: null,
    ...overrides,
  };
}

function catalogControl(controlId: string, version: number, overrides: Partial<Control> = {}): Control {
  return {
    controlId, version, status: "active", title: `Title for ${controlId}`,
    domain: "appsec", subdomain: "x", layer: "application", group: "x",
    applicability: { defaultResult: "applicable", rules: [] },
    ...overrides,
  } as Control;
}

describe("buildRunControlAssessmentSnapshots", () => {
  it("filters to only the requested runId", () => {
    const a1 = rawAssessment("CTRL-001", { runId: "RUN-1" });
    const a2 = rawAssessment("CTRL-002", { runId: "RUN-2" });
    const result = buildRunControlAssessmentSnapshots([a1, a2], [normalized(a1), normalized(a2)], [catalogControl("CTRL-001", 1), catalogControl("CTRL-002", 1)], "RUN-1");
    expect(result.map((s) => s.controlId)).toEqual(["CTRL-001"]);
  });

  it("joins title/domain on an exact (controlId, controlVersion) match", () => {
    const a = rawAssessment("CTRL-001", { controlVersion: 2 });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [catalogControl("CTRL-001", 2, { title: "Exact match title", domain: "identity-access" })], "RUN-1");
    expect(result[0].title).toBe("Exact match title");
    expect(result[0].domain).toBe("identity-access");
  });

  it("sets title/domain to null when controlVersion doesn't match the current catalog entry", () => {
    const a = rawAssessment("CTRL-001", { controlVersion: 1 });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [catalogControl("CTRL-001", 2, { title: "Current (newer) title" })], "RUN-1");
    expect(result[0].title).toBeNull();
    expect(result[0].domain).toBeNull();
  });

  it("sets title/domain to null when the controlId has no catalog entry at all", () => {
    const a = rawAssessment("CTRL-GONE", { controlVersion: 1 });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [], "RUN-1");
    expect(result[0].title).toBeNull();
    expect(result[0].domain).toBeNull();
  });

  it("carries recordedStatus/effectiveStatus/effectiveStatusReason from the matching normalized entry", () => {
    const a = rawAssessment("CTRL-001", { status: "ACCEPTED_RISK" });
    const n = normalized(a, { status: "NOT_TESTED", effectiveStatusReason: { code: "risk_acceptance_missing" } });
    const result = buildRunControlAssessmentSnapshots([a], [n], [catalogControl("CTRL-001", 1)], "RUN-1");
    expect(result[0].recordedStatus).toBe("ACCEPTED_RISK");
    expect(result[0].effectiveStatus).toBe("NOT_TESTED");
    expect(result[0].effectiveStatusReason).toEqual({ code: "risk_acceptance_missing" });
  });

  it("carries evidenceIds/findingIds/riskAcceptanceId/owner/assessedBy/assessedAt/nextReviewAt/notes/applicability/profileRevision straight from the raw assessment", () => {
    const a = rawAssessment("CTRL-001", {
      evidenceIds: ["EVD-001"], findingIds: ["FND-001"], riskAcceptanceId: "RA-001",
      owner: "owner-x", assessedBy: "assessor-x", nextReviewAt: "2027-01-01T00:00:00.000Z", notes: "n",
    });
    const result = buildRunControlAssessmentSnapshots([a], [normalized(a)], [catalogControl("CTRL-001", 1)], "RUN-1");
    expect(result[0]).toMatchObject({
      evidenceIds: ["EVD-001"], findingIds: ["FND-001"], riskAcceptanceId: "RA-001",
      owner: "owner-x", assessedBy: "assessor-x", nextReviewAt: "2027-01-01T00:00:00.000Z", notes: "n",
      applicability: a.applicability, profileRevision: a.profileRevision,
    });
  });

  it("is sorted ascending by controlId regardless of input order", () => {
    const a1 = rawAssessment("CTRL-003");
    const a2 = rawAssessment("CTRL-001");
    const a3 = rawAssessment("CTRL-002");
    const controls = [catalogControl("CTRL-001", 1), catalogControl("CTRL-002", 1), catalogControl("CTRL-003", 1)];
    const result = buildRunControlAssessmentSnapshots([a1, a2, a3], [normalized(a1), normalized(a2), normalized(a3)], controls, "RUN-1");
    expect(result.map((s) => s.controlId)).toEqual(["CTRL-001", "CTRL-002", "CTRL-003"]);
  });

  it("throws if a filtered assessment has no matching normalized entry (invariant violation — every assessment must have been normalized)", () => {
    const a = rawAssessment("CTRL-001");
    expect(() => buildRunControlAssessmentSnapshots([a], [], [catalogControl("CTRL-001", 1)], "RUN-1")).toThrow();
  });
});

describe("buildReport — projectName and runControlAssessmentSnapshots", () => {
  it("carries projectName through verbatim", () => {
    const a = rawAssessment("CTRL-001");
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [a], translatedAssessments: [normalized(a)], controls: [catalogControl("CTRL-001", 1)],
    });
    expect(report.projectName).toBe("Demo Project");
  });

  it("filters runControlAssessmentSnapshots to the run's own runId, excluding assessments from other runs on the same project", () => {
    const a1 = rawAssessment("CTRL-001", { runId: "RUN-1" });
    const a2 = rawAssessment("CTRL-002", { runId: "RUN-2" });
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [a1, a2], translatedAssessments: [normalized(a1), normalized(a2)],
      controls: [catalogControl("CTRL-001", 1), catalogControl("CTRL-002", 1)],
    });
    expect(report.runControlAssessmentSnapshots.map((s) => s.controlId)).toEqual(["CTRL-001"]);
  });

  it("stamps reportSchemaVersion 2.1.0", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
    });
    expect(report.reportSchemaVersion).toBe("2.1.0");
  });
});
```

Note: `run`, `score`, `releaseEvaluation` in the new tests refer to the same module-level fixtures already defined earlier in this test file (`const run = ...`, `const score: ScoreForReport = ...`, `const releaseEvaluation: ReleaseEvaluation = ...`) — do not redeclare them.

Also update the existing test `"stamps reportSchemaVersion 2.0.0 on every generated report"` (in the `"buildReport — reportSchemaVersion and dropped fields"` describe block) to assert `"2.1.0"` instead of `"2.0.0"`, and add `projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: []` to every existing `buildReport({...})` call in this file (every call site in the file needs these 4 new required fields, since `buildReport`'s input type is changing in Step 8 below — this is a mechanical, repeated edit across the whole file, not new test logic).

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: FAIL — `buildRunControlAssessmentSnapshots` does not exist yet, and `buildReport` does not accept `projectName`/`allAssessments`/`translatedAssessments`/`controls`.

- [ ] **Step 8: Implement `ControlAssessmentSnapshot`, `buildRunControlAssessmentSnapshots`, and extend `ProjectReport`/`buildReport`**

In `src/core/report-builder.ts`:

Add this import at the top (alongside the existing imports):

```ts
import type { Control, ControlAssessment } from "./repository.js";
import type { EffectiveStatusReason, TrustNormalizedAssessment } from "./risk-acceptance.js";
```

Change `export const REPORT_SCHEMA_VERSION = "2.0.0";` to:

```ts
export const REPORT_SCHEMA_VERSION = "2.1.0";
```

Add this new interface and function after `buildProjectFindingSnapshots` (same file, same section — it mirrors that function's pattern):

```ts
export interface ControlAssessmentSnapshot {
  assessmentId: string;
  runId: string;
  controlId: string;
  controlVersion: number;
  title: string | null;
  domain: string | null;
  profileRevision: number;
  applicability: ControlAssessment["applicability"];
  recordedStatus: ControlAssessment["status"];
  effectiveStatus: ControlAssessment["status"];
  effectiveStatusReason: EffectiveStatusReason | null;
  evidenceIds: string[];
  findingIds: string[];
  riskAcceptanceId: string | null;
  owner: string;
  assessedBy: string;
  assessedAt: string;
  nextReviewAt: string | null;
  notes: string | null;
}

export function buildRunControlAssessmentSnapshots(
  allAssessments: ControlAssessment[],
  translatedAssessments: TrustNormalizedAssessment[],
  controls: Control[],
  runId: string
): ControlAssessmentSnapshot[] {
  const normalizedByAssessmentId = new Map(translatedAssessments.map((n) => [n.assessmentId, n]));
  const controlByIdAndVersion = new Map(controls.map((c) => [`${c.controlId}@${c.version}`, c]));

  const snapshots: ControlAssessmentSnapshot[] = allAssessments
    .filter((a) => a.runId === runId)
    .map((a) => {
      const normalized = normalizedByAssessmentId.get(a.assessmentId);
      if (!normalized) {
        throw new Error(
          `buildRunControlAssessmentSnapshots: assessment "${a.assessmentId}" has no matching entry in translatedAssessments — ` +
            `every ControlAssessment fed to translateAssessmentsForTrust must appear exactly once in its result`
        );
      }
      const control = controlByIdAndVersion.get(`${a.controlId}@${a.controlVersion}`);
      return {
        assessmentId: a.assessmentId,
        runId: a.runId,
        controlId: a.controlId,
        controlVersion: a.controlVersion,
        title: control?.title ?? null,
        domain: control?.domain ?? null,
        profileRevision: a.profileRevision,
        applicability: a.applicability,
        recordedStatus: normalized.recordedStatus,
        effectiveStatus: normalized.status,
        effectiveStatusReason: normalized.effectiveStatusReason,
        evidenceIds: [...a.evidenceIds],
        findingIds: [...a.findingIds],
        riskAcceptanceId: a.riskAcceptanceId,
        owner: a.owner,
        assessedBy: a.assessedBy,
        assessedAt: a.assessedAt,
        nextReviewAt: a.nextReviewAt,
        notes: a.notes,
      };
    });

  return snapshots.sort((a, b) => (a.controlId < b.controlId ? -1 : a.controlId > b.controlId ? 1 : 0));
}
```

Change `ProjectReport` to add two new fields (insert after `projectId: string;`):

```ts
export interface ProjectReport {
  reportId: string;
  projectId: string;
  projectName: string;
  assessmentRunId: string;
  // ...unchanged fields in between...
  runControlAssessmentSnapshots: ControlAssessmentSnapshot[];
  reportSchemaVersion: string;
  summary: string;
}
```

Change `buildReport`'s input type to add 4 new required fields (insert into the existing input object type, alongside `reportId`):

```ts
export function buildReport(input: {
  reportId: string;
  projectName: string;
  run: { /* unchanged */ };
  criticalityFormula: { id: string; version: string };
  generatedAt: () => string;
  score: ScoreForReport;
  findings: FindingForReport[];
  releaseEvaluation: ReleaseEvaluation;
  summary: string;
  allAssessments: ControlAssessment[];
  translatedAssessments: TrustNormalizedAssessment[];
  controls: Control[];
}): ProjectReport {
```

And in the function body, add the new field to the returned object (after `projectId: input.run.projectId,`):

```ts
    projectName: input.projectName,
```

and after `projectFindingSnapshots: buildProjectFindingSnapshots(input.findings),`:

```ts
    runControlAssessmentSnapshots: buildRunControlAssessmentSnapshots(
      input.allAssessments, input.translatedAssessments, input.controls, input.run.runId
    ),
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS

- [ ] **Step 10: Wire `ReportService.generate` to pass the new `buildReport` inputs**

In `src/service/report-service.ts`, after the existing `const [assessments, findings, controls] = await Promise.all([...])` block, no new fetch is needed (`assessments`/`controls` are already fetched; `project` is already fetched for `project.profileRevision`). Change the `buildReport({...})` call to add the 4 new fields:

```ts
    const report = buildReport({
      reportId: generateUuid(),
      projectName: project.name,
      run: {
        runId: run.runId, projectId: run.projectId, catalogVersion: run.catalogVersion, profileRevision: run.profileRevision,
        target: run.target ?? null, profileSnapshot: run.profileSnapshot ?? null, engineVersionAtRunStart: run.engineVersionAtRunStart ?? null,
      },
      criticalityFormula: { id: criticalityFormula.formulaId, version: criticalityFormula.version },
      generatedAt: this.now,
      score, findings, releaseEvaluation, summary: input.summary,
      allAssessments: assessments,
      translatedAssessments: translatedAssessments,
      controls,
    });
```

- [ ] **Step 11: Run the full test suite to catch any other call site**

Run: `npx vitest run`
Expected: Failures only in `tests/schemas/project-report-schema.test.ts` and `tests/service/report-service.test.ts` (schema/fixtures not yet updated) and `npx tsc --noEmit` type errors in any other file constructing a `ProjectReport`/calling `buildReport` directly (there should be none besides `report-builder.test.ts`, already fixed, and `report-service.ts`, already fixed) — fix forward in the next steps, don't skip ahead.

- [ ] **Step 12: Update `data/schemas/project-report-schema.json` to `2.1.0`**

In `data/schemas/project-report-schema.json`:

Add `"projectName": { "type": "string", "minLength": 1 },` right after the `"projectId"` property.

Add this new property after `"projectFindingSnapshots"`'s closing `}`:

```json
    "runControlAssessmentSnapshots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "assessmentId": { "type": "string", "minLength": 1 },
          "runId": { "type": "string", "minLength": 1 },
          "controlId": { "type": "string", "minLength": 1 },
          "controlVersion": { "type": "integer", "minimum": 1 },
          "title": { "type": ["string", "null"] },
          "domain": { "type": ["string", "null"] },
          "profileRevision": { "type": "integer", "minimum": 1 },
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
            "additionalProperties": false
          },
          "recordedStatus": { "type": "string", "enum": ["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"] },
          "effectiveStatus": { "type": "string", "enum": ["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"] },
          "effectiveStatusReason": {
            "type": ["object", "null"],
            "properties": {
              "code": {
                "type": "string",
                "enum": ["stale_profile", "risk_acceptance_missing", "risk_acceptance_expired", "risk_acceptance_revoked", "risk_acceptance_scope_mismatch"]
              },
              "detail": { "type": "string", "minLength": 1 }
            },
            "required": ["code"],
            "additionalProperties": false
          },
          "evidenceIds": { "type": "array", "items": { "type": "string", "minLength": 1 } },
          "findingIds": { "type": "array", "items": { "type": "string", "minLength": 1 } },
          "riskAcceptanceId": { "type": ["string", "null"] },
          "owner": { "type": "string", "minLength": 1 },
          "assessedBy": { "type": "string", "minLength": 1 },
          "assessedAt": { "type": "string", "format": "date-time" },
          "nextReviewAt": { "type": ["string", "null"], "format": "date-time" },
          "notes": { "type": ["string", "null"] }
        },
        "required": [
          "assessmentId", "runId", "controlId", "controlVersion", "title", "domain", "profileRevision",
          "applicability", "recordedStatus", "effectiveStatus", "effectiveStatusReason",
          "evidenceIds", "findingIds", "riskAcceptanceId", "owner", "assessedBy", "assessedAt", "nextReviewAt", "notes"
        ],
        "additionalProperties": false
      }
    },
```

Change `"reportSchemaVersion": { "const": "2.0.0" },` to `"reportSchemaVersion": { "const": "2.1.0" },`.

Add `"projectName"` and `"runControlAssessmentSnapshots"` to the top-level `"required"` array.

- [ ] **Step 13: Update `tests/schemas/project-report-schema.test.ts`'s `valid` fixture**

Add `projectName: "Demo Project",` and `runControlAssessmentSnapshots: [],` to the `valid` object (empty array is schema-valid — `runControlAssessmentSnapshots` has no `minItems`). Change `reportSchemaVersion: "2.0.0",` to `reportSchemaVersion: "2.1.0",`. Change the test `"rejects a report with any reportSchemaVersion other than the current '2.0.0'"` to assert against `"2.1.0"` instead (rename the test description to say `'2.1.0'`, keep asserting `validate({ ...valid, reportSchemaVersion: "1.0.0" })` is `false`).

- [ ] **Step 14: Update `tests/service/report-service.test.ts` and `tests/service/fake-repository.ts`**

No change needed to `fake-repository.ts` for this task — `getControlAssessments`/`getControls`/`getProject` already exist with the right shapes. In `tests/service/report-service.test.ts`, add one new test to the `"ReportService.generate — single findings fetch and provenance pass-through"` describe block:

```ts
  it("carries projectName from the project record and filters runControlAssessmentSnapshots to the requested run", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo); // creates RUN-1 with 8 blocking-control assessments
    await repo.saveRun({
      runId: "RUN-2", projectId: "PRJ-1", planId: "PLAN-1", planVersion: 1, profileRevision: 1,
      catalogVersion: "9.9.9", batchIds: [], status: "running", startedAt: NOW, completedAt: null,
    });
    await repo.saveControlAssessment({
      assessmentId: "A-RUN2-CTRL", projectId: "PRJ-1", controlId: "RUN2-ONLY-001", controlVersion: 1,
      runId: "RUN-2", profileRevision: 1,
      applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null, owner: "x", assessedBy: "x", assessedAt: NOW, nextReviewAt: null, notes: null,
    });
    const service = new ReportService(repo, () => NOW);
    const report = await service.generate({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    expect(report.projectName).toBe("Demo");
    expect(report.runControlAssessmentSnapshots.some((s) => s.controlId === "RUN2-ONLY-001")).toBe(false);
    expect(report.runControlAssessmentSnapshots.length).toBe(8); // only RUN-1's 8 blocking-control assessments
  });
```

- [ ] **Step 15: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 16: Commit**

```bash
git add src/core/risk-acceptance.ts src/core/report-builder.ts src/service/report-service.ts \
  data/schemas/project-report-schema.json \
  tests/core/risk-acceptance.test.ts tests/core/report-builder.test.ts \
  tests/service/report-service.test.ts tests/schemas/project-report-schema.test.ts
git commit -m "feat(report): add projectName, runControlAssessmentSnapshots, and recorded/effective status provenance to ProjectReport 2.1"
```

---

### Task 2: `evidenceSnapshots[]`, `riskAcceptanceSnapshots[]`, and `assessmentScopes`

**Files:**
- Modify: `src/core/report-builder.ts`
- Modify: `src/service/report-service.ts`
- Modify: `data/schemas/project-report-schema.json`
- Test: `tests/core/report-builder.test.ts`
- Test: `tests/service/report-service.test.ts`
- Test: `tests/schemas/project-report-schema.test.ts`

**Interfaces:**
- Consumes: `ControlAssessmentSnapshot` (Task 1, for `evidenceIds`/`riskAcceptanceId` reference scoping), `TrustNormalizedAssessment` (Task 1, now carrying `runId`, used for `contributingRunIds`).
- Produces (for Task 3): `ProjectReport.evidenceSnapshots: EvidenceSnapshot[]`, `ProjectReport.riskAcceptanceSnapshots: RiskAcceptanceSnapshot[]`, `ProjectReport.assessmentScopes: AssessmentScopes`, and the exported `EvidenceSnapshot`/`RiskAcceptanceSnapshot`/`AssessmentScopes` types from `src/core/report-builder.ts`.
- **Same-`RiskAcceptance[]`-set invariant:** `buildRiskAcceptanceSnapshots` (Step 3 below) must consume the exact same `RiskAcceptance[]` array `ReportService.generate` already fetched once (Task 1's precedent) and fed into `translateAssessmentsForTrust` — never a second `getRiskAcceptances(projectId)` call. Step 5 below makes this explicit: `riskAcceptances` (the variable already in scope in `report-service.ts`, used for trust normalization) is the same variable passed to `buildReport`'s new `allRiskAcceptances` field.

- [ ] **Step 1: Write failing tests for `buildEvidenceSnapshots`/`buildRiskAcceptanceSnapshots`/`buildAssessmentScopes`**

Add this `describe` block to the end of `tests/core/report-builder.test.ts` (extend the existing import line from `../../src/core/report-builder.js` to also bring in `buildEvidenceSnapshots, buildRiskAcceptanceSnapshots, buildAssessmentScopes, type EvidenceSnapshot, type RiskAcceptanceSnapshot`; add `type Evidence, type RiskAcceptance` to the existing `../../src/core/repository.js` type import):

```ts
function rawEvidence(evidenceId: string, overrides: Partial<Evidence> = {}): Evidence {
  return { evidenceId, type: "CODE", location: "src/x.ts:10", capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "csi-mcp-agent", ...overrides };
}

function rawRiskAcceptance(riskAcceptanceId: string, overrides: Partial<RiskAcceptance> = {}): RiskAcceptance {
  return {
    riskAcceptanceId, projectId: "PRJ-1", controlId: "CTRL-001", findingIds: [],
    reason: "r", compensatingControls: [], approvedBy: "csi-mcp-agent",
    approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
    reviewDate: null, status: "active", revokedAt: null, revokedReason: null,
    ...overrides,
  };
}

describe("buildEvidenceSnapshots", () => {
  it("includes only evidence referenced by the given id set, dropping unreferenced evidence", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-001"), rawEvidence("EVD-002")], new Set(["EVD-001"]));
    expect(result.map((e) => e.evidenceId)).toEqual(["EVD-001"]);
  });

  it("silently omits a referenced id that has no matching Evidence record, rather than throwing", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-001")], new Set(["EVD-001", "EVD-404"]));
    expect(result.map((e) => e.evidenceId)).toEqual(["EVD-001"]);
  });

  it("projects only type/location/description/capturedAt/capturedBy, dropping searchScope/searchMethod/candidateCount/excludedCandidates", () => {
    const result = buildEvidenceSnapshots(
      [rawEvidence("EVD-001", { description: "d", searchScope: "src/", searchMethod: "grep", candidateCount: 3, excludedCandidates: "none" })],
      new Set(["EVD-001"])
    );
    expect(result[0]).toEqual({
      evidenceId: "EVD-001", type: "CODE", location: "src/x.ts:10", description: "d",
      capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "csi-mcp-agent",
    });
  });

  it("sets description to null when the source Evidence record omits it", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-001")], new Set(["EVD-001"]));
    expect(result[0].description).toBeNull();
  });

  it("is sorted ascending by evidenceId regardless of input order", () => {
    const result = buildEvidenceSnapshots([rawEvidence("EVD-002"), rawEvidence("EVD-001")], new Set(["EVD-001", "EVD-002"]));
    expect(result.map((e) => e.evidenceId)).toEqual(["EVD-001", "EVD-002"]);
  });
});

describe("buildRiskAcceptanceSnapshots", () => {
  it("includes only risk acceptances referenced by the given id set", () => {
    const result = buildRiskAcceptanceSnapshots([rawRiskAcceptance("RA-001"), rawRiskAcceptance("RA-002")], new Set(["RA-001"]));
    expect(result.map((r) => r.riskAcceptanceId)).toEqual(["RA-001"]);
  });

  it("silently omits a referenced id that has no matching RiskAcceptance record", () => {
    const result = buildRiskAcceptanceSnapshots([rawRiskAcceptance("RA-001")], new Set(["RA-001", "RA-404"]));
    expect(result.map((r) => r.riskAcceptanceId)).toEqual(["RA-001"]);
  });

  it("strips projectId, keeping every other RiskAcceptance field verbatim", () => {
    const ra = rawRiskAcceptance("RA-001", { status: "revoked", revokedAt: "2026-10-05T00:00:00.000Z", revokedReason: "superseded" });
    const result = buildRiskAcceptanceSnapshots([ra], new Set(["RA-001"]));
    expect(result[0]).toEqual({
      riskAcceptanceId: "RA-001", controlId: "CTRL-001", findingIds: [], reason: "r", compensatingControls: [],
      approvedBy: "csi-mcp-agent", approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
      reviewDate: null, status: "revoked", revokedAt: "2026-10-05T00:00:00.000Z", revokedReason: "superseded",
    });
    expect("projectId" in result[0]).toBe(false);
  });

  it("is sorted ascending by riskAcceptanceId regardless of input order", () => {
    const result = buildRiskAcceptanceSnapshots([rawRiskAcceptance("RA-002"), rawRiskAcceptance("RA-001")], new Set(["RA-001", "RA-002"]));
    expect(result.map((r) => r.riskAcceptanceId)).toEqual(["RA-001", "RA-002"]);
  });
});

describe("buildAssessmentScopes", () => {
  it("sets the 3 fixed-kind scopes (projectFindingSnapshots, runControlAssessmentSnapshots, evidenceSnapshots/riskAcceptanceSnapshots) and the given runId", () => {
    const result = buildAssessmentScopes([], "RUN-1");
    expect(result.projectFindingSnapshots).toEqual({ kind: "project" });
    expect(result.runControlAssessmentSnapshots).toEqual({ kind: "run", runId: "RUN-1" });
    expect(result.evidenceSnapshots).toEqual({ kind: "referenced-by-run", runId: "RUN-1" });
    expect(result.riskAcceptanceSnapshots).toEqual({ kind: "referenced-by-run", runId: "RUN-1" });
  });

  it("computes contributingRunIds as the distinct, sorted set of runIds across the full normalized assessment set, for both score and releaseEvaluation", () => {
    const a1 = normalized(rawAssessment("CTRL-001", { runId: "RUN-2" }));
    const a2 = normalized(rawAssessment("CTRL-002", { runId: "RUN-1" }));
    const a3 = normalized(rawAssessment("CTRL-003", { runId: "RUN-1" }));
    const result = buildAssessmentScopes([a1, a2, a3], "RUN-1");
    expect(result.score).toEqual({ kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] });
    expect(result.releaseEvaluation).toEqual({ kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] });
  });

  it("contributingRunIds is a single-element array when every assessment in the project comes from one run", () => {
    const a1 = normalized(rawAssessment("CTRL-001", { runId: "RUN-1" }));
    const result = buildAssessmentScopes([a1], "RUN-1");
    expect(result.score.contributingRunIds).toEqual(["RUN-1"]);
  });
});

describe("buildReport — evidenceSnapshots/riskAcceptanceSnapshots/assessmentScopes", () => {
  it("scopes evidenceSnapshots/riskAcceptanceSnapshots to only what runControlAssessmentSnapshots references", () => {
    const a = rawAssessment("CTRL-001", { evidenceIds: ["EVD-001"], riskAcceptanceId: "RA-001" });
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [a], translatedAssessments: [normalized(a)],
      controls: [catalogControl("CTRL-001", 1)],
      allEvidence: [rawEvidence("EVD-001"), rawEvidence("EVD-UNREFERENCED")],
      allRiskAcceptances: [rawRiskAcceptance("RA-001"), rawRiskAcceptance("RA-UNREFERENCED")],
    });
    expect(report.evidenceSnapshots.map((e) => e.evidenceId)).toEqual(["EVD-001"]);
    expect(report.riskAcceptanceSnapshots.map((r) => r.riskAcceptanceId)).toEqual(["RA-001"]);
  });

  it("includes assessmentScopes with this report's runId", () => {
    const report = buildReport({
      reportId: "REP-1", run, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: () => "2026-09-28T00:00:00.000Z", score, findings: [], releaseEvaluation, summary: "ok",
      projectName: "Demo Project", allAssessments: [], translatedAssessments: [], controls: [],
      allEvidence: [], allRiskAcceptances: [],
    });
    expect(report.assessmentScopes.runControlAssessmentSnapshots).toEqual({ kind: "run", runId: "RUN-1" });
  });
});
```

Also add `allEvidence: [], allRiskAcceptances: []` to every pre-existing `buildReport({...})` call site in this file that doesn't already specify them (every call added in Task 1's Step 6 edits, plus every call that predates this plan) — same mechanical, repeated edit as Task 1 Step 6.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: FAIL — `buildEvidenceSnapshots`/`buildRiskAcceptanceSnapshots`/`buildAssessmentScopes` don't exist; `buildReport` doesn't accept `allEvidence`/`allRiskAcceptances`.

- [ ] **Step 3: Implement `EvidenceSnapshot`, `RiskAcceptanceSnapshot`, `AssessmentScopes`, and their builders**

In `src/core/report-builder.ts`, change the import line to add `Evidence, RiskAcceptance`:

```ts
import type { Control, ControlAssessment, Evidence, RiskAcceptance } from "./repository.js";
```

Add these interfaces and functions after `buildRunControlAssessmentSnapshots` (Task 1):

```ts
export interface EvidenceSnapshot {
  evidenceId: string;
  type: Evidence["type"];
  location: string;
  description: string | null;
  capturedAt: string;
  capturedBy: string;
}

export function buildEvidenceSnapshots(allEvidence: Evidence[], referencedIds: Set<string>): EvidenceSnapshot[] {
  const snapshots: EvidenceSnapshot[] = allEvidence
    .filter((e) => referencedIds.has(e.evidenceId))
    .map((e) => ({
      evidenceId: e.evidenceId,
      type: e.type,
      location: e.location,
      description: e.description ?? null,
      capturedAt: e.capturedAt,
      capturedBy: e.capturedBy,
    }));
  return snapshots.sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
}

export interface RiskAcceptanceSnapshot {
  riskAcceptanceId: string;
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

export function buildRiskAcceptanceSnapshots(allRiskAcceptances: RiskAcceptance[], referencedIds: Set<string>): RiskAcceptanceSnapshot[] {
  const snapshots: RiskAcceptanceSnapshot[] = allRiskAcceptances
    .filter((r) => referencedIds.has(r.riskAcceptanceId))
    .map((r) => ({
      riskAcceptanceId: r.riskAcceptanceId,
      controlId: r.controlId,
      findingIds: [...r.findingIds],
      reason: r.reason,
      compensatingControls: [...r.compensatingControls],
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
      expiresAt: r.expiresAt,
      reviewDate: r.reviewDate,
      status: r.status,
      revokedAt: r.revokedAt,
      revokedReason: r.revokedReason,
    }));
  return snapshots.sort((a, b) => (a.riskAcceptanceId < b.riskAcceptanceId ? -1 : a.riskAcceptanceId > b.riskAcceptanceId ? 1 : 0));
}

export interface AssessmentScope {
  kind: "project";
}
export interface AssessmentSetScope {
  kind: "project-assessment-set";
  contributingRunIds: string[];
}
export interface RunScope {
  kind: "run";
  runId: string;
}
export interface ReferencedByRunScope {
  kind: "referenced-by-run";
  runId: string;
}
export interface AssessmentScopes {
  projectFindingSnapshots: AssessmentScope;
  score: AssessmentSetScope;
  releaseEvaluation: AssessmentSetScope;
  runControlAssessmentSnapshots: RunScope;
  evidenceSnapshots: ReferencedByRunScope;
  riskAcceptanceSnapshots: ReferencedByRunScope;
}

export function buildAssessmentScopes(translatedAssessments: TrustNormalizedAssessment[], runId: string): AssessmentScopes {
  const contributingRunIds = [...new Set(translatedAssessments.map((a) => a.runId))].sort();
  return {
    projectFindingSnapshots: { kind: "project" },
    score: { kind: "project-assessment-set", contributingRunIds },
    releaseEvaluation: { kind: "project-assessment-set", contributingRunIds },
    runControlAssessmentSnapshots: { kind: "run", runId },
    evidenceSnapshots: { kind: "referenced-by-run", runId },
    riskAcceptanceSnapshots: { kind: "referenced-by-run", runId },
  };
}
```

Add the 3 new fields to `ProjectReport` (after `runControlAssessmentSnapshots: ControlAssessmentSnapshot[];`):

```ts
  evidenceSnapshots: EvidenceSnapshot[];
  riskAcceptanceSnapshots: RiskAcceptanceSnapshot[];
  assessmentScopes: AssessmentScopes;
```

Add `allEvidence: Evidence[]; allRiskAcceptances: RiskAcceptance[];` to `buildReport`'s input type (alongside `controls: Control[];`), and in the function body — after the `runControlAssessmentSnapshots` is computed, capture it in a local so it's not built twice:

```ts
  const runControlAssessmentSnapshots = buildRunControlAssessmentSnapshots(
    input.allAssessments, input.translatedAssessments, input.controls, input.run.runId
  );
  const referencedEvidenceIds = new Set(runControlAssessmentSnapshots.flatMap((s) => s.evidenceIds));
  const referencedRiskAcceptanceIds = new Set(
    runControlAssessmentSnapshots.map((s) => s.riskAcceptanceId).filter((id): id is string => id !== null)
  );
```

(place this block right before the `return { ... }` statement), then change the returned object's `runControlAssessmentSnapshots:` line to just reuse the local:

```ts
    runControlAssessmentSnapshots,
    evidenceSnapshots: buildEvidenceSnapshots(input.allEvidence, referencedEvidenceIds),
    riskAcceptanceSnapshots: buildRiskAcceptanceSnapshots(input.allRiskAcceptances, referencedRiskAcceptanceIds),
    assessmentScopes: buildAssessmentScopes(input.translatedAssessments, input.run.runId),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/report-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Wire `ReportService.generate` to fetch `Evidence` and pass the new `buildReport` inputs**

In `src/service/report-service.ts`, `getEvidence` is not currently fetched. Add it to the existing `Promise.all` that fetches `assessments`/`findings`/`controls`:

```ts
    const [assessments, findings, controls, evidence] = await Promise.all([
      this.repository.getControlAssessments(input.projectId),
      this.repository.getFindings(input.projectId),
      this.repository.getControls(),
      this.repository.getEvidence(input.projectId),
    ]);
```

Add `allEvidence: evidence, allRiskAcceptances: riskAcceptances,` to the `buildReport({...})` call (note: `riskAcceptances` is already fetched earlier in the function, at the line `const riskAcceptances = await this.repository.getRiskAcceptances(input.projectId);` — reuse that same variable, do not fetch it twice, per this plan's Global Constraints "same single loaded `RiskAcceptance` set" rule).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: Failures only in `tests/schemas/project-report-schema.test.ts` (fixture not yet updated) — fix in the next step.

- [ ] **Step 7: Update `data/schemas/project-report-schema.json`**

Add after `runControlAssessmentSnapshots`'s closing `},`:

```json
    "evidenceSnapshots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "evidenceId": { "type": "string", "minLength": 1 },
          "type": {
            "type": "string",
            "enum": ["CODE", "CONFIG", "AUTOMATED_TEST", "MANUAL_TEST", "SCAN", "LOG", "AUDIT_LOG", "ARCHITECTURE", "CI_ARTIFACT", "DEPLOYMENT_RECORD", "SCREENSHOT", "TICKET", "REPORT", "MANUAL_REVIEW"]
          },
          "location": { "type": "string", "minLength": 1 },
          "description": { "type": ["string", "null"] },
          "capturedAt": { "type": "string", "format": "date-time" },
          "capturedBy": { "type": "string", "minLength": 1 }
        },
        "required": ["evidenceId", "type", "location", "description", "capturedAt", "capturedBy"],
        "additionalProperties": false
      }
    },
    "riskAcceptanceSnapshots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "riskAcceptanceId": { "type": "string", "minLength": 1 },
          "controlId": { "type": "string", "minLength": 1 },
          "findingIds": { "type": "array", "items": { "type": "string", "minLength": 1 } },
          "reason": { "type": "string", "minLength": 1 },
          "compensatingControls": { "type": "array", "items": { "type": "string", "minLength": 1 } },
          "approvedBy": { "type": "string", "minLength": 1 },
          "approvedAt": { "type": "string", "format": "date-time" },
          "expiresAt": { "type": "string", "format": "date-time" },
          "reviewDate": { "type": ["string", "null"], "format": "date-time" },
          "status": { "type": "string", "enum": ["active", "expired", "revoked"] },
          "revokedAt": { "type": ["string", "null"], "format": "date-time" },
          "revokedReason": { "type": ["string", "null"], "minLength": 1 }
        },
        "required": ["riskAcceptanceId", "controlId", "findingIds", "reason", "compensatingControls", "approvedBy", "approvedAt", "expiresAt", "reviewDate", "status", "revokedAt", "revokedReason"],
        "additionalProperties": false
      }
    },
    "assessmentScopes": {
      "type": "object",
      "properties": {
        "projectFindingSnapshots": {
          "type": "object", "properties": { "kind": { "const": "project" } }, "required": ["kind"], "additionalProperties": false
        },
        "score": {
          "type": "object",
          "properties": { "kind": { "const": "project-assessment-set" }, "contributingRunIds": { "type": "array", "items": { "type": "string", "minLength": 1 } } },
          "required": ["kind", "contributingRunIds"], "additionalProperties": false
        },
        "releaseEvaluation": {
          "type": "object",
          "properties": { "kind": { "const": "project-assessment-set" }, "contributingRunIds": { "type": "array", "items": { "type": "string", "minLength": 1 } } },
          "required": ["kind", "contributingRunIds"], "additionalProperties": false
        },
        "runControlAssessmentSnapshots": {
          "type": "object", "properties": { "kind": { "const": "run" }, "runId": { "type": "string", "minLength": 1 } },
          "required": ["kind", "runId"], "additionalProperties": false
        },
        "evidenceSnapshots": {
          "type": "object", "properties": { "kind": { "const": "referenced-by-run" }, "runId": { "type": "string", "minLength": 1 } },
          "required": ["kind", "runId"], "additionalProperties": false
        },
        "riskAcceptanceSnapshots": {
          "type": "object", "properties": { "kind": { "const": "referenced-by-run" }, "runId": { "type": "string", "minLength": 1 } },
          "required": ["kind", "runId"], "additionalProperties": false
        }
      },
      "required": ["projectFindingSnapshots", "score", "releaseEvaluation", "runControlAssessmentSnapshots", "evidenceSnapshots", "riskAcceptanceSnapshots"],
      "additionalProperties": false
    },
```

Add `"projectName"`'s sibling new required keys: `"evidenceSnapshots"`, `"riskAcceptanceSnapshots"`, `"assessmentScopes"` to the top-level `"required"` array (joining `"runControlAssessmentSnapshots"` already added in Task 1).

- [ ] **Step 8: Update `tests/schemas/project-report-schema.test.ts`'s `valid` fixture**

Add to the `valid` object: `evidenceSnapshots: [],` `riskAcceptanceSnapshots: [],` and:

```ts
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" },
      score: { kind: "project-assessment-set", contributingRunIds: ["RUN-20260919-001"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-20260919-001"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-20260919-001" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-20260919-001" },
      riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-20260919-001" },
    },
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 10: Commit**

```bash
git add src/core/report-builder.ts src/service/report-service.ts data/schemas/project-report-schema.json \
  tests/core/report-builder.test.ts tests/service/report-service.test.ts tests/schemas/project-report-schema.test.ts
git commit -m "feat(report): add evidenceSnapshots, riskAcceptanceSnapshots, and assessmentScopes to ProjectReport 2.1"
```

---

### Task 3: `PresentationModel` — the pure projection layer

**Files:**
- Create: `src/core/presentation-model.ts`
- Test: `tests/core/presentation-model.test.ts`

**Interfaces:**
- Consumes: `ProjectReport` (Tasks 1–2, full `2.1.0` shape), `EffectiveStatusReasonCode` (from `src/core/risk-acceptance.ts`).
- Produces (for Task 4): `buildPresentationModel(report: ProjectReport, opts: { rendererVersion: string; rendererRenderedAt: string; sourceReportSha256: string }): PresentationModel`, and the exported types `PresentationModel`, `ControlRow`, `FindingCard`, `DomainPresentation`, `PresentationLimitation`, `ReferenceIntegrity`, `EFFECTIVE_STATUS_REASON_LABELS` — all from `src/core/presentation-model.ts`.

- [ ] **Step 1: Write failing tests for `buildPresentationModel`**

Create `tests/core/presentation-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPresentationModel, EFFECTIVE_STATUS_REASON_LABELS } from "../../src/core/presentation-model.js";
import type { ProjectReport, ControlAssessmentSnapshot, EvidenceSnapshot, RiskAcceptanceSnapshot, FindingSnapshot } from "../../src/core/report-builder.js";

const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

function controlSnapshot(controlId: string, overrides: Partial<ControlAssessmentSnapshot> = {}): ControlAssessmentSnapshot {
  return {
    assessmentId: `A-${controlId}`, runId: "RUN-1", controlId, controlVersion: 1,
    title: `Title ${controlId}`, domain: "appsec", profileRevision: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
    evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "x", assessedBy: "x", assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    ...overrides,
  };
}

function findingSnapshot(findingId: string, overrides: Partial<FindingSnapshot> = {}): FindingSnapshot {
  return {
    findingId, title: `Finding ${findingId}`, type: "control_gap", severity: "medium",
    controlIds: [], status: "open", priorityIndex: 5, criticalityIndex: 5,
    ...overrides,
  };
}

function sampleReport(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return {
    reportId: "REP-1", projectId: "PRJ-1", projectName: "Demo Project", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-07T00:00:00.000Z",
    score: {
      overallScore: 100,
      coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" },
      domainScores: [{
        domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1,
        coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0,
        notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0,
      }],
    },
    prioritizedFindings: [],
    projectFindingSnapshots: [],
    releaseEvaluation: {
      gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0,
      residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved",
    },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [controlSnapshot("CTRL-001")],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" },
      score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
      riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
    ...overrides,
  };
}

describe("buildPresentationModel — purity and determinism", () => {
  it("produces deep-equal output for the same (report, opts) called twice", () => {
    const report = sampleReport();
    expect(buildPresentationModel(report, OPTS)).toEqual(buildPresentationModel(report, OPTS));
  });

  it("does not mutate the input report", () => {
    const report = sampleReport();
    const before = JSON.stringify(report);
    buildPresentationModel(report, OPTS);
    expect(JSON.stringify(report)).toBe(before);
  });
});

describe("buildPresentationModel — metadata.target", () => {
  it("available: false, provenanceKind: legacy-unavailable when report.target is null", () => {
    const model = buildPresentationModel(sampleReport({ target: null }), OPTS);
    expect(model.metadata.target).toEqual({ available: false, repository: null, commitSha: null, branchOrTag: null, dirty: null, provenanceKind: "legacy-unavailable" });
  });

  it("available: true, provenanceKind: caller-asserted, fields copied verbatim when report.target is set", () => {
    const target = { repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false };
    const model = buildPresentationModel(sampleReport({ target }), OPTS);
    expect(model.metadata.target).toEqual({ available: true, ...target, provenanceKind: "caller-asserted" });
  });

  it("injects rendererVersion/rendererRenderedAt/sourceReportSha256 from opts, never computing them internally", () => {
    const model = buildPresentationModel(sampleReport(), { rendererVersion: "9.9.9", rendererRenderedAt: "2030-01-01T00:00:00.000Z", sourceReportSha256: "b".repeat(64) });
    expect(model.metadata.rendererVersion).toBe("9.9.9");
    expect(model.metadata.rendererRenderedAt).toBe("2030-01-01T00:00:00.000Z");
    expect(model.metadata.sourceReportSha256).toBe("b".repeat(64));
  });
});

describe("buildPresentationModel — metamorphic invariants (spec §8.5)", () => {
  it("domains[i].score === report.score.domainScores[i].score, never recomputed", () => {
    const report = sampleReport();
    const model = buildPresentationModel(report, OPTS);
    expect(model.domains[0].score).toBe(report.score.domainScores[0].score);
  });

  it("executive.verdict === report.releaseEvaluation.result, never re-evaluated", () => {
    const report = sampleReport({ releaseEvaluation: { gate: 4, controlCoverage: 50, confirmedCriticalVulnerabilities: 1, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: ["X"], blockingControlsNotVerified: [], result: "blocked" } });
    const model = buildPresentationModel(report, OPTS);
    expect(model.executive.verdict).toBe("blocked");
  });
});

describe("buildPresentationModel — executive.topPrioritizedFinding", () => {
  it("joins prioritizedFindings[0] with projectFindingSnapshots for severity/type, without inventing a new ranking", () => {
    const report = sampleReport({
      prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 9, title: "Top finding" }],
      projectFindingSnapshots: [findingSnapshot("FND-1", { severity: "critical", type: "confirmed_vulnerability" })],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.executive.topPrioritizedFinding).toEqual({ findingId: "FND-1", title: "Finding FND-1", severity: "critical", type: "confirmed_vulnerability" });
  });

  it("is null when prioritizedFindings is empty", () => {
    const model = buildPresentationModel(sampleReport({ prioritizedFindings: [] }), OPTS);
    expect(model.executive.topPrioritizedFinding).toBeNull();
  });
});

describe("buildPresentationModel — controls", () => {
  it("resolves evidence/riskAcceptance and keeps raw ids alongside the resolved views", () => {
    const report = sampleReport({
      runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { evidenceIds: ["EVD-001"], riskAcceptanceId: "RA-001" })],
      evidenceSnapshots: [{ evidenceId: "EVD-001", type: "CODE", location: "x", description: null, capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "x" }],
      riskAcceptanceSnapshots: [{ riskAcceptanceId: "RA-001", controlId: "CTRL-001", findingIds: [], reason: "r", compensatingControls: [], approvedBy: "x", approvedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z", reviewDate: null, status: "active", revokedAt: null, revokedReason: null }],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].evidenceIds).toEqual(["EVD-001"]);
    expect(model.controls[0].evidence[0].evidenceId).toBe("EVD-001");
    expect(model.controls[0].riskAcceptanceId).toBe("RA-001");
    expect(model.controls[0].riskAcceptance?.riskAcceptanceId).toBe("RA-001");
  });

  it("flags controlDefinitionVersionMismatch and records it in referenceIntegrity.unresolvedControlDefinitions when title is null", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { title: null, domain: null })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].controlDefinitionVersionMismatch).toBe(true);
    expect(model.referenceIntegrity.unresolvedControlDefinitions).toEqual(["CTRL-001"]);
  });

  it("records a missing evidence reference in referenceIntegrity.missingEvidenceIds and omits it from the resolved evidence[] array", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { evidenceIds: ["EVD-404"] })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].evidence).toEqual([]);
    expect(model.referenceIntegrity.missingEvidenceIds).toEqual(["EVD-404"]);
  });

  it("records a missing risk acceptance reference in referenceIntegrity.missingRiskAcceptanceIds", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { riskAcceptanceId: "RA-404" })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].riskAcceptance).toBeNull();
    expect(model.referenceIntegrity.missingRiskAcceptanceIds).toEqual(["RA-404"]);
  });

  it("records a missing finding reference in referenceIntegrity.missingFindingIds", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { findingIds: ["FND-404"] })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.referenceIntegrity.missingFindingIds).toEqual(["FND-404"]);
  });

  it("maps effectiveStatusReason.code through EFFECTIVE_STATUS_REASON_LABELS, never generating prose", () => {
    const report = sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { effectiveStatus: "NOT_TESTED", effectiveStatusReason: { code: "stale_profile" } })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls[0].effectiveStatusReason).toEqual({ code: "stale_profile", label: EFFECTIVE_STATUS_REASON_LABELS.stale_profile });
  });

  it("is sorted by (domain, controlId), with null-domain rows (mismatch cases) sorted after all resolved-domain rows", () => {
    const report = sampleReport({
      runControlAssessmentSnapshots: [
        controlSnapshot("CTRL-003", { domain: "network" }),
        controlSnapshot("CTRL-001", { title: null, domain: null }),
        controlSnapshot("CTRL-002", { domain: "appsec" }),
      ],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.controls.map((c) => c.controlId)).toEqual(["CTRL-002", "CTRL-003", "CTRL-001"]);
  });
});

describe("buildPresentationModel — findings", () => {
  it("includes every projectFindingSnapshots entry, not just the prioritized subset", () => {
    const report = sampleReport({
      prioritizedFindings: [{ findingId: "FND-OPEN", priorityIndex: 0, criticalityIndex: 5, title: "x" }],
      projectFindingSnapshots: [findingSnapshot("FND-OPEN", { status: "open" }), findingSnapshot("FND-RESOLVED", { status: "resolved" })],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.findings.map((f) => f.findingId).sort()).toEqual(["FND-OPEN", "FND-RESOLVED"]);
  });

  it("preserves prioritizedFindings' exact order for the findings it covers, appending the remainder sorted by findingId ascending", () => {
    const report = sampleReport({
      prioritizedFindings: [
        { findingId: "FND-B", priorityIndex: 0, criticalityIndex: 9, title: "b" },
        { findingId: "FND-A", priorityIndex: 1, criticalityIndex: 1, title: "a" },
      ],
      projectFindingSnapshots: [
        findingSnapshot("FND-A"), findingSnapshot("FND-B"), findingSnapshot("FND-Z", { status: "resolved" }), findingSnapshot("FND-C", { status: "resolved" }),
      ],
    });
    const model = buildPresentationModel(report, OPTS);
    expect(model.findings.map((f) => f.findingId)).toEqual(["FND-B", "FND-A", "FND-C", "FND-Z"]);
  });

  it("carries linkedControlIds straight from controlIds, with no resolution or filtering performed here", () => {
    const report = sampleReport({ projectFindingSnapshots: [findingSnapshot("FND-1", { controlIds: ["CTRL-OUTSIDE-THIS-RUN"] })] });
    const model = buildPresentationModel(report, OPTS);
    expect(model.findings[0].linkedControlIds).toEqual(["CTRL-OUTSIDE-THIS-RUN"]);
  });
});

describe("buildPresentationModel — limitations", () => {
  it("emits legacy_provenance_unavailable (info) when target is null, and target_caller_asserted (info) when it is set", () => {
    const legacy = buildPresentationModel(sampleReport({ target: null }), OPTS);
    expect(legacy.limitations.some((l) => l.code === "legacy_provenance_unavailable" && l.severity === "info")).toBe(true);
    const fresh = buildPresentationModel(sampleReport({ target: { repository: "x", commitSha: null, branchOrTag: null, dirty: null } }), OPTS);
    expect(fresh.limitations.some((l) => l.code === "target_caller_asserted" && l.severity === "info")).toBe(true);
  });

  it("emits project_scoped_score_release only when contributingRunIds spans more than one run", () => {
    const single = buildPresentationModel(sampleReport(), OPTS);
    expect(single.limitations.some((l) => l.code === "project_scoped_score_release")).toBe(false);
    const multi = buildPresentationModel(sampleReport({
      assessmentScopes: {
        ...sampleReport().assessmentScopes,
        score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] },
        releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] },
      },
    }), OPTS);
    expect(multi.limitations.some((l) => l.code === "project_scoped_score_release" && l.severity === "info")).toBe(true);
  });

  it("emits control_definition_version_mismatch (warning) only when a mismatch exists", () => {
    const clean = buildPresentationModel(sampleReport(), OPTS);
    expect(clean.limitations.some((l) => l.code === "control_definition_version_mismatch")).toBe(false);
    const mismatched = buildPresentationModel(sampleReport({ runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { title: null, domain: null })] }), OPTS);
    expect(mismatched.limitations.some((l) => l.code === "control_definition_version_mismatch" && l.severity === "warning")).toBe(true);
  });

  it("emits missing_evidence/missing_risk_acceptance/missing_finding_reference (warning) only when the corresponding referenceIntegrity list is non-empty", () => {
    const model = buildPresentationModel(sampleReport({
      runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { evidenceIds: ["EVD-404"], riskAcceptanceId: "RA-404", findingIds: ["FND-404"] })],
    }), OPTS);
    expect(model.limitations.filter((l) => l.severity === "warning").map((l) => l.code).sort()).toEqual(
      ["missing_evidence", "missing_finding_reference", "missing_risk_acceptance"]
    );
  });

  it("is sorted with every warning before every info", () => {
    const model = buildPresentationModel(sampleReport({
      target: null,
      runControlAssessmentSnapshots: [controlSnapshot("CTRL-001", { title: null, domain: null })],
    }), OPTS);
    const severities = model.limitations.map((l) => l.severity);
    const firstInfoIndex = severities.indexOf("info");
    const lastWarningIndex = severities.lastIndexOf("warning");
    expect(firstInfoIndex === -1 || lastWarningIndex === -1 || lastWarningIndex < firstInfoIndex).toBe(true);
  });

  it("always includes rounded_display_values (info)", () => {
    const model = buildPresentationModel(sampleReport(), OPTS);
    expect(model.limitations.some((l) => l.code === "rounded_display_values" && l.severity === "info")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/presentation-model.test.ts`
Expected: FAIL — `src/core/presentation-model.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement `src/core/presentation-model.ts`**

Create `src/core/presentation-model.ts`:

```ts
import type {
  ProjectReport, EvidenceSnapshot, RiskAcceptanceSnapshot, AssessmentScopes,
} from "./report-builder.js";
import type { EffectiveStatusReasonCode } from "./risk-acceptance.js";

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const EFFECTIVE_STATUS_REASON_LABELS: Record<EffectiveStatusReasonCode, string> = {
  stale_profile: "Assessment predates the report run's current profile state",
  risk_acceptance_missing: "No risk acceptance record found for this control",
  risk_acceptance_expired: "Risk acceptance was no longer valid at evaluation time",
  risk_acceptance_revoked: "Risk acceptance was revoked before evaluation time",
  risk_acceptance_scope_mismatch: "Risk acceptance does not cover this control/finding",
};

export interface PresentationModelMetadataTarget {
  available: boolean;
  repository: string | null;
  commitSha: string | null;
  branchOrTag: string | null;
  dirty: boolean | null;
  provenanceKind: "caller-asserted" | "legacy-unavailable";
}

export interface PresentationModelMetadata {
  reportId: string;
  reportSchemaVersion: string;
  projectId: string;
  projectName: string;
  assessmentRunId: string;
  reportGeneratedAt: string;
  engineVersionAtRunStart: string | null;
  profileRevision: number;
  catalogVersion: string;
  criticalityFormula: { id: string; version: string };
  scoreModel: { id: string; version: string };
  rendererVersion: string;
  rendererRenderedAt: string;
  sourceReportSha256: string;
  target: PresentationModelMetadataTarget;
}

export interface DomainPresentation {
  domain: string;
  score: number;
  coverage: { percent: number; assessed: number; applicable: number };
}

export interface ControlRowEffectiveStatusReason {
  code: EffectiveStatusReasonCode;
  label: string;
  detail?: string;
}

export interface ControlRow {
  controlId: string;
  controlVersion: number;
  runId: string;
  title: string | null;
  domain: string | null;
  controlDefinitionVersionMismatch: boolean;
  recordedStatus: ProjectReport["runControlAssessmentSnapshots"][number]["recordedStatus"];
  effectiveStatus: ProjectReport["runControlAssessmentSnapshots"][number]["effectiveStatus"];
  effectiveStatusReason: ControlRowEffectiveStatusReason | null;
  assessedAt: string;
  assessedBy: string;
  owner: string;
  nextReviewAt: string | null;
  notes: string | null;
  evidenceIds: string[];
  evidence: EvidenceSnapshot[];
  riskAcceptanceId: string | null;
  riskAcceptance: RiskAcceptanceSnapshot | null;
  findingIds: string[];
}

export interface FindingCard {
  findingId: string;
  title: string;
  type: ProjectReport["projectFindingSnapshots"][number]["type"];
  severity: ProjectReport["projectFindingSnapshots"][number]["severity"];
  status: ProjectReport["projectFindingSnapshots"][number]["status"];
  priorityIndex: number;
  criticalityIndex: number;
  attackScenario: string | null;
  exploitabilityEvidence: string | null;
  linkedControlIds: string[];
}

export interface ReferenceIntegrity {
  missingEvidenceIds: string[];
  missingRiskAcceptanceIds: string[];
  missingFindingIds: string[];
  unresolvedControlDefinitions: string[];
}

export type PresentationLimitationCode =
  | "legacy_provenance_unavailable"
  | "target_caller_asserted"
  | "project_scoped_findings"
  | "project_scoped_score_release"
  | "control_definition_version_mismatch"
  | "rounded_display_values"
  | "missing_evidence"
  | "missing_risk_acceptance"
  | "missing_finding_reference";

export interface PresentationLimitation {
  code: PresentationLimitationCode;
  severity: "info" | "warning";
  message: string;
}

export interface PresentationModel {
  metadata: PresentationModelMetadata;
  executive: {
    verdict: ProjectReport["releaseEvaluation"]["result"];
    coverage: { percent: number; assessed: number; applicable: number };
    confirmedCritical: number;
    confirmedHigh: number;
    blockingControlFailures: string[];
    blockingControlsNotVerified: string[];
    topPrioritizedFinding: {
      findingId: string;
      title: string;
      severity: ProjectReport["projectFindingSnapshots"][number]["severity"];
      type: ProjectReport["projectFindingSnapshots"][number]["type"];
    } | null;
  };
  domains: DomainPresentation[];
  controls: ControlRow[];
  findings: FindingCard[];
  evidence: EvidenceSnapshot[];
  riskAcceptances: RiskAcceptanceSnapshot[];
  referenceIntegrity: ReferenceIntegrity;
  limitations: PresentationLimitation[];
  assessmentScopes: AssessmentScopes;
}

const LIMITATION_CODE_ORDER: PresentationLimitationCode[] = [
  "legacy_provenance_unavailable", "target_caller_asserted", "project_scoped_findings",
  "project_scoped_score_release", "control_definition_version_mismatch", "rounded_display_values",
  "missing_evidence", "missing_risk_acceptance", "missing_finding_reference",
];
const SEVERITY_RANK: Record<"warning" | "info", number> = { warning: 0, info: 1 };

function buildLimitations(report: ProjectReport, referenceIntegrity: ReferenceIntegrity): PresentationLimitation[] {
  const limitations: PresentationLimitation[] = [];

  if (report.target === null) {
    limitations.push({
      code: "legacy_provenance_unavailable", severity: "info",
      message: "This report was generated from a legacy assessment run with no recorded target/profile/engine-version provenance.",
    });
  } else {
    limitations.push({
      code: "target_caller_asserted", severity: "info",
      message: "The assessment target (repository/commit/branch) is caller-asserted and not independently verified by this server.",
    });
  }

  limitations.push({
    code: "project_scoped_findings", severity: "info",
    message: "Findings are project-scoped and may include findings recorded under a different assessment run than this report's.",
  });

  if (report.assessmentScopes.score.contributingRunIds.length > 1) {
    limitations.push({
      code: "project_scoped_score_release", severity: "info",
      message: `The score and release verdict draw on control assessments from ${report.assessmentScopes.score.contributingRunIds.length} assessment runs (${report.assessmentScopes.score.contributingRunIds.join(", ")}), not only this report's own run.`,
    });
  }

  if (referenceIntegrity.unresolvedControlDefinitions.length > 0) {
    limitations.push({
      code: "control_definition_version_mismatch", severity: "warning",
      message: `The current control catalog no longer matches the assessed version for: ${referenceIntegrity.unresolvedControlDefinitions.join(", ")}. Title/domain are withheld for these controls rather than showing a possibly-different later definition.`,
    });
  }

  limitations.push({
    code: "rounded_display_values", severity: "info",
    message: "Score and coverage percentages are rounded to 2 decimal places for display; the release verdict was computed from unrounded values.",
  });

  if (referenceIntegrity.missingEvidenceIds.length > 0) {
    limitations.push({ code: "missing_evidence", severity: "warning", message: `Referenced but not found in this report: ${referenceIntegrity.missingEvidenceIds.join(", ")}.` });
  }
  if (referenceIntegrity.missingRiskAcceptanceIds.length > 0) {
    limitations.push({ code: "missing_risk_acceptance", severity: "warning", message: `Referenced but not found in this report: ${referenceIntegrity.missingRiskAcceptanceIds.join(", ")}.` });
  }
  if (referenceIntegrity.missingFindingIds.length > 0) {
    limitations.push({ code: "missing_finding_reference", severity: "warning", message: `Referenced but not found in this report: ${referenceIntegrity.missingFindingIds.join(", ")}.` });
  }

  return limitations.sort((a, b) => {
    const severityCompare = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityCompare !== 0) return severityCompare;
    return LIMITATION_CODE_ORDER.indexOf(a.code) - LIMITATION_CODE_ORDER.indexOf(b.code);
  });
}

export function buildPresentationModel(
  report: ProjectReport,
  opts: { rendererVersion: string; rendererRenderedAt: string; sourceReportSha256: string }
): PresentationModel {
  const metadata: PresentationModelMetadata = {
    reportId: report.reportId,
    reportSchemaVersion: report.reportSchemaVersion,
    projectId: report.projectId,
    projectName: report.projectName,
    assessmentRunId: report.assessmentRunId,
    reportGeneratedAt: report.generatedAt,
    engineVersionAtRunStart: report.engineVersionAtRunStart,
    profileRevision: report.profileRevision,
    catalogVersion: report.catalogVersion,
    criticalityFormula: report.criticalityFormula,
    scoreModel: report.score.scoreModel,
    rendererVersion: opts.rendererVersion,
    rendererRenderedAt: opts.rendererRenderedAt,
    sourceReportSha256: opts.sourceReportSha256,
    target: report.target === null
      ? { available: false, repository: null, commitSha: null, branchOrTag: null, dirty: null, provenanceKind: "legacy-unavailable" }
      : {
          available: true, repository: report.target.repository, commitSha: report.target.commitSha,
          branchOrTag: report.target.branchOrTag, dirty: report.target.dirty, provenanceKind: "caller-asserted",
        },
  };

  const findingById = new Map(report.projectFindingSnapshots.map((f) => [f.findingId, f]));
  const topEntry = report.prioritizedFindings[0];
  const topFinding = topEntry ? findingById.get(topEntry.findingId) : undefined;

  const executive = {
    verdict: report.releaseEvaluation.result,
    coverage: {
      percent: report.score.coverage.coveragePercent,
      assessed: report.score.coverage.assessedControls,
      applicable: report.score.coverage.applicableControls,
    },
    confirmedCritical: report.releaseEvaluation.confirmedCriticalVulnerabilities,
    confirmedHigh: report.releaseEvaluation.confirmedHighVulnerabilities,
    blockingControlFailures: [...report.releaseEvaluation.blockingControlFailures],
    blockingControlsNotVerified: [...report.releaseEvaluation.blockingControlsNotVerified],
    topPrioritizedFinding: topFinding
      ? { findingId: topFinding.findingId, title: topFinding.title, severity: topFinding.severity, type: topFinding.type }
      : null,
  };

  const domains: DomainPresentation[] = report.score.domainScores
    .map((d) => ({
      domain: d.domain,
      score: d.score,
      coverage: { percent: d.coveragePercent, assessed: d.assessedControls, applicable: d.applicableControls },
    }))
    .sort((a, b) => compareAscii(a.domain, b.domain));

  const evidenceById = new Map(report.evidenceSnapshots.map((e) => [e.evidenceId, e]));
  const riskAcceptanceById = new Map(report.riskAcceptanceSnapshots.map((r) => [r.riskAcceptanceId, r]));
  const knownFindingIds = new Set(report.projectFindingSnapshots.map((f) => f.findingId));

  const missingEvidenceIds = new Set<string>();
  const missingRiskAcceptanceIds = new Set<string>();
  const missingFindingIds = new Set<string>();
  const unresolvedControlDefinitions = new Set<string>();

  const controls: ControlRow[] = report.runControlAssessmentSnapshots.map((snapshot) => {
    const mismatch = snapshot.title === null;
    if (mismatch) unresolvedControlDefinitions.add(snapshot.controlId);

    const evidence: EvidenceSnapshot[] = [];
    for (const id of snapshot.evidenceIds) {
      const found = evidenceById.get(id);
      if (found) evidence.push(found);
      else missingEvidenceIds.add(id);
    }
    evidence.sort((a, b) => compareAscii(a.evidenceId, b.evidenceId));

    let riskAcceptance: RiskAcceptanceSnapshot | null = null;
    if (snapshot.riskAcceptanceId !== null) {
      const found = riskAcceptanceById.get(snapshot.riskAcceptanceId);
      if (found) riskAcceptance = found;
      else missingRiskAcceptanceIds.add(snapshot.riskAcceptanceId);
    }

    for (const findingId of snapshot.findingIds) {
      if (!knownFindingIds.has(findingId)) missingFindingIds.add(findingId);
    }

    return {
      controlId: snapshot.controlId,
      controlVersion: snapshot.controlVersion,
      runId: snapshot.runId,
      title: snapshot.title,
      domain: snapshot.domain,
      controlDefinitionVersionMismatch: mismatch,
      recordedStatus: snapshot.recordedStatus,
      effectiveStatus: snapshot.effectiveStatus,
      effectiveStatusReason: snapshot.effectiveStatusReason
        ? {
            code: snapshot.effectiveStatusReason.code,
            label: EFFECTIVE_STATUS_REASON_LABELS[snapshot.effectiveStatusReason.code],
            ...(snapshot.effectiveStatusReason.detail !== undefined ? { detail: snapshot.effectiveStatusReason.detail } : {}),
          }
        : null,
      assessedAt: snapshot.assessedAt,
      assessedBy: snapshot.assessedBy,
      owner: snapshot.owner,
      nextReviewAt: snapshot.nextReviewAt,
      notes: snapshot.notes,
      evidenceIds: [...snapshot.evidenceIds],
      evidence,
      riskAcceptanceId: snapshot.riskAcceptanceId,
      riskAcceptance,
      findingIds: [...snapshot.findingIds],
    };
  });

  controls.sort((a, b) => {
    if (a.domain === null && b.domain !== null) return 1;
    if (a.domain !== null && b.domain === null) return -1;
    if (a.domain !== null && b.domain !== null) {
      const domainCompare = compareAscii(a.domain, b.domain);
      if (domainCompare !== 0) return domainCompare;
    }
    return compareAscii(a.controlId, b.controlId);
  });

  const prioritizedIds = new Set(report.prioritizedFindings.map((f) => f.findingId));
  const prioritizedOrder = report.prioritizedFindings.map((f) => f.findingId);
  const remainder = report.projectFindingSnapshots
    .map((f) => f.findingId)
    .filter((id) => !prioritizedIds.has(id))
    .sort(compareAscii);
  const findingOrder = [...prioritizedOrder, ...remainder];

  const findings: FindingCard[] = findingOrder.map((findingId) => {
    const f = findingById.get(findingId)!;
    return {
      findingId: f.findingId,
      title: f.title,
      type: f.type,
      severity: f.severity,
      status: f.status,
      priorityIndex: f.priorityIndex,
      criticalityIndex: f.criticalityIndex,
      attackScenario: f.attackScenario ?? null,
      exploitabilityEvidence: f.exploitabilityEvidence ?? null,
      linkedControlIds: [...f.controlIds],
    };
  });

  const evidence = [...report.evidenceSnapshots].sort((a, b) => compareAscii(a.evidenceId, b.evidenceId));
  const riskAcceptances = [...report.riskAcceptanceSnapshots].sort((a, b) => compareAscii(a.riskAcceptanceId, b.riskAcceptanceId));

  const referenceIntegrity: ReferenceIntegrity = {
    missingEvidenceIds: [...missingEvidenceIds].sort(compareAscii),
    missingRiskAcceptanceIds: [...missingRiskAcceptanceIds].sort(compareAscii),
    missingFindingIds: [...missingFindingIds].sort(compareAscii),
    unresolvedControlDefinitions: [...unresolvedControlDefinitions].sort(compareAscii),
  };

  const limitations = buildLimitations(report, referenceIntegrity);

  return {
    metadata, executive, domains, controls, findings, evidence, riskAcceptances,
    referenceIntegrity, limitations, assessmentScopes: report.assessmentScopes,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/presentation-model.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/core/presentation-model.ts tests/core/presentation-model.test.ts
git commit -m "feat(presentation): add buildPresentationModel pure projection from ProjectReport"
```

---

### Task 4: Self-contained HTML renderer — escaping, vendored D3, and the 7-section report

**Files:**
- Create: `src/core/html-escape.ts`
- Create: `src/assets/d3.v7.min.js` (vendored static asset, downloaded once — not hand-written)
- Create: `src/core/report-html-renderer.ts`
- Test: `tests/core/html-escape.test.ts`
- Test: `tests/core/report-html-renderer.test.ts`

**Interfaces:**
- Consumes: `PresentationModel` and all its sub-types (Task 3).
- Produces (for Task 5): `renderReportHtml(model: PresentationModel, opts: { d3Source: string }): string` and `REPORT_HTML_RENDERER_VERSION: string`, both from `src/core/report-html-renderer.ts`. The vendored D3 source file at `src/assets/d3.v7.min.js`, read by Task 5's composition root.

**Scope note on §6.2's optional Control Matrix mini-heatmap:** the spec explicitly marks the D3 heatmap over the Control Matrix as optional supplementary ("may sit above it... supplementary only"), with the semantic `<table>` as the sole authoritative representation. This task implements the required D3 usage (the Priority×Criticality scatter, §6.3) and deliberately does **not** implement the optional heatmap — every data point it would show is already in the table, so skipping it costs no information and keeps this task's scope bounded. This is a judgment call worth surfacing in this plan's GPT review round, not a silently dropped requirement.

- [ ] **Step 1: Write failing tests for the escaping helpers**

Create `tests/core/html-escape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeHtmlText, escapeHtmlAttribute, escapeUrlAttribute, escapeForInlineScriptJson } from "../../src/core/html-escape.js";

describe("escapeHtmlText", () => {
  it("escapes <, >, and &", () => {
    expect(escapeHtmlText("<script>alert(1)</script> & co")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
  });

  it("leaves quotes untouched (not needed in text node context)", () => {
    expect(escapeHtmlText(`it's "fine"`)).toBe(`it's "fine"`);
  });
});

describe("escapeHtmlAttribute", () => {
  it("escapes <, >, &, \", and '", () => {
    expect(escapeHtmlAttribute(`<a href="x">it's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;it&#39;s&lt;/a&gt;");
  });
});

describe("escapeUrlAttribute", () => {
  it("allows a fragment-only href unchanged (just attribute-escaped)", () => {
    expect(escapeUrlAttribute("#control-CTRL-001")).toBe("#control-CTRL-001");
  });

  it("allows http/https/mailto absolute URLs", () => {
    expect(escapeUrlAttribute("https://example.com/x")).toBe("https://example.com/x");
    expect(escapeUrlAttribute("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("neutralizes a javascript: URL to a safe fragment", () => {
    expect(escapeUrlAttribute("javascript:alert(1)")).toBe("#");
  });

  it("neutralizes an unparseable string to a safe fragment", () => {
    expect(escapeUrlAttribute("not a url at all")).toBe("#");
  });
});

describe("escapeForInlineScriptJson", () => {
  it("replaces <, >, &, U+2028, U+2029 with their literal 6-character \\uXXXX escape sequences", () => {
    const input = JSON.stringify({ x: "</script><script>&  " });
    const result = escapeForInlineScriptJson(input);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("&");
    expect(result).not.toContain(" ");
    expect(result).not.toContain(" ");
    expect(result).toContain("\\u003c");
    expect(result).toContain("\\u003e");
    expect(result).toContain("\\u0026");
    expect(result).toContain("\\u2028");
    expect(result).toContain("\\u2029");
  });

  it("the escaped output, when embedded as a JS string literal and evaluated, reconstructs the original JSON text", () => {
    const original = { title: "</script><script>alert(1)</script> payload" };
    const originalJson = JSON.stringify(original);
    const escaped = escapeForInlineScriptJson(originalJson);
    const reconstructed = new Function(`return "${escaped.replace(/"/g, '\\"')}";`)();
    expect(JSON.parse(reconstructed)).toEqual(original);
  });

  it("leaves ordinary JSON content (no special characters) unchanged", () => {
    const input = JSON.stringify({ a: 1, b: "plain text" });
    expect(escapeForInlineScriptJson(input)).toBe(input);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/html-escape.test.ts`
Expected: FAIL — `src/core/html-escape.ts` does not exist.

- [ ] **Step 3: Implement `src/core/html-escape.ts`**

Create `src/core/html-escape.ts`:

```ts
export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Every href this renderer emits from report data is a fragment-only internal anchor
// (#control-CTRL-001, #finding-FND-001); this allow-list is defense-in-depth per spec §8.1,
// not something the current renderer's own hrefs require beyond the fragment case.
export function escapeUrlAttribute(value: string): string {
  if (value.startsWith("#")) return escapeHtmlAttribute(value);
  try {
    const url = new URL(value);
    if (SAFE_URL_PROTOCOLS.has(url.protocol)) return escapeHtmlAttribute(value);
  } catch {
    // not a parseable absolute URL — falls through to the safe fallback below
  }
  return "#";
}

const SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  " ": "\\u2028",
  " ": "\\u2029",
};

export function escapeForInlineScriptJson(json: string): string {
  return json.replace(/[<>&  ]/g, (ch) => SCRIPT_ESCAPES[ch]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/html-escape.test.ts`
Expected: PASS

- [ ] **Step 5: Vendor D3 v7 — exact version pin, integrity hash, and license**

Run:

```bash
mkdir -p src/assets
curl -fsSL -o src/assets/d3.v7.min.js https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
curl -fsSL -o src/assets/d3.v7.LICENSE https://raw.githubusercontent.com/d3/d3/v7.9.0/LICENSE
shasum -a 256 src/assets/d3.v7.min.js | awk '{print $1}' > src/assets/d3.v7.min.js.sha256
wc -c src/assets/d3.v7.min.js
cat src/assets/d3.v7.min.js.sha256
```

Expected: the download succeeds, the file is roughly 250–290 KB, and `d3.v7.min.js.sha256` contains a 64-character hex digest. All three files (`d3.v7.min.js`, `d3.v7.LICENSE`, `d3.v7.min.js.sha256`) are committed to the repository — the pinned exact version (`7.9.0`, not a floating `@7`) and the recorded hash mean a future re-vendoring can be verified (`shasum -a 256 -c src/assets/d3.v7.min.js.sha256`) rather than trusted blindly, and the vendored `LICENSE` file satisfies D3's ISC license attribution requirement for redistributing its source. This file is read from disk at `generate_report_html` call time (Task 5) and inlined verbatim into the generated HTML's own `<script>` tag — it is never fetched from a CDN at report-generation time or at report-viewing time; the one-time `curl` calls above are a build-time vendoring step run by whoever implements this task, not something the running server ever does.

- [ ] **Step 6: Write failing structural/escaping tests for `renderReportHtml`**

Create `tests/core/report-html-renderer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderReportHtml, REPORT_HTML_RENDERER_VERSION } from "../../src/core/report-html-renderer.js";
import type { PresentationModel } from "../../src/core/presentation-model.js";

const D3_STUB = "/* d3 stub for tests */ var d3 = { select: function () { return { append: function () { return this; }, attr: function () { return this; }, call: function () { return this; }, text: function(){return this;}, selectAll: function () { return { data: function () { return this; }, join: function () { return this; } }; } }; }, scaleLinear: function () { return { domain: function () { return this; }, range: function () { return this; } }; }, axisBottom: function () { return { ticks: function () { return this; } }; }, axisLeft: function () { return { ticks: function () { return this; } }; } };";

function sampleModel(overrides: Partial<PresentationModel> = {}): PresentationModel {
  return {
    metadata: {
      reportId: "REP-1", reportSchemaVersion: "2.1.0", projectId: "PRJ-1", projectName: "Demo <Project> & Co",
      assessmentRunId: "RUN-1", reportGeneratedAt: "2026-10-08T00:00:00.000Z", engineVersionAtRunStart: "0.10.0",
      profileRevision: 1, catalogVersion: "9.9.9", criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" }, rendererVersion: REPORT_HTML_RENDERER_VERSION,
      rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64),
      target: { available: true, repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false, provenanceKind: "caller-asserted" },
    },
    executive: {
      verdict: "approved", coverage: { percent: 100, assessed: 1, applicable: 1 },
      confirmedCritical: 0, confirmedHigh: 0, blockingControlFailures: [], blockingControlsNotVerified: [],
      topPrioritizedFinding: null,
    },
    domains: [{ domain: "appsec", score: 100, coverage: { percent: 100, assessed: 1, applicable: 1 } }],
    controls: [{
      controlId: "CTRL-001", controlVersion: 1, runId: "RUN-1", title: "Title", domain: "appsec",
      controlDefinitionVersionMismatch: false, recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      assessedAt: "2026-10-07T00:00:00.000Z", assessedBy: "x", owner: "x", nextReviewAt: null, notes: null,
      evidenceIds: [], evidence: [], riskAcceptanceId: null, riskAcceptance: null, findingIds: [],
    }],
    findings: [{
      findingId: "FND-1", title: "<script>alert(1)</script> XSS payload", type: "confirmed_vulnerability",
      severity: "critical", status: "open", priorityIndex: 0, criticalityIndex: 9,
      attackScenario: "An attacker does </script><script>window.__X__=1</script>", exploitabilityEvidence: null,
      linkedControlIds: ["CTRL-001"],
    }],
    evidence: [], riskAcceptances: [],
    referenceIntegrity: { missingEvidenceIds: [], missingRiskAcceptanceIds: [], missingFindingIds: [], unresolvedControlDefinitions: [] },
    limitations: [{ code: "target_caller_asserted", severity: "info", message: "info message" }],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" },
      score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
      riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
    ...overrides,
  };
}

describe("renderReportHtml — structure and escaping", () => {
  it("includes the zero-network CSP meta tag verbatim", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy"`);
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain(`script-src 'unsafe-inline'`);
  });

  it("escapes a finding title containing HTML special characters as text, never raw", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; XSS payload");
    expect(html).not.toContain("<script>alert(1)</script> XSS payload");
  });

  it("escapes projectName in the <title> element", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain("<title>Demo &lt;Project&gt; &amp; Co");
  });

  it("the embedded report-data JSON payload contains no literal </script sequence from report data", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    const dataBlockMatch = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
    expect(dataBlockMatch).toBeTruthy();
    expect(dataBlockMatch![1]).not.toContain("</script");
  });

  it("includes the vendored D3 source inline, not a CDN <script src>", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain(D3_STUB);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("includes semantic landmarks (header, nav, main, footer)", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toMatch(/<header/);
    expect(html).toMatch(/<nav/);
    expect(html).toMatch(/<main/);
    expect(html).toMatch(/<footer/);
  });

  it('the Control Matrix table uses th scope="col" header cells', () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain(`<th scope="col">Control</th>`);
  });

  it("includes an @media print rule that forces closed <details> content visible", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toMatch(/@media print[\s\S]*details:not\(\[open\]\)/);
  });

  it("renders a legacy-unavailable target badge when metadata.target.available is false", () => {
    const model = sampleModel({
      metadata: { ...sampleModel().metadata, target: { available: false, repository: null, commitSha: null, branchOrTag: null, dirty: null, provenanceKind: "legacy-unavailable" } },
    });
    const html = renderReportHtml(model, { d3Source: D3_STUB });
    expect(html).toContain("target provenance unavailable");
  });

  it("is a pure function: same model and opts produce byte-identical output", () => {
    const model = sampleModel();
    expect(renderReportHtml(model, { d3Source: D3_STUB })).toBe(renderReportHtml(model, { d3Source: D3_STUB }));
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/core/report-html-renderer.test.ts`
Expected: FAIL — `src/core/report-html-renderer.ts` does not exist.

- [ ] **Step 8: Implement `src/core/report-html-renderer.ts`**

Create `src/core/report-html-renderer.ts`:

```ts
import type { PresentationModel } from "./presentation-model.js";
import {
  escapeHtmlText as text,
  escapeHtmlAttribute as attr,
  escapeUrlAttribute as href,
  escapeForInlineScriptJson,
} from "./html-escape.js";

export const REPORT_HTML_RENDERER_VERSION = "1.0.0";

const VERDICT_COLORS: Record<string, string> = { approved: "#1b7f3a", blocked: "#c0392b", indeterminate: "#b7791f" };

function renderHeader(model: PresentationModel): string {
  const verdictColor = VERDICT_COLORS[model.executive.verdict] ?? "#6b7280";
  const t = model.metadata.target;
  const targetBlock = t.available
    ? `<p class="target">Target: <code>${text(t.repository ?? "")}</code>` +
      (t.commitSha ? ` @ <code>${text(t.commitSha)}</code>` : "") +
      (t.branchOrTag ? ` (${text(t.branchOrTag)})` : "") +
      (t.dirty ? ` <span class="badge badge-warning">dirty working tree</span>` : "") +
      `</p>`
    : `<p class="target badge badge-info">Legacy assessment — target provenance unavailable</p>`;
  return `<header>
  <h1>${text(model.metadata.projectName)}</h1>
  <p class="verdict" style="--verdict-color:${verdictColor}">${text(model.executive.verdict.toUpperCase())}</p>
  ${targetBlock}
  <p class="run-meta">Run <code>${text(model.metadata.assessmentRunId)}</code>${
    model.metadata.engineVersionAtRunStart ? ` · engine ${text(model.metadata.engineVersionAtRunStart)}` : ""
  } · generated ${text(model.metadata.reportGeneratedAt)}</p>
</header>`;
}

function renderExecutiveSummary(model: PresentationModel): string {
  const e = model.executive;
  const failuresList = e.blockingControlFailures.length
    ? `<ul>${e.blockingControlFailures.map((id) => `<li><a href="${href(`#control-${id}`)}">${text(id)}</a></li>`).join("")}</ul>`
    : `<p>None.</p>`;
  const notVerifiedList = e.blockingControlsNotVerified.length
    ? `<ul>${e.blockingControlsNotVerified.map((id) => `<li><a href="${href(`#control-${id}`)}">${text(id)}</a></li>`).join("")}</ul>`
    : `<p>None.</p>`;
  const topFindingBlock = e.topPrioritizedFinding
    ? `<p><a href="${href(`#finding-${e.topPrioritizedFinding.findingId}`)}">${text(e.topPrioritizedFinding.title)}</a> (${text(e.topPrioritizedFinding.severity)} / ${text(e.topPrioritizedFinding.type)})</p>`
    : `<p>No prioritized findings.</p>`;
  return `<section id="executive-summary" aria-labelledby="executive-summary-heading">
  <h2 id="executive-summary-heading">Executive Summary</h2>
  <dl class="kpi-grid">
    <div class="kpi"><dt>Verdict</dt><dd>${text(e.verdict)}</dd></div>
    <div class="kpi"><dt>Coverage</dt><dd>${e.coverage.percent}% (${e.coverage.assessed}/${e.coverage.applicable})</dd></div>
    <div class="kpi"><dt>Confirmed critical</dt><dd>${e.confirmedCritical}</dd></div>
    <div class="kpi"><dt>Confirmed high</dt><dd>${e.confirmedHigh}</dd></div>
  </dl>
  <h3>Blocking control failures</h3>
  ${failuresList}
  <h3>Blocking controls not verified</h3>
  ${notVerifiedList}
  <h3>Top prioritized finding</h3>
  ${topFindingBlock}
</section>`;
}

function renderDomainOverview(model: PresentationModel): string {
  const rows = model.domains
    .map(
      (d) => `
    <div class="domain-row">
      <span class="domain-name">${text(d.domain)}</span>
      <div class="bar" role="img" aria-label="${attr(`${d.domain} score ${d.score} out of 100, coverage ${d.coverage.percent} percent`)}">
        <div class="bar-fill" style="width:${d.score}%"></div>
      </div>
      <span class="domain-numbers">${d.score} / 100 · ${d.coverage.percent}% coverage (${d.coverage.assessed}/${d.coverage.applicable})</span>
    </div>`
    )
    .join("");
  return `<section id="domain-overview" aria-labelledby="domain-overview-heading">
  <h2 id="domain-overview-heading">Domain Overview</h2>
  ${rows}
</section>`;
}

function renderControlMatrix(model: PresentationModel): string {
  const rows = model.controls
    .map((c) => {
      const reasonCell = c.effectiveStatusReason
        ? `<span class="reason-badge" title="${attr(c.effectiveStatusReason.detail ?? c.effectiveStatusReason.label)}">${text(c.effectiveStatusReason.label)}</span>`
        : "";
      const mismatchBadge = c.controlDefinitionVersionMismatch
        ? `<span class="badge badge-warning">Control definition unavailable</span>`
        : "";
      const evidenceCell = c.evidence.length
        ? `<a href="${href(`#evidence-${c.evidence[0].evidenceId}`)}">${c.evidence.length} evidence</a>`
        : c.evidenceIds.length
          ? `<span class="badge badge-warning">${c.evidenceIds.length} missing</span>`
          : "—";
      const findingsCell = c.findingIds.length
        ? c.findingIds.map((id) => `<a href="${href(`#finding-${id}`)}">${text(id)}</a>`).join(", ")
        : "—";
      return `<tr id="control-${attr(c.controlId)}" data-effective-status="${attr(c.effectiveStatus)}">
      <th scope="row">${text(c.title ?? c.controlId)} ${mismatchBadge}</th>
      <td>${text(c.recordedStatus)}</td>
      <td class="status-${attr(c.effectiveStatus)}">${text(c.effectiveStatus)} ${c.recordedStatus !== c.effectiveStatus ? "↺" : ""}</td>
      <td>${reasonCell}</td>
      <td>${evidenceCell}</td>
      <td>${findingsCell}</td>
    </tr>`;
    })
    .join("");
  return `<section id="control-matrix" aria-labelledby="control-matrix-heading">
  <h2 id="control-matrix-heading">Control Matrix</h2>
  <div class="table-scroll">
  <table>
    <caption>Effective status reflects what the engine actually used for score/verdict; hover the reason badge for detail.</caption>
    <thead><tr>
      <th scope="col">Control</th><th scope="col">Recorded</th><th scope="col">Effective</th>
      <th scope="col">Reason</th><th scope="col">Evidence</th><th scope="col">Findings</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
</section>`;
}

function renderFindings(model: PresentationModel): string {
  const knownControlIds = new Set(model.controls.map((c) => c.controlId));
  const cards = model.findings
    .map((f) => {
      const linkedControls =
        f.linkedControlIds
          .map((id) => (knownControlIds.has(id) ? `<a href="${href(`#control-${id}`)}">${text(id)}</a>` : text(id)))
          .join(", ") || "—";
      return `<details id="finding-${attr(f.findingId)}" class="finding-card severity-${attr(f.severity)}" data-status="${attr(f.status)}">
      <summary>
        <span class="badge badge-severity">${text(f.severity)}</span>
        <span class="badge badge-status">${text(f.status)}</span>
        <span class="finding-title">${text(f.title)}</span>
      </summary>
      <dl>
        <dt>Type</dt><dd>${text(f.type)}</dd>
        <dt>Priority index</dt><dd>${f.priorityIndex}</dd>
        <dt>Criticality index</dt><dd>${f.criticalityIndex}</dd>
        <dt>Linked controls</dt><dd>${linkedControls}</dd>
        ${f.attackScenario ? `<dt>Attack scenario</dt><dd>${text(f.attackScenario)}</dd>` : ""}
        ${f.exploitabilityEvidence ? `<dt>Exploitability evidence</dt><dd>${text(f.exploitabilityEvidence)}</dd>` : ""}
      </dl>
    </details>`;
    })
    .join("");
  return `<section id="findings" aria-labelledby="findings-heading">
  <h2 id="findings-heading">Findings</h2>
  <div role="group" aria-label="Finding status filter">
    <button type="button" data-filter="all">All</button>
    <button type="button" data-filter="open">Open / In progress</button>
  </div>
  <p id="findings-filter-status" aria-live="polite">Showing ${model.findings.length} of ${model.findings.length} findings</p>
  <div id="findings-list">${cards}</div>
  <h3>Prioritization Map</h3>
  <p>Priority index and criticality index are both bounded integers (0–9), not continuous risk scores.</p>
  <svg id="priority-criticality-scatter" viewBox="0 0 480 320" role="img" aria-label="Priority versus criticality scatter plot of findings">
    <title>Priority versus criticality scatter plot</title>
  </svg>
</section>`;
}

function renderEvidenceAndRiskAcceptance(model: PresentationModel): string {
  const controlsByEvidenceId = new Map<string, string[]>();
  const controlsByRiskAcceptanceId = new Map<string, string[]>();
  for (const c of model.controls) {
    for (const id of c.evidenceIds) controlsByEvidenceId.set(id, [...(controlsByEvidenceId.get(id) ?? []), c.controlId]);
    if (c.riskAcceptanceId) controlsByRiskAcceptanceId.set(c.riskAcceptanceId, [...(controlsByRiskAcceptanceId.get(c.riskAcceptanceId) ?? []), c.controlId]);
  }

  const evidenceCards = model.evidence
    .map((e) => {
      const refs = (controlsByEvidenceId.get(e.evidenceId) ?? []).map((id) => `<a href="${href(`#control-${id}`)}">${text(id)}</a>`).join(", ") || "—";
      return `<article id="evidence-${attr(e.evidenceId)}" class="evidence-card">
      <h3>${text(e.evidenceId)} <span class="badge">${text(e.type)}</span></h3>
      <p>${text(e.location)}</p>
      ${e.description ? `<p>${text(e.description)}</p>` : ""}
      <p>Captured ${text(e.capturedAt)} by ${text(e.capturedBy)}</p>
      <p>Referenced by: ${refs}</p>
    </article>`;
    })
    .join("");

  const missingEvidenceCards = model.referenceIntegrity.missingEvidenceIds
    .map((id) => `<article class="evidence-card missing-placeholder"><h3>${text(id)}</h3><p class="badge badge-warning">Referenced but not found in this report</p></article>`)
    .join("");

  const raCards = model.riskAcceptances
    .map((r) => {
      const refs = (controlsByRiskAcceptanceId.get(r.riskAcceptanceId) ?? []).map((id) => `<a href="${href(`#control-${id}`)}">${text(id)}</a>`).join(", ") || "—";
      return `<article id="risk-acceptance-${attr(r.riskAcceptanceId)}" class="ra-card">
      <h3>${text(r.riskAcceptanceId)} <span class="badge">${text(r.status)}</span></h3>
      <p>${text(r.reason)}</p>
      <p>Approved by ${text(r.approvedBy)} on ${text(r.approvedAt)}, expires ${text(r.expiresAt)}</p>
      ${r.compensatingControls.length ? `<p>Compensating controls: ${r.compensatingControls.map((c) => text(c)).join(", ")}</p>` : ""}
      ${r.revokedAt ? `<p class="badge badge-warning">Revoked ${text(r.revokedAt)}${r.revokedReason ? `: ${text(r.revokedReason)}` : ""}</p>` : ""}
      <p>Referenced by: ${refs}</p>
    </article>`;
    })
    .join("");

  const missingRaCards = model.referenceIntegrity.missingRiskAcceptanceIds
    .map((id) => `<article class="ra-card missing-placeholder"><h3>${text(id)}</h3><p class="badge badge-warning">Referenced but not found in this report</p></article>`)
    .join("");

  return `<section id="evidence-and-risk-acceptance" aria-labelledby="evidence-and-risk-acceptance-heading">
  <h2 id="evidence-and-risk-acceptance-heading">Control Evidence &amp; Risk Acceptance</h2>
  <h3>Evidence</h3>
  <div class="card-grid">${evidenceCards}${missingEvidenceCards}</div>
  <h3>Risk Acceptance</h3>
  <div class="card-grid">${raCards}${missingRaCards}</div>
</section>`;
}

function renderScopeMethodologyLimitations(model: PresentationModel): string {
  const scopeRows = Object.entries(model.assessmentScopes)
    .map(([field, scope]) => {
      const detail =
        "runId" in scope ? ` (run ${text(scope.runId)})` : "contributingRunIds" in scope ? ` (runs: ${scope.contributingRunIds.map((r) => text(r)).join(", ")})` : "";
      return `<dt>${text(field)}</dt><dd>${text(scope.kind)}${detail}</dd>`;
    })
    .join("");

  const limitationItems = model.limitations
    .map((l) => `<li class="badge-${attr(l.severity)}"><strong>${text(l.severity)}</strong> — ${text(l.message)}</li>`)
    .join("");

  return `<section id="scope-methodology-limitations" aria-labelledby="scope-methodology-limitations-heading">
  <h2 id="scope-methodology-limitations-heading">Scope, Methodology &amp; Limitations</h2>
  <h3>Assessment scopes</h3>
  <dl>${scopeRows}</dl>
  <h3>Limitations</h3>
  <ul>${limitationItems}</ul>
  <h3>Provenance</h3>
  <dl>
    <dt>Report ID</dt><dd><code>${text(model.metadata.reportId)}</code></dd>
    <dt>Report schema version</dt><dd>${text(model.metadata.reportSchemaVersion)}</dd>
    <dt>Source report SHA-256</dt><dd><code>${text(model.metadata.sourceReportSha256)}</code></dd>
    <dt>Renderer version</dt><dd>${text(model.metadata.rendererVersion)}</dd>
    <dt>Rendered at</dt><dd>${text(model.metadata.rendererRenderedAt)}</dd>
    <dt>Catalog version</dt><dd>${text(model.metadata.catalogVersion)}</dd>
    <dt>Score model</dt><dd>${text(model.metadata.scoreModel.id)} v${text(model.metadata.scoreModel.version)}</dd>
    <dt>Criticality formula</dt><dd>${text(model.metadata.criticalityFormula.id)} v${text(model.metadata.criticalityFormula.version)}</dd>
  </dl>
</section>`;
}

function renderTerminology(): string {
  return `<section id="terminology" aria-labelledby="terminology-heading">
  <h2 id="terminology-heading">Terminology</h2>
  <dl>
    <dt>Finding Verification</dt>
    <dd>The attack scenario and exploitability evidence attached to a <em>Finding</em> — how this specific vulnerability was confirmed, shown in the Findings section.</dd>
    <dt>Control Assessment Evidence</dt>
    <dd>The evidence records attached to a <em>ControlAssessment</em> — what was examined to reach a control's PASS/FAIL/PARTIAL verdict, shown in the Control Evidence &amp; Risk Acceptance section. A different concept from Finding Verification above, even though both are informally "evidence."</dd>
  </dl>
</section>`;
}

const REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #fafafa; --fg: #1a1a1a; --muted: #6b7280; --border: #d1d5db; --accent: #1d4ed8;
  --status-pass: #1b7f3a; --status-fail: #c0392b; --status-partial: #b7791f;
  --status-na: #6b7280; --status-not-tested: #9ca3af; --status-accepted-risk: #5b4fc4;
  --severity-critical: #7a0d0d; --severity-high: #d1481b; --severity-medium: #b7791f;
  --severity-low: #2b5fa3; --severity-informational: #6b7280;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; padding-inline: 16px; }
header, main, footer, nav { max-width: 960px; margin: 0 auto; }
h1, h2, h3 { text-wrap: balance; }
a { color: var(--accent); }
a:focus-visible, button:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
nav { display: flex; flex-wrap: wrap; gap: 12px; padding-block: 12px; border-bottom: 1px solid var(--border); position: sticky; top: env(safe-area-inset-top, 0px); background: var(--bg); }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.kpi { border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
.kpi dt { font-size: 0.8rem; color: var(--muted); }
.kpi dd { margin: 0; font-size: 1.4rem; font-weight: 600; }
.domain-row { display: grid; grid-template-columns: 160px 1fr auto; align-items: center; gap: 12px; padding-block: 6px; }
.bar { background: var(--border); border-radius: 4px; height: 10px; overflow: hidden; }
.bar-fill { background: var(--accent); height: 100%; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 640px; }
th, td { border-bottom: 1px solid var(--border); padding: 8px; text-align: left; vertical-align: top; }
.status-PASS { color: var(--status-pass); }
.status-FAIL { color: var(--status-fail); }
.status-PARTIAL { color: var(--status-partial); }
.status-N\\/A { color: var(--status-na); }
.status-NOT_TESTED { color: var(--status-not-tested); }
.status-ACCEPTED_RISK { color: var(--status-accepted-risk); }
.badge { display: inline-block; border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; background: var(--border); }
.badge-warning { background: #fde68a; color: #92400e; }
.badge-info { background: #dbeafe; color: #1e3a8a; }
.finding-card { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; margin-block: 8px; }
.finding-card summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.evidence-card, .ra-card { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; }
.missing-placeholder { border-style: dashed; }
#findings-filter-status { color: var(--muted); font-size: 0.9rem; }
@media (max-width: 400px) {
  .domain-row { grid-template-columns: 1fr; }
}
@media print {
  nav, button { display: none; }
  details:not([open]) > *:not(summary) { display: block !important; }
  .finding-card, .evidence-card, .ra-card { page-break-inside: avoid; }
  a { color: inherit; text-decoration: underline; }
  .bar-fill { print-color-adjust: exact; }
}
`;

const CLIENT_SCRIPT = `
(function () {
  "use strict";
  var dataEl = document.getElementById("report-data");
  var data = JSON.parse(dataEl.textContent);

  function buildScatter() {
    var svg = d3.select("#priority-criticality-scatter");
    var width = 480, height = 320, margin = { top: 20, right: 20, bottom: 40, left: 40 };
    var x = d3.scaleLinear().domain([0, 9]).range([margin.left, width - margin.right]);
    var y = d3.scaleLinear().domain([0, 9]).range([height - margin.bottom, margin.top]);
    svg.append("g").attr("transform", "translate(0," + (height - margin.bottom) + ")").call(d3.axisBottom(x).ticks(9));
    svg.append("g").attr("transform", "translate(" + margin.left + ",0)").call(d3.axisLeft(y).ticks(9));
    svg.append("text").attr("x", width / 2).attr("y", height - 4).attr("text-anchor", "middle").text("Priority index");
    svg.append("text").attr("x", -height / 2).attr("y", 12).attr("transform", "rotate(-90)").attr("text-anchor", "middle").text("Criticality index");
    svg.selectAll("circle").data(data.findings).join("circle")
      .attr("cx", function (d) { return x(d.priorityIndex); })
      .attr("cy", function (d) { return y(d.criticalityIndex); })
      .attr("r", 5)
      .attr("fill", function (d) { return getComputedStyle(document.documentElement).getPropertyValue("--severity-" + d.severity.toLowerCase()) || "#6b7280"; })
      .append("title").text(function (d) { return d.title + " — Priority index: " + d.priorityIndex + " / Criticality index: " + d.criticalityIndex; });
  }

  function wireFindingsFilter() {
    var buttons = document.querySelectorAll("[data-filter]");
    var status = document.getElementById("findings-filter-status");
    var cards = document.querySelectorAll("#findings-list > .finding-card");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var filter = btn.getAttribute("data-filter");
        var shown = 0;
        cards.forEach(function (card) {
          var cardStatus = card.getAttribute("data-status");
          var visible = filter === "all" || cardStatus === "open" || cardStatus === "in_progress";
          card.hidden = !visible;
          if (visible) shown++;
        });
        status.textContent = "Showing " + shown + " of " + cards.length + " findings";
      });
    });
  }

  if (typeof d3 !== "undefined" && document.getElementById("priority-criticality-scatter")) buildScatter();
  wireFindingsFilter();
})();
`;

export function renderReportHtml(model: PresentationModel, opts: { d3Source: string }): string {
  const main = [
    renderExecutiveSummary(model),
    renderDomainOverview(model),
    renderControlMatrix(model),
    renderFindings(model),
    renderEvidenceAndRiskAcceptance(model),
  ].join("\n");

  const footerContent = [renderScopeMethodologyLimitations(model), renderTerminology()].join("\n");

  const scriptData = {
    findings: model.findings.map((f) => ({
      findingId: f.findingId, title: f.title, severity: f.severity,
      priorityIndex: f.priorityIndex, criticalityIndex: f.criticalityIndex, status: f.status,
    })),
  };
  const dataJson = escapeForInlineScriptJson(JSON.stringify(scriptData));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
<title>${text(model.metadata.projectName)} — Security Assessment Report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${renderHeader(model)}
<nav aria-label="Report sections">
  <a href="#executive-summary">Executive Summary</a>
  <a href="#domain-overview">Domain Overview</a>
  <a href="#control-matrix">Control Matrix</a>
  <a href="#findings">Findings</a>
  <a href="#evidence-and-risk-acceptance">Control Evidence &amp; Risk Acceptance</a>
  <a href="#scope-methodology-limitations">Scope &amp; Limitations</a>
</nav>
<main>
${main}
</main>
<footer>
${footerContent}
</footer>
<script type="application/json" id="report-data">${dataJson}</script>
<script>${opts.d3Source}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/core/report-html-renderer.test.ts`
Expected: PASS (all tests)

- [ ] **Step 10: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 11: Commit**

```bash
git add src/core/html-escape.ts src/core/report-html-renderer.ts \
  src/assets/d3.v7.min.js src/assets/d3.v7.LICENSE src/assets/d3.v7.min.js.sha256 \
  tests/core/html-escape.test.ts tests/core/report-html-renderer.test.ts
git commit -m "feat(html-report): add escaping helpers, vendored D3, and renderReportHtml"
```

---

### Task 5: MCP tool rename + `generate_report_html` wiring

**Files:**
- Rename: `src/mcp/tools/generate-report.ts` → `src/mcp/tools/generate-report-data.ts`
- Create: `src/mcp/tools/generate-report-html.ts`
- Modify: `src/core/repository.ts`
- Modify: `src/service/report-service.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/tools/update-project-profile.ts` (comment only)
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Test: `tests/service/report-service.test.ts`
- Test: `tests/service/fake-repository.ts`
- Test: `tests/mcp/tools/analysis-report-tools.test.ts`
- Test: `tests/integration/full-workflow.test.ts`

**Interfaces:**
- Consumes: `buildPresentationModel` (Task 3), `renderReportHtml`/`REPORT_HTML_RENDERER_VERSION` (Task 4).
- Produces: `ReportService.generateData(input: GenerateReportInput): Promise<ProjectReport>` (renamed from `.generate`), `ReportService.generateHtml(input: { projectId: string; reportId: string }): Promise<{ html: string; path: string; sourceReportSha256: string }>`, `SecurityRepository.getReportRawBytes(projectId, reportId): Promise<Buffer>`, `SecurityRepository.saveReportHtml(projectId, reportId, html): Promise<string>` (returns the path written).

- [ ] **Step 1: Add `getReportRawBytes`/`saveReportHtml` to `SecurityRepository` and `JsonRepository`**

In `src/core/repository.ts`, change the first import line to add `readFileSync`:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
```

Add 2 new methods to the `SecurityRepository` interface (alongside `saveReport`):

```ts
  getReportRawBytes(projectId: string, reportId: string): Promise<Buffer>;
  saveReportHtml(projectId: string, reportId: string, html: string): Promise<string>;
```

Add this helper function next to `writeJsonAtomic`:

```ts
function writeTextAtomic(path: string, data: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, path);
}
```

Add 2 new methods to the `JsonRepository` class (alongside `saveReport`):

```ts
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
```

- [ ] **Step 2: Rename `generate` → `generateData` and add `generateHtml` on `ReportService`**

Rename `src/mcp/tools/generate-report.ts`'s sibling service file is `src/service/report-service.ts` — this stays the same filename (only the method is renamed). Change the imports at the top of `src/service/report-service.ts` to add:

```ts
import { createHash } from "node:crypto";
import { buildPresentationModel } from "../core/presentation-model.js";
import { renderReportHtml, REPORT_HTML_RENDERER_VERSION } from "../core/report-html-renderer.js";
```

Change the class declaration to accept an optional vendored D3 source (mirrors the `now` injection pattern already used):

```ts
export class ReportService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly d3Source?: string
  ) {}

  async generateData(input: GenerateReportInput): Promise<ProjectReport> {
    // ...unchanged body, just renamed from `generate`...
  }

  async generateHtml(input: { projectId: string; reportId: string }): Promise<{ html: string; path: string; sourceReportSha256: string }> {
    if (this.d3Source === undefined) {
      throw new Error("ReportService.generateHtml: no d3Source was injected into this ReportService instance");
    }
    const rawBytes = await withNotFound(
      this.repository.getReportRawBytes(input.projectId, input.reportId),
      `ProjectReport "${input.reportId}" not found`,
      { reportId: input.reportId }
    );
    const report = JSON.parse(rawBytes.toString("utf-8")) as ProjectReport;
    if (report.reportSchemaVersion !== "2.1.0") {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        `generate_report_html requires reportSchemaVersion "2.1.0", got "${report.reportSchemaVersion}" — regenerate this report via generate_report_data first`,
        { reportId: input.reportId, reportSchemaVersion: report.reportSchemaVersion }
      );
    }
    const sourceReportSha256 = createHash("sha256").update(rawBytes).digest("hex");
    const model = buildPresentationModel(report, {
      rendererVersion: REPORT_HTML_RENDERER_VERSION,
      rendererRenderedAt: this.now(),
      sourceReportSha256,
    });
    const html = renderReportHtml(model, { d3Source: this.d3Source });
    const path = await this.repository.saveReportHtml(input.projectId, input.reportId, html);
    return { html, path, sourceReportSha256 };
  }
}
```

Rename every occurrence of `async generate(` to `async generateData(` in this file (there is exactly one — the method defined in Task 1/2's work).

- [ ] **Step 3: Rename the `generate_report` tool file to `generate_report_data` and add the new `generate_report_html` tool**

Rename `src/mcp/tools/generate-report.ts` to `src/mcp/tools/generate-report-data.ts`:

```bash
git mv src/mcp/tools/generate-report.ts src/mcp/tools/generate-report-data.ts
```

Replace its contents with:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportService } from "../../service/report-service.js";
import { toErrorResult } from "./error-result.js";

export const generateReportDataInputShape = {
  projectId: z.string().min(1),
  runId: z.string().min(1),
  summary: z.string().min(1),
};

export function registerGenerateReportDataTool(server: McpServer, service: ReportService): void {
  server.registerTool(
    "generate_report_data",
    { title: "Generate Report Data", description: "Generate the ProjectReport JSON for an assessment run (the data step behind generate_report_html).", inputSchema: generateReportDataInputShape },
    async (input) => {
      try {
        const report = await service.generateData(input);
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

Create `src/mcp/tools/generate-report-html.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportService } from "../../service/report-service.js";
import { REPORT_HTML_RENDERER_VERSION } from "../../core/report-html-renderer.js";
import { toErrorResult } from "./error-result.js";

export const generateReportHtmlInputShape = {
  projectId: z.string().min(1),
  reportId: z.string().min(1),
};

export function registerGenerateReportHtmlTool(server: McpServer, service: ReportService): void {
  server.registerTool(
    "generate_report_html",
    {
      title: "Generate Report HTML",
      description: "Render a self-contained, zero-network HTML report from an existing ProjectReport (requires reportSchemaVersion 2.1.0).",
      inputSchema: generateReportHtmlInputShape,
    },
    async (input) => {
      try {
        const result = await service.generateHtml(input);
        return {
          content: [{ type: "text" as const, text: `Generated HTML report at ${result.path} (source SHA-256 ${result.sourceReportSha256}).` }],
          structuredContent: { path: result.path, sourceReportSha256: result.sourceReportSha256, rendererVersion: REPORT_HTML_RENDERER_VERSION },
        };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
```

- [ ] **Step 4: Wire both tools in `src/mcp/server.ts`**

Change the import `import { registerGenerateReportTool } from "./tools/generate-report.js";` to:

```ts
import { registerGenerateReportDataTool } from "./tools/generate-report-data.js";
import { registerGenerateReportHtmlTool } from "./tools/generate-report-html.js";
```

Add a `readD3Source()` helper next to `readEngineVersion()`:

```ts
function readD3Source(): string {
  const d3Path = join(__dirname, "..", "assets", "d3.v7.min.js");
  return readFileSync(d3Path, "utf-8");
}
```

Change `const reportService = new ReportService(repository);` to:

```ts
  const reportService = new ReportService(repository, undefined, readD3Source());
```

Change `registerGenerateReportTool(server, reportService);` to:

```ts
  registerGenerateReportDataTool(server, reportService);
  registerGenerateReportHtmlTool(server, reportService);
```

- [ ] **Step 5: Update the one live comment referencing `generate_report` by name**

In `src/mcp/tools/update-project-profile.ts`, change `"generate_report from that point on. A new assessment run is required after this call before "` to `"generate_report_data from that point on. A new assessment run is required after this call before "`.

- [ ] **Step 6: Update `tests/service/fake-repository.ts`**

Add 2 new fields and 2 new methods to `FakeRepository`:

```ts
  reportHtml = new Map<string, string>();
```

(add alongside `reports = new Map<string, ProjectReport>();`)

```ts
  async getReportRawBytes(_projectId: string, reportId: string): Promise<Buffer> {
    const report = this.reports.get(reportId);
    if (!report) throw new Error(`FakeRepository: no such report "${reportId}"`);
    return Buffer.from(JSON.stringify(report));
  }
  async saveReportHtml(projectId: string, reportId: string, html: string): Promise<string> {
    const path = `fake/${projectId}/reports/${reportId}.html`;
    this.reportHtml.set(reportId, html);
    return path;
  }
```

(add alongside `saveReport`)

- [ ] **Step 7: Write failing tests for `ReportService.generateData`/`generateHtml`**

In `tests/service/report-service.test.ts`: rename every `service.generate({` call to `service.generate` → `service.generateData` (there are several call sites across the file — every `new ReportService(...)` instance's `.generate(` call becomes `.generateData(`; `new ReportService(repo, () => NOW)` instantiation itself is unchanged).

Add this new `describe` block to the end of the file:

```ts
describe("ReportService.generateHtml", () => {
  it("rejects a report with reportSchemaVersion other than 2.1.0 with PRECONDITION_FAILED", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW, "/* d3 stub */");
    const legacyReport = {
      reportId: "REP-LEGACY", projectId: "PRJ-1", assessmentRunId: "RUN-1",
      catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      generatedAt: NOW, score: { overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 }, scoreModel: { id: "x", version: "1.0.0" }, domainScores: [] },
      prioritizedFindings: [], projectFindingSnapshots: [],
      releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
      target: null, profileSnapshot: null, engineVersionAtRunStart: null,
      reportSchemaVersion: "2.0.0", summary: "legacy report, no 2.1 fields",
    };
    (repo as any).reports.set("REP-LEGACY", legacyReport);
    await expect(service.generateHtml({ projectId: "PRJ-1", reportId: "REP-LEGACY" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("throws NOT_FOUND for an unknown reportId", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW, "/* d3 stub */");
    await expect(service.generateHtml({ projectId: "PRJ-1", reportId: "NOPE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws a plain Error when no d3Source was injected", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW); // no 3rd arg
    const report = await service.generateData({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    await expect(service.generateHtml({ projectId: "PRJ-1", reportId: report.reportId })).rejects.toThrow(/d3Source/);
  });

  it("renders successfully for a fresh 2.1.0 report, saving HTML via the repository and returning path/sourceReportSha256", async () => {
    const repo = new FakeRepository();
    await makeGeneratableProject(repo);
    const service = new ReportService(repo, () => NOW, "/* d3 stub */");
    const report = await service.generateData({ projectId: "PRJ-1", runId: "RUN-1", summary: "x" });
    const result = await service.generateHtml({ projectId: "PRJ-1", reportId: report.reportId });
    expect(result.html).toContain("<!doctype html>");
    expect(result.path).toBe(`fake/PRJ-1/reports/${report.reportId}.html`);
    expect(result.sourceReportSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.reportHtml.get(report.reportId)).toBe(result.html);
  });
});
```

- [ ] **Step 8: Run the tests to verify they fail, then implement, then verify they pass**

Run: `npx vitest run tests/service/report-service.test.ts`
Expected (before Steps 1–6 above are applied): FAIL. After applying Steps 1–6: PASS.

- [ ] **Step 9: Update `tests/mcp/tools/analysis-report-tools.test.ts`**

Change the import `import { registerGenerateReportTool } from "../../../src/mcp/tools/generate-report.js";` to `import { registerGenerateReportDataTool } from "../../../src/mcp/tools/generate-report-data.js";`. Change `registerGenerateReportTool(server, reportService);` to `registerGenerateReportDataTool(server, reportService);`. Change the test `"generate_report produces a ProjectReport"` to call `name: "generate_report_data"` and rename the test description to `"generate_report_data produces a ProjectReport"`.

- [ ] **Step 10: Update `tests/integration/full-workflow.test.ts`**

Change the import `import { registerGenerateReportTool } from "../../src/mcp/tools/generate-report.js";` to `import { registerGenerateReportDataTool } from "../../src/mcp/tools/generate-report-data.js";`. Change `registerGenerateReportTool(server, reportService);` (inside `beforeEach`) to `registerGenerateReportDataTool(server, reportService);`. Change the `name: "generate_report"` tool call (inside the `it("walks create → profile → run → list → assess → find → score → release → report", ...)` test) to `name: "generate_report_data"`. Do not touch anything else in this file yet — Task 6 extends this same `beforeEach`/test to also exercise `generate_report_html`.

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 12: Confirm the repo-wide rename sweep is complete**

Run: `rg '\bgenerate_report\b'` from the repo root. Expected remaining matches: only inside `docs/superpowers/specs/`, `docs/superpowers/plans/` (other than this file), `docs/superpowers/adr/`, `docs/superpowers/reports/`, `CHANGELOG.md`'s existing `[0.9.0]` entry, and `PROGRESS.md` — all of these describe already-completed past work and must **not** be edited (rewriting history would misrepresent what happened at the time). Every match inside `src/` or `tests/` must be gone; if any remain, fix them before continuing.

- [ ] **Step 13: Bump `package.json` version and add a `CHANGELOG.md` entry**

In `package.json`, change `"version": "0.9.0",` to `"version": "0.10.0",`.

In `CHANGELOG.md`, insert this new entry directly above the existing `## [0.9.0] — 2026-10-07` line:

```markdown
## [0.10.0] — 2026-10-08

### Added
- `projectName`, `runControlAssessmentSnapshots[]` (with `recordedStatus`/`effectiveStatus`/
  `effectiveStatusReason`), `evidenceSnapshots[]`, `riskAcceptanceSnapshots[]`, and
  `assessmentScopes` on `ProjectReport`. `reportSchemaVersion` bumped to `"2.1.0"`.
- `translateAssessmentsForTrust` now returns `recordedStatus`/`effectiveStatusReason`
  alongside `status`, and distinguishes `risk_acceptance_revoked`/
  `risk_acceptance_scope_mismatch` from the existing staleness/expiry/missing cases.
- `buildPresentationModel` (`src/core/presentation-model.ts`): a pure projection from
  `ProjectReport` to a display-ready `PresentationModel`, with `referenceIntegrity` and
  `limitations[]` — selection and aggregation only, no new judgment.
- New `generate_report_html` MCP tool: renders a self-contained, zero-network HTML report
  (vendored D3, strict escaping, a CSP meta tag) from an existing `2.1.0` `ProjectReport`.

### Changed
- Breaking: `generate_report` MCP tool renamed to `generate_report_data`. Same input/output
  shape; the data step is now explicitly in service of the HTML report, not an end in itself.
```

- [ ] **Step 14: Run the full suite once more and commit**

Run: `npm test`
Expected: PASS, 0 failures.

```bash
git add src/core/repository.ts src/service/report-service.ts src/mcp/server.ts \
  src/mcp/tools/generate-report-data.ts src/mcp/tools/generate-report-html.ts \
  src/mcp/tools/update-project-profile.ts package.json CHANGELOG.md \
  tests/service/report-service.test.ts tests/service/fake-repository.ts \
  tests/mcp/tools/analysis-report-tools.test.ts tests/integration/full-workflow.test.ts
git status --short # confirm generate-report.ts no longer appears (renamed via git mv)
git commit -m "feat(mcp): rename generate_report to generate_report_data, add generate_report_html tool"
```

---

### Task 6: Security/accessibility/print test suite and final reconciliation

**Files:**
- Modify: `package.json` (new devDependencies: `jsdom`, `@types/jsdom`, `playwright`)
- Modify: `.gitignore` (ignore Playwright's local screenshot artifacts)
- Create: `tests/core/report-html-renderer.security.test.ts`
- Create: `tests/core/report-html-renderer.accessibility.test.ts`
- Create: `tests/core/report-html-renderer.print.test.ts`
- Modify: `tests/integration/full-workflow.test.ts`

**Interfaces:**
- Consumes: `renderReportHtml`/`REPORT_HTML_RENDERER_VERSION` (Task 4), `buildPresentationModel` (Task 3), `ProjectReport` (Tasks 1–2), the real `generate_report_data`/`generate_report_html` tools (Task 5).
- Produces: nothing new for later tasks — this is the last task in the plan.

**Scope note on spec §10's 6 subsections, decided now rather than left open:** §10.3 (determinism/snapshot) and parts of §10.4 (reference-integrity/metamorphic) are already covered by the purity/metamorphic tests added in Task 3 (`tests/core/presentation-model.test.ts`) and Task 4 (`tests/core/report-html-renderer.test.ts`'s "is a pure function" test) — this task does not duplicate those.

**Revision note (applied after this plan's GPT review round — the one Important fix the review required):** an earlier draft of this task ran §10.1's XSS corpus and §10.2's zero-network test under `jsdom` and described them as "real-browser" checks, and downscaled §10.6's print acceptance to regex assertions against the stylesheet string. Review correctly flagged both: `jsdom` parses HTML and executes `<script>` tags, but it has no real rendering pipeline, no real network stack, and no real CSS cascade — a `jsdom` test is a legitimate **DOM/parser-level** check, but is not evidence about what an actual browser does, which is exactly what §10.1/§10.2 need to claim. And once a real browser is needed for that, print's "1-2 screenshots" requirement (§10.6) is nearly free on the same harness — downscaling it to a regex check was an unnecessary compromise, not a required one. This task now uses **both** tools, split by what each can actually attest to:
- `jsdom` — kept for the accessibility **structural** checks (DOM shape: landmarks, heading order, `scope` attributes) — none of these claims depend on a real rendering engine.
- **Playwright/Chromium** — used wherever the claim is specifically about real-browser behavior: the XSS corpus (§10.1), the zero-network test (§10.2), the print-media check (§11/§10.6 — now real screenshots, as the spec originally asked for), one real-browser keyboard-interaction accessibility check (§7), and the 320–400px responsive smoke check (§12, not explicitly in §10 but was previously untested).

- [ ] **Step 1: Add `jsdom` and `playwright` as devDependencies, and install Chromium**

Run:

```bash
npm install --save-dev jsdom @types/jsdom playwright
npx playwright install --with-deps chromium
```

Expected: `package.json`'s `devDependencies` gains `jsdom`, `@types/jsdom`, and `playwright` entries (exact resolved versions are whatever npm picks at install time — do not hand-edit them), and a local Chromium binary is downloaded for Playwright to launch. No `vitest.config.ts` change is needed: `jsdom` is used only where a test explicitly constructs a `JSDOM` instance (never as vitest's global test environment), and Playwright is used only where a test explicitly calls `chromium.launch()` — every other test file keeps running under vitest's default Node environment.

Add this line to `.gitignore` (create the file if it doesn't already exist, otherwise append):

```
tests/__artifacts__/
```

This is where Step 7 below saves its print-mode screenshot — a local debugging artifact, not something to commit.

- [ ] **Step 2: Write the real-browser XSS corpus and zero-network tests (spec §10.1/§10.2, Playwright/Chromium)**

Create `tests/core/report-html-renderer.security.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

function reportWithPayload(payload: string): ProjectReport {
  return {
    reportId: "REP-XSS", projectId: "PRJ-1", projectName: "XSS Test", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 9, title: payload }],
    projectFindingSnapshots: [{ findingId: "FND-1", title: payload, type: "confirmed_vulnerability", severity: "critical", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 9, attackScenario: payload, exploitabilityEvidence: payload }],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 1, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "blocked" },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: payload,
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: payload, domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: [], findingIds: ["FND-1"], riskAcceptanceId: null, owner: payload, assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: payload,
    }],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" }, score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" }, riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
  };
}

function renderWithPayload(payload: string): string {
  const model = buildPresentationModel(reportWithPayload(payload), OPTS);
  return renderReportHtml(model, { d3Source });
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

describe("renderReportHtml — real-browser XSS corpus (Playwright/Chromium, spec §10.1)", () => {
  const PAYLOADS = [
    `</script><script>window.__CSI_XSS__=true;</script>`,
    `"></a><script>window.__CSI_XSS__=true;</script><a href="`,
  ];

  for (const payload of PAYLOADS) {
    it(`a title/notes/owner payload containing ${JSON.stringify(payload)} never sets window.__CSI_XSS__ and remains visible as literal text`, async () => {
      const html = renderWithPayload(payload);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const xssFlag = await page.evaluate(() => (window as unknown as { __CSI_XSS__?: boolean }).__CSI_XSS__);
      expect(xssFlag).not.toBe(true);
      const bodyText = await page.textContent("body");
      expect(bodyText).toContain(payload);
      await page.close();
    });
  }
});

describe("renderReportHtml — zero network requests at view time (Playwright/Chromium, spec §10.2/§8.2)", () => {
  it("no request ever fires against an http(s) origin while the document and its inline scripts load and run", async () => {
    const html = renderWithPayload("plain finding, no payload");
    const page = await browser.newPage();
    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      if (/^https?:/.test(req.url())) requestedUrls.push(req.url());
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(250); // let any deferred script finish before asserting
    expect(requestedUrls).toEqual([]);
    await page.close();
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run tests/core/report-html-renderer.security.test.ts`
Expected: PASS. (No production code changes are needed for this step — Task 4's escaping discipline already makes these tests pass; this step exists to *prove* that discipline against a real browser's script engine and network stack, not to drive new implementation. Each test launches its own page from the shared `browser` instance and closes it when done, keeping tests isolated from each other.)

- [ ] **Step 4: Write the accessibility baseline test (spec §7/§10.5) — jsdom structural checks plus one real-browser keyboard-interaction check**

Create `tests/core/report-html-renderer.accessibility.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

// Two findings (one open, one resolved) so the keyboard-interaction test below (Step 4's second
// describe block) has a real visible-count change to assert on when it filters to "open" only.
function sampleReport(): ProjectReport {
  return {
    reportId: "REP-A11Y", projectId: "PRJ-1", projectName: "Accessibility Check", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 5, title: "Sample finding" }],
    projectFindingSnapshots: [
      { findingId: "FND-1", title: "Sample finding (open)", type: "control_gap", severity: "medium", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 5 },
      { findingId: "FND-2", title: "Sample finding (resolved)", type: "control_gap", severity: "low", controlIds: ["CTRL-001"], status: "resolved", priorityIndex: 1, criticalityIndex: 1 },
    ],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: "Sample control", domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: [], findingIds: ["FND-1", "FND-2"], riskAcceptanceId: null, owner: "x", assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    }],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" }, score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" }, riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
  };
}

function renderHtml(): string {
  const model = buildPresentationModel(sampleReport(), OPTS);
  return renderReportHtml(model, { d3Source });
}

function render(): JSDOM {
  return new JSDOM(renderHtml());
}

describe("renderReportHtml — accessibility baseline, DOM/parser-level structural checks (jsdom, spec §7)", () => {
  it("has exactly one <header>, <nav>, <main>, and <footer> landmark", () => {
    const dom = render();
    expect(dom.window.document.querySelectorAll("header").length).toBe(1);
    expect(dom.window.document.querySelectorAll("nav").length).toBe(1);
    expect(dom.window.document.querySelectorAll("main").length).toBe(1);
    expect(dom.window.document.querySelectorAll("footer").length).toBe(1);
  });

  it("has no skipped heading levels among h1/h2/h3", () => {
    const dom = render();
    const headings = [...dom.window.document.querySelectorAll("h1, h2, h3")].map((el) => Number(el.tagName[1]));
    expect(headings[0]).toBe(1);
    for (let i = 1; i < headings.length; i++) {
      expect(headings[i] - headings[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("uses a native <details>/<summary> pair for each finding card, not a div with an onclick handler", () => {
    const dom = render();
    const card = dom.window.document.querySelectorAll(".finding-card")[0];
    expect(card.tagName).toBe("DETAILS");
    expect(card.querySelector("summary")).not.toBeNull();
  });

  it("uses native <button> elements for the findings status filter", () => {
    const dom = render();
    const filterControl = dom.window.document.querySelectorAll("[data-filter]")[0];
    expect(filterControl.tagName).toBe("BUTTON");
  });

  it('the findings filter status region has aria-live="polite"', () => {
    const dom = render();
    expect(dom.window.document.getElementById("findings-filter-status")?.getAttribute("aria-live")).toBe("polite");
  });

  it('the Control Matrix header row uses th scope="col" and the body uses th scope="row" per control', () => {
    const dom = render();
    expect(dom.window.document.querySelectorAll('table thead th[scope="col"]').length).toBeGreaterThan(0);
    expect(dom.window.document.querySelectorAll('table tbody th[scope="row"]').length).toBe(1);
  });

  it("the priority/criticality scatter <svg> has a <title> child element", () => {
    const dom = render();
    const svg = dom.window.document.getElementById("priority-criticality-scatter");
    expect(svg?.querySelector("title")).not.toBeNull();
  });

  it("the stylesheet includes a :focus-visible rule", () => {
    const dom = render();
    const styleText = dom.window.document.querySelector("style")?.textContent ?? "";
    expect(styleText).toContain(":focus-visible");
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe("renderReportHtml — accessibility baseline, real-browser keyboard interaction (Playwright/Chromium, spec §7)", () => {
  it("Tab-focusing the findings filter button and pressing Enter updates the aria-live status text to the new visible count", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    const initialStatus = await page.textContent("#findings-filter-status");
    expect(initialStatus).toBe("Showing 2 of 2 findings");
    await page.locator('[data-filter="open"]').focus();
    const focusedDataFilter = await page.evaluate(() => document.activeElement?.getAttribute("data-filter"));
    expect(focusedDataFilter).toBe("open");
    await page.keyboard.press("Enter");
    const updatedStatus = await page.textContent("#findings-filter-status");
    expect(updatedStatus).toBe("Showing 1 of 2 findings");
    await page.close();
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/core/report-html-renderer.accessibility.test.ts`
Expected: PASS. (No production code change expected — Task 4 already implements every item this test checks. The jsdom-based describe block verifies DOM structure directly instead of string matching; the Playwright-based describe block is the one real-browser proof that the keyboard/filter interaction spec §7 describes actually behaves as claimed.)

- [ ] **Step 6: Write the print-support and responsive tests (spec §11/§10.6/§12, Playwright/Chromium — real screenshots, not the regex downscale an earlier draft of this task used)**

Create `tests/core/report-html-renderer.print.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

// One finding and one control, so there is a real <details> card and a real Control Matrix
// row to assert against in print mode — an entirely empty report would make every "is this
// still visible in print" assertion vacuously true.
function sampleReport(): ProjectReport {
  return {
    reportId: "REP-PRINT", projectId: "PRJ-1", projectName: "Print Check", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 5, title: "Sample finding" }],
    projectFindingSnapshots: [{ findingId: "FND-1", title: "Sample finding", type: "control_gap", severity: "medium", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 5 }],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: "Sample control", domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: [], findingIds: ["FND-1"], riskAcceptanceId: null, owner: "x", assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    }],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" }, score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" }, riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
  };
}

function renderHtml(): string {
  const model = buildPresentationModel(sampleReport(), OPTS);
  return renderReportHtml(model, { d3Source });
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe("renderReportHtml — print support, real browser (Playwright/Chromium, spec §11/§10.6)", () => {
  it("hides the nav landmark under print media", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const navVisible = await page.locator("nav").first().isVisible();
    expect(navVisible).toBe(false);
    await page.close();
  });

  it("shows a finding card's expanded content under print media without it being manually opened", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const isOpenAttributeSet = await page.locator(".finding-card").first().evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpenAttributeSet).toBe(false); // the <details> element's own open attribute is untouched by print mode...
    const dlVisible = await page.locator(".finding-card dl").first().isVisible();
    expect(dlVisible).toBe(true); // ...but the print stylesheet (Task 4's `details:not([open]) > *:not(summary)` rule) forces its content block to render anyway
    await page.close();
  });

  it("every <svg> in the document has an explicit viewBox, so it isn't clipped when printed", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    const viewBoxes = await page.locator("svg").evaluateAll((svgs) => svgs.map((svg) => svg.getAttribute("viewBox")));
    expect(viewBoxes.length).toBeGreaterThan(0);
    for (const viewBox of viewBoxes) expect(viewBox).toBeTruthy();
    await page.close();
  });

  it("captures a print-media screenshot as a visual smoke check (spec §10.6's '1-2 browser screenshots')", async () => {
    mkdirSync("tests/__artifacts__", { recursive: true });
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path: "tests/__artifacts__/report-print-smoke.png", fullPage: true });
    await page.close();
  });
});

describe("renderReportHtml — responsive at a 375px viewport (Playwright/Chromium, spec §12)", () => {
  it("the document never scrolls horizontally, and the Control Matrix table scrolls inside its own container instead", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(renderHtml(), { waitUntil: "load" });
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1); // +1 tolerates sub-pixel rounding
    const matrixScrollWidth = await page.evaluate(() => document.querySelector(".table-scroll")?.scrollWidth ?? 0);
    expect(matrixScrollWidth).toBeGreaterThan(0);
    await page.close();
  });
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/core/report-html-renderer.print.test.ts`
Expected: PASS. A screenshot lands at `tests/__artifacts__/report-print-smoke.png` (gitignored per Step 1) for manual spot-checking — the test itself only asserts the screenshot call succeeds without throwing, it does not do pixel-diff comparison (consistent with spec §10.6's own "not full pixel-perfect coverage" framing).

- [ ] **Step 8: Extend `tests/integration/full-workflow.test.ts` to exercise `generate_report_html` end-to-end**

Change the `node:fs` import line from `import { mkdtempSync, rmSync } from "node:fs";` to:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
```

Add this new import alongside the other tool-registration imports:

```ts
import { registerGenerateReportHtmlTool } from "../../src/mcp/tools/generate-report-html.js";
```

In `beforeEach`, change `const reportService = new ReportService(mixedRepository(repository, realCatalog));` to:

```ts
    const reportService = new ReportService(mixedRepository(repository, realCatalog), undefined, readFileSync("src/assets/d3.v7.min.js", "utf-8"));
```

Change `registerGenerateReportDataTool(server, reportService);` (renamed in Task 5) to additionally register the new tool right after it:

```ts
    registerGenerateReportDataTool(server, reportService);
    registerGenerateReportHtmlTool(server, reportService);
```

In the `it("walks create → profile → run → list → assess → find → score → release → report", ...)` test, add this block immediately after the existing `const valid = validate(reportPayload); expect(valid, JSON.stringify(validate.errors)).toBe(true);` lines (same test, same `client`/`projectId`/`reportPayload` variables already in scope):

```ts
    const html = await client.callTool({
      name: "generate_report_html",
      arguments: { projectId, reportId: reportPayload.reportId },
    });
    expect(html.isError).toBeFalsy();
    const htmlPayload = html.structuredContent as any;
    expect(htmlPayload.path).toMatch(/\.html$/);
    expect(htmlPayload.sourceReportSha256).toMatch(/^[0-9a-f]{64}$/);
    const writtenHtml = readFileSync(htmlPayload.path, "utf-8");
    expect(writtenHtml).toContain("<!doctype html>");
    expect(writtenHtml).toContain("Content-Security-Policy");
    expect(writtenHtml).toContain("Integration Demo");
```

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 10: Final reconciliation — confirm the rename sweep and version bump are complete**

Run: `rg '\bgenerate_report\b' src tests` — expected: zero matches (everything under `src/` and `tests/` now says `generate_report_data` or `generate_report_html`). Run: `node -p "require('./package.json').version"` — expected: `0.10.0`. Run: `git log --oneline -1 CHANGELOG.md` — expected: the Task 5 commit that added the `[0.10.0]` entry.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .gitignore \
  tests/core/report-html-renderer.security.test.ts tests/core/report-html-renderer.accessibility.test.ts \
  tests/core/report-html-renderer.print.test.ts tests/integration/full-workflow.test.ts
git commit -m "test(html-report): add real-browser (Playwright) XSS/zero-network/print/keyboard/responsive tests"
```
