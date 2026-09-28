import { describe, expect, it } from "vitest";
import { JsonRepository } from "../../src/core/repository.js";

describe("JsonRepository — catalog reads (real data/ tree)", () => {
  const repo = new JsonRepository("data");

  it("getControls returns all 48 real controls", async () => {
    const controls = await repo.getControls();
    expect(controls.length).toBe(48);
  });

  it("getThreats returns the real threat catalog", async () => {
    const threats = await repo.getThreats();
    expect(threats.length).toBeGreaterThan(0);
  });

  it("getCriticalityFormula returns the real formula for its own id", async () => {
    const formula = await repo.getCriticalityFormula("CRIT-DEFAULT");
    expect(formula.weights.impact).toBe(0.35);
  });

  it("getCriticalityFormula throws for an unknown formulaId", async () => {
    await expect(repo.getCriticalityFormula("NOPE")).rejects.toThrow();
  });

  it("getScoreModel returns the real model for its own id", async () => {
    const model = await repo.getScoreModel("USSVS-SCORE-DEFAULT");
    expect(model.statusWeights.PASS).toBe(1.0);
  });

  it("getScoreModel throws for an unknown modelId", async () => {
    await expect(repo.getScoreModel("NOPE")).rejects.toThrow();
  });

  it("getReleaseGates returns gate 4's requiresByLevel thresholds", async () => {
    const gates = await repo.getReleaseGates();
    const gate4 = gates.gates.find((g) => g.gate === 4);
    expect(gate4?.requiresByLevel?.["SVL-3"]).toEqual({ criticalFindings: 0, highFindings: 0 });
  });
});
