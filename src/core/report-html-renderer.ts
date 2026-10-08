import type { PresentationModel } from "./presentation-model.js";
import {
  escapeHtmlText as text,
  escapeHtmlAttribute as attr,
  escapeUrlAttribute as href,
  escapeForInlineScriptJson,
} from "./html-escape.js";

export const REPORT_HTML_RENDERER_VERSION = "1.0.0";

const VERDICT_COLORS: Record<string, string> = { approved: "#1b7f3a", blocked: "#c0392b", indeterminate: "#b7791f" };

// Control row HTML anchors are keyed on assessmentId, not controlId: a control reassessed
// mid-run produces two ControlRow entries sharing one controlId (see AssessmentService.recordAssessment,
// which mints a fresh assessmentId per call with no dedupe on (runId, controlId)). Keying anchors on
// controlId alone would collide into a duplicate `id` attribute, leaving every `#control-X` link
// ambiguous. This map resolves controlId -> the assessmentId of its most-recently-assessed row, for
// every place that links to a control by controlId rather than iterating ControlRow objects directly.
function buildControlAnchorMap(model: PresentationModel): Map<string, string> {
  const anchorByControlId = new Map<string, string>();
  const latestAssessedAtByControlId = new Map<string, string>();
  for (const c of model.controls) {
    const currentLatest = latestAssessedAtByControlId.get(c.controlId);
    if (currentLatest === undefined || c.assessedAt > currentLatest) {
      latestAssessedAtByControlId.set(c.controlId, c.assessedAt);
      anchorByControlId.set(c.controlId, c.assessmentId);
    }
  }
  return anchorByControlId;
}

function controlAnchorId(anchorByControlId: Map<string, string>, controlId: string): string {
  return anchorByControlId.get(controlId) ?? controlId;
}

function renderHeader(model: PresentationModel): string {
  const verdictColor = VERDICT_COLORS[model.executive.verdict] ?? "#6b7280";
  const t = model.metadata.target;
  const targetBlock = t.available
    ? `<p class="target">Target: <code>${text(t.repository ?? "")}</code>` +
      (t.commitSha ? ` @ <code>${text(t.commitSha)}</code>` : "") +
      (t.branchOrTag ? ` (${text(t.branchOrTag)})` : "") +
      (t.dirty ? ` <span class="badge badge-warning">dirty working tree</span>` : "") +
      `</p>`
    : `<p class="target badge badge-info">Legacy assessment — target provenance unavailable</p>`;
  return `<header>
  <h1>${text(model.metadata.projectName)}</h1>
  <p class="verdict" style="--verdict-color:${verdictColor}">${text(model.executive.verdict.toUpperCase())}</p>
  ${targetBlock}
  <p class="run-meta">Run <code>${text(model.metadata.assessmentRunId)}</code>${
    model.metadata.engineVersionAtRunStart ? ` · engine ${text(model.metadata.engineVersionAtRunStart)}` : ""
  } · generated ${text(model.metadata.reportGeneratedAt)}</p>
</header>`;
}

function renderExecutiveSummary(model: PresentationModel, anchorByControlId: Map<string, string>): string {
  const e = model.executive;
  const failuresList = e.blockingControlFailures.length
    ? `<ul>${e.blockingControlFailures.map((id) => `<li><a href="${href(`#control-${controlAnchorId(anchorByControlId, id)}`)}">${text(id)}</a></li>`).join("")}</ul>`
    : `<p>None.</p>`;
  const notVerifiedList = e.blockingControlsNotVerified.length
    ? `<ul>${e.blockingControlsNotVerified.map((id) => `<li><a href="${href(`#control-${controlAnchorId(anchorByControlId, id)}`)}">${text(id)}</a></li>`).join("")}</ul>`
    : `<p>None.</p>`;
  const topFindingBlock = e.topPrioritizedFinding
    ? `<p><a href="${href(`#finding-${e.topPrioritizedFinding.findingId}`)}">${text(e.topPrioritizedFinding.title)}</a> (${text(e.topPrioritizedFinding.severity)} / ${text(e.topPrioritizedFinding.type)})</p>`
    : `<p>No prioritized findings.</p>`;
  return `<section id="executive-summary" aria-labelledby="executive-summary-heading">
  <h2 id="executive-summary-heading">Executive Summary</h2>
  <dl class="kpi-grid">
    <div class="kpi"><dt>Verdict</dt><dd>${text(e.verdict)}</dd></div>
    <div class="kpi"><dt>Coverage</dt><dd>${e.coverage.percent}% (${e.coverage.assessed}/${e.coverage.applicable})</dd></div>
    <div class="kpi"><dt>Confirmed critical</dt><dd>${e.confirmedCritical}</dd></div>
    <div class="kpi"><dt>Confirmed high</dt><dd>${e.confirmedHigh}</dd></div>
  </dl>
  <h3>Blocking control failures</h3>
  ${failuresList}
  <h3>Blocking controls not verified</h3>
  ${notVerifiedList}
  <h3>Top prioritized finding</h3>
  ${topFindingBlock}
</section>`;
}

