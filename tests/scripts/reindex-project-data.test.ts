import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync, readlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, deriveProjectSlug, readableReportName, reindexProjects } from "../../scripts/reindex-project-data.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "csi-mcp-reindex-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(
  projectId: string,
  name: string,
  opts: {
    runs?: { runId: string; status?: string; startedAt?: string }[];
    reports?: { reportId: string; generatedAt: string; reportSchemaVersion?: string; verdict?: string; html?: boolean }[];
  } = {}
) {
  const projectDir = join(dir, "projects", projectId);
  mkdirSync(join(projectDir, "runs"), { recursive: true });
  mkdirSync(join(projectDir, "reports"), { recursive: true });
  writeFileSync(join(projectDir, "project.json"), JSON.stringify({ projectId, name, createdAt: "2026-10-01T00:00:00.000Z" }));
  for (const run of opts.runs ?? []) {
    writeFileSync(join(projectDir, "runs", `${run.runId}.json`), JSON.stringify({ runId: run.runId, status: run.status ?? "running", startedAt: run.startedAt ?? null }));
  }
  for (const report of opts.reports ?? []) {
    writeFileSync(
      join(projectDir, "reports", `${report.reportId}.json`),
      JSON.stringify({ generatedAt: report.generatedAt, reportSchemaVersion: report.reportSchemaVersion ?? "2.1.0", releaseEvaluation: { result: report.verdict ?? "approved" } })
    );
    if (report.html) writeFileSync(join(projectDir, "reports", `${report.reportId}.html`), "<!doctype html><title>x</title>");
  }
}

describe("slugify", () => {
  it("lowercases, replaces non-alphanumerics with single dashes, and trims edge dashes", () => {
    expect(slugify("Vaultwarden (dani-garcia/vaultwarden)")).toBe("vaultwarden-dani-garcia-vaultwarden");
    expect(slugify("  Leading/Trailing  ")).toBe("leading-trailing");
  });
});

describe("deriveProjectSlug", () => {
  it("strips the (owner/repo) parenthetical and C.S.I-mcp validation-run boilerplate", () => {
    expect(deriveProjectSlug("Vaultwarden (dani-garcia/vaultwarden) — C.S.I-mcp validation run")).toBe("vaultwarden");
  });

  it("keeps distinguishing text for a re-assessment variant, producing a different slug than the plain entry", () => {
    const plain = deriveProjectSlug("Chatwoot (chatwoot/chatwoot) — C.S.I-mcp validation run");
    const v2 = deriveProjectSlug("Chatwoot (chatwoot/chatwoot) — C.S.I-mcp v2 re-assessment (improved tooling)");
    const blind = deriveProjectSlug("Chatwoot (chatwoot/chatwoot) — blind pinned-commit re-assessment (097155a, 2026-10-03)");
    expect(plain).toBe("chatwoot");
    expect(v2).not.toBe(plain);
    expect(blind).not.toBe(plain);
    expect(v2).not.toBe(blind);
  });
});

describe("readableReportName", () => {
  it("formats as date--verdict--shortId, date first so Finder's alpha sort is also chronological", () => {
    expect(readableReportName("53ff8774-2577-4191-9500-8f1df23687a6", "2026-10-08T15:39:21.812Z", "blocked")).toBe("2026-10-08--blocked--53ff8774");
  });

  it("falls back to no-date / no-verdict for missing data, without throwing", () => {
    expect(readableReportName("53ff8774-2577-4191-9500-8f1df23687a6", "", null)).toBe("no-date--no-verdict--53ff8774");
  });
});

