# Security Check MCP — Data Foundation Design

Date: 2026-09-16
Status: Approved for implementation planning

## 1. Context and Goal

We are building a "Security Check MCP" (C.S.I-mcp) whose first phase is a
JSON-based reference/schema foundation derived from a source document,
the **Universal Software Security Verification Standard (USSVS) v2.0**
(86 sections covering principles, security profiles, ~47 control domains,
schemas, and release-gate process). The source document is pasted in full
in this project's originating conversation; it is not currently checked
into the repo as a separate file.

Phase 1 goal (this spec): produce the JSON data foundation that an MCP
tool will use to:

1. Classify a project (Project Profile) and evaluate which Controls apply.
2. Generate and track a per-project Control Matrix (checklist) with
   PASS/FAIL/PARTIAL/N/A/NOT_TESTED/ACCEPTED_RISK states.
3. Record Findings and Attack Paths tied to Controls.
4. Evaluate Release Gate status.

Phase 2 (future, out of scope here): migrate this JSON foundation into a
`.db` (SQLite) file, split into a static catalog DB and a dynamic
per-project state DB, once content maturity is high enough.

This design was reviewed once via an external LLM consultation (ChatGPT)
requested by the user; the structural feedback from that review is
incorporated throughout this document.

## 2. Core Architectural Principle: Catalog vs. Assessment

The single most important design decision: **the Control catalog (static,
versioned reference data) is strictly separate from Control Assessment
(dynamic, per-project state).**

- A `Control` record never contains a `status` field like `PASS`/`FAIL`.
  It only defines what is required, how to verify it, and when it applies.
- A `ControlAssessment` record is the actual row of a project's Control
  Matrix: it references a `controlId` + `controlVersion`, and carries
  `applicability`, `status`, `evidenceIds`, `findingIds`,
  `riskAcceptanceId`, `assessedBy`, `assessedAt`.

This separation is what makes the catalog reusable across unlimited
projects, and what allows the catalog to evolve (new control versions)
without silently rewriting the meaning of a past project's PASS result.

## 3. Versioning Policy

- The catalog as a whole carries a `catalogVersion` (semver), recorded in
  `manifest.json`.
- Every individual `Control` carries its own `version` (integer,
  incrementing on any requirement change) and a lifecycle `status`:
  `draft | active | deprecated | retired`. A deprecated control may set
  `replacedBy: "<controlId>"`.
- Every `ControlAssessment` pins the `controlVersion` it was evaluated
  against, so historical assessments remain reproducible even after the
  catalog updates.

## 4. Applicability Model

Applicability is **not** a free-text tag list. It is a declarative rule
tree evaluated against a project's `ProjectProfile`, and it resolves to a
**three-valued result**: `APPLICABLE | NOT_APPLICABLE | UNKNOWN`. Missing
profile information must resolve to `UNKNOWN`, never silently to
`NOT_APPLICABLE` — a human or agent must confirm before a control can be
marked N/A for lack of information.

Rule DSL shape (stored as a JSON tree, evaluated by MCP code, not by a
database engine):

```json
{
  "applicability": {
    "when": {
      "all": [
        { "fact": "identity.hasPrivilegedAccounts", "operator": "eq", "value": true }
      ]
    }
  }
}
```

Supported combinators: `all` (AND), `any` (OR), nested indefinitely.
Supported operators: `eq`, `ne`, `in`, `not_in`, `contains`,
`intersects`, `gt`, `gte`, `lt`, `lte`.

Fact precedence when authoring rules (stronger, more stable signals
first): **Capability/Architecture → Data → Exposure → Identity →
Technology**. E.g. prefer `components.contains("browser_frontend")` and
`features.dynamicHtml == true` over `technologies.frameworks.contains
("react")` for an XSS control — a Java backend that renders HTML still
needs the control; a Node.js API-only backend does not.

A `ControlAssessment.applicability` records both the automatic result and
any manual override:

```json
{
  "applicability": {
    "autoResult": "applicable",
    "finalResult": "not_applicable",
    "matchedRules": ["identity.hasPrivilegedAccounts=true"],
    "source": "manual_override",
    "reason": "Authentication is fully delegated to an external IdP."
  }
}
```

## 5. Project Profile