function renderDomainOverview(model: PresentationModel): string {
  const rows = model.domains
    .map(
      (d) => `
    <div class="domain-row">
      <span class="domain-name">${text(d.domain)}</span>
      <div class="bar" role="img" aria-label="${attr(`${d.domain} score ${d.score} out of 100, coverage ${d.coverage.percent} percent`)}">
        <div class="bar-fill" style="width:${d.score}%"></div>
      </div>
      <span class="domain-numbers">${d.score} / 100 · ${d.coverage.percent}% coverage (${d.coverage.assessed}/${d.coverage.applicable})</span>
    </div>`
    )
    .join("");
  return `<section id="domain-overview" aria-labelledby="domain-overview-heading">
  <h2 id="domain-overview-heading">Domain Overview</h2>
  ${rows}
</section>`;
}

function renderControlMatrix(model: PresentationModel): string {
  const rows = model.controls
    .map((c) => {
      const reasonCell = c.effectiveStatusReason
        ? `<span class="reason-badge" title="${attr(c.effectiveStatusReason.detail ?? c.effectiveStatusReason.label)}">${text(c.effectiveStatusReason.label)}</span>`
        : "";
      const mismatchBadge = c.controlDefinitionVersionMismatch
        ? `<span class="badge badge-warning">Control definition unavailable</span>`
        : "";
      const evidenceCell = c.evidence.length
        ? `<a href="${href(`#evidence-${c.evidence[0].evidenceId}`)}">${c.evidence.length} evidence</a>`
        : c.evidenceIds.length
          ? `<span class="badge badge-warning">${c.evidenceIds.length} missing</span>`
          : "—";
      const findingsCell = c.findingIds.length
        ? c.findingIds.map((id) => `<a href="${href(`#finding-${id}`)}">${text(id)}</a>`).join(", ")
        : "—";
      return `<tr id="control-${attr(c.assessmentId)}" data-effective-status="${attr(c.effectiveStatus)}">
      <th scope="row">${text(c.title ?? c.controlId)} ${mismatchBadge}</th>
      <td>${text(c.recordedStatus)}</td>
      <td class="status-${attr(c.effectiveStatus)}">${text(c.effectiveStatus)} ${c.recordedStatus !== c.effectiveStatus ? "↺" : ""}</td>
      <td>${reasonCell}</td>
      <td>${evidenceCell}</td>
      <td>${findingsCell}</td>
    </tr>`;
    })
    .join("");
  return `<section id="control-matrix" aria-labelledby="control-matrix-heading">
  <h2 id="control-matrix-heading">Control Matrix</h2>
  <div class="table-scroll">
  <table>
    <caption>Effective status reflects what the engine actually used for score/verdict; hover the reason badge for detail.</caption>
    <thead><tr>
      <th scope="col">Control</th><th scope="col">Recorded</th><th scope="col">Effective</th>
      <th scope="col">Reason</th><th scope="col">Evidence</th><th scope="col">Findings</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
</section>`;
}

function renderFindings(model: PresentationModel, anchorByControlId: Map<string, string>): string {
  const knownControlIds = new Set(model.controls.map((c) => c.controlId));
  const cards = model.findings
    .map((f) => {
      const linkedControls =
        f.linkedControlIds
          .map((id) => (knownControlIds.has(id) ? `<a href="${href(`#control-${controlAnchorId(anchorByControlId, id)}`)}">${text(id)}</a>` : text(id)))
          .join(", ") || "—";
      return `<details id="finding-${attr(f.findingId)}" class="finding-card severity-${attr(f.severity)}" data-status="${attr(f.status)}">
      <summary>
        <span class="badge badge-severity">${text(f.severity)}</span>
        <span class="badge badge-status">${text(f.status)}</span>
        <span class="finding-title">${text(f.title)}</span>
      </summary>
      <dl>
        <dt>Type</dt><dd>${text(f.type)}</dd>
        <dt>Priority index</dt><dd>${f.priorityIndex}</dd>
        <dt>Criticality index</dt><dd>${f.criticalityIndex}</dd>
        <dt>Linked controls</dt><dd>${linkedControls}</dd>
        ${f.attackScenario ? `<dt>Attack scenario</dt><dd>${text(f.attackScenario)}</dd>` : ""}
        ${f.exploitabilityEvidence ? `<dt>Exploitability evidence</dt><dd>${text(f.exploitabilityEvidence)}</dd>` : ""}
      </dl>
    </details>`;
    })
    .join("");
  return `<section id="findings" aria-labelledby="findings-heading">
  <h2 id="findings-heading">Findings</h2>
  <div role="group" aria-label="Finding status filter">
    <button type="button" data-filter="all" aria-pressed="true">All</button>
    <button type="button" data-filter="open" aria-pressed="false">Open / In progress</button>
  </div>
  <p id="findings-filter-status" aria-live="polite">Showing ${model.findings.length} of ${model.findings.length} findings</p>
  <div id="findings-list">${cards}</div>
  <h3>Prioritization Map</h3>
  <p>Priority index and criticality index are both bounded integers (0–9), not continuous risk scores.</p>
  <svg id="priority-criticality-scatter" viewBox="0 0 480 320" role="img" aria-label="Priority versus criticality scatter plot of findings">
    <title>Priority versus criticality scatter plot</title>
  </svg>
</section>`;
}

function renderEvidenceAndRiskAcceptance(model: PresentationModel, anchorByControlId: Map<string, string>): string {
  const controlsByEvidenceId = new Map<string, string[]>();
  const controlsByRiskAcceptanceId = new Map<string, string[]>();
  for (const c of model.controls) {
    for (const id of c.evidenceIds) controlsByEvidenceId.set(id, [...(controlsByEvidenceId.get(id) ?? []), c.controlId]);
    if (c.riskAcceptanceId) controlsByRiskAcceptanceId.set(c.riskAcceptanceId, [...(controlsByRiskAcceptanceId.get(c.riskAcceptanceId) ?? []), c.controlId]);
  }

  const evidenceCards = model.evidence
    .map((e) => {
      const refs = (controlsByEvidenceId.get(e.evidenceId) ?? []).map((id) => `<a href="${href(`#control-${controlAnchorId(anchorByControlId, id)}`)}">${text(id)}</a>`).join(", ") || "—";
      return `<article id="evidence-${attr(e.evidenceId)}" class="evidence-card">
      <h3>${text(e.evidenceId)} <span class="badge">${text(e.type)}</span></h3>
      <p>${text(e.location)}</p>
      ${e.description ? `<p>${text(e.description)}</p>` : ""}
      <p>Captured ${text(e.capturedAt)} by ${text(e.capturedBy)}</p>
      <p>Referenced by: ${refs}</p>
    </article>`;
    })
    .join("");

  const missingEvidenceCards = model.referenceIntegrity.missingEvidenceIds
    .map((id) => `<article class="evidence-card missing-placeholder"><h3>${text(id)}</h3><p class="badge badge-warning">Referenced but not found in this report</p></article>`)
    .join("");

  const raCards = model.riskAcceptances
    .map((r) => {
      const refs = (controlsByRiskAcceptanceId.get(r.riskAcceptanceId) ?? []).map((id) => `<a href="${href(`#control-${controlAnchorId(anchorByControlId, id)}`)}">${text(id)}</a>`).join(", ") || "—";
      return `<article id="risk-acceptance-${attr(r.riskAcceptanceId)}" class="ra-card">
      <h3>${text(r.riskAcceptanceId)} <span class="badge">${text(r.status)}</span></h3>
      <p>${text(r.reason)}</p>
      <p>Approved by ${text(r.approvedBy)} on ${text(r.approvedAt)}, expires ${text(r.expiresAt)}</p>
      ${r.compensatingControls.length ? `<p>Compensating controls: ${r.compensatingControls.map((c) => text(c)).join(", ")}</p>` : ""}
      ${r.revokedAt ? `<p class="badge badge-warning">Revoked ${text(r.revokedAt)}${r.revokedReason ? `: ${text(r.revokedReason)}` : ""}</p>` : ""}
      <p>Referenced by: ${refs}</p>
    </article>`;
    })
    .join("");

  const missingRaCards = model.referenceIntegrity.missingRiskAcceptanceIds
    .map((id) => `<article class="ra-card missing-placeholder"><h3>${text(id)}</h3><p class="badge badge-warning">Referenced but not found in this report</p></article>`)
    .join("");

  return `<section id="evidence-and-risk-acceptance" aria-labelledby="evidence-and-risk-acceptance-heading">
  <h2 id="evidence-and-risk-acceptance-heading">Control Evidence &amp; Risk Acceptance</h2>
  <h3>Evidence</h3>
  <div class="card-grid">${evidenceCards}${missingEvidenceCards}</div>
  <h3>Risk Acceptance</h3>
  <div class="card-grid">${raCards}${missingRaCards}</div>
</section>`;
}

function renderScopeMethodologyLimitations(model: PresentationModel): string {
  const scopeRows = Object.entries(model.assessmentScopes)
    .map(([field, scope]) => {
      const detail =
        "runId" in scope ? ` (run ${text(scope.runId)})` : "contributingRunIds" in scope ? ` (runs: ${scope.contributingRunIds.map((r: string) => text(r)).join(", ")})` : "";
      return `<dt>${text(field)}</dt><dd>${text(scope.kind)}${detail}</dd>`;
    })
    .join("");

  const limitationItems = model.limitations
    .map((l) => `<li class="badge-${attr(l.severity)}"><strong>${text(l.severity)}</strong> — ${text(l.message)}</li>`)
    .join("");

  return `<section id="scope-methodology-limitations" aria-labelledby="scope-methodology-limitations-heading">
  <h2 id="scope-methodology-limitations-heading">Scope, Methodology &amp; Limitations</h2>
  <h3>Assessment scopes</h3>
  <dl>${scopeRows}</dl>
  <h3>Limitations</h3>
  <ul>${limitationItems}</ul>
  <h3>Provenance</h3>
  <dl>
    <dt>Report ID</dt><dd><code>${text(model.metadata.reportId)}</code></dd>
    <dt>Report schema version</dt><dd>${text(model.metadata.reportSchemaVersion)}</dd>
    <dt>Source report SHA-256</dt><dd><code>${text(model.metadata.sourceReportSha256)}</code></dd>
    <dt>Renderer version</dt><dd>${text(model.metadata.rendererVersion)}</dd>
    <dt>Rendered at</dt><dd>${text(model.metadata.rendererRenderedAt)}</dd>
    <dt>Catalog version</dt><dd>${text(model.metadata.catalogVersion)}</dd>
    <dt>Score model</dt><dd>${text(model.metadata.scoreModel.id)} v${text(model.metadata.scoreModel.version)}</dd>
    <dt>Criticality formula</dt><dd>${text(model.metadata.criticalityFormula.id)} v${text(model.metadata.criticalityFormula.version)}</dd>
  </dl>
</section>`;
}

function renderTerminology(): string {
  return `<section id="terminology" aria-labelledby="terminology-heading">
  <h2 id="terminology-heading">Terminology</h2>
  <dl>
    <dt>Finding Verification</dt>
    <dd>The attack scenario and exploitability evidence attached to a <em>Finding</em> — how this specific vulnerability was confirmed, shown in the Findings section.</dd>
    <dt>Control Assessment Evidence</dt>
    <dd>The evidence records attached to a <em>ControlAssessment</em> — what was examined to reach a control's PASS/FAIL/PARTIAL verdict, shown in the Control Evidence &amp; Risk Acceptance section. A different concept from Finding Verification above, even though both are informally "evidence."</dd>
  </dl>
</section>`;
}

const REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #f7f8fa; --surface: #ffffff; --fg: #15181e; --muted: #5b6472; --border: #e2e5ea; --border-strong: #cbd1d9;
  --accent: #3a4ed6; --accent-fg: #ffffff;
  --mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --status-pass: #0f7a3d; --status-pass-bg: #e7f6ec; --status-fail: #b3261e; --status-fail-bg: #fbeae9;
  --status-partial: #9a6400; --status-partial-bg: #fbf1da; --status-na: #5b6472; --status-na-bg: #eef0f3;
  --status-not-tested: #78808d; --status-not-tested-bg: #eef0f3; --status-accepted-risk: #5b3fc4; --status-accepted-risk-bg: #ece9fb;
  --severity-critical: #7a0d0d; --severity-high: #c23616; --severity-medium: #9a6400;
  --severity-low: #2456a6; --severity-informational: #5b6472;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 15px; line-height: 1.6; padding-inline: 16px; -webkit-font-smoothing: antialiased; overflow-wrap: anywhere; }
header, main, footer, nav { max-width: 1040px; margin: 0 auto; }
h1, h2, h3 { text-wrap: balance; font-weight: 700; letter-spacing: -0.01em; }
h1 { font-size: 1.6rem; }
h2 { font-size: 1.2rem; margin-block: 2rem 0.75rem; padding-block-start: 0.25rem; border-top: 1px solid var(--border); }
h3 { font-size: 0.95rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; margin-block: 1.25rem 0.5rem; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { overflow-wrap: anywhere; font-family: var(--mono); font-size: 0.9em; background: var(--status-na-bg); border-radius: 3px; padding: 0.1em 0.35em; }
a:focus-visible, button:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
header { background: var(--fg); color: #e7e9ee; padding-block: 1.5rem 1.25rem; margin-inline: -16px; padding-inline: 16px; }
header h1 { color: #ffffff; margin-block: 0 0.5rem; }
header code { background: rgba(255,255,255,0.1); color: inherit; }
header a { color: #aeb9ff; }
.verdict { display: inline-flex; align-items: center; font-family: var(--mono); font-weight: 700; font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; padding: 0.3em 0.75em; border-radius: 999px; background: color-mix(in srgb, var(--verdict-color) 22%, transparent); color: var(--verdict-color); border: 1px solid color-mix(in srgb, var(--verdict-color) 45%, transparent); }
.target, .run-meta { color: #aab0bd; font-size: 0.85rem; margin-block: 0.35rem; }
nav { display: flex; flex-wrap: wrap; gap: 4px; padding-block: 8px; border-bottom: 1px solid var(--border); position: sticky; top: env(safe-area-inset-top, 0px); background: var(--surface); z-index: 1; }
nav a { color: var(--fg); font-size: 0.85rem; font-weight: 600; padding: 6px 10px; border-radius: 6px; }
nav a:hover { background: var(--status-na-bg); text-decoration: none; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 12px 14px; min-width: 0; }
.kpi dt { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.kpi dd { margin: 0.2rem 0 0; font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.domain-row { display: grid; grid-template-columns: 160px 1fr auto; align-items: center; gap: 12px; padding-block: 8px; min-width: 0; }
.domain-row:not(:last-child) { border-bottom: 1px solid var(--border); }
.domain-name { font-weight: 600; font-size: 0.9rem; }
.bar { background: var(--border); border-radius: 999px; height: 8px; overflow: hidden; min-width: 0; }
.bar-fill { background: var(--accent); height: 100%; border-radius: 999px; }
.bar-fill[style*="width:0%"] { background: var(--status-na); }
.domain-numbers { font-size: 0.8rem; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; min-width: 640px; background: var(--surface); }
caption { text-align: left; font-size: 0.8rem; color: var(--muted); padding: 10px 12px; background: var(--status-na-bg); caption-side: top; }
th, td { border-bottom: 1px solid var(--border); padding: 9px 12px; text-align: left; vertical-align: top; font-size: 0.88rem; }
thead th { background: var(--status-na-bg); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); position: sticky; top: 0; }
tbody tr:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
tbody tr:last-child td { border-bottom: none; }
.status-PASS { color: var(--status-pass); font-weight: 600; }
.status-FAIL { color: var(--status-fail); font-weight: 600; }
.status-PARTIAL { color: var(--status-partial); font-weight: 600; }
.status-N\\/A { color: var(--status-na); }
.status-NOT_TESTED { color: var(--status-not-tested); }
.status-ACCEPTED_RISK { color: var(--status-accepted-risk); font-weight: 600; }
.badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.2em 0.65em; font-size: 0.72rem; font-weight: 600; background: var(--status-na-bg); color: var(--muted); white-space: nowrap; }
.badge-warning { background: var(--status-partial-bg); color: var(--status-partial); }
.badge-info { background: #e8ecff; color: var(--accent); }
.severity-critical .badge-severity { background: color-mix(in srgb, var(--severity-critical) 15%, transparent); color: var(--severity-critical); }
.severity-high .badge-severity { background: color-mix(in srgb, var(--severity-high) 15%, transparent); color: var(--severity-high); }
.severity-medium .badge-severity { background: color-mix(in srgb, var(--severity-medium) 15%, transparent); color: var(--severity-medium); }
.severity-low .badge-severity { background: color-mix(in srgb, var(--severity-low) 15%, transparent); color: var(--severity-low); }
.severity-informational .badge-severity { background: color-mix(in srgb, var(--severity-informational) 15%, transparent); color: var(--severity-informational); }
.reason-badge { font-size: 0.72rem; color: var(--muted); border-bottom: 1px dotted var(--border-strong); cursor: help; }
.finding-card { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: 8px; padding: 10px 14px; margin-block: 8px; }
.finding-card.severity-critical { border-left-color: var(--severity-critical); }
.finding-card.severity-high { border-left-color: var(--severity-high); }
.finding-card.severity-medium { border-left-color: var(--severity-medium); }
.finding-card.severity-low { border-left-color: var(--severity-low); }
.finding-card summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; list-style: none; }
.finding-card summary::-webkit-details-marker { display: none; }
.finding-card .finding-title { font-weight: 600; }
.finding-card dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.75rem; margin-block: 0.75rem 0 0; font-size: 0.88rem; }
.finding-card dt { color: var(--muted); }
.finding-card dd { margin: 0; }
[data-filter] { font: inherit; font-size: 0.82rem; font-weight: 600; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg); cursor: pointer; }
[data-filter][aria-pressed="true"], [data-filter]:hover { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.evidence-card, .ra-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; min-width: 0; }
.evidence-card h3, .ra-card h3 { margin-block: 0 0.4rem; font-size: 0.92rem; color: var(--fg); text-transform: none; letter-spacing: normal; font-family: var(--mono); display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; }
.evidence-card p, .ra-card p { margin-block: 0.3rem; font-size: 0.85rem; }
.missing-placeholder { border-style: dashed; }
#findings-filter-status { color: var(--muted); font-size: 0.85rem; margin-block: 0.75rem; }
dl:not(.kpi-grid) { display: grid; grid-template-columns: minmax(140px, max-content) 1fr; gap: 0.4rem 1rem; font-size: 0.9rem; }
dl:not(.kpi-grid) dt { color: var(--muted); }
dl:not(.kpi-grid) dd { margin: 0; }
footer { color: var(--muted); font-size: 0.85rem; padding-block-end: 2rem; }
footer h2 { font-size: 1.05rem; }
@media (max-width: 400px) {
  .domain-row { grid-template-columns: 1fr; }
  .kpi-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
}
@media print {
  nav, button, [data-filter] { display: none; }
  body { background: #fff; }
  header { background: #fff; color: #000; border-bottom: 2px solid #000; }
  header h1, header a, .target, .run-meta { color: #000; }
  details:not([open]) > *:not(summary) { display: block !important; }
  /* Chromium (131+) renders a <details>'s non-summary content inside an internal
     ::details-content box that clips to zero block-size via content-visibility
     when the element is closed — overriding display on the slotted child above
     is not enough on its own. Force that wrapper open too, so collapsed finding
     cards still print their full content. */
  details::details-content { content-visibility: visible !important; block-size: auto !important; overflow: visible !important; }
  .finding-card, .evidence-card, .ra-card { page-break-inside: avoid; }
  a { color: inherit; text-decoration: underline; }
  .bar-fill, .verdict, .badge { print-color-adjust: exact; }
}
`;

const CLIENT_SCRIPT = `
(function () {
  "use strict";
  var dataEl = document.getElementById("report-data");
  var data = JSON.parse(dataEl.textContent);

  function buildScatter() {
    var svg = d3.select("#priority-criticality-scatter");
    var width = 480, height = 320, margin = { top: 20, right: 20, bottom: 40, left: 40 };
    var x = d3.scaleLinear().domain([0, 9]).range([margin.left, width - margin.right]);
    var y = d3.scaleLinear().domain([0, 9]).range([height - margin.bottom, margin.top]);
    svg.append("g").attr("transform", "translate(0," + (height - margin.bottom) + ")").call(d3.axisBottom(x).ticks(9));
    svg.append("g").attr("transform", "translate(" + margin.left + ",0)").call(d3.axisLeft(y).ticks(9));
    svg.append("text").attr("x", width / 2).attr("y", height - 4).attr("text-anchor", "middle").text("Priority index");
    svg.append("text").attr("x", -height / 2).attr("y", 12).attr("transform", "rotate(-90)").attr("text-anchor", "middle").text("Criticality index");
    svg.selectAll("circle").data(data.findings).join("circle")
      .attr("cx", function (d) { return x(d.priorityIndex); })
      .attr("cy", function (d) { return y(d.criticalityIndex); })
      .attr("r", 5)
      .attr("fill", function (d) { return getComputedStyle(document.documentElement).getPropertyValue("--severity-" + d.severity.toLowerCase()) || "#6b7280"; })
      .append("title").text(function (d) { return d.title + " — Priority index: " + d.priorityIndex + " / Criticality index: " + d.criticalityIndex; });
  }

  function wireFindingsFilter() {
    var buttons = document.querySelectorAll("[data-filter]");
    var status = document.getElementById("findings-filter-status");
    var cards = document.querySelectorAll("#findings-list > .finding-card");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var filter = btn.getAttribute("data-filter");
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        var shown = 0;
        cards.forEach(function (card) {
          var cardStatus = card.getAttribute("data-status");
          var visible = filter === "all" || cardStatus === "open" || cardStatus === "in_progress";
          card.hidden = !visible;
          if (visible) shown++;
        });
        status.textContent = "Showing " + shown + " of " + cards.length + " findings";
      });
    });
  }

  if (typeof d3 !== "undefined" && document.getElementById("priority-criticality-scatter")) buildScatter();
  wireFindingsFilter();
})();
`;

export function renderReportHtml(model: PresentationModel, opts: { d3Source: string }): string {
  const anchorByControlId = buildControlAnchorMap(model);
  const main = [
    renderExecutiveSummary(model, anchorByControlId),
    renderDomainOverview(model),
    renderControlMatrix(model),
    renderFindings(model, anchorByControlId),
    renderEvidenceAndRiskAcceptance(model, anchorByControlId),
  ].join("\n");

  const footerContent = [renderScopeMethodologyLimitations(model), renderTerminology()].join("\n");

  const scriptData = {
    findings: model.findings.map((f) => ({
      findingId: f.findingId, title: f.title, severity: f.severity,
      priorityIndex: f.priorityIndex, criticalityIndex: f.criticalityIndex, status: f.status,
    })),
  };
  const dataJson = escapeForInlineScriptJson(JSON.stringify(scriptData));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
<title>${text(model.metadata.projectName)} — Security Assessment Report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${renderHeader(model)}
<nav aria-label="Report sections">
  <a href="#executive-summary">Executive Summary</a>
  <a href="#domain-overview">Domain Overview</a>
  <a href="#control-matrix">Control Matrix</a>
  <a href="#findings">Findings</a>
  <a href="#evidence-and-risk-acceptance">Control Evidence &amp; Risk Acceptance</a>
  <a href="#scope-methodology-limitations">Scope &amp; Limitations</a>
</nav>
<main>
${main}
</main>
<footer>
${footerContent}
</footer>
<script type="application/json" id="report-data">${dataJson}</script>
<script>${opts.d3Source}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
