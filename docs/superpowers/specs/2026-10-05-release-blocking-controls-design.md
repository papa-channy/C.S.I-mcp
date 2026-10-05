# Release-Blocking Controls — Design

Date: 2026-10-05
Status: Draft — pending user review

## 1. Context and Goal

The 6-project real-world validation series (completed 2026-09-30, since
revised through several rounds of self-correction and external review —
`docs/assessments/tracking.md`) exposed a real gap in `evaluateRelease`
(`src/core/release-evaluator.ts`): the production_release gate (gate 4)
counts only `confirmed_vulnerability`-typed findings toward
`criticalFindings`/`highFindings`. This was deliberately added
(2026-10-02) to stop a `control_gap` finding like "admin MFA not
enforced" from being treated as equivalent to a demonstrated,
code-traced exploit — but it over-corrected: a `control_gap` finding on
a genuinely critical control (MFA, password hashing, server-side
authorization) now **never** blocks release, no matter how severe,
because nothing but `Finding.type` feeds the gate.

Re-reading `src/core/release-evaluator.ts` while investigating this
surfaced a second, independent, pre-existing bug: `incidentResponseVerified`
and `backupRestoreVerified` are computed from `RELEASE_GATE_CONTROL_MAP`
(`GOV-IR-001`, `OPS-BACKUP-TEST-001`) and returned in `ReleaseEvaluation`,
but **neither value is read anywhere in the computation of `result`** — a
project with `GOV-IR-001` or `OPS-BACKUP-TEST-001` failing outright still
gets `approved` if its findings/coverage otherwise clear. This is not a
new feature gap; it is a dead calculation that has existed since the
field was introduced, caught only by reading the function fresh rather
than trusting its own field names.

This spec fixes both: a small set of catalog controls whose complete
absence breaks a basic security assumption regardless of what `Finding.type`
got attached to the gap, actually gate release.

**Review process:** this design went through two rounds at the same
persistent external-review thread used for every prior phase of this
project. §8 records what was adopted, adapted, or rejected.

## 2. Current State (for contrast)

```ts
const result = !findingThresholdsPass
  ? "blocked"
  : score.coverage.coveragePercent < MIN_COVERAGE_FOR_APPROVAL_PERCENT
    ? "indeterminate"
    : "approved";
```

`findingThresholdsPass` is `criticalFindings === 0 && highFindingsSatisfied`,
both computed only from `confirmed_vulnerability` findings. Nothing else
can produce `"blocked"`. `incidentResponseVerified`/`backupRestoreVerified`
are computed and returned but never consulted here.

## 3. Architecture: Three Independent Gates

`evaluateRelease`'s `result` becomes the combination of three
independently-computed sub-verdicts, each contributing in the same
direction (worse wins):

```
Finding Gate (unchanged from today):
  confirmed_vulnerability, open/in_progress, critical or high → contributes "blocked"

Control Gate (new):
  for each controlId in RELEASE_BLOCKING_CONTROLS:
    assessment status FAIL                        → contributes "blocked"
    assessment status PARTIAL, NOT_TESTED, or
      missing/unassessed                           → contributes "indeterminate"
    assessment status PASS, N/A, or ACCEPTED_RISK   → no contribution

Coverage Gate (unchanged from today):
  score.coverage.coveragePercent < 80              → contributes "indeterminate"

result = any gate contributed "blocked"       → "blocked"
         else any gate contributed "indeterminate" → "indeterminate"
         else                                      → "approved"
```

A `control_gap`-typed finding is **not** separately evaluated by the
Finding Gate. Its underlying control's `FAIL` status is what the Control
Gate sees directly — counting both would double-count the same real-world
fact under two different mechanisms for no benefit. This keeps
`Finding.type` (what kind of thing is this) and release policy (what
blocks a release) as two independent concerns: changing how an agent
classifies a finding never changes whether its control blocks release,
and vice versa.

## 4. `RELEASE_BLOCKING_CONTROLS`

A `ReadonlySet<string>` of control IDs, declared in `release-evaluator.ts`
next to the existing `RELEASE_GATE_CONTROL_MAP`, same pattern (hardcoded,
not data-driven — see §8 for why this was reconsidered and confirmed).

**Inclusion test**, arrived at via external review: *if this control were
completely absent and the release were still approved, would the
system's basic security/safety assumption break even without any
separate new vulnerability being found?* Only controls that pass this
test qualify — deliberately a small subset, not "every control whose
`FAIL` is bad." Controls like CI action SHA pinning, Docker digest
pinning, or audit-log coverage are real, worth fixing, and still
contribute to score/coverage — they are a hardening checklist, not a
release gate, and stay off this list.

