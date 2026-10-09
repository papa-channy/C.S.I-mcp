import type { PresentationModel, ControlRow, PresentationLimitation, PresentationLimitationCode } from "./presentation-model.js";
import type { AssessmentScopes } from "./report-builder.js";
import {
  escapeHtmlText as text,
  escapeHtmlAttribute as attr,
  escapeUrlAttribute as href,
  escapeForInlineScriptJson,
} from "./html-escape.js";

export const REPORT_HTML_RENDERER_VERSION = "1.0.0";

// Wraps a piece of STATIC report chrome (headings, labels, fixed sentences the renderer itself
// composes) so the client can toggle it between English and Korean with no network request and
// no second server render — both strings are always embedded; the English one is visible by
// default, the Korean one sits in a data attribute until the viewer picks it. Never used for
// caller-supplied data (finding/control titles, evidence text, assessor names, free-text
// reasons) — that content stays exactly as the assessment recorded it, in whatever language it
// was written in, regardless of the UI language toggle.
function t(en: string, ko: string): string {
  return `<span class="i18n" data-ko="${attr(ko)}">${text(en)}</span>`;
}

const VERDICT_LABELS: Record<string, string> = { approved: "Approved", blocked: "Blocked", indeterminate: "Indeterminate" };
const VERDICT_LABELS_KO: Record<string, string> = { approved: "승인", blocked: "차단됨", indeterminate: "판단 보류" };
const VERDICT_REASON_KO: Record<string, string> = { approved: "승인된", blocked: "차단된", indeterminate: "판단 보류된" };

