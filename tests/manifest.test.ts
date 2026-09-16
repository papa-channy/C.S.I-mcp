import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadJson } from "../src/validate.js";

interface Manifest {
  catalog: string;
  catalogVersion: string;
  schemaVersion: string;
  core: { files: string[] };
  catalogs: { files: string[] };
  controls: { count: number; files: string[] };
  schemas: { files: string[] };
  process: { files: string[] };
}

describe("data/manifest.json", () => {
  it("lists only files that actually exist on disk", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    const allListed = [
      ...manifest.core.files,
      ...manifest.catalogs.files,
      ...manifest.controls.files,
      ...manifest.schemas.files,
      ...manifest.process.files,
    ];
    expect(allListed.length).toBeGreaterThan(0);
    for (const relativePath of allListed) {
      expect(existsSync(`data/${relativePath}`), `missing file: data/${relativePath}`).toBe(true);
    }
  });

  it("lists exactly the 10 schema files defined by the spec", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    expect(new Set(manifest.schemas.files)).toEqual(
      new Set([
        "schemas/control-schema.json",
        "schemas/threat-schema.json",
        "schemas/project-profile-schema.json",
        "schemas/asset-schema.json",
        "schemas/control-assessment-schema.json",
        "schemas/evidence-schema.json",
        "schemas/finding-schema.json",
        "schemas/attack-path-schema.json",
        "schemas/risk-acceptance-schema.json",
        "schemas/release-evaluation-schema.json",
      ])
    );
  });

  it("controls.count matches the total number of control records across controls.files", () => {
    const manifest = loadJson<Manifest>("data/manifest.json");
    let total = 0;
    for (const relativePath of manifest.controls.files) {
      const records = loadJson<unknown[]>(`data/${relativePath}`);
      total += records.length;
    }
    expect(manifest.controls.count).toBe(total);
  });
});