Project-specific conditionality (e.g. `DATA-KEYSEP-001` not applying to
a project whose server never holds encryption keys at all, like
Vaultwarden's zero-knowledge architecture) is **not** re-implemented
here. It is already fully handled by each control's own
`applicability.when` rule, evaluated at `record_assessment` time —
a non-applicable control's assessment status is `N/A`, which the Control
Gate treats as "no contribution," not "blocked." `evaluateRelease` never
needs to know `securityLevel`/`dataClasses`/`components` to make this
decision; it only reads `ControlAssessmentInput.status`, exactly as
today.

| controlId | Title | Why it passes the test |
|---|---|---|
| `IAM-AUTH-003` | Validated Password Hashing | Plaintext/weak password storage breaks the system's authentication assumption on its own. |
| `IAM-AUTH-005` | Privileged MFA | A privileged account protected by password alone is the single most-repeated real finding across this project's own validation series (6/6 original projects). |
| `IAM-AUTHZ-001` | Server-side Authorization | Without this, every "protected" action is unprotected by construction. |
| `IAM-AUTHZ-002` | Object-level Authorization (IDOR) | Any user reaching any other user's data via identifier manipulation is a basic multi-tenant assumption breaking, independent of any specific finding. |
| `DATA-ENC-002` | Encryption in Transit | An internet-facing service accepting plaintext connections breaks confidentiality for every request, not just one feature. |
| `DATA-KEYSEP-001` | Encryption Key Separation | If the key protecting D3 data lives next to the data it protects, the encryption provides no real separation of concerns. |
| `OPS-BACKUP-TEST-001` | Backup Restore Drill | Backups that have never been proven restorable are not a real recovery capability. |
| `GOV-IR-001` | Incident Response Ownership | No named authority to declare/initiate incident response means no actual incident response capability exists, regardless of any written plan. |

All 8 confirmed `status: "active"`, no `replacedBy`, against the real
catalog (`data/controls/*.json`) at design time — §6 adds a drift guard
so this stays true.

**Explicitly considered and left off this list:** `IAM-AUTHZ-003`/`004`/`005`
(admin API isolation, mass-assignment protection, default-deny — real
and valuable, but narrower in scope than 001/002, and keeping the list
small was an explicit design goal, not an oversight) and
`DEVOPS-ARTIFACT-001` (artifact signing — a release-blocker candidate
specifically for SVL-3 projects whose shipped artifact *is* the product,
e.g. a container image or installer, but not for typical SaaS; revisit
if/when this project assesses one).

## 5. `ReleaseEvaluation` Interface Changes

```ts
export interface ReleaseEvaluation {
  // ...existing fields, unchanged...
  blockingControlFailures: string[];      // NEW — controlIds driving "blocked" via the Control Gate
  blockingControlsNotVerified: string[];  // NEW — controlIds driving "indeterminate" via the Control Gate
  result: "approved" | "blocked" | "indeterminate"; // unchanged shape, now reachable via two more paths
}
```

These two arrays exist so a report reader (human or agent) can see *why*
a verdict landed where it did without re-deriving it from the raw
assessment list — the same transparency principle `criticalFindings`/
`highFindings` already serve for the Finding Gate.
`incidentResponseVerified`/`backupRestoreVerified` are unchanged in
meaning (still "is this exact control's assessment `PASS`") — now one of
several views into a project's release-readiness rather than the only
one, and no longer dead calculations, since `GOV-IR-001`/
`OPS-BACKUP-TEST-001` sit in `RELEASE_BLOCKING_CONTROLS` and a `FAIL` on
either now actually reaches `result`.

`data/schemas/release-evaluation-schema.json` and
`data/schemas/project-report-schema.json` (nested `releaseEvaluation`)
both add the two new required array-of-string properties.
`src/core/report-builder.ts`'s `ReleaseEvaluationForReport` interface
gains the same two fields, passed straight through — `buildReport` does
no computation on them.

## 6. Testing Strategy

- **Per-control regression tests**: for each of the 8 listed controls,
  one test per status value (`PASS`, `FAIL`, `PARTIAL`, `NOT_TESTED`,
  `N/A`, `ACCEPTED_RISK`, and "absent from the assessments array
  entirely") against an otherwise-clean input (zero findings, coverage
  ≥80%), asserting `result` lands where §3's table says it should. This
  is the direct fix for the kind of bug this spec exists because of —
  "computed but not consulted" is exactly what a per-status table test
  catches that reading the code by eye did not, the first time.
- **`RELEASE_BLOCKING_CONTROLS` drift guard**, extending the existing
  `RELEASE_GATE_CONTROL_MAP drift guard` test in
  `tests/core/release-evaluator.test.ts`: every listed controlId exists
  in the real catalog, is not `deprecated`/`retired`, and has no
  `replacedBy`.
- **Metamorphic test for the bug that motivated this spec**: construct
  one baseline input that evaluates to `"approved"`, then for each of
  `GOV-IR-001` and `OPS-BACKUP-TEST-001`, flip *only* that control's
  status to `FAIL` (nothing else in the input changes) and assert
  `result` actually changes to `"blocked"`. A test that only asserts the
  final value for a hand-built "failing" input can still pass even if a
  field is computed-but-ignored, provided nobody wrote the specific test
  for that field — a before/after flip on an otherwise-fixed input is
  the shape of test that would have caught the original bug immediately.
- **No double-counting test**: a `control_gap` finding attached to a
  control in `RELEASE_BLOCKING_CONTROLS` whose assessment is `FAIL`
  blocks release exactly once (`blockingControlFailures` has length 1,
  `criticalFindings`/`highFindings` unaffected by it) — confirming §3's
  "Finding Gate and Control Gate don't double-count" design intent holds
  in code, not just in the spec prose.

## 7. Out of Scope

- **Moving `RELEASE_BLOCKING_CONTROLS` to `data/process/release-gates.json`
  or elsewhere data-driven.** Seriously considered during review (§8);
  rejected for now because the original motivating concern (project-
  profile conditionals piling up as TypeScript `if` statements) turned
  out not to apply — `applicability.when` already owns that problem.
  Revisit if/when real requirements for per-SVL blocker lists, per-gate
  (gate 3 vs gate 4) differences, or organization-level custom policy
  appear — none exist today.
- **Finding Gate changes for `likely_vulnerability`.** External review
  raised a reasonable case for `likely_vulnerability` findings at
  critical/high severity contributing `"blocked"`/`"indeterminate"` the
  way `confirmed_vulnerability` does today. This is a change to the
  *Finding* Gate, a different axis from this spec's Control Gate work,
  and was not part of what this spec was scoped to fix. Recorded here as
  a real, separate follow-up candidate, not silently dropped.
- **`DEVOPS-ARTIFACT-001` as a conditional release blocker** for
  artifact-is-the-product SVL-3 projects (§4) — no such project exists
  in this codebase's validation series yet to ground the decision
  against.
- **Retroactively re-evaluating the 6 (+2) already-assessed real
  validation projects** against the new gate. A real, likely next step
  once this ships, but a separate action from the design/implementation
  work this spec covers — the project's own established practice is to
  re-run `generate_report` and document the resulting verdict changes in
  `tracking.md` as its own tracked step, not bundle it into a code spec.
- **Validating that `ACCEPTED_RISK` reflects a real, valid `RiskAcceptance`.**
  Found during the second external review round (§8). `record_assessment`
  only checks that a `riskAcceptanceId` string is non-empty — nothing in
  this codebase creates, persists, or validates a `RiskAcceptance` entity
  (scope, approver, expiry, compensating controls). This was already a
  known, documented gap from the original MCP server design (`riskAcceptanceId`
  was explicitly "pattern only, not used by any tool this phase"), not
  introduced by this spec — but this spec's Control Gate makes it matter
  more: any of the 8 `RELEASE_BLOCKING_CONTROLS` can have its status set
  to `ACCEPTED_RISK` with an arbitrary `riskAcceptanceId` and the Control
  Gate will treat it as satisfied, no questions asked. Fixing this
  properly needs a real `RiskAcceptance` persistence-and-validation
  subsystem — out of scope for a release-gate change, and needs its own
  design pass. Recorded here as a real, separate, higher-priority
  follow-up (it is a genuine bypass path), not silently accepted.
- **Detecting a `ControlAssessment` that's stale relative to the current
  project profile.** Also found during the second external review round.
  `ControlAssessment` has no field recording which `profileRevision` it
  was assessed against, so if a project's profile changes after an
  assessment (e.g. a project that previously had no local password auth
  adds it), the old assessment's status keeps being trusted by
  `evaluateRelease` with no staleness signal anywhere. This is a
  pre-existing property of the whole assessment model (`ControlAssessment`
  upsert-by-`controlId`, documented in the MCP server spec), not specific
  to release-blocking controls, but the Control Gate inherits it for all
  8 listed controls. Fixing this needs a schema change
  (`ControlAssessment.profileRevision` or equivalent) plus a staleness
  check somewhere in the read path — a real follow-up, not in scope here.
- **Cross-checking a recorded `N/A` status against the control's actual
  `applicability.finalResult`.** Found during *final whole-branch review*
  (not the second external review round that found the two gaps above).
  `VERDICTS_REQUIRING_METHODOLOGY_EVIDENCE` in `record_assessment`
  excludes `N/A`, so `record_assessment { status: "N/A", notes: "n/a" }`
  requires no evidence at all — not even a `riskAcceptanceId`, which
  `ACCEPTED_RISK` demands — and nothing anywhere verifies the control is
  actually inapplicable to the project. For any of the 8
  `RELEASE_BLOCKING_CONTROLS`, this makes `N/A` the cheapest of the three
  known bypasses of the Control Gate: cheaper than `ACCEPTED_RISK` (which
  at least requires a non-empty `riskAcceptanceId` string) and cheaper
  than a stale PASS (which at least requires a PASS to have been real at
  some point). Fixing this properly needs threading `applicability` into
  the Control Gate's inputs (`ControlAssessmentInput` and whatever
  constructs it in `src/service/*.ts`) plus its own design pass — out of
  scope for this spec.

