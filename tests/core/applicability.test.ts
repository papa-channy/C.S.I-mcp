import { describe, expect, it } from "vitest";
import { evaluateApplicability, type Control, type ProjectProfile } from "../../src/core/applicability.js";

function control(when: Control["applicability"]["when"]): Control {
  return { controlId: "TEST-001", applicability: { when } };
}

const baseProfile: ProjectProfile = {
  securityLevel: "SVL-2",
  exposure: ["internet_public"],
  components: ["backend_api"],
  features: { authentication: true },
  technologies: {},
};

describe("evaluateApplicability — leaf conditions", () => {
  it("eq: true when the fact equals the target value", () => {
    const c = control({ fact: "features.authentication", operator: "eq", value: true });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("eq: not_applicable when the fact does not equal the target value", () => {
    const c = control({ fact: "features.authentication", operator: "eq", value: false });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("not_applicable");
  });

  it("contains: applicable when the fact array contains the target", () => {
    const c = control({ fact: "components", operator: "contains", value: "backend_api" });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("intersects: applicable when fact and target arrays share any element", () => {
    const c = control({ fact: "components", operator: "intersects", value: ["browser_frontend", "backend_api"] });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("in: applicable when the fact value is a member of the target array", () => {
    const c = control({ fact: "securityLevel", operator: "in", value: ["SVL-2", "SVL-3"] });
    expect(evaluateApplicability(c, baseProfile).autoResult).toBe("applicable");
  });

  it("components omitted entirely (not []) evaluates the leaf to unknown", () => {
    const { components, ...rest } = baseProfile;
    const profileWithoutComponents: ProjectProfile = rest;
    const c = control({ fact: "components", operator: "contains", value: "backend_api" });
    expect(evaluateApplicability(c, profileWithoutComponents).autoResult).toBe("unknown");
  });

  it("components as [] (known-none) evaluates the leaf to not_applicable, not unknown", () => {
    const profile: ProjectProfile = { ...baseProfile, components: [] };
    const c = control({ fact: "components", operator: "contains", value: "backend_api" });
    expect(evaluateApplicability(c, profile).autoResult).toBe("not_applicable");
  });

  it("an omitted boolean feature flag is treated as its literal undefined value, not as unknown (features is a required object; only components/identities/dataClasses get the omitted-means-unknown treatment)", () => {
    const profile: ProjectProfile = { ...baseProfile, features: {} };
    const c = control({ fact: "features.fileUpload", operator: "eq", value: true });
    expect(evaluateApplicability(c, profile).autoResult).toBe("not_applicable");
  });
});

import { loadJson } from "../../src/validate.js";
import type { RuleNode } from "../../src/core/applicability.js";

// T/F/U leaves built from the real DSL: components is one of only two fields whose omission this project
// treats as UNKNOWN, so these three constants exercise the actual three-valued contract, not a fake one.
const T: RuleNode = { fact: "components", operator: "contains", value: "backend_api" }; // applicable (baseProfile has it)
const F: RuleNode = { fact: "components", operator: "contains", value: "nonexistent" }; // not_applicable
const U: RuleNode = { fact: "identities", operator: "contains", value: "admin" }; // identities omitted -> unknown

describe("evaluateApplicability — Kleene composition truth table", () => {
  it.each([
    [[T, T], "applicable"],
    [[T, U], "unknown"],
    [[T, F], "not_applicable"],
    [[U, F], "not_applicable"],
    [[U, U], "unknown"],
  ] as const)("all(%o) = %s", (children, expected) => {
    expect(evaluateApplicability(control({ all: [...children] }), baseProfile).autoResult).toBe(expected);
  });

  it.each([
    [[F, F], "not_applicable"],
    [[F, U], "unknown"],
    [[F, T], "applicable"],
    [[U, T], "applicable"],
    [[U, U], "unknown"],
  ] as const)("any(%o) = %s", (children, expected) => {
    expect(evaluateApplicability(control({ any: [...children] }), baseProfile).autoResult).toBe(expected);
  });

  it("nested: all(applicable, any(not_applicable, unknown)) = unknown", () => {
    const rule: RuleNode = { all: [T, { any: [F, U] }] };
    expect(evaluateApplicability(control(rule), baseProfile).autoResult).toBe("unknown");
  });

  it("the spec's §3 worked example: all[authentication eq true, dataClasses contains D3] with authentication:false and dataClasses omitted -> not_applicable, matchedRules identifies all[0]", () => {
    const profile: ProjectProfile = { ...baseProfile, features: { authentication: false } };
    const rule: RuleNode = {
      all: [
        { fact: "features.authentication", operator: "eq", value: true },
        { fact: "dataClasses", operator: "contains", value: "D3" },
      ],
    };
    const result = evaluateApplicability(control(rule), profile);
    expect(result.autoResult).toBe("not_applicable");
    expect(result.matchedRules).toEqual(["all[0]"]);
  });

  it("same rule with authentication:true and dataClasses omitted -> unknown, matchedRules identifies all[1]", () => {
    const profile: ProjectProfile = { ...baseProfile, features: { authentication: true } };
    const rule: RuleNode = {
      all: [
        { fact: "features.authentication", operator: "eq", value: true },
        { fact: "dataClasses", operator: "contains", value: "D3" },
      ],
    };
    const result = evaluateApplicability(control(rule), profile);
    expect(result.autoResult).toBe("unknown");
    expect(result.matchedRules).toEqual(["all[1]"]);
  });

  it("empty all[]/any[] is rejected upstream by control-schema.json's minItems:1, not by this module (see this plan's Design Rulings, item 1)", () => {
    const schema = loadJson<{ $defs: { ruleNode: { oneOf: [{ properties: { all: { minItems: number } } }, { properties: { any: { minItems: number } } }, unknown] } } }>(
      "data/schemas/control-schema.json"
    );
    const [allBranch, anyBranch] = schema.$defs.ruleNode.oneOf;
    expect(allBranch.properties.all.minItems).toBe(1);
    expect(anyBranch.properties.any.minItems).toBe(1);
  });
});
