import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

// Two findings (one open, one resolved) so the keyboard-interaction test below (Step 4's second
// describe block) has a real visible-count change to assert on when it filters to "open" only.
function sampleReport(): ProjectReport {
  return {
    reportId: "REP-A11Y", projectId: "PRJ-1", projectName: "Accessibility Check", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 5, title: "Sample finding" }],
    projectFindingSnapshots: [
      { findingId: "FND-1", title: "Sample finding (open)", type: "control_gap", severity: "medium", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 5 },
      { findingId: "FND-2", title: "Sample finding (resolved)", type: "control_gap", severity: "low", controlIds: ["CTRL-001"], status: "resolved", priorityIndex: 1, criticalityIndex: 1 },
    ],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 0, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "approved" },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: "ok",
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: "Sample control", domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: [], findingIds: ["FND-1", "FND-2"], riskAcceptanceId: null, owner: "x", assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: null,
    }],
    evidenceSnapshots: [], riskAcceptanceSnapshots: [],
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

function render(): JSDOM {
  return new JSDOM(renderHtml());
}

describe("renderReportHtml — accessibility baseline, DOM/parser-level structural checks (jsdom, spec §7)", () => {
  it("has exactly one <header>, <nav>, <main>, and <footer> landmark", () => {
    const dom = render();
    expect(dom.window.document.querySelectorAll("header").length).toBe(1);
    expect(dom.window.document.querySelectorAll("nav").length).toBe(1);
    expect(dom.window.document.querySelectorAll("main").length).toBe(1);
    expect(dom.window.document.querySelectorAll("footer").length).toBe(1);
  });

  it("has no skipped heading levels among h1/h2/h3", () => {
    const dom = render();
    const headings = [...dom.window.document.querySelectorAll("h1, h2, h3")].map((el) => Number(el.tagName[1]));
    expect(headings[0]).toBe(1);
    for (let i = 1; i < headings.length; i++) {
      expect(headings[i] - headings[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("uses a native <details>/<summary> pair for each finding card, not a div with an onclick handler", () => {
    const dom = render();
    const card = dom.window.document.querySelectorAll(".finding-card")[0];
    expect(card.tagName).toBe("DETAILS");
    expect(card.querySelector("summary")).not.toBeNull();
  });

  it("uses native <button> elements for the findings status filter", () => {
    const dom = render();
    const filterControl = dom.window.document.querySelectorAll("[data-filter]")[0];
    expect(filterControl.tagName).toBe("BUTTON");
  });

  it('the findings filter status region has aria-live="polite"', () => {
    const dom = render();
    expect(dom.window.document.getElementById("findings-filter-status")?.getAttribute("aria-live")).toBe("polite");
  });

  it('the Control Matrix header row uses th scope="col" and the body uses th scope="row" per control', () => {
    const dom = render();
    expect(dom.window.document.querySelectorAll('table thead th[scope="col"]').length).toBeGreaterThan(0);
    expect(dom.window.document.querySelectorAll('table tbody th[scope="row"]').length).toBe(1);
  });

  it("the priority/criticality scatter <svg> has a <title> child element", () => {
    const dom = render();
    const svg = dom.window.document.getElementById("priority-criticality-scatter");
    expect(svg?.querySelector("title")).not.toBeNull();
  });

  it("the stylesheet includes a :focus-visible rule", () => {
    const dom = render();
    const styleText = dom.window.document.querySelector("style")?.textContent ?? "";
    expect(styleText).toContain(":focus-visible");
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe("renderReportHtml — accessibility baseline, real-browser keyboard interaction (Playwright/Chromium, spec §7)", () => {
  it("Tab-focusing the findings filter button and pressing Enter updates the aria-live status text to the new visible count", async () => {
    const page = await browser.newPage();
    await page.setContent(renderHtml(), { waitUntil: "load" });
    const initialStatus = await page.textContent("#findings-filter-status");
    expect(initialStatus).toBe("Showing 2 of 2 findings");
    await page.locator('[data-filter="open"]').focus();
    const focusedDataFilter = await page.evaluate(() => document.activeElement?.getAttribute("data-filter"));
    expect(focusedDataFilter).toBe("open");
    await page.keyboard.press("Enter");
    const updatedStatus = await page.textContent("#findings-filter-status");
    expect(updatedStatus).toBe("Showing 1 of 2 findings");
    await page.close();
  });
});