const STATUS_LABELS: Record<string, string> = {
  PASS: "Pass", FAIL: "Fail", PARTIAL: "Partial", "N/A": "N/A", NOT_TESTED: "Not tested", ACCEPTED_RISK: "Accepted risk",
};
const STATUS_LABELS_KO: Record<string, string> = {
  PASS: "통과", FAIL: "실패", PARTIAL: "부분 충족", "N/A": "해당 없음", NOT_TESTED: "미검증", ACCEPTED_RISK: "위험 수용",
};
const STATUS_MODIFIERS: Record<string, string> = {
  PASS: "pass", FAIL: "fail", PARTIAL: "partial", "N/A": "na", NOT_TESTED: "not-tested", ACCEPTED_RISK: "accepted-risk",
};
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
function statusLabelKo(status: string): string {
  return STATUS_LABELS_KO[status] ?? status;
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
const DOMAIN_LABELS_KO: Record<string, string> = {
  appsec: "애플리케이션 보안",
  artifact_integrity: "아티팩트 무결성",
  authentication: "인증",
  authorization: "인가",
  ci_cd_security: "CI/CD 보안",
  data_crypto: "데이터 및 암호화",
  dependency_security: "의존성 보안",
  incident_governance: "사고 대응 거버넌스",
  infrastructure: "인프라",
  operations: "운영",
  platform_specific: "플랫폼 특화",
  release_governance: "릴리스 거버넌스",
  risk_governance: "위험 거버넌스",
  vendor_governance: "벤더 거버넌스",
};
function domainLabel(domain: string): string {
  if (DOMAIN_LABELS[domain]) return DOMAIN_LABELS[domain];
  return domain.split("_").map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}
function domainLabelKo(domain: string): string {
  return DOMAIN_LABELS_KO[domain] ?? domainLabel(domain);
}

// Humanizes a snake_case/raw enum value for customer-facing display, e.g. "control_gap" ->
// "Control gap" (sentence case, not title case — only the first letter is capitalized).
function humanizeEnum(value: string): string {
  const words = value.toLowerCase().split("_").join(" ");
  return words.length ? words[0].toUpperCase() + words.slice(1) : words;
}

const FINDING_TYPE_LABELS_KO: Record<string, string> = {
  control_gap: "통제 공백",
  confirmed_vulnerability: "확인된 취약점",
};
const EVIDENCE_TYPE_LABELS_KO: Record<string, string> = {
  CODE: "코드", CONFIG: "설정", AUTOMATED_TEST: "자동화 테스트", MANUAL_TEST: "수동 테스트", SCAN: "스캔", LOG: "로그",
  AUDIT_LOG: "감사 로그", ARCHITECTURE: "아키텍처", CI_ARTIFACT: "CI 아티팩트", DEPLOYMENT_RECORD: "배포 기록",
  SCREENSHOT: "스크린샷", TICKET: "티켓", REPORT: "리포트", MANUAL_REVIEW: "수동 검토",
};
// Falls back to the humanized English string when a given raw value has no specific Korean
// entry — these enums are open-ended at the data-model layer, so an unmapped value should
// degrade to readable English text rather than disappear or throw.
function humanizeEnumKo(value: string, table: Record<string, string>): string {
  return table[value] ?? humanizeEnum(value);
}

// Deterministic, locale-pinned date formatting: the renderer is a pure function of its input, so
// this must never depend on the host machine's locale or timezone — only on the (ISO string,
// language) pair already fully determined by the time this runs. Raw ISO strings remain
// available verbatim in the Provenance block for anyone who needs the exact machine-readable
// value, in both languages.
function formatDateTime(iso: string, lang: "en" | "ko" = "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = lang === "ko" ? "ko-KR" : "en-US";
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d);
  return lang === "ko" ? `${date} ${time} UTC` : `${date}, ${time} UTC`;
}
// Renders a date as English text with the Korean rendering available via the toggle, exactly
// like t() does for static chrome — the underlying instant is identical either way, only the
// formatting changes.
function td(iso: string): string {
  return t(formatDateTime(iso, "en"), formatDateTime(iso, "ko"));
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

// projectName is caller-supplied free text the renderer must otherwise treat as opaque — this
// project's own naming convention often appends a "(owner/repo)" parenthetical AND further
// human-distinguishing text (e.g. "... — v2 re-assessment", "... — blind pinned-commit
// re-assessment (<sha>, <date>)") used to tell apart repeated assessments of the same
// repository. The target line directly below the H1 already states the repository, so only
// that exact "(owner/repo)" substring is stripped here — never a generic parenthetical regex,
// which would just as easily eat the distinguishing suffix this convention depends on.
function displayProjectName(model: PresentationModel): string {
  const name = model.metadata.projectName;
  const t = model.metadata.target;
  if (!t.available || !t.repository) return name;
  const marker = `(${t.repository})`;
  const idx = name.indexOf(marker);
  if (idx === -1) return name;
  return (name.slice(0, idx) + name.slice(idx + marker.length)).replace(/\s{2,}/g, " ").trim();
}

function renderHeader(model: PresentationModel): string {
  const tg = model.metadata.target;
  const verdict = model.executive.verdict;
  const targetLine = tg.available
    ? `<code>${text(tg.repository ?? "")}</code>` +
      (tg.branchOrTag ? ` <span aria-hidden="true">·</span> ${text(tg.branchOrTag)}` : "") +
      (tg.commitSha ? ` <span aria-hidden="true">@</span> <code>${text(tg.commitSha)}</code>` : "") +
      (tg.dirty ? ` <span class="badge badge-warning">${t("dirty working tree", "미커밋 변경사항 있음")}</span>` : "")
    : `<span class="badge badge-info">${t("Legacy assessment — target provenance unavailable", "레거시 평가 — 대상 출처 정보 없음")}</span>`;
  return `<header><div class="header-inner">
  <div class="header-identity">
    <p class="eyebrow">${t("Security Assessment Report", "보안 평가 보고서")}</p>
    <h1>${text(displayProjectName(model))}</h1>
    <p class="target-line">${targetLine}</p>
  </div>
  <div class="header-verdict">
    <span class="label">${t("Assessment verdict", "평가 결과")}</span>
    <span class="verdict verdict--${attr(verdict)}">${t(VERDICT_LABELS[verdict] ?? verdict, VERDICT_LABELS_KO[verdict] ?? verdict)}</span>
  </div>
</div></header>`;
}

const TOC_ENTRIES: Array<{ href: string; label: string; labelKo: string }> = [
  { href: "#executive-summary", label: "Executive Summary", labelKo: "요약" },
  { href: "#domain-overview", label: "Domain Overview", labelKo: "도메인 개요" },
  { href: "#control-matrix", label: "Control Matrix", labelKo: "컨트롤 매트릭스" },
  { href: "#findings", label: "Findings", labelKo: "발견 사항" },
  { href: "#evidence-and-risk-acceptance", label: "Control Evidence & Risk Acceptance", labelKo: "컨트롤 증적 및 위험 수용" },
  { href: "#scope-methodology-limitations", label: "Scope & Limitations", labelKo: "범위 및 한계" },
];

function renderSidebar(): string {
  // Target/run metadata lives in the header (identity) and Scope's provenance block (audit
  // detail) only — a third copy here was pure duplication, most visible on mobile where it
  // pushed Executive Summary most of a screen's height further down.
  const toc = TOC_ENTRIES.map((e, i) => {
    const n = String(i + 1).padStart(2, "0");
    return `<li><a href="${href(e.href)}" data-toc-link>${n} ${t(e.label, e.labelKo)}</a></li>`;
  }).join("");
  return `<nav aria-label="Report sections">
  <details class="nav-toggle" data-nav-toggle>
    <summary><span>${t("Sections", "섹션")}</span><span class="nav-toggle__current" data-toc-current>${String(1).padStart(2, "0")} ${t(TOC_ENTRIES[0].label, TOC_ENTRIES[0].labelKo)}</span></summary>
    <ol class="toc">${toc}</ol>
  </details>
  <div class="lang-toggle" role="group" aria-label="Report language / 리포트 언어">
    <button type="button" data-lang-btn="en" aria-pressed="true">EN</button>
    <button type="button" data-lang-btn="ko" aria-pressed="false">한국어</button>
  </div>
  <p class="lang-note" data-lang-note hidden>실제 평가 내용(발견 사항, 증적, 공격 시나리오 등)은 원본 언어로 표시됩니다.</p>
</nav>`;
}

function renderExecutiveSummary(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const e = model.executive;
  const openFindingsCount = model.findings.filter((f) => f.status === "open" || f.status === "in_progress").length;

  const explanationEn: string[] = [];
  const explanationKo: string[] = [];
  if (e.blockingControlFailures.length || e.blockingControlsNotVerified.length) {
    const partsEn: string[] = [];
    const partsKo: string[] = [];
    if (e.blockingControlFailures.length) {
      partsEn.push(`${e.blockingControlFailures.length} blocking control${e.blockingControlFailures.length === 1 ? "" : "s"} failed`);
      partsKo.push(`${e.blockingControlFailures.length}개 실패`);
    }
    if (e.blockingControlsNotVerified.length) {
      partsEn.push(`${e.blockingControlsNotVerified.length} blocking control${e.blockingControlsNotVerified.length === 1 ? "" : "s"} could not be verified`);
      partsKo.push(`${e.blockingControlsNotVerified.length}개 미검증`);
    }
    explanationEn.push(`${partsEn.join(" and ")}.`);
    // "차단 조건 컨트롤" (blocking control) is a shared prefix attached once here, never inside
    // a single fragment — the earlier version put it only in the "failed" fragment, so a report
    // with zero failures and only not-verified controls rendered a subject-less sentence
    // ("6개는 검증되지 않았습니다.", "6 of what?"). This mirrors how the finding-count sentence
    // below already avoids the same trap (its "발견 사항" noun is a suffix, not per-fragment).
    explanationKo.push(`차단 조건 컨트롤 ${partsKo.join(", ")}.`);
  }
  if (e.confirmedCritical || e.confirmedHigh) {
    const partsEn: string[] = [];
    const partsKo: string[] = [];
    if (e.confirmedCritical) { partsEn.push(`${e.confirmedCritical} critical`); partsKo.push(`심각 ${e.confirmedCritical}건`); }
    if (e.confirmedHigh) { partsEn.push(`${e.confirmedHigh} high-severity`); partsKo.push(`높음 ${e.confirmedHigh}건`); }
    const count = e.confirmedCritical + e.confirmedHigh;
    explanationEn.push(`${partsEn.join(" and ")} finding${count === 1 ? "" : "s"} remain unresolved.`);
    explanationKo.push(`${partsKo.join(", ")}의 발견 사항이 아직 해결되지 않았습니다.`);
  }
  if (!explanationEn.length) {
    explanationEn.push("No blocking control failures or unresolved critical/high findings were found.");
    explanationKo.push("차단 조건 실패나 미해결 심각/높음 발견 사항이 없습니다.");
  }

  const driverRows = [
    ...e.blockingControlFailures.map((id) => renderDecisionDriver(id, "fail", "Failed", "실패", latest)),
    ...e.blockingControlsNotVerified.map((id) => renderDecisionDriver(id, "not-tested", "Not verified", "미검증", latest)),
  ].join("");
  const decisionDrivers = driverRows
    ? `<div class="decision-drivers">
    <h3>${t(`Why this assessment is ${e.verdict}`, `이 평가가 ${VERDICT_REASON_KO[e.verdict] ?? e.verdict} 이유`)}</h3>
    <div class="decision-driver-list">${driverRows}</div>
  </div>`
    : "";

  const topFinding = e.topPrioritizedFinding
    ? `<a class="priority-finding" href="${href(`#finding-${e.topPrioritizedFinding.findingId}`)}">
      <span class="severity severity--${attr(e.topPrioritizedFinding.severity)}">${text(e.topPrioritizedFinding.severity)}</span>
      <span class="priority-finding__body"><strong>${text(e.topPrioritizedFinding.title)}</strong><span>${text(e.topPrioritizedFinding.findingId)} · ${t(humanizeEnum(e.topPrioritizedFinding.type), humanizeEnumKo(e.topPrioritizedFinding.type, FINDING_TYPE_LABELS_KO))}</span></span>
      <span class="priority-finding__arrow" aria-hidden="true">→</span>
    </a>`
    : `<p>${t("No prioritized findings.", "우선순위가 지정된 발견 사항이 없습니다.")}</p>`;

  return `<section id="executive-summary" aria-labelledby="executive-summary-heading">
  <h2 id="executive-summary-heading">${t("Executive Summary", "요약")}</h2>
  <div class="verdict-panel verdict-panel--${attr(e.verdict)}">
    <p class="label">${t("Assessment verdict", "평가 결과")}</p>
    <p class="verdict-value">${t(VERDICT_LABELS[e.verdict] ?? e.verdict, VERDICT_LABELS_KO[e.verdict] ?? e.verdict)}</p>
    <p class="verdict-explanation">${t(explanationEn.join(" "), explanationKo.join(" "))}</p>
    <dl class="metric-strip">
      <div><dt>${t("Coverage", "커버리지")}</dt><dd>${e.coverage.assessed} / ${e.coverage.applicable} <span class="metric-strip__sub">${e.coverage.percent}%</span></dd></div>
      <div><dt>${t("Critical", "심각")}</dt><dd>${e.confirmedCritical}</dd></div>
      <div><dt>${t("High", "높음")}</dt><dd>${e.confirmedHigh}</dd></div>
      <div><dt>${t("Open findings", "미해결 발견 사항")}</dt><dd>${openFindingsCount}</dd></div>
    </dl>
  </div>
  ${decisionDrivers}
  <h3>${t("Top prioritized finding", "우선순위 최상위 발견 사항")}</h3>
  ${topFinding}
</section>`;
}

function renderDecisionDriver(controlId: string, modifier: "fail" | "not-tested", labelEn: string, labelKo: string, latest: Map<string, ControlRow>): string {
  return `<a class="decision-driver" href="${href(`#control-${controlAnchor(latest, controlId)}`)}">
      <span class="status status--${modifier}">${t(labelEn, labelKo)}</span>
      <span class="decision-driver__body"><strong>${text(controlId)}</strong><span>${text(controlDisplayTitle(latest, controlId))}</span></span>
    </a>`;
}

function renderDomainOverview(model: PresentationModel): string {
  const rows = model.domains
    .map((d) => {
      const assessed = d.coverage.assessed > 0;
      const label = domainLabel(d.domain);
      const labelKo = domainLabelKo(d.domain);
      const scoreDisplay = assessed ? `${d.score} / 100` : "—";
      const visual = assessed
        ? `<div class="score-bar" role="img" aria-label="${attr(`${label} score ${d.score} out of 100`)}"><span style="width:${d.score}%"></span></div>`
        : `<span class="not-assessed">${t("Not assessed", "미평가")}</span>`;
      return `<div class="domain-row${assessed ? "" : " domain-row--unassessed"}">
      <div class="domain-row__name">${t(label, labelKo)}</div>
      <div class="domain-row__score numeric">${scoreDisplay}</div>
      <div class="domain-row__visual">${visual}</div>
      <div class="domain-row__coverage numeric">${d.coverage.assessed} / ${d.coverage.applicable} <span class="domain-row__coverage-label">${t("assessed", "평가됨")}</span></div>
    </div>`;
    })
    .join("");
  return `<section id="domain-overview" aria-labelledby="domain-overview-heading">
  <h2 id="domain-overview-heading">${t("Domain Overview", "도메인 개요")}</h2>
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
      const labelKo = c.domain !== null ? domainLabelKo(c.domain) : "미분류 컨트롤";
      const statEn = `${stat.passed} passed · ${stat.total} control${stat.total === 1 ? "" : "s"}`;
      const statKo = `${stat.passed}개 통과 · 전체 ${stat.total}개`;
      rows.push(`<tr class="domain-group"><th scope="rowgroup" colspan="6"><div class="domain-group__row"><span>${t(label, labelKo)}</span><span class="domain-group__stat numeric">${t(statEn, statKo)}</span></div></th></tr>`);
    }

    const reasonCell = c.effectiveStatusReason ? text(c.effectiveStatusReason.detail ?? c.effectiveStatusReason.label) : "—";
    const mismatchBadge = c.controlDefinitionVersionMismatch
      ? `<span class="badge badge-warning">${t("Control definition unavailable", "컨트롤 정의 없음")}</span>`
      : "";
    const evidenceCell = c.evidence.length
      ? `<a href="${href(`#evidence-${c.evidence[0].evidenceId}`)}">${t(`${c.evidence.length} evidence`, `증적 ${c.evidence.length}건`)}</a>`
      : c.evidenceIds.length
        ? `<span class="badge badge-warning">${t(`${c.evidenceIds.length} missing`, `${c.evidenceIds.length}건 누락`)}</span>`
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
      <td class="recorded-status">${t(statusLabel(c.recordedStatus), statusLabelKo(c.recordedStatus))}</td>
      <td><span class="status status--${statusModifier(c.effectiveStatus)}">${t(statusLabel(c.effectiveStatus), statusLabelKo(c.effectiveStatus))}</span>${c.recordedStatus !== c.effectiveStatus ? ` <span class="status-changed" title="Recorded status was overridden for scoring">↺</span>` : ""}</td>
      <td class="reason-cell">${reasonCell}</td>
      <td>${evidenceCell}</td>
      <td>${findingsCell}</td>
    </tr>`);
  }

  return `<section id="control-matrix" aria-labelledby="control-matrix-heading">
  <h2 id="control-matrix-heading">${t("Control Matrix", "컨트롤 매트릭스")}</h2>
  <div class="table-scroll">
  <table class="control-matrix">
    <caption>${t(
      "Recorded status is the submitted assessment state. Effective status is the state actually used for score and verdict; the reason column explains any override.",
      "기록된 상태는 제출된 평가 상태이며, 적용된 상태는 점수와 평가 결과 산정에 실제로 사용된 상태입니다. 사유 열은 재정의가 있을 경우 그 이유를 설명합니다."
    )}</caption>
    <thead><tr>
      <th scope="col">${t("Control", "컨트롤")}</th><th scope="col">${t("Recorded", "기록된 상태")}</th><th scope="col">${t("Effective", "적용된 상태")}</th>
      <th scope="col">${t("Reason", "사유")}</th><th scope="col">${t("Evidence", "증적")}</th><th scope="col">${t("Findings", "발견 사항")}</th>
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
  // A scatter of N points is only informative if priority and criticality actually diverge for
  // at least one finding — when every point sits on (or near) the diagonal, the chart repeats
  // what the list above it already says (in exact numbers, not approximate position) and just
  // spends space. Below 3 findings there's nothing to compare in the first place.
  const hasMeaningfulDivergence = model.findings.some((f) => Math.abs(f.priorityIndex - f.criticalityIndex) >= 2);
  const showPriorityMap = model.findings.length >= 3 && hasMeaningfulDivergence;

  return `<section id="findings" aria-labelledby="findings-heading">
  <h2 id="findings-heading">${t("Findings", "발견 사항")}</h2>
  <div role="group" aria-label="Finding status filter" class="findings-filter">
    <button type="button" data-filter="all" aria-pressed="true">${t("All", "전체")} <span class="count numeric">${model.findings.length}</span></button>
    <button type="button" data-filter="open" aria-pressed="false">${t("Open", "미해결")} <span class="count numeric">${openCount}</span></button>
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
        <div><dt>${t("Finding type", "유형")}</dt><dd>${t(humanizeEnum(f.type), humanizeEnumKo(f.type, FINDING_TYPE_LABELS_KO))}</dd></div>
        <div><dt>${t("Priority index", "우선순위 지수")}</dt><dd class="numeric">${f.priorityIndex} / 9</dd></div>
        <div><dt>${t("Criticality index", "심각도 지수")}</dt><dd class="numeric">${f.criticalityIndex} / 9</dd></div>
        <div><dt>${t("Linked controls", "연결된 컨트롤")}</dt><dd>${linkedControls}</dd></div>
      </dl>
      ${f.attackScenario ? `<div class="finding-narrative"><p class="finding-narrative__label">${t("Attack scenario", "공격 시나리오")}</p><p>${text(f.attackScenario)}</p></div>` : ""}
      ${f.exploitabilityEvidence ? `<div class="finding-narrative"><p class="finding-narrative__label">${t("Exploitability evidence", "악용 가능성 증거")}</p><p>${text(f.exploitabilityEvidence)}</p></div>` : ""}
    </details>`;
}

