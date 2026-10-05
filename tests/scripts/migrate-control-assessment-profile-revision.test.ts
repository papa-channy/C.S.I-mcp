import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateProject } from "../../scripts/migrate-control-assessment-profile-revision.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "csi-mcp-migrate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(projectId: string, runs: { runId: string; profileRevision: number }[], assessments: Record<string, unknown>[]) {
  const projectDir = join(dir, "projects", projectId);
  mkdirSync(join(projectDir, "runs"), { recursive: true });
  for (const run of runs) {
    writeFileSync(join(projectDir, "runs", `${run.runId}.json`), JSON.stringify({ runId: run.runId, projectId, profileRevision: run.profileRevision }));
  }
  writeFileSync(join(projectDir, "assessments.json"), JSON.stringify(assessments));
}

function assessment(controlId: string): Record<string, unknown> {
  return {
    assessmentId: `A-${controlId}`, projectId: "PRJ-SINGLE-RUN", controlId, controlVersion: 1,
    applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
    status: "PASS", evidenceIds: [], findingIds: [], riskAcceptanceId: null,
    owner: "csi-mcp-agent", assessedBy: "csi-mcp-agent", assessedAt: "2026-09-16T00:00:00.000Z", nextReviewAt: null, notes: null,
  };
}

describe("migrateProject", () => {
  it("backfills every assessment with its project's single run's runId/profileRevision", () => {
    writeProject("PRJ-SINGLE-RUN", [{ runId: "RUN-1", profileRevision: 3 }], [assessment("A-001"), assessment("A-002")]);
    const result = migrateProject(dir, "PRJ-SINGLE-RUN");
    expect(result.migrated).toBe(2);
    expect(result.skipped).toEqual([]);
    const written = JSON.parse(readFileSync(join(dir, "projects", "PRJ-SINGLE-RUN", "assessments.json"), "utf-8"));
    expect(written).toHaveLength(2);
    for (const a of written) {
      expect(a.runId).toBe("RUN-1");
      expect(a.profileRevision).toBe(3);
    }
  });

  it("skips and reports every assessment in a project with zero runs", () => {
    const projectDir = join(dir, "projects", "PRJ-NO-RUNS");
    mkdirSync(join(projectDir, "runs"), { recursive: true });
    writeFileSync(join(projectDir, "assessments.json"), JSON.stringify([assessment("A-001")]));
    const result = migrateProject(dir, "PRJ-NO-RUNS");
    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual([{ controlId: "A-001", reason: "no runs found for this project" }]);
  });

  it("skips and reports every assessment in a project with more than one run (ambiguous join)", () => {
    writeProject("PRJ-TWO-RUNS", [{ runId: "RUN-1", profileRevision: 1 }, { runId: "RUN-2", profileRevision: 2 }], [assessment("A-001")]);
    const result = migrateProject(dir, "PRJ-TWO-RUNS");
    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual([{ controlId: "A-001", reason: "2 runs found for this project — ambiguous, needs manual review" }]);
  });

  it("skips and reports an assessment whose matched run has no profileRevision", () => {
    const projectDir = join(dir, "projects", "PRJ-BAD-RUN");
    mkdirSync(join(projectDir, "runs"), { recursive: true });
    writeFileSync(join(projectDir, "runs", "RUN-1.json"), JSON.stringify({ runId: "RUN-1", projectId: "PRJ-BAD-RUN" })); // no profileRevision
    writeFileSync(join(projectDir, "assessments.json"), JSON.stringify([assessment("A-001")]));
    const result = migrateProject(dir, "PRJ-BAD-RUN");
    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual([{ controlId: "A-001", reason: "matched run RUN-1 has no profileRevision" }]);
  });

  it("is idempotent: re-running on already-migrated data changes nothing and reports 0 migrated, 0 skipped", () => {
    writeProject("PRJ-SINGLE-RUN", [{ runId: "RUN-1", profileRevision: 3 }], [assessment("A-001")]);
    migrateProject(dir, "PRJ-SINGLE-RUN");
    const second = migrateProject(dir, "PRJ-SINGLE-RUN");
    expect(second.migrated).toBe(0);
    expect(second.skipped).toEqual([]);
  });

  it("throws and leaves the file untouched if a transformed assessment would fail schema validation (pre-existing corruption, not something the migration itself can introduce)", () => {
    const corrupt = { ...assessment("A-001") };
    delete (corrupt as Record<string, unknown>).assessedAt; // simulates pre-existing bad data, independent of this migration
    writeProject("PRJ-CORRUPT", [{ runId: "RUN-1", profileRevision: 3 }], [corrupt]);
    const before = readFileSync(join(dir, "projects", "PRJ-CORRUPT", "assessments.json"), "utf-8");
    expect(() => migrateProject(dir, "PRJ-CORRUPT")).toThrow(/schema validation/);
    const after = readFileSync(join(dir, "projects", "PRJ-CORRUPT", "assessments.json"), "utf-8");
    expect(after).toBe(before); // nothing written — the safety net aborts before any write
  });
});
