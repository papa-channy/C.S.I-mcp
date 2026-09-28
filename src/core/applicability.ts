export type Verdict = "applicable" | "not_applicable" | "unknown";

export interface FactCondition {
  fact: string;
  operator: "eq" | "ne" | "in" | "not_in" | "contains" | "intersects" | "gt" | "gte" | "lt" | "lte";
  value: unknown;
}

export type RuleNode = { all: RuleNode[] } | { any: RuleNode[] } | FactCondition;

export interface Control {
  controlId: string;
  applicability: { when: RuleNode };
}

export interface ProjectProfile {
  securityLevel: string;
  exposure: string[];
  components?: string[];
  identities?: string[];
  dataClasses?: string[];
  features?: Record<string, boolean>;
  technologies?: { languages?: string[]; frameworks?: string[]; databases?: string[]; cloud?: string[] };
}

export interface ApplicabilityResult {
  autoResult: Verdict;
  matchedRules: string[];
}

// Only these three fields carry the three-valued (omitted=UNKNOWN, []=NONE, [...]=KNOWN) contract per
// project-profile-schema.json's descriptions. `features` itself is required, so an omitted features.* boolean
// is its literal undefined value, not UNKNOWN — see the spec's §3.
const THREE_VALUED_ROOT_FIELDS = new Set(["components", "identities", "dataClasses"]);

function getFactValue(profile: ProjectProfile, fact: string): unknown {
  let current: unknown = profile;
  for (const segment of fact.split(".")) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function evaluateOperator(operator: FactCondition["operator"], factValue: unknown, target: unknown): boolean {
  switch (operator) {
    case "eq":
      return factValue === target;
    case "ne":
      return factValue !== target;
    case "in":
      return Array.isArray(target) && target.includes(factValue);
    case "not_in":
      return Array.isArray(target) && !target.includes(factValue);
    case "contains":
      return Array.isArray(factValue) && factValue.includes(target);
    case "intersects":
      return Array.isArray(factValue) && Array.isArray(target) && factValue.some((v) => target.includes(v));
    case "gt":
      return typeof factValue === "number" && typeof target === "number" && factValue > target;
    case "gte":
      return typeof factValue === "number" && typeof target === "number" && factValue >= target;
    case "lt":
      return typeof factValue === "number" && typeof target === "number" && factValue < target;
    case "lte":
      return typeof factValue === "number" && typeof target === "number" && factValue <= target;
  }
}

function evaluateLeaf(condition: FactCondition, profile: ProjectProfile): Verdict {
  const rootField = condition.fact.split(".")[0];
  const factValue = getFactValue(profile, condition.fact);
  if (factValue === undefined && THREE_VALUED_ROOT_FIELDS.has(rootField)) {
    return "unknown";
  }
  return evaluateOperator(condition.operator, factValue, condition.value) ? "applicable" : "not_applicable";
}

interface NodeResult {
  verdict: Verdict;
  matchedRules: string[];
}

function prefixChild(kind: "all" | "any", index: number, child: NodeResult): string[] {
  if (child.matchedRules.length === 0) return [`${kind}[${index}]`];
  return child.matchedRules.map((p) => `${kind}[${index}].${p}`);
}

function evaluateNode(node: RuleNode, profile: ProjectProfile): NodeResult {
  if ("all" in node) {
    const results = node.all.map((child, i) => ({ i, result: evaluateNode(child, profile) }));
    const notApplicable = results.filter((r) => r.result.verdict === "not_applicable");
    if (notApplicable.length > 0) {
      return { verdict: "not_applicable", matchedRules: notApplicable.flatMap((r) => prefixChild("all", r.i, r.result)) };
    }
    if (results.every((r) => r.result.verdict === "applicable")) {
      return { verdict: "applicable", matchedRules: results.flatMap((r) => prefixChild("all", r.i, r.result)) };
    }
    const unknowns = results.filter((r) => r.result.verdict === "unknown");
    return { verdict: "unknown", matchedRules: unknowns.flatMap((r) => prefixChild("all", r.i, r.result)) };
  }
  if ("any" in node) {
    const results = node.any.map((child, i) => ({ i, result: evaluateNode(child, profile) }));
    const applicable = results.filter((r) => r.result.verdict === "applicable");
    if (applicable.length > 0) {
      return { verdict: "applicable", matchedRules: applicable.flatMap((r) => prefixChild("any", r.i, r.result)) };
    }
    if (results.every((r) => r.result.verdict === "not_applicable")) {
      return { verdict: "not_applicable", matchedRules: results.flatMap((r) => prefixChild("any", r.i, r.result)) };
    }
    const unknowns = results.filter((r) => r.result.verdict === "unknown");
    return { verdict: "unknown", matchedRules: unknowns.flatMap((r) => prefixChild("any", r.i, r.result)) };
  }
  return { verdict: evaluateLeaf(node, profile), matchedRules: [] };
}

export function evaluateApplicability(control: Control, profile: ProjectProfile): ApplicabilityResult {
  const result = evaluateNode(control.applicability.when, profile);
  return { autoResult: result.verdict, matchedRules: result.matchedRules };
}
