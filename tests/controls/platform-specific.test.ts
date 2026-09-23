import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/platform-specific.json", () => {
  it("has exactly 5 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/platform-specific.json");
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the platform_specific domain", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/platform-specific.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(new Set(["platform_specific"]));
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/platform-specific.json");
    expect(violations).toEqual([]);
  });
});
