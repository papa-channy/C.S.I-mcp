import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJson } from "./validate.js";

export interface CatalogViolation {
  code: string;
  severity: "error";
  source: string;
  entityId: string;
  path: string;
  message: string;
}

interface VerificationMethod {
  type: string;
}

interface Control {
  controlId: string;
  replacedBy?: string;
  threatIds: string[];
  relationships?: {
    dependsOn?: string[];
    relatedTo?: string[];
    supersedes?: string[];
    compensatesFor?: string[];
    conflictsWith?: string[];
  };
  assurance?: Record<string, string[]>;
  verification: { methods: VerificationMethod[] };
}

interface ThreatCatalog {
  threats: { threatId: string }[];
}

interface CriticalityWeights {
  weights: Record<string, number>;
}

const RELATIONSHIP_KEYS = ["dependsOn", "relatedTo", "supersedes", "compensatesFor", "conflictsWith"] as const;
const SVL_ORDER = ["SVL-1", "SVL-2", "SVL-3"] as const;

export function validateCatalog(dataDir: string): CatalogViolation[] {
  const violations: CatalogViolation[] = [];

  const controlsDir = join(dataDir, "controls");
  const controlFiles = readdirSync(controlsDir).filter((f) => f.endsWith(".json"));
  const controlsBySource = controlFiles.map((f) => ({
    source: `controls/${f}`,
    controls: loadJson<Control[]>(join(controlsDir, f)),
  }));
  const allControls = controlsBySource.flatMap(({ source, controls }) =>
    controls.map((control) => ({ source, control }))
  );
  const controlIds = new Set(allControls.map(({ control }) => control.controlId));

  const threatsData = loadJson<ThreatCatalog>(join(dataDir, "catalogs/threats.json"));
  const knownThreatIds = new Set(threatsData.threats.map((t) => t.threatId));

  // controlId uniqueness
  const seenControlIds = new Map<string, string>();
  for (const { source, control } of allControls) {
    if (seenControlIds.has(control.controlId)) {
      violations.push({
        code: "CATALOG_DUPLICATE_CONTROL_ID",
        severity: "error",
        source,
        entityId: control.controlId,
        path: "controlId",
        message: `Duplicate controlId ${control.controlId} (also in ${seenControlIds.get(control.controlId)})`,
      });
    } else {
      seenControlIds.set(control.controlId, source);
    }
  }

  // threatId uniqueness
  const seenThreatIds = new Map<string, number>();
  threatsData.threats.forEach((t, i) => {
    if (seenThreatIds.has(t.threatId)) {
      violations.push({
        code: "CATALOG_DUPLICATE_THREAT_ID",
        severity: "error",
        source: "catalogs/threats.json",
        entityId: t.threatId,
        path: `threats[${i}].threatId`,
        message: `Duplicate threatId ${t.threatId}`,
      });
    } else {
      seenThreatIds.set(t.threatId, i);
    }
  });

  // threatIds-exist
  for (const { source, control } of allControls) {
    control.threatIds.forEach((tid, i) => {
      if (!knownThreatIds.has(tid)) {
        violations.push({
          code: "CATALOG_UNKNOWN_THREAT",
          severity: "error",
          source,
          entityId: control.controlId,
          path: `threatIds[${i}]`,
          message: `Unknown threatId ${tid}`,
        });
      }
    });
  }

  // relationships-exist
  for (const { source, control } of allControls) {
    for (const key of RELATIONSHIP_KEYS) {
      const ids = control.relationships?.[key] ?? [];
      ids.forEach((rid, i) => {
        if (!controlIds.has(rid)) {
          violations.push({
            code: "CATALOG_UNKNOWN_RELATIONSHIP_TARGET",
            severity: "error",
            source,
            entityId: control.controlId,
            path: `relationships.${key}[${i}]`,
            message: `Unknown controlId ${rid} referenced in relationships.${key}`,
          });
        }
      });
    }
  }

  // replacedBy-valid: exists, no self-reference, no cycle
  const replacedByMap = new Map<string, string>();
  for (const { control } of allControls) {
    if (control.replacedBy) replacedByMap.set(control.controlId, control.replacedBy);
  }
  for (const { source, control } of allControls) {
    if (!control.replacedBy) continue;
    if (control.replacedBy === control.controlId) {
      violations.push({
        code: "CATALOG_REPLACED_BY_SELF",
        severity: "error",
        source,
        entityId: control.controlId,
        path: "replacedBy",
        message: `Control ${control.controlId} names itself in replacedBy`,
      });
      continue;
    }
    if (!controlIds.has(control.replacedBy)) {
      violations.push({
        code: "CATALOG_UNKNOWN_REPLACED_BY",
        severity: "error",
        source,
        entityId: control.controlId,
        path: "replacedBy",
        message: `Unknown controlId ${control.replacedBy} referenced in replacedBy`,
      });
      continue;
    }
    const visited = new Set<string>([control.controlId]);
    let current: string | undefined = control.replacedBy;
    while (current) {
      if (visited.has(current)) {
        violations.push({
          code: "CATALOG_REPLACED_BY_CYCLE",
          severity: "error",
          source,
          entityId: control.controlId,
          path: "replacedBy",
          message: `replacedBy chain starting at ${control.controlId} contains a cycle at ${current}`,
        });
        break;
      }
      visited.add(current);
      current = replacedByMap.get(current);
    }
  }

  // assurance-verification-linkage: type uniqueness + assurance subset
  for (const { source, control } of allControls) {
    const types = control.verification.methods.map((m) => m.type);
    const seenTypes = new Set<string>();
    types.forEach((t, i) => {
      if (seenTypes.has(t)) {
        violations.push({
          code: "CATALOG_DUPLICATE_VERIFICATION_TYPE",
          severity: "error",
          source,
          entityId: control.controlId,
          path: `verification.methods[${i}].type`,
          message: `Duplicate verification method type "${t}" within control ${control.controlId}`,
        });
      }
      seenTypes.add(t);
    });
    const typeSet = new Set(types);
    for (const [svl, values] of Object.entries(control.assurance ?? {})) {
      values.forEach((v, i) => {
        if (!typeSet.has(v)) {
          violations.push({
            code: "CATALOG_UNKNOWN_ASSURANCE_METHOD",
            severity: "error",
            source,
            entityId: control.controlId,
            path: `assurance.${svl}[${i}]`,
            message: `assurance.${svl} references verification method type "${v}" not defined in verification.methods`,
          });
        }
      });
    }
  }

  // assurance-cumulative: SVL-1 subset of SVL-2 subset of SVL-3
  for (const { source, control } of allControls) {
    const assurance = control.assurance ?? {};
    for (let i = 1; i < SVL_ORDER.length; i++) {
      const lower = assurance[SVL_ORDER[i - 1]];
      const higher = assurance[SVL_ORDER[i]];
      if (!lower || !higher) continue;
      const higherSet = new Set(higher);
      const missing = lower.filter((v) => !higherSet.has(v));
      if (missing.length > 0) {
        violations.push({
          code: "CATALOG_ASSURANCE_NOT_CUMULATIVE",
          severity: "error",
          source,
          entityId: control.controlId,
          path: `assurance.${SVL_ORDER[i]}`,
          message: `assurance.${SVL_ORDER[i]} drops requirement(s) [${missing.join(", ")}] present in assurance.${SVL_ORDER[i - 1]}`,
        });
      }
    }
  }

  // criticality-weights-sum
  const weightsData = loadJson<CriticalityWeights>(join(dataDir, "core/criticality-weights.json"));
  const sum = Object.values(weightsData.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) >= 1e-9) {
    violations.push({
      code: "CATALOG_WEIGHTS_NOT_NORMALIZED",
      severity: "error",
      source: "core/criticality-weights.json",
      entityId: "CRIT-DEFAULT",
      path: "weights",
      message: `Criticality weights sum to ${sum}, expected 1.0`,
    });
  }

  violations.sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.source.localeCompare(b.source) ||
      a.entityId.localeCompare(b.entityId) ||
      a.code.localeCompare(b.code)
  );
  return violations;
}