function renderPriorityMap(): string {
  return `<h3>${t("Prioritization Map", "우선순위 지도")}</h3>
  <p>${t(
    "Priority index and criticality index are both bounded integers (0–9), not continuous risk scores.",
    "우선순위 지수와 심각도 지수는 모두 0~9 사이의 정수이며, 연속적인 위험 점수가 아닙니다."
  )}</p>
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
      <header><strong>${text(e.evidenceId)}</strong><span class="badge">${t(humanizeEnum(e.type), humanizeEnumKo(e.type, EVIDENCE_TYPE_LABELS_KO))}</span><code class="evidence-location">${text(e.location)}</code></header>
      ${e.description ? `<p>${text(e.description)}</p>` : ""}
      <footer class="record-meta">${text(e.capturedBy)} · ${td(e.capturedAt)} · ${t("Referenced by", "참조한 컨트롤")} ${refs}</footer>
    </article>`;
    })
    .join("");

  const raStatusEn: Record<string, string> = { active: "Active", expired: "Expired", revoked: "Revoked" };
  const raStatusKo: Record<string, string> = { active: "활성", expired: "만료", revoked: "철회" };
  const raItems = model.riskAcceptances
    .map((r) => {
      const refs = (controlsByRiskAcceptanceId.get(r.riskAcceptanceId) ?? []).map((id) => `<a href="${href(`#control-${controlAnchor(latest, id)}`)}">${text(id)}</a>`).join(", ") || "—";
      const modifier = r.revokedAt ? "revoked" : r.status;
      return `<article id="risk-acceptance-${attr(r.riskAcceptanceId)}" class="risk-acceptance-record">
      <header><strong>${text(r.riskAcceptanceId)}</strong><span class="status status--${attr(modifier)}">${t(raStatusEn[modifier] ?? modifier, raStatusKo[modifier] ?? modifier)}</span></header>
      <p class="risk-rationale">${text(r.reason)}</p>
      <dl class="record-facts">
        <div><dt>${t("Approved by", "승인자")}</dt><dd>${text(r.approvedBy)}</dd></div>
        <div><dt>${t("Approved", "승인일")}</dt><dd>${td(r.approvedAt)}</dd></div>
        <div><dt>${t("Expires", "만료일")}</dt><dd>${td(r.expiresAt)}</dd></div>
        <div><dt>${t("Compensating controls", "보완 통제")}</dt><dd>${r.compensatingControls.length ? r.compensatingControls.map((c) => text(c)).join(", ") : "—"}</dd></div>
      </dl>
      ${r.revokedAt ? `<p class="badge badge-warning">${t("Revoked", "철회됨")} ${td(r.revokedAt)}${r.revokedReason ? `: ${text(r.revokedReason)}` : ""}</p>` : ""}
      <footer class="record-meta">${t("Applies to", "적용 대상")} ${refs}</footer>
    </article>`;
    })
    .join("");

  return `<section id="evidence-and-risk-acceptance" aria-labelledby="evidence-and-risk-acceptance-heading">
  <h2 id="evidence-and-risk-acceptance-heading">${t("Control Evidence & Risk Acceptance", "컨트롤 증적 및 위험 수용")}</h2>
  <h3>${t("Evidence", "증적")}</h3>
  <div class="record-list">${evidenceItems || `<p>${t("No evidence was referenced by this assessment run.", "이 평가 실행에서 참조된 증적이 없습니다.")}</p>`}</div>
  <h3>${t("Risk Acceptance", "위험 수용")}</h3>
  <div class="record-list">${raItems || `<p>${t("No risk acceptances were referenced by this assessment run.", "이 평가 실행에서 참조된 위험 수용이 없습니다.")}</p>`}</div>
</section>`;
}

