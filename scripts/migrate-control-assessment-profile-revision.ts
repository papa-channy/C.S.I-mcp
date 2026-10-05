import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { compileSchemaFromFile } from "../src/validate.js";

interface MigrationResult {
  migrated: number;
  skipped: { controlId: string; reason: string }[];
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, path);
}

export function migrateProject(dataDir: string, projectId: string): MigrationResult {
  const projectDir = join(dataDir, "projects", projectId);
  const assessmentsPath = join(projectDir, "assessments.json");
  if (!existsSync(assessmentsPath)) {
    return { migrated: 0, skipped: [] };
  }
  const assessments: Record<string, unknown>[] = JSON.parse(readFileSync(assessmentsPath, "utf-8"));

  const runsDir = join(projectDir, "runs");
  const runFiles = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith(".json")) : [];
  const runs = runFiles.map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf-8")) as { runId: string; profileRevision?: number });

  const result: MigrationResult = { migrated: 0, skipped: [] };
  const next = assessments.map((a) => {
    // Already migrated: leave untouched, don't count as migrated or skipped (idempotent re-run).
    if (typeof a.runId === "string" && typeof a.profileRevision === "number") {
      return a;
    }
    const controlId = String(a.controlId ?? a.assessmentId ?? "<unknown>");
    if (runs.length === 0) {
      result.skipped.push({ controlId, reason: "no runs found for this project" });
      return a;
    }
    if (runs.length > 1) {
      result.skipped.push({ controlId, reason: `${runs.length} runs found for this project — ambiguous, needs manual review` });
      return a;
    }
    const [run] = runs;
    if (typeof run.profileRevision !== "number") {
      result.skipped.push({ controlId, reason: `matched run ${run.runId} has no profileRevision` });
      return a;
    }
    result.migrated++;
    return { ...a, runId: run.runId, profileRevision: run.profileRevision };
  });

  if (result.migrated > 0) {
    const validate = compileSchemaFromFile("data/schemas/control-assessment-schema.json");
    const invalid = next.filter((a) => !validate(a));
    if (invalid.length > 0) {
      throw new Error(
        `migrateProject(${projectId}): ${invalid.length} transformed assessment(s) failed schema validation — ` +
        `aborting without writing. First error: ${JSON.stringify(validate.errors?.[0])}`
      );
    }
    writeJsonAtomic(assessmentsPath, next);
  }

  return result;
}

function main(): void {
  const dataDir = process.argv[2] ?? "data";
  const projectsDir = join(dataDir, "projects");
  if (!existsSync(projectsDir)) {
    console.error(`No projects directory found at ${projectsDir}`);
    process.exit(1);
  }
  const projectIds = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let totalMigrated = 0;
  const totalSkipped: { projectId: string; controlId: string; reason: string }[] = [];
  for (const projectId of projectIds) {
    const result = migrateProject(dataDir, projectId);
    totalMigrated += result.migrated;
    for (const s of result.skipped) totalSkipped.push({ projectId, ...s });
    if (result.migrated > 0 || result.skipped.length > 0) {
      console.error(`${projectId}: migrated ${result.migrated}, skipped ${result.skipped.length}`);
    }
  }
  console.error(`\nTotal: migrated ${totalMigrated} assessment(s) across ${projectIds.length} project(s).`);
  if (totalSkipped.length > 0) {
    console.error(`${totalSkipped.length} assessment(s) skipped — needs manual review:`);
    for (const s of totalSkipped) console.error(`  ${s.projectId} / ${s.controlId}: ${s.reason}`);
  }
}

if (process.argv[1]?.endsWith("migrate-control-assessment-profile-revision.ts")) {
  main();
}