`ProjectProfile` is the first-class entity the Applicability Engine reads.
Values for `components`, `identities`, `dataClasses`, and
`technologies.*` should draw from small controlled vocabularies
(`catalogs/*.json`) rather than free text, to keep rule matching reliable
— but the initial vocabularies stay minimal; they grow as real projects
are profiled.

```json
{
  "projectId": "proj-001",
  "securityLevel": "SVL-2",
  "exposure": ["internet_public"],
  "components": ["browser_frontend", "backend_api", "database"],
  "identities": ["anonymous", "user", "administrator"],
  "dataClasses": ["D1", "D2"],
  "features": {
    "authentication": true,
    "authorization": true,
    "adminInterface": true,
    "fileUpload": false,
    "payment": false,
    "webhook": true,
    "oauth": true,
    "ai": false
  },
  "technologies": {
    "languages": ["typescript"],
    "frameworks": ["nextjs", "nestjs"],
    "databases": ["postgresql"],
    "cloud": ["aws"]
  }
}
```

## 6. Control Record Shape

Canonical fields for every entry in `controls/*.json` (source: USSVS §11,
§13, §14, §81, expanded per review):

```json
{
  "controlId": "IAM-AUTH-005",
  "version": 1,
  "status": "active",
  "title": "Privileged MFA",
  "group": "identity_access",
  "domain": "authentication",
  "subdomain": "privileged_authentication",
  "layer": "prevent",
  "requirement": "Privileged accounts must use multi-factor authentication.",
  "rationale": "A compromised password alone must not grant privileged access.",
  "threatIds": ["THR-IAM-ACCOUNT-TAKEOVER"],
  "applicability": { "when": { "all": [] } },
  "baselineRisk": { "severity": "high" },
  "assurance": {
    "SVL-1": ["config_review"],
    "SVL-2": ["config_review", "manual_test"],
    "SVL-3": ["config_review", "manual_test", "adversarial_test"]
  },
  "verification": {
    "methods": [
      {
        "type": "manual_test",
        "procedure": "Attempt privileged login without a second factor.",
        "requiredEvidenceTypes": ["MANUAL_TEST"],
        "minimumSvl": "SVL-2",
        "automatable": false
      }
    ]
  },
  "passCriteria": [
    "Privileged accounts cannot complete login with password alone."
  ],
  "evidenceRequirements": [
    { "type": "CONFIG", "required": true }
  ],
  "ownerRoles": ["application", "security"],
  "references": [],
  "relationships": {
    "dependsOn": [],
    "relatedTo": [],
    "supersedes": [],
    "compensatesFor": [],
    "conflictsWith": []
  },
  "tags": ["iam", "mfa", "privileged"]
}
```

Rules:
- `domain`/`subdomain`/`group`/`layer` are explicit fields. The file a
  control lives in (`controls/identity-access.json`, etc.) is an
  authoring convenience only — nothing may infer domain from file path.
- `threatIds` and `relationships.*` are many-to-many by design (a future
  SQLite migration turns these into join tables:
  `control_threats`, `control_relationships`).
- `verification.methods` and `passCriteria` are arrays, never a single
  string — USSVS §11 lists them as singular but real controls need
  multiple methods/criteria.
- Actual Evidence instances (a screenshot, a commit, a scan report) never
  live inside a Control. `evidenceRequirements` only states what kind of
  evidence is needed and for which SVL.

## 7. Control Assessment Record Shape

The actual Control Matrix row for a project (source: USSVS §14, §81,
expanded):

```json
{
  "assessmentId": "ASM-001",
  "projectId": "proj-001",
  "controlId": "IAM-AUTH-005",
  "controlVersion": 1,
  "applicability": {
    "autoResult": "applicable",
    "finalResult": "applicable",
    "matchedRules": ["identity.hasPrivilegedAccounts=true"],
    "source": "automatic"
  },
  "status": "pass",
  "evidenceIds": ["EVD-001", "EVD-002"],
  "findingIds": [],
  "riskAcceptanceId": null,
  "owner": "security",
  "assessedBy": "agent",
  "assessedAt": "2026-09-16T05:00:00Z",
  "nextReviewAt": null,
  "notes": null
}
```

