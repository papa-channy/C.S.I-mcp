import { describe, expect, it } from "vitest";
import { loadJson } from "../../src/validate.js";

describe("process/exception-policy.json", () => {
  it("defines the full exception lifecycle", () => {
    const data = loadJson<{ lifecycle: string[] }>("data/process/exception-policy.json");
    expect(data.lifecycle).toEqual([
      "request", "risk_analysis", "approval", "compensating_control",
      "expiration", "review", "fix_renew_or_reject",
    ]);
  });
});

describe("process/metrics.json", () => {
  it("lists forbidden interpretations and recommended metrics", () => {
    const data = loadJson<{ forbiddenInterpretations: unknown[]; recommendedMetrics: unknown[] }>(
      "data/process/metrics.json"
    );
    expect(data.forbiddenInterpretations.length).toBeGreaterThan(0);
    expect(data.recommendedMetrics.length).toBeGreaterThan(0);
  });
});

describe("process/deliverables.json", () => {
  it("lists final deliverables and the 10 final questions", () => {
    const data = loadJson<{ finalDeliverables: unknown[]; finalJudgmentDimensions: unknown[]; finalQuestions: unknown[] }>(
      "data/process/deliverables.json"
    );
    expect(data.finalDeliverables).toHaveLength(14);
    expect(data.finalJudgmentDimensions).toHaveLength(5);
    expect(data.finalQuestions).toHaveLength(10);
  });
});
