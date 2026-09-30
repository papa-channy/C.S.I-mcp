# MCP Server (Tool/Handler Layer) — Design

Date: 2026-09-30
Status: Draft — pending user review

## 1. Context and Goal

The Core Security Engine (merged `2026-09-28`, commit `69b28ad`) built six pure
functions and a `SecurityRepository`/`JsonRepository` data-access layer under
`src/core/`, deliberately stopping short of the "Application/Service layer"
that wires them together — every Core function takes plain data and returns
plain data; nothing calls `SecurityRepository`, and nothing exposes any of
this to a human or an agent yet. This spec builds that layer: an MCP server
an AI agent can hold a conversation through to assess one real project.

**Scope, confirmed during brainstorming:** a single agent (e.g. Claude, via
Claude Code or Claude Desktop) drives one project's assessment
conversationally — no multi-client access, no authentication, no concurrent
writers. Transport is stdio. `expandPlan` (`src/core/plan-expander.ts`) and
everything downstream of it — batch dispatch, retry, timeout, concurrent
writes to the same Finding — stay out of scope, deferred to the
already-flagged later "agent orchestration" spec; a single agent walking
`list_controls` one control at a time needs no batch splitting.

**Review process:** this design went through one external (ChatGPT) review
round at the same persistent thread used for every prior phase. §9 records
what was adopted, adapted, or rejected, and why — the standing practice for
this project is to evaluate external review critically, not apply it
verbatim.

## 2. Architecture

```
src/
  core/                    # existing, unmodified except the 3 additions in §3
  service/
    project-service.ts     # createProject, getProject, updateProfile
    assessment-service.ts  # startRun, listControls, recordAssessment, recordFinding, listFindings
    analysis-service.ts    # getScore, evaluateRelease
    report-service.ts      # generateReport
    errors.ts              # ServiceError + the 3-code taxonomy (§5)
    ids.ts                 # ID generation (§3)
  mcp/
    server.ts              # McpServer + StdioServerTransport wiring
    tools/                 # one file per tool, each: zod input schema + handler calling into service/
```

**Layering rule, carried over from the Core Engine spec's own principle and
tightened by review:** an MCP tool handler does input/output mapping only —
it parses the tool call's input, calls exactly one `service/` function, and
shapes that function's return value into the tool's `content`/
`structuredContent` response. No tool handler calls another tool handler.
`generate_report`'s handler calls `ReportService.generate`, which itself
loads the project/controls/assessments/findings once and calls
`AnalysisService`'s pure wiring functions directly — never by invoking the
`get_score` or `evaluate_release` tool handlers. This is what keeps a
report's `score` and `releaseEvaluation` computed from the same snapshot
instead of two separate reads that could observe different state.

Every `service/` function is the only thing that touches
`SecurityRepository`; Core functions (`evaluateApplicability`,
`calculateCriticality`, `calculateScore`, `evaluateRelease`, `buildReport`,
`sortPrioritizedFindings`) stay exactly as merged — this spec calls them,
never modifies them.

## 3. `SecurityRepository` Extensions

Grounding this design against the actual `SecurityRepository` interface
(`src/core/repository.ts`) surfaced three real gaps: it has no method to
persist a new `Project`, a `ControlAssessment`, a `Finding`, or an
`Evidence` record — `saveRun`/`saveBatch`/`saveReport` exist, but nothing
for the four entity types this phase's tools need to write. These are
additive extensions to the existing interface and `JsonRepository`
implementation, not a redesign:

```ts
interface SecurityRepository {
  // ...existing methods, unchanged...
  saveProject(project: Project): Promise<void>;
  saveControlAssessment(assessment: ControlAssessment): Promise<void>;
  saveFinding(finding: Finding): Promise<void>;
  saveEvidence(evidence: Evidence): Promise<void>;
}
```

