# Project Scoring, Priority Mapping & Agent Workflow — Data Foundation Design

Date: 2026-09-18 (revised after external review)
Status: Draft — pending user review

## 1. Context and Goal

Phase 1 (complete, merged to `main`) built the Control catalog / schema
foundation: `Control`, `ControlAssessment`, `ProjectProfile`, `Threat`,
`Asset`, `Evidence`, `Finding`, `AttackPath`, `RiskAcceptance`,
`ReleaseEvaluation` — 10 JSON Schemas plus reference data and one
proof-of-concept control domain (`identity-access.json`, 12 controls).

Phase 2 (this spec) adds the layer needed to actually *run* a security
review against a real project and turn the results into something
actionable:

1. A **Project** entity — the thing being assessed.
2. A **configurable grouping/batching mechanism** so verification agents
   can be assigned work by domain, subdomain, layer, or even one agent
   per individual control — a runtime configuration choice, not a
   hardcoded grouping.
3. A **Criticality (C) / Priority (P) dual index** on every `Finding`,
   giving each vulnerability a `PxCx` work-order label (e.g. `P0C5`).
4. A **hierarchical Score** (overall + per-domain), paired with an
   explicit **Coverage** measure so a score can never silently imply more
   was verified than actually was.
5. A **ProjectReport** that ties score, prioritized findings, and the
   existing `ReleaseEvaluation` together into one **immutable, reproducible
   snapshot**.

Explicitly out of scope for this phase (same reasoning as Phase 1's spec
§12): the actual MCP server tool implementations that generate
`AssessmentBatch`/`AssessmentRun` records, dispatch agents, or compute
`Criticality`/`Score` values at runtime. This spec defines the data
contracts those tools will read and write; it does not implement them.
Populating more control domains (the Phase 1 follow-up work) is
unaffected and unblocked by this phase.

### 1.1 Revision note

This design went through one external review round (see project memory /
conversation history) before being finalized. The review's most important
finding — that the original draft had no entity representing "one full
assessment run" and no way to tell a real score from an under-tested one
— is incorporated below (`AssessmentRun`, `Score.coverage`). Section 8
records every reviewed point and whether it was adopted, so the reasoning
survives even where the review's exact wording doesn't appear in the
final design.

## 2. Entity Overview

```
Project (profileRevision tracked)
 └─ profile: ProjectProfile (trimmed — no projectId, Project already has one)

AssessmentPlan                         "reusable policy: what to check, how to group/size it"
 └─ version, selection{applicability, assessmentStatuses, domains, controlIds}
 └─ groupBy: domain | subdomain | layer | group | controlId
 └─ defaultMaxParallelAgents, groupOverrides[]

AssessmentRun                          "one full execution of a plan against a project"
 └─ planId, planVersion, profileRevision, catalogVersion
 └─ batchIds[], status, startedAt/completedAt

AssessmentBatch                        "one agent's actual unit of work, belongs to a Run"
 └─ runId, controlIds[], assignedAgent, status, resultingAssessmentIds[], resultingFindingIds[]

Finding (existing schema, extended)
 └─ criticality: {index 0-9, formulaId, formulaVersion, computedAt} — deterministic, agent never sets this directly
 └─ priority:    {index 0-9, source, rationale, assignedBy, assignedAt} — agent judgment
 └─ priorityOverrideReason — required only when criticality.index>=8 AND priority.index>=2 (guardrail)
 └─ detectionDifficulty (renamed from detectability — direction was ambiguous)

CriticalityFormula (schema) + core/criticality-weights.json (data)
 └─ defines how the 5 existing Finding sub-scores combine into criticality.index

ScoreModel (schema) + core/scoring-model.json (data)
 └─ defines how ControlAssessment statuses combine into a Score

Score
 └─ overallScore (0-100) + coverage{applicableControls, assessedControls, coveragePercent}
 └─ domainScores[] (per-domain, all 6 ControlAssessment statuses broken out + coverage)
 └─ scoreModel: {id, version}

ProjectReport                          immutable snapshot, the final deliverable
 └─ assessmentRunId, catalogVersion, profileRevision, scoreModel, criticalityFormula
 └─ score: Score (embedded)
 └─ prioritizedFindings[]: {findingId, priorityIndex, criticalityIndex, title} — sorted priorityIndex asc, criticalityIndex desc, findingId asc
 └─ releaseEvaluation: ReleaseEvaluation (existing schema, embedded)
 └─ summary: narrative string
```

`groupBy` reuses fields that already exist on every `Control` record
(`domain`, `subdomain`, `layer`, `group` — all added in Phase 1's
`control-schema.json`), so no new taxonomy is needed to support arbitrary
grouping granularity, including `controlId` (one control = one agent).

## 3. The P/C Dual Index