function describeScope(scope: AssessmentScopes[keyof AssessmentScopes]): string {
  switch (scope.kind) {
    case "project":
      return t("This project, across all assessment history", "이 프로젝트의 전체 평가 이력");
    case "project-assessment-set": {
      const ids = scope.contributingRunIds.map((r) => text(r)).join(", ");
      return t(
        `Assessment run${scope.contributingRunIds.length === 1 ? "" : "s"} contributing to this report: ${ids}`,
        `이 리포트에 반영된 평가 실행: ${ids}`
      );
    }
    case "run":
      return t(`This report's assessment run (<code>${text(scope.runId)}</code>)`, `이 리포트의 평가 실행 (<code>${text(scope.runId)}</code>)`);
    case "referenced-by-run":
      return t(
        `Referenced by this report's assessment run (<code>${text(scope.runId)}</code>)`,
        `이 리포트의 평가 실행이 참조함 (<code>${text(scope.runId)}</code>)`
      );
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

// Korean translations for the presentation-model-sourced limitation messages (model.limitations
// is built in presentation-model.ts, not here, so these are looked up by the stable enum code
// rather than translated from the free-text English message). project_scoped_score_release is
// handled separately below, by limitationMessageKo(), because its English message embeds a
// dynamic run-id list this table can't hold statically — reconstructing it from
// assessmentScopes.score (the same structured data the English message was built from, not a
// parse of the English text) keeps the Korean version accurate instead of a guess.
const LIMITATION_MESSAGE_KO: Partial<Record<PresentationLimitationCode, string>> = {
  legacy_provenance_unavailable: "이 리포트는 대상/프로파일/엔진 버전 출처 정보가 기록되지 않은 레거시 평가 실행에서 생성되었습니다.",
  target_caller_asserted: "평가 대상(저장소/커밋/브랜치)은 호출자가 주장한 값이며, 이 서버가 독립적으로 검증하지 않았습니다.",
  project_scoped_findings: "발견 사항은 프로젝트 단위로 범위가 지정되며, 이 리포트와 다른 평가 실행에서 기록된 발견 사항이 포함될 수 있습니다.",
  rounded_display_values: "화면에 표시되는 점수와 커버리지 백분율은 소수점 둘째 자리에서 반올림되며, 배포 판정은 반올림 전 값으로 계산되었습니다.",
};

function limitationMessageKo(l: PresentationLimitation, s: AssessmentScopes): string {
  if (l.code === "project_scoped_score_release" && s.score.kind === "project-assessment-set") {
    const ids = s.score.contributingRunIds.map((r) => text(r)).join(", ");
    return `점수 및 배포 판정은 이 리포트 자체의 실행뿐 아니라 ${s.score.contributingRunIds.length}개의 평가 실행(${ids})에서 나온 컨트롤 평가 결과를 반영합니다.`;
  }
  return LIMITATION_MESSAGE_KO[l.code] ?? l.message;
}

function renderReportIntegrity(model: PresentationModel): string {
  const ri = model.referenceIntegrity;
  const rows: string[] = [];
  if (ri.missingEvidenceIds.length) {
    const ids = ri.missingEvidenceIds.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(
      `${ri.missingEvidenceIds.length} evidence reference${ri.missingEvidenceIds.length === 1 ? "" : "s"} could not be resolved: ${ids}`,
      `증적 참조 ${ri.missingEvidenceIds.length}건을 찾을 수 없습니다: ${ids}`
    )}</li>`);
  }
  if (ri.missingRiskAcceptanceIds.length) {
    const ids = ri.missingRiskAcceptanceIds.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(
      `${ri.missingRiskAcceptanceIds.length} risk acceptance reference${ri.missingRiskAcceptanceIds.length === 1 ? "" : "s"} could not be resolved: ${ids}`,
      `위험 수용 참조 ${ri.missingRiskAcceptanceIds.length}건을 찾을 수 없습니다: ${ids}`
    )}</li>`);
  }
  if (ri.missingFindingIds.length) {
    const ids = ri.missingFindingIds.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(
      `${ri.missingFindingIds.length} finding reference${ri.missingFindingIds.length === 1 ? "" : "s"} could not be resolved: ${ids}`,
      `발견 사항 참조 ${ri.missingFindingIds.length}건을 찾을 수 없습니다: ${ids}`
    )}</li>`);
  }
  if (ri.unresolvedControlDefinitions.length) {
    const ids = ri.unresolvedControlDefinitions.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(
      `${ri.unresolvedControlDefinitions.length} control definition${ri.unresolvedControlDefinitions.length === 1 ? "" : "s"} could not be resolved against the catalog: ${ids}`,
      `컨트롤 정의 ${ri.unresolvedControlDefinitions.length}건을 카탈로그에서 찾을 수 없습니다: ${ids}`
    )}</li>`);
  }
  if (!rows.length) return `<p class="integrity-ok">${t("No reference integrity issues were found in this report.", "이 리포트에서 참조 무결성 문제가 발견되지 않았습니다.")}</p>`;
  return `<ul class="integrity-list">${rows.join("")}</ul>`;
}

