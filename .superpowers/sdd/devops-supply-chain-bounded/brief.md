# Task Brief: devops-supply-chain Control Domain

This is a bounded, single-scope task (no multi-task plan). Add a 6th control
domain, `devops-supply-chain`, to the C.S.I-mcp security catalog, following
the exact pattern established by the 5 pilot domains already in this repo
(`data/controls/appsec.json`, `infrastructure.json`, `operations.json`,
`platform-specific.json`, `data-crypto.json`).

This design was reviewed and approved by the project owner (including one
external review round) before this brief was written — every value below is
final, not a suggestion.

## Global constraints (same as every prior domain in this repo)

- Every Control record must validate against `data/schemas/control-schema.json`.
- `applicability.when` uses the existing rule DSL (`all`/`any`/leaf
  fact-conditions) and must prefer capability/architecture facts
  (`components`, `features.*`, `identities`, `dataClasses`, `exposure`,
  `securityLevel`) over raw tech-stack facts.
- Within one control, `verification.methods[].type` values must be unique,
  and every `assurance[svl]` value must be one of that control's own
  `verification.methods[].type` values (enforced by
  `src/validate-catalog.ts`'s semantic validator).
- `assurance` must be cumulative: if a control defines more than one of
  `SVL-1`/`SVL-2`/`SVL-3`, each higher level's array must be a superset of
  the next-lower one's (also enforced by the semantic validator).
- `controlId` pattern: `^[A-Z]+(-[A-Z]+)*-[0-9]{3}$` (uppercase-letter
  groups separated by hyphens, ending in exactly 3 digits).
- `threatId` pattern: `^THR-[A-Z0-9-]+$`.
- No cross-file `$ref` between schema files (not relevant here — no schema
  files are touched by this task).
- Do NOT modify `data/manifest.json` in a way that leaves it inconsistent —
  this task DOES update the manifest (unlike the pilot's multi-task plan,
  which deferred manifest updates to a final task; this is a single task,
  so the manifest update happens in the same commit(s) as the content).
- All tests run under plain `npm test` (`vitest run`) — no new npm scripts.

All JSON content below was already verified by the task's author (schema-
compiled against `control-schema.json` with `strict:false`, and dry-run
through the exact semantic-validator logic in `src/validate-catalog.ts`) —
zero violations. Transcribe it exactly; do not improvise additional fields,
rename anything, or "improve" the wording.

## Step 1: Append 4 new threats to `data/catalogs/threats.json`

Append these 4 objects to the existing `threats` array (after the last
existing entry — the file currently ends with `THR-DATA-NONPROD-EXPOSURE`):

```json
    { "threatId": "THR-DEVOPS-DEPENDENCY-SUPPLY-CHAIN", "title": "Dependency Supply Chain Compromise", "description": "A dependency is introduced from an untrusted or unpinned source, allowing typosquatting, dependency confusion, or a compromised upstream package to run inside the build or application.", "category": "devops_supply_chain" },
    { "threatId": "THR-DEVOPS-CI-SECRET-EXPOSURE", "title": "CI Secret Exposure", "description": "A CI/CD pipeline secret is exposed to an untrusted context (e.g. a fork pull request build) or logged in plaintext, giving an attacker credentials to production or source systems.", "category": "devops_supply_chain" },
    { "threatId": "THR-DEVOPS-CI-ACTION-COMPROMISE", "title": "Compromised Third-Party CI Action or Plugin", "description": "A third-party CI action or plugin referenced by a mutable tag or unverified source is compromised or updated maliciously, executing attacker-controlled code inside the pipeline.", "category": "devops_supply_chain" },
    { "threatId": "THR-DEVOPS-ARTIFACT-TAMPERING", "title": "Build Artifact Tampering", "description": "A build or release artifact is modified between build and deployment, or a malicious artifact is substituted, without detection.", "category": "devops_supply_chain" }
```