### 3.1 Ordering semantics

`priority.index` (P, 0-9) is the **primary** sort key: lower P is more
urgent, and P dominates C in ordering. `P0C9` is addressed before `P1C0`,
regardless of C, because P is compared first. Within the same P tier,
higher C (more severe) is addressed first — C is the secondary/tie-break
key. A third tie-break, `findingId` ascending, guarantees a total,
deterministic order when both P and C are equal for two findings (added
after review — without it, output order for tied findings is undefined
and can vary between runs/implementations).

### 3.2 Priority (P): agent judgment, with provenance and a guardrail

P is set directly by the reporting agent's judgment — it is **not**
computed from C or any other field by a fixed formula, because business
context (a compliance deadline, an active incident, a contractual
obligation) can make a low-C finding more urgent than a high-C one.

The review correctly flagged that "agent judgment, no formula" plus "P
always beats C" is a dangerous combination without a floor: nothing
would stop one agent from filing a remote-code-execution finding as
`P7`, silently burying it behind dozens of low-severity `P0` findings.
`priority` is therefore a small object, not a bare integer, and carries
a conditional guardrail:

```json
"priority": {
  "index": 1,
  "source": "agent",
  "rationale": "Exploitation requires an already-authenticated session; scheduled for the next sprint per the remediation backlog.",
  "assignedBy": "agent-security-03",
  "assignedAt": "2026-09-18T05:00:00Z"
}
```

**Guardrail:** if `criticality.index >= 8` (i.e. the finding is already
near-maximum on the deterministic severity scale) and the agent still
sets `priority.index >= 2` (i.e. not top-tier urgent), `Finding` requires
a top-level `priorityOverrideReason` (non-empty string) in addition to
`priority.rationale`. This does not force high-C findings to be `P0`/`P1`
— business context can still legitimately deprioritize them — it forces
that decision to be explicit and auditable rather than silent. Expressed
as a single JSON Schema `if`/`then` (§4.1).

`priority.source` is `"agent"` or `"human"` — the review's suggested
`confidence` (0-1 float) field is **not** adopted: there is no defined
consumer for it yet and no calibration process behind it, so it would be
a number nobody can currently interpret correctly. It can be added later
as a new optional field without a breaking change if a real use case
appears.

### 3.3 Criticality (C): a computed value, never an agent input

The review's sharpest correction: `criticality` must be **derived**, not
entered. An agent supplies the five underlying factors
(`impact`, `exploitability`, `exposure`, `privilegeRequired`,
`detectionDifficulty`) already on `Finding` from Phase 1; a deterministic
formula computes `criticality.index` from them. An agent never writes
`criticality.index` as a free judgment call — if it could, `criticality`
would collapse into a second, redundant copy of `priority` (another
free-form agent number), defeating the entire point of having a
deterministic axis to check subjective `priority` decisions against.

**Direction of each field** (clarified now — Phase 1's schema left this
implicit, and the review flagged `detectability` specifically as
misleading — see §3.4):

| Field | Range | Worse end |
|---|---|---|
| impact | 1-5 | higher |
| exploitability | 1-5 | higher |
| exposure | 1-3 | higher |
| privilegeRequired | 0-2 | **lower** (0 = no privilege needed = most dangerous) |
| detectionDifficulty | 0-2 | higher (2 = hard to detect = most dangerous) |

**Formula:** normalize each field to `[0,1]` (inverting `privilegeRequired`
since its worse end is low), take a weighted sum, scale to `[0,9]`, round:

```
normImpact      = (impact - 1) / 4
normExploit     = (exploitability - 1) / 4
normExposure    = (exposure - 1) / 2
normPrivilege   = (2 - privilegeRequired) / 2
normDetect      = detectionDifficulty / 2

raw = w.impact*normImpact + w.exploitability*normExploit
    + w.exposure*normExposure + w.privilegeRequired*normPrivilege
    + w.detectionDifficulty*normDetect

criticality.index = round(raw * 9)     // integer 0-9
```

The weights (`w.*`) are **not hardcoded** — they live in a separate,
schema-validated reference data file (`data/core/criticality-weights.json`,
validated against `data/schemas/criticality-formula-schema.json`), so they
can be tuned without touching any schema or code. Default weights:
`impact 0.35, exploitability 0.25, exposure 0.15, privilegeRequired 0.15,
detectionDifficulty 0.10` (sums to 1.00).

The weights summing to 1.0 is a **data invariant enforced by a test**, not
by JSON Schema itself — consistent with how Phase 1 already handles
constraints schema can't express (e.g. `manifest.controls.count` matching
reality).

**Provenance:** because the weights are tunable, a bare `criticality: 8`
would be unreproducible — retuning the weights and recomputing could
silently turn yesterday's `C8` into today's `C7` with no record of why.
`criticality` therefore carries the formula's identity and version
alongside the computed value:

