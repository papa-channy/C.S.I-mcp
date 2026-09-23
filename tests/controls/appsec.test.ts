import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/appsec.json", () => {
  it("has exactly 6 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/appsec.json");
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the appsec domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/appsec.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["appsec"]));
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/appsec.json");
    expect(violations).toEqual([]);
  });
});
