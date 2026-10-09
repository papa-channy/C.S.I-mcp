import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

// Target available (so the header's target line renders) and two contributing run IDs on the
// score scope (so the project_scoped_score_release limitation — the one Korean message that
// reconstructs itself from structured data instead of a static table lookup — actually fires).
// Three findings with real priority/criticality divergence so the Prioritization Map chart
// renders too, exercising its own, separately-wired i18n path.
function sampleReport(): ProjectReport {
  return {
    reportId: "REP-I18N", projectId: "PRJ-1", projectName: "I18N Check", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    prioritizedFindings: [
      { findingId: "FND-1", priorityIndex: 0, criticalityIndex: 5, title: "Sample finding" },
      { findingId: "FND-2", priorityIndex: 3, criticalityIndex: 3, title: "Second sample finding" },
      { findingId: "FND-3", priorityIndex: 6, criticalityIndex: 6, title: "Third sample finding" },
    ],
    projectFindingSnapshots: [
      { findingId: "FND-1", title: "Sample finding", type: "control_gap", severity: "medium", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 5 },
      { findingId: "FND-2", title: "Second sample finding", type: "control_gap", severity: "low", controlIds: [], status: "open", priorityIndex: 3, criticalityIndex: 3 },
      { findingId: "FND-3", title: "Third sample finding", type: "control_gap", severity: "low", controlIds: [], status: "resolved", priorityIndex: 6, criticalityIndex: 6 },
    ],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
    target: { available: true, repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false, provenanceKind: "caller-asserted" },
    profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: "Sample control", domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: [], findingIds: ["FND-1"], riskAcceptanceId: null, owner: "x", assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    }],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" },
      // Two contributing run IDs — triggers project_scoped_score_release, the one limitation
      // whose Korean text is reconstructed from this same structured scope rather than looked
      // up in a static table.
      score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1", "RUN-2"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" }, riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
  };
}

function renderHtml(): string {
  const model = buildPresentationModel(sampleReport(), OPTS);
  return renderReportHtml(model, { d3Source });
}

