import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/operations.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/operations.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the operations domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/operations.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["operations"]));
  });

  it("OPS-BACKUP-TEST-001 depends on INFRA-BACKUP-001 (cross-domain reference)", () => {
    const controls = loadJson<{ controlId: string; relationships?: { dependsOn?: string[] } }[]>(
      "data/controls/operations.json"
    );
    const drill = controls.find((c) => c.controlId === "OPS-BACKUP-TEST-001");
    expect(drill?.relationships?.dependsOn).toEqual(["INFRA-BACKUP-001"]);
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/operations.json");
    expect(violations).toEqual([]);
  });
});
