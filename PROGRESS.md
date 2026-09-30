# C.S.I-mcp — Progress

Security Check MCP: an MCP server, backed by a JSON data foundation
(schemas + reference data), that an AI agent can hold a conversation
through to run security reviews against real projects, score them, and
produce prioritized, reproducible reports. This document tracks what's
built, how it's organized, and what's left.

Last updated: 2026-09-30

## Status at a glance

- **Phase 1 — Control catalog foundation:** done, merged.
- **Phase 2 — Project/scoring/priority/workflow schemas:** done, merged.
- **Catalog integrity & pilot controls (semantic validator + 5 new control
  domains):** done, merged — see
  `docs/superpowers/specs/2026-09-22-catalog-integrity-and-pilot-design.md`
  and `docs/superpowers/plans/2026-09-23-catalog-integrity-and-pilot.md`.
- **devops-supply-chain control domain:** done, merged (bounded task, no
  spec/plan doc — dependency SCA + provenance/pinning, CI secret isolation,
  third-party CI action integrity, build/release artifact integrity).
- **governance control domain:** done, merged (bounded task, no spec/plan
  doc — release sign-off, incident response ownership, time-boxed risk
  acceptance review, third-party vendor assessment). This is the 8th and
  last of the originally-planned control domains — see "Key design
  decisions" below for how its controls stay applicable regardless of a
  project's technical profile.
- **Test suite:** 325/325 passing, 48 files (`npm test`).
- **Core Engine (pure-function computation layer):** done, merged — see
  `docs/superpowers/specs/2026-09-28-core-engine-design.md` and
  `docs/superpowers/plans/2026-09-28-core-engine-implementation.md`. 7
  modules under `src/core/`: `applicability.ts`, `criticality.ts`,
  `score.ts`, `plan-expander.ts`, `release-evaluator.ts`,
  `report-builder.ts`, `repository.ts`.
- **MCP server (service layer + tool/handler layer):** done, merged — see
  `docs/superpowers/specs/2026-09-30-mcp-server-design.md` and
  `docs/superpowers/plans/2026-09-30-mcp-server-implementation.md`. Adds
  `src/service/` (`ProjectService`, `AssessmentService`, `AnalysisService`,
  `ReportService` + small `errors`/`ids`/`constants`/`severity` utilities)
  and `src/mcp/` (`server.ts` + 11 MCP tools) on top of the Core Engine.
  The server is now runnable end-to-end: `npm run build && npm start`
  serves 11 tools over stdio (`create_project`, `get_project`,
  `update_project_profile`, `start_assessment_run`, `list_controls`,
  `record_assessment`, `record_finding`, `list_findings`, `get_score`,
  `evaluate_release`, `generate_report`). Agent orchestration
  (`expandPlan`/batch dispatch) remains out of scope — deferred to a later
  phase, per the design spec.
- **Control content:** 48 controls across 8 domain files (`identity-access`,
  `appsec`, `infrastructure`, `operations`, `platform-specific`,
  `data-crypto`, `devops-supply-chain`, `governance`) — all 8 originally
  planned domains are now written.

## Architecture in one paragraph

Everything lives under `data/` as hand-authored JSON, validated by a small
TypeScript + Ajv (draft 2020-12) + Vitest harness (`src/validate.ts` +
`tests/`). Two kinds of entity are kept strictly separate everywhere:
**catalog data** (`Control`, `Threat`, `CriticalityFormula`, `ScoreModel` —
static, versioned, reusable across every project) and **project state**
(`Project`, `ControlAssessment`, `Finding`, `AssessmentRun`/`Batch`,
`Score`, `ProjectReport` — dynamic, one instance per project/run). Every
tunable formula (how severity becomes a 0-9 criticality index, how control
statuses become a 0-100 score) is its own schema-validated reference-data
file under `data/core/`, never hardcoded — so weights can change without
touching a schema or writing code, and every computed value records which
formula version produced it.

## Directory map