describe("renderReportHtml — i18n markup (static string checks)", () => {
  it("wraps known static chrome strings in .i18n spans carrying the Korean text as data-ko", () => {
    const html = renderHtml();
    expect(html).toContain('<span class="i18n" data-ko="요약">Executive Summary</span>');
    expect(html).toContain('<span class="i18n" data-ko="발견 사항">Findings</span>');
  });

  it("renders the sidebar language toggle with both buttons present and English active by default", () => {
    const html = renderHtml();
    expect(html).toMatch(/data-lang-btn="en"[^>]*aria-pressed="true"/);
    expect(html).toContain('data-lang-btn="ko" aria-pressed="false"');
  });

  it("reconstructs the project_scoped_score_release Korean message from assessmentScopes.score, not a static table lookup", () => {
    const html = renderHtml();
    // English message (presentation-model.ts) states the run count and IDs.
    expect(html).toContain("draw on control assessments from 2 assessment runs (RUN-1, RUN-2)");
    // The Korean reconstruction must carry the same run IDs and count, proving it was built from
    // the structured scope data rather than silently falling back to English.
    expect(html).toContain("2개의 평가 실행(RUN-1, RUN-2)");
  });

  it("never wraps caller-supplied data (finding titles, control titles) in a translatable .i18n span", () => {
    const html = renderHtml();
    expect(html).not.toContain('data-ko="Sample finding"');
    expect(html).not.toContain('data-ko="Sample control"');
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe("renderReportHtml — i18n toggle, real browser (Playwright/Chromium)", () => {
  it("switches chrome text to Korean on click, leaves finding/control titles untouched, and restores English on click back", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });

    const before = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute("lang"),
      heading: document.getElementById("executive-summary-heading")!.textContent,
      findingTitle: document.querySelector(".finding-title")!.textContent,
      controlTitle: document.querySelector(".control-title")!.textContent,
    }));
    expect(before.lang).toBe("en");
    expect(before.heading).toBe("Executive Summary");

    await page.click('[data-lang-btn="ko"]');
    const afterKo = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute("lang"),
      heading: document.getElementById("executive-summary-heading")!.textContent,
      findingTitle: document.querySelector(".finding-title")!.textContent,
      controlTitle: document.querySelector(".control-title")!.textContent,
      enPressed: document.querySelector('[data-lang-btn="en"]')!.getAttribute("aria-pressed"),
      koPressed: document.querySelector('[data-lang-btn="ko"]')!.getAttribute("aria-pressed"),
      noteHidden: (document.querySelector("[data-lang-note]") as HTMLElement).hidden,
    }));
    expect(afterKo.lang).toBe("ko");
    expect(afterKo.heading).toBe("요약");
    // The invariant this whole feature depends on: translating UI chrome must never touch
    // caller-supplied assessment content.
    expect(afterKo.findingTitle).toBe(before.findingTitle);
    expect(afterKo.controlTitle).toBe(before.controlTitle);
    expect(afterKo.enPressed).toBe("false");
    expect(afterKo.koPressed).toBe("true");
    expect(afterKo.noteHidden).toBe(false); // the "actual content stays in its original language" disclaimer shows once Korean is active

    await page.click('[data-lang-btn="en"]');
    const afterEn = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute("lang"),
      heading: document.getElementById("executive-summary-heading")!.textContent,
      noteHidden: (document.querySelector("[data-lang-note]") as HTMLElement).hidden,
    }));
    expect(afterEn.lang).toBe("en");
    expect(afterEn.heading).toBe("Executive Summary");
    expect(afterEn.noteHidden).toBe(true);

    await page.close();
  });

  it("updates the findings filter count and the document title when the language is switched", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });

    await page.click('[data-filter="open"]');
    const enStatus = await page.textContent("#findings-filter-status");
    expect(enStatus).toBe("Showing 2 of 3 findings");

    await page.click('[data-lang-btn="ko"]');
    const koStatus = await page.textContent("#findings-filter-status");
    expect(koStatus).toBe("전체 3건 중 2건 표시");

    const title = await page.title();
    expect(title).toContain("보안 평가 보고서");

    await page.close();
  });

  it("translates the Prioritization Map chart's axis labels and point tooltips when present", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.waitForSelector("#priority-criticality-scatter .axis-label-x");

    const beforeAxis = await page.evaluate(() => document.querySelector(".axis-label-x")!.textContent);
    expect(beforeAxis).toBe("Priority index");

    await page.click('[data-lang-btn="ko"]');
    const afterAxis = await page.evaluate(() => ({
      x: document.querySelector(".axis-label-x")!.textContent,
      y: document.querySelector(".axis-label-y")!.textContent,
      ariaLabel: document.getElementById("priority-criticality-scatter")!.getAttribute("aria-label"),
      pointTooltip: document.querySelector("g.point title")!.textContent,
    }));
    expect(afterAxis.x).toBe("우선순위 지수");
    expect(afterAxis.y).toBe("심각도 지수");
    expect(afterAxis.ariaLabel).toContain("발견 사항");
    // The tooltip's static label text translates; the finding title inside it (caller data) does not.
    expect(afterAxis.pointTooltip).toContain("우선순위 지수:");
    expect(afterAxis.pointTooltip).toContain("Sample finding");

    await page.close();
  });

  it("persists the chosen language across a reload of the same document", async () => {
    // localStorage requires a real (non-opaque) origin — page.setContent() leaves the document
    // on an origin that denies storage access entirely, unlike how this report is actually
    // opened (a file:// URL, confirmed separately to support localStorage normally). Writing to
    // a real file and navigating with goto() reproduces that origin for this test.
    const dir = mkdtempSync(join(tmpdir(), "csi-i18n-test-"));
    const filePath = join(dir, "report.html");
    writeFileSync(filePath, renderHtml());
    const page = await browser.newPage();
    try {
      await page.goto(`file://${filePath}`, { waitUntil: "load" });
      await page.click('[data-lang-btn="ko"]');
      await page.waitForTimeout(50);
      const saved = await page.evaluate(() => localStorage.getItem("csi-report-lang"));
      expect(saved).toBe("ko");

      await page.reload({ waitUntil: "load" });
      const lang = await page.evaluate(() => document.documentElement.getAttribute("lang"));
      expect(lang).toBe("ko");
    } finally {
      await page.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the active language's text under print media", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.click('[data-lang-btn="ko"]');
    await page.emulateMedia({ media: "print" });
    const heading = await page.textContent("#executive-summary-heading");
    expect(heading).toBe("요약");
    await page.close();
  });
});