```json
"criticality": {
  "index": 8,
  "formulaId": "CRIT-DEFAULT",
  "formulaVersion": "1.0.0",
  "computedAt": "2026-09-18T05:00:00Z"
}
```

This formula computation is itself out of scope for this phase (no code
yet) — this spec only defines the schema for the weights file and documents
the formula so a future MCP server implements it consistently.

### 3.4 Field rename: `detectability` → `detectionDifficulty`

Phase 1's `detectability` (0-2) was documented as "harder to detect
increases risk" but the field name itself reads the opposite way to most
readers (naturally: "high detectability" = easy to detect = *safer*).
The review flagged this correctly. Since no real `Finding` data exists
yet (Phase 1 only has schema-validation fixtures), renaming now is free.
`detectionDifficulty` (0 = easy to detect, 2 = hard to detect) is
unambiguous in either direction. `finding-schema.json` and
`evidence-schema.json`/other Phase 1 files that don't reference this
field are unaffected; only `finding-schema.json` changes.

## 4. Schema Changes

### 4.1 `data/schemas/finding-schema.json` (modify existing)

Rename `detectability` → `detectionDifficulty` (same `0-2` range, same
position in `required`). Replace the flat `criticality`/`priority`
properties from the original draft with the object shapes from §3.2/3.3,
plus the guardrail:

```json
"detectionDifficulty": { "type": "integer", "minimum": 0, "maximum": 2 },

"criticality": {
  "type": "object",
  "properties": {
    "index": { "type": "integer", "minimum": 0, "maximum": 9 },
    "formulaId": { "type": "string", "minLength": 1 },
    "formulaVersion": { "type": "string", "minLength": 1 },
    "computedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["index", "formulaId", "formulaVersion", "computedAt"],
  "additionalProperties": false
},

"priority": {
  "type": "object",
  "properties": {
    "index": { "type": "integer", "minimum": 0, "maximum": 9 },
    "source": { "type": "string", "enum": ["agent", "human"] },
    "rationale": { "type": "string", "minLength": 1 },
    "assignedBy": { "type": "string", "minLength": 1 },
    "assignedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["index", "source", "rationale", "assignedBy", "assignedAt"],
  "additionalProperties": false
},

"priorityOverrideReason": { "type": "string", "minLength": 1 }
```

`required` gains `criticality` and `priority` (replacing the old flat
`criticality`/`priority`/`priorityRationale` entries); `detectability` is
replaced by `detectionDifficulty` in `required`. `priorityOverrideReason`
is **not** in `required` — it is conditionally required via a top-level
`allOf` entry added alongside the schema's existing properties:

```json
{
  "if": {
    "properties": {
      "criticality": { "properties": { "index": { "minimum": 8 } }, "required": ["index"] },
      "priority": { "properties": { "index": { "minimum": 2 } }, "required": ["index"] }
    },
    "required": ["criticality", "priority"]
  },
  "then": {
    "required": ["priorityOverrideReason"]
  }
}
```

