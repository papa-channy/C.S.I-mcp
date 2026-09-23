import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/data-crypto.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/data-crypto.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the data_crypto domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/data-crypto.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["data_crypto"]));
  });

  it("DATA-KEYSEP-001 depends on DATA-ENC-001", () => {
    const controls = loadJson<{ controlId: string; relationships?: { dependsOn?: string[] } }[]>(
      "data/controls/data-crypto.json"
    );
    const keysep = controls.find((c) => c.controlId === "DATA-KEYSEP-001");
    expect(keysep?.relationships?.dependsOn).toEqual(["DATA-ENC-001"]);
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/data-crypto.json");
    expect(violations).toEqual([]);
  });
});
