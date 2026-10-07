# Report Presentation Layer — Design

**Status:** Draft (brainstorming complete, 4 external review rounds via the same persistent GPT thread used throughout this project)
**Depends on:** `docs/superpowers/specs/2026-10-06-report-fidelity-design.md` (ProjectReport `2.0.0`, merged to `main` at `a76efc9`)
**Branch:** TBD (new worktree, forked from `main` at `a76efc9`)

## 1. Motivation

The `report-fidelity` branch made `ProjectReport` a trustworthy, self-contained *data* artifact — the engine's judgment survives into the JSON, with provenance. External review of the 8 regenerated validation reports confirmed this closed the "good engine, poor output" gap, but surfaced the next one: **the JSON is a good canonical artifact, not a good first screen.** Every regenerated report's `summary` field describes the *regeneration itself* ("re-serializes this project's existing engine judgment...") rather than a substantive security summary, because nothing in the pipeline produces a human-facing reading of the data. A CTO or maintainer handed the raw JSON has no 30-second path to "should I ship?" and no 5-minute path to "why not?".

This is a presentation problem, not a trust problem — the review was explicit that detection completeness is still unproven (a Chatwoot critical finding was missed across 3 prior passes before being found on the 4th) and this work does nothing to change that. It only changes how faithfully and usefully the *existing* judgment is shown.

## 2. Scope

**In scope for this cycle:**
- `ControlAssessment` → `ProjectReport` projection (closes a second "engine knows more than the report shows" gap, parallel to the `Finding` gap `report-fidelity` closed)
- `Evidence` and `RiskAcceptance` projections, scoped to what the new control projection references (closes dangling-reference gaps the control projection would otherwise introduce)
- A new `generate_report_html` MCP tool that renders a self-contained HTML report from an existing `ProjectReport`
- `generate_report` is renamed `generate_report_data` — the data step is explicitly in service of the HTML report now, not an end in itself

**Explicitly out of scope, deferred to later cycles:**
- **Attack-path graph visualization.** `Finding.exploitabilityEvidence`/narrative `attackScenario` text is unstructured prose today. A real node/edge graph needs the engine to emit structured attack-path data first — that's new engine capability, not a presentation change.
- **Fresh engine re-assessment of the 8 validation projects** (to produce populated, non-`null` `target`/`profileSnapshot`/`engineVersionAtRunStart`). Unrelated to presentation value — nothing in this design needs populated provenance to be useful, and re-running full assessments against 8 real repositories is its own large effort.
- **Making core `calculateScore`/`evaluateRelease` run-scoped.** Both currently consume `getControlAssessments(projectId)` — project-scoped, not run-scoped — a pre-existing property of the system, not something introduced here. This cycle's new `runControlAssessmentSnapshots[]` *is* run-scoped (see §3.2), which means the HTML can show a run-scoped control matrix next to a project-scoped verdict. That gap is not fixed in this cycle — it is made machine-readable and visible (§3.5, §5) rather than fixed, following the same "document, don't silently fix" discipline `report-fidelity` used for the project-scoped `Finding` limitation.

## 3. Data model changes (`ProjectReport` → `2.1.0`)

All additions are purely additive — no existing `2.0.0` field is removed, renamed, or changes meaning. Per the versioning policy in §9, this is still a `2.x` release.

### 3.1 `projectName`