File layout additions under the existing `data/projects/<projectId>/`
convention: `evidence.json` (single array file, matching `assessments.json`/
`findings.json`'s existing pattern). `saveProject` writes
`project.json` (already read by `getProject`, never written by Core
Engine's `JsonRepository` — nothing created a `Project` before this phase).

**`saveControlAssessment` upsert semantics.** `control-assessment-schema.json`
has no `runId` field — a documented, known gap from the Core Engine phase
(`PROGRESS.md`'s "Core Engine follow-up items"). Two ways to resolve it: add
an optional `runId` field to the frozen schema, or design around the gap
instead of fighting it. This spec takes the second option: **one
`ControlAssessment` per `(projectId, controlId)`, period** —
`saveControlAssessment` reads `assessments.json`, replaces the entry sharing
`controlId` if one exists, appends otherwise. Re-assessing a control after a
fix simply overwrites its record; "current status" is unambiguous by
construction, and `getControlAssessments(projectId, runId?)`'s already-known
`runId` limitation stays exactly as documented — this design never asks it
to do something it structurally can't. `AssessmentRun` still exists (§6) for
`ProjectReport.assessmentRunId` provenance and as a session boundary a human
can point to ("the assessment I ran on the 30th"), but it is not a filter
key for assessments. A full immutable-history-with-supersession model is
real, deferred future work if re-assessment auditability ever becomes a
requirement — not needed for this phase's single-pass workflow.

## 4. ID Generation

Checked against every schema's `pattern` constraint directly rather than
assumed:

| ID | Schema constraint | Generation |
|---|---|---|
| `projectId`, `runId`, `reportId`, `assessmentId`, `batchId`, `planId` | `minLength: 1` only | `crypto.randomUUID()` |
| `findingId` | `^FND-[0-9]+$` | `FND-` + next integer |
| `evidenceId` | `^EVD-[0-9]+$` | `EVD-` + next integer |
| `riskAcceptanceId` | `^RA-[0-9]+$` | `RA-` + next integer (not used by this phase's tools, but the pattern is recorded here since `ControlAssessment.riskAcceptanceId` references it) |

"Next integer" for the three pattern-constrained IDs is computed at save
time from the existing project-scoped file: `FND-<findings.json.length + 1>`,
`EVD-<evidence.json.length + 1>`, zero-padded to 3 digits for readability
(`FND-001`). Single-writer `JsonRepository` (documented in the Core Engine
spec) makes this race-free in this phase's single-agent scope. `src/service/
ids.ts` owns this logic so it's written once, not duplicated per service
file.

## 5. Cross-Cutting Concerns

**Structured output.** Every tool's success response returns both
`content` (one human-readable text block summarizing the result — what an
agent would say back to a person) and `structuredContent` (the actual
typed JSON payload — what an agent uses as input to its next tool call).
Never text-only: this project's tools chain (list → record → score →
report), and a later tool call re-parsing prose from an earlier one is
exactly the kind of fragility this project has avoided everywhere else.

**Error taxonomy.** Three codes, chosen to match this phase's actual call
sites rather than a speculative larger set:

- `VALIDATION_ERROR` — malformed input, a conditionally-required field
  missing (schema's own `allOf`/`if`/`then` rules: `notes` when
  `status:"N/A"`, `riskAcceptanceId` when `status:"ACCEPTED_RISK"`,
  `priorityOverrideReason` when criticality≥8 and priority≥2), or this
  phase's one added business rule: `record_assessment` rejects
  `status:"PASS"` with zero evidence entries.
- `NOT_FOUND` — a referenced `projectId`/`controlId`/`runId` doesn't exist.
- `PRECONDITION_FAILED` — a Core Engine throw surfaces here: `evaluate_release`
  called against `SVL-0`/`SVL-1` (gate 4 has no defined threshold — Core
  Engine's own documented precondition), or `get_score`/`generate_report`
  called before any assessment exists (`calculateScore`'s zero-denominator
  throw).

A tool's MCP result sets `isError: true` with `structuredContent: {code,
message, details?}` on any of the three; `content` carries the same message
as readable text. No tool handler invents a fourth code without updating
this table first.

**No `stdout` logging under stdio transport.** `StdioServerTransport` uses
`stdout` as the JSON-RPC message channel — any `console.log` call
corrupts the protocol stream. `src/mcp/server.ts` establishes this as a
hard rule in its own header comment; any logging this phase needs goes to
`console.error` (stderr) only.

## 6. Tools (11)

Grouped by the service they call. Every tool's `content` text is a short
natural-language sentence; `structuredContent` shapes are sketched below
at the field level a plan will pin exactly against the real schemas.

### Project (`ProjectService`)

**`create_project`** — input: `name`, `owner`, `securityLevel`, `exposure`
(required, matches `project-profile-schema.json`'s own required set),
`features`/`technologies` (objects, may be empty `{}`), `components`/
`identities`/`dataClasses` (optional — omitted means the three-valued
UNKNOWN state from day one, exactly as the schema already defines).
`ProjectService.createProject` generates `projectId` via `crypto.randomUUID()`,
sets `profileRevision: 1`, `createdAt: now()`, calls `saveProject`. Output:
the full `Project`.

**`get_project`** — input: `projectId`. Output: the full `Project`, or
`NOT_FOUND`.

**`update_project_profile`** — input: `projectId` + any subset of
`securityLevel`/`exposure`/`features`/`technologies`/`components`/
`identities`/`dataClasses`. **Patch semantics are the single most important
contract in this tool, restated from the profile's own three-valued
design:** a field **absent from this call's input** leaves the stored value
untouched; a field present as `[]` sets it to KNOWN-NONE; a field present
with values sets it to KNOWN-VALUES. The handler must distinguish "key not
in the parsed input object" from "key present with an empty array" —
`input.components ?? existingValue` is exactly the collapsing bug this
project's hard rule (`PROGRESS.md`) already forbids one layer down, and
this tool is where it would first leak in from the outside. `profileRevision`
increments by 1 on any successful update. Output: the updated `Project`.

### Assessment (`AssessmentService`)

**`start_assessment_run`** — input: `projectId`. This phase never exposes
`AssessmentPlan`/`expandPlan` to the agent (§1), but `AssessmentRun`'s
schema requires a `planId`/`planVersion` it can't get from nowhere. Rather
than inventing a plan-free `AssessmentRun` variant (a schema change, ruled
out for the same reason §3 avoided one), `startRun` transparently creates
(or reuses, if one already exists for this project) a minimal default
`AssessmentPlan` — `groupBy: "controlId"` (arbitrary; nothing reads
`groupBy` in this phase), empty `selection`, `defaultMaxParallelAgents: 1`
— and uses its `planId`/`version` to satisfy the schema. The agent never
sees this plan; it exists purely so `AssessmentRun` stays schema-valid.
`runId` via `crypto.randomUUID()`, `status: "running"`, `batchIds: []`
(this phase does no batching), `catalogVersion`/`profileRevision` read
from the manifest/project at call time. Output: `runId`, `startedAt`.

**`list_controls`** — input: `projectId`, optional filters `domain`,
`catalogStatus` (Control's own lifecycle: draft/active/deprecated/retired
— named distinctly from the next two per review, since this project now
has five different things called "status"), `applicability`
(applicable/not_applicable/unknown), `assessmentStatus` (the six
`ControlAssessment.status` values), `detail: "summary" | "full"` (default
`"summary"`). Internally: `getControls()` + `evaluateApplicability(control,
project.profile)` per control + a lookup against that project's current
`ControlAssessment`s (§3's one-per-controlId model) for `assessmentStatus`
and `findingCount`. Summary shape: `{controlId, title, domain,
applicability, assessmentStatus, findingCount}`; `detail:"full"` (or a
`controlIds` filter) returns the complete catalog record for matching
controls instead of a summary — this replaces a separate `get_control`
tool.

**`record_assessment`** — input: `projectId`, `runId`, `controlId`,
`status`, `evidence: {type, location, description?}[]` (the `Evidence`
entity's real shape per `evidence-schema.json` — `type` is one of its 14
enum values, `location` is required), `notes?`, `riskAcceptanceId?`,
`applicabilityOverride?: {result, reason}`. Handler sequence:

1. Look up the control (`NOT_FOUND` if unknown).
2. `evaluateApplicability(control, project.profile)` → `autoResult`.
3. If `applicabilityOverride` given: `finalResult = override.result`,
   `source: "manual_override"`, `reason` required (schema's own conditional
   — `VALIDATION_ERROR` if missing). Else `finalResult = autoResult`,
   `source: "automatic"`.
4. **Business rule this phase adds beyond what Core Engine enforces:**
   `status: "PASS"` requires at least one `evidence` entry —
   `VALIDATION_ERROR` otherwise. This is a deliberately light version of
   "PASS requires Requirement + Verification + Evidence" (the project's own
   long-standing principle): it does not cross-check the control's
   `assurance[securityLevel]` verification-method requirements against the
   evidence provided. Full assurance-matching is real, useful, and
   explicitly deferred — recorded in §8, not silently dropped.
5. For each `evidence` entry: generate `evidenceId` (§4), `capturedAt: now()`,
   `capturedBy` from the calling agent's identity (a fixed string this
   phase's stdio single-agent context supplies — see §8 for the
   multi-identity gap this doesn't solve), `saveEvidence`.
6. Build the `ControlAssessment` (`assessmentId` via `crypto.randomUUID()`,
   `evidenceIds` from step 5's generated IDs, `applicability: {autoResult,
   finalResult, matchedRules, source, reason?}`), `saveControlAssessment`
   (§3's upsert).

Output: the saved `ControlAssessment`.

**`record_finding`** — input: `projectId`, `controlIds` (must all exist —
`VALIDATION_ERROR` otherwise), `title`, `attackScenario`, `severityFactors:
{impact, exploitability, exposure, privilegeRequired, detectionDifficulty}`,
`priorityIndex`, `priorityRationale`, `priorityOverrideReason?`. The
service, never the caller, computes: `findingId` (§4), `criticality` (via
`calculateCriticality` against the loaded `CriticalityFormula`, with
`now()` injected), `severity` (derived from `criticality.index` via a fixed
threshold table this spec fixes now, since nothing upstream defines
one — `8-9: critical`, `6-7: high`, `4-5: medium`, `2-3: low`, `0-1: info`),
`priority: {index, source: "agent", rationale, assignedBy: <agent
identity>, assignedAt: now()}`, `status: "open"`. Schema's own guardrail
(`priorityOverrideReason` required when `criticality.index>=8 &&
priority.index>=2`) is `VALIDATION_ERROR` if triggered and missing — this
is the same check `finding-schema.json` already enforces structurally;
the service just needs to surface the failure with the right error code
before Ajv would reject a malformed save. `saveFinding`. Output: the saved
`Finding`.

**`list_findings`** — input: `projectId`, optional `status`, `controlId`,
`minPriority`/`minCriticality`. Output: matching `Finding[]`. Exists purely
so a long or compacted conversation can recover "what did I already find"
without re-deriving it from memory — the gap review flagged as the clearest
missing read path.

### Analysis (`AnalysisService`)

**`get_score`** — input: `projectId`. Internally: `getControlAssessments`
(current, project-wide per §3) + `getFindings` + `getControls` +
`calculateScore`. Output: `Score`.

**`evaluate_release`** — input: `projectId` **only** — no `securityLevel`
parameter. This is the one clear security-relevant fix from review: `Project.
profile.securityLevel` is the single source of truth, read server-side;
accepting it as caller input would let a mistaken or malicious tool call
silently evaluate a project against a weaker gate than its actual
`securityLevel`. If an agent needs a different `securityLevel` evaluated,
`update_project_profile` is the only path — the same reasoning that
already governs why Core Engine's `calculateScore` doesn't take a caller-
supplied status weight it could otherwise get from the model file.
Internally: load project (for `securityLevel`) + `get_score`'s already-
computed `Score` (called as a service function, not a tool re-invocation —
§2's layering rule) + findings + assessments + `attackPaths: []` (this
phase has no tool that creates `AttackPath` records — `unblockedCriticalAttackPaths`
is always `0` here, a known, documented limitation, not a silent gap; see
§8) + `evaluateRelease`. `SVL-0`/`SVL-1` → `PRECONDITION_FAILED` (Core
Engine's own throw, mapped through). Output: `ReleaseEvaluation`.

### Report (`ReportService`)

**`generate_report`** — input: `projectId`, `runId`, `summary` (free text,
agent-authored — Core Engine's `buildReport` takes this as a required
input by design, nothing computes it). `ReportService.generate` loads
project/controls/assessments/findings **once**, computes `Score` and
`ReleaseEvaluation` from that one loaded set (never by calling the
`get_score`/`evaluate_release` tool handlers — the exact snapshot-
consistency point review raised), generates `reportId` (§4), calls
`buildReport` then `saveReport`. Output: the `ProjectReport`.

## 7. Testing Strategy

Mirrors the Core Engine spec's split by what realism of test data actually
proves:

- **Service-layer tests** (`tests/service/*.test.ts`) are the primary
  surface — each function is thin glue over already-tested Core functions,
  so what needs proving is the wiring and the business rules this layer
  adds that Core Engine doesn't: `update_project_profile`'s omitted-vs-`[]`
  patch semantics (three fixture calls: omit a field, send `[]`, send
  values — proving each leaves/clears/sets independently of the others);
  `record_assessment`'s upsert-by-`controlId` (assess a control twice,
  confirm exactly one `ControlAssessment` survives with the second status);
  the PASS-requires-evidence rule; `record_finding`'s
  `priorityOverrideReason` guardrail and severity-threshold derivation
  (boundary values at each threshold edge: 1/2, 3/4, 5/6, 7/8); `evaluate_release`
  never accepting a `securityLevel` parameter (a type-level test: the
  input schema has no such field, not just a runtime check).
- **Tool-layer tests** (`tests/mcp/tools/*.test.ts`) are thin: given a
  tool's zod input schema and a mocked/in-memory `SecurityRepository`,
  confirm the tool calls the right service function and shapes its result
  into `content`+`structuredContent` correctly, and that each of the three
  error codes actually surfaces as `isError: true` with the right code —
  not re-testing business logic the service layer already covers.
- **Repository extension tests** (`tests/core/repository.test.ts`,
  appended) — `saveProject`/`saveControlAssessment`/`saveFinding`/
  `saveEvidence` round-trip against a temp directory exactly like the four
  existing `save*` methods' tests, plus a dedicated test for the upsert
  behavior itself (two `saveControlAssessment` calls for the same
  `controlId`, confirm `assessments.json` ends with one entry, not two).
- **One integration test**: a full tool-call sequence against a real
  temp-directory repository — `create_project` → `update_project_profile`
  → `start_assessment_run` → `list_controls` → `record_assessment` (PASS
  with evidence) → `record_finding` → `get_score` → `evaluate_release` →
  `generate_report` — asserting the final `ProjectReport` is schema-valid
  (via `compileSchemaFromFile`) and internally consistent (the assessment
  just recorded is reflected in the score; the finding just recorded
  appears in `prioritizedFindings`). This is the smallest possible proof
  the whole chain composes, short of the full 48-control real-project E2E
  assessment `PROGRESS.md` already records as a deferred later step.

**Explicitly not tested here:** the MCP stdio transport itself (trusting
the SDK), and multi-agent/concurrent-write behavior (out of scope, §8).

## 8. Out of Scope

- **Agent orchestration** — `expandPlan`, batch dispatch, retry, resume,
  concurrent writes to the same `Finding`/`ControlAssessment`. A later
  spec, as already established.
- **Full assurance/verification-method matching in `record_assessment`** —
  the light "PASS needs ≥1 evidence entry" check stands in for actually
  cross-checking `control.assurance[project.securityLevel]` against the
  evidence's types. Real, deferred, not silently dropped — needs its own
  design pass on what "verification method satisfied by evidence type X"
  means precisely.
- **`AttackPath` creation** — no tool in this phase produces `AttackPath`
  records, so `evaluate_release`'s `unblockedCriticalAttackPaths` is
  always `0`. Attack-path modeling (chaining findings into an exploit
  path) is its own feature, not sketched here.
- **Finding lifecycle beyond creation** — no `update_finding`/`resolve_finding`/
  `retest` tool. A `Finding`'s `status` starts and stays `"open"` for the
  life of this phase's tool surface; marking one resolved or false-positive
  requires direct data editing until a later phase adds that path.
  Recorded here explicitly per review, not left implicit.
- **Multi-identity `capturedBy`/`assignedBy`.** Every evidence/finding
  records an "agent identity" string; this phase doesn't model multiple
  distinct agents or human reviewers — a single fixed identity per server
  process is enough for the confirmed single-agent scope. Revisit if
  multi-agent orchestration ever needs per-agent attribution.
- **Idempotency keys for write tools.** A retried `record_finding` call
  after a dropped response can create a duplicate `Finding`. Real risk is
  low in a single-agent stdio session (no automatic retry layer sits
  between the agent and this server), but it is a known limitation, not a
  solved one — an optional `clientRequestId` dedup key is the documented
  fix if this ever becomes a real problem.
- **`record_evidence` as its own tool / `Evidence` reuse across
  assessments.** Evidence is created only as a side effect of
  `record_assessment`, scoped to that one call's `evidence` input. Reusing
  one `Evidence` record across multiple `ControlAssessment`s is possible
  in principle (`evidenceIds` is just an array of refs) but nothing in
  this phase's tool surface supports selecting an existing one instead of
  creating a new one — YAGNI until a concrete need for reuse shows up.
- **Full `assessments.json`/`findings.json` write concurrency.** §3's
  one-record-per-`controlId` upsert and the single-writer `JsonRepository`
  assumption (already documented in the Core Engine spec) both assume
  exactly one MCP server process touching one project's files at a time —
  true for this phase's single-agent scope, revisited if that changes.

## 9. Adoption Log (external review)

The design above already reflects the accept/adapt/reject decisions made
during brainstorming; this section is the record of which is which, so
the reasoning travels with the spec rather than living only in chat
history.

**Adopted as proposed:** `update_project_profile` tool; `evaluate_release`
never taking `securityLevel` as input; `generate_report` computing from one
loaded snapshot instead of re-invoking other tools; `list_findings`;
`list_controls`' `status` → `catalogStatus`/`assessmentStatus`/
`applicability` split plus summary-shaped default output; `content` +
`structuredContent` on every tool response; a small fixed error-code
taxonomy; no `stdout` logging under stdio transport.

**Adopted with a smaller mechanism than proposed:**
`AssessmentRun`/`start_assessment_run` — the underlying problem (which
assessment is "current" for a control) is real, but this spec resolves it
with a project-wide one-assessment-per-`controlId` upsert (§3) instead of
the proposed immutable-history-plus-`supersedesAssessmentId` chain, since
the latter needs a schema change (`runId` on `ControlAssessment`) this
phase's single-pass workflow doesn't yet justify. `record_assessment`'s
evidence/assurance validation — adopted as "PASS requires ≥1 evidence
entry," not the proposed full assurance-method cross-check (§8), since the
full version is real design work, not a same-session addition.

**Rejected:** a separate `record_evidence` tool / `Evidence` as an
independently-manageable entity — kept as an internal side effect of
`record_assessment` only (§8), since nothing in this phase's confirmed
single-agent scope needs Evidence reuse across assessments, and a 12th
tool for a capability nothing calls yet is exactly the premature surface
area this project's YAGNI practice avoids elsewhere. An `@modelcontextprotocol/
sdk` → `@modelcontextprotocol/server` package rename claim — not something
this spec can independently verify; recorded as "confirm the real package
name against npm at implementation time," not taken as a design input now.
A `clientRequestId` idempotency key — the reviewer's own framing already
treated this as optional/deferrable; kept as a documented limitation
(§8), not implemented.
