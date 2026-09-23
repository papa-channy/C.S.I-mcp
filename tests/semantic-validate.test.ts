import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCatalog } from "../src/validate-catalog.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function baseControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    controlId: "TEST-001",
    status: "active",
    threatIds: ["THR-TEST-001"],
    relationships: {},
    verification: { methods: [{ type: "manual_test" }] },
    assurance: {},
    ...overrides,
  };
}

function writeCatalog(
  controlsFiles: Record<string, unknown[]>,
  threats: { threatId: string }[] = [{ threatId: "THR-TEST-001" }],
  weights: Record<string, number> = { a: 0.5, b: 0.5 }
): string {
  const dir = mkdtempSync(join(tmpdir(), "csi-mcp-catalog-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "controls"));
  mkdirSync(join(dir, "catalogs"));
  mkdirSync(join(dir, "core"));
  for (const [name, controls] of Object.entries(controlsFiles)) {
    writeFileSync(join(dir, "controls", name), JSON.stringify(controls));
  }
  writeFileSync(join(dir, "catalogs", "threats.json"), JSON.stringify({ threats }));
  writeFileSync(join(dir, "core", "criticality-weights.json"), JSON.stringify({ weights }));
  return dir;
}

describe("validateCatalog", () => {
  it("returns no violations for the real data/ tree", () => {
    expect(validateCatalog("data")).toEqual([]);
  });

  it("catches duplicate controlIds across files", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ controlId: "DUP-001" })],
      "b.json": [baseControl({ controlId: "DUP-001" })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_DUPLICATE_CONTROL_ID")).toBe(true);
  });

  it("catches duplicate threatIds", () => {
    const dir = writeCatalog(
      { "a.json": [baseControl()] },
      [{ threatId: "THR-DUP" }, { threatId: "THR-DUP" }]
    );
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_DUPLICATE_THREAT_ID")).toBe(true);
  });

  it("catches a threatId referenced by a control but absent from the threat catalog", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ threatIds: ["THR-MISSING"] })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_UNKNOWN_THREAT")).toBe(true);
  });

  it("catches a relationships target that doesn't exist", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ relationships: { dependsOn: ["NOPE-001"] } })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_UNKNOWN_RELATIONSHIP_TARGET")).toBe(true);
  });

  it("catches a control naming itself in replacedBy", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ controlId: "SELF-001", replacedBy: "SELF-001" })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_REPLACED_BY_SELF")).toBe(true);
  });

  it("catches a replacedBy chain that cycles", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({ controlId: "CYC-A", replacedBy: "CYC-B" }),
        baseControl({ controlId: "CYC-B", replacedBy: "CYC-A" }),
      ],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_REPLACED_BY_CYCLE")).toBe(true);
  });

  it("catches two verification methods sharing a type within one control", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ verification: { methods: [{ type: "manual_test" }, { type: "manual_test" }] } })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_DUPLICATE_VERIFICATION_TYPE")).toBe(true);
  });

  it("catches assurance referencing a verification method type the control doesn't define", () => {
    const dir = writeCatalog({
      "a.json": [baseControl({ assurance: { "SVL-1": ["nonexistent_method"] } })],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_UNKNOWN_ASSURANCE_METHOD")).toBe(true);
  });

  it("catches assurance that drops a requirement at a higher SVL", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({
          verification: { methods: [{ type: "config_review" }, { type: "manual_test" }] },
          assurance: { "SVL-1": ["config_review", "manual_test"], "SVL-2": ["config_review"] },
        }),
      ],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_ASSURANCE_NOT_CUMULATIVE")).toBe(true);
  });

  it("catches assurance that drops a requirement at a non-adjacent SVL level when the intermediate level is absent", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({
          verification: { methods: [{ type: "a" }] },
          assurance: { "SVL-1": ["a"], "SVL-3": [] },
        }),
      ],
    });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_ASSURANCE_NOT_CUMULATIVE")).toBe(true);
  });

  it("catches criticality weights that don't sum to 1.0", () => {
    const dir = writeCatalog({ "a.json": [baseControl()] }, undefined, { a: 0.3, b: 0.3 });
    const violations = validateCatalog(dir);
    expect(violations.some((v) => v.code === "CATALOG_WEIGHTS_NOT_NORMALIZED")).toBe(true);
  });

  it("sorts violations deterministically by severity, source, entityId, code", () => {
    const dir = writeCatalog({
      "a.json": [
        baseControl({ controlId: "Z-001", threatIds: ["THR-MISSING-Z"] }),
        baseControl({ controlId: "A-001", threatIds: ["THR-MISSING-A"] }),
      ],
    });
    const violations = validateCatalog(dir);
    const relevant = violations.filter((v) => v.code === "CATALOG_UNKNOWN_THREAT");
    expect(relevant.map((v) => v.entityId)).toEqual(["A-001", "Z-001"]);
  });
});
