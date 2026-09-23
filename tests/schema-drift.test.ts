import { describe, expect, it } from "vitest";
import { loadJson } from "../src/validate.js";

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
}

describe("schema-drift", () => {
  it("Project.profile matches project-profile-schema.json (minus projectId)", () => {
    const projectSchema = loadJson<{ properties: { profile: JsonSchemaObject } }>(
      "data/schemas/project-schema.json"
    );
    const profileSchema = loadJson<JsonSchemaObject>("data/schemas/project-profile-schema.json");
    const embedded = projectSchema.properties.profile;

    const { projectId, ...standaloneProps } = profileSchema.properties ?? {};
    expect(embedded.properties).toEqual(standaloneProps);

    const standaloneRequired = (profileSchema.required ?? []).filter((k) => k !== "projectId");
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });

  it("ProjectReport.score matches score-schema.json (minus projectId and computedAt)", () => {
    const reportSchema = loadJson<{ properties: { score: JsonSchemaObject } }>(
      "data/schemas/project-report-schema.json"
    );
    const scoreSchema = loadJson<JsonSchemaObject>("data/schemas/score-schema.json");
    const embedded = reportSchema.properties.score;

    const { projectId, computedAt, ...standaloneProps } = scoreSchema.properties ?? {};
    expect(embedded.properties).toEqual(standaloneProps);

    const standaloneRequired = (scoreSchema.required ?? []).filter((k) => k !== "projectId" && k !== "computedAt");
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });

  it("ProjectReport.releaseEvaluation matches release-evaluation-schema.json (minus projectId and evaluatedAt)", () => {
    const reportSchema = loadJson<{ properties: { releaseEvaluation: JsonSchemaObject } }>(
      "data/schemas/project-report-schema.json"
    );
    const releaseSchema = loadJson<JsonSchemaObject>("data/schemas/release-evaluation-schema.json");
    const embedded = reportSchema.properties.releaseEvaluation;

    const { projectId, evaluatedAt, ...standaloneProps } = releaseSchema.properties ?? {};
    expect(embedded.properties).toEqual(standaloneProps);

    const standaloneRequired = (releaseSchema.required ?? []).filter(
      (k) => k !== "projectId" && k !== "evaluatedAt"
    );
    expect([...(embedded.required ?? [])].sort()).toEqual([...standaloneRequired].sort());
  });

  it("AssessmentPlan.groupBy enum matches AssessmentBatch.groupBy enum (temporary mirror invariant — spec §3 rule 12)", () => {
    const planSchema = loadJson<{ properties: { groupBy: { enum: string[] } } }>(
      "data/schemas/assessment-plan-schema.json"
    );
    const batchSchema = loadJson<{ properties: { groupBy: { enum: string[] } } }>(
      "data/schemas/assessment-batch-schema.json"
    );
    expect([...planSchema.properties.groupBy.enum].sort()).toEqual(
      [...batchSchema.properties.groupBy.enum].sort()
    );
  });
});