Note: `THR-INFRA-UNPATCHED-DEPENDENCY` (already in the catalog, added during
the Infrastructure pilot domain) is reused by one control below — do not
duplicate it, do not modify it.

## Step 2: Create `data/controls/devops-supply-chain.json`

```json
[
  {
    "controlId": "DEVOPS-DEP-001",
    "version": 1,
    "status": "active",
    "title": "Dependency Vulnerability Scanning",
    "group": "devops_supply_chain",
    "domain": "dependency_security",
    "subdomain": "vulnerability_scanning",
    "layer": "prevent",
    "requirement": "Application dependencies must be scanned for known vulnerabilities (CVEs) on a defined schedule and before release, with findings tracked to remediation.",
    "rationale": "A dependency with a publicly known vulnerability is a target attackers can identify and exploit without any custom research against the application itself.",
    "threatIds": ["THR-INFRA-UNPATCHED-DEPENDENCY"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "intersects", "value": ["backend_api", "browser_frontend", "mobile_app"] }] }
    },
    "baselineRisk": { "severity": "medium" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "scan"], "SVL-3": ["config_review", "scan"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm a dependency vulnerability scanning tool is integrated into the build or CI process and runs on a defined schedule.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "scan",
          "procedure": "Run a dependency vulnerability scan and confirm no known-vulnerable dependency with an available fix is present in the current release.",
          "requiredEvidenceTypes": ["SCAN"],
          "minimumSvl": "SVL-2",
          "automatable": true
        }
      ]
    },
    "passCriteria": ["No dependency with a known vulnerability and an available fix is present in the release build."],
    "evidenceRequirements": [{ "type": "SCAN", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }],
    "ownerRoles": ["devops", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["DEVOPS-DEP-002"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["devops_supply_chain", "dependency", "sca"]
  },
  {
    "controlId": "DEVOPS-DEP-002",
    "version": 1,
    "status": "active",
    "title": "Dependency and Base Image Provenance and Pinning",
    "group": "devops_supply_chain",
    "domain": "dependency_security",
    "subdomain": "provenance_and_pinning",
    "layer": "prevent",
    "requirement": "Dependencies and, where applicable, container base images must be pinned to an exact version or digest and sourced only from a vetted registry, rather than resolved by a mutable tag or an unverified source.",
    "rationale": "An unpinned dependency or base image can silently change between builds; an attacker who compromises the upstream source, or exploits dependency confusion or typosquatting, can substitute a malicious package without any code change on the project's side.",
    "threatIds": ["THR-DEVOPS-DEPENDENCY-SUPPLY-CHAIN"],
    "applicability": {
      "when": {
        "any": [
          { "fact": "components", "operator": "intersects", "value": ["backend_api", "browser_frontend", "mobile_app"] },
          { "fact": "components", "operator": "contains", "value": "container_image" }
        ]
      }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the dependency lockfile and, if the project ships as a container image, the base image reference, and confirm every dependency and the base image are pinned to an exact version or digest sourced from a vetted registry, not a mutable tag.",
          "requiredEvidenceTypes": ["CODE", "CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": [
      "Every dependency resolves to a pinned version or digest, not a mutable range or tag.",
      "If the project ships as a container image, its base image is pinned to a digest from a vetted registry."
    ],
    "evidenceRequirements": [{ "type": "CODE", "required": true }],
    "ownerRoles": ["devops", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": ["DEVOPS-DEP-001"], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["devops_supply_chain", "dependency", "provenance", "container"]
  },
  {
    "controlId": "DEVOPS-CI-001",
    "version": 1,
    "status": "active",
    "title": "CI/CD Secret Isolation",
    "group": "devops_supply_chain",
    "domain": "ci_cd_security",
    "subdomain": "secret_management",
    "layer": "prevent",
    "requirement": "CI/CD pipeline secrets must not be accessible to builds triggered from an untrusted context (e.g. a fork pull request), must be scoped to the minimum permission and lifetime they need, and must be separated from production credentials.",
    "rationale": "A pipeline that exposes secrets to any triggerable build gives an external contributor, or an attacker who opens a pull request, a direct path to credentials the pipeline holds.",
    "threatIds": ["THR-DEVOPS-CI-SECRET-EXPOSURE"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "ci_pipeline" }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test", "adversarial_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Inspect the CI configuration and confirm secrets are scoped to the minimum permission and lifetime needed, and production secrets are not exposed to non-production pipeline jobs.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Trigger a build from a fork pull request and confirm it cannot access repository or environment secrets.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        },
        {
          "type": "adversarial_test",
          "procedure": "Attempt to exfiltrate a secret from within a pipeline job (e.g. via a crafted build step or log output) and confirm the secret is masked and cannot be retrieved.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-3",
          "automatable": false
        }
      ]
    },
    "passCriteria": [
      "A build triggered from a fork pull request or other untrusted context cannot access repository or environment secrets.",
      "No secret appears unmasked in pipeline logs."
    ],
    "evidenceRequirements": [
      { "type": "CONFIG", "required": true },
      { "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }
    ],
    "ownerRoles": ["devops", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["devops_supply_chain", "ci_cd", "secrets"]
  },
  {
    "controlId": "DEVOPS-CI-002",
    "version": 1,
    "status": "active",
    "title": "Third-Party CI Action and Plugin Integrity",
    "group": "devops_supply_chain",
    "domain": "ci_cd_security",
    "subdomain": "ci_extension_integrity",
    "layer": "prevent",
    "requirement": "A third-party CI action or plugin used in the pipeline must be pinned to an immutable commit SHA or verified digest, from a vetted publisher, rather than referenced by a mutable tag or branch.",
    "rationale": "A CI action referenced by a mutable tag (e.g. a major-version tag) can be silently updated by its publisher, or by an attacker who compromises the publisher's account, to run arbitrary code inside every pipeline that uses it.",
    "threatIds": ["THR-DEVOPS-CI-ACTION-COMPROMISE"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "ci_pipeline" }] }
    },
    "baselineRisk": { "severity": "high" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review"], "SVL-3": ["config_review"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Review the pipeline configuration and confirm every third-party action or plugin is pinned to an immutable commit SHA or verified digest, and that new or updated actions are reviewed before adoption.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["Every third-party CI action or plugin resolves to an immutable commit SHA or verified digest, not a mutable tag or branch."],
    "evidenceRequirements": [{ "type": "CONFIG", "required": true }],
    "ownerRoles": ["devops", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["devops_supply_chain", "ci_cd", "third_party"]
  },
  {
    "controlId": "DEVOPS-ARTIFACT-001",
    "version": 1,
    "status": "active",
    "title": "Build and Release Artifact Integrity",
    "group": "devops_supply_chain",
    "domain": "artifact_integrity",
    "subdomain": "artifact_provenance",
    "layer": "prevent",
    "requirement": "A release artifact's provenance and integrity must be verifiable from build through deployment, so that a tampered or substituted artifact can be detected before it runs.",
    "rationale": "An artifact that can be modified or substituted between build and deployment without detection lets an attacker who compromises any point in that path ship arbitrary code, even if the source repository and CI pipeline are themselves uncompromised.",
    "threatIds": ["THR-DEVOPS-ARTIFACT-TAMPERING"],
    "applicability": {
      "when": { "all": [{ "fact": "components", "operator": "contains", "value": "release_pipeline" }] }
    },
    "baselineRisk": { "severity": "critical" },
    "assurance": { "SVL-1": ["config_review"], "SVL-2": ["config_review", "dynamic_test"], "SVL-3": ["config_review", "dynamic_test", "adversarial_test"] },
    "verification": {
      "methods": [
        {
          "type": "config_review",
          "procedure": "Confirm each release artifact is identified by a checksum or immutable identifier recorded at build time.",
          "requiredEvidenceTypes": ["CONFIG"],
          "minimumSvl": "SVL-1",
          "automatable": false
        },
        {
          "type": "dynamic_test",
          "procedure": "Confirm the release artifact is signed or has an attestation generated at build time, and that the signature or attestation can be independently verified.",
          "requiredEvidenceTypes": ["AUTOMATED_TEST"],
          "minimumSvl": "SVL-2",
          "automatable": true
        },
        {
          "type": "adversarial_test",
          "procedure": "Attempt to deploy a modified artifact (or one with a stripped/invalid signature) and confirm the deployment pipeline rejects it before it runs.",
          "requiredEvidenceTypes": ["MANUAL_TEST"],
          "minimumSvl": "SVL-3",
          "automatable": false
        }
      ]
    },
    "passCriteria": ["A release artifact with a missing, invalid, or non-matching signature or attestation is rejected before deployment."],
    "evidenceRequirements": [
      { "type": "CONFIG", "required": true },
      { "type": "AUTOMATED_TEST", "required": true, "requiredFor": ["SVL-2", "SVL-3"] }
    ],
    "ownerRoles": ["devops", "security"],
    "references": [],
    "relationships": { "dependsOn": [], "relatedTo": [], "supersedes": [], "compensatesFor": [], "conflictsWith": [] },
    "tags": ["devops_supply_chain", "artifact", "signing"]
  }
]
```