describe("reindexProjects", () => {
  it("returns an empty project list and writes nothing when there is no projects directory", () => {
    const result = reindexProjects(dir);
    expect(result.projects).toEqual([]);
    expect(existsSync(join(dir, "projects"))).toBe(false);
  });

  it("creates a readable slug symlink pointing at the real projectId directory", () => {
    writeProject("18c1aa29-uuid", "Vaultwarden (dani-garcia/vaultwarden) — C.S.I-mcp validation run");
    const result = reindexProjects(dir);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].slug).toBe("vaultwarden");
    const linkPath = join(dir, "projects", "vaultwarden");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe("18c1aa29-uuid");
  });

  it("disambiguates colliding slugs with a numeric suffix as a last resort", () => {
    writeProject("prj-1", "Same Name");
    writeProject("prj-2", "Same Name");
    const result = reindexProjects(dir);
    const slugs = result.projects.map((p) => p.slug).sort();
    expect(slugs).toEqual(["same-name", "same-name-2"]);
  });

  it("writes reports/latest.json pointing at the most recently generated report", () => {
    writeProject("prj-1", "Demo", {
      reports: [
        { reportId: "rep-old", generatedAt: "2026-10-01T00:00:00.000Z" },
        { reportId: "rep-new", generatedAt: "2026-10-05T00:00:00.000Z" },
      ],
    });
    reindexProjects(dir);
    const linkPath = join(dir, "projects", "prj-1", "reports", "latest.json");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe("rep-new.json");
  });

  it("writes reports/latest.html pointing at the newest report that actually has an HTML rendering, even if a newer JSON-only report exists", () => {
    writeProject("prj-1", "Demo", {
      reports: [
        { reportId: "rep-with-html", generatedAt: "2026-10-01T00:00:00.000Z", html: true },
        { reportId: "rep-json-only", generatedAt: "2026-10-05T00:00:00.000Z" },
      ],
    });
    reindexProjects(dir);
    const jsonLink = join(dir, "projects", "prj-1", "reports", "latest.json");
    const htmlLink = join(dir, "projects", "prj-1", "reports", "latest.html");
    expect(readlinkSync(jsonLink)).toBe("rep-json-only.json");
    expect(readlinkSync(htmlLink)).toBe("rep-with-html.html");
  });

  it("creates a readable date--verdict--shortId symlink for every report that has an HTML rendering, leaving JSON-only reports unlinked", () => {
    writeProject("prj-1", "Demo", {
      reports: [
        { reportId: "aaaaaaaa-1111-1111-1111-111111111111", generatedAt: "2026-10-01T00:00:00.000Z", verdict: "approved", html: true },
        { reportId: "bbbbbbbb-2222-2222-2222-222222222222", generatedAt: "2026-10-05T00:00:00.000Z", verdict: "blocked" },
      ],
    });
    reindexProjects(dir);
    const reportsDir = join(dir, "projects", "prj-1", "reports");
    expect(readlinkSync(join(reportsDir, "2026-10-01--approved--aaaaaaaa.html"))).toBe("aaaaaaaa-1111-1111-1111-111111111111.html");
    expect(readlinkSync(join(reportsDir, "2026-10-01--approved--aaaaaaaa.json"))).toBe("aaaaaaaa-1111-1111-1111-111111111111.json");
    expect(existsSync(join(reportsDir, "2026-10-05--blocked--bbbbbbbb.html"))).toBe(false);
  });

  it("does not create reports/latest.json when a project has no reports yet", () => {
    writeProject("prj-1", "Demo");
    reindexProjects(dir);
    expect(existsSync(join(dir, "projects", "prj-1", "reports", "latest.json"))).toBe(false);
  });

  it("writes a top-level INDEX.md listing every project by slug", () => {
    writeProject("prj-1", "Alpha Project");
    writeProject("prj-2", "Beta Project");
    reindexProjects(dir);
    const index = readFileSync(join(dir, "projects", "INDEX.md"), "utf-8");
    expect(index).toContain("alpha-project");
    expect(index).toContain("beta-project");
    expect(index).toContain("prj-1");
    expect(index).toContain("prj-2");
  });

  it("writes per-project reports/INDEX.md and runs/INDEX.md", () => {
    writeProject("prj-1", "Demo", {
      runs: [{ runId: "run-1", status: "completed", startedAt: "2026-10-01T00:00:00.000Z" }],
      reports: [{ reportId: "rep-1", generatedAt: "2026-10-02T00:00:00.000Z", reportSchemaVersion: "2.1.0", verdict: "blocked" }],
    });
    reindexProjects(dir);
    const reportsIndex = readFileSync(join(dir, "projects", "prj-1", "reports", "INDEX.md"), "utf-8");
    const runsIndex = readFileSync(join(dir, "projects", "prj-1", "runs", "INDEX.md"), "utf-8");
    expect(reportsIndex).toContain("rep-1");
    expect(reportsIndex).toContain("2.1.0");
    expect(reportsIndex).toContain("blocked");
    expect(runsIndex).toContain("run-1");
    expect(runsIndex).toContain("completed");
  });

  it("is idempotent: re-running does not change already-correct symlinks or error", () => {
    writeProject("prj-1", "Demo", { reports: [{ reportId: "rep-1", generatedAt: "2026-10-01T00:00:00.000Z" }] });
    reindexProjects(dir);
    expect(() => reindexProjects(dir)).not.toThrow();
    const linkPath = join(dir, "projects", "demo");
    expect(readlinkSync(linkPath)).toBe("prj-1");
  });

  it("running twice never treats its own latest.json/latest.html or readable-name symlinks as a report (no bogus self-referential aliases)", () => {
    writeProject("prj-1", "Demo", { reports: [{ reportId: "aaaaaaaa-0000-0000-0000-000000000000", generatedAt: "2026-10-08T00:00:00.000Z", verdict: "blocked", html: true }] });
    reindexProjects(dir);
    const firstRun = reindexProjects(dir);
    const secondRun = reindexProjects(dir);
    expect(secondRun.projects[0].latestReport?.reportId).toBe(firstRun.projects[0].latestReport?.reportId);
    const reportsDir = join(dir, "projects", "prj-1", "reports");
    expect(existsSync(join(reportsDir, "2026-10-08--blocked--latest.html"))).toBe(false);
    expect(existsSync(join(reportsDir, "latest.html"))).toBe(true); // the real one must still exist
  });

  it("repairs a slug symlink that points at a stale target (e.g. after a project's name changed)", () => {
    writeProject("prj-1", "Old Name");
    reindexProjects(dir);
    expect(existsSync(join(dir, "projects", "old-name"))).toBe(true);

    // Simulate the project's name changing, re-run, and confirm the new slug now resolves correctly.
    writeFileSync(join(dir, "projects", "prj-1", "project.json"), JSON.stringify({ projectId: "prj-1", name: "New Name", createdAt: "2026-10-01T00:00:00.000Z" }));
    reindexProjects(dir);
    expect(existsSync(join(dir, "projects", "new-name"))).toBe(true);
    expect(readlinkSync(join(dir, "projects", "new-name"))).toBe("prj-1");
  });

  it("skips a project directory whose project.json is missing or unreadable, without throwing", () => {
    mkdirSync(join(dir, "projects", "broken-dir"), { recursive: true });
    writeProject("prj-1", "Demo");
    const result = reindexProjects(dir);
    expect(result.projects.map((p) => p.projectId)).toEqual(["prj-1"]);
  });
});
