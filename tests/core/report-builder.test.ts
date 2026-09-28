import { describe, expect, it } from "vitest";
import { sortPrioritizedFindings, type PrioritizedFindingInput } from "../../src/core/report-builder.js";

describe("sortPrioritizedFindings", () => {
  it("sorts by priorityIndex ascending", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-2", priorityIndex: 5, criticalityIndex: 0, title: "b" },
      { findingId: "F-1", priorityIndex: 1, criticalityIndex: 0, title: "a" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-1", "F-2"]);
  });

  it("breaks a priorityIndex tie by criticalityIndex descending", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-low", priorityIndex: 1, criticalityIndex: 3, title: "low" },
      { findingId: "F-high", priorityIndex: 1, criticalityIndex: 9, title: "high" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-high", "F-low"]);
  });

  it("breaks a priorityIndex+criticalityIndex tie by findingId ascending, guaranteeing a deterministic total order", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-Z", priorityIndex: 2, criticalityIndex: 7, title: "z" },
      { findingId: "F-A", priorityIndex: 2, criticalityIndex: 7, title: "a" },
    ];
    expect(sortPrioritizedFindings(findings).map((f) => f.findingId)).toEqual(["F-A", "F-Z"]);
  });

  it("does not mutate the input array", () => {
    const findings: PrioritizedFindingInput[] = [
      { findingId: "F-2", priorityIndex: 5, criticalityIndex: 0, title: "b" },
      { findingId: "F-1", priorityIndex: 1, criticalityIndex: 0, title: "a" },
    ];
    const original = [...findings];
    sortPrioritizedFindings(findings);
    expect(findings).toEqual(original);
  });
});
