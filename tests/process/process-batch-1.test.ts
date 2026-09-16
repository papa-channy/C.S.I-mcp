import { describe, expect, it } from "vitest";
import { loadJson } from "../../src/validate.js";

describe("process/verification-flow.json", () => {
  it("has all 13 flow steps in order and a testing matrix", () => {
    const data = loadJson<{ flow: { step: number }[]; testingMatrix: Record<string, unknown> }>(
      "data/process/verification-flow.json"
    );
    expect(data.flow.map((f) => f.step)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(Object.keys(data.testingMatrix).length).toBeGreaterThan(0);
  });
});

describe("process/release-gates.json", () => {
  it("has gates 0 through 4 and a release blocker list", () => {
    const data = loadJson<{ gates: { gate: number }[]; releaseBlockers: unknown[]; revalidationTriggers: unknown[] }>(
      "data/process/release-gates.json"
    );
    expect(data.gates.map((g) => g.gate)).toEqual([0, 1, 2, 3, 4]);
    expect(data.releaseBlockers.length).toBeGreaterThan(0);
    expect(data.revalidationTriggers.length).toBeGreaterThan(0);
  });
});

describe("process/incident-response.json", () => {
  it("has a readiness checklist and the key question", () => {
    const data = loadJson<{ readinessChecklist: unknown[]; keyQuestion: string }>(
      "data/process/incident-response.json"
    );
    expect(data.readinessChecklist.length).toBeGreaterThan(0);
    expect(data.keyQuestion.length).toBeGreaterThan(0);
  });
});