### 4.2 `data/schemas/project-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/project-schema.json",
  "title": "Project",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "owner": { "type": "string", "minLength": 1 },
    "repositoryUrl": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "profileRevision": { "type": "integer", "minimum": 1 },
    "profile": {
      "type": "object",
      "properties": {
        "securityLevel": { "type": "string", "enum": ["SVL-0", "SVL-1", "SVL-2", "SVL-3"] },
        "exposure": {
          "type": "array", "minItems": 1,
          "items": { "type": "string", "enum": ["internet_public", "partner_network", "internal_network", "vpn_zero_trust", "local_only", "offline"] }
        },
        "components": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "identities": {
          "type": "array",
          "items": { "type": "string", "enum": ["anonymous", "user", "paid_user", "partner", "operator", "administrator", "super_administrator", "service_account", "machine_identity"] }
        },
        "dataClasses": { "type": "array", "items": { "type": "string", "enum": ["D0", "D1", "D2", "D3"] } },
        "features": {
          "type": "object",
          "properties": {
            "authentication": { "type": "boolean" }, "authorization": { "type": "boolean" },
            "adminInterface": { "type": "boolean" }, "fileUpload": { "type": "boolean" },
            "payment": { "type": "boolean" }, "webhook": { "type": "boolean" },
            "oauth": { "type": "boolean" }, "ai": { "type": "boolean" }
          },
          "additionalProperties": { "type": "boolean" }
        },
        "technologies": {
          "type": "object",
          "properties": {
            "languages": { "type": "array", "items": { "type": "string" } },
            "frameworks": { "type": "array", "items": { "type": "string" } },
            "databases": { "type": "array", "items": { "type": "string" } },
            "cloud": { "type": "array", "items": { "type": "string" } }
          },
          "additionalProperties": false
        }
      },
      "required": ["securityLevel", "exposure", "components", "identities", "dataClasses", "features", "technologies"],
      "additionalProperties": false
    }
  },
  "required": ["projectId", "name", "owner", "createdAt", "profileRevision", "profile"],
  "additionalProperties": false
}
```

`profileRevision` starts at `1` and is incremented (by convention, not
schema-enforced) every time `profile` changes — a process rule, the same
kind Phase 1 already documents for things schema can't express (e.g.
Control versioning). It exists so `AssessmentRun`/`ProjectReport` can
record *which* profile snapshot they were evaluated against, since a
profile legitimately changes over a project's life (e.g. `fileUpload`
flips from `false` to `true`) and which controls were applicable at
review time must stay reconstructible.

`profile` is field-for-field identical to `project-profile-schema.json`
minus its top-level `projectId` (Project already carries one; no
duplication). `project-profile-schema.json` itself is untouched.

### 4.3 `data/schemas/criticality-formula-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/criticality-formula-schema.json",
  "title": "CriticalityFormula",
  "type": "object",
  "properties": {
    "formulaId": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "minLength": 1 },
    "scaleMax": { "const": 9 },
    "directions": {
      "type": "object",
      "properties": {
        "impact": { "const": "higher_is_worse" },
        "exploitability": { "const": "higher_is_worse" },
        "exposure": { "const": "higher_is_worse" },
        "privilegeRequired": { "const": "lower_is_worse" },
        "detectionDifficulty": { "const": "higher_is_worse" }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"],
      "additionalProperties": false
    },
    "ranges": {
      "type": "object",
      "properties": {
        "impact": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 5 } }, "required": ["min", "max"], "additionalProperties": false },
        "exploitability": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 5 } }, "required": ["min", "max"], "additionalProperties": false },
        "exposure": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 3 } }, "required": ["min", "max"], "additionalProperties": false },
        "privilegeRequired": { "type": "object", "properties": { "min": { "const": 0 }, "max": { "const": 2 } }, "required": ["min", "max"], "additionalProperties": false },
        "detectionDifficulty": { "type": "object", "properties": { "min": { "const": 0 }, "max": { "const": 2 } }, "required": ["min", "max"], "additionalProperties": false }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"],
      "additionalProperties": false
    },
    "weights": {
      "type": "object",
      "properties": {
        "impact": { "type": "number", "minimum": 0, "maximum": 1 },
        "exploitability": { "type": "number", "minimum": 0, "maximum": 1 },
        "exposure": { "type": "number", "minimum": 0, "maximum": 1 },
        "privilegeRequired": { "type": "number", "minimum": 0, "maximum": 1 },
        "detectionDifficulty": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"],
      "additionalProperties": false
    },
    "rounding": { "type": "string", "enum": ["round", "floor", "ceil"] }
  },
  "required": ["formulaId", "version", "scaleMax", "directions", "ranges", "weights", "rounding"],
  "additionalProperties": false
}
```

`weights` summing to 1.0 (±0.001) is verified by a test reading
`data/core/criticality-weights.json`, not by the schema.

### 4.4 `data/core/criticality-weights.json` (new reference data)

The default weight configuration (validates against §4.3):
`formulaId: "CRIT-DEFAULT"`, `version: "1.0.0"`, the directions/ranges
table from §3.3, `weights: {impact: 0.35, exploitability: 0.25,
exposure: 0.15, privilegeRequired: 0.15, detectionDifficulty: 0.10}`,
`rounding: "round"`. `Finding.criticality.formulaId`/`formulaVersion`
reference this file's `formulaId`/`version`.

### 4.5 `data/schemas/assessment-plan-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-plan-schema.json",
  "title": "AssessmentPlan",
  "type": "object",
  "properties": {
    "planId": { "type": "string", "minLength": 1 },
    "version": { "type": "integer", "minimum": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "selection": {
      "type": "object",
      "properties": {
        "applicability": { "type": "array", "items": { "type": "string", "enum": ["applicable", "not_applicable", "unknown"] } },
        "assessmentStatuses": { "type": "array", "items": { "type": "string", "enum": ["PASS", "FAIL", "PARTIAL", "N/A", "NOT_TESTED", "ACCEPTED_RISK"] } },
        "domains": { "type": "array", "items": { "type": "string" } },
        "controlIds": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "groupBy": { "type": "string", "enum": ["domain", "subdomain", "layer", "group", "controlId"] },
    "defaultMaxParallelAgents": { "type": "integer", "minimum": 1 },
    "groupOverrides": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "groupValue": { "type": "string", "minLength": 1 },
          "maxParallelAgents": { "type": "integer", "minimum": 1 },
          "skip": { "type": "boolean" }
        },
        "required": ["groupValue"],
        "additionalProperties": false
      }
    },
    "createdAt": { "type": "string", "format": "date-time" }
  },
  "required": ["planId", "version", "projectId", "groupBy", "defaultMaxParallelAgents", "createdAt"],
  "additionalProperties": false
}
```

`selection` is optional and every one of its fields is optional — an
absent/empty `selection` means "all applicable controls," matching the
original (pre-review) default behavior exactly; it only narrows scope
when populated (e.g. `assessmentStatuses: ["FAIL", "PARTIAL"]` for a
re-test-only run). `version` lets an `AssessmentRun` record exactly which
revision of a plan's policy (e.g. its `defaultMaxParallelAgents` at the
time) produced it, the same reproducibility argument as
`Project.profileRevision`.

`groupBy: "controlId"` is how "one agent per individual control" is
expressed — no separate flag needed. The enum stays at these 5 values
for this phase (not e.g. `threat`/`verificationMethod`/`technology` —
plausible future groupings the review raised); nothing here prevents
adding enum values later, and the grouping mechanism's *consumer* (the
future MCP tool that expands a Plan into batches) should be written
generically enough not to hardcode assumptions about which 5 values
exist — but that is an implementation note for a future phase, not a
schema change now.

### 4.6 `data/schemas/assessment-run-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-run-schema.json",
  "title": "AssessmentRun",
  "type": "object",
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "planId": { "type": "string", "minLength": 1 },
    "planVersion": { "type": "integer", "minimum": 1 },
    "profileRevision": { "type": "integer", "minimum": 1 },
    "catalogVersion": { "type": "string", "minLength": 1 },
    "batchIds": { "type": "array", "items": { "type": "string" } },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed", "partial"] },
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" }
  },
  "required": ["runId", "projectId", "planId", "planVersion", "profileRevision", "catalogVersion", "batchIds", "status"],
  "additionalProperties": false
}
```

This is the entity the original draft was missing: `AssessmentPlan` is a
reusable *policy* ("how do we group and size work"); `AssessmentRun` is
one *execution* of that policy against a project at a point in time,
owning the set of `AssessmentBatch`es it produced. Without it there is no
way to answer "what % of this run is done," "show me only this run's
findings," "compare this run to the last one," or "which catalog/profile
snapshot was this run evaluated against" — all needed once an MCP server
actually orchestrates agents. `status: "partial"` covers a run where some
batches completed and others failed (distinct from `"failed"`, where the
run itself could not proceed).

### 4.7 `data/schemas/assessment-batch-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-batch-schema.json",
  "title": "AssessmentBatch",
  "type": "object",
  "properties": {
    "batchId": { "type": "string", "minLength": 1 },
    "runId": { "type": "string", "minLength": 1 },
    "planId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "groupBy": { "type": "string", "enum": ["domain", "subdomain", "layer", "group", "controlId"] },
    "groupValue": { "type": "string", "minLength": 1 },
    "controlIds": { "type": "array", "minItems": 1, "items": { "type": "string" } },
    "assignedAgent": { "type": ["string", "null"] },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" },
    "resultingAssessmentIds": { "type": "array", "items": { "type": "string" } },
    "resultingFindingIds": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["batchId", "runId", "planId", "projectId", "groupBy", "groupValue", "controlIds", "status", "resultingAssessmentIds", "resultingFindingIds"],
  "additionalProperties": false
}
```

Only change from the original draft: `runId` (required) — every batch now
belongs to exactly one run.

### 4.8 `data/schemas/score-model-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/score-model-schema.json",
  "title": "ScoreModel",
  "type": "object",
  "properties": {
    "modelId": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "minLength": 1 },
    "statusWeights": {
      "type": "object",
      "properties": {
        "PASS": { "type": "number", "minimum": 0, "maximum": 1 },
        "PARTIAL": { "type": "number", "minimum": 0, "maximum": 1 },
        "FAIL": { "type": "number", "minimum": 0, "maximum": 1 },
        "NOT_TESTED": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["PASS", "PARTIAL", "FAIL", "NOT_TESTED"],
      "additionalProperties": false
    },
    "excludedStatuses": {
      "type": "array",
      "items": { "type": "string", "enum": ["N/A", "ACCEPTED_RISK"] }
    },
    "description": { "type": "string", "minLength": 1 }
  },
  "required": ["modelId", "version", "statusWeights", "excludedStatuses", "description"],
  "additionalProperties": false
}
```

Mirrors `CriticalityFormula`'s reasoning: the review pointed out Score
needs the same "what formula, what version" provenance as Criticality,
for the same reproducibility reason. `excludedStatuses` documents that
`N/A` and `ACCEPTED_RISK` assessments are removed from both the numerator
and denominator entirely (they are neither a pass nor a gap), while
`NOT_TESTED` stays in the denominator (weight 0) specifically so it drags
`overallScore` down rather than being invisible — the exact failure mode
the review's "PASS=3, NOT_TESTED=97 → score 100" example describes.

### 4.9 `data/core/scoring-model.json` (new reference data)

```json
{
  "modelId": "USSVS-SCORE-DEFAULT",
  "version": "1.0.0",
  "statusWeights": { "PASS": 1.0, "PARTIAL": 0.5, "FAIL": 0, "NOT_TESTED": 0 },
  "excludedStatuses": ["N/A", "ACCEPTED_RISK"],
  "description": "overallScore = 100 * sum(statusWeights[status] for each non-excluded applicable ControlAssessment) / count(non-excluded applicable ControlAssessments). coveragePercent = assessedControls / applicableControls * 100, where assessedControls counts everything except NOT_TESTED (N/A and ACCEPTED_RISK are excluded from applicableControls entirely, matching excludedStatuses)."
}
```

Deliberately simple for this phase: a flat per-status weight, no
per-domain or per-severity weighting yet. Computing an actual `Score`
from real `ControlAssessment` data is out of scope here regardless (§5)
— this file only has to be precise enough that a future implementation
has one unambiguous formula to follow.

### 4.10 `data/schemas/score-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/score-schema.json",
  "title": "Score",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
    "coverage": {
      "type": "object",
      "properties": {
        "applicableControls": { "type": "integer", "minimum": 0 },
        "assessedControls": { "type": "integer", "minimum": 0 },
        "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 }
      },
      "required": ["applicableControls", "assessedControls", "coveragePercent"],
      "additionalProperties": false
    },
    "scoreModel": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "version": { "type": "string", "minLength": 1 }
      },
      "required": ["id", "version"],
      "additionalProperties": false
    },
    "domainScores": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "domain": { "type": "string", "minLength": 1 },
          "score": { "type": "number", "minimum": 0, "maximum": 100 },
          "totalControls": { "type": "integer", "minimum": 0 },
          "applicableControls": { "type": "integer", "minimum": 0 },
          "assessedControls": { "type": "integer", "minimum": 0 },
          "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 },
          "passCount": { "type": "integer", "minimum": 0 },
          "failCount": { "type": "integer", "minimum": 0 },
          "partialCount": { "type": "integer", "minimum": 0 },
          "notTestedCount": { "type": "integer", "minimum": 0 },
          "notApplicableCount": { "type": "integer", "minimum": 0 },
          "acceptedRiskCount": { "type": "integer", "minimum": 0 },
          "criticalFindings": { "type": "integer", "minimum": 0 },
          "highFindings": { "type": "integer", "minimum": 0 }
        },
        "required": ["domain", "score", "totalControls", "applicableControls", "assessedControls", "coveragePercent", "passCount", "failCount", "partialCount", "notTestedCount", "notApplicableCount", "acceptedRiskCount", "criticalFindings", "highFindings"],
        "additionalProperties": false
      }
    },
    "computedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["projectId", "overallScore", "coverage", "scoreModel", "domainScores", "computedAt"],
  "additionalProperties": false
}
```

Two changes from the original draft, both from the review: (1) top-level
`coverage`, so `overallScore` can never be read without also seeing how
much of the catalog it's actually based on; (2) `domainScores[]` now
breaks out all 6 `ControlAssessment` statuses (`passCount`/`failCount`/
`partialCount`/`notTestedCount`/`notApplicableCount`/`acceptedRiskCount`)
plus `totalControls`/`applicableControls`/`assessedControls`/
`coveragePercent` per domain — the original draft's `naCount` conflated
`N/A` and `NOT_TESTED`, which is exactly the ambiguity that let a score
look complete when it wasn't.

**Not adopted from the review:** folding Finding-level risk (open
critical/high findings, P0/P1 counts) into the same numeric formula as
`overallScore`. `domainScores[].criticalFindings`/`highFindings` already
exist as separate counts, not blended into the score — so the review's
concern ("don't double-count a failure via both the control score and
the finding severity") was already satisfied by the original structure.
No schema change was needed for this point, just stating the principle
explicitly here.

### 4.11 `data/schemas/project-report-schema.json` (new)

Embeds `Score` (§4.10, minus its own `projectId`/`computedAt` — redundant
with the report's own) and `ReleaseEvaluation` (Phase 1, unchanged)
inline — self-contained, no cross-file `$ref`, matching the Phase 1
convention.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/project-report-schema.json",
  "title": "ProjectReport",
  "type": "object",
  "properties": {
    "reportId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "assessmentRunId": { "type": "string", "minLength": 1 },
    "catalogVersion": { "type": "string", "minLength": 1 },
    "profileRevision": { "type": "integer", "minimum": 1 },
    "criticalityFormula": {
      "type": "object",
      "properties": { "id": { "type": "string", "minLength": 1 }, "version": { "type": "string", "minLength": 1 } },
      "required": ["id", "version"], "additionalProperties": false
    },
    "generatedAt": { "type": "string", "format": "date-time" },
    "score": {
      "type": "object",
      "properties": {
        "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
        "coverage": {
          "type": "object",
          "properties": {
            "applicableControls": { "type": "integer", "minimum": 0 },
            "assessedControls": { "type": "integer", "minimum": 0 },
            "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 }
          },
          "required": ["applicableControls", "assessedControls", "coveragePercent"],
          "additionalProperties": false
        },
        "scoreModel": {
          "type": "object",
          "properties": { "id": { "type": "string", "minLength": 1 }, "version": { "type": "string", "minLength": 1 } },
          "required": ["id", "version"], "additionalProperties": false
        },
        "domainScores": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "domain": { "type": "string", "minLength": 1 },
              "score": { "type": "number", "minimum": 0, "maximum": 100 },
              "totalControls": { "type": "integer", "minimum": 0 },
              "applicableControls": { "type": "integer", "minimum": 0 },
              "assessedControls": { "type": "integer", "minimum": 0 },
              "coveragePercent": { "type": "number", "minimum": 0, "maximum": 100 },
              "passCount": { "type": "integer", "minimum": 0 },
              "failCount": { "type": "integer", "minimum": 0 },
              "partialCount": { "type": "integer", "minimum": 0 },
              "notTestedCount": { "type": "integer", "minimum": 0 },
              "notApplicableCount": { "type": "integer", "minimum": 0 },
              "acceptedRiskCount": { "type": "integer", "minimum": 0 },
              "criticalFindings": { "type": "integer", "minimum": 0 },
              "highFindings": { "type": "integer", "minimum": 0 }
            },
            "required": ["domain", "score", "totalControls", "applicableControls", "assessedControls", "coveragePercent", "passCount", "failCount", "partialCount", "notTestedCount", "notApplicableCount", "acceptedRiskCount", "criticalFindings", "highFindings"],
            "additionalProperties": false
          }
        }
      },
      "required": ["overallScore", "coverage", "scoreModel", "domainScores"],
      "additionalProperties": false
    },
    "prioritizedFindings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "findingId": { "type": "string", "minLength": 1 },
          "priorityIndex": { "type": "integer", "minimum": 0, "maximum": 9 },
          "criticalityIndex": { "type": "integer", "minimum": 0, "maximum": 9 },
          "title": { "type": "string", "minLength": 1 }
        },
        "required": ["findingId", "priorityIndex", "criticalityIndex", "title"],
        "additionalProperties": false
      }
    },
    "releaseEvaluation": {
      "type": "object",
      "properties": {
        "gate": { "type": "integer", "minimum": 0, "maximum": 4 },
        "controlCoverage": { "type": "number", "minimum": 0, "maximum": 100 },
        "criticalFindings": { "type": "integer", "minimum": 0 },
        "highFindings": { "type": "integer", "minimum": 0 },
        "unblockedCriticalAttackPaths": { "type": "integer", "minimum": 0 },
        "residualRisksAccepted": { "type": "integer", "minimum": 0 },
        "incidentResponseVerified": { "type": "boolean" },
        "backupRestoreVerified": { "type": "boolean" },
        "result": { "type": "string", "enum": ["approved", "blocked"] }
      },
      "required": ["gate", "controlCoverage", "criticalFindings", "highFindings", "unblockedCriticalAttackPaths", "residualRisksAccepted", "incidentResponseVerified", "backupRestoreVerified", "result"],
      "additionalProperties": false
    },
    "summary": { "type": "string", "minLength": 1 }
  },
  "required": ["reportId", "projectId", "assessmentRunId", "catalogVersion", "profileRevision", "criticalityFormula", "generatedAt", "score", "prioritizedFindings", "releaseEvaluation", "summary"],
  "additionalProperties": false
}
```

