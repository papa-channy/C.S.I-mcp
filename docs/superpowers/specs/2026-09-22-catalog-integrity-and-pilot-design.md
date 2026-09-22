# Catalog Integrity Hardening & Cross-Domain Pilot Catalog — Design

Date: 2026-09-22
Status: Draft — pending user review

## 1. Context and Goal

Phase 1 (Control catalog foundation) and Phase 2 (Project/scoring/
priority/workflow schemas) are both complete and merged to `main`.
107/107 tests pass across 22 files. `data/manifest.json` lists 18
schemas, 5 core files, 5 catalog files, 6 process files, and one control
domain (`identity-access.json`, 12 controls).

Phase 2's final review (recorded in that phase's ledger) parked four
Minor findings as deliberate, documented gaps rather than fixing them
immediately, because fixing them didn't block Phase 2 itself:

1. `finding-schema.json` is the only one of 18 schemas that fails Ajv
   `strict: true` (cosmetic — runtime validation uses `strict: false`
   throughout).
2. No automated protection against four hand-duplicated structures
   drifting apart: `Project.profile` vs `ProjectProfile`,
   `ProjectReport.score` vs `Score`, `ProjectReport.releaseEvaluation`
   vs `ReleaseEvaluation`, `AssessmentPlan.groupBy` vs
   `AssessmentBatch.groupBy`.
3. Referential integrity between denormalized fields (e.g. a Batch's
   `planId` should always equal its Run's `planId`) is neither
   schema-enforced nor written down anywhere.
4. The `prioritizedFindings` sort-invariant test is self-referential
   (no real sorting code exists yet to test against).

Separately, Phase 1's spec left two design questions open rather than
guessing at an answer before real usage patterns existed:

- **(a)** A Control's `assurance` (what verification depth is expected
  per SVL) and its `verification.methods` (what verification methods
  actually exist) are not connected by the schema — a control can
  promise "SVL-3 requires method X" with no guarantee X is actually one
  of its defined methods.
- **(b)** `ProjectProfile`'s array fields (`components`, `identities`,
  `dataClasses`) are `required` with no `minItems`, so an empty array
  and "not yet profiled" are indistinguishable — a future Applicability
  Engine could misread "we haven't profiled this yet" as "definitely
  none," which breaks the project's own three-valued
  (`applicable | not_applicable | unknown`) principle through
  required-ness rather than through the rule DSL itself.

This spec closes gaps #1, #2, #3 (partially — see §5), and #4 is
explicitly deferred (§5); resolves open questions (a) and (b); and adds
a small cross-domain pilot catalog to stress-test the Applicability rule
DSL and both design fixes before any of the seven remaining control
domains are written at scale.

Explicitly out of scope for this spec: the MCP server itself, the
deterministic Core Engine (Applicability/Criticality/Score/Report
calculation as pure functions), Agent orchestration, and the SQLite
migration. These follow as separate specs once this one's foundation is
in place.

### 1.1 External review note

This plan's shape and priority order came out of an external design
review (ChatGPT, same running thread used for Phase 1 and Phase 2
review) conducted against `PROGRESS.md`. Per this project's standing
practice, every recommendation was evaluated independently rather than
adopted wholesale. §8 records exactly what was adopted, modified, or
rejected, and why.

## 2. Semantic Validator

Ajv (`src/validate.ts`) already checks that each JSON document is
individually well-formed against its schema. It cannot check anything
*across* documents — whether a `threatId` referenced by a Control
actually exists in the threat catalog, whether two schemas that are
supposed to describe the same shape still agree, whether a control's
`assurance` block only references verification methods the same
control actually defines. Nothing today checks any of that.

**New module:** `src/validate-catalog.ts`. Exports a single function:

```ts
interface CatalogViolation {
  rule: string;       // stable rule id, e.g. "threatIds-exist"
  path: string;        // file or file+pointer identifying the offender
  message: string;
}

function validateCatalog(dataDir: string): CatalogViolation[]
```

It loads every document it needs directly (via the existing
`loadJson`), runs the rules in §3, and **returns** violations rather
than throwing — this keeps it a pure, testable function and lets a
single test assert "zero violations" while a targeted test can assert
"exactly this violation" against a broken fixture.

