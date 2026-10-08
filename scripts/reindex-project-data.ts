// Regenerates human-readable navigation aids over data/projects/ — an INDEX.md listing every
// project, a readable slug symlink per project (data/projects/<slug> -> <uuid>/, the uuid stays
// the canonical projectId used everywhere in code/schemas/reports), and per-project reports/
// and runs/ INDEX.md files plus reports/latest.json|latest.html symlinks. Purely additive:
// never touches project.json/assessments.json/reports/*.json/runs/*.json content, and nothing
// in src/ reads any file this script produces — it exists only for local human navigation.
// Safe to re-run anytime; every write is idempotent (skipped if already correct).
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectRecord {
  projectId: string;
  slug: string;
  name: string;
  createdAt: string;
  runCount: number;
  latestReport: ReportEntry | null;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Strips the "(owner/repo)" parenthetical and this project's own validation-run boilerplate,
// keeping whatever text actually distinguishes one project record from another (e.g. two
// re-assessments of the same target repo under different conditions).
export function deriveProjectSlug(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, " ");
  const withoutBoilerplate = withoutParens.replace(/c\.s\.i-mcp/gi, " ").replace(/validation run/gi, " ");
  const cleaned = withoutBoilerplate.replace(/[—–]/g, " ").trim();
  return slugify(cleaned) || slugify(name) || "project";
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export interface ReportEntry {
  reportId: string;
  generatedAt: string;
  reportSchemaVersion: string | null;
  verdict: string | null;
  hasHtml: boolean;
  readableName: string;
}

// A Finder-readable name for a report that actually has an HTML rendering — date first (so
// Finder's default alpha sort is also chronological), then verdict (scannable without opening
// the file), then an 8-char reportId prefix (uniqueness — two reports generated the same day
// get distinct names). Never used as the file's real identity; it's a symlink name pointing at
// the real <reportId>.html/.json, which stays the canonical, code-readable filename.
export function readableReportName(reportId: string, generatedAt: string, verdict: string | null): string {
  const date = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : "no-date";
  return `${date}--${verdict ?? "no-verdict"}--${reportId.slice(0, 8)}`;
}

function listReportEntries(projectDir: string): ReportEntry[] {
  const reportsDir = join(projectDir, "reports");
  if (!existsSync(reportsDir)) return [];
  const files = readdirSync(reportsDir).filter((f) => f.endsWith(".json"));
  const entries = files.map((f) => {
    const reportId = f.replace(/\.json$/, "");
    const report = readJson<{ generatedAt?: string; reportSchemaVersion?: string; releaseEvaluation?: { result?: string } }>(join(reportsDir, f));
    const generatedAt = report?.generatedAt ?? "";
    const verdict = report?.releaseEvaluation?.result ?? null;
    return {
      reportId,
      generatedAt,
      reportSchemaVersion: report?.reportSchemaVersion ?? null,
      verdict,
      hasHtml: existsSync(join(reportsDir, `${reportId}.html`)),
      readableName: readableReportName(reportId, generatedAt, verdict),
    };
  });
  return entries.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : a.generatedAt > b.generatedAt ? -1 : 0));
}

function listRunEntries(projectDir: string): { runId: string; status: string | null; startedAt: string | null; completedAt: string | null }[] {
  const runsDir = join(projectDir, "runs");
  if (!existsSync(runsDir)) return [];
  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  const entries = files.map((f) => {
    const run = readJson<{ status?: string; startedAt?: string | null; completedAt?: string | null }>(join(runsDir, f));
    return {
      runId: f.replace(/\.json$/, ""),
      status: run?.status ?? null,
      startedAt: run?.startedAt ?? null,
      completedAt: run?.completedAt ?? null,
    };
  });
  return entries.sort((a, b) => (a.startedAt ?? "") < (b.startedAt ?? "") ? 1 : -1);
}