## 8. Adoption Log (external review)

**Adopted as proposed:** the three-gate architecture (Finding/Control/
Coverage, worst-wins combination); the inclusion test for release-
blocking controls ("would the basic security assumption break even
without a new vulnerability"); keeping the list small and explicit
rather than "every FAIL blocks"; the per-status regression + drift-guard
+ metamorphic test shapes.

**Adopted with a smaller mechanism than initially proposed by the
reviewer:** the reviewer's first pass recommended storing
`RELEASE_BLOCKING_CONTROLS` in `data/process/release-gates.json` (a
data-driven policy file) specifically to avoid project-profile
conditionals accumulating as TypeScript code. On cross-checking against
this project's actual `applicability.when` system — which already
resolves exactly that conditionality at `record_assessment` time, before
`evaluateRelease` ever runs — the reviewer agreed the original concern
didn't apply to this codebase's real structure, and revised to endorse
the simpler hardcoded `ReadonlySet<string>`, matching the existing
`RELEASE_GATE_CONTROL_MAP` pattern and the user's own stated preference.
The reviewer's secondary point (PARTIAL/NOT_TESTED on a blocking control
should contribute "indeterminate," not be silently ignored) was adopted
directly into §3's table — this project's own earlier draft had only
specified FAIL→blocked with no stated behavior for the other four
statuses.