**New test:** `tests/semantic-validate.test.ts`. Runs `validateCatalog()`
against the real `data/` tree and asserts an empty result, plus a
handful of cases (deliberately-broken fixtures under
`tests/fixtures/`) asserting specific violations are caught. Runs under
plain `npm test` — no separate script, consistent with how every other
check in this project already works.

**New test:** `tests/schema-drift.test.ts`. Structurally different from
`validate-catalog.ts`'s data-referential checks — this compares *schema
files* to each other, not data documents — so it stays a separate,
smaller file rather than a mode of `validateCatalog()`. See §4 for the
four comparisons.

Both are ordinary Vitest files; no new tooling, dependencies, or
scripts are introduced.

## 3. Semantic Validator Rule Set (v1)

Catalog-level (static data) referential integrity:

1. **`controlId` uniqueness** — no two Control records across all files
   under `data/controls/` share a `controlId`.
2. **`threatIds-exist`** — every `Control.threatIds[]` entry exists in
   `catalogs/threats.json`.
3. **`relationships-exist`** — every controlId referenced in a
   `Control.relationships.{dependsOn,relatedTo,supersedes,
   compensatesFor,conflictsWith}` array exists as a real `controlId`.
4. **`replacedBy-exists`** — if `Control.replacedBy` is set, it names a
   real `controlId`.
5. **`assurance-verification-linkage`** (resolves open question (a),
   see §4) — within a single Control record: every value in
   `verification.methods[].type` is unique, and every value appearing
   in any `assurance[svl]` array is one of that same control's
   `verification.methods[].type` values.
6. **`criticality-weights-sum`** — the five weights in
   `core/criticality-weights.json` sum to `1.0`.

Schema drift-guard (compares schema *files*, not data — kept in
`tests/schema-drift.test.ts`, not `validate-catalog.ts`):

7. `Project.profile`'s sub-schema (properties + required list, minus
   `projectId`, which only the standalone schema carries) is
   structurally identical to `project-profile-schema.json`.
8. `ProjectReport.score`'s sub-schema is structurally identical to
   `score-schema.json`.
9. `ProjectReport.releaseEvaluation`'s sub-schema is structurally
   identical to `release-evaluation-schema.json`.
10. `AssessmentPlan.groupBy`'s enum is identical to
    `AssessmentBatch.groupBy`'s enum.

**Explicitly deferred, not silently dropped:** project-instance-level
referential integrity (`AssessmentBatch.planId == AssessmentRun.planId`,
`AssessmentRun.projectId == AssessmentBatch.projectId`,
`ControlAssessment.controlId` resolving against the catalog snapshot a
Run pinned, etc.) has no data to validate against yet — no real
`Project`/`AssessmentRun`/`AssessmentBatch` instances exist in this
repo, only their schemas. This becomes a Repository-layer concern once
the Core Engine phase actually creates and stores these records; it is
out of scope here and is recorded as a forward pointer, not forgotten.

