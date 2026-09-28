# C.S.I-mcp — Progress

Security Check MCP: a JSON data foundation (schemas + reference data) for a
future MCP server that runs security reviews against real projects, scores
them, and produces prioritized, reproducible reports. This document tracks
what's built, how it's organized, and what's left.

Last updated: 2026-09-28

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
- **Test suite:** 149/149 passing, 30 files (`npm test`).
- **Server implementation (MCP tools, runtime formula computation, database):** not started.
- **Control content:** 44 controls across 7 domain files (`identity-access`,
  `appsec`, `infrastructure`, `operations`, `platform-specific`,
  `data-crypto`, `devops-supply-chain`). 1 of the original 8 planned
  domains remains unwritten: `governance`.

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
  controls/                  # 7 files, 44 controls total: identity-access
                              # (12), appsec (6), infrastructure (6),
                              # operations (5), platform-specific (5),
                              # data-crypto (5), devops-supply-chain (5)
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
- **Self-contained schema files.** No cross-file `$ref` between schemas
  (small enums like `groupBy` or `evidenceType` are duplicated verbatim
  across the few files that need them) — keeps the Ajv validation harness
  simple. The tradeoff is explicit: nothing currently guards against those
  duplicated copies drifting apart (see Known gaps below).

## How to verify the current state

```bash
npm install
npm test        # expect: 30 files, 149 tests, all passing
```

`data/manifest.json` is the single source of truth for what's registered —
`controls.count` (44), `schemas.files` (18 entries), `core.files` (5
entries) are all test-enforced against what's actually on disk
(`tests/manifest.test.ts`).

## Known gaps / deferred items (from the Phase 2 final review, all parked deliberately — none blocking)

Two gaps flagged in the Phase 2 final review are now **resolved** by the
catalog-integrity-and-pilot branch: `finding-schema.json` now compiles
under Ajv `strict: true` like the other 17 schemas (`tests/schemas/
finding-attack-path-schemas.test.ts`), and drift-guard tests for the 4
hand-duplicated shapes now exist (`tests/schema-drift.test.ts`, 4 tests).

Remaining gaps:

1. The `prioritizedFindings` sort-invariant test is self-referential (it
   sorts a fixture and compares it to itself) since no real sorting code
   exists yet — fine for a schema-only phase, should become a real
   comparator test once a server exists.
2. Referential integrity between denormalized fields (e.g. a Batch's
   `planId` should always equal its Run's `planId`) isn't schema-enforceable
   and isn't yet written down as a process rule anywhere.
3. Two EvidenceType/OwnerRole-style small enums are still hand-duplicated
   across `catalogs/*.json` and their governing schema, guarded by a test
   from Phase 1 (`tests/catalogs/catalogs.test.ts`) — the Phase 2 duplicates
   handled by the drift-guard tests above are a separate set of shapes.

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

### 1. Populate the remaining control content (Phase 1's own disclosed follow-up)
7 of 8 planned domain files now exist: `identity-access` (12 controls),
`appsec` (6), `infrastructure` (6), `operations` (5), `platform-specific`
(5), `data-crypto` (5), `devops-supply-chain` (5) — 44 controls total. 1
domain remains unwritten: `governance`. It is fully specified in the
original USSVS source material but not yet authored as JSON. Governance
differs from every domain built so far: its controls are expected to be
organizational/process-level rather than gated by a project's technical
profile (e.g. "a security review happened before this release," not "this
project has a database") — the existing `ProjectProfile`-based
applicability model may not fit cleanly, and this needs a short design
pass before content is written, not just a repeat of the established
pattern. This is independent of everything else and can proceed in
parallel with the MCP server work below.

### 2. Design and build the MCP server itself
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

### 3. Plan the SQLite migration (explicitly deferred since Phase 1)
Both phases were written so this stays cheap: every entity is a flat
record with small nested value-objects, no Control-in-Control nesting,
and IDs that read naturally as foreign keys. Not urgent — revisit once
real project data volume makes flat-file JSON impractical.
