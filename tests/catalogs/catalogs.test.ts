import { describe, expect, it } from "vitest";
import { createAjv, loadJson } from "../../src/validate.js";

describe("catalogs/threats.json", () => {
  it("contains only threats that validate against threat-schema.json", () => {
    const schema = loadJson<object>("data/schemas/threat-schema.json");
    const ajv = createAjv();
    const validate = ajv.compile(schema);
    const data = loadJson<{ threats: unknown[] }>("data/catalogs/threats.json");
    expect(data.threats.length).toBeGreaterThan(0);
    for (const threat of data.threats) {
      expect(validate(threat), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("has unique threatIds", () => {
    const data = loadJson<{ threats: { threatId: string }[] }>("data/catalogs/threats.json");
    const ids = data.threats.map((t) => t.threatId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("catalogs/evidence-types.json", () => {
  it("lists all 14 evidence types and a priority tier order", () => {
    const data = loadJson<{ types: string[]; priorityTiers: { tier: number; types: string[] }[] }>(
      "data/catalogs/evidence-types.json"
    );
    expect(data.types).toHaveLength(14);
    expect(data.priorityTiers.length).toBeGreaterThan(0);
    const tieredTypes = data.priorityTiers.flatMap((t) => t.types);
    expect(new Set(tieredTypes)).toEqual(new Set(data.types));
  });
});

describe("catalogs/owner-roles.json", () => {
  it("lists the 10 owner roles used by control-schema.json's ownerRole enum", () => {
    const data = loadJson<{ roles: string[] }>("data/catalogs/owner-roles.json");
    expect(data.roles).toEqual([
      "application", "frontend", "backend", "infrastructure", "devops",
      "security", "product", "privacy", "operations", "vendor",
    ]);
  });
});

describe("catalogs/asset-types.json and references.json", () => {
  it("asset-types.json has a non-empty assetTypes list", () => {
    const data = loadJson<{ assetTypes: string[] }>("data/catalogs/asset-types.json");
    expect(data.assetTypes.length).toBeGreaterThan(0);
  });

  it("references.json parses as an object with a references array", () => {
    const data = loadJson<{ references: unknown[] }>("data/catalogs/references.json");
    expect(Array.isArray(data.references)).toBe(true);
  });
});
