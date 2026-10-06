# Report Fidelity — Work Report

**Branch:** `worktree-report-fidelity` (forked from `main` at `e6f0c91`)
**Spec:** `docs/superpowers/specs/2026-10-06-report-fidelity-design.md`
**Plan:** `docs/superpowers/plans/2026-10-06-report-fidelity-implementation.md`
**ADR:** `docs/superpowers/adr/0001-report-fidelity-provenance-and-projection.md`
**Status:** Implementation complete, final review clean, ready for merge decision.

## What this branch does

Makes `ProjectReport` — the persisted JSON artifact `generate_report` produces — a self-contained, externally-legible artifact. Before this change, the report discarded most of the engine's own judgment on the way into the persisted file: a finding's type, severity, controls, attack scenario, and exploitability evidence never reached the report; two differently-defined fields shared the name `highFindings` across two files with no way to tell them apart from the JSON; nothing recorded what code, project profile, or engine version produced a given report; and three report fields were either structurally always-zero or silently collapsed real distinctions into one boolean. This gap was found by generating and reading real reports for all 8 open-source validation projects (Vaultwarden, Documenso, Outline, Formbricks, Chatwoot ×3, Listmonk) after a prior branch (`assessment-trust-integrity`) made the underlying engine judgment itself trustworthy — the engine's verdicts were correct, but the artifact describing them wasn't trustworthy standalone.

This is a **reporting-fidelity** fix, not a detection-quality fix. No engine judgment logic changed; only what survives into the persisted report, and how faithfully it's labeled with its own provenance.

## How it was built

Full pipeline, in order, each stage reviewed before the next began:

1. **Brainstorming** (2 rounds of external review via a persistent GPT thread) — settled the architecture: `projectFindingSnapshots[]` for the full finding record, provenance sealed on `AssessmentRun` at run-start rather than read fresh at report time, 3 dead/misleading fields dropped from the report only, rounding strictly at the serialization boundary, a new `reportSchemaVersion`.
2. **Spec** (`docs/superpowers/specs/2026-10-06-report-fidelity-design.md`, 3 external review rounds, all incorporated) — found and closed 2 genuine blockers before implementation: `projectFindingSnapshots`' claimed semantics ("what this run claimed") didn't match its actual implementation (project-scoped, not run-scoped, since `Finding` carries no run identifier) — fixed by narrowing the claim rather than building new linkage; and `engineVersion` was originally specified to be read fresh at report-generation time, which broke the same staleness principle just established for `target`/`profileSnapshot` — fixed by moving it onto `AssessmentRun`, captured at run-start.
3. **Implementation plan** (`docs/superpowers/plans/2026-10-06-report-fidelity-implementation.md`, 1 external review round) — found a real, not-yet-written bug before any code existed: the plan's draft `buildReport` implementation used a spread (`{...input.releaseEvaluation, ...}`) to construct the narrowed report output, which — because TypeScript's excess-property checking doesn't apply to spreads — would have silently let the 3 "removed" fields leak into the real JSON despite the type system claiming they were gone. Fixed in the plan before an implementer ever touched the file: explicit field-by-field projection, and `buildReport`'s input type widened to the honest, full core `ReleaseEvaluation` type. Also found: `engineVersionAtRunStart`'s originally-planned `string | null = null` constructor default would let a future call site silently forget to wire the real version — fixed by making it required, with a mechanical sweep of ~52 pre-existing test call sites to supply a literal test value, done in Task 1 as its own step.
4. **Subagent-driven implementation** — 3 tasks, each a fresh implementer subagent, each independently reviewed:
   - **Task 1** (`AssessmentRun` provenance): `target`/`profileSnapshot`/`engineVersionAtRunStart`, the required constructor parameter, the mechanical sweep, and production wiring at the composition root (`src/mcp/server.ts`). Commit `068699c`. Review: ✅ spec compliant, Approved, 0 Critical/Important.
   - **Task 2** (field rename at the source): `score.ts`'s `criticalFindings`/`highFindings` → `criticalSeverityFindings`/`highSeverityFindings`; `release-evaluator.ts`'s → `confirmedCriticalVulnerabilities`/`confirmedHighVulnerabilities`; propagated through `report-builder.ts` and 3 JSON schemas; explicitly did not touch the unrelated, same-named `ReleaseGateData.requiresByLevel` field. Commit `4d5a484`. Review: ✅ spec compliant, Approved, 0 Critical/Important.
   - **Task 3** (`ReportBuilder` enrichment): `projectFindingSnapshots[]`, the 3 provenance fields copied verbatim from the run, the 3-field drop via explicit projection, `roundReportNumber` at the serialization boundary only, `reportSchemaVersion`. Commit `1e0540b`. Review: ✅ spec compliant, Approved, 0 Critical/Important.
