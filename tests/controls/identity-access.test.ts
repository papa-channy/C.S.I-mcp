import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, loadJson } from "../../src/validate.js";

describe("controls/identity-access.json", () => {
  it("has exactly 12 controls, each validating against control-schema.json", () => {
    const validate = compileSchemaFromFile("data/schemas/control-schema.json");
    const controls = loadJson<unknown[]>("data/controls/identity-access.json");
    expect(controls).toHaveLength(12);
    for (const control of controls) {
      expect(validate(control), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("has unique controlIds", () => {
    const controls = loadJson<{ controlId: string }[]>("data/controls/identity-access.json");
    const ids = controls.map((c) => c.controlId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only threatIds that exist in catalogs/threats.json", () => {
    const controls = loadJson<{ threatIds: string[] }[]>("data/controls/identity-access.json");
    const threats = loadJson<{ threats: { threatId: string }[] }>("data/catalogs/threats.json");
    const knownThreatIds = new Set(threats.threats.map((t) => t.threatId));
    for (const control of controls) {
      for (const threatId of control.threatIds) {
        expect(knownThreatIds.has(threatId), `unknown threatId: ${threatId}`).toBe(true);
      }
    }
  });

  it("covers both the authentication and authorization domains", () => {
    const controls = loadJson<{ domain: string }[]>("data/controls/identity-access.json");
    const domains = new Set(controls.map((c) => c.domain));
    expect(domains).toEqual(new Set(["authentication", "authorization"]));
  });
});