function renderScopeMethodologyLimitations(model: PresentationModel): string {
  const s = model.assessmentScopes;
  const customerScope = `<dl class="scope-facts">
    <div><dt>${t("Findings", "발견 사항")}</dt><dd>${describeScope(s.projectFindingSnapshots)}</dd></div>
    <div><dt>${t("Score &amp; release verdict", "점수 및 배포 판정")}</dt><dd>${describeScope(s.score)}</dd></div>
    <div><dt>${t("Control assessments", "컨트롤 평가")}</dt><dd>${describeScope(s.runControlAssessmentSnapshots)}</dd></div>
    <div><dt>${t("Evidence", "증적")}</dt><dd>${describeScope(s.evidenceSnapshots)}</dd></div>
    <div><dt>${t("Risk acceptances", "위험 수용")}</dt><dd>${describeScope(s.riskAcceptanceSnapshots)}</dd></div>
  </dl>`;
  const technicalScope = Object.entries(s)
    .map(([field, scope]) => `<dt>${text(field)}</dt><dd>${text(scope.kind)}${"runId" in scope ? ` (run ${text(scope.runId)})` : "contributingRunIds" in scope ? ` (runs: ${scope.contributingRunIds.map((r: string) => text(r)).join(", ")})` : ""}</dd>`)
    .join("");

  const genuineLimitations = model.limitations.filter((l) => !INTEGRITY_LIMITATION_CODES.has(l.code));
  const limitationItems = genuineLimitations.length
    ? `<ul class="limitation-list">${genuineLimitations.map((l) => `<li>${t(l.message, limitationMessageKo(l, s))}</li>`).join("")}</ul>`
    : `<p>${t("No assessment limitations were recorded.", "기록된 평가 한계 사항이 없습니다.")}</p>`;

  return `<section id="scope-methodology-limitations" aria-labelledby="scope-methodology-limitations-heading">
  <h2 id="scope-methodology-limitations-heading">${t("Scope &amp; Limitations", "범위 및 한계")}</h2>
  <h3>${t("Assessment scope", "평가 범위")}</h3>
  ${customerScope}
  <details class="technical-details"><summary>${t("Technical scope mapping", "기술적 범위 매핑")}</summary><dl>${technicalScope}</dl></details>
  <h3>${t("Limitations", "한계 사항")}</h3>
  ${limitationItems}
  <h3>${t("Report integrity", "리포트 무결성")}</h3>
  ${renderReportIntegrity(model)}
  <h3>${t("Provenance", "출처 정보")}</h3>
  <details class="provenance">
    <summary>${t("Report provenance &amp; integrity", "리포트 출처 및 무결성")}</summary>
    <dl>
      <div><dt>${t("Report ID", "리포트 ID")}</dt><dd><code>${text(model.metadata.reportId)}</code></dd></div>
      <div><dt>${t("Report schema version", "리포트 스키마 버전")}</dt><dd>${text(model.metadata.reportSchemaVersion)}</dd></div>
      <div><dt>${t("Assessment run", "평가 실행")}</dt><dd><code>${text(model.metadata.assessmentRunId)}</code></dd></div>
      ${model.metadata.engineVersionAtRunStart ? `<div><dt>${t("Engine version", "엔진 버전")}</dt><dd>${text(model.metadata.engineVersionAtRunStart)}</dd></div>` : ""}
      <div><dt>${t("Catalog version", "카탈로그 버전")}</dt><dd>${text(model.metadata.catalogVersion)}</dd></div>
      <div><dt>${t("Score model", "점수 모델")}</dt><dd>${text(model.metadata.scoreModel.id)} v${text(model.metadata.scoreModel.version)}</dd></div>
      <div><dt>${t("Criticality formula", "심각도 산정 공식")}</dt><dd>${text(model.metadata.criticalityFormula.id)} v${text(model.metadata.criticalityFormula.version)}</dd></div>
      <div><dt>${t("Source report SHA-256", "원본 리포트 SHA-256")}</dt><dd><code>${text(model.metadata.sourceReportSha256)}</code></dd></div>
      <div><dt>${t("Renderer version", "렌더러 버전")}</dt><dd>${text(model.metadata.rendererVersion)}</dd></div>
      <div><dt>${t("Rendered at", "렌더링 시각")}</dt><dd>${td(model.metadata.rendererRenderedAt)}</dd></div>
    </dl>
  </details>
</section>`;
}

