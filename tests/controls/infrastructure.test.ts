import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/infrastructure.json", () => {
  it("has exactly 6 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/infrastructure.json");
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the infrastructure domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/infrastructure.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["infrastructure"]));
  });

  it("INFRA-PATCH-002 depends on INFRA-PATCH-001", () => {
    const controls = loadJson<{ controlId: string; relationships?: { dependsOn?: string[] } }[]>(
      "data/controls/infrastructure.json"
    );
    const patch002 = controls.find((c) => c.controlId === "INFRA-PATCH-002");
    expect(patch002?.relationships?.dependsOn).toEqual(["INFRA-PATCH-001"]);
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/infrastructure.json");
    expect(violations).toEqual([]);
  });
});