`status` enum: `PASS | FAIL | PARTIAL | N/A | NOT_TESTED | ACCEPTED_RISK`
(USSVS §14). An `N/A` status requires a `notes` reason. An
`ACCEPTED_RISK` status requires a linked `riskAcceptanceId`.

## 8. Other Core Schemas (lighter spec — fields only, one JSON Schema file each)

- **Threat** (`catalogs/threats.json` entries; schema in
  `schemas/threat-schema.json`): `threatId`, `title`, `description`,
  `category`.
- **RiskAcceptance** (`schemas/risk-acceptance-schema.json`, USSVS §15):
  `riskAcceptanceId`, `projectId`, `controlId`, `findingIds[]`, `reason`,
  `compensatingControls[]`, `approvedBy`, `approvedAt`, `expiresAt`
  (**required**, no indefinite acceptance per §15), `status`.
- **Finding** (`schemas/finding-schema.json`, USSVS §66, §82): adds
  `controlIds[]` (many-to-many — one finding can violate multiple
  controls) to the documented field list, plus the Severity Model fields
  (§67-69: impact 1-5, exploitability 1-5, exposure 1-3, privilegeRequired
  0-2, detectability 0-2) and a derived `severity` class.
- **AttackPath** (`schemas/attack-path-schema.json`, USSVS §64-65, §83):
  `attackPathId`, `entryPoint`, `initialPrivilege`, `steps[]`,
  `targetAsset`, `existingControls[]`, `failedControls[]`,
  `detectionCapability`, `impact`, `result` (`blocked|possible`),
  `relatedFindingIds[]` (many-to-many).
- **Evidence** (`schemas/evidence-schema.json`, USSVS §16-17): `evidenceId`,
  `type` (enum from §16), `location`, `capturedAt`, `capturedBy`.
- **ProjectProfile schema**, **Control schema**, **ControlAssessment
  schema**: formalize the shapes given in sections 5, 6, and 7 above as
  full JSON Schema documents.
- **Asset** (`schemas/asset-schema.json`, USSVS §6): `assetId`,
  `assetName`, `assetType`, `dataClassification` (D0-D3),
  `owner`, `storage`, `process`, `access[]`, `backup`, `encryption`,
  `businessImpact`.
- **ReleaseEvaluation** (`schemas/release-evaluation-schema.json`, USSVS
  §73-74, §84): `projectId`, `gate` (`0-4`), `controlCoverage`,
  `criticalFindings`, `highFindings`, `unblockedCriticalAttackPaths`,
  `residualRisksAccepted`, `incidentResponseVerified`,
  `backupRestoreVerified`, `result` (`approved|blocked`).

## 9. Directory / File Layout

