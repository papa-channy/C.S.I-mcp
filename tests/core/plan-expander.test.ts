import { describe, expect, it } from "vitest";
import { expandPlan, type AssessmentPlan, type AssessmentStatusInput, type PlanControl } from "../../src/core/plan-expander.js";
import type { ProjectProfile } from "../../src/core/applicability.js";

const controls: PlanControl[] = [
  {
    controlId: "A-002", domain: "appsec", subdomain: "injection", layer: "prevent", group: "appsec",
    applicability: { when: { fact: "components", operator: "contains", value: "backend_api" } },
  },
  {
    controlId: "A-001", domain: "appsec", subdomain: "injection", layer: "prevent", group: "appsec",
    applicability: { when: { fact: "components", operator: "contains", value: "backend_api" } },
  },
  {
    controlId: "B-001", domain: "infra", subdomain: "network", layer: "prevent", group: "infra",
    applicability: { when: { fact: "components", operator: "contains", value: "backend_api" } },
  },
];

const profile: ProjectProfile = {
  securityLevel: "SVL-2",
  exposure: ["internet_public"],
  components: ["backend_api"],
  features: {},
  technologies: {},
};

function plan(overrides: Partial<AssessmentPlan> = {}): AssessmentPlan {
  return { planId: "P-1", groupBy: "domain", defaultMaxParallelAgents: 1, ...overrides };
}

describe("expandPlan — grouping", () => {
  it("groups by domain, one batch per distinct domain value, sorted by groupValue", () => {
    const drafts = expandPlan(plan(), controls, profile, []);
    expect(drafts).toEqual([
      { groupBy: "domain", groupValue: "appsec", controlIds: ["A-001", "A-002"] },
      { groupBy: "domain", groupValue: "infra", controlIds: ["B-001"] },
    ]);
  });

  it("controlIds within a batch are sorted ascending regardless of input order", () => {
    const drafts = expandPlan(plan(), controls, profile, []);
    const appsec = drafts.find((d) => d.groupValue === "appsec")!;
    expect(appsec.controlIds).toEqual(["A-001", "A-002"]);
  });

  it("groupBy:'controlId' produces one batch per control", () => {
    const drafts = expandPlan(plan({ groupBy: "controlId" }), controls, profile, []);
    expect(drafts.map((d) => d.groupValue).sort()).toEqual(["A-001", "A-002", "B-001"]);
    expect(drafts.every((d) => d.controlIds.length === 1)).toBe(true);
  });
});

describe("expandPlan — selection filters", () => {
  it("selection.domains narrows to matching domains only", () => {
    const drafts = expandPlan(plan({ selection: { domains: ["appsec"] } }), controls, profile, []);
    expect(drafts.map((d) => d.groupValue)).toEqual(["appsec"]);
  });

  it("selection.controlIds narrows to matching controls only", () => {
    const drafts = expandPlan(plan({ selection: { controlIds: ["B-001"] } }), controls, profile, []);
    expect(drafts).toEqual([{ groupBy: "domain", groupValue: "infra", controlIds: ["B-001"] }]);
  });

  it("selection.assessmentStatuses filters by current status, defaulting missing assessments to NOT_TESTED", () => {
    const assessments: AssessmentStatusInput[] = [{ controlId: "A-001", status: "FAIL" }];
    const drafts = expandPlan(plan({ selection: { assessmentStatuses: ["FAIL"] } }), controls, profile, assessments);
    expect(drafts).toEqual([{ groupBy: "domain", groupValue: "appsec", controlIds: ["A-001"] }]);
  });

  it("selection.applicability filters by resolved applicability verdict against the profile", () => {
    const unknownProfile: ProjectProfile = { ...profile, identities: undefined };
    const controlsWithUnknown: PlanControl[] = [
      { ...controls[0], applicability: { when: { fact: "identities", operator: "contains", value: "admin" } } },
    ];
    const drafts = expandPlan(plan({ selection: { applicability: ["unknown"] } }), controlsWithUnknown, unknownProfile, []);
    expect(drafts).toEqual([{ groupBy: "domain", groupValue: "appsec", controlIds: ["A-002"] }]);
  });
});

describe("expandPlan — groupOverrides", () => {
  it("skip:true on a groupValue produces no batch for that group", () => {
    const drafts = expandPlan(plan({ groupOverrides: [{ groupValue: "infra", skip: true }] }), controls, profile, []);
    expect(drafts.map((d) => d.groupValue)).toEqual(["appsec"]);
  });

  it("maxParallelAgents on a groupValue is applied only to that group's batch", () => {
    const drafts = expandPlan(plan({ groupOverrides: [{ groupValue: "appsec", maxParallelAgents: 5 }] }), controls, profile, []);
    const appsec = drafts.find((d) => d.groupValue === "appsec")!;
    const infra = drafts.find((d) => d.groupValue === "infra")!;
    expect(appsec.maxParallelAgents).toBe(5);
    expect(infra.maxParallelAgents).toBeUndefined();
  });

  it("a duplicate groupOverrides entry for the same groupValue throws rather than picking one silently", () => {
    const p = plan({ groupOverrides: [{ groupValue: "appsec", skip: true }, { groupValue: "appsec", maxParallelAgents: 2 }] });
    expect(() => expandPlan(p, controls, profile, [])).toThrow();
  });

  it("an override naming a groupValue with no matching controls after selection is a no-op, not an error", () => {
    const p = plan({ groupOverrides: [{ groupValue: "mobile", skip: true }] });
    const drafts = expandPlan(p, controls, profile, []);
    expect(drafts.map((d) => d.groupValue)).toEqual(["appsec", "infra"]);
  });
});
