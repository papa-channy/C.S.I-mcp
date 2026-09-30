import { describe, expect, it } from "vitest";
import { loadJson } from "../../src/validate.js";

describe("core/principles.json", () => {
  it("has all 7 core principles and the final principle", () => {
    const data = loadJson<{ principles: unknown[]; antiPatterns: unknown[]; layers: unknown[]; finalPrinciple: unknown }>(
      "data/core/principles.json"
    );
    expect(data.principles).toHaveLength(7);
    expect(data.antiPatterns.length).toBeGreaterThan(0);
    expect(data.layers).toHaveLength(5);
    expect(data.finalPrinciple).toBeDefined();
  });
});

describe("core/security-levels.json", () => {
  it("has 4 security levels and escalation rules", () => {
    const data = loadJson<{ levels: unknown[]; autoEscalation: { minimumSvl2: unknown[]; requiresSvl3Review: unknown[] } }>(
      "data/core/security-levels.json"
    );
    expect(data.levels).toHaveLength(4);
    expect(data.autoEscalation.minimumSvl2.length).toBeGreaterThan(0);
    expect(data.autoEscalation.requiresSvl3Review.length).toBeGreaterThan(0);
  });
});

describe("core/profile-taxonomy.json", () => {
  it("has exposure, identities, and D0-D3 data classification", () => {
    const data = loadJson<{ exposure: unknown[]; identities: unknown[]; dataClassification: { id: string }[] }>(
      "data/core/profile-taxonomy.json"
    );
    expect(data.exposure.length).toBeGreaterThan(0);
    expect(data.identities.length).toBeGreaterThan(0);
    expect(data.dataClassification.map((d) => d.id)).toEqual(["D0", "D1", "D2", "D3"]);
  });

  it("has the 8 canonical components referenced by real controls' applicability rules", () => {
    const data = loadJson<{ components: { value: string }[] }>("data/core/profile-taxonomy.json");
    expect(data.components.map((c) => c.value).sort()).toEqual(
      [
        "backend_api",
        "browser_frontend",
        "ci_pipeline",
        "container_image",
        "database",
        "file_storage",
        "mobile_app",
        "release_pipeline",
      ].sort()
    );
  });
});
