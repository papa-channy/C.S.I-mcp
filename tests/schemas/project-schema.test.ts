import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

describe("project-schema", () => {
  const valid = {
    projectId: "PRJ-001",
    name: "Example Storefront",
    owner: "security-team",
    createdAt: "2026-09-19T05:00:00Z",
    profileRevision: 1,
    profile: {
      securityLevel: "SVL-2",
      exposure: ["internet_public"],
      components: ["browser_frontend", "backend_api", "database"],
      identities: ["anonymous", "user", "administrator"],
      dataClasses: ["D1", "D2"],
      features: {
        authentication: true,
        authorization: true,
        adminInterface: true,
        fileUpload: false,
        payment: true,
        webhook: false,
        oauth: false,
        ai: false,
      },
      technologies: {
        languages: ["typescript"],
        frameworks: ["nextjs"],
        databases: ["postgresql"],
        cloud: ["aws"],
      },
    },
  };

  it("accepts a well-formed project", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a profile that embeds a projectId", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const withProjectId = { ...valid, profile: { ...valid.profile, projectId: "PRJ-001" } };
    expect(validate(withProjectId)).toBe(false);
  });

  it("rejects a project missing profileRevision", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const { profileRevision, ...rest } = valid;
    expect(validate(rest)).toBe(false);
  });

  it("accepts a profile with some feature flags omitted (unknown, not false)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const { fileUpload, ai, ...restFeatures } = valid.profile.features;
    const partial = { ...valid, profile: { ...valid.profile, features: restFeatures } };
    expect(validate(partial), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a profile with components/identities/dataClasses omitted entirely (unknown, not empty)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-schema.json");
    const { components, identities, dataClasses, ...restProfile } = valid.profile;
    const partial = { ...valid, profile: restProfile };
    expect(validate(partial), JSON.stringify(validate.errors)).toBe(true);
  });
});