// Creates or repairs a symlink at `linkPath` pointing to `relativeTarget` (resolved relative to
// linkPath's own directory). No-op if it already points there. Replaces anything else (a stale
// symlink, or — defensively — refuses to touch a real file/directory that isn't already a symlink).
function ensureSymlink(linkPath: string, relativeTarget: string): void {
  if (existsSync(linkPath) || isSymlink(linkPath)) {
    if (isSymlink(linkPath)) {
      const current = readSymlinkTarget(linkPath);
      if (current === relativeTarget) return;
      rmSync(linkPath);
    } else {
      // A real file/directory sits where a generated symlink should go — never overwrite real data.
      throw new Error(`ensureSymlink: refusing to replace a non-symlink at ${linkPath}`);
    }
  }
  symlinkSync(relativeTarget, linkPath);
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function readSymlinkTarget(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

function mdTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [headerLine, sepLine, ...rowLines].join("\n");
}

export function reindexProjects(dataDir: string): { projects: ProjectRecord[] } {
  const projectsDir = join(dataDir, "projects");
  if (!existsSync(projectsDir)) return { projects: [] };

  const projectIds = readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // A UUID has hyphens but no dots; this excludes slug symlinks from a prior run (symlinks
    // are files from withFileTypes' perspective only if followed — guard explicitly instead).
    .filter((name) => !isSymlink(join(projectsDir, name)));

  const usedSlugs = new Set<string>();
  const projects: ProjectRecord[] = [];

  for (const projectId of projectIds) {
    const projectDir = join(projectsDir, projectId);
    const project = readJson<{ name?: string; createdAt?: string }>(join(projectDir, "project.json"));
    if (!project) continue;

    const name = project.name ?? projectId;
    const slug = uniqueSlug(deriveProjectSlug(name), usedSlugs);
    usedSlugs.add(slug);

    const reportEntries = listReportEntries(projectDir);
    const runEntries = listRunEntries(projectDir);
    const latest = reportEntries[0] ?? null;

    // Per-project reports/runs index files.
    mkdirSync(join(projectDir, "reports"), { recursive: true });
    mkdirSync(join(projectDir, "runs"), { recursive: true });

    const reportsIndex = [
      `# Reports — ${name}`,
      "",
      "Auto-generated by `scripts/reindex-project-data.ts` — do not edit by hand, re-run the script instead.",
      "",
      mdTable(
        ["Report ID", "Generated At", "Schema", "Verdict", "HTML"],
        reportEntries.map((r) => [`\`${r.reportId}\``, r.generatedAt || "—", r.reportSchemaVersion ?? "—", r.verdict ?? "—", r.hasHtml ? `[${r.readableName}.html](${r.readableName}.html)` : "—"])
      ),
      "",
    ].join("\n");
    writeFileSync(join(projectDir, "reports", "INDEX.md"), reportsIndex);

    const runsIndex = [
      `# Assessment Runs — ${name}`,
      "",
      "Auto-generated by `scripts/reindex-project-data.ts` — do not edit by hand, re-run the script instead.",
      "",
      mdTable(
        ["Run ID", "Status", "Started At", "Completed At"],
        runEntries.map((r) => [`\`${r.runId}\``, r.status ?? "—", r.startedAt ?? "—", r.completedAt ?? "—"])
      ),
      "",
    ].join("\n");
    writeFileSync(join(projectDir, "runs", "INDEX.md"), runsIndex);

    // latest.json always points at the newest report by generatedAt, if any exist.
    if (latest) {
      ensureSymlink(join(projectDir, "reports", "latest.json"), `${latest.reportId}.json`);
    }
    // latest.html points at the newest report that actually has an HTML rendering, which may
    // not be the same report as latest.json if HTML generation hasn't been re-run yet.
    const latestWithHtml = reportEntries.find((r) => r.hasHtml);
    if (latestWithHtml) {
      ensureSymlink(join(projectDir, "reports", "latest.html"), `${latestWithHtml.reportId}.html`);
    }
    // Readable-name symlinks (date--verdict--shortId) for every report with an HTML rendering,
    // so Finder shows scannable names instead of bare reportId UUIDs. The real <reportId>.json/
    // .html files are untouched and remain the canonical, code-addressed filenames.
    for (const r of reportEntries) {
      if (!r.hasHtml) continue;
      ensureSymlink(join(projectDir, "reports", `${r.readableName}.html`), `${r.reportId}.html`);
      ensureSymlink(join(projectDir, "reports", `${r.readableName}.json`), `${r.reportId}.json`);
    }

    // Human-readable slug symlink at the top level: data/projects/<slug> -> <projectId>/
    ensureSymlink(join(projectsDir, slug), projectId);

    projects.push({
      projectId,
      slug,
      name,
      createdAt: project.createdAt ?? "",
      runCount: runEntries.length,
      latestReport: latest,
    });
  }

  projects.sort((a, b) => a.slug.localeCompare(b.slug));

  const topIndex = [
    "# Projects Index",
    "",
    "Auto-generated by `scripts/reindex-project-data.ts` — do not edit by hand, re-run the script instead " +
      "(`npx tsx scripts/reindex-project-data.ts [dataDir]`, default dataDir is `data`).",
    "",
    "Each `<slug>/` below is a symlink to the real `<projectId>/` directory — the project ID is the canonical " +
      "identifier used in code, schemas, and reports; the slug exists only so this tree is browsable by humans.",
    "",
    mdTable(
      ["Slug", "Project ID", "Name", "Runs", "Latest Report", "Schema", "Verdict"],
      projects.map((p) => [
        `[${p.slug}](${p.slug}/)`,
        `\`${p.projectId}\``,
        p.name,
        String(p.runCount),
        p.latestReport?.generatedAt || "—",
        p.latestReport?.reportSchemaVersion ?? "—",
        p.latestReport?.verdict ?? "—",
      ])
    ),
    "",
  ].join("\n");
  writeFileSync(join(projectsDir, "INDEX.md"), topIndex);

  return { projects };
}

function main(): void {
  const dataDir = process.argv[2] ?? "data";
  const { projects } = reindexProjects(dataDir);
  console.error(`Reindexed ${projects.length} project(s) under ${join(dataDir, "projects")}:`);
  for (const p of projects) {
    const latest = p.latestReport ? `${p.latestReport.generatedAt} (${p.latestReport.reportSchemaVersion ?? "no schema version"}, ${p.latestReport.verdict ?? "no verdict"})` : "no reports yet";
    console.error(`  ${p.slug} -> ${p.projectId}  [${p.runCount} run(s), latest report: ${latest}]`);
  }
}

if (process.argv[1]?.endsWith("reindex-project-data.ts")) {
  main();
}
