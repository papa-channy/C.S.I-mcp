# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [SemVer](https://semver.org/) with the `0.x` convention that the
public interface (MCP tool surface, schemas) may still change between minor
versions until `1.0.0`.

Entries for `0.1.0`–`0.7.0` are reconstructed retroactively from commit
history on 2026-10-05, when this file and git tagging were introduced
(LEGAL-VERSIONING-001). Nothing was tagged at the time each phase actually
shipped, so these are documentation of what happened, not historical
release artifacts.

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
- Breaking: an `ACCEPTED_RISK` control assessment whose `riskAcceptanceId` is scoped to a
  different `controlId` is now treated as `NOT_TESTED` by `calculateScore`/`evaluateRelease`
  (previously honored as `ACCEPTED_RISK` if otherwise valid) — surfaced via the new
  `risk_acceptance_scope_mismatch` reason code.

## [0.9.0] — 2026-10-07

### Added
- `projectFindingSnapshots` on `ProjectReport`: full finding records (type,
  severity, `controlIds`, `attackScenario`, `exploitabilityEvidence`) sorted
  deterministically by `findingId`, so a report is self-contained evidence
  rather than a set of IDs a reader must cross-reference elsewhere.
- Provenance fields `target` / `profileSnapshot` / `engineVersionAtRunStart`
  on `AssessmentRun` and `ProjectReport`, captured once at
  `start_assessment_run` time and never re-read later — including
  `start_assessment_run`'s new optional `target` input.
- `reportSchemaVersion` (`"2.0.0"`) on `ProjectReport`.

### Changed
- Breaking: `score.ts`'s `DomainScore.criticalFindings` /
  `highFindings` renamed to `criticalSeverityFindings` /
  `highSeverityFindings`.
- Breaking: `release-evaluator.ts`'s `ReleaseEvaluation.criticalFindings` /
  `highFindings` renamed to `confirmedCriticalVulnerabilities` /
  `confirmedHighVulnerabilities`. Both renames propagate through
  `get_score`/`evaluate_release`/`generate_report`'s live MCP output and all
  3 JSON schemas; calculation logic in both files is unchanged, only the
  output field names differ.
- Report numeric fields (coverage percentages, scores) are now rounded to 2
  decimal places at the report-serialization boundary only, never before
  gate-threshold comparisons.

### Removed
- `unblockedCriticalAttackPaths`, `incidentResponseVerified`,
  `backupRestoreVerified` dropped from `ProjectReport` only — core
  `release-evaluator.ts`'s `ReleaseEvaluation` interface and
  `evaluate_release`'s live tool output keep all three unchanged.

## [0.8.0] — 2026-10-05

### Added
- Control Gate in `evaluateRelease()`: 8 hardcoded `RELEASE_BLOCKING_CONTROLS`
  now block or indeterminate the `production_release` gate on their own
  assessment status, independent of `Finding.type` — closing the gap where a
  `control_gap`-typed finding on a genuinely critical control (e.g. admin
  MFA) could never block release.
- `blockingControlFailures` / `blockingControlsNotVerified` fields on
  `ReleaseEvaluation`, propagated through the report schema layer.

### Fixed
- Dead-calculation bug: `incidentResponseVerified` / `backupRestoreVerified`
  were computed but never consulted when computing `result`.
- `evaluate_release`'s MCP tool description, which had fallen out of sync
  with the new three-gate logic.

### Documented (not fixed — tracked as known limitations)
- `ACCEPTED_RISK` status accepted with no validation that a real
  `RiskAcceptance` record backs it.
- `ControlAssessment` has no `profileRevision` field, so a stale assessment
  survives a profile change undetected.
- `N/A` status requires no evidence and isn't cross-checked against
  `applicability.finalResult` — currently the cheapest of the three gaps
  above to exploit.

## [0.7.0] — 2026-09-30 to 2026-10-03

### Changed
- `Finding.type` classification rewritten from an informal rule to a
  7-step, order-dependent decision tree — the central axis moved from "does
  exploiting this need a precondition" to "does the control's own
  `passCriteria` require this mechanism," fixing systematic
  under-classification of `control_gap` findings as `hardening`.
- `record_assessment` now requires search-methodology evidence
  (`searchScope`/`searchMethod`) on `FAIL`/`PARTIAL`, not just `PASS`.

### Validated
- First real-world validation runs against external open-source targets
  (Chatwoot, Documenso, Formbricks, Listmonk, Outline, Vaultwarden) —
  found the tool completes all 11 MCP tools without crashing and produces
  schema-valid reports end to end.
- A blind pinned-commit re-assessment (fresh agent, zero prior context, repo
  pinned to an exact historical commit) confirmed the `Finding.type`
  rewrite measurably improved recall: it surfaced a critical vulnerability
  that three earlier assessment passes on the same code had all missed.

## [0.6.0] — 2026-09-30

### Added
- MCP server (tool/handler layer): 11 tools (`create_project`,
  `get_project`, `update_project_profile`, `start_assessment_run`,
  `list_controls`, `record_assessment`, `record_finding`, `list_findings`,
  `get_score`, `evaluate_release`, `generate_report`) wired to
  `McpServer` over `StdioServerTransport`.
- Service layer (`AssessmentService`, `AnalysisService`, `ProjectService`,
  `ReportService`) between the MCP tools and the Core Engine.
- Full create-to-report integration test.

## [0.5.0] — 2026-09-28

### Added
- Core Security Engine: three-valued `applicability` rule evaluation
  (Strong-Kleene), `criticality` scoring from the weighted formula,
  domain/overall `score` calculation, `production_release` gate 4
  evaluation, deterministic assessment-plan batch expansion, prioritized
  findings sort, and `SecurityRepository` (atomic, path-traversal-guarded
  file persistence).

## [0.4.0] — 2026-09-28

### Added
- DevOps supply-chain control domain (5 controls).
- Governance control domain (4 controls) — completes all 8 planned control
  domains, 48 controls total in the catalog.

## [0.3.0] — 2026-09-22 to 2026-09-23

### Added
- Catalog integrity hardening: semantic cross-document referential
  validator, drift-guard tests for hand-duplicated schema structures.
- Pilot control domains: AppSec, Infrastructure, Operations,
  Platform-specific, Data/Crypto (27 controls across 5 domains).

## [0.2.0] — 2026-09-18 to 2026-09-21

### Added
- `project`, `assessment-run`, `assessment-plan`, `assessment-batch`,
  `score`, `score-model`, `project-report` schemas.
- Finding priority/criticality modeled as provenance objects with a
  manual-override guardrail.

## [0.1.0] — 2026-09-16

### Added
- JSON data foundation: generic schema-validation utility, `control`,
  `project-profile`, `control-assessment`, `threat`, `asset`, `evidence`,
  `finding`, `attack-path`, `risk-acceptance`, `release-evaluation`
  schemas, core/catalog/process reference data, `manifest.json` with
  full data-tree integrity checking, and the first control domain
  (Identity & Access) as a proof of concept.
