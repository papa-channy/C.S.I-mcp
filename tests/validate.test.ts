import { describe, expect, it } from "vitest";
import { compileSchemaFromFile, createAjv, loadJson } from "../src/validate.js";

describe("validate utility", () => {
  it("loadJson parses a JSON file", () => {
    const data = loadJson<{ hello: string }>("tests/fixtures/sample-schema.json");
    expect(data).toBeTypeOf("object");
  });

  it("createAjv returns a configured Ajv instance", () => {
    const ajv = createAjv();
    const validate = ajv.compile({ type: "string" });
    expect(validate("ok")).toBe(true);
    expect(validate(123)).toBe(false);
  });

  it("compileSchemaFromFile compiles a schema loaded from disk", () => {
    const validate = compileSchemaFromFile("tests/fixtures/sample-schema.json");
    expect(validate({ name: "widget" })).toBe(true);
    expect(validate({})).toBe(false);
  });
});
