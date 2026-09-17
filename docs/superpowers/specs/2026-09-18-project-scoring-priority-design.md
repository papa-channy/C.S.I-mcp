# Project Scoring, Priority Mapping & Agent Workflow — Data Foundation Design

Date: 2026-09-18
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
4. A **hierarchical Score** (overall + per-domain) for a project.
5. A **ProjectReport** that ties score, prioritized findings, and the
   existing `ReleaseEvaluation` together into one deliverable.

Explicitly out of scope for this phase (per the same reasoning as Phase
1's spec §12): the actual MCP server tool implementations that generate
`AssessmentBatch` records, dispatch agents, or compute `Score`/`C` values
at runtime. This spec defines the data contracts those tools will read
and write; it does not implement them. Populating more control domains
(the Phase 1 follow-up work) is also unaffected and unblocked by this
phase — the two workstreams are independent.

## 2. Entity Overview

```
Project
 └─ profile: ProjectProfile (trimmed — no projectId, Project already has one)

AssessmentPlan                         "how to group, how many agents per group"
 └─ groupBy: domain | subdomain | layer | group | controlId
 └─ defaultMaxParallelAgents, groupOverrides[]

AssessmentBatch                        "one agent's actual unit of work"
 └─ controlIds[], assignedAgent, status, resultingAssessmentIds[], resultingFindingIds[]

Finding (existing schema, extended)
 └─ criticality (C, 0-9)   — formula-derived from the 5 existing severity sub-scores
 └─ priority (P, 0-9)      — agent judgment
 └─ priorityRationale       — required justification text

CriticalityFormula (new schema) + core/criticality-weights.json (new data)
 └─ defines how the 5 existing Finding sub-scores combine into C, with
    customizable weights

Score
 └─ overallScore (0-100) + domainScores[] (per-domain breakdown)

ProjectReport                          the final deliverable
 └─ score: Score
 └─ prioritizedFindings[]: {findingId, priority, criticality, title} — P asc, C desc
 └─ releaseEvaluation: ReleaseEvaluation (existing schema, embedded)
 └─ summary: narrative string
```

`groupBy` reuses fields that already exist on every `Control` record
(`domain`, `subdomain`, `layer`, `group` — all added in Phase 1's
`control-schema.json`), so no new taxonomy is needed to support arbitrary
grouping granularity, including `controlId` (one control = one agent).

## 3. The P/C Dual Index

### 3.1 Ordering semantics

`P` (Priority, 0-9) is the **primary** sort key: lower P is more urgent,
and P dominates C in ordering. `P0C9` is addressed before `P1C0`,
regardless of C, because P is compared first. Within the same P tier,
higher C (more severe) is addressed first — C is the secondary/tie-break
key. This reflects the user's own worked examples: P0-anything outranks
P1-anything; C alone never overrides a P difference.

### 3.2 Priority (P): agent judgment, not a formula

P is set directly by the reporting agent's judgment — it is **not**
computed from C or any other field by a fixed formula, because business
context (a compliance deadline, an active incident, a contractual
obligation) can make a low-C finding more urgent than a high-C one. Every
`Finding` therefore carries:

- `priority` (integer 0-9, required)
- `priorityRationale` (non-empty string, required) — the agent must state
  why it chose this P value. This mirrors the precedent already set by
  `ControlAssessment.applicability`'s `manual_override` + `reason` pair:
  an agent-set value is always accompanied by a written justification.

No auto/override split is needed here (unlike `ControlAssessment`)
because there is no separate "automatic" computation to override — the
agent's judgment *is* the value, from the start.

### 3.3 Criticality (C): formula-derived from existing severity fields

`Finding` already carries five severity sub-scores from Phase 1
(§67-68 of the USSVS source): `impact` (1-5), `exploitability` (1-5),
`exposure` (1-3), `privilegeRequired` (0-2), `detectability` (0-2). `C`
consolidates these into one comparable 0-9 index, computed deterministically
so that every agent's C values are consistent with each other.

**Direction of each field** (clarified now — Phase 1's schema left this
implicit):

| Field | Range | Worse end |
|---|---|---|
| impact | 1-5 | higher |
| exploitability | 1-5 | higher |
| exposure | 1-3 | higher |
| privilegeRequired | 0-2 | **lower** (0 = no privilege needed = most dangerous) |
| detectability | 0-2 | higher (2 = hard to detect = most dangerous) |

**Formula:** normalize each field to `[0,1]` (inverting `privilegeRequired`
since its worse end is low), take a weighted sum, scale to `[0,9]`, round:

```
normImpact      = (impact - 1) / 4
normExploit     = (exploitability - 1) / 4
normExposure    = (exposure - 1) / 2
normPrivilege   = (2 - privilegeRequired) / 2
normDetect      = detectability / 2

C_raw = w.impact*normImpact + w.exploitability*normExploit
      + w.exposure*normExposure + w.privilegeRequired*normPrivilege
      + w.detectability*normDetect

C = round(C_raw * 9)     // integer 0-9
```

The weights (`w.*`) are **not hardcoded** — they live in a separate,
schema-validated reference data file (`data/core/criticality-weights.json`,
validated against `data/schemas/criticality-formula-schema.json`), so they
can be tuned without touching any schema or code. Default weights:
`impact 0.35, exploitability 0.25, exposure 0.15, privilegeRequired 0.15,
detectability 0.10` (sums to 1.00).

The weights summing to 1.0 is a **data invariant enforced by a test**, not
by JSON Schema itself (JSON Schema has no native "sum of these properties
equals X" keyword) — consistent with how Phase 1 already handles
constraints schema can't express (e.g. `manifest.controls.count` matching
reality).

This formula computation is itself out of scope for this phase (no code
yet) — this spec only defines the schema for the weights file and documents
the formula so a future MCP server implements it consistently.

## 4. Schema Changes

### 4.1 `data/schemas/finding-schema.json` (modify existing)

Add three properties, all added to the `required` array:

```json
"criticality": { "type": "integer", "minimum": 0, "maximum": 9 },
"priority": { "type": "integer", "minimum": 0, "maximum": 9 },
"priorityRationale": { "type": "string", "minLength": 1 }
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
  "required": ["projectId", "name", "owner", "createdAt", "profile"],
  "additionalProperties": false
}
```

Note: `profile` is field-for-field identical to `project-profile-schema.json`
minus its top-level `projectId` (Project already carries one; no duplication).
`project-profile-schema.json` itself is untouched — it remains valid
standalone (e.g. for a future tool that profiles a project before a
`Project` record exists yet).

### 4.3 `data/schemas/criticality-formula-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/criticality-formula-schema.json",
  "title": "CriticalityFormula",
  "type": "object",
  "properties": {
    "version": { "type": "string", "minLength": 1 },
    "scaleMax": { "const": 9 },
    "directions": {
      "type": "object",
      "properties": {
        "impact": { "const": "higher_is_worse" },
        "exploitability": { "const": "higher_is_worse" },
        "exposure": { "const": "higher_is_worse" },
        "privilegeRequired": { "const": "lower_is_worse" },
        "detectability": { "const": "higher_is_worse" }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectability"],
      "additionalProperties": false
    },
    "ranges": {
      "type": "object",
      "properties": {
        "impact": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 5 } }, "required": ["min", "max"], "additionalProperties": false },
        "exploitability": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 5 } }, "required": ["min", "max"], "additionalProperties": false },
        "exposure": { "type": "object", "properties": { "min": { "const": 1 }, "max": { "const": 3 } }, "required": ["min", "max"], "additionalProperties": false },
        "privilegeRequired": { "type": "object", "properties": { "min": { "const": 0 }, "max": { "const": 2 } }, "required": ["min", "max"], "additionalProperties": false },
        "detectability": { "type": "object", "properties": { "min": { "const": 0 }, "max": { "const": 2 } }, "required": ["min", "max"], "additionalProperties": false }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectability"],
      "additionalProperties": false
    },
    "weights": {
      "type": "object",
      "properties": {
        "impact": { "type": "number", "minimum": 0, "maximum": 1 },
        "exploitability": { "type": "number", "minimum": 0, "maximum": 1 },
        "exposure": { "type": "number", "minimum": 0, "maximum": 1 },
        "privilegeRequired": { "type": "number", "minimum": 0, "maximum": 1 },
        "detectability": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["impact", "exploitability", "exposure", "privilegeRequired", "detectability"],
      "additionalProperties": false
    },
    "rounding": { "type": "string", "enum": ["round", "floor", "ceil"] }
  },
  "required": ["version", "scaleMax", "directions", "ranges", "weights", "rounding"],
  "additionalProperties": false
}
```

`weights` summing to 1.0 (±0.001) is verified by a test reading
`data/core/criticality-weights.json`, not by the schema.

### 4.4 `data/core/criticality-weights.json` (new reference data)

The default weight configuration (validates against 4.3):
`version: "1.0.0"`, the directions/ranges table from §3.3, `weights:
{impact: 0.35, exploitability: 0.25, exposure: 0.15, privilegeRequired:
0.15, detectability: 0.10}`, `rounding: "round"`.

### 4.5 `data/schemas/assessment-plan-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-plan-schema.json",
  "title": "AssessmentPlan",
  "type": "object",
  "properties": {
    "planId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
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
  "required": ["planId", "projectId", "groupBy", "defaultMaxParallelAgents", "createdAt"],
  "additionalProperties": false
}
```

`groupBy: "controlId"` is how "one agent per individual control" is
expressed — no separate flag needed, it is just the finest-grained value
of the same dimension selector.

### 4.6 `data/schemas/assessment-batch-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/assessment-batch-schema.json",
  "title": "AssessmentBatch",
  "type": "object",
  "properties": {
    "batchId": { "type": "string", "minLength": 1 },
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
  "required": ["batchId", "planId", "projectId", "groupBy", "groupValue", "controlIds", "status", "resultingAssessmentIds", "resultingFindingIds"],
  "additionalProperties": false
}
```

### 4.7 `data/schemas/score-schema.json` (new)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/score-schema.json",
  "title": "Score",
  "type": "object",
  "properties": {
    "projectId": { "type": "string", "minLength": 1 },
    "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
    "domainScores": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "domain": { "type": "string", "minLength": 1 },
          "score": { "type": "number", "minimum": 0, "maximum": 100 },
          "controlCount": { "type": "integer", "minimum": 0 },
          "passCount": { "type": "integer", "minimum": 0 },
          "failCount": { "type": "integer", "minimum": 0 },
          "naCount": { "type": "integer", "minimum": 0 },
          "criticalFindings": { "type": "integer", "minimum": 0 },
          "highFindings": { "type": "integer", "minimum": 0 }
        },
        "required": ["domain", "score", "controlCount", "passCount", "failCount", "naCount", "criticalFindings", "highFindings"],
        "additionalProperties": false
      }
    },
    "computedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["projectId", "overallScore", "domainScores", "computedAt"],
  "additionalProperties": false
}
```

