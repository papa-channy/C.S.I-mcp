import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function loadJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

// strict:false avoids Ajv strict-mode friction on constructs this project
// relies on (recursive $defs, if/then siblings, format keywords) while still
// enforcing full JSON Schema draft 2020-12 validation semantics.
export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

export function compileSchemaFromFile(schemaPath: string): ValidateFunction {
  const ajv = createAjv();
  const schema = loadJson<object>(schemaPath);
  return ajv.compile(schema);
}
