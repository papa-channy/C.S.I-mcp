import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";
import { validateCatalog } from "../../src/validate-catalog.js";

describe("controls/governance.json", () => {
  it("has exactly 4 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/governance.json");
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("covers the four governance sub-domains", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/governance.json");
    expect(new Set(controls.map((c) => c.domain))).toEqual(
      new Set(["release_governance", "incident_governance", "risk_governance", "vendor_governance"])
    );
  });

  it("uses a single group for the whole file", () => {
    const controls = loadJson<{ group: string }[]>("data/controls/governance.json");
    expect(new Set(controls.map((c) => c.group))).toEqual(new Set(["governance"]));
  });

  it("every control is applicable regardless of technical profile (securityLevel-based always-applicable pattern)", () => {
    const controls = loadJson<{ applicability: { when: { fact: string; operator: string; value: string[] } } }[]>(
      "data/controls/governance.json"
    );
    for (const control of controls) {
      expect(control.applicability.when.fact).toBe("securityLevel");
      expect(control.applicability.when.operator).toBe("in");
      expect(control.applicability.when.value.sort()).toEqual(["SVL-0", "SVL-1", "SVL-2", "SVL-3"]);
    }
  });

  it("produces no semantic-validator violations against the full data/ tree", () => {
    const violations = validateCatalog("data").filter((v) => v.source === "controls/governance.json");
    expect(violations).toEqual([]);
  });
});