`ProjectReport.projectName: string`, copied verbatim from `Project.name` at report-generation time by `ReportBuilder`. Needed because the HTML header displays it, and the renderer must never re-read live `Project` storage (that would create a second source of truth alongside the sealed report — the exact staleness class of bug `report-fidelity`'s provenance work exists to prevent).

### 3.2 `runControlAssessmentSnapshots[]`

Projects `ControlAssessment` the same way `report-fidelity` projected `Finding` into `projectFindingSnapshots` — except **run-scoped, not project-scoped**, because `ControlAssessment` already carries `runId`:

```ts
interface ControlAssessmentSnapshot {
  assessmentId: string;
  controlId: string;
  controlVersion: number;
  title: string;                 // Control catalog join, see §3.2.1
  domain: string;                // Control catalog join, see §3.2.1
  profileRevision: number;
  applicability: {
    autoResult: string;
    finalResult: string;
    matchedRules: string[];
    source: "automatic" | "manual_override";
    reason?: string;
  };
  recordedStatus: ControlAssessment["status"];     // PASS | FAIL | PARTIAL | N/A | NOT_TESTED | ACCEPTED_RISK
  effectiveStatus: ControlAssessment["status"];     // what calculateScore/evaluateRelease actually consumed
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
```

`ReportService.generate` filters `getControlAssessments(projectId)` to `a.runId === run.runId` before building this array — the field name is `runControlAssessmentSnapshots` (not `controlAssessmentSnapshots`) specifically to make the run-scoping visible in the type and the JSON key, not just in a comment.

**`recordedStatus` vs. `effectiveStatus` — both are required, neither is optional.** `assessment-trust-integrity` already built a `stored assessment → staleness/RiskAcceptance validity normalization → effective assessment → calculateScore/evaluateRelease` pipeline (`translateAssessmentsForTrust`). If the projection only carried the effective value, a reader would see `NOT_TESTED` with no way to tell it was originally recorded as `PASS` and degraded by a stale profile — reopening the exact "report hides what the engine actually used" problem `report-fidelity` was built to close, just in a new field. If it only carried the recorded value, the report would contradict its own release verdict (showing `PASS` next to a verdict that was computed treating it as `NOT_TESTED`). Both, always.

`effectiveStatusReason` is a closed enum + optional detail, **produced by the trust-normalization layer and copied through unchanged** — `ReportBuilder`/`ControlAssessmentSnapshot` construction never infers or re-derives why a status changed, only copies what `translateAssessmentsForTrust` already computed:

```ts
type EffectiveStatusReasonCode =
  | "unchanged"
  | "stale_profile"
  | "risk_acceptance_missing"
  | "risk_acceptance_expired"
  | "risk_acceptance_revoked"
  | "risk_acceptance_scope_mismatch";

interface EffectiveStatusReason {
  code: EffectiveStatusReasonCode;
  detail?: string;
}
```

#### 3.2.1 Control catalog join is exact-version or not at all

`title`/`domain` come from `getControls()`. The catalog (`data/controls/*.json`) stores exactly one entry per `controlId` — no historical versions are retained (verified against the current repo). A naive join on `controlId` alone would silently show a control's *current* title/domain next to an assessment taken against a *past* version — a historical-fidelity bug in the same family as everything else this spec exists to prevent.

The join is `(controlId, controlVersion)` exact match. When it succeeds, `title`/`domain` are populated normally. When `controlVersion` doesn't match what's in the current catalog (the control definition changed since this assessment), the snapshot still gets the *current* catalog's `title`/`domain` as a best-effort display value — showing nothing would make the control unidentifiable — but a `control_definition_version_mismatch` entry is added to `assessmentScopes` (§3.5) and the HTML must visibly flag affected rows (§5.4, Control Matrix). No code path fabricates a historical title that was never actually recorded anywhere.

### 3.3 `evidenceSnapshots[]`

`ControlAssessmentSnapshot.evidenceIds` references `Evidence` records the report otherwise never includes — a reader sees `"evidenceIds": ["EVD-017"]` with no way to answer "why PASS?". Scoped tightly: only `Evidence` records actually referenced by this report's `runControlAssessmentSnapshots[*].evidenceIds`, not the project's full `evidence.json`.

```ts
interface EvidenceSnapshot {
  evidenceId: string;
  type: Evidence["type"];
  location: string;
  description: string | null;
  capturedAt: string;
  capturedBy: string;
}
```

No `referencedByAssessments` field is stored on `EvidenceSnapshot` itself — `Evidence` as a concept doesn't know about `ControlAssessment`, and reverse-lookup is cheap to compute in the presentation layer (§4) from `runControlAssessmentSnapshots[*].evidenceIds`.

### 3.4 `riskAcceptanceSnapshots[]`

Same dangling-reference problem, same fix, for `ControlAssessmentSnapshot.riskAcceptanceId`. An `effectiveStatus === "ACCEPTED_RISK"` control with only `"riskAcceptanceId": "RA-017"` in the report tells a reader nothing about why the risk was accepted, who approved it, what compensating controls exist, or whether it's still active. Scoped to only the `RiskAcceptance` records referenced by this report's `runControlAssessmentSnapshots[*].riskAcceptanceId`:

Mirrors the real `RiskAcceptance` interface (`src/core/repository.ts`) field-for-field, minus the internal `projectId`:

```ts
interface RiskAcceptanceSnapshot {
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
```

`status`/`revokedAt`/`revokedReason` matter for the exact same reason §3.2 keeps `recordedStatus` alongside `effectiveStatus`: a reader looking at `ACCEPTED_RISK` needs to know whether the risk acceptance backing it is still `active` today, not just that one existed at some point.

### 3.5 `assessmentScopes`

A small, structured object making the project-scoped-vs-run-scoped split (and the §3.2.1 version-mismatch case) machine-readable rather than something only a careful reader infers from field names:

```ts
interface AssessmentScopes {
  projectScoped: string[];   // e.g. ["projectFindingSnapshots", "score", "releaseEvaluation"]
  runScoped: string[];       // e.g. ["runControlAssessmentSnapshots", "evidenceSnapshots", "riskAcceptanceSnapshots"]
  controlDefinitionVersionMismatches: string[];   // controlIds affected by §3.2.1
}
```

### 3.6 `reportSchemaVersion` → `"2.1.0"`

Per §9's versioning policy: purely additive within the `2.x` contract.

## 4. `PresentationModel` and the core invariant

**Invariant (binds everything downstream of this line): engine judgment is owned by `ProjectReport`. `PresentationModel` introduces no new security judgment — only selection, aggregation, reverse-reference, and display hierarchy, derived from `ProjectReport` by a pure function with no other inputs besides injected `rendererVersion`/`renderedAt` (§8.2).**

Concretely, this rules out things that look harmless but aren't:
- Re-sorting findings by `severity` instead of the existing `priorityIndex` ordering (inventing a new ranking the engine never produced)
- Promoting a finding to "top finding" because its `severity` is higher than `prioritizedFindings[0]`'s (same problem)
- Recomputing a domain's `score` instead of copying `ProjectReport.score.domainScores[i].score` verbatim
- Generating prose for `effectiveStatusReason` instead of mapping its fixed `code` through a static lookup table (§5.4.2)

`buildPresentationModel(report: ProjectReport, opts: { rendererVersion: string; rendererRenderedAt: string }): PresentationModel` is a pure function — clock and version are **injected**, never read internally via `Date.now()`/`package.json`, specifically so the same `(report, opts)` pair always produces byte-identical output (needed for deterministic/snapshot testing, §10.3).

```ts
interface PresentationModel {
  metadata: {
    reportId: string;
    reportSchemaVersion: string;
    projectId: string;
    projectName: string;
    assessmentRunId: string;
    reportGeneratedAt: string;
    rendererVersion: string;
    rendererRenderedAt: string;
    sourceReportSha256: string;      // see §8.3
    target: {
      available: boolean;
      repository: string | null;
      commitSha: string | null;
      branchOrTag: string | null;
      dirty: boolean | null;
      provenanceKind: "caller-asserted" | "legacy-unavailable";
    };
  };

  executive: {
    verdict: ReleaseEvaluation["result"];
    coverage: { percent: number; assessed: number; applicable: number };
    confirmedCritical: number;
    confirmedHigh: number;
    blockingControlFailures: string[];
    blockingControlsNotVerified: string[];
    topPrioritizedFinding: {
      findingId: string;
      title: string;
      severity: FindingSnapshot["severity"];
      type: FindingSnapshot["type"];
    } | null;   // built by joining prioritizedFindings[0] with projectFindingSnapshots — no new scoring
  };

  domains: DomainPresentation[];     // see below, === ProjectReport.score.domainScores verbatim + coverage/effectiveStatus breakdown

  controls: ControlRow[];            // see §5.4.1 — flattened, canonically ordered runControlAssessmentSnapshots + joined title/domain

  findings: FindingCard[];           // see §5.5.1 — existing prioritizedFindings order, joined with projectFindingSnapshots

  evidenceIntegrity: {
    evidence: EvidenceSnapshot[];
    riskAcceptances: RiskAcceptanceSnapshot[];
  };

  limitations: PresentationLimitation[];

  assessmentScopes: AssessmentScopes;   // copied from ProjectReport
}

interface DomainPresentation {
  domain: string;
  score: number;                     // === ProjectReport.score.domainScores[i].score, never recomputed
  coverage: { percent: number; assessed: number; applicable: number };
  effectiveStatusCounts: { pass: number; fail: number; partial: number; notTested: number; notApplicable: number; acceptedRisk: number };
}

interface PresentationLimitation {
  code:
    | "legacy_provenance_unavailable"
    | "target_caller_asserted"
    | "project_scoped_findings"
    | "project_scoped_score_release"
    | "control_definition_version_mismatch"
    | "rounded_display_values"
    | "missing_evidence";
  severity: "info" | "warning";
  message: string;
}
```

`limitations[]` is populated by `buildPresentationModel` inspecting the report's actual state (e.g. `target === null` → `legacy_provenance_unavailable`; `assessmentScopes.controlDefinitionVersionMismatches.length > 0` → one `control_definition_version_mismatch` entry) — never hardcoded prose written once and left to go stale. The HTML's "Limitations" section (§5.7) renders this array directly.

**Canonical ordering (every array in `PresentationModel` is deterministically sorted — never "whatever order the source JSON happened to be in"):**
- `domains` → stable alphabetical domain order
- `controls` → `(domain, controlId)`
- `findings` → existing `prioritizedFindings` order, with a deterministic tie-break (e.g. `findingId` ascending) for equal priority
- `evidence` → `evidenceId` ascending
- `riskAcceptances` → `riskAcceptanceId` ascending
- `limitations` → fixed `(severity, code)` order, not insertion order

## 5. HTML structure

Seven sections, in this order:

### 5.1 Header + provenance badge

`projectName`, verdict badge, `target` (or a visible "Legacy assessment — target provenance unavailable" badge when `target.available === false`), `assessmentRunId`/engine version if available, report date.

### 5.2 Executive Summary

KPI numbers + short explanatory text, not charts (see §6.1 on dropping the donut). Verdict, coverage %, confirmed critical/high counts, blocking control failures/not-verified lists, top prioritized finding.

### 5.3 Domain Overview

Per-domain score + coverage side by side (never score alone — "100 score but 20% coverage" read in isolation is misleading). Plain bars, not D3 (§6.4).

### 5.4 Control Matrix

Semantic `<table>` as the authoritative representation (Control / Recorded / Effective / Reason / Evidence / Findings columns — see `ControlRow` in §5.4.1), optionally paired with a small supplementary D3 heatmap that never carries information absent from the table (§6.2). Rows affected by a `control_definition_version_mismatch` (§3.2.1) are visibly flagged (e.g. a badge next to the control's title).

#### 5.4.1 `ControlRow`

The flattened, display-ready shape `PresentationModel.controls[]` holds — one row per `ControlAssessmentSnapshot`, joined with its referenced evidence/risk-acceptance and the reverse-mapped findings that cite it:

```ts
interface ControlRow {
  controlId: string;
  controlVersion: number;
  title: string;
  domain: string;
  controlDefinitionVersionMismatch: boolean;   // true when §3.2.1's exact-version join failed
  recordedStatus: ControlAssessmentSnapshot["recordedStatus"];
  effectiveStatus: ControlAssessmentSnapshot["effectiveStatus"];
  effectiveStatusReason: { code: EffectiveStatusReasonCode; label: string; detail?: string } | null;   // label from §5.4.2's static table
  assessedAt: string;
  assessedBy: string;
  owner: string;
  nextReviewAt: string | null;
  notes: string | null;
  evidence: EvidenceSnapshot[];        // resolved from evidenceIds
  riskAcceptance: RiskAcceptanceSnapshot | null;   // resolved from riskAcceptanceId
  findingIds: string[];
}
```

#### 5.4.2 `EffectiveStatusReasonCode` → display label

A static lookup table, not generated prose (§4's invariant) — `buildPresentationModel` maps `effectiveStatusReason.code` through this exact table:

| `code` | Display label |
|---|---|
| `unchanged` | (no reason shown — recorded and effective match) |
| `stale_profile` | Assessment predates the report run's current profile state |
| `risk_acceptance_missing` | No risk acceptance record found for this control |
| `risk_acceptance_expired` | Risk acceptance was no longer valid at evaluation time |
| `risk_acceptance_revoked` | Risk acceptance was revoked before evaluation time |
| `risk_acceptance_scope_mismatch` | Risk acceptance does not cover this control/finding |

### 5.5 Findings

Progressive-disclosure cards (collapsed summary ↔ expand for full `attackScenario`/`exploitabilityEvidence`/evidence — see `FindingCard` in §5.5.1), with the Priority×Criticality scatter as a secondary "Prioritization Map" view inside this section (not in Executive Summary — see §6.1), tooltips labeled `Priority index: N` / `Criticality index: N`, never "risk score."

#### 5.5.1 `FindingCard`

```ts
interface FindingCard {
  findingId: string;
  title: string;
  type: FindingSnapshot["type"];
  severity: FindingSnapshot["severity"];
  status: FindingSnapshot["status"];
  priorityIndex: number;
  criticalityIndex: number;
  attackScenario: string | null;
  exploitabilityEvidence: string | null;
  linkedControlIds: string[];     // FindingSnapshot.controlIds, cross-referenced against ControlRow for drill-down links
}
```

### 5.6 Control Evidence

Evidence and risk-acceptance cards, bidirectionally linked with the Control Matrix (clicking a control's evidence count jumps to the relevant cards; cards show which controls reference them, via `evidenceIntegrity.evidence`/`evidenceIntegrity.riskAcceptances` in §4 plus the reverse-lookup computed from `controls[*].evidenceIds`/`riskAcceptanceId`).

### 5.7 Scope / Methodology / Limitations / Provenance

`assessmentScopes`, `limitations[]` rendered directly, full `metadata` block including `sourceReportSha256`.

### 5.8 Terminology

"Finding Verification" (→ `attackScenario`/`exploitabilityEvidence`, Finding-side, §5.5) is kept visually and textually distinct from "Control Assessment Evidence" (→ `evidenceSnapshots`, ControlAssessment-side, §5.6) — both are informally "evidence" but are different concepts referencing different source data, and conflating their labels was flagged as a real confusion risk during review.

## 6. Visualization: what needs D3, what doesn't

**Decided principle: D3 is always supplementary to an accessible HTML/CSS/SVG representation, never the only carrier of information.** Nothing in the report may be knowable *only* by reading a D3-rendered chart.

### 6.1 Executive Summary: no donut

A severity-distribution donut for a handful of categories (e.g. "Confirmed Critical: 1") is decorative, not informative — a reader gets more from the bare number plus one line of context than from a tiny arc. Dropped. Same reasoning moved the Priority×Criticality scatter out of Executive Summary into Findings (§5.5): `priorityIndex`/`criticalityIndex` are both bounded integer indices, and displaying them as a prominent Executive Summary chart risks reading them as continuous, comparable "risk scores" they were never designed to be.

### 6.2 Control Matrix: semantic table first, D3 heatmap optional

Reconsidered mid-review: `ControlAssessment` is fundamentally categorical tabular data (control × status × reason × evidence × findings). A `<table>` is strong, free accessibility (screen readers, keyboard nav, print, copy/paste, long titles, and the `recorded`/`effective` dual-state all fall out of it naturally) that a pure D3 heatmap would have to reimplement by hand and likely wouldn't. The table is the **authoritative representation**; an optional small D3 mini-heatmap may sit above it as a quick-scan supplementary view, but every data point it shows must also be in the table.

### 6.3 Where D3 is used

- **Priority×Criticality scatter** (Findings section, §5.5) — two genuinely continuous-looking axes on a 2D plot; this is what D3 is actually good at.
- **Optional Control Matrix mini-heatmap** (§6.2) — supplementary only.

### 6.4 Where D3 is explicitly not used

- Domain coverage bars — plain CSS/SVG.
- Release-blocker/not-verified lists — plain HTML lists, not a force-directed graph (not graph-shaped data).
- Severity distribution — dropped (§6.1), not replaced with a non-D3 chart either.

### 6.5 Visual grammar for the control matrix

- Cell color/state = **`effectiveStatus`** (what the engine actually used for score/verdict) — never `recordedStatus`.
- A small marker (e.g. ↺) overlays any cell where `recordedStatus !== effectiveStatus`.
- Hover/click reveals: Recorded, Effective, Reason (mapped through the static `EffectiveStatusReasonCode` → display-label table, §5.4.2 — never prose generated at render time), Assessed at, Run.

### 6.6 Color palettes (kept distinct — status and severity must never share a palette, since both appear together on one screen)

**Status** (`effectiveStatus`): PASS = green, FAIL = red, PARTIAL = amber, N/A = gray, NOT_TESTED = muted gray, ACCEPTED_RISK = blue/purple (distinct from the red/amber/green status-outcome colors, since an accepted risk is a different kind of thing than a pass/fail/partial outcome).

**Finding severity**: CRITICAL = deep crimson, HIGH = red-orange, MEDIUM = amber, LOW = muted blue, INFORMATIONAL = gray.

Color is always supplementary — status/severity are paired with a text label or glyph, never conveyed by color alone (contrast and print safety both depend on this, §7 and §11).

## 7. Accessibility

- Progressive-disclosure finding cards use native `<details>`/`<summary>` — keyboard accessibility comes for free.
- Filter interactions update an `aria-live="polite"` region (e.g. "Showing 4 of 17 findings").
- Every SVG has `<title>`/`<desc>`; meaningful data points also get `aria-label` or an accessible HTML equivalent.
- Contrast targets: body text 4.5:1, focus/graphic boundaries 3:1 where achievable.
- Color is supplementary only (§6.6).

## 8. Security, determinism, and provenance

### 8.1 XSS

`ProjectReport` data originates from real assessed repositories and can contain literal attacker-controlled strings (e.g. a finding's `exploitabilityEvidence` quoting an actual XSS payload found in the target codebase). **Invariant: no `ProjectReport` string may be interpolated into raw HTML without escaping.** Concretely:
- Text content → `textContent`, never template-literal string concatenation into `innerHTML`.
- Attributes → dedicated attribute escaping.
- URLs → protocol allow-list.
- SVG text → D3's `.text()`, never `.html()`.
- No `innerHTML` is ever set from report data, anywhere in the renderer.
- Embedding data inside a `<script>` tag (for D3/JS to consume) requires more than `JSON.stringify()` — a literal `</script>` inside a JSON string value must not be able to terminate the script early. After `JSON.stringify()` runs, five characters in its output get replaced with their JavaScript Unicode escape sequence before the result is written into the `<script>` body: the less-than sign, the greater-than sign, the ampersand, U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH SEPARATOR). None of those five characters may appear literally in the final serialized output.

### 8.2 Zero network

Spec invariant: **"Generated report HTML MUST issue zero HTTP(S) network requests during normal viewing."** D3 is vendored and inlined (not loaded from a CDN — that would both violate this invariant and contradict the "self-contained, works offline" requirement that motivated a single HTML file in the first place). All assets are inline or `data:` URIs — no analytics, no remote fonts/CSS/scripts. A restrictive CSP meta tag is included:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
```

`'unsafe-inline'` is required because the report's data and rendering code are inline by design; the CSP's value is blocking any *network* egress even if a script-injection bug somehow survived §8.1.

### 8.3 Provenance: `sourceReportSha256`

`generate_report_html` reads the source `ProjectReport` JSON file's raw bytes and computes their SHA-256, embedding it (plus `reportId`/`reportSchemaVersion`) in the HTML's footer/metadata section (§5.7). This lets anyone verify a given HTML file corresponds exactly to a given JSON file — a cheap, strong integrity guarantee appropriate for a report handed to a security officer who may want to cross-check it against the canonical JSON artifact.

### 8.4 Determinism

`buildPresentationModel` and the HTML renderer are deterministic pure functions of `(report, rendererVersion, renderedAt)` — same inputs always produce byte-identical output. This requires:
- Clock/version injected, never read internally (§4).
- All `PresentationModel` array orderings canonical (§4).
- No source of non-determinism (object key iteration order, `Math.random`, `Date.now()` inside rendering logic) anywhere in the pipeline.

### 8.5 Reference integrity (metamorphic invariants — the backbone of §10.3's test strategy)

- `PresentationModel.domains[i].score === ProjectReport.score.domainScores[i].score`, always — never recomputed.
- `PresentationModel.executive.verdict === ProjectReport.releaseEvaluation.result`, always — never re-evaluated.
- No finding is ever reordered ahead of `ProjectReport.prioritizedFindings`'s existing order based on its own `severity`.
- Every `findingId`/`evidenceId`/`riskAcceptanceId` referenced anywhere in `PresentationModel` resolves to an actual entry in the corresponding `ProjectReport` array (closes the dangling-reference class of bug this whole design exists to fix).

## 9. Versioning policy

`reportSchemaVersion` is **not** strict old-validator-compatibility SemVer — with `additionalProperties: false` JSON schemas, an old `2.0.0` validator would reject any `2.1.0` document regardless of "non-breaking" framing, since it has keys the old schema doesn't recognize. The policy being adopted is explicit:

- **`2.x`**: same conceptual `ProjectReport` contract; additive fields permitted.
- **`3.x`**: existing fields removed, a field's meaning changes, or a field's type changes incompatibly.

This cycle's changes are purely additive → `2.1.0`.

## 10. Testing strategy

1. **Real-browser XSS corpus.** Craft `ProjectReport` fixtures containing literal payloads (e.g. a finding title/evidence string containing `</script><script>window.__CSI_XSS__=true</script>`), generate the HTML, open it in a real browser context, assert `window.__CSI_XSS__` is not `true` and that the payload is visible as literal text.
2. **Zero-network test.** Open the generated HTML in a browser with network interception; assert zero requests fire during normal viewing.
3. **Determinism / snapshot tests.** Same `(report, rendererVersion, renderedAt)` → byte-identical HTML, asserted via snapshot.
4. **Reference-integrity / metamorphic tests** (§8.5) — the `PresentationModel.domains[i].score === report.score.domainScores[i].score` class of assertion, for every field that must be copied-not-recomputed.
5. **Accessibility baseline** — automated checks (e.g. axe-core or equivalent) against the generated HTML for contrast, missing `alt`/`aria-label`, and heading structure, plus the specific invariants in §7.
6. **Print acceptance** — 1-2 browser screenshots as smoke/visual-regression checks, not full pixel-perfect coverage.

## 11. Print support

`@media print` rules: hide interactive controls, remove sticky positioning, force all `<details>` finding/evidence cards open (nothing can be clicked on paper), keep chart labels visible, `page-break-inside: avoid` on cards, hide navigation, links show useful text (hrefs vanish visually in print), background colors are never required to convey meaning (status/severity must already be legible via text/glyph per §6.6, not fill alone) — `print-color-adjust: exact` may be set but isn't load-bearing, since browsers can ignore it. SVGs get explicit `viewBox` so they aren't clipped when printed.

## 12. Mobile/responsive

Policy: **"responsive, not mobile-optimized."** No dedicated mobile UX is built; the layout must not break at 320–400px widths. Concretely: KPI cards, domain bars, finding cards, and evidence cards collapse to a single column; the Control Matrix table scrolls horizontally in its own container rather than reflowing.

## 13. Tool architecture

- **`generate_report_data`** (renamed from `generate_report`) — same `{ projectId, runId, summary }` input, same mechanics, plus the `2.1.0` fields from §3. Reads `getControlAssessments(projectId)`, filters to the run, builds `runControlAssessmentSnapshots`/`evidenceSnapshots`/`riskAcceptanceSnapshots`/`assessmentScopes`, saves the `ProjectReport` exactly as `generate_report` does today.
- **`generate_report_html`** — new tool, input `{ projectId, reportId }`. Reads the existing `ProjectReport` (no new assessment work, no re-evaluation), computes its SHA-256 (§8.3), builds a `PresentationModel` (§4) via a pure function, renders a single self-contained `.html` file (chart computation and HTML assembly are both internal to this tool — neither is a separately exposed MCP tool), saves it alongside the source report (mirroring `data/projects/<id>/reports/` conventions), returns the file path.

Rename is a breaking change to the MCP tool name with no backwards-compatibility shim — consistent with this project's established convention (the `criticalFindings`/`highFindings` rename in `report-fidelity` was handled the same way).

## 14. Out-of-scope reminders (do not expand mid-implementation)

- AttackPath graph visualization
- Making core `calculateScore`/`evaluateRelease` run-scoped
- Fresh engine re-assessment of the 8 validation projects / populated provenance demonstration

All three are legitimate follow-up work, tracked here so they aren't silently dropped, but are not part of this spec's implementation.
