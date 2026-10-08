import type { PresentationModel, ControlRow, PresentationLimitationCode } from "./presentation-model.js";
import type { AssessmentScopes } from "./report-builder.js";
import {
  escapeHtmlText as text,
  escapeHtmlAttribute as attr,
  escapeUrlAttribute as href,
  escapeForInlineScriptJson,
} from "./html-escape.js";

export const REPORT_HTML_RENDERER_VERSION = "1.0.0";

const VERDICT_LABELS: Record<string, string> = { approved: "Approved", blocked: "Blocked", indeterminate: "Indeterminate" };

const STATUS_LABELS: Record<string, string> = {
  PASS: "Pass", FAIL: "Fail", PARTIAL: "Partial", "N/A": "N/A", NOT_TESTED: "Not tested", ACCEPTED_RISK: "Accepted risk",
};
const STATUS_MODIFIERS: Record<string, string> = {
  PASS: "pass", FAIL: "fail", PARTIAL: "partial", "N/A": "na", NOT_TESTED: "not-tested", ACCEPTED_RISK: "accepted-risk",
};
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
function statusModifier(status: string): string {
  return STATUS_MODIFIERS[status] ?? "na";
}

const DOMAIN_LABELS: Record<string, string> = {
  appsec: "Application Security",
  artifact_integrity: "Artifact Integrity",
  authentication: "Authentication",
  authorization: "Authorization",
  ci_cd_security: "CI/CD Security",
  data_crypto: "Data & Cryptography",
  dependency_security: "Dependency Security",
  incident_governance: "Incident Governance",
  infrastructure: "Infrastructure",
  operations: "Operations",
  platform_specific: "Platform-Specific",
  release_governance: "Release Governance",
  risk_governance: "Risk Governance",
  vendor_governance: "Vendor Governance",
};
function domainLabel(domain: string): string {
  if (DOMAIN_LABELS[domain]) return DOMAIN_LABELS[domain];
  return domain.split("_").map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

// A control reassessed mid-run produces two ControlRow entries sharing one controlId (see
// AssessmentService.recordAssessment, which mints a fresh assessmentId per call with no dedupe
// on (runId, controlId)). This map resolves controlId -> its most-recently-assessed ControlRow,
// used both for anchor hrefs (so #control-X always points at a single unambiguous row) and for
// looking up a human-readable title wherever a control is referenced only by controlId.
function buildLatestControlByControlId(model: PresentationModel): Map<string, ControlRow> {
  const latest = new Map<string, ControlRow>();
  for (const c of model.controls) {
    const current = latest.get(c.controlId);
    if (!current || c.assessedAt > current.assessedAt) latest.set(c.controlId, c);
  }
  return latest;
}
function controlAnchor(latest: Map<string, ControlRow>, controlId: string): string {
  return latest.get(controlId)?.assessmentId ?? controlId;
}
function controlDisplayTitle(latest: Map<string, ControlRow>, controlId: string): string {
  return latest.get(controlId)?.title ?? controlId;
}

function renderHeader(model: PresentationModel): string {
  const t = model.metadata.target;
  const verdict = model.executive.verdict;
  const targetLine = t.available
    ? `<code>${text(t.repository ?? "")}</code>` +
      (t.branchOrTag ? ` <span aria-hidden="true">·</span> ${text(t.branchOrTag)}` : "") +
      (t.commitSha ? ` <span aria-hidden="true">@</span> <code>${text(t.commitSha)}</code>` : "") +
      (t.dirty ? ` <span class="badge badge-warning">dirty working tree</span>` : "")
    : `<span class="badge badge-info">Legacy assessment — target provenance unavailable</span>`;
  return `<header><div class="header-inner">
  <div class="header-identity">
    <p class="eyebrow">Security Assessment Report</p>
    <h1>${text(model.metadata.projectName)}</h1>
    <p class="target-line">${targetLine}</p>
  </div>
  <div class="header-verdict">
    <span class="label">Assessment verdict</span>
    <span class="verdict verdict--${attr(verdict)}">${text(VERDICT_LABELS[verdict] ?? verdict)}</span>
  </div>
</div></header>`;
}

const TOC_ENTRIES: Array<{ href: string; label: string }> = [
  { href: "#executive-summary", label: "Executive Summary" },
  { href: "#domain-overview", label: "Domain Overview" },
  { href: "#control-matrix", label: "Control Matrix" },
  { href: "#findings", label: "Findings" },
  { href: "#evidence-and-risk-acceptance", label: "Control Evidence & Risk Acceptance" },
  { href: "#scope-methodology-limitations", label: "Scope & Limitations" },
];

function renderSidebar(model: PresentationModel): string {
  const t = model.metadata.target;
  const metaLine = t.available
    ? `<code>${text(t.repository ?? "")}</code>${t.branchOrTag ? ` <span aria-hidden="true">·</span> ${text(t.branchOrTag)}` : ""}${t.commitSha ? ` <span aria-hidden="true">@</span> <code>${text(t.commitSha)}</code>` : ""}`
    : `<span class="badge badge-info">Legacy — provenance unavailable</span>`;
  const toc = TOC_ENTRIES.map(
    (e, i) => `<li><a href="${href(e.href)}" data-toc-link data-toc-label="${attr(`${String(i + 1).padStart(2, "0")} ${e.label}`)}">${String(i + 1).padStart(2, "0")} ${text(e.label)}</a></li>`
  ).join("");
  return `<nav aria-label="Report sections">
  <details class="nav-toggle" data-nav-toggle>
    <summary><span>Sections</span><span class="nav-toggle__current" data-toc-current>${text(TOC_ENTRIES[0].label)}</span></summary>
    <ol class="toc">${toc}</ol>
  </details>
  <p class="sidebar-meta">${metaLine}</p>
</nav>`;
}

function renderExecutiveSummary(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const e = model.executive;
  const openFindingsCount = model.findings.filter((f) => f.status === "open" || f.status === "in_progress").length;

  const explanation: string[] = [];
  if (e.blockingControlFailures.length || e.blockingControlsNotVerified.length) {
    const parts: string[] = [];
    if (e.blockingControlFailures.length) parts.push(`${e.blockingControlFailures.length} blocking control${e.blockingControlFailures.length === 1 ? "" : "s"} failed`);
    if (e.blockingControlsNotVerified.length) parts.push(`${e.blockingControlsNotVerified.length} blocking control${e.blockingControlsNotVerified.length === 1 ? "" : "s"} could not be verified`);
    explanation.push(`${parts.join(" and ")}.`);
  }
  if (e.confirmedCritical || e.confirmedHigh) {
    const parts: string[] = [];
    if (e.confirmedCritical) parts.push(`${e.confirmedCritical} critical`);
    if (e.confirmedHigh) parts.push(`${e.confirmedHigh} high-severity`);
    const count = e.confirmedCritical + e.confirmedHigh;
    explanation.push(`${parts.join(" and ")} finding${count === 1 ? "" : "s"} remain unresolved.`);
  }
  if (!explanation.length) explanation.push("No blocking control failures or unresolved critical/high findings were found.");

  const driverRows = [
    ...e.blockingControlFailures.map((id) => renderDecisionDriver(id, "fail", "Failed", latest)),
    ...e.blockingControlsNotVerified.map((id) => renderDecisionDriver(id, "not-tested", "Not verified", latest)),
  ].join("");
  const decisionDrivers = driverRows
    ? `<div class="decision-drivers">
    <h3>Why this assessment is ${text(e.verdict)}</h3>
    <div class="decision-driver-list">${driverRows}</div>
  </div>`
    : "";

  const topFinding = e.topPrioritizedFinding
    ? `<a class="priority-finding" href="${href(`#finding-${e.topPrioritizedFinding.findingId}`)}">
      <span class="severity severity--${attr(e.topPrioritizedFinding.severity)}">${text(e.topPrioritizedFinding.severity)}</span>
      <span class="priority-finding__body"><strong>${text(e.topPrioritizedFinding.title)}</strong><span>${text(e.topPrioritizedFinding.findingId)} · ${text(e.topPrioritizedFinding.type)}</span></span>
      <span class="priority-finding__arrow" aria-hidden="true">→</span>
    </a>`
    : `<p>No prioritized findings.</p>`;

  return `<section id="executive-summary" aria-labelledby="executive-summary-heading">
  <h2 id="executive-summary-heading">Executive Summary</h2>
  <div class="verdict-panel verdict-panel--${attr(e.verdict)}">
    <p class="label">Assessment verdict</p>
    <p class="verdict-value">${text(VERDICT_LABELS[e.verdict] ?? e.verdict)}</p>
    <p class="verdict-explanation">${explanation.join(" ")}</p>
    <dl class="metric-strip">
      <div><dt>Coverage</dt><dd>${e.coverage.assessed} / ${e.coverage.applicable} <span class="metric-strip__sub">${e.coverage.percent}%</span></dd></div>
      <div><dt>Critical</dt><dd>${e.confirmedCritical}</dd></div>
      <div><dt>High</dt><dd>${e.confirmedHigh}</dd></div>
      <div><dt>Open findings</dt><dd>${openFindingsCount}</dd></div>
    </dl>
  </div>
  ${decisionDrivers}
  <h3>Top prioritized finding</h3>
  ${topFinding}
</section>`;
}

function renderDecisionDriver(controlId: string, modifier: "fail" | "not-tested", label: string, latest: Map<string, ControlRow>): string {
  return `<a class="decision-driver" href="${href(`#control-${controlAnchor(latest, controlId)}`)}">
      <span class="status status--${modifier}">${text(label)}</span>
      <span class="decision-driver__body"><strong>${text(controlId)}</strong><span>${text(controlDisplayTitle(latest, controlId))}</span></span>
    </a>`;
}

function renderDomainOverview(model: PresentationModel): string {
  const rows = model.domains
    .map((d) => {
      const assessed = d.coverage.assessed > 0;
      const label = domainLabel(d.domain);
      const scoreDisplay = assessed ? `${d.score} / 100` : "—";
      const visual = assessed
        ? `<div class="score-bar" role="img" aria-label="${attr(`${label} score ${d.score} out of 100`)}"><span style="width:${d.score}%"></span></div>`
        : `<span class="not-assessed">Not assessed</span>`;
      return `<div class="domain-row${assessed ? "" : " domain-row--unassessed"}">
      <div class="domain-row__name">${text(label)}</div>
      <div class="domain-row__score numeric">${scoreDisplay}</div>
      <div class="domain-row__visual">${visual}</div>
      <div class="domain-row__coverage numeric">${d.coverage.assessed} / ${d.coverage.applicable} <span class="domain-row__coverage-label">assessed</span></div>
    </div>`;
    })
    .join("");
  return `<section id="domain-overview" aria-labelledby="domain-overview-heading">
  <h2 id="domain-overview-heading">Domain Overview</h2>
  <div class="domain-table">${rows}</div>
</section>`;
}

function renderControlMatrix(model: PresentationModel): string {
  const domainStats = new Map<string | null, { passed: number; total: number }>();
  for (const c of model.controls) {
    const stat = domainStats.get(c.domain) ?? { passed: 0, total: 0 };
    stat.total++;
    if (c.effectiveStatus === "PASS") stat.passed++;
    domainStats.set(c.domain, stat);
  }

  const rows: string[] = [];
  let currentDomain: string | null | undefined = undefined;
  for (const c of model.controls) {
    if (c.domain !== currentDomain) {
      currentDomain = c.domain;
      const stat = domainStats.get(c.domain)!;
      const label = c.domain !== null ? domainLabel(c.domain) : "Unmapped controls";
      rows.push(`<tr class="domain-group"><th scope="rowgroup" colspan="6"><span>${text(label)}</span><span class="domain-group__stat numeric">${stat.passed} / ${stat.total} passed</span></th></tr>`);
    }

    const reasonCell = c.effectiveStatusReason ? text(c.effectiveStatusReason.detail ?? c.effectiveStatusReason.label) : "—";
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
    rows.push(`<tr id="control-${attr(c.assessmentId)}" data-effective-status="${attr(c.effectiveStatus)}">
      <th scope="row">
        <span class="control-id">${text(c.controlId)}</span>
        <span class="control-title">${text(c.title ?? c.controlId)}</span>
        ${mismatchBadge}
      </th>
      <td class="recorded-status">${text(statusLabel(c.recordedStatus))}</td>
      <td><span class="status status--${statusModifier(c.effectiveStatus)}">${text(statusLabel(c.effectiveStatus))}</span>${c.recordedStatus !== c.effectiveStatus ? ` <span class="status-changed" title="Recorded status was overridden for scoring">↺</span>` : ""}</td>
      <td class="reason-cell">${reasonCell}</td>
      <td>${evidenceCell}</td>
      <td>${findingsCell}</td>
    </tr>`);
  }

  return `<section id="control-matrix" aria-labelledby="control-matrix-heading">
  <h2 id="control-matrix-heading">Control Matrix</h2>
  <div class="table-scroll">
  <table class="control-matrix">
    <caption>Recorded status is the submitted assessment state. Effective status is the state actually used for score and verdict; the reason column explains any override.</caption>
    <thead><tr>
      <th scope="col">Control</th><th scope="col">Recorded</th><th scope="col">Effective</th>
      <th scope="col">Reason</th><th scope="col">Evidence</th><th scope="col">Findings</th>
    </tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
  </div>
</section>`;
}

function renderFindings(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const knownControlIds = new Set(model.controls.map((c) => c.controlId));
  const openCount = model.findings.filter((f) => f.status === "open" || f.status === "in_progress").length;
  const cards = model.findings.map((f) => renderFindingCard(f, knownControlIds, latest)).join("");
  const showPriorityMap = model.findings.length > 0;

  return `<section id="findings" aria-labelledby="findings-heading">
  <h2 id="findings-heading">Findings</h2>
  <div role="group" aria-label="Finding status filter" class="findings-filter">
    <button type="button" data-filter="all" aria-pressed="true">All <span class="count numeric">${model.findings.length}</span></button>
    <button type="button" data-filter="open" aria-pressed="false">Open <span class="count numeric">${openCount}</span></button>
  </div>
  <p id="findings-filter-status" aria-live="polite">Showing ${model.findings.length} of ${model.findings.length} findings</p>
  <div id="findings-list">${cards}</div>
  ${showPriorityMap ? renderPriorityMap() : ""}
</section>`;
}

function renderFindingCard(f: PresentationModel["findings"][number], knownControlIds: Set<string>, latest: Map<string, ControlRow>): string {
  const linkedControls =
    f.linkedControlIds
      .map((id) => (knownControlIds.has(id) ? `<a href="${href(`#control-${controlAnchor(latest, id)}`)}">${text(id)}</a>` : text(id)))
      .join(", ") || "—";
  const primaryControl = f.linkedControlIds[0];
  return `<details id="finding-${attr(f.findingId)}" class="finding-card severity-${attr(f.severity)}" data-status="${attr(f.status)}">
      <summary>
        <span class="finding-summary__primary">
          <span class="severity severity--${attr(f.severity)}">${text(f.severity)}</span>
          <span class="finding-title">${text(f.title)}</span>
        </span>
        <span class="finding-summary__secondary">
          <span>${text(f.findingId)}</span>
          ${primaryControl ? `<span aria-hidden="true">·</span><span>${text(primaryControl)}</span>` : ""}
        </span>
        <span class="finding-summary__right">
          <span class="badge badge-status">${text(f.status)}</span>
          <span class="index-pair numeric">P${f.priorityIndex} / C${f.criticalityIndex}</span>
        </span>
      </summary>
      <dl class="finding-facts">
        <div><dt>Finding type</dt><dd>${text(f.type)}</dd></div>
        <div><dt>Priority index</dt><dd class="numeric">${f.priorityIndex} / 9</dd></div>
        <div><dt>Criticality index</dt><dd class="numeric">${f.criticalityIndex} / 9</dd></div>
        <div><dt>Linked controls</dt><dd>${linkedControls}</dd></div>
      </dl>
      ${f.attackScenario ? `<div class="finding-narrative"><p class="finding-narrative__label">Attack scenario</p><p>${text(f.attackScenario)}</p></div>` : ""}
      ${f.exploitabilityEvidence ? `<div class="finding-narrative"><p class="finding-narrative__label">Exploitability evidence</p><p>${text(f.exploitabilityEvidence)}</p></div>` : ""}
    </details>`;
}

function renderPriorityMap(): string {
  return `<h3>Prioritization Map</h3>
  <p>Priority index and criticality index are both bounded integers (0–9), not continuous risk scores.</p>
  <svg id="priority-criticality-scatter" viewBox="0 0 480 320" role="img" aria-label="Priority versus criticality plot of findings, each point labeled with its finding ID">
    <title>Priority versus criticality plot</title>
  </svg>`;
}

function renderEvidenceAndRiskAcceptance(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const controlsByEvidenceId = new Map<string, string[]>();
  const controlsByRiskAcceptanceId = new Map<string, string[]>();
  for (const c of model.controls) {
    for (const id of c.evidenceIds) controlsByEvidenceId.set(id, [...(controlsByEvidenceId.get(id) ?? []), c.controlId]);
    if (c.riskAcceptanceId) controlsByRiskAcceptanceId.set(c.riskAcceptanceId, [...(controlsByRiskAcceptanceId.get(c.riskAcceptanceId) ?? []), c.controlId]);
  }

  const evidenceItems = model.evidence
    .map((e) => {
      const refs = (controlsByEvidenceId.get(e.evidenceId) ?? []).map((id) => `<a href="${href(`#control-${controlAnchor(latest, id)}`)}">${text(id)}</a>`).join(", ") || "—";
      return `<article id="evidence-${attr(e.evidenceId)}" class="evidence-record">
      <header><strong>${text(e.evidenceId)}</strong><span class="badge">${text(e.type)}</span></header>
      <code class="evidence-location">${text(e.location)}</code>
      ${e.description ? `<p>${text(e.description)}</p>` : ""}
      <footer class="record-meta">Captured by ${text(e.capturedBy)} · ${text(e.capturedAt)} · Referenced by ${refs}</footer>
    </article>`;
    })
    .join("");

  const raItems = model.riskAcceptances
    .map((r) => {
      const refs = (controlsByRiskAcceptanceId.get(r.riskAcceptanceId) ?? []).map((id) => `<a href="${href(`#control-${controlAnchor(latest, id)}`)}">${text(id)}</a>`).join(", ") || "—";
      const modifier = r.revokedAt ? "revoked" : r.status;
      return `<article id="risk-acceptance-${attr(r.riskAcceptanceId)}" class="risk-acceptance-record">
      <header><strong>${text(r.riskAcceptanceId)}</strong><span class="status status--${attr(modifier)}">${text(modifier === "revoked" ? "Revoked" : r.status[0].toUpperCase() + r.status.slice(1))}</span></header>
      <p class="risk-rationale">${text(r.reason)}</p>
      <dl class="record-facts">
        <div><dt>Approved by</dt><dd>${text(r.approvedBy)}</dd></div>
        <div><dt>Approved</dt><dd>${text(r.approvedAt)}</dd></div>
        <div><dt>Expires</dt><dd>${text(r.expiresAt)}</dd></div>
        ${r.compensatingControls.length ? `<div><dt>Compensating controls</dt><dd>${r.compensatingControls.map((c) => text(c)).join(", ")}</dd></div>` : ""}
      </dl>
      ${r.revokedAt ? `<p class="badge badge-warning">Revoked ${text(r.revokedAt)}${r.revokedReason ? `: ${text(r.revokedReason)}` : ""}</p>` : ""}
      <footer class="record-meta">Referenced by ${refs}</footer>
    </article>`;
    })
    .join("");

  return `<section id="evidence-and-risk-acceptance" aria-labelledby="evidence-and-risk-acceptance-heading">
  <h2 id="evidence-and-risk-acceptance-heading">Control Evidence &amp; Risk Acceptance</h2>
  <h3>Evidence</h3>
  <div class="record-list">${evidenceItems || "<p>No evidence was referenced by this assessment run.</p>"}</div>
  <h3>Risk Acceptance</h3>
  <div class="record-list">${raItems || "<p>No risk acceptances were referenced by this assessment run.</p>"}</div>
</section>`;
}

function describeScope(scope: AssessmentScopes[keyof AssessmentScopes]): string {
  switch (scope.kind) {
    case "project":
      return "This project, across all assessment history";
    case "project-assessment-set":
      return `Assessment run${scope.contributingRunIds.length === 1 ? "" : "s"} contributing to this report: ${scope.contributingRunIds.map((r) => text(r)).join(", ")}`;
    case "run":
      return `This report's assessment run (<code>${text(scope.runId)}</code>)`;
    case "referenced-by-run":
      return `Referenced by this report's assessment run (<code>${text(scope.runId)}</code>)`;
    default:
      return text((scope as { kind: string }).kind);
  }
}