**Rejected (deferred, not dropped — see §7):** moving the list to a JSON
policy file now; expanding `IAM-AUTHZ-*` coverage beyond `001`/`002`;
including `DEVOPS-ARTIFACT-001`; changing the Finding Gate's treatment of
`likely_vulnerability`.

**Second review round (final design/plan review, before implementation):**
confirmed the architecture, control list, and status-mapping table in this
spec match what both sides agreed on, and confirmed both self-caught test
bugs (§6) were diagnosed and fixed correctly. Surfaced two real,
pre-existing structural gaps neither side had caught before — the
`ACCEPTED_RISK` validity gap and the stale-`ControlAssessment` gap, both
now recorded in §7 as explicit, separate follow-ups rather than folded
into this plan's scope. Also raised, and considered but not changed:
whether `incidentResponseVerified`/`backupRestoreVerified` should derive
from the same computation as `blockingControlFailures`/
`blockingControlsNotVerified` rather than their own independent lookup
against `assessmentByControl`, to rule out the two ever drifting apart
the way the original dead-calculation bug happened. On inspection this
doesn't apply here: both already read the exact same `assessmentByControl`
map built once per call with no caching, so they're two pure-function
views of one source and cannot drift; and the two booleans' semantics
("is this control's status exactly `PASS`") differ from the Control
Gate's three-way bucketing (`FAIL` / not-verified / no-contribution),
so forcing one to derive from the other would need extra logic with no
correctness benefit. Kept as two independent, equally-trivial
computations over the same map — this is `src/core/release-evaluator.ts`'s
`incidentResponseVerified`/`backupRestoreVerified` lines, unchanged by
this plan except for the new sibling arrays alongside them. Adopted:
sorting `blockingControlFailures`/`blockingControlsNotVerified` before returning
them, for deterministic test/snapshot output. Suggested but not adopted
as a hard requirement: full 8-control × 5-status parameterized metamorphic
tests (the plan's existing coverage — all 8 tested for `FAIL` via one
loop, plus full status-mapping proven once via a representative control —
was judged sufficient without the full cross-product); a documented
"known follow-up" note about `Control FAIL` with zero attached `Finding`s
being worth a future semantic-consistency check — recorded here as a
noted idea, not a spec requirement.
