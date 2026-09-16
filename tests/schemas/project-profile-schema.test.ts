import { describe, expect, it } from "vitest";
import { compileSchemaFromFile } from "../../src/validate.js";

const validProfile = {
  projectId: "proj-001",
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
    payment: false,
    webhook: true,
    oauth: true,
    ai: false,
  },
  technologies: {
    languages: ["typescript"],
    frameworks: ["nextjs", "nestjs"],
    databases: ["postgresql"],
    cloud: ["aws"],
  },
};

describe("project-profile-schema", () => {
  it("accepts a fully-specified profile", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    expect(validate(validProfile), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a profile with some feature flags omitted (unknown, not false)", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    const { fileUpload, ai, ...restFeatures } = validProfile.features;
    const partial = { ...validProfile, features: restFeatures };
    expect(validate(partial), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown securityLevel value", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    expect(validate({ ...validProfile, securityLevel: "SVL-9" })).toBe(false);
  });

  it("rejects a profile missing projectId", () => {
    const validate = compileSchemaFromFile("data/schemas/project-profile-schema.json");
    const { projectId, ...rest } = validProfile;
    expect(validate(rest)).toBe(false);
  });
});