const INTEGRITY_LIMITATION_CODES = new Set<PresentationLimitationCode>([
  "control_definition_version_mismatch",
  "missing_evidence",
  "missing_risk_acceptance",
  "missing_finding_reference",
]);

function renderReportIntegrity(model: PresentationModel): string {
  const ri = model.referenceIntegrity;
  const rows: string[] = [];
  if (ri.missingEvidenceIds.length) rows.push(`<li>${ri.missingEvidenceIds.length} evidence reference${ri.missingEvidenceIds.length === 1 ? "" : "s"} could not be resolved: ${ri.missingEvidenceIds.map((id) => `<code>${text(id)}</code>`).join(", ")}</li>`);
  if (ri.missingRiskAcceptanceIds.length) rows.push(`<li>${ri.missingRiskAcceptanceIds.length} risk acceptance reference${ri.missingRiskAcceptanceIds.length === 1 ? "" : "s"} could not be resolved: ${ri.missingRiskAcceptanceIds.map((id) => `<code>${text(id)}</code>`).join(", ")}</li>`);
  if (ri.missingFindingIds.length) rows.push(`<li>${ri.missingFindingIds.length} finding reference${ri.missingFindingIds.length === 1 ? "" : "s"} could not be resolved: ${ri.missingFindingIds.map((id) => `<code>${text(id)}</code>`).join(", ")}</li>`);
  if (ri.unresolvedControlDefinitions.length) rows.push(`<li>${ri.unresolvedControlDefinitions.length} control definition${ri.unresolvedControlDefinitions.length === 1 ? "" : "s"} could not be resolved against the catalog: ${ri.unresolvedControlDefinitions.map((id) => `<code>${text(id)}</code>`).join(", ")}</li>`);
  if (!rows.length) return `<p class="integrity-ok">No reference integrity issues were found in this report.</p>`;
  return `<ul class="integrity-list">${rows.join("")}</ul>`;
}

