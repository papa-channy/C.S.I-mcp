export interface SeverityFactors {
  impact: number;
  exploitability: number;
  exposure: number;
  privilegeRequired: number;
  detectionDifficulty: number;
}

export interface CriticalityFormula {
  formulaId: string;
  version: string;
  scaleMax: number;
  directions: Record<keyof SeverityFactors, "higher_is_worse" | "lower_is_worse">;
  ranges: Record<keyof SeverityFactors, { min: number; max: number }>;
  weights: Record<keyof SeverityFactors, number>;
  rounding: "round" | "floor" | "ceil";
}

export interface CriticalityResult {
  index: number;
  formulaId: string;
  formulaVersion: string;
  computedAt: string;
}

const FACTOR_KEYS: (keyof SeverityFactors)[] = ["impact", "exploitability", "exposure", "privilegeRequired", "detectionDifficulty"];

function normalize(value: number, range: { min: number; max: number }, direction: "higher_is_worse" | "lower_is_worse"): number {
  const span = range.max - range.min;
  return direction === "higher_is_worse" ? (value - range.min) / span : (range.max - value) / span;
}

function applyRounding(value: number, rounding: "round" | "floor" | "ceil"): number {
  if (rounding === "floor") return Math.floor(value);
  if (rounding === "ceil") return Math.ceil(value);
  return Math.round(value);
}

export function calculateCriticality(factors: SeverityFactors, formula: CriticalityFormula, now: () => string): CriticalityResult {
  const weightedSum = FACTOR_KEYS.reduce((sum, key) => {
    const normalized = normalize(factors[key], formula.ranges[key], formula.directions[key]);
    return sum + normalized * formula.weights[key];
  }, 0);
  const index = applyRounding(weightedSum * formula.scaleMax, formula.rounding);
  return { index, formulaId: formula.formulaId, formulaVersion: formula.version, computedAt: now() };
}