```
data/
  manifest.json              # entry point: catalogVersion, file lists, counts
  core/                      # principles, security levels, profile taxonomy,
                              # criticality weights, scoring model (5 files)
  catalogs/                  # threats, references, evidence-types,
                              # owner-roles, asset-types (5 files)
  controls/                  # 8 files, 48 controls total: identity-access
                              # (12), appsec (6), infrastructure (6),
                              # operations (5), platform-specific (5),
                              # data-crypto (5), devops-supply-chain (5),
                              # governance (4)
  schemas/                   # 18 JSON Schema (draft 2020-12) documents —
                              # see "Schemas" table below
  process/                   # verification flow, release gates, incident
                              # response, exception policy, metrics,
                              # deliverables (6 files)
  projects/                  # project-instance data, one dir per projectId,
                              # created at runtime by the MCP server (empty
                              # in a fresh checkout)
  plans/                     # flat AssessmentPlan-per-file store, created
                              # at runtime (the MCP server auto-creates one
                              # minimal default plan per project)
src/validate.ts               # loadJson / createAjv / compileSchemaFromFile
src/core/                     # pure/near-pure computation + SecurityRepository
                              # (Core Engine — see "Schemas" section above it)
src/service/                  # Application/service layer: ProjectService,
                              # AssessmentService, AnalysisService,
                              # ReportService + errors/ids/constants/severity
src/mcp/                      # MCP tool/handler layer: server.ts + 11 tools
                              # under src/mcp/tools/
tests/                        # one *.test.ts per schema/data/core/service/
                              # mcp-tool concern, plus tests/integration/
docs/superpowers/specs/       # design specs (the "why")
docs/superpowers/plans/       # implementation plans (the "how, task by task")
```

## Schemas (18)

| Schema | Phase | Represents |
|---|---|---|
| `control-schema.json` | 1 | A security requirement in the catalog (static, versioned) + the Applicability Rule DSL |
| `threat-schema.json` | 1 | A named threat a control mitigates |
| `project-profile-schema.json` | 1 | A project's technical/exposure characteristics (standalone) |
| `asset-schema.json` | 1 | A protected asset (data, credential, infra resource...) |
| `control-assessment-schema.json` | 1 | One Control Matrix row: a project's PASS/FAIL/... verdict on one control |
| `evidence-schema.json` | 1 | A piece of proof backing an assessment |
| `finding-schema.json` | 1, modified in 2 | A discovered vulnerability — now carries `priority`/`criticality` provenance objects |
| `attack-path-schema.json` | 1 | A chained sequence of findings forming an exploit path |
| `risk-acceptance-schema.json` | 1 | A formally accepted, time-boxed risk (expiry required) |
| `release-evaluation-schema.json` | 1 | A gate 0-4 release verdict |
| `project-schema.json` | 2 | The thing being assessed; wraps `ProjectProfile` + `profileRevision` |
| `criticality-formula-schema.json` | 2 | Defines how Finding's 5 severity factors combine into `criticality.index` |
| `assessment-plan-schema.json` | 2 | Reusable policy: what to check (`selection`), how to group it (`groupBy`) |
| `assessment-run-schema.json` | 2 | One execution of a plan against a project; owns its batches |
| `assessment-batch-schema.json` | 2 | One agent's unit of work within a run |
| `score-model-schema.json` | 2 | Defines how control statuses combine into a 0-100 score |
| `score-schema.json` | 2 | A project's score: overall + coverage + per-domain breakdown |
| `project-report-schema.json` | 2 | The immutable, reproducible final deliverable |

## Key design decisions (see the specs for full rationale)

- **Catalog vs. assessment split** — a `Control` never contains a project's
  PASS/FAIL; that lives only in `ControlAssessment`. Same pattern for
  `Threat` (catalog) vs. `Finding` (project-specific).
- **Applicability is three-valued** (`applicable | not_applicable | unknown`)
  via a declarative rule DSL on each Control — missing profile data must
  never silently read as "not applicable." **Hard rule for whoever builds
  the Applicability Engine:** whatever evaluates `ProjectProfile`'s
  `components`/`identities`/`dataClasses` fields against a Control's
  `applicability` rule DSL must never normalize those fields with `?? []`
  or an equivalent default — an omitted (not-yet-profiled) field and an
  intentionally-empty one are different states, and normalizing with `?? []`
  collapses the three-valued UNKNOWN into NO. This is written down here and
  in the design spec; it is not optional guidance.
