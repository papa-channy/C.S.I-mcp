import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

// One finding and one control, so there is a real <details> card and a real Control Matrix
// row to assert against in print mode — an entirely empty report would make every "is this
// still visible in print" assertion vacuously true.
function sampleReport(): ProjectReport {
  return {
    reportId: "REP-PRINT", projectId: "PRJ-1", projectName: "Print Check", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    // Three findings, with FND-1's priority/criticality diverging by more than 1 — the
    // renderer only shows the Prioritization Map when there are >= 3 findings AND at least one
    // shows meaningful priority/criticality divergence (see showPriorityMap in report-html-renderer.ts).
    prioritizedFindings: [
      { findingId: "FND-1", priorityIndex: 0, criticalityIndex: 5, title: "Sample finding" },
      { findingId: "FND-2", priorityIndex: 3, criticalityIndex: 3, title: "Second sample finding" },
      { findingId: "FND-3", priorityIndex: 6, criticalityIndex: 6, title: "Third sample finding" },
    ],
    projectFindingSnapshots: [
      { findingId: "FND-1", title: "Sample finding", type: "control_gap", severity: "medium", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 5 },
      { findingId: "FND-2", title: "Second sample finding", type: "control_gap", severity: "low", controlIds: [], status: "open", priorityIndex: 3, criticalityIndex: 3 },
      { findingId: "FND-3", title: "Third sample finding", type: "control_gap", severity: "low", controlIds: [], status: "open", priorityIndex: 6, criticalityIndex: 6 },
    ],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: "Sample control", domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: ["EVD-001"], findingIds: ["FND-1"], riskAcceptanceId: null, owner: "x", assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    }],
    evidenceSnapshots: [{
      evidenceId: "EVD-001", type: "CODE",
      // A real-world unbroken path/URL with no spaces — the exact shape that forced a
      // .card-grid track (and with it, the whole page) past the viewport before body picked
      // up `overflow-wrap: anywhere`, since this text sits in a plain <p>, not a <code> tag.
      location: "app/controllers/api/v1/accounts/conversations/messages_controller.rb#L142-L168-extremely-long-unbroken-path-segment-with-no-spaces-to-wrap-on",
      description: null, capturedAt: "2026-10-07T00:00:00.000Z", capturedBy: "x",
    }], riskAcceptanceSnapshots: [],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" }, score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" }, riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
  };
}

function renderHtml(): string {
  const model = buildPresentationModel(sampleReport(), OPTS);
  return renderReportHtml(model, { d3Source });
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe("renderReportHtml — print support, real browser (Playwright/Chromium, spec §11/§10.6)", () => {
  it("hides the nav landmark under print media", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const navVisible = await page.locator("nav").first().isVisible();
    expect(navVisible).toBe(false);
    await page.close();
  });

  it("shows a finding card's expanded content under print media without it being manually opened", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const isOpenAttributeSet = await page.locator(".finding-card").first().evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpenAttributeSet).toBe(false); // the <details> element's own open attribute is untouched by print mode...
    const dlVisible = await page.locator(".finding-card dl").first().isVisible();
    expect(dlVisible).toBe(true); // ...but the print stylesheet (Task 4's `details:not([open]) > *:not(summary)` rule) forces its content block to render anyway
    await page.close();
  });

  it("every <svg> in the document has an explicit viewBox, so it isn't clipped when printed", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    const viewBoxes = await page.locator("svg").evaluateAll((svgs) => svgs.map((svg) => svg.getAttribute("viewBox")));
    expect(viewBoxes.length).toBeGreaterThan(0);
    for (const viewBox of viewBoxes) expect(viewBox).toBeTruthy();
    await page.close();
  });

  it("captures a print-media screenshot as a visual smoke check (spec §10.6's '1-2 browser screenshots')", async () => {
    mkdirSync("tests/__artifacts__", { recursive: true });
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path: "tests/__artifacts__/report-print-smoke.png", fullPage: true });
    await page.close();
  });
});

describe.each([
  { label: "375px mobile", width: 375, height: 812 },
  { label: "1280px desktop", width: 1280, height: 1024 },
])("renderReportHtml — responsive at a $label viewport (Playwright/Chromium, spec §12)", ({ width, height }) => {
  it("the document never scrolls horizontally, and the Control Matrix table scrolls inside its own container instead", async () => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(renderHtml(), { waitUntil: "load" });
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1); // +1 tolerates sub-pixel rounding
    const matrixScrollWidth = await page.evaluate(() => document.querySelector(".table-scroll")?.scrollWidth ?? 0);
    expect(matrixScrollWidth).toBeGreaterThan(0);
    await page.close();
  });
});