5. **Final whole-branch review** (most capable available model, independent of the 3 task-level reviews) — drove a real `generate_report` call through the live MCP server with a populated `target` and confirmed the output is schema-valid at all 3 layers (`ProjectReport`, `AssessmentRun`, `Finding`), with every new field correctly populated and all 3 dropped fields genuinely absent. Verdict: **Ready to merge, with fixes** — 0 Critical, 1 Important (the `0.9.0` version bump, landed in Task 1, had no `CHANGELOG.md` entry — a real gap against this project's own documented release policy, and self-defeating for a feature whose point is making engine versions traceable), 13 Minor.
6. **Final fix wave** — one dispatch covering the Important finding plus 3 of the cheapest, lowest-risk Minors the reviewer explicitly suggested bundling (stale `McpServer` version string, stale `package-lock.json`, `tsc --noEmit` not wired into `npm test`). Commit `1f08816`. One scoped re-review confirmed all 4 ADDRESSED, no new breakage. The other 9 Minor findings were deliberately parked, not fixed — see "What was deliberately not done" below.

## Test results

453/453 tests passing (52 files), `npx tsc --noEmit` clean, and (as of the final fix wave) `npm test` now runs the typecheck before the test suite, so this is no longer two separate manual commands.

## Key design decisions (full detail in ADR 0001)

- Provenance (`target`, `profileSnapshot`, `engineVersionAtRunStart`) is captured once on `AssessmentRun` at `start_assessment_run` time and never re-read fresh when a report is later generated — a report describes the run that produced it, not whatever the system looks like when someone later calls `generate_report`.
- `AssessmentRun`'s new fields are optional-and-nullable (accepts legacy data missing the keys entirely); `ProjectReport`'s mirror fields are required-but-nullable (the builder always sets an explicit value). These are deliberately different contracts for different reasons, not an inconsistency.
- No migration script backfills the new `AssessmentRun` fields on existing runs — `profileSnapshot` in particular cannot be honestly reconstructed for a historical run.
- `buildReport`'s `releaseEvaluation` output is built via explicit field-by-field projection, never a spread, and its input type is the honest, full core `ReleaseEvaluation` rather than the narrowed report type — this is the fix for the spread-leak bug found during the plan's own review.
- `engineVersionAtRunStart` is a required, non-defaulted constructor parameter specifically to prevent silent provenance degradation at a future call site.

## What was deliberately not done

- **8 real validation projects' reports are not yet regenerated** against this new shape. Existing `AssessmentRun`s on disk predate `target`/`profileSnapshot`/`engineVersionAtRunStart` and would produce reports with all three `null` — correct and honest, but not a demonstration of the feature's full value. This is the next step in the pipeline (see below), not part of this branch's own scope.
- **9 of the 13 Minor findings from the final review were parked, not fixed** — they require either new test-writing, a spec-prose correction, a schema `$ref` addition, or genuine design reconsideration (constructor parameter ordering, defensive-copy consistency for `target`/`profileSnapshot`, an error-handling policy for `readEngineVersion()`), none of which are safely bundleable into one mechanical fix dispatch with only one scoped re-review as a safety net. Full list and reasoning in ADR 0001's "Known residual risks" section. None were things the final reviewer said to gate merge on.
- **`data/schemas/release-gates.json`'s `requiresByLevel.criticalFindings`/`highFindings`** was deliberately left untouched (it's a different concept from the two renamed fields, despite sharing a name) — but the spec's own stated rationale for this ("coincidentally shares the name") was found by the final review to understate the real conceptual overlap. The decision is correct; the written reasoning for it should be corrected in a future pass.
- **No git tag was created for `0.9.0`** — tagging is a merge/release-time action, premature on an unmerged feature branch, deferred to whenever this branch actually merges.
- **Core engine files are untouched throughout**: `src/core/release-evaluator.ts`'s `ReleaseEvaluation` interface still has all 3 "dropped" fields (only the report mirror drops them); `src/core/score.ts`'s and `src/core/release-evaluator.ts`'s calculation logic is byte-identical before and after the rename, confirmed by both task-level and whole-branch review.

## Next steps (outside this branch's own scope)

1. This work report's own external review round (in progress — see below).
2. Regenerate fresh `ProjectReport`s for all 8 real open-source validation projects against the new `reportSchemaVersion: "2.0.0"` shape, starting new `AssessmentRun`s where a populated `target`/`profileSnapshot`/`engineVersionAtRunStart` is wanted for a fully-demonstrative report (existing runs would still work and produce valid reports, just with those 3 fields `null`).
3. Collect all 8 regenerated reports into one folder, as done previously for the pre-this-change report set.
4. The standing `finishing-a-development-branch` decision (merge locally / push and PR / keep as-is) — the one point in this entire pipeline that needs the user's own choice, not an autonomous ruling.