function renderScopeMethodologyLimitations(model: PresentationModel): string {
  const s = model.assessmentScopes;
  const customerScope = `<dl class="scope-facts">
    <div><dt>Findings</dt><dd>${describeScope(s.projectFindingSnapshots)}</dd></div>
    <div><dt>Score &amp; release verdict</dt><dd>${describeScope(s.score)}</dd></div>
    <div><dt>Control assessments</dt><dd>${describeScope(s.runControlAssessmentSnapshots)}</dd></div>
    <div><dt>Evidence</dt><dd>${describeScope(s.evidenceSnapshots)}</dd></div>
    <div><dt>Risk acceptances</dt><dd>${describeScope(s.riskAcceptanceSnapshots)}</dd></div>
  </dl>`;
  const technicalScope = Object.entries(s)
    .map(([field, scope]) => `<dt>${text(field)}</dt><dd>${text(scope.kind)}${"runId" in scope ? ` (run ${text(scope.runId)})` : "contributingRunIds" in scope ? ` (runs: ${scope.contributingRunIds.map((r: string) => text(r)).join(", ")})` : ""}</dd>`)
    .join("");

  const genuineLimitations = model.limitations.filter((l) => !INTEGRITY_LIMITATION_CODES.has(l.code));
  const limitationItems = genuineLimitations.length
    ? `<ul class="limitation-list">${genuineLimitations.map((l) => `<li><span class="label label--${attr(l.severity)}">${text(l.severity)}</span> ${text(l.message)}</li>`).join("")}</ul>`
    : `<p>No assessment limitations were recorded.</p>`;

  return `<section id="scope-methodology-limitations" aria-labelledby="scope-methodology-limitations-heading">
  <h2 id="scope-methodology-limitations-heading">Scope, Methodology &amp; Limitations</h2>
  <h3>Assessment scope</h3>
  ${customerScope}
  <details class="technical-details"><summary>Technical scope mapping</summary><dl>${technicalScope}</dl></details>
  <h3>Limitations</h3>
  ${limitationItems}
  <h3>Report integrity</h3>
  ${renderReportIntegrity(model)}
  <h3>Provenance</h3>
  <details class="provenance">
    <summary>Report provenance &amp; integrity</summary>
    <dl>
      <div><dt>Report ID</dt><dd><code>${text(model.metadata.reportId)}</code></dd></div>
      <div><dt>Report schema version</dt><dd>${text(model.metadata.reportSchemaVersion)}</dd></div>
      <div><dt>Assessment run</dt><dd><code>${text(model.metadata.assessmentRunId)}</code></dd></div>
      ${model.metadata.engineVersionAtRunStart ? `<div><dt>Engine version</dt><dd>${text(model.metadata.engineVersionAtRunStart)}</dd></div>` : ""}
      <div><dt>Catalog version</dt><dd>${text(model.metadata.catalogVersion)}</dd></div>
      <div><dt>Score model</dt><dd>${text(model.metadata.scoreModel.id)} v${text(model.metadata.scoreModel.version)}</dd></div>
      <div><dt>Criticality formula</dt><dd>${text(model.metadata.criticalityFormula.id)} v${text(model.metadata.criticalityFormula.version)}</dd></div>
      <div><dt>Source report SHA-256</dt><dd><code>${text(model.metadata.sourceReportSha256)}</code></dd></div>
      <div><dt>Renderer version</dt><dd>${text(model.metadata.rendererVersion)}</dd></div>
      <div><dt>Rendered at</dt><dd>${text(model.metadata.rendererRenderedAt)}</dd></div>
    </dl>
  </details>
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
  --page: #f6f7f9; --surface: #ffffff; --surface-subtle: #f2f4f7; --border: #d9dee7; --border-strong: #c7ceda;
  --text: #161b22; --text-secondary: #475467; --text-tertiary: #667085; --text-inverse: #f8fafc;
  --brand: #3557d5; --brand-soft: #eef2ff;
  --mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --status-pass: #067647; --status-pass-bg: #ecfdf3; --status-fail: #b42318; --status-fail-bg: #fef3f2;
  --status-partial: #9a6700; --status-partial-bg: #fff8e1; --status-na: #596475; --status-na-bg: #f2f4f7;
  --status-not-tested: #596475; --status-not-tested-bg: #f2f4f7; --status-accepted-risk: #6941c6; --status-accepted-risk-bg: #f4f3ff;
  --status-revoked: #9a6700; --status-revoked-bg: #fff8e1; --status-active: #067647; --status-active-bg: #ecfdf3; --status-expired: #596475; --status-expired-bg: #f2f4f7;
  --severity-critical: #a61b1b; --severity-critical-bg: #fdecec; --severity-high: #c2410c; --severity-high-bg: #fff0e8;
  --severity-medium: #8a5a00; --severity-medium-bg: #fff6d9; --severity-low: #1d4ed8; --severity-low-bg: #eaf2ff;
  --severity-informational: #596475; --severity-informational-bg: #f2f4f7;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text); font-family: var(--sans); font-size: 15px; line-height: 1.6; padding-inline: 16px; -webkit-font-smoothing: antialiased; overflow-wrap: anywhere; }
.numeric { font-variant-numeric: tabular-nums; }
main, footer, nav { max-width: 1240px; margin: 0 auto; }
.layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 32px; max-width: 1240px; margin: 0 auto; align-items: start; }
.content { min-width: 0; }
h1, h2, h3 { text-wrap: balance; font-weight: 700; letter-spacing: -0.01em; }
h1 { font-size: 1.75rem; margin: 0; }
h2 { font-size: 1.25rem; margin-block: 2.25rem 0.9rem; padding-block-start: 0.25rem; border-top: 1px solid var(--border); }
h3 { font-size: 0.95rem; color: var(--text-secondary); margin-block: 1.5rem 0.6rem; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
code { overflow-wrap: anywhere; font-family: var(--mono); font-size: 0.9em; background: var(--surface-subtle); border-radius: 3px; padding: 0.1em 0.35em; }
a:focus-visible, button:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 2px; }

body > header { background: #11151c; color: var(--text-inverse); margin-inline: -16px; }
.header-inner { max-width: 1240px; margin: 0 auto; padding: 22px 16px 20px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.eyebrow { margin: 0 0 4px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9aa4c2; }
.header-identity .target-line { margin: 6px 0 0; font-size: 0.85rem; color: #aab2cc; }
.header-identity code { background: rgba(255,255,255,0.1); color: inherit; }
.header-verdict { text-align: right; }
.header-verdict .label { display: block; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #9aa4c2; margin: 0 0 4px; }

.verdict, .status, .severity { display: inline-flex; align-items: center; font-weight: 700; font-size: 0.78rem; letter-spacing: 0.03em; padding: 0.3em 0.7em; border-radius: 999px; }
.verdict--approved, .status--pass, .status--active, .severity--informational { background: var(--status-pass-bg); color: var(--status-pass); }
.verdict--blocked, .status--fail, .severity--critical { background: var(--severity-critical-bg); color: var(--severity-critical); }
.verdict--indeterminate, .status--partial, .status--not-tested, .status--revoked, .status--expired { background: var(--status-partial-bg); color: var(--status-partial); }
.status--na { background: var(--status-na-bg); color: var(--status-na); }
.status--accepted-risk { background: var(--status-accepted-risk-bg); color: var(--status-accepted-risk); }
.severity--high { background: var(--severity-high-bg); color: var(--severity-high); }
.severity--medium { background: var(--severity-medium-bg); color: var(--severity-medium); }
.severity--low { background: var(--severity-low-bg); color: var(--severity-low); }
.label { display: inline-flex; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.15em 0.5em; border-radius: 4px; }
.label--info { background: var(--brand-soft); color: var(--brand); }
.label--warning { background: var(--status-partial-bg); color: var(--status-partial); }

nav[aria-label="Report sections"] { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 16px); align-self: start; min-width: 0; }
.nav-toggle { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 6px; }
.nav-toggle summary { cursor: default; list-style: none; padding: 6px 8px; font-weight: 600; font-size: 0.82rem; }
.nav-toggle summary::-webkit-details-marker { display: none; }
.toc { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.toc a { display: block; padding: 7px 10px; border-radius: 6px; font-size: 0.82rem; font-weight: 600; color: var(--text); }
.toc a:hover { background: var(--surface-subtle); text-decoration: none; }
.toc a[aria-current="true"] { background: var(--brand-soft); color: var(--brand); border-left: 2px solid var(--brand); padding-left: 8px; }
.sidebar-meta { margin: 12px 4px 0; font-size: 0.78rem; color: var(--text-secondary); }
.sidebar-meta .badge { white-space: normal; text-align: left; }
@media (min-width: 901px) {
  .nav-toggle summary { display: none; }
  .nav-toggle > *:not(summary) { display: block !important; }
  /* Same Chromium (131+) ::details-content clipping as the print rule below: a closed
     <details>'s non-summary content lives in an internal box that ignores the display
     override above unless this wrapper is also forced open. */
  .nav-toggle::details-content { content-visibility: visible !important; block-size: auto !important; overflow: visible !important; }
}

.verdict-panel { background: var(--surface); border: 1px solid var(--border); border-top: 3px solid var(--border-strong); border-radius: 12px; padding: 22px 24px; }
.verdict-panel--blocked { border-top-color: var(--severity-critical); }
.verdict-panel--approved { border-top-color: var(--status-pass); }
.verdict-panel--indeterminate { border-top-color: var(--status-partial); }
.verdict-panel .label { display: block; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-secondary); margin: 0 0 6px; background: none; padding: 0; }
.verdict-value { margin: 0; font-size: 1.9rem; font-weight: 700; letter-spacing: -0.01em; }
.verdict-explanation { margin: 10px 0 0; color: var(--text-secondary); max-width: 62ch; }
.metric-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 16px; margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--border); }
.metric-strip dt { font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
.metric-strip dd { margin: 0.2rem 0 0; font-size: 1.3rem; font-weight: 700; }
.metric-strip__sub { font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); }

.decision-drivers { margin-top: 18px; }
.decision-driver-list { display: flex; flex-direction: column; gap: 6px; }
.decision-driver { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: var(--text); }
.decision-driver:hover { background: var(--surface-subtle); text-decoration: none; }
.decision-driver__body { display: flex; flex-direction: column; gap: 1px; font-size: 0.88rem; }
.decision-driver__body span { color: var(--text-secondary); font-size: 0.85rem; }

.priority-finding { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; color: var(--text); }
.priority-finding:hover { background: var(--surface-subtle); text-decoration: none; }
.priority-finding__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.priority-finding__body span { color: var(--text-secondary); font-size: 0.82rem; }
.priority-finding__arrow { color: var(--text-tertiary); }

.domain-table { display: flex; flex-direction: column; }
.domain-row { display: grid; grid-template-columns: minmax(140px, 200px) 70px 1fr 120px; align-items: center; gap: 14px; padding-block: 10px; min-width: 0; }
.domain-row:not(:last-child) { border-bottom: 1px solid var(--border); }
.domain-row__name { font-weight: 600; font-size: 0.9rem; }
.domain-row__score { font-weight: 700; }
.domain-row--unassessed .domain-row__score { color: var(--text-tertiary); font-weight: 400; }
.score-bar { background: var(--surface-subtle); border-radius: 999px; height: 8px; overflow: hidden; min-width: 0; }
.score-bar span { display: block; background: var(--brand); height: 100%; border-radius: 999px; }
.not-assessed { font-size: 0.78rem; color: var(--text-tertiary); font-style: italic; }
.domain-row__coverage { font-size: 0.82rem; color: var(--text-secondary); white-space: nowrap; }
.domain-row__coverage-label { color: var(--text-tertiary); }

.table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; min-width: 680px; background: var(--surface); }
caption { text-align: left; font-size: 0.8rem; color: var(--text-secondary); padding: 10px 14px; background: var(--surface-subtle); caption-side: top; }
th, td { border-bottom: 1px solid var(--border); padding: 10px 14px; text-align: left; vertical-align: top; font-size: 0.87rem; }
thead th { background: var(--surface-subtle); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); position: sticky; top: 0; }
tbody tr:hover:not(.domain-group) { background: var(--surface-subtle); }
tbody tr:last-child td { border-bottom: none; }
tr.domain-group th { background: var(--page); color: var(--text-secondary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; display: flex; justify-content: space-between; gap: 12px; }
.control-id { display: block; font-family: var(--mono); font-size: 0.78rem; color: var(--text-secondary); }
.control-title { display: block; font-weight: 600; font-size: 0.88rem; margin-top: 1px; }
.recorded-status { color: var(--text-tertiary); }
.status-changed { color: var(--text-tertiary); cursor: help; }
.reason-cell { color: var(--text-secondary); max-width: 26ch; }

.badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.2em 0.65em; font-size: 0.72rem; font-weight: 600; background: var(--surface-subtle); color: var(--text-secondary); white-space: nowrap; }
.badge-warning { background: var(--status-partial-bg); color: var(--status-partial); }
.badge-info { background: var(--brand-soft); color: var(--brand); }
.badge-status { text-transform: capitalize; }

.findings-filter { display: flex; gap: 6px; }
[data-filter] { font: inherit; font-size: 0.82rem; font-weight: 600; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
[data-filter] .count { background: var(--surface-subtle); border-radius: 999px; padding: 0 6px; font-size: 0.75rem; }
[data-filter][aria-pressed="true"], [data-filter]:hover { background: var(--brand); border-color: var(--brand); color: var(--text-inverse); }
[data-filter][aria-pressed="true"] .count, [data-filter]:hover .count { background: rgba(255,255,255,0.2); color: inherit; }
#findings-filter-status { color: var(--text-secondary); font-size: 0.85rem; margin-block: 0.75rem; }

.finding-card { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: 10px; padding: 12px 16px; margin-block: 8px; }
.finding-card.severity-critical { border-left-color: var(--severity-critical); }
.finding-card.severity-high { border-left-color: var(--severity-high); }
.finding-card.severity-medium { border-left-color: var(--severity-medium); }
.finding-card.severity-low { border-left-color: var(--severity-low); }
.finding-card summary { cursor: pointer; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; list-style: none; }
.finding-card summary::-webkit-details-marker { display: none; }
.finding-card .finding-title { font-weight: 600; }
.finding-summary__secondary { font-size: 0.82rem; color: var(--text-secondary); display: flex; gap: 6px; }
.finding-summary__right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.index-pair { font-size: 0.78rem; color: var(--text-tertiary); }
#priority-criticality-scatter { display: block; width: 100%; max-width: 520px; height: auto; color: var(--text-secondary); }
.finding-facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 0.9rem; margin-block: 0.9rem 0; font-size: 0.87rem; }
.finding-facts dt { color: var(--text-secondary); }
.finding-facts dd { margin: 0; }
.finding-narrative { background: var(--surface-subtle); border-radius: 8px; padding: 12px 14px; margin-top: 10px; }
.finding-narrative__label { margin: 0 0 4px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-secondary); }
.finding-narrative p:last-child { margin-bottom: 0; }

.record-list { display: flex; flex-direction: column; gap: 10px; }
.evidence-record, .risk-acceptance-record { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; min-width: 0; }
.evidence-record header, .risk-acceptance-record header { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 0.85rem; margin-bottom: 6px; }
.evidence-location { display: block; margin-bottom: 6px; }
.risk-rationale { margin: 0 0 10px; }
.record-facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.9rem; font-size: 0.85rem; }
.record-facts dt { color: var(--text-secondary); }
.record-facts dd { margin: 0; }
.record-meta { margin-top: 8px; font-size: 0.78rem; color: var(--text-tertiary); }

.integrity-list { padding-left: 1.2em; }
.integrity-list li { margin-block: 4px; color: var(--status-partial); }
.integrity-ok { color: var(--text-secondary); }
.limitation-list { padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.limitation-list li { display: flex; gap: 8px; align-items: baseline; }
.technical-details { margin-top: 10px; }
.technical-details summary { cursor: pointer; font-size: 0.82rem; color: var(--text-secondary); }
.provenance summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; }
.provenance code { overflow-wrap: anywhere; }

dl:not(.metric-strip):not(.finding-facts):not(.record-facts) { display: grid; grid-template-columns: minmax(150px, max-content) 1fr; gap: 0.4rem 1.2rem; font-size: 0.88rem; }
dl:not(.metric-strip):not(.finding-facts):not(.record-facts) dt { color: var(--text-secondary); }
dl:not(.metric-strip):not(.finding-facts):not(.record-facts) dd { margin: 0; }

footer { color: var(--text-secondary); font-size: 0.85rem; padding-block-end: 2rem; }
footer h2 { font-size: 1.1rem; }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; gap: 0; }
  nav[aria-label="Report sections"] { position: static; margin-bottom: 1.25rem; }
  .nav-toggle summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .nav-toggle__current { font-weight: 400; color: var(--text-secondary); font-size: 0.8rem; }
  .domain-row { grid-template-columns: 1fr; gap: 4px; }
  .domain-row__coverage { text-align: left; }
}
@media (max-width: 480px) {
  .metric-strip { grid-template-columns: repeat(2, 1fr); }
  .header-inner { align-items: flex-start; }
  .header-verdict { text-align: left; }
}
@media print {
  nav, button, [data-filter] { display: none; }
  body { background: #fff; }
  .layout { display: block; max-width: none; }
  body > header { background: #fff; color: #000; border-bottom: 2px solid #000; }
  .header-identity .target-line, .eyebrow, .header-verdict .label { color: #333; }
  body > header h1 { color: #000; }
  details:not([open]) > *:not(summary) { display: block !important; }
  /* Chromium (131+) renders a <details>'s non-summary content inside an internal
     ::details-content box that clips to zero block-size via content-visibility
     when the element is closed — overriding display on the slotted child above
     is not enough on its own. Force that wrapper open too, so collapsed finding
     cards still print their full content. */
  details::details-content { content-visibility: visible !important; block-size: auto !important; overflow: visible !important; }
  thead { display: table-header-group; }
  .finding-card, .evidence-record, .risk-acceptance-record, tr { break-inside: avoid; }
  a { color: inherit; text-decoration: underline; }
  .score-bar span, .verdict, .status, .severity, .badge { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
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
    var points = svg.append("g").selectAll("g.point").data(data.findings).join("g").attr("class", "point");
    points.append("circle")
      .attr("cx", function (d) { return x(d.priorityIndex); })
      .attr("cy", function (d) { return y(d.criticalityIndex); })
      .attr("r", 5)
      .attr("fill", function (d) { return getComputedStyle(document.documentElement).getPropertyValue("--severity-" + d.severity.toLowerCase()) || "#6b7280"; })
      .append("title").text(function (d) { return d.title + " — Priority index: " + d.priorityIndex + " / Criticality index: " + d.criticalityIndex; });
    points.append("text")
      .attr("x", function (d) { return x(d.priorityIndex) + 7; })
      .attr("y", function (d) { return y(d.criticalityIndex) - 7; })
      .attr("font-size", "9px")
      .attr("fill", "currentColor")
      .text(function (d) { return d.findingId; });
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

  function wireTocHighlight() {
    var links = document.querySelectorAll("[data-toc-link]");
    var currentLabel = document.querySelector("[data-toc-current]");
    if (!links.length || typeof IntersectionObserver === "undefined") return;
    var linkByTargetId = {};
    links.forEach(function (link) {
      var id = link.getAttribute("href").replace("#", "");
      linkByTargetId[id] = link;
      link.setAttribute("aria-current", "false");
    });
    var current = null;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var link = linkByTargetId[entry.target.id];
          if (!link || link === current) return;
          if (current) current.setAttribute("aria-current", "false");
          link.setAttribute("aria-current", "true");
          current = link;
          if (currentLabel) currentLabel.textContent = link.getAttribute("data-toc-label") || link.textContent;
        });
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    Object.keys(linkByTargetId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  function wirePrintExpansion() {
    var printStates = new Map();
    window.addEventListener("beforeprint", function () {
      document.querySelectorAll("details").forEach(function (d) {
        printStates.set(d, d.open);
        d.open = true;
      });
    });
    window.addEventListener("afterprint", function () {
      printStates.forEach(function (wasOpen, d) { d.open = wasOpen; });
      printStates.clear();
    });
  }

  if (typeof d3 !== "undefined" && document.getElementById("priority-criticality-scatter")) buildScatter();
  wireFindingsFilter();
  wireTocHighlight();
  wirePrintExpansion();
})();
`;

export function renderReportHtml(model: PresentationModel, opts: { d3Source: string }): string {
  const latest = buildLatestControlByControlId(model);
  const main = [
    renderExecutiveSummary(model, latest),
    renderDomainOverview(model),
    renderControlMatrix(model),
    renderFindings(model, latest),
    renderEvidenceAndRiskAcceptance(model, latest),
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
<div class="layout">
${renderSidebar(model)}
<div class="content">
<main>
${main}
</main>
<footer>
${footerContent}
</footer>
</div>
</div>
<script type="application/json" id="report-data">${dataJson}</script>
<script>${opts.d3Source}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
