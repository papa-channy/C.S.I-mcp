# C.S.I-mcp — Progress

Security Check MCP: a JSON data foundation (schemas + reference data) for a
future MCP server that runs security reviews against real projects, scores
them, and produces prioritized, reproducible reports. This document tracks
what's built, how it's organized, and what's left.

Last updated: 2026-09-21

## Status at a glance

- **Phase 1 — Control catalog foundation:** done, merged.
- **Phase 2 — Project/scoring/priority/workflow schemas:** done, merged.
- **Test suite:** 107/107 passing, 22 files (`npm test`).
- **Server implementation (MCP tools, runtime formula computation, database):** not started.
- **Control content beyond one proof-of-concept domain (12 controls):** not started.

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
  controls/                  # identity-access.json — 12 controls
                              # (IAM-AUTH-*, IAM-AUTHZ-*), proof-of-concept only
  schemas/                   # 18 JSON Schema (draft 2020-12) documents —
                              # see "Schemas" table below
  process/                   # verification flow, release gates, incident
                              # response, exception policy, metrics,
                              # deliverables (6 files)
src/validate.ts               # loadJson / createAjv / compileSchemaFromFile
tests/                        # one *.test.ts per schema/data concern
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
  never silently read as "not applicable."
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
- **Self-contained schema files.** No cross-file `$ref` between schemas
  (small enums like `groupBy` or `evidenceType` are duplicated verbatim
  across the few files that need them) — keeps the Ajv validation harness
  simple. The tradeoff is explicit: nothing currently guards against those
  duplicated copies drifting apart (see Known gaps below).

## How to verify the current state

```bash
npm install
npm test        # expect: 22 files, 107 tests, all passing
```

`data/manifest.json` is the single source of truth for what's registered —
`controls.count` (12), `schemas.files` (18 entries), `core.files` (5
entries) are all test-enforced against what's actually on disk
(`tests/manifest.test.ts`).

## Known gaps / deferred items (from the Phase 2 final review, all parked deliberately — none blocking)

1. `finding-schema.json` is the only one of 18 schemas that doesn't compile
   under Ajv `strict: true` (a cosmetic guardrail-subschema issue; runtime
   validation already uses `strict: false` throughout and is unaffected).
2. No automated drift-guard between the 4 places a shape is duplicated by
   hand: `Project.profile` vs. `ProjectProfile`, `ProjectReport.score` vs.
   `Score`, `ProjectReport.releaseEvaluation` vs. `ReleaseEvaluation`, and
   `AssessmentPlan.groupBy` vs. `AssessmentBatch.groupBy`. All four are
   verified identical today; nothing stops future drift.
3. The `prioritizedFindings` sort-invariant test is self-referential (it
   sorts a fixture and compares it to itself) since no real sorting code
   exists yet — fine for a schema-only phase, should become a real
   comparator test once a server exists.
4. Referential integrity between denormalized fields (e.g. a Batch's
   `planId` should always equal its Run's `planId`) isn't schema-enforceable
   and isn't yet written down as a process rule anywhere.
5. Two EvidenceType/OwnerRole-style small enums are still hand-duplicated
   across `catalogs/*.json` and their governing schema, guarded by a test
   from Phase 1 (`tests/catalogs/catalogs.test.ts`) — the Phase 2 duplicates
   in item 2 above don't have the equivalent guard yet.

## Next steps, in a reasonable order

### 1. Close the Phase 2 gaps (small, cheap, no design work needed)
Add the drift-guard tests from gap #2, and optionally fix the `strict:true`
issue from gap #1 (both were scoped out of Phase 2 as Minor/non-blocking —
see the Phase 2 spec's adoption log and the final-review ledger for exact
reasoning). Good first task for a short follow-up plan.

### 2. Populate the remaining control content (Phase 1's own disclosed follow-up)
Only 1 of 8 planned domain files exists (`identity-access.json`, and even
that only covers its Authentication/Authorization subdomains — Session/
Token, OAuth/SSO, Privileged Access, and Identity Lifecycle are still
unwritten within that same file). The other 7 domain files — `appsec`,
`data-crypto`, `infrastructure`, `platform-specific`, `devops-supplychain`,
`operations`, `governance` — are fully specified in the original USSVS
source material but not yet authored as JSON. This is independent of
everything else and can proceed in parallel with the MCP server work
below. Follow the exact pattern `identity-access.json` established
(flat array of Control objects, `applicability` rules preferring
Capability/Architecture over raw tech stack, `threatIds` referencing
`catalogs/threats.json`, validated against `control-schema.json`).

### 3. Resolve two open design questions before scaling control content further
Both are flagged in the Phase 1 spec's adoption log as deliberately
deferred, and get more expensive to fix the more content is built on top
of them:
- **`assurance` (per-SVL verification depth) vs. `verification.methods`
  are currently decoupled** — a Control can promise an assurance activity
  at some SVL with no matching verification method actually defined. Needs
  a design decision (controlled vocabulary, a cross-check test, or
  redefining what `assurance` means) before it's replicated across ~250
  more controls.
- **`ProjectProfile`'s array fields (`components`/`identities`/
  `dataClasses`) are `required` with no `minItems`** — an empty array
  (intended to mean "not yet profiled") could be misread by a future
  Applicability Engine as a definite "no," which violates the project's
  own three-valued-unknown principle through required-ness rather than
  omission. No live bug today (no engine exists yet), but should be
  resolved before one is built.

### 4. Design and build the MCP server itself
Nothing in `data/` is executable yet — every formula, applicability rule,
and scoring model is documented data, not code. The server phase needs to:
implement the Applicability Engine (evaluates a `ProjectProfile` against
every Control's rule DSL), implement the criticality/score formulas
documented in `data/core/criticality-weights.json` and
`data/core/scoring-model.json`, implement `AssessmentPlan` → `AssessmentRun`
→ `AssessmentBatch` expansion and agent dispatch, and implement
`ProjectReport` generation. This is the largest remaining piece and
depends on nothing above being finished first — it can start once the
core schemas (already done) are considered stable.

### 5. Plan the SQLite migration (explicitly deferred since Phase 1)
Both phases were written so this stays cheap: every entity is a flat
record with small nested value-objects, no Control-in-Control nesting,
and IDs that read naturally as foreign keys. Not urgent — revisit once
real project data volume makes flat-file JSON impractical.
