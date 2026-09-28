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