Changes from the original draft, all from the review: `assessmentRunId`,
`catalogVersion`, `profileRevision`, and `criticalityFormula` are now
required — together with `score.scoreModel` (already inside the embedded
`score` object), this is enough to answer "what exact catalog, profile,
scoring formula, and criticality formula produced this report" years
later, which is the actual definition of "immutable, reproducible
snapshot." `prioritizedFindings` items are renamed `priorityIndex`/
`criticalityIndex` (from bare `priority`/`criticality`) so the preview's
field names don't collide with `Finding`'s now-object-shaped
`priority`/`criticality` — the preview intentionally stays flat/lightweight
(just the two index numbers), it does not mirror the full object.

**Not adopted from the review:** a separate `releaseEvaluationId` +
snapshot-pointer split (keeping the plain embedded object, as originally
designed) — the review itself called this "a bit much for now" and
recommended starting with embedding, which is what both the original
draft and this revision do. Also not adopted: a standalone
`releasePolicyVersion` field — `catalogVersion` already covers this,
since `process/release-gates.json` (Phase 1) is part of the same
versioned catalog; a second, separately-tracked version number for the
same underlying file would be redundant.

`prioritizedFindings` MUST be sorted `priorityIndex` ascending, then
`criticalityIndex` descending, then `findingId` ascending for any
remaining ties — a data invariant verified by a test (not expressible in
JSON Schema, same pattern as §3.3's weight-sum invariant).

## 5. Out of Scope for This Phase

- Any MCP server tool implementation (`assessment.generate_plan`,
  `run.start`, `batch.dispatch`, `score.compute`, `report.generate`, etc.).
- Actually computing `criticality.index` from the formula, or `Score`
  from `ControlAssessment`/`Finding` data — this phase only defines the
  schemas and the formula's documented specification.
- Populating example `Project`/`AssessmentPlan`/`AssessmentRun`/
  `AssessmentBatch`/`Score`/`ProjectReport` instances beyond
  schema-validation test fixtures.
- The remaining Phase 1 follow-up work (7 more control domains) —
  unaffected, can proceed independently.
- Extending `groupBy`'s enum beyond the 5 current values, or building a
  generic/pluggable grouping engine — noted as a future direction in
  §4.5, not built now.

## 6. Open Items for the Implementation Plan

- Order of authoring: `finding-schema.json` modification (rename +
  P/C restructure + guardrail) and `criticality-formula-schema.json` +
  `core/criticality-weights.json` are tightly coupled (the formula's
  field directions must match Finding's existing fields, now including
  the `detectionDifficulty` rename) — author together first.
- `project-schema.json` has no dependency on the P/C work and can be
  authored independently/in parallel.
- `assessment-plan-schema.json`, `assessment-run-schema.json`, and
  `assessment-batch-schema.json` are tightly coupled (run instantiates
  from a plan; batch belongs to a run) — author together, in that order.
- `score-model-schema.json` + `core/scoring-model.json` should land
  before `score-schema.json` (Score references `scoreModel.id`/`version`
  conceptually, though not via schema `$ref`), which should land before
  `project-report-schema.json` (report embeds an inline copy of Score's
  shape).

## 7. Summary of Design Principles (carried over + reinforced by review)

- Catalog (Control) vs. project state (ControlAssessment) stays separate
  — unaffected by this phase, still holds.
- Deterministic values (`criticality`) are never agent-set; judgment
  values (`priority`) always carry a rationale. The two must never be
  interchangeable inputs, even though they're both 0-9 integers.
- Every computed/tunable value (criticality formula, score model) carries
  an explicit id+version, recorded wherever it's used, so results are
  reproducible after the formula changes.
- A score is meaningless without its coverage; the two are always
  reported together, never coverage-implied-complete.
- `ProjectReport` is a point-in-time immutable snapshot, not a live view
  — it pins every version/revision that could have affected its content.

## 8. External Review — Adoption Log

An external review (via a second LLM, prompted with this design's
decisions) raised 20 points. Disposition of each, condensed:

**Adopted:** `Project.profileRevision`; `AssessmentRun` entity (Plan → Run
→ Batch[]); `AssessmentPlan.selection` (separate from `groupBy`);
`AssessmentPlan.version`; `priority`/`criticality` restructured as
provenance-carrying objects; `priorityOverrideReason` guardrail
(if/then: criticality.index>=8 AND priority.index>=2); `detectability`
→ `detectionDifficulty` rename; `Score.coverage`; `domainScores[]` full
6-status breakout; `ScoreModel` schema + `core/scoring-model.json`;
`ProjectReport` provenance fields (`assessmentRunId`, `catalogVersion`,
`profileRevision`, `criticalityFormula`); `findingId` as a 3rd sort
tie-breaker; `priorityIndex`/`criticalityIndex` naming in the report
preview.

**Not adopted, with reasons (see inline notes in §3.2, §4.5, §4.10,
§4.11 for each):** `priority.confidence` float (no defined consumer);
expanding `groupBy`'s enum now (current 5 values sufficient, noted as a
future direction only); `releaseEvaluationId`+snapshot-pointer split
(reviewer itself called this premature); standalone `releasePolicyVersion`
(redundant with `catalogVersion`); folding Finding risk into the Score
formula (already not happening in the original design — no change needed).