```
data/
├─ manifest.json                    # catalogVersion, schemaVersion, file list, counts
│
├─ core/
│  ├─ principles.json               # P1-P7 (§1), checklist anti-patterns (§2),
│  │                                 # 5-layer model (§4), final principle (§86)
│  ├─ security-levels.json          # SVL-0..3 (§9), auto-escalation rules (§10)
│  └─ profile-taxonomy.json         # Exposure/Identity/DataClass D0-D3 dimensions (§5)
│
├─ catalogs/
│  ├─ threats.json                  # Threat catalog (§12 style THR-xxx entries)
│  ├─ references.json               # shared reference/citation entries
│  ├─ evidence-types.json           # Evidence Type enum + priority order (§16-17)
│  ├─ owner-roles.json              # Control Owner roles (§70)
│  └─ asset-types.json              # Asset Type / component / tech controlled vocab (§6)
│
├─ controls/                        # 8 domain-grouped files; domain/subdomain are
│  │                                 # fields inside each control, not inferred from path
│  ├─ identity-access.json          # §18-20, §48, §58-59 (IAM Auth/Authz/Session/OAuth/
│  │                                 # Privileged Access/Identity Lifecycle)
│  ├─ appsec.json                   # §21-28 (Input/Injection/Browser/API/File/SSRF/
│  │                                 # Business Logic/Concurrency)
│  ├─ data-crypto.json              # §29-32, §57, §62 (Crypto/Secret/DB/Privacy/
│  │                                 # Data Integrity)
│  ├─ infrastructure.json           # §32-38 (Env Isolation/Config/Network/Infra/
│  │                                 # Container/K8s/Cloud-IAM)
│  ├─ platform-specific.json        # §42-49 (Mobile/Desktop/Memory Safety/Update/
│  │                                 # Third-party/Webhook/AI-LLM) — expect this to
│  │                                 # split further (platform-client/native/ai) once
│  │                                 # control count grows; not split now
│  ├─ devops-supplychain.json       # §39-41 (Source Repo/CI-CD/Supply Chain)
│  ├─ operations.json               # §50-56 (Logging/Audit/Monitoring/Error/
│  │                                 # Availability/Backup/DR)
│  └─ governance.json               # §60-61, §63 (Domain-DNS-Cert/Time/Abuse-Fraud)
│
├─ schemas/                         # JSON Schema (draft 2020-12) files the MCP
│  │                                 # validates records against
│  ├─ control-schema.json
│  ├─ threat-schema.json
│  ├─ project-profile-schema.json
│  ├─ asset-schema.json
│  ├─ control-assessment-schema.json
│  ├─ evidence-schema.json
│  ├─ finding-schema.json
│  ├─ attack-path-schema.json
│  ├─ risk-acceptance-schema.json
│  └─ release-evaluation-schema.json
│
└─ process/
   ├─ verification-flow.json        # 13-step flow (§3), Testing Matrix (§71-72)
   ├─ release-gates.json            # Gate 0-4 (§73), blockers (§74), retrigger (§75)
   ├─ incident-response.json        # IR readiness (§76)
   ├─ exception-policy.json         # Security Exception Lifecycle (§77)
   ├─ metrics.json                  # forbidden interpretations (§78), recommended
   │                                 # metrics (§79)
   └─ deliverables.json             # final deliverables (§80), final judgment (§84),
                                      # 10 final questions (§85)
```

33 files total: 1 manifest + 3 core + 5 catalogs + 8 controls + 10 schemas
+ 6 process. This is intentionally larger than the original 21/22-file
proposal because schemas were split out to one-file-per-entity per the
review feedback; each file stays small and single-purpose.

## 10. Content Language

All keys are English identifiers. All human-readable text values
(`requirement`, `rationale`, `title`, threat descriptions, etc.) are
written in **English**, translated from the Korean USSVS v2.0 source —
per user decision, to keep the catalog usable outside a Korean-only
context and to avoid mixing languages inside JSON values.

## 11. JSON Shape Guidance (for the content-authoring phase)

- **Flat record + nested attributes**: each domain file is a JSON array
  of Control objects. A Control is a flat record with small nested
  value-objects (`applicability`, `verification`, `baselineRisk`,
  `assurance`, `relationships`) — never Control-within-Control nesting,
  never deep taxonomy trees. This is what keeps a future SQLite migration
  cheap: `1 Control = 1 row`, arrays become join tables
  (`control_threats`, `control_relationships`), and the applicability
  rule tree can stay as a single JSON column even in SQLite.
- Do not build out large controlled vocabularies
  (`catalogs/*.json`) speculatively — start minimal (only values actually
  used by the first controls authored) and grow as needed.

## 12. Out of Scope for This Phase

- The MCP server implementation itself (tool functions like
  `project.create_profile`, `matrix.generate`, `assessment.update`,
  `release.evaluate`) — this spec only defines the data these tools will
  read and write.
- The SQLite migration (`ussvs_catalog.db` / `project-security.db` split)
  — noted as a future direction in §9/§11, not built now.
- Populating `applicability` rules for every one of the ~47 domains'
  controls in full depth — the schema and DSL must support it, but full
  rule coverage can be filled in incrementally after the core contracts
  (Control / ProjectProfile / ControlAssessment / Applicability DSL /
  versioning) are frozen, per the review's top recommendation.

## 13. Open Items for the Implementation Plan

- Order of authoring: freeze the 5 core contracts first (control-schema,
  project-profile-schema, control-assessment-schema, applicability DSL,
  versioning policy) as validated JSON Schema files with at least one
  worked example each, before bulk-authoring the ~47 domains' worth of
  Control content.
- Translation + structuring of ~250-300 individual controls across 8
  domain files is a large, parallelizable content task — the
  implementation plan should decide how to split this across sessions/
  subagents domain-by-domain, each validated against
  `schemas/control-schema.json`.