### 4.8 `data/schemas/project-report-schema.json` (new)

Embeds `Score` (§4.7) and `ReleaseEvaluation` (Phase 1, unchanged) inline
— self-contained, no cross-file `$ref`, matching the Phase 1 convention.
The embedded `score` object omits `projectId` and `computedAt` (present
on the standalone `Score` entity in §4.7): both would be redundant with
`ProjectReport`'s own `projectId` and `generatedAt`. `Score` still exists
as its own schema/entity for a lighter-weight future use case — e.g. a
"what's my current score" query that doesn't need a full report.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://csi-mcp.dev/schemas/project-report-schema.json",
  "title": "ProjectReport",
  "type": "object",
  "properties": {
    "reportId": { "type": "string", "minLength": 1 },
    "projectId": { "type": "string", "minLength": 1 },
    "generatedAt": { "type": "string", "format": "date-time" },
    "score": {
      "type": "object",
      "properties": {
        "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
        "domainScores": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "domain": { "type": "string", "minLength": 1 },
              "score": { "type": "number", "minimum": 0, "maximum": 100 },
              "controlCount": { "type": "integer", "minimum": 0 },
              "passCount": { "type": "integer", "minimum": 0 },
              "failCount": { "type": "integer", "minimum": 0 },
              "naCount": { "type": "integer", "minimum": 0 },
              "criticalFindings": { "type": "integer", "minimum": 0 },
              "highFindings": { "type": "integer", "minimum": 0 }
            },
            "required": ["domain", "score", "controlCount", "passCount", "failCount", "naCount", "criticalFindings", "highFindings"],
            "additionalProperties": false
          }
        }
      },
      "required": ["overallScore", "domainScores"],
      "additionalProperties": false
    },
    "prioritizedFindings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "findingId": { "type": "string", "minLength": 1 },
          "priority": { "type": "integer", "minimum": 0, "maximum": 9 },
          "criticality": { "type": "integer", "minimum": 0, "maximum": 9 },
          "title": { "type": "string", "minLength": 1 }
        },
        "required": ["findingId", "priority", "criticality", "title"],
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
  "required": ["reportId", "projectId", "generatedAt", "score", "prioritizedFindings", "releaseEvaluation", "summary"],
  "additionalProperties": false
}
```

`prioritizedFindings` MUST be sorted P ascending, then C descending
within equal P — a data invariant verified by a test (not expressible in
JSON Schema, same pattern as §3.3's weight-sum invariant).

## 5. Out of Scope for This Phase

- Any MCP server tool implementation (`assessment.generate_plan`,
  `batch.dispatch`, `score.compute`, `report.generate`, etc.).
- Actually computing `C` from the formula, or `Score` from
  `ControlAssessment`/`Finding` data — this phase only defines the schemas
  and the formula's documented specification.
- Populating example `Project`/`AssessmentPlan`/`AssessmentBatch`/
  `Score`/`ProjectReport` instances beyond schema-validation test fixtures.
- The remaining Phase 1 follow-up work (7 more control domains) —
  unaffected, can proceed independently.

## 6. Open Items for the Implementation Plan

- Order of authoring: `finding-schema.json` modification and
  `criticality-formula-schema.json` + `core/criticality-weights.json`
  are tightly coupled (the formula's field directions must match
  Finding's existing fields) — author together first.
- `project-schema.json` has no dependency on the P/C work and can be
  authored independently/in parallel.
- `assessment-plan-schema.json` and `assessment-batch-schema.json` are
  tightly coupled (batch instantiates from a plan) — author together.
- `score-schema.json` should land before `project-report-schema.json`
  (report embeds an inline copy of Score's shape).