- **Priority vs. Criticality are deliberately different kinds of value.**
  `criticality` is a *computed* object (`index`, `formulaId`, `formulaVersion`,
  `computedAt`) — an agent supplies the 5 underlying severity factors, never
  the index directly. `priority` is an *agent-judgment* object (`index`,
  `source`, `rationale`, `assignedBy`, `assignedAt`) — business context can
  make a low-criticality finding more urgent than a high-criticality one.
  A guardrail (`criticality.index>=8` AND `priority.index>=2` requires
  `priorityOverrideReason`) keeps that judgment call auditable rather than
  silent. Sort order for a prioritized list: `priority.index` asc →
  `criticality.index` desc → `findingId` asc (final tie-break).
- **A score is never reported without its coverage.** `Score.coverage` and
  every `domainScores[]` entry's full 6-status breakdown (PASS/FAIL/PARTIAL/
  NOT_TESTED/N-A/ACCEPTED_RISK) exist specifically so "3 tested, 97
  untested" can never read as "100% score."
- **`AssessmentPlan → AssessmentRun → AssessmentBatch`** is a policy →
  execution → work-unit hierarchy. `groupBy` (`domain|subdomain|layer|
  group|controlId`) is a runtime-configurable dimension reusing fields
  already on every Control record — no new taxonomy needed, and
  `controlId` covers "one agent per control" as just the finest-grained
  value of the same setting.
- **`ProjectReport` is an immutable snapshot.** It pins `assessmentRunId`,
  `catalogVersion`, `profileRevision`, `criticalityFormula` (id+version),
  and `score.scoreModel` (id+version) — so a report stays reproducible
  years later even after the catalog, formulas, or a project's profile
  change.
- **Process/organizational controls stay applicable without a schema
  change.** Every domain before `governance` gates `applicability.when` on
  a project's *technical* profile (has a database, has file upload, ...).
  Governance controls (security sign-off, incident response ownership,
  risk acceptance review, vendor assessment) must apply regardless of
  technical profile. Rather than adding an `alwaysApplicable` escape hatch
  to `control-schema.json`, the convention is to gate on
  `{"fact": "securityLevel", "operator": "in", "value": ["SVL-0", "SVL-1",
  "SVL-2", "SVL-3"]}` — `securityLevel` is the one `ProjectProfile` field
  that's always required with exactly those 4 possible values, so this
  condition is trivially always true for any real profile, using the
  existing Applicability Rule DSL exactly as-is. All 4 `governance`
  controls use this pattern; see `data/controls/governance.json`.
- **Self-contained schema files.** No cross-file `$ref` between schemas
  (small enums like `groupBy` or `evidenceType` are duplicated verbatim
  across the few files that need them) — keeps the Ajv validation harness
  simple. The tradeoff is explicit: nothing currently guards against those
  duplicated copies drifting apart (see Known gaps below).

## How to verify the current state

```bash
npm install
npm test         # expect: 48 files, 325 tests, all passing
npx tsc --noEmit # expect: clean (vitest alone does NOT type-check —
                  # this caught real bugs during MCP server development
                  # that npm test missed; always run both)
npm run build    # compiles src/ to dist/ (tsconfig.build.json, rootDir: src)
npm start        # runs the built MCP server over stdio (dist/mcp/server.js)
```

`data/manifest.json` is the single source of truth for what's registered —
`controls.count` (48), `schemas.files` (18 entries), `core.files` (5
entries) are all test-enforced against what's actually on disk
(`tests/manifest.test.ts`).

## Known gaps / deferred items (from the Phase 2 final review, all parked deliberately — none blocking)

Two gaps flagged in the Phase 2 final review are now **resolved** by the
catalog-integrity-and-pilot branch: `finding-schema.json` now compiles
under Ajv `strict: true` like the other 17 schemas (`tests/schemas/
finding-attack-path-schemas.test.ts`), and drift-guard tests for the 4
hand-duplicated shapes now exist (`tests/schema-drift.test.ts`, 4 tests).

