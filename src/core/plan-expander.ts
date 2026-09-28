import { evaluateApplicability, type ProjectProfile, type RuleNode, type Verdict } from "./applicability.js";

export interface AssessmentPlanSelection {
  applicability?: Verdict[];
  assessmentStatuses?: string[];
  domains?: string[];
  controlIds?: string[];
}

export interface GroupOverride {
  groupValue: string;
  maxParallelAgents?: number;
  skip?: boolean;
}

export interface AssessmentPlan {
  planId: string;
  selection?: AssessmentPlanSelection;
  groupBy: "domain" | "subdomain" | "layer" | "group" | "controlId";
  defaultMaxParallelAgents: number;
  groupOverrides?: GroupOverride[];
}

export interface PlanControl {
  controlId: string;
  domain: string;
  subdomain: string;
  layer: string;
  group: string;
  applicability: { when: RuleNode };
}

export interface AssessmentStatusInput {
  controlId: string;
  status: string;
}

export interface BatchDraft {
  groupBy: string;
  groupValue: string;
  controlIds: string[];
  maxParallelAgents?: number;
}

function groupValueOf(control: PlanControl, groupBy: AssessmentPlan["groupBy"]): string {
  if (groupBy === "controlId") return control.controlId;
  return control[groupBy];
}

export function expandPlan(
  plan: AssessmentPlan,
  controls: PlanControl[],
  profile: ProjectProfile,
  assessments: AssessmentStatusInput[]
): BatchDraft[] {
  let selected = controls;
  const selection = plan.selection ?? {};

  if (selection.controlIds && selection.controlIds.length > 0) {
    const idSet = new Set(selection.controlIds);
    selected = selected.filter((c) => idSet.has(c.controlId));
  }
  if (selection.domains && selection.domains.length > 0) {
    const domainSet = new Set(selection.domains);
    selected = selected.filter((c) => domainSet.has(c.domain));
  }
  if (selection.assessmentStatuses && selection.assessmentStatuses.length > 0) {
    const statusByControl = new Map(assessments.map((a) => [a.controlId, a.status]));
    const statusSet = new Set(selection.assessmentStatuses);
    selected = selected.filter((c) => statusSet.has(statusByControl.get(c.controlId) ?? "NOT_TESTED"));
  }
  if (selection.applicability && selection.applicability.length > 0) {
    const verdictSet = new Set(selection.applicability);
    selected = selected.filter((c) => verdictSet.has(evaluateApplicability(c, profile).autoResult));
  }

  const overrideKeys = new Set<string>();
  for (const override of plan.groupOverrides ?? []) {
    if (overrideKeys.has(override.groupValue)) {
      throw new Error(`expandPlan: duplicate groupOverrides entry for groupValue "${override.groupValue}"`);
    }
    overrideKeys.add(override.groupValue);
  }
  const overridesByGroup = new Map((plan.groupOverrides ?? []).map((o) => [o.groupValue, o]));

  const groups = new Map<string, PlanControl[]>();
  for (const control of selected) {
    const key = groupValueOf(control, plan.groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(control);
  }

  const drafts: BatchDraft[] = [];
  for (const [groupValue, groupControls] of groups) {
    const override = overridesByGroup.get(groupValue);
    if (override?.skip) continue;
    const controlIds = groupControls.map((c) => c.controlId).sort();
    drafts.push({
      groupBy: plan.groupBy,
      groupValue,
      controlIds,
      ...(override?.maxParallelAgents !== undefined ? { maxParallelAgents: override.maxParallelAgents } : {}),
    });
  }

  drafts.sort((a, b) => a.groupValue.localeCompare(b.groupValue));
  return drafts;
}
