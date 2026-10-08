import { describe, expect, it } from "vitest";
import { renderReportHtml, REPORT_HTML_RENDERER_VERSION } from "../../src/core/report-html-renderer.js";
import type { PresentationModel } from "../../src/core/presentation-model.js";

const D3_STUB = "/* d3 stub for tests */ var d3 = { select: function () { return { append: function () { return this; }, attr: function () { return this; }, call: function () { return this; }, text: function(){return this;}, selectAll: function () { return { data: function () { return this; }, join: function () { return this; } }; } }; }, scaleLinear: function () { return { domain: function () { return this; }, range: function () { return this; } }; }, axisBottom: function () { return { ticks: function () { return this; } }; }, axisLeft: function () { return { ticks: function () { return this; } }; } };";

function sampleModel(overrides: Partial<PresentationModel> = {}): PresentationModel {
  return {
    metadata: {
      reportId: "REP-1", reportSchemaVersion: "2.1.0", projectId: "PRJ-1", projectName: "Demo <Project> & Co",
      assessmentRunId: "RUN-1", reportGeneratedAt: "2026-10-08T00:00:00.000Z", engineVersionAtRunStart: "0.10.0",
      profileRevision: 1, catalogVersion: "9.9.9", criticalityFormula: { id: "CRIT-DEFAULT", version: "1.0.0" },
      scoreModel: { id: "USSVS-SCORE-DEFAULT", version: "1.0.0" }, rendererVersion: REPORT_HTML_RENDERER_VERSION,
      rendererRenderedAt: "2026-10-08T00:00:00.000Z", sourceReportSha256: "a".repeat(64),
      target: { available: true, repository: "example/repo", commitSha: "a".repeat(40), branchOrTag: "main", dirty: false, provenanceKind: "caller-asserted" },
    },
    executive: {
      verdict: "approved", coverage: { percent: 100, assessed: 1, applicable: 1 },
      confirmedCritical: 0, confirmedHigh: 0, blockingControlFailures: [], blockingControlsNotVerified: [],
      topPrioritizedFinding: null,
    },
    domains: [{ domain: "appsec", score: 100, coverage: { percent: 100, assessed: 1, applicable: 1 } }],
    controls: [{
      controlId: "CTRL-001", controlVersion: 1, runId: "RUN-1", title: "Title", domain: "appsec",
      controlDefinitionVersionMismatch: false, recordedStatus: "PASS", effectiveStatus: "PASS", effectiveStatusReason: null,
      assessedAt: "2026-10-07T00:00:00.000Z", assessedBy: "x", owner: "x", nextReviewAt: null, notes: null,
      evidenceIds: [], evidence: [], riskAcceptanceId: null, riskAcceptance: null, findingIds: [],
    }],
    findings: [{
      findingId: "FND-1", title: "<script>alert(1)</script> XSS payload", type: "confirmed_vulnerability",
      severity: "critical", status: "open", priorityIndex: 0, criticalityIndex: 9,
      attackScenario: "An attacker does </script><script>window.__X__=1</script>", exploitabilityEvidence: null,
      linkedControlIds: ["CTRL-001"],
    }],
    evidence: [], riskAcceptances: [],
    referenceIntegrity: { missingEvidenceIds: [], missingRiskAcceptanceIds: [], missingFindingIds: [], unresolvedControlDefinitions: [] },
    limitations: [{ code: "target_caller_asserted", severity: "info", message: "info message" }],
    assessmentScopes: {
      projectFindingSnapshots: { kind: "project" },
      score: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      releaseEvaluation: { kind: "project-assessment-set", contributingRunIds: ["RUN-1"] },
      runControlAssessmentSnapshots: { kind: "run", runId: "RUN-1" },
      evidenceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
      riskAcceptanceSnapshots: { kind: "referenced-by-run", runId: "RUN-1" },
    },
    ...overrides,
  };
}

describe("renderReportHtml — structure and escaping", () => {
  it("includes the zero-network CSP meta tag verbatim", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy"`);
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain(`script-src 'unsafe-inline'`);
  });

  it("escapes a finding title containing HTML special characters as text, never raw", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; XSS payload");
    expect(html).not.toContain("<script>alert(1)</script> XSS payload");
  });

  it("escapes projectName in the <title> element", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain("<title>Demo &lt;Project&gt; &amp; Co");
  });

  it("the embedded report-data JSON payload contains no literal </script sequence from report data", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    const dataBlockMatch = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
    expect(dataBlockMatch).toBeTruthy();
    expect(dataBlockMatch![1]).not.toContain("</script");
  });

  it("includes the vendored D3 source inline, not a CDN <script src>", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain(D3_STUB);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("includes semantic landmarks (header, nav, main, footer)", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toMatch(/<header/);
    expect(html).toMatch(/<nav/);
    expect(html).toMatch(/<main/);
    expect(html).toMatch(/<footer/);
  });

  it('the Control Matrix table uses th scope="col" header cells', () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toContain(`<th scope="col">Control</th>`);
  });

  it("includes an @media print rule that forces closed <details> content visible", () => {
    const html = renderReportHtml(sampleModel(), { d3Source: D3_STUB });
    expect(html).toMatch(/@media print[\s\S]*details:not\(\[open\]\)/);
  });

  it("renders a legacy-unavailable target badge when metadata.target.available is false", () => {
    const model = sampleModel({
      metadata: { ...sampleModel().metadata, target: { available: false, repository: null, commitSha: null, branchOrTag: null, dirty: null, provenanceKind: "legacy-unavailable" } },
    });
    const html = renderReportHtml(model, { d3Source: D3_STUB });
    expect(html).toContain("target provenance unavailable");
  });

  it("is a pure function: same model and opts produce byte-identical output", () => {
    const model = sampleModel();
    expect(renderReportHtml(model, { d3Source: D3_STUB })).toBe(renderReportHtml(model, { d3Source: D3_STUB }));
  });
});