A third gap is now **resolved** by the Core Engine final-review fix
wave: item 1 below (the self-referential `prioritizedFindings` sort
test) has been replaced with a real test that calls
`sortPrioritizedFindings` from `src/core/report-builder.ts` on a
deliberately unsorted fixture.

1. ~~The `prioritizedFindings` sort-invariant test is self-referential
   (it sorts a fixture and compares it to itself) since no real sorting
   code exists yet~~ — **resolved**, see above.
2. Referential integrity between denormalized fields (e.g. a Batch's
   `planId` should always equal its Run's `planId`) isn't schema-enforceable
   and isn't yet written down as a process rule anywhere.
3. Two EvidenceType/OwnerRole-style small enums are still hand-duplicated
   across `catalogs/*.json` and their governing schema, guarded by a test
   from Phase 1 (`tests/catalogs/catalogs.test.ts`) — the Phase 2 duplicates
   handled by the drift-guard tests above are a separate set of shapes.

## Core Engine follow-up items (parked at final review, not blocking)

- Unrecognized `fact` strings in a Control's `applicability.when` (e.g. a typo like `features.authentcation`) silently evaluate to `not_applicable` instead of erroring — spec asked for a compatibility check the DSL can't currently express; needs a new validation step (e.g. in `validate-catalog.ts` or the applicability smoke test) cross-referencing every fact path against `project-profile-schema.json`'s properties.
- `calculateScore` silently excludes any control with no assessment record at all (see the new doc comment on `calculateScore` in `src/core/score.ts`) rather than treating it as implicitly NOT_TESTED — deferred scoring-semantics change, needs its own design pass.
- Control lifecycle `status` (`draft`/`active`/`deprecated`/`retired` per `control-schema.json`) is not enforced anywhere in the Core Engine — `getControls()` returns all records unfiltered regardless of status, and the `RELEASE_GATE_CONTROL_MAP` drift guard only checks `replacedBy`, not `status`. Zero live defect today (all 48 controls are `active`), but this is a gap in both the spec and the plan, not just the implementation.
- `Score` (as `calculateScore` produces it) omits `computedAt` and `projectId`, which the standalone `score-schema.json` requires — this is intentional (it matches the report-embedded variant, the only thing anything currently consumes) but is an undocumented departure from the design spec's literal wording; recorded here for whoever eventually needs the standalone form.
- `JsonRepository` never validates data against Ajv/the JSON schemas on read or write (`src/validate.ts`'s `createAjv`/`compileSchemaFromFile` exist but aren't used by `repository.ts`) — malformed on-disk data would flow straight into scoring with no error. Deferred until real project data starts flowing through this repository.
- Sorting in `plan-expander.ts`/`report-builder.ts` mixes `localeCompare()` (locale-dependent) and bare `.sort()` (UTF-16 code-unit order) — low risk today (all real data is uppercase-ID/lowercase-ASCII), but not the single deterministic comparator the design spec's determinism guarantee implies.
- 4 of the 48 real controls have a bare leaf condition (not wrapped in `all`/`any`) at the root of their `applicability.when` — for these, `evaluateApplicability`'s `matchedRules` is always `[]` even though a leaf did determine the verdict, so the explainability field is empty for exactly these 4 controls (the verdict itself is still correct).
- No Ajv-based drift guard exists yet for the ~8 new TypeScript interfaces this plan added that restate frozen JSON Schemas (`Score`, `DomainScore`, `ProjectReport`, `ReleaseEvaluation`, etc.) — `tests/schema-drift.test.ts` covers 4 earlier shapes from Phase 2 but wasn't extended to these.

## Real-world validation: full assessment of a real public project

Ran the actual built MCP server (real protocol stack — `McpServer` +
`Client` + `InMemoryTransport`, not a mock) through a complete 48-control
assessment of **Outline** (github.com/outline/outline, ⭐40k+, live SaaS
at getoutline.com), source-code-only (no live requests to the deployed
service — a hard safety boundary, not a tool limitation). Real, persisted
result: `overallScore` 51.3%, coverage 64.1%, 18 PASS / 4 PARTIAL / 3 FAIL
/ 9 N/A / 14 NOT_TESTED, 5 real Findings with code-cited evidence. Full
writeup (pipeline explanation + methodology + findings) at
`docs/assessments/2026-09-30-outline-validation.md` — **intentionally
untracked** (contains an unpatched, undisclosed real vulnerability in a
third-party live service; do not commit until responsible disclosure to
Outline's maintainers is resolved). Persisted assessment data itself is
also untracked, under `data/projects/` and `data/plans/`.

This run proved the tool produces genuine signal, but also surfaced two
real bugs no amount of synthetic-fixture testing had caught, now both
fixed and merged directly to main (bounded fixes, no separate branch):

- **`components` had an undocumented, unwritten canonical vocabulary.** The 8 values real controls actually check (`backend_api`, `browser_frontend`, `ci_pipeline`, `container_image`, `database`, `file_storage`, `mobile_app`, `release_pipeline`) existed only as an implicit convention in old plan documents — never in the schema, a reference data file, or any tool description. A reasonable-looking-but-different profile silently produced 28/48 applicable controls instead of the correct 42/48. **Fixed:** the 8 values now live in `data/core/profile-taxonomy.json` (matching the existing home for `exposure`/`identities`/`dataClassification`), documented in both schema files' `components` description and the MCP tool `.describe()`s, and — structurally, not just documentation — `src/validate-catalog.ts` gained a 9th validation rule (`CATALOG_UNKNOWN_COMPONENT_VALUE`) that fails catalog validation if any control's applicability rule ever references a component value outside this taxonomy, making this exact class of silent drift impossible to reintroduce.
- **`list_findings`'s `maxCriticalityIndex` filter had an inverted comparison direction.** `criticality.index` and `priority.index` run in *opposite* directions (criticality: 9 = worst; priority: 0 = most urgent) — the final-review fix wave's rename (`minCriticality` → `maxCriticalityIndex`) correctly fixed `priority`'s direction but carried the same `<=` comparison over to `criticality` too, which is wrong for its scale. Silently returned the *least* severe findings when asked for the most severe. **Fixed:** renamed to `minCriticalityIndex` with `>=` semantics (findings at or above the given severity); the existing test had baked in the same inverted assumption and was corrected alongside the fix.

Also added while in the area (documentation-only, no logic changes): `.describe()` on `record_finding`'s `severityFactors`/`priorityIndex` (grounded in the real criticality weight file's per-factor direction), `.describe()` on `update_project_profile`'s three-valued fields, clarified that `evaluate_release`'s `incidentResponseVerified`/`backupRestoreVerified` are informational sub-checks that don't themselves gate `result` (verified against `release-evaluator.ts`, confirmed intentional — not a bug), and clarified `list_controls`' summary-vs-full response-shape difference in its tool description.

## MCP server follow-up items (parked at final whole-branch review, not blocking)

The final review actually ran the built server against a live temp data
directory (not just read the code) and found — and a single fix wave
resolved — 6 real cross-task bugs: 3 of 11 tools skipping `projectId`
existence checks (worst case: `record_finding` silently wrote an orphaned
finding for a nonexistent project), `record_assessment` accepting an
unvalidated `runId`, `list_controls`'s overload type lying on the
`controlIds` path, `list_controls` showing stale applicability after a
manual override, and `list_findings`'s `minPriority`/`minCriticality`
filters being inverted against the schema's 0-is-most-urgent scale (now
`maxPriorityIndex`/`minCriticalityIndex` — see "Real-world validation"
above for why these ended up with different comparison directions). All 6
are fixed, tested, and merged. What's left, explicitly deferred rather
than silently dropped:

- No `outputSchema` is declared on any of the 11 tools — every handler needs an `as unknown as Record<string, unknown>` cast for `structuredContent` as a result. (Field-level `.describe()` coverage for the genuinely non-obvious fields is now done — see "Real-world validation" above — but full `outputSchema` declarations are still outstanding.)
- `findingId`/`evidenceId` generation is `array.length + 1`, not `max(existing numeric suffix) + 1` — a hand-deleted record (the only way to resolve a Finding in this phase; see below) could produce a duplicate id. Fixing this means changing `nextSequentialId`'s signature (count → the actual id array) across `src/service/ids.ts` and its two call sites — deferred as a deliberately separate, larger change rather than folded into the final fix wave.
- `src/mcp/server.ts`'s `main()` runs unconditionally at import time (no `import.meta.url` entry-point guard) — importing `buildServer` from a test connects a real `StdioServerTransport` to the importer's stdio. Nothing does this today (the integration test re-registers all 11 tools by hand instead), which also means `buildServer()`'s own tool registration is untested — a future dropped tool registration would be caught by nothing.
- `AnalysisService.getScore`/`evaluateRelease` and `ReportService.generate` independently compute `Score`/`ReleaseEvaluation` (~25 duplicated lines) rather than sharing one pure `computeScore`/`computeRelease` function — this is intentional (each needs its own single-snapshot read to avoid `generate_report` observing different state than a separate `get_score` call), but nothing currently guards the two staying in sync if one changes. No test asserts `get_score`'s output equals `report.score` on identical data.
- `withNotFound` (`src/service/errors.ts`) converts *any* rejection into `NOT_FOUND`, not just "the file doesn't exist" — a corrupt `project.json` or a permissions error would also read as "project not found," which could lead an agent to attempt creating a duplicate project instead of surfacing the real failure.
- No Finding lifecycle tool exists beyond creation (no `update_finding`/`resolve_finding`) — by design, per the spec's explicit out-of-scope list; resolving a finding today means direct data editing.
- An `AssessmentRun` is never marked `completed` — `start_assessment_run` sets `status: "running"` and nothing ever updates it, including `generate_report`, so every run in the data tree looks perpetually in-flight (schema-valid, but not semantically accurate).