function renderTerminology(): string {
  return `<section id="terminology" aria-labelledby="terminology-heading">
  <h2 id="terminology-heading">${t("Terminology", "용어 설명")}</h2>
  <details class="terminology">
    <summary>${t("Finding Verification vs. Control Assessment Evidence", "발견 사항 검증 vs. 컨트롤 평가 증적")}</summary>
    <dl>
      <dt>${t("Finding Verification", "발견 사항 검증")}</dt>
      <dd>${t(
        `The attack scenario and exploitability evidence attached to a <em>Finding</em> — how this specific vulnerability was confirmed, shown in the Findings section.`,
        `<em>발견 사항(Finding)</em>에 첨부된 공격 시나리오와 악용 가능성 증거 — 이 특정 취약점이 어떻게 확인되었는지를 설명하며, 발견 사항 섹션에 표시됩니다.`
      )}</dd>
      <dt>${t("Control Assessment Evidence", "컨트롤 평가 증적")}</dt>
      <dd>${t(
        `The evidence records attached to a <em>ControlAssessment</em> — what was examined to reach a control's PASS/FAIL/PARTIAL verdict, shown in the Control Evidence &amp; Risk Acceptance section. A different concept from Finding Verification above, even though both are informally "evidence."`,
        `<em>컨트롤 평가(ControlAssessment)</em>에 첨부된 증적 기록 — 컨트롤의 통과/실패/부분 충족 판정에 도달하기 위해 검토한 내용이며, 컨트롤 증적 및 위험 수용 섹션에 표시됩니다. 둘 다 통상 "증적"이라 부르지만 위의 발견 사항 검증과는 다른 개념입니다.`
      )}</dd>
    </dl>
  </details>
