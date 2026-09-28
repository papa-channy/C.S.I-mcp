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