## Next steps, in a reasonable order

Two items previously listed here are now **done**: closing the Phase 2 gaps
(see "Known gaps" above), and both open design questions that were
previously flagged as blocking further control-content scaling:
- **`assurance` vs. `verification.methods` linkage** is now enforced by the
  semantic catalog validator (`src/validate-catalog.ts`) — it checks that
  every `assurance.<SVL>` entry references a defined `verification.methods`
  type, and that assurance is cumulative across SVL levels actually present
  on a control.
- **`ProjectProfile`'s array fields (`components`/`identities`/
  `dataClasses`) are no longer always-required** — they are now
  three-valued (omitted = not yet profiled / unknown, empty array =
  profiled and confirmed absent, populated = profiled and present), so an
  empty array can no longer be misread as "not applicable."

### Control content is complete — all 8 originally planned domains done
`identity-access` (12), `appsec` (6), `infrastructure` (6), `operations`
(5), `platform-specific` (5), `data-crypto` (5), `devops-supply-chain`
(5), `governance` (4) — 48 controls total. This was Phase 1's own
disclosed follow-up item; nothing further is planned here unless new
domains are identified later.

### Core Engine and MCP server are both done — the tool is executable end-to-end
Every formula, applicability rule, and scoring model documented in `data/`
now runs: `npm run build && npm start` serves all 11 MCP tools over stdio,
backed by real `JsonRepository`-persisted project data.

### 1. Real-world validation (in progress)
Run the MCP server against actual public open-source projects (confirmed
public GitHub repos, live-operating websites) to produce a real security
assessment and prioritized finding list — the first end-to-end proof this
tool produces genuine security value, not just schema-valid output on
synthetic test fixtures. Scope, target selection, and safety boundaries
(source-level review vs. any form of live-site testing) to be defined
before starting.

### 2. Agent orchestration (explicitly deferred by the MCP server design spec)
`expandPlan`/batch dispatch, multi-agent parallel assessment, retry/resume
— a later phase, once the single-agent conversational flow has been
validated against real projects (see item 1).

### 3. Plan the SQLite migration (explicitly deferred since Phase 1)
Both phases were written so this stays cheap: every entity is a flat
record with small nested value-objects, no Control-in-Control nesting,
and IDs that read naturally as foreign keys. Not urgent — revisit once
real project data volume makes flat-file JSON impractical.