**Also included in this pass, unrelated to the validator itself:** fix
`finding-schema.json`'s `if`/`then` guardrail subschema so it compiles
under Ajv `strict: true` like the other 17 schemas (Phase 2 gap #1).
Runtime behavior is unaffected (`strict: false` is used everywhere
today); this closes an invariant ("every schema passes the same strict
check") rather than fixing a bug.

## 4. Design Fix (a): `assurance` ↔ `verification.methods` Linkage

Inspecting the real data (`IAM-AUTH-001` in `identity-access.json`)
shows the intended linkage already exists *informally*: `assurance`
reuses `verification.methods[].type` strings directly —

```json
"assurance": { "SVL-1": ["route_review"], "SVL-2": ["route_review", "anonymous_api_test"] },
"verification": { "methods": [{ "type": "anonymous_api_test", ... }, { "type": "route_review", ... }] }
```

`verification.methods[].type` is a free string today (`minLength: 1`,
no enum, no uniqueness constraint), so nothing stops `assurance` from
naming a method type that doesn't exist on the control, or two methods
on the same control sharing a `type`.

**Decision: no schema change to `control-schema.json`.** Enforce this
purely through semantic validator rule #5 (§3): `type` values unique
per control, `assurance[svl]` values must be a subset of that control's
`type` values. This was chosen over the alternative (a new `methodId`
field on each verification method, `assurance` restructured to
`{ "SVL-3": { "requiredMethodIds": [...] } }`) because the existing
convention already works and needs no schema change or migration of the
12 existing controls — the alternative would require both.

## 5. Design Fix (b): `ProjectProfile` Three-Valued Array Fields

**Schema change**, applied identically in both places this shape
exists (`project-profile-schema.json` standalone, and the embedded
`profile` object inside `project-schema.json`):

- Remove `components`, `identities`, `dataClasses` from each schema's
  `required` list. `exposure` stays required (a project's network
  exposure is expected to always be known at profiling time, unlike
  the other three, which are legitimately unknown before a deeper
  audit).
- No `minItems` is added to these three fields. The point isn't to
  forbid an empty array — an empty array is a meaningful, deliberate
  answer ("we checked; there are none") — it's to make *omission*
  possible so "not yet profiled" has its own representation.
- Add a `description` to each of the three properties, in both schema
  files, stating the three-valued contract explicitly:
  - property **absent** → `UNKNOWN` (not yet profiled)
  - property is `[]` → `KNOWN`, and the answer is "none"
  - property is `[...]` → `KNOWN`, these are the values

**Hard rule for future code, recorded here since no Applicability
Engine exists yet to enforce it in code:** whatever evaluates these
fields against a Control's `applicability` rule DSL must never
normalize with `?? []` or an equivalent default. Doing so collapses
`UNKNOWN` into `NO`, which is exactly the failure mode the project's
three-valued `applicable | not_applicable | unknown` principle exists
to prevent. This rule is written down here and in `PROGRESS.md`, and
must become an enforced unit test the moment the Applicability Engine
is built — this spec cannot enforce it in code today because the code
it would constrain doesn't exist yet.

Existing complete fixtures in `tests/schemas/project-profile-schema.test.ts`
and `project-schema.test.ts` remain valid (removing a field from
`required` only loosens the constraint). Each test file gains one new
case asserting a document with the three fields omitted still validates.

## 6. Cross-Domain Pilot Catalog

Five domains, ~5-6 controls each, ~25-30 controls total: **AppSec**,
**Infrastructure**, **Operations**, **Platform-specific**,
**Data/Crypto**. Chosen over completing all seven remaining domains
(the original Phase 1 follow-up plan) because building the pilot
*before* the Core Engine exists lets the Applicability rule DSL and
both design fixes above get stress-tested against genuinely different
condition shapes (`ai == false`, `fileUpload == unknown`,
`dataClasses` unset, mobile-only platform facts, etc.) while the cost
of being wrong is still low — one proof-of-concept domain
(`identity-access.json`) risks the DSL looking sufficient only because
every example so far comes from the same domain.

Each new control follows the `identity-access.json` pattern exactly:
Control schema, `applicability.when` preferring capability/architecture
facts over raw tech-stack facts, `threatIds` referencing the threat
catalog, `verification.methods`/`assurance` linked per §4.

`catalogs/threats.json` currently holds 13 entries — 12 IAM-specific
plus one generic SQL Injection entry. The pilot domains will need
roughly 15-20 new threat entries added to this catalog (e.g. XSS,
SSRF, insecure deserialization for AppSec; unencrypted-at-rest,
key-reuse for Data/Crypto; unpatched-dependency, excess-network-exposure
for Infrastructure) — this is real, non-trivial content work and is
called out explicitly so it isn't discovered mid-implementation as
scope creep.

The exact list of ~25-30 controls (IDs, titles, requirements) is
**not** enumerated in this spec — that level of detail belongs in the
implementation plan's task breakdown, following writing-plans's "no
placeholders" rule at the *task* level, not the *design* level. This
spec fixes the domain list, the approximate count, the pattern to
follow, and the threat-catalog dependency; the plan fixes the specific
controls.

## 7. Testing Strategy

- Schema changes (§5): new "omitted field is valid" test cases added to
  the two existing schema test files named above.
- Semantic validator (§2, §3): `tests/semantic-validate.test.ts` covers
  both the "current data passes clean" case and, via deliberately
  broken fixtures in `tests/fixtures/`, one failing case per rule
  (rules 1-6) so each rule is proven to actually catch what it claims
  to catch.
- Schema drift guard (§3, rules 7-10): `tests/schema-drift.test.ts`,
  one assertion per duplicated pair.
- Pilot controls (§6): one test file per new domain file under
  `tests/controls/`, following the existing pattern for
  `identity-access.json`'s tests.
- `finding-schema.json` strict-mode fix: existing schema test suite
  continues to pass; add (or confirm existing coverage of) an
  Ajv-`strict:true` compile check across all 18 schemas so this
  invariant can't silently regress again.

All of the above run under the existing `npm test` — no new scripts,
no new CI wiring required.

## 8. External Review — Adoption Log

ChatGPT reviewed a summary of `PROGRESS.md` and proposed a reordering
of the project's next steps plus several concrete technical
suggestions. Each is recorded below with the adoption decision and
reasoning.

**Adopted as-is:**
- Reorder priorities so schema/design hardening happens *before* bulk
  control content, not after — cheapest time to change schema meaning
  is while little data depends on it. (Reflected in this spec superseding
  step 2 of `PROGRESS.md`'s original "Next steps" ordering.)
- Build a semantic/catalog validator distinct from Ajv structural
  validation, for exactly the referential-integrity gaps Ajv can't
  express. (§2, §3)
- Resolve the `assurance`/`verification.methods` linkage now rather
  than let it propagate across ~25-30 more controls unresolved. (§4)
- Resolve the `ProjectProfile` unknown-vs-empty-vs-populated ambiguity
  now, before an Applicability Engine exists to get it wrong. (§5)
- Build a small cross-domain pilot catalog instead of completing all
  seven remaining domains at once. (§6)

**Adopted with modification:**
- ChatGPT's concrete fix for the `assurance`/`verification` linkage was
  a new `methodId` field plus a restructured `assurance` object
  (`{"SVL-3": {"requiredMethodIds": [...]}}`). Adopted the *goal*
  (provably-linked assurance/verification) but not the mechanism —
  inspection of real data showed the existing `type`-string convention
  already expresses this linkage informally; enforcing it via the
  semantic validator needs no schema change and no migration of the 12
  existing controls, versus a schema change plus migration for the
  `methodId` approach. See §4's Decision paragraph.
- ChatGPT's fix for the `ProjectProfile` gap was `minItems` on the
  array fields. Adopted the *underlying three-valued principle* but
  rejected `minItems` as the mechanism, since it only blocks empty
  arrays and does nothing to distinguish "not yet profiled" from
  "profiled as empty" — the actual bug. Adopted instead: drop
  `required`, so omission itself carries meaning. (§5)

**Rejected:**
- ChatGPT suggested resolving the four duplicated-structure gaps by
  introducing cross-file `$ref` between schemas (e.g. `Project.profile`
  `$ref`-ing `project-profile-schema.json` directly) instead of
  drift-guard tests. Rejected: this project made a deliberate,
  documented decision in Phase 1 to keep every schema file
  self-contained with no cross-file `$ref`, specifically to keep the
  Ajv validation harness simple (each schema compiles independently).
  ChatGPT's suggestion is reasonable software design in the abstract
  but wasn't evaluated against a constraint it didn't know existed.
  The drift-guard tests in §3 (rules 7-10) address the actual risk
  (silent divergence) without reopening that decision.
- ChatGPT proposed adding `policyVersion` and `confidence` fields to a
  Finding's `priority` object. Rejected as unrequested scope expansion
  — no current requirement motivates either field, and Phase 2's
  `priorityOverrideReason` guardrail already addresses the underlying
  concern (an ungrounded Priority override on a high-Criticality
  finding must be justified). Can be reconsidered if a real need
  surfaces.
- ChatGPT proposed splitting `AssessmentPlan.groupBy` and
  `AssessmentBatch.groupBy` into a `grouping.dimension`/`grouping.value`
  shape to make their difference (policy vs. actual-executed-grouping)
  explicit. Deferred, not rejected outright: this is a more invasive
  schema change than the other fixes in this spec, it doesn't block
  anything in scope here, and the drift-guard test (rule 10) already
  prevents the two enums from silently diverging in the meantime. Worth
  revisiting once the Core Engine's `PlanExpander` is actually built
  and its real needs are known.

## 9. Out of Scope (unchanged from §1)

MCP server implementation, the deterministic Core Engine
(`ApplicabilityEvaluator`, `CriticalityCalculator`, `ScoreCalculator`,
`PlanExpander`, `ReleaseEvaluator`, `ReportBuilder`), Repository
interface/abstraction, Agent orchestration (dispatch, retry, resume),
and the SQLite migration. All remain future specs, in that rough order,
per the reprioritization discussed with the user before this spec was
written.