## Step 3: Create `tests/controls/devops-supply-chain.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/devops-supply-chain.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/devops-supply-chain.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the three devops_supply_chain sub-domains", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/devops-supply-chain.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(
      new Set(["dependency_security", "ci_cd_security", "artifact_integrity"])
    );
  });

  it("uses a single group for the whole file", () => {
    const controls = loadJson<{ group: string }[]>("data/controls/devops-supply-chain.json");
    expect(new Set(controls.map((c) => c.group))).toEqual(new Set(["devops_supply_chain"]));
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/devops-supply-chain.json");
    expect(violations).toEqual([]);
  });
});
```

## Step 4: Update `data/manifest.json`

Change the `controls` block from:
```json
  "controls": {
    "count": 39,
    "files": [
      "controls/identity-access.json",
      "controls/appsec.json",
      "controls/infrastructure.json",
      "controls/operations.json",
      "controls/platform-specific.json",
      "controls/data-crypto.json"
    ]
  },
```
to:
```json
  "controls": {
    "count": 44,
    "files": [
      "controls/identity-access.json",
      "controls/appsec.json",
      "controls/infrastructure.json",
      "controls/operations.json",
      "controls/platform-specific.json",
      "controls/data-crypto.json",
      "controls/devops-supply-chain.json"
    ]
  },
```

(39 existing + 5 new = 44. Leave every other section of `data/manifest.json`
untouched — `catalog`, `catalogVersion`, `schemaVersion`, `core`,
`catalogs`, `schemas`, `process` are all unaffected by this task.)

Note: `tests/manifest.test.ts` needs no code change — its assertions
recompute expected values dynamically from whatever the manifest lists, so
once Steps 1-4 are all done together (unlike the pilot's multi-task plan,
this is a single task, so there is no intermediate "manifest is stale"
state), that test suite should already be green.

## Step 5: Run the full suite

Run: `npm test`
Expected: 100% pass, no failures. Baseline before this task was 145/145
across 29 files; after this task it should be 149/149 across 30 files (4
new tests in the new `devops-supply-chain.test.ts` file, no other test
file's count changes).

## Step 6: Commit

You may use one commit or a few logically-grouped commits — your choice.
Suggested single-commit message:

```
feat: add devops-supply-chain control domain (5 controls, 4 new threats)
```

## Report

Write your full report (what you did, exact test command + output,
commit hash(es)) to:
`.superpowers/sdd/devops-supply-chain-bounded/report.md`

Do not dispatch any subagents yourself. When done, reply with ONLY:
status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), the commit
hash(es), a one-line test summary, and any concerns.
