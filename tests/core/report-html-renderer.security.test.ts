import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderReportHtml } from "../../src/core/report-html-renderer.js";
import { buildPresentationModel } from "../../src/core/presentation-model.js";
import type { ProjectReport } from "../../src/core/report-builder.js";

const d3Source = readFileSync("src/assets/d3.v7.min.js", "utf-8");
const OPTS = { rendererVersion: "1.0.0", rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64) };

function reportWithPayload(payload: string): ProjectReport {
  return {
    reportId: "REP-XSS", projectId: "PRJ-1", projectName: "XSS Test", assessmentRunId: "RUN-1",
    catalogVersion: "9.9.9", profileRevision: 1, criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
    generatedAt: "2026-10-08T00:00:00.000Z",
    score: {
      overallScore: 100, coverage: { applicableControls: 1, assessedControls: 1, coveragePercent: 100 },
      scoreModel: { id: "x", version: "1.0.0" },
      domainScores: [{ domain: "appsec", score: 100, totalControls: 1, applicableControls: 1, assessedControls: 1, coveragePercent: 100, passCount: 1, failCount: 0, partialCount: 0, notTestedCount: 0, notApplicableCount: 0, acceptedRiskCount: 0, criticalSeverityFindings: 0, highSeverityFindings: 0 }],
    },
    prioritizedFindings: [{ findingId: "FND-1", priorityIndex: 0, criticalityIndex: 9, title: payload }],
    projectFindingSnapshots: [{ findingId: "FND-1", title: payload, type: "confirmed_vulnerability", severity: "critical", controlIds: ["CTRL-001"], status: "open", priorityIndex: 0, criticalityIndex: 9, attackScenario: payload, exploitabilityEvidence: payload }],
    releaseEvaluation: { gate: 4, controlCoverage: 100, confirmedCriticalVulnerabilities: 1, confirmedHighVulnerabilities: 0, residualRisksAccepted: 0, blockingControlFailures: [], blockingControlsNotVerified: [], result: "blocked" },
    target: null, profileSnapshot: null, engineVersionAtRunStart: null,
    reportSchemaVersion: "2.1.0", summary: payload,
    runControlAssessmentSnapshots: [{
      assessmentId: "A-1", runId: "RUN-1", controlId: "CTRL-001", controlVersion: 1, title: payload, domain: "appsec",
      profileRevision: 1, applicability: { autoResult: "applicable", finalResult: "applicable", matchedRules: [], source: "automatic" },
      recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      evidenceIds: [], findingIds: ["FND-1"], riskAcceptanceId: null, owner: payload, assessedBy: "x",
      assessedAt: "2026-10-07T00:00:00.000Z", nextReviewAt: null, notes: payload,
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

function renderWithPayload(payload: string): string {
  const model = buildPresentationModel(reportWithPayload(payload), OPTS);
  return renderReportHtml(model, { d3Source });
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

describe("renderReportHtml — real-browser XSS corpus (Playwright/Chromium, spec §10.1)", () => {
  const PAYLOADS = [
    `</script><script>window.__CSI_XSS__=true;</script>`,
    `"></a><script>window.__CSI_XSS__=true;</script><a href="`,
  ];

  for (const payload of PAYLOADS) {
    it(`a title/notes/owner payload containing ${JSON.stringify(payload)} never sets window.__CSI_XSS__ and remains visible as literal text`, async () => {
      const html = renderWithPayload(payload);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const xssFlag = await page.evaluate(() => (window as unknown as { __CSI_XSS__?: boolean }).__CSI_XSS__);
      expect(xssFlag).not.toBe(true);
      const bodyText = await page.textContent("body");
      expect(bodyText).toContain(payload);
      await page.close();
    });
  }
});

describe("renderReportHtml — zero network requests at view time (Playwright/Chromium, spec §10.2/§8.2)", () => {
  it("no request ever fires against an http(s) origin while the document and its inline scripts load and run", async () => {
    const html = renderWithPayload("plain finding, no payload");
    const page = await browser.newPage();
    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      if (/^https?:/.test(req.url())) requestedUrls.push(req.url());
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(250); // let any deferred script finish before asserting
    expect(requestedUrls).toEqual([]);
    await page.close();
  });
});