</section>`;
}

const REPORT_CSS = `
:root {
  color-scheme: light;
  --page: #f6f7f9; --surface: #ffffff; --surface-subtle: #f2f4f7; --border: #d9dee7; --border-strong: #c7ceda;
  --text: #161b22; --text-secondary: #475467; --text-tertiary: #667085; --text-inverse: #f8fafc;
  --brand: #3557d5; --brand-soft: #eef2ff;
  --mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
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

nav[aria-label="Report sections"] { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 16px); align-self: start; min-width: 0; }
.nav-toggle { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 6px; }
.nav-toggle summary { cursor: default; list-style: none; padding: 6px 8px; font-weight: 600; font-size: 0.82rem; }
.nav-toggle summary::-webkit-details-marker { display: none; }
.toc { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.toc a { display: block; padding: 7px 10px; border-radius: 6px; font-size: 0.82rem; font-weight: 600; color: var(--text); }
.toc a:hover { background: var(--surface-subtle); text-decoration: none; }
.toc a[aria-current="true"] { background: var(--brand-soft); color: var(--brand); border-left: 2px solid var(--brand); padding-left: 8px; }
@media (min-width: 901px) {
  .nav-toggle summary { display: none; }
  .nav-toggle > *:not(summary) { display: block !important; }
  /* Same Chromium (131+) ::details-content clipping as the print rule below: a closed
     <details>'s non-summary content lives in an internal box that ignores the display
     override above unless this wrapper is also forced open. */
  .nav-toggle::details-content { content-visibility: visible !important; block-size: auto !important; overflow: visible !important; }
}

.lang-toggle { display: flex; gap: 4px; margin: 10px 4px 0; padding-top: 10px; border-top: 1px solid var(--border); }
.lang-toggle button { flex: 1; font: inherit; font-size: 0.78rem; font-weight: 600; padding: 6px 4px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); cursor: pointer; white-space: nowrap; }
.lang-toggle button:hover { background: var(--surface-subtle); }
.lang-toggle button[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: var(--text-inverse); }
.lang-note { margin: 8px 4px 0; font-size: 0.7rem; line-height: 1.4; color: var(--text-tertiary); }

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
.decision-driver-list { display: flex; flex-direction: column; gap: 4px; }
.decision-driver { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 7px 14px; color: var(--text); }
.decision-driver:hover { background: var(--surface-subtle); text-decoration: none; }
.decision-driver .status { flex: none; min-width: 92px; justify-content: center; }
.decision-driver__body { display: flex; align-items: baseline; gap: 8px; font-size: 0.88rem; flex-wrap: wrap; min-width: 0; }
.decision-driver__body strong { flex: none; }
.decision-driver__body span { color: var(--text-secondary); font-size: 0.85rem; overflow-wrap: anywhere; }

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
tr.domain-group th { background: var(--page); color: var(--text-secondary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; padding-block: 8px; }
.domain-group__row { display: flex; justify-content: space-between; gap: 12px; }
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
.finding-summary__primary { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex: 1 1 260px; }
.finding-summary__primary .finding-title { overflow-wrap: anywhere; }
.finding-summary__secondary { font-size: 0.82rem; color: var(--text-secondary); display: flex; gap: 6px; flex: none; }
.finding-summary__right { margin-left: auto; display: flex; align-items: center; gap: 10px; flex: none; }
.index-pair { font-size: 0.78rem; color: var(--text-tertiary); }
#priority-criticality-scatter { display: block; width: 100%; max-width: 520px; height: auto; color: var(--text-secondary); }
.finding-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.6rem 1rem; margin-block: 0.9rem 0; font-size: 0.87rem; }
.finding-facts dt { color: var(--text-secondary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; }
.finding-facts dd { margin: 0.15rem 0 0; }
.finding-narrative { background: var(--surface-subtle); border-radius: 8px; padding: 12px 14px; margin-top: 10px; }
.finding-narrative__label { margin: 0 0 4px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-secondary); }
.finding-narrative p:last-child { margin-bottom: 0; }

.record-list { display: flex; flex-direction: column; gap: 8px; }
.evidence-record, .risk-acceptance-record { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; min-width: 0; }
.evidence-record header, .risk-acceptance-record header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-family: var(--mono); font-size: 0.82rem; margin-bottom: 4px; }
.evidence-record header code.evidence-location { margin: 0; }
.risk-rationale { margin: 0 0 8px; }
.record-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.3rem 1rem; font-size: 0.85rem; }
.record-facts dt { color: var(--text-secondary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; }
.record-facts dd { margin: 0.1rem 0 0; }
.record-meta { margin-top: 6px; font-size: 0.78rem; color: var(--text-tertiary); }
@media (max-width: 480px) {
  .finding-facts, .record-facts { grid-template-columns: repeat(2, 1fr); }
}

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
  .nav-toggle summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
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
  a[href^="#"] { text-decoration: none; }
  .priority-finding__arrow { display: none; }
  .score-bar span, .verdict, .status, .severity, .badge { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

const CLIENT_SCRIPT = `
(function () {
  "use strict";
  var dataEl = document.getElementById("report-data");
  var data = JSON.parse(dataEl.textContent);

  var SCATTER_I18N = {
    en: { xLabel: "Priority index", yLabel: "Criticality index", svgTitle: "Priority versus criticality plot",
          svgAriaLabel: "Priority versus criticality plot of findings, each point labeled with its finding ID",
          tooltip: function (d) { return d.title + " — Priority index: " + d.priorityIndex + " / Criticality index: " + d.criticalityIndex; } },
    ko: { xLabel: "우선순위 지수", yLabel: "심각도 지수", svgTitle: "우선순위 대 심각도 그래프",
          svgAriaLabel: "발견 사항의 우선순위 대 심각도 그래프, 각 점에 발견 사항 ID가 표시됨",
          tooltip: function (d) { return d.title + " — 우선순위 지수: " + d.priorityIndex + " / 심각도 지수: " + d.criticalityIndex; } }
  };

  function buildScatter() {
    var svg = d3.select("#priority-criticality-scatter");
    var width = 480, height = 320, margin = { top: 20, right: 20, bottom: 40, left: 40 };
    var x = d3.scaleLinear().domain([0, 9]).range([margin.left, width - margin.right]);
    var y = d3.scaleLinear().domain([0, 9]).range([height - margin.bottom, margin.top]);
    svg.append("g").attr("transform", "translate(0," + (height - margin.bottom) + ")").call(d3.axisBottom(x).ticks(9));
    svg.append("g").attr("transform", "translate(" + margin.left + ",0)").call(d3.axisLeft(y).ticks(9));
    svg.append("text").attr("class", "axis-label-x").attr("x", width / 2).attr("y", height - 4).attr("text-anchor", "middle").text(SCATTER_I18N.en.xLabel);
    svg.append("text").attr("class", "axis-label-y").attr("x", -height / 2).attr("y", 12).attr("transform", "rotate(-90)").attr("text-anchor", "middle").text(SCATTER_I18N.en.yLabel);
    var points = svg.append("g").selectAll("g.point").data(data.findings).join("g").attr("class", "point");
    points.append("circle")
      .attr("cx", function (d) { return x(d.priorityIndex); })
      .attr("cy", function (d) { return y(d.criticalityIndex); })
      .attr("r", 5)
      .attr("fill", function (d) { return getComputedStyle(document.documentElement).getPropertyValue("--severity-" + d.severity.toLowerCase()) || "#6b7280"; })
      .append("title").text(SCATTER_I18N.en.tooltip);
    points.append("text")
      .attr("x", function (d) { return x(d.priorityIndex) + 7; })
      .attr("y", function (d) { return y(d.criticalityIndex) - 7; })
      .attr("font-size", "9px")
      .attr("fill", "currentColor")
      .text(function (d) { return d.findingId; });

    window.__csiUpdateScatterLang = function (lang) {
      var dict = SCATTER_I18N[lang] || SCATTER_I18N.en;
      var node = svg.node();
      node.querySelector(".axis-label-x").textContent = dict.xLabel;
      node.querySelector(".axis-label-y").textContent = dict.yLabel;
      var titleEl = node.querySelector("title");
      if (titleEl) titleEl.textContent = dict.svgTitle;
      node.setAttribute("aria-label", dict.svgAriaLabel);
      svg.selectAll("g.point title").text(dict.tooltip);
    };
  }

  function wireFindingsFilter() {
    var buttons = document.querySelectorAll("[data-filter]");
    var status = document.getElementById("findings-filter-status");
    var cards = document.querySelectorAll("#findings-list > .finding-card");
    function currentLang() { return document.documentElement.getAttribute("lang") === "ko" ? "ko" : "en"; }
    function render() {
      var shown = 0;
      cards.forEach(function (card) { if (!card.hidden) shown++; });
      var lang = currentLang();
      status.textContent = lang === "ko"
        ? "전체 " + cards.length + "건 중 " + shown + "건 표시"
        : "Showing " + shown + " of " + cards.length + " findings";
    }
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var filter = btn.getAttribute("data-filter");
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        cards.forEach(function (card) {
          var cardStatus = card.getAttribute("data-status");
          var visible = filter === "all" || cardStatus === "open" || cardStatus === "in_progress";
          card.hidden = !visible;
        });
        render();
      });
    });
    window.__csiRenderFindingsStatus = render;
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
    function syncLabel(link) {
      if (currentLabel && link) currentLabel.textContent = link.textContent;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var link = linkByTargetId[entry.target.id];
          if (!link || link === current) return;
          if (current) current.setAttribute("aria-current", "false");
          link.setAttribute("aria-current", "true");
          current = link;
          syncLabel(link);
        });
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    Object.keys(linkByTargetId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    window.__csiSyncTocLabel = function () { syncLabel(current || linkByTargetId[Object.keys(linkByTargetId)[0]]); };
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

  function wireLanguageToggle() {
    var STORAGE_KEY = "csi-report-lang";
    var root = document.documentElement;
    var buttons = document.querySelectorAll("[data-lang-btn]");
    var nodes = document.querySelectorAll(".i18n");
    var note = document.querySelector("[data-lang-note]");
    var TITLE_EN = " — Security Assessment Report";
    var TITLE_KO = " — 보안 평가 보고서";

    function applyTitle(lang) {
      if (lang === "ko" && document.title.indexOf(TITLE_EN) !== -1) {
        document.title = document.title.replace(TITLE_EN, TITLE_KO);
      } else if (lang === "en" && document.title.indexOf(TITLE_KO) !== -1) {
        document.title = document.title.replace(TITLE_KO, TITLE_EN);
      }
    }

    function apply(lang) {
      nodes.forEach(function (el) {
        if (el.dataset.enCache === undefined) el.dataset.enCache = el.textContent;
        var ko = el.getAttribute("data-ko");
        el.textContent = lang === "ko" && ko ? ko : el.dataset.enCache;
      });
      root.setAttribute("lang", lang);
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang-btn") === lang)); });
      if (note) note.hidden = lang !== "ko";
      applyTitle(lang);
      if (typeof window.__csiRenderFindingsStatus === "function") window.__csiRenderFindingsStatus();
      if (typeof window.__csiSyncTocLabel === "function") window.__csiSyncTocLabel();
      if (typeof window.__csiUpdateScatterLang === "function") window.__csiUpdateScatterLang(lang);
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (err) { /* private browsing or storage disabled — toggle still works for this view */ }
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute("data-lang-btn")); });
    });

    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    var browserKo = typeof navigator !== "undefined" && /^ko/i.test(navigator.language || "");
    apply(saved === "en" || saved === "ko" ? saved : browserKo ? "ko" : "en");
  }

  if (typeof d3 !== "undefined" && document.getElementById("priority-criticality-scatter")) buildScatter();
  wireFindingsFilter();
  wireTocHighlight();
  wirePrintExpansion();
  wireLanguageToggle();
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
${renderSidebar()}
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
