import type { PresentationModel, ControlRow, PresentationLimitation, PresentationLimitationCode, FindingCard } from "./presentation-model.js";
import type { AssessmentScopes } from "./report-builder.js";
import {
  escapeHtmlText as text,
  escapeHtmlAttribute as attr,
  escapeUrlAttribute as href,
  escapeForInlineScriptJson,
} from "./html-escape.js";

export const REPORT_HTML_RENDERER_VERSION = "2.0.0";

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
const VERDICT_LABELS_KO: Record<string, string> = { approved: "승인", blocked: "승인 차단", indeterminate: "판단 보류" };

const STATUS_LABELS: Record<string, string> = {
  PASS: "Pass", FAIL: "Fail", PARTIAL: "Partial", "N/A": "N/A", NOT_TESTED: "Not tested", ACCEPTED_RISK: "Accepted risk",
};
const STATUS_LABELS_KO: Record<string, string> = {
  PASS: "충족", FAIL: "미충족", PARTIAL: "부분 충족", "N/A": "해당 없음", NOT_TESTED: "미평가", ACCEPTED_RISK: "위험 수용",
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
function statusPill(status: string): string {
  return `<span class="pill pill--${statusModifier(status)}">${t(statusLabel(status), statusLabelKo(status))}</span>`;
}
function severityPill(severity: string): string {
  return `<span class="pill pill--${attr(severity)}">${text(severity)}</span>`;
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
  process_gap: "프로세스 공백",
};
const EVIDENCE_TYPE_LABELS_KO: Record<string, string> = {
  CODE: "코드", CONFIG: "설정", AUTOMATED_TEST: "자동화 테스트", MANUAL_TEST: "수동 테스트", SCAN: "스캔", LOG: "로그",
  AUDIT_LOG: "감사 로그", ARCHITECTURE: "아키텍처", CI_ARTIFACT: "CI 아티팩트", DEPLOYMENT_RECORD: "배포 기록",
  SCREENSHOT: "스크린샷", TICKET: "티켓", REPORT: "리포트", MANUAL_REVIEW: "수동 검토",
};
const FINDING_STATUS_LABELS_KO: Record<string, string> = {
  open: "조치 필요", in_progress: "조치 중", resolved: "해결됨", accepted: "위험 수용", false_positive: "오탐",
};
// Falls back to the humanized English string when a given raw value has no specific Korean
// entry — these enums are open-ended at the data-model layer, so an unmapped value should
// degrade to readable English text rather than disappear or throw.
function humanizeEnumKo(value: string, table: Record<string, string>): string {
  return table[value] ?? humanizeEnum(value);
}
function findingStatusLabelKo(status: string): string {
  return FINDING_STATUS_LABELS_KO[status] ?? humanizeEnum(status);
}

// Deterministic, locale-pinned date formatting: the renderer is a pure function of its input, so
// this must never depend on the host machine's locale or timezone — only on the (ISO string,
// language) pair already fully determined by the time this runs. Raw ISO strings remain
// available verbatim in the Provenance block for anyone who needs the exact machine-readable
// value, in both languages.
function formatDate(iso: string | null, lang: "en" | "ko" = "en"): string {
  if (!iso) return lang === "ko" ? "기록 없음" : "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = lang === "ko" ? "ko-KR" : "en-US";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);
}
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
function tdShort(iso: string | null): string {
  return t(formatDate(iso, "en"), formatDate(iso, "ko"));
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
function controlLink(latest: Map<string, ControlRow>, id: string, label?: string): string {
  return `<a href="${href(`#control-${controlAnchor(latest, id)}`)}">${text(label ?? id)}</a>`;
}

// projectName is caller-supplied free text the renderer must otherwise treat as opaque — this
// project's own naming convention often appends a "(owner/repo)" parenthetical AND further
// human-distinguishing text (e.g. "... — v2 re-assessment", "... — blind pinned-commit
// re-assessment (<sha>, <date>)") used to tell apart repeated assessments of the same
// repository. The target line already states the repository, so only that exact
// "(owner/repo)" substring is stripped here — never a generic parenthetical regex, which would
// just as easily eat the distinguishing suffix this convention depends on.
function displayProjectName(model: PresentationModel): string {
  const name = model.metadata.projectName;
  const tg = model.metadata.target;
  if (!tg.available || !tg.repository) return name;
  const marker = `(${tg.repository})`;
  const idx = name.indexOf(marker);
  if (idx === -1) return name;
  return (name.slice(0, idx) + name.slice(idx + marker.length)).replace(/\s{2,}/g, " ").trim();
}

function isActiveFinding(status: string): boolean {
  return status === "open" || status === "in_progress";
}
function sortFindings(a: FindingCard, b: FindingCard): number {
  return a.priorityIndex - b.priorityIndex || b.criticalityIndex - a.criticalityIndex || a.findingId.localeCompare(b.findingId);
}

const SECTIONS: Array<{ id: string; label: string; labelKo: string }> = [
  { id: "overview", label: "Executive Summary", labelKo: "평가 요약" },
  { id: "actions", label: "Decision Requirements", labelKo: "필수 확인 항목" },
  { id: "findings", label: "Findings & Actions", labelKo: "발견사항 · 조치" },
  { id: "domains", label: "Assessment Coverage", labelKo: "영역별 평가" },
  { id: "controls", label: "Control Register", labelKo: "통제 상세" },
  { id: "evidence", label: "Evidence Library", labelKo: "검증 근거" },
  { id: "scope", label: "Scope & Provenance", labelKo: "범위 · 평가 이력" },
];

function renderSidebar(model: PresentationModel): string {
  const toc = SECTIONS.map((s, i) => {
    const n = String(i + 1).padStart(2, "0");
    return `<li><a href="${href(`#${s.id}`)}" data-toc-link${i === 0 ? ' aria-current="true"' : ""}><span>${n}</span>${t(s.label, s.labelKo)}</a></li>`;
  }).join("");
  const shortId = model.metadata.reportId.slice(0, 8);
  return `<aside class="sidebar">
  <div class="brand">C.S.I<span>SECURITY INTELLIGENCE</span></div>
  <p class="sidebar-label eyebrow">${t("ASSESSMENT REPORT", "보안 평가 보고서")}</p>
  <nav aria-label="Report sections / 보고서 목차"><ol class="toc">${toc}</ol></nav>
  <div class="lang-toggle" role="group" aria-label="Report language / 리포트 언어">
    <button type="button" data-lang-btn="en" aria-pressed="true">EN</button>
    <button type="button" data-lang-btn="ko" aria-pressed="false">한국어</button>
  </div>
  <p class="lang-note" data-lang-note hidden>실제 평가 내용(발견 사항, 증적, 공격 시나리오 등)은 원본 언어로 표시됩니다.</p>
  <div class="side-note"><strong>${text(displayProjectName(model))}</strong>${t("Report", "보고서")} ${text(shortId)}<br>${tdShort(model.metadata.reportGeneratedAt)}<br>${t("Stored assessment snapshot", "저장된 평가 스냅샷")}</div>
</aside>`;
}

function targetSummary(model: PresentationModel): string {
  const tg = model.metadata.target;
  if (!tg.available) return t("Not recorded — legacy assessment", "기록 없음 · 레거시 평가");
  const bits: string[] = [];
  if (tg.repository) bits.push(`<code>${text(tg.repository)}</code>`);
  if (tg.branchOrTag) bits.push(text(tg.branchOrTag));
  if (tg.commitSha) bits.push(`<code>${text(tg.commitSha)}</code>`);
  const base = bits.join(" · ") || t("Not recorded", "기록 없음");
  return tg.dirty ? `${base} <span class="badge badge-warning">${t("dirty working tree", "미커밋 변경사항 있음")}</span>` : base;
}

function renderReportHeader(model: PresentationModel): string {
  const year = new Date(model.metadata.reportGeneratedAt).getUTCFullYear();
  const assessedDates = model.controls.map((c) => c.assessedAt).filter(Boolean).sort();
  const rangeEn = assessedDates.length ? `${formatDate(assessedDates[0], "en")} – ${formatDate(assessedDates.at(-1) ?? null, "en")}` : "Not recorded";
  const rangeKo = assessedDates.length ? `${formatDate(assessedDates[0], "ko")} – ${formatDate(assessedDates.at(-1) ?? null, "ko")}` : "기록 없음";
  return `<header class="report-header">
  <p class="eyebrow">${t(`SECURITY ASSESSMENT / ${year}`, `보안 평가 / ${year}`)}</p>
  <h1>${text(displayProjectName(model))}</h1>
  <p class="report-subtitle">${t("Security Assessment Report", "보안 평가 보고서")}</p>
  <div class="report-meta">
    <span>${t("Report generated", "보고서 생성일")}<b>${td(model.metadata.reportGeneratedAt)}</b></span>
    <span>${t("Assessment period", "평가 기록 기간")}<b>${t(rangeEn, rangeKo)}</b></span>
    <span>${t("Catalog", "카탈로그")}<b>v${text(model.metadata.catalogVersion)}</b></span>
  </div>
</header>`;
}

function renderVerdictSection(model: PresentationModel): string {
  const e = model.executive;
  const blockers = [...new Set([...e.blockingControlFailures, ...e.blockingControlsNotVerified])];
  const activeFindings = model.findings.filter((f) => isActiveFinding(f.status));
  const activeHigh = activeFindings.filter((f) => f.severity === "high").length;

  const headline: Record<string, [string, string, string, string, string]> = {
    indeterminate: ["Pending review", "판단 보류", "Additional verification required", "추가 검증이 필요합니다", ""],
    blocked: ["Approval blocked", "승인 차단", "Approval conditions were not met", "승인 조건을 충족하지 못했습니다", ""],
    approved: ["Approved", "승인", "Assessment criteria were met", "평가 기준을 충족했습니다", ""],
  };
  const bodyEn: Record<string, string> = {
    indeterminate: "Required verification is incomplete, so approval cannot be confirmed from the current evidence alone.",
    blocked: "Review the unmet items and release-verdict rationale below, then re-assess after remediation.",
    approved: "This verdict applies to the recorded assessment scope. Review the project's unresolved findings and scope together with it.",
  };
  const bodyKo: Record<string, string> = {
    indeterminate: "필수 검증이 완료되지 않아 현재 자료만으로 승인 여부를 확정할 수 없습니다.",
    blocked: "아래의 미충족 항목과 릴리스 판정 근거를 검토하고, 필요한 조치 후 재평가해야 합니다.",
    approved: "이 판정은 기록된 평가 범위에 적용됩니다. 프로젝트의 미해결 발견사항과 적용 범위를 함께 확인하세요.",
  };
  const h = headline[e.verdict] ?? [e.verdict, e.verdict, "", "", ""];
  const ctaHref = blockers.length ? "#actions" : "#findings";
  const ctaText = blockers.length
    ? t(`Review ${blockers.length} decision requirement${blockers.length === 1 ? "" : "s"}`, `필수 확인 항목 ${blockers.length}개 검토`)
    : t("Review findings", "발견사항 검토");

  const confirmedCountNotice = t(
    `The release verdict's confirmed High vulnerabilities total ${e.confirmedHigh}. This differs in type and scope from the project's ${activeHigh} unresolved High finding${activeHigh === 1 ? "" : "s"}.`,
    `릴리스 판정의 확정 High 취약점은 ${e.confirmedHigh}건입니다. 프로젝트의 미해결 High 발견사항 ${activeHigh}건과는 유형·집계 범위가 다른 지표입니다.`
  );
  const legacyLimitation = model.limitations.some((l) => l.code === "legacy_provenance_unavailable")
    ? `<p class="scope-note"><b>${t("Assessment limitation", "평가 한계")}</b><span>${t(
        "This is a legacy-format assessment record. Some target version/profile/engine information is missing, so identical-condition reproduction can't be confirmed.",
        "이전 형식의 평가 기록입니다. 대상 버전·프로필·엔진 정보 중 일부가 없어 동일 조건의 재현을 확인할 수 없습니다."
      )}</span></p>`
    : "";

  return `<section aria-label="Assessment conclusion / 평가 결론">
  <div class="verdict verdict--${attr(e.verdict)}">
    <div class="verdict-main">
      <div class="verdict-topline"><span class="signal" aria-hidden="true"></span>${t(h[0], h[1])} · ${text(e.verdict)}</div>
      <h2>${t(h[2], h[3])}</h2>
      <p>${t(bodyEn[e.verdict] ?? "", bodyKo[e.verdict] ?? "")}</p>
      <a class="verdict-next" href="${ctaHref}">${ctaText} <span aria-hidden="true">→</span></a>
    </div>
    <div class="verdict-aside">
      <dl><dt>${t("Control assessment completion", "통제 평가 완료율")}</dt><dd class="numeric">${e.coverage.percent}<span>%</span></dd></dl>
      <div class="coverage-track" role="img" aria-label="${attr(`Assessment completion ${e.coverage.percent}%`)}"><span style="width:${Math.min(100, Math.max(0, e.coverage.percent))}%"></span></div>
      <p>${t(`${e.coverage.assessed} of ${e.coverage.applicable} applicable controls assessed`, `적용 대상 ${e.coverage.applicable}개 중 ${e.coverage.assessed}개 평가`)}<br>${t("Being assessed is not the same as passing.", "평가 완료는 통제 충족과 다릅니다.")}</p>
    </div>
  </div>
  <dl class="metrics">
    <div class="metric"><dt>${t("Decision requirements", "필수 확인 항목")}</dt><dd class="numeric">${blockers.length}</dd><dd class="metric-note">${t("Release-verdict criteria", "릴리스 판정 기준")}</dd></div>
    <div class="metric"><dt>${t("Unresolved findings", "미해결 발견사항")}</dt><dd class="numeric">${activeFindings.length}</dd><dd class="metric-note">${t(`Project-wide · includes ${activeHigh} High`, `프로젝트 전체 · High ${activeHigh}건 포함`)}</dd></div>
    <div class="metric"><dt>${t("Confirmed High vulnerabilities", "확정 High 취약점")}</dt><dd class="numeric">${e.confirmedHigh}</dd><dd class="metric-note">${t(`Release verdict · ${e.confirmedCritical} Critical`, `릴리스 판정 · Critical ${e.confirmedCritical}건`)}</dd></div>
    <div class="metric"><dt>${t("Control assessment score", "통제 평가 점수")}</dt><dd class="numeric">${e.overallScore}<small> / 100</small></dd><dd class="metric-note">${t("Score alone doesn't determine approval", "점수만으로 승인 여부를 판단하지 않음")}</dd></div>
  </dl>
  <p class="scope-note"><b>${t("Count basis", "집계 기준")}</b><span>${confirmedCountNotice} <a href="#scope">${t("Scope details", "상세 범위")}</a></span></p>
  ${legacyLimitation}
</section>`;
}

function sectionHead(headingId: string, number: string, kickerEn: string, kickerKo: string, titleEn: string, titleKo: string, descEn: string, descKo: string, countEn?: string, countKo?: string): string {
  return `<header class="section-heading">
    <div><div class="section-kicker"><span>${number}</span>${t(kickerEn, kickerKo)}</div><h2 id="${attr(headingId)}">${t(titleEn, titleKo)}</h2>${descEn ? `<p class="section-description">${t(descEn, descKo)}</p>` : ""}</div>
    ${countEn ? `<span class="section-count">${t(countEn, countKo ?? countEn)}</span>` : ""}
  </header>`;
}

function renderActionsSection(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const e = model.executive;
  const blockers = [...new Set([...e.blockingControlFailures, ...e.blockingControlsNotVerified])];
  const unverified = new Set(e.blockingControlsNotVerified);
  const rows = blockers
    .map((id, index) => {
      const row = latest.get(id);
      const title = controlDisplayTitle(latest, id);
      const nextEn = unverified.has(id)
        ? "Gather evidence that meets the assessment criteria and complete the required verification."
        : "Remediate the cause of the failure and re-assess the linked control.";
      const nextKo = unverified.has(id)
        ? "평가 기준에 맞는 증빙을 확보하고 필수 검증을 완료하세요."
        : "미충족 원인을 조치하고 연결된 통제를 재평가하세요.";
      return `<div class="action-row">
      <span class="action-number">${String(index + 1).padStart(2, "0")}</span>
      <div>
        <div class="action-title">${text(title)}</div>
        <span class="action-id">${text(id)} · ${unverified.has(id) ? t("Required verification incomplete", "필수 검증 미완료") : t("Blocking condition not met", "차단 조건 미충족")}</span>
        <p>${t(nextEn, nextKo)}</p>
      </div>
      ${row ? `<a href="${href(`#control-${controlAnchor(latest, id)}`)}">${t("Review control", "통제 확인")} ↗</a>` : ""}
    </div>`;
    })
    .join("");
  const body = rows
    ? `<div class="actions">${rows}</div><p class="original-note">${t(
        "Evidence-gathering guidance is a suggestion for follow-up review. Actual completion must be confirmed by re-assessment.",
        "증빙 확보 안내는 후속 검토를 위한 제안입니다. 실제 완료 여부는 재평가로 확인해야 합니다."
      )}</p>`
    : `<p class="empty">${t(
        "No recorded unverified or failed blocking controls. Check the release verdict's other conditions in the assessment history.",
        "기록된 필수 미검증·미충족 통제가 없습니다. 릴리스 판정의 다른 조건은 평가 이력에서 확인하세요."
      )}</p>`;
  return `<section class="section" id="actions" aria-labelledby="actions-heading">
  ${sectionHead(
    "actions-heading", "02", "DECISION REQUIREMENTS", "DECISION REQUIREMENTS",
    "To complete the decision", "판단을 완료하려면",
    "Items that need review for the release verdict. Control status and whether required verification was met are shown separately.",
    "릴리스 판정에서 확인이 필요한 항목입니다. 통제 상태와 필수 검증 충족 여부는 별도로 표시합니다.",
    `${blockers.length} ITEMS`, `${blockers.length}개`
  )}
  ${body}
</section>`;
}

function renderFindingCard(f: FindingCard, index: number, latest: Map<string, ControlRow>, controlsByEvidenceId: Map<string, string[]>, evidenceById: Map<string, PresentationModel["evidence"][number]>): string {
  const active = isActiveFinding(f.status);
  const linkedEvidenceIds = [...new Set(f.linkedControlIds.flatMap((id) => controlsByEvidenceId.get(id) ?? []))];
  const linkedEvidence = linkedEvidenceIds.map((id) => evidenceById.get(id)).filter((v): v is PresentationModel["evidence"][number] => !!v)
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
  const latestEvidence = linkedEvidence[0];
  const linkedControls = f.linkedControlIds.length
    ? f.linkedControlIds.map((id) => controlLink(latest, id)).join(", ")
    : t("None", "없음");

  const correction = !active
    ? `<div class="correction"><strong>${t(`Current status: ${statusLabel2(f.status)}`, `현재 상태: ${findingStatusLabelKo(f.status)}`)}</strong><p>${
        f.status === "false_positive"
          ? t("This item was classified as a false positive. The claim and severity below are no longer a valid vulnerability determination.", "이 항목은 오탐으로 분류되었습니다. 아래의 이전 주장과 심각도는 현재 유효한 취약점 판정이 아닙니다.")
          : t("No longer counted among unresolved findings.", "현재 미해결 발견사항 집계에는 포함되지 않습니다.")
      }</p>${
        latestEvidence
          ? `<p>${t("Reference · latest linked evidence", "판정 참고 · 최신 연결 증빙")} <a href="${href(`#evidence-${latestEvidence.evidenceId}`)}">${text(latestEvidence.evidenceId)}</a></p><p>${text(latestEvidence.description ?? "")}</p>`
          : `<p>${t("No linked evidence in the source record.", "연결된 증빙이 원본에 없습니다.")}</p>`
      }</div>`
    : "";

  const narrative = `${f.attackScenario ? `<h4>${t("Recorded attack scenario", "기록된 공격 시나리오")}</h4><p class="narrative">${text(f.attackScenario)}</p>` : ""}${
    f.exploitabilityEvidence ? `<h4>${t("Recorded verification notes", "기록된 검증 내용")}</h4><p class="narrative">${text(f.exploitabilityEvidence)}</p>` : ""
  }`;

  return `<details id="finding-${attr(f.findingId)}" class="finding" data-finding data-status="${attr(f.status)}">
  <summary>
    <span class="finding-rank">${active ? String(index + 1).padStart(2, "0") : "—"}</span>
    <span>
      <span class="finding-line">${active ? severityPill(f.severity) : statusPill2(f.status)}<span class="finding-id">${text(f.findingId)}</span><span class="small muted">${active ? t(humanizeEnum(f.type), humanizeEnumKo(f.type, FINDING_TYPE_LABELS_KO)) : t("Archived", "이력 보관")}</span></span>
      <span class="finding-title">${text(f.title)}</span>
      <span class="finding-subtitle">${active ? t(`${statusLabel2(f.status)} · counted from the project's full history`, `${findingStatusLabelKo(f.status)} · 프로젝트 전체 이력에서 집계`) : t("Currently excluded from the action list.", "현재 조치 목록에서 제외된 항목입니다.")}</span>
    </span>
    <span class="chevron" aria-hidden="true">›</span>
  </summary>
  <div class="finding-body">
    ${correction}
    <dl class="facts">
      <div><dt>${t(active ? "Severity" : "Severity at time of record", active ? "심각도" : "기록 당시 심각도")}</dt><dd>${text(f.severity)}</dd></div>
      <div><dt>${t("Status", "처리 상태")}</dt><dd>${t(statusLabel2(f.status), findingStatusLabelKo(f.status))}</dd></div>
      <div><dt>${t("Priority index", "우선순위 지수")}</dt><dd class="numeric">${f.priorityIndex} <span class="muted">/ 9</span></dd></div>
      <div><dt>${t("Criticality index", "중대성 지수")}</dt><dd class="numeric">${f.criticalityIndex} <span class="muted">/ 9</span></dd></div>
      <div><dt>${t("Linked controls", "연결 통제")}</dt><dd>${linkedControls}</dd></div>
    </dl>
    ${active && f.title ? "" : ""}
    ${!active ? `<details class="archive"><summary>${t("View prior assessment content · distinct from current verdict", "이전 평가 내용 보기 · 현재 판정과 구분")}</summary><p class="small muted">${t("Original title", "원본 제목")}: ${text(f.title)} · ${t("Type at time of record", "기록 당시 유형")}: ${t(humanizeEnum(f.type), humanizeEnumKo(f.type, FINDING_TYPE_LABELS_KO))}</p>${narrative}</details>` : narrative}
    <h4>${t("Linked control evidence", "연결된 통제 증빙")}</h4>
    <div class="control-links">${linkedEvidenceIds.length ? linkedEvidenceIds.map((id) => `<a href="${href(`#evidence-${id}`)}">${text(id)}</a>`).join(", ") : `<span class="muted small">${t("None recorded", "기록 없음")}</span>`}</div>
    <p class="original-note">${t(
      "Quoted source text is preserved in the language it was recorded in. Priority/criticality indices are integers in the 0–9 range, not probabilities or percentages.",
      "원문 인용은 기록된 언어로 보존했습니다. 우선순위·중대성 지수는 0–9 범위의 정수이며 확률이나 백분율이 아닙니다."
    )}</p>
  </div>
</details>`;
}
// Finding status uses plain English words ("open", "resolved"...), distinct from the
// ControlRow-status label table above (which uses PASS/FAIL/...) — kept as separate small
// tables rather than overloading STATUS_LABELS/statusLabel with two incompatible vocabularies.
const FINDING_STATUS_LABELS_EN: Record<string, string> = {
  open: "Open", in_progress: "In progress", resolved: "Resolved", accepted: "Accepted", false_positive: "False positive",
};
function statusLabel2(status: string): string {
  return FINDING_STATUS_LABELS_EN[status] ?? humanizeEnum(status);
}
function statusPill2(status: string): string {
  const modifier = status === "resolved" ? "pass" : status === "false_positive" ? "na" : status === "accepted" ? "accepted-risk" : "neutral";
  return `<span class="pill pill--${modifier}">${t(statusLabel2(status), findingStatusLabelKo(status))}</span>`;
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

function renderFindingsSection(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const sorted = [...model.findings].sort(sortFindings);
  const active = sorted.filter((f) => isActiveFinding(f.status));
  const historical = sorted.filter((f) => !isActiveFinding(f.status));
  const ordered = [...active, ...historical];

  const controlsByEvidenceId = new Map<string, string[]>();
  for (const c of model.controls) for (const id of c.evidenceIds) controlsByEvidenceId.set(id, [...(controlsByEvidenceId.get(id) ?? []), id]);
  // Finding cards link to evidence through their linked controls' evidenceIds directly.
  const controlEvidenceIds = new Map<string, string[]>();
  for (const c of model.controls) controlEvidenceIds.set(c.controlId, c.evidenceIds);
  const evidenceById = new Map(model.evidence.map((e) => [e.evidenceId, e]));

  let rank = 0;
  const cards = ordered
    .map((f) => {
      const card = renderFindingCard(f, isActiveFinding(f.status) ? rank : -1, latest, controlEvidenceIds, evidenceById);
      if (isActiveFinding(f.status)) rank++;
      return card;
    })
    .join("");

  const hasMeaningfulDivergence = model.findings.some((f) => Math.abs(f.priorityIndex - f.criticalityIndex) >= 2);
  const showPriorityMap = model.findings.length >= 3 && hasMeaningfulDivergence;

  return `<section class="section" id="findings" aria-labelledby="findings-heading">
  ${sectionHead(
    "findings-heading", "03", "FINDINGS & ACTIONS", "FINDINGS & ACTIONS",
    "Findings and next actions", "발견사항과 다음 조치",
    "Unresolved items from the project's full history, shown in priority order. Resolved, accepted, and false-positive items can be found in history.",
    "프로젝트 전체 이력에서 미해결 항목을 우선순위 순으로 표시합니다. 해결·수용·오탐 항목은 이력에서 확인할 수 있습니다.",
    `${active.length} ACTIVE / ${historical.length} HISTORY`, `${active.length}건 조치 필요 / ${historical.length}건 이력`
  )}
  <div class="toolbar">
    <div class="tabs" role="group" aria-label="Finding filter / 발견사항 필터">
      <button type="button" data-findings-filter="active" aria-pressed="true">${t("Needs action", "조치 필요")}<span class="tab-count">${active.length}</span></button>
      <button type="button" data-findings-filter="history" aria-pressed="false">${t("History", "처리 이력")}<span class="tab-count">${historical.length}</span></button>
      <button type="button" data-findings-filter="all" aria-pressed="false">${t("All", "전체")}<span class="tab-count">${sorted.length}</span></button>
    </div>
    <p class="filter-status" id="findings-count" aria-live="polite"></p>
  </div>
  <div class="finding-list" id="findings-list">${cards}</div>
  <p class="empty" id="findings-empty" hidden>${t("No findings match this filter.", "해당하는 발견사항이 없습니다.")}</p>
  ${showPriorityMap ? renderPriorityMap() : ""}
</section>`;
}

function renderDomainsSection(model: PresentationModel): string {
  const sorted = [...model.domains].sort(
    (a, b) => Number(a.coverage.assessed === 0) - Number(b.coverage.assessed === 0) || a.score - b.score || a.domain.localeCompare(b.domain)
  );
  const rows = sorted
    .map((d) => {
      const assessed = d.coverage.assessed > 0;
      const state = !assessed
        ? t("Not assessed", "미평가")
        : d.coverage.assessed < d.coverage.applicable
          ? t("In progress", "평가 진행 중")
          : t("Complete", "평가 완료");
      return `<div class="domain-row">
      <span class="domain-name">${t(domainLabel(d.domain), domainLabelKo(d.domain))}</span>
      <span class="domain-score numeric">${assessed ? `${d.score} <small>/ 100</small>` : "—"}</span>
      <span class="domain-coverage">
        <span class="domain-track" role="img" aria-label="${attr(`${domainLabel(d.domain)} coverage ${d.coverage.percent}%`)}"><span style="width:${Math.min(100, Math.max(0, d.coverage.percent))}%"></span></span>
        <span class="domain-ratio numeric">${d.coverage.assessed}/${d.coverage.applicable}</span>
      </span>
      <span class="domain-state">${state}</span>
    </div>`;
    })
    .join("");
  const archiveRows = model.domains
    .map((d) => `<tr><th scope="row">${t(domainLabel(d.domain), domainLabelKo(d.domain))}</th><td class="numeric">${d.score}</td><td class="numeric">${d.coverage.percent}%</td></tr>`)
    .join("");
  return `<section class="section" id="domains" aria-labelledby="domains-heading">
  ${sectionHead(
    "domains-heading", "04", "ASSESSMENT COVERAGE", "ASSESSMENT COVERAGE",
    "Assessment coverage by domain", "영역별 평가 현황",
    "Assessed domains are shown lowest-score first; domains not yet assessed appear after them.",
    "평가된 영역은 점수가 낮은 순서로, 아직 평가하지 않은 영역은 뒤에 표시합니다.",
    `${model.domains.length} DOMAINS`, `${model.domains.length}개 영역`
  )}
  <div class="domain-head" aria-hidden="true"><span>${t("Security domain", "보안 영역")}</span><span>${t("Control score", "통제 점수")}</span><span>${t("Assessed / Applicable", "평가 완료 / 적용 대상")}</span><span>${t("Progress", "진행 상태")}</span></div>
  ${rows}
  <p class="legend"><strong>${t("Bar = assessment completion rate.", "막대 = 평가 완료율.")}</strong> ${t(
    "A separate metric from the control score. Unassessed domains show — for score; see the raw figures below for source values.",
    "통제 점수와 별개의 지표입니다. 미평가 영역의 점수는 —로 표시하며, 원본 점수는 아래 원본 평가 수치에서 확인할 수 있습니다."
  )}</p>
  <details class="archive"><summary>${t("Raw assessment figures", "원본 평가 수치")}</summary>
  <div class="table-scroll"><table><caption>${t("Score and completion rate are the original snapshot figures.", "점수와 완료율은 원본 스냅샷 수치입니다.")}</caption>
  <thead><tr><th scope="col">${t("Domain", "영역")}</th><th scope="col">${t("Control score", "통제 점수")}</th><th scope="col">${t("Completion rate", "평가 완료율")}</th></tr></thead>
  <tbody>${archiveRows}</tbody></table></div></details>
</section>`;
}

function renderControlsSection(model: PresentationModel): string {
  const e = model.executive;
  const blockers = new Set([...e.blockingControlFailures, ...e.blockingControlsNotVerified]);
  const unverified = new Set(e.blockingControlsNotVerified);
  const rows = model.controls
    .map((c) => {
      const isGate = blockers.has(c.controlId);
      const gateLabel = isGate
        ? `<span class="gate-label">${unverified.has(c.controlId) ? t("Required verification incomplete", "필수 검증 미완료") : t("Blocks approval", "승인 차단 항목")}</span>`
        : "";
      const statusHistory = c.recordedStatus !== c.effectiveStatus || c.effectiveStatusReason
        ? `<details class="status-history"><summary>${t(`Originally recorded: ${statusLabel(c.recordedStatus)}`, `원래 상태: ${statusLabelKo(c.recordedStatus)}`)}</summary><p>${text(c.effectiveStatusReason?.detail ?? c.effectiveStatusReason?.label ?? "")}</p></details>`
        : "";
      const evidenceLinks = c.evidenceIds.length
        ? c.evidence.map((ev) => `<a href="${href(`#evidence-${ev.evidenceId}`)}">${text(ev.evidenceId)}</a>`).join("")
        : "";
      const findingLinks = c.findingIds.length ? c.findingIds.map((id) => `<a href="${href(`#finding-${id}`)}">${text(id)}</a>`).join("") : "";
      const noLinks = !c.evidenceIds.length && !c.findingIds.length ? `<span class="muted">${t("No linked records", "연결된 기록 없음")}</span>` : "";
      const notesBlock = c.notes ? `<details class="status-history"><summary>${t("Assessment notes", "평가 메모")}</summary><p>${text(c.notes)}</p></details>` : "";
      const raBlock = c.riskAcceptanceId ? `<span class="small muted">${t("Risk acceptance", "위험 수용")}: ${text(c.riskAcceptanceId)}</span>` : "";
      return `<tr id="control-${attr(c.assessmentId)}" data-control data-status="${attr(c.effectiveStatus)}" data-gate="${isGate}">
      <th scope="row"><span class="control-code">${text(c.controlId)}</span><span class="control-title">${text(c.title ?? c.controlId)}</span><span class="control-domain">${c.domain ? t(domainLabel(c.domain), domainLabelKo(c.domain)) : t("Unmapped", "미분류")}</span></th>
      <td>${statusPill(c.effectiveStatus)}${gateLabel}${statusHistory}</td>
      <td><div class="control-links">${evidenceLinks}${findingLinks}</div>${noLinks}${notesBlock}${raBlock}</td>
    </tr>`;
    })
    .join("");
  return `<section class="section" id="controls" aria-labelledby="controls-heading">
  ${sectionHead(
    "controls-heading", "05", "CONTROL REGISTER", "CONTROL REGISTER",
    "Control register", "통제 상세",
    "Shows the final status used for assessment. Change history can be expanded only when it differs from the original status.",
    "평가에 사용된 최종 상태를 표시합니다. 원래 상태와 다른 경우에만 변경 이력을 펼쳐볼 수 있습니다.",
    `${model.controls.length} CONTROLS`, `${model.controls.length}개 통제`
  )}
  <div class="toolbar">
    <div class="control-tools">
      <label class="sr-only" for="control-search">Search control name or ID / 통제 이름 또는 ID 검색</label>
      <input id="control-search" type="search" placeholder="Search control name or ID / 통제 이름 또는 ID 검색" autocomplete="off">
      <label class="sr-only" for="control-status">Control status / 통제 상태</label>
      <select id="control-status">
        <option value="all">${t("All statuses", "모든 상태")}</option>
        <option value="attention">${t("Fail · Partial · Not tested", "미충족 · 부분 충족 · 미평가")}</option>
        <option value="gate">${t("Decision requirements", "필수 확인 항목")}</option>
        <option value="FAIL">${t("Fail", "미충족")}</option>
        <option value="PARTIAL">${t("Partial", "부분 충족")}</option>
        <option value="NOT_TESTED">${t("Not tested", "미평가")}</option>
        <option value="PASS">${t("Pass", "충족")}</option>
        <option value="N/A">${t("N/A", "해당 없음")}</option>
        <option value="ACCEPTED_RISK">${t("Accepted risk", "위험 수용")}</option>
      </select>
    </div>
    <p class="filter-status" id="controls-count" aria-live="polite"></p>
  </div>
  <div class="table-scroll">
  <table class="control-matrix">
    <caption>${t(`${model.controls.length} total recorded controls · ${model.executive.coverage.applicable} applicable to the score`, `전체 ${model.controls.length}개 통제 기록 · 점수 집계의 적용 대상은 ${model.executive.coverage.applicable}개`)}</caption>
    <thead><tr><th scope="col">${t("Control", "통제 항목")}</th><th scope="col">${t("Final status", "최종 상태")}</th><th scope="col">${t("Evidence · Findings", "증빙 · 발견사항")}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
  <p class="empty" id="controls-empty" hidden>${t("No controls match the search.", "검색 조건에 해당하는 통제가 없습니다.")}</p>
</section>`;
}

function renderEvidenceSection(model: PresentationModel, latest: Map<string, ControlRow>): string {
  const controlsByEvidenceId = new Map<string, string[]>();
  const controlsByRiskAcceptanceId = new Map<string, string[]>();
  for (const c of model.controls) {
    for (const id of c.evidenceIds) controlsByEvidenceId.set(id, [...(controlsByEvidenceId.get(id) ?? []), c.controlId]);
    if (c.riskAcceptanceId) controlsByRiskAcceptanceId.set(c.riskAcceptanceId, [...(controlsByRiskAcceptanceId.get(c.riskAcceptanceId) ?? []), c.controlId]);
  }
  const evidenceItems = model.evidence
    .map((e) => {
      const refs = (controlsByEvidenceId.get(e.evidenceId) ?? []).map((id) => controlLink(latest, id)).join(", ") || t("None", "없음");
      return `<article id="evidence-${attr(e.evidenceId)}" class="evidence-record">
      <header><strong>${text(e.evidenceId)}</strong><span class="badge">${t(humanizeEnum(e.type), humanizeEnumKo(e.type, EVIDENCE_TYPE_LABELS_KO))}</span><code class="evidence-location">${text(e.location)}</code></header>
      ${e.description ? `<p>${text(e.description)}</p>` : ""}
      <footer class="record-meta">${text(e.capturedBy || "")}${e.capturedBy ? " · " : ""}${td(e.capturedAt)} · ${t("Linked controls", "연결 통제")}: ${refs}</footer>
    </article>`;
    })
    .join("");

  const raStatusEn: Record<string, string> = { active: "Active", expired: "Expired", revoked: "Revoked" };
  const raStatusKo: Record<string, string> = { active: "활성", expired: "만료", revoked: "철회" };
  const raItems = model.riskAcceptances
    .map((r) => {
      const refs = (controlsByRiskAcceptanceId.get(r.riskAcceptanceId) ?? []).map((id) => controlLink(latest, id)).join(", ") || t("None", "없음");
      const modifier = r.revokedAt ? "revoked" : r.status;
      return `<article id="risk-acceptance-${attr(r.riskAcceptanceId)}" class="evidence-record risk-acceptance-record">
      <header><strong>${text(r.riskAcceptanceId)}</strong><span class="status status--${attr(modifier)}">${t(raStatusEn[modifier] ?? modifier, raStatusKo[modifier] ?? modifier)}</span></header>
      <p class="risk-rationale">${text(r.reason)}</p>
      <dl class="record-facts">
        <div><dt>${t("Approved by", "승인자")}</dt><dd>${text(r.approvedBy)}</dd></div>
        <div><dt>${t("Approved", "승인일")}</dt><dd>${td(r.approvedAt)}</dd></div>
        <div><dt>${t("Expires", "만료일")}</dt><dd>${td(r.expiresAt)}</dd></div>
        <div><dt>${t("Compensating controls", "보완 통제")}</dt><dd>${r.compensatingControls.length ? r.compensatingControls.map((c) => text(c)).join(", ") : t("None", "없음")}</dd></div>
      </dl>
      ${r.revokedAt ? `<p class="badge badge-warning">${t("Revoked", "철회됨")} ${td(r.revokedAt)}${r.revokedReason ? `: ${text(r.revokedReason)}` : ""}</p>` : ""}
      <footer class="record-meta">${t("Applies to", "적용 대상")}: ${refs}</footer>
    </article>`;
    })
    .join("");

  return `<section class="section" id="evidence" aria-labelledby="evidence-heading">
  ${sectionHead(
    "evidence-heading", "06", "EVIDENCE LIBRARY", "EVIDENCE LIBRARY",
    "Basis for the verdict", "판정의 근거",
    "Expand each record to see the original text, when it was captured, and which controls it's linked to. Both assessment and correction records are preserved together.",
    "각 기록을 펼치면 원문과 작성 시점, 연결된 통제를 확인할 수 있습니다. 평가 기록과 정정 기록을 함께 보존합니다.",
    `${model.evidence.length} RECORDS`, `${model.evidence.length}건`
  )}
  <div class="record-list">${evidenceItems || `<p class="empty">${t("No evidence was referenced by this assessment run.", "이 평가 실행에서 참조된 증적이 없습니다.")}</p>`}</div>
  <h3>${t("Risk Acceptance", "위험 수용")}</h3>
  <div class="record-list">${raItems || `<p class="empty">${t("No risk acceptances were referenced by this assessment run.", "이 평가 실행에서 참조된 위험 수용이 없습니다.")}</p>`}</div>
</section>`;
}

function describeScope(scope: AssessmentScopes[keyof AssessmentScopes]): string {
  switch (scope.kind) {
    case "project":
      return t("This project, across all assessment history", "이 프로젝트의 전체 평가 이력");
    case "project-assessment-set": {
      const ids = scope.contributingRunIds.map((r) => text(r)).join(", ");
      return t(
        `${scope.contributingRunIds.length} assessment run${scope.contributingRunIds.length === 1 ? "" : "s"} contributing to this report: ${ids}`,
        `이 리포트에 반영된 평가 실행 ${scope.contributingRunIds.length}개: ${ids}`
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
    rows.push(`<li>${t(`${ri.missingEvidenceIds.length} evidence reference${ri.missingEvidenceIds.length === 1 ? "" : "s"} could not be resolved: ${ids}`, `증적 참조 ${ri.missingEvidenceIds.length}건을 찾을 수 없습니다: ${ids}`)}</li>`);
  }
  if (ri.missingRiskAcceptanceIds.length) {
    const ids = ri.missingRiskAcceptanceIds.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(`${ri.missingRiskAcceptanceIds.length} risk acceptance reference${ri.missingRiskAcceptanceIds.length === 1 ? "" : "s"} could not be resolved: ${ids}`, `위험 수용 참조 ${ri.missingRiskAcceptanceIds.length}건을 찾을 수 없습니다: ${ids}`)}</li>`);
  }
  if (ri.missingFindingIds.length) {
    const ids = ri.missingFindingIds.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(`${ri.missingFindingIds.length} finding reference${ri.missingFindingIds.length === 1 ? "" : "s"} could not be resolved: ${ids}`, `발견 사항 참조 ${ri.missingFindingIds.length}건을 찾을 수 없습니다: ${ids}`)}</li>`);
  }
  if (ri.unresolvedControlDefinitions.length) {
    const ids = ri.unresolvedControlDefinitions.map((id) => `<code>${text(id)}</code>`).join(", ");
    rows.push(`<li>${t(`${ri.unresolvedControlDefinitions.length} control definition${ri.unresolvedControlDefinitions.length === 1 ? "" : "s"} could not be resolved against the catalog: ${ids}`, `컨트롤 정의 ${ri.unresolvedControlDefinitions.length}건을 카탈로그에서 찾을 수 없습니다: ${ids}`)}</li>`);
  }
  if (!rows.length) return `<p class="integrity-ok">${t("No reference integrity issues were found in this report.", "이 리포트에서 참조 무결성 문제가 발견되지 않았습니다.")}</p>`;
  return `<ul class="integrity-list">${rows.join("")}</ul>`;
}

function renderScopeSection(model: PresentationModel): string {
  const s = model.assessmentScopes;
  const scopeBlock1 = `<div class="scope-block">
    <h3>${t("What data does this report read?", "어떤 데이터를 읽고 있나요?")}</h3>
    <ul>
      <li>${t("Findings", "발견사항")}: ${describeScope(s.projectFindingSnapshots)}</li>
      <li>${t("Control status", "통제 상태")}: ${describeScope(s.runControlAssessmentSnapshots)}</li>
      <li>${t("Evidence & risk acceptance", "증빙 · 위험 수용")}: ${describeScope(s.evidenceSnapshots)}</li>
      <li>${t("Score & release verdict", "점수 · 릴리스 판정")}: ${describeScope(s.score)}</li>
    </ul>
  </div>`;
  const scopeBlock2 = `<div class="scope-block">
    <h3>${t("What to check when interpreting this", "해석 시 확인할 점")}</h3>
    <ul>
      <li>${t("Control gaps and process gaps are a different classification from confirmed vulnerabilities.", "통제 미비·프로세스 미비와 확정 취약점은 서로 다른 분류입니다.")}</li>
      <li>${t("Being assessed does not mean a control passed or that security was approved.", "평가 완료는 통제의 충족이나 보안 승인을 뜻하지 않습니다.")}</li>
      <li>${t("Findings may include items recorded outside this assessment run.", "발견사항에는 이번 평가 회차 밖에서 기록된 항목이 포함될 수 있습니다.")}</li>
      <li>${t("Indices retain the original integers; scores and percentages retain the precision stored in the source.", "지수는 원본 정수를, 점수·백분율은 원본에 저장된 정밀도를 유지합니다.")}</li>
    </ul>
  </div>`;

  const genuineLimitations = model.limitations.filter((l) => !INTEGRITY_LIMITATION_CODES.has(l.code));
  const limitationItems = genuineLimitations.length
    ? `<ul class="limitation-list">${genuineLimitations.map((l) => `<li>${t(l.message, limitationMessageKo(l, s))}</li>`).join("")}</ul>`
    : `<p>${t("No assessment limitations were recorded.", "기록된 평가 한계 사항이 없습니다.")}</p>`;

  return `<section class="section" id="scope" aria-labelledby="scope-heading">
  ${sectionHead(
    "scope-heading", "07", "SCOPE & PROVENANCE", "SCOPE & PROVENANCE",
    "Scope and assessment history", "범위와 평가 이력",
    "This report presents a stored assessment result. Rendering it does not perform a new security assessment or alter the original result.",
    "이 보고서는 저장된 평가 결과를 표현한 문서입니다. 렌더링 과정에서 새로운 보안 평가를 수행하거나 원본 결과를 변경하지 않습니다.",
    ""
  )}
  <div class="scope-grid">${scopeBlock1}${scopeBlock2}</div>
  <dl class="definition-list">
    ${fact(t("Target version", "대상 버전"), targetSummary(model))}
    ${fact(t("Project name", "프로젝트 이름"), text(displayProjectName(model)))}
    ${fact(t("Source report generated", "원본 보고서 생성"), td(model.metadata.reportGeneratedAt))}
    ${fact(t("Rendered at", "렌더링 시각"), td(model.metadata.rendererRenderedAt))}
  </dl>
  <h3>${t("Limitations", "한계 사항")}</h3>
  ${limitationItems}
  <h3>${t("Reference integrity", "참조 무결성")}</h3>
  ${renderReportIntegrity(model)}
  <details class="provenance"><summary>${t("View report identifiers and original verdict", "보고서 식별자와 원본 판정 보기")}</summary>
    <dl class="definition-list">
      ${fact(t("Report ID", "리포트 ID"), `<code>${text(model.metadata.reportId)}</code>`)}
      ${fact(t("Report schema version", "리포트 스키마 버전"), text(model.metadata.reportSchemaVersion))}
      ${fact(t("Assessment run", "평가 실행"), `<code>${text(model.metadata.assessmentRunId)}</code>`)}
      ${model.metadata.engineVersionAtRunStart ? fact(t("Engine version", "엔진 버전"), text(model.metadata.engineVersionAtRunStart)) : ""}
      ${fact(t("Catalog version", "카탈로그 버전"), text(model.metadata.catalogVersion))}
      ${fact(t("Score model", "점수 모델"), `${text(model.metadata.scoreModel.id)} v${text(model.metadata.scoreModel.version)}`)}
      ${fact(t("Criticality formula", "중대성 산정 공식"), `${text(model.metadata.criticalityFormula.id)} v${text(model.metadata.criticalityFormula.version)}`)}
      ${fact(t("Source report SHA-256", "원본 리포트 SHA-256"), `<code>${text(model.metadata.sourceReportSha256)}</code>`)}
      ${fact(t("Renderer version", "렌더러 버전"), text(model.metadata.rendererVersion))}
    </dl>
  </details>
</section>`;
}
function fact(label: string, value: string): string {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

const REPORT_CSS = `
:root {
  color-scheme: light;
  --paper: #f5f4f0; --surface: #fff; --ink: #202b38; --muted: #596574; --line: #dedfdc; --navy: #182b3a;
  --accent: #365d69; --soft: #edf3f3; --amber: #8b560e; --amber-bg: #fbf2df; --red: #ab3832; --red-bg: #fcf0ed;
  --green: #26674e; --green-bg: #edf6f0; --blue: #365d87; --blue-bg: #edf2f8; --purple: #6b5383; --purple-bg: #f1ecf7;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 28px; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.65 var(--sans); -webkit-font-smoothing: antialiased; }
button, input, select { font: inherit; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button, summary { cursor: pointer; color: inherit; }
a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #497ead; outline-offset: 4px; }
h1, h2, h3, p, dl { margin: 0; }
h1, h2, h3 { line-height: 1.3; word-break: keep-all; }
h1 { font-size: clamp(32px, 4vw, 52px); font-weight: 650; letter-spacing: -0.05em; }
h2 { font-size: 24px; letter-spacing: -0.03em; }
h3 { font-size: 16px; letter-spacing: -0.02em; }
p { overflow-wrap: anywhere; }
small, .small { font-size: 12px; }
code, .mono { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
code { background: #eef0f1; padding: 2px 5px; border-radius: 3px; }
.numeric { font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
[hidden] { display: none !important; }

.shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--navy); color: #fff; padding: 34px 24px; display: flex; flex-direction: column; }
.brand { font-size: 23px; font-weight: 750; letter-spacing: 0.03em; }
.brand span { font-size: 10px; font-weight: 500; letter-spacing: 0.12em; display: block; margin-top: 1px; color: #b8cbd1; }
.sidebar-label { margin: 40px 0 14px; color: #adbec8; }
.toc { list-style: none; padding: 0; margin: 0; }
.toc a { display: flex; align-items: center; gap: 12px; padding: 11px 10px; margin: 3px -10px; color: #c3cfd7; font-size: 13px; border-left: 2px solid transparent; }
.toc a span { font-family: var(--mono); font-size: 10px; color: #91aab9; }
.toc a:hover, .toc a[aria-current="true"] { background: #243e4f; color: #fff; text-decoration: none; border-left-color: #a8c9cc; }
.side-note { margin-top: auto; padding-top: 28px; font-size: 11px; color: #afc0ca; line-height: 1.8; }
.side-note strong { display: block; color: #e3ecef; font-weight: 500; overflow-wrap: anywhere; }

.lang-toggle { display: flex; gap: 4px; margin: 20px 0 0; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.14); }
.lang-toggle button { flex: 1; font: inherit; font-size: 0.76rem; font-weight: 600; padding: 6px 4px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.22); background: transparent; color: #cdd8e0; white-space: nowrap; }
.lang-toggle button:hover { background: rgba(255,255,255,0.08); }
.lang-toggle button[aria-pressed="true"] { background: #fff; border-color: #fff; color: var(--navy); }
.lang-note { margin: 8px 0 0; font-size: 0.68rem; line-height: 1.4; color: #91aab9; }

.workspace { min-width: 0; }
.page { max-width: 1240px; margin: auto; padding: 48px 48px 0; }
.report-header { margin-bottom: 32px; }
.report-header .eyebrow { color: var(--accent); margin-bottom: 12px; }
.report-subtitle { margin: 14px 0 20px; font-size: 16px; color: var(--muted); }
.report-meta { display: flex; flex-wrap: wrap; gap: 12px 28px; color: var(--muted); font-size: 12px; }
.report-meta span + span { border-left: 1px solid var(--line); padding-left: 28px; }
.report-meta b { color: var(--ink); font-weight: 500; margin-left: 8px; }

.section { margin-top: 56px; scroll-margin-top: 24px; }
.section-heading { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; margin-bottom: 22px; }
.section-kicker { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 10px; letter-spacing: 0.13em; color: var(--accent); font-weight: 700; }
.section-kicker span { font-family: var(--mono); background: #e4ebea; padding: 2px 6px; letter-spacing: 0; }
.section-description { font-size: 13px; color: var(--muted); margin-top: 8px; max-width: 76ch; }
.section-count { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: nowrap; }

.verdict { border: 1px solid #d9d4c6; background: #fffdf8; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(230px, 1fr); border-radius: 8px; overflow: hidden; }
.verdict-main { padding: 28px 30px; }
.verdict-topline { display: flex; align-items: center; gap: 10px; color: var(--amber); font-size: 12px; font-weight: 650; }
.signal { height: 8px; width: 8px; border-radius: 50%; background: currentColor; flex: none; }
.verdict h2 { font-size: 28px; margin-top: 12px; letter-spacing: -0.04em; }
.verdict-main > p { color: var(--muted); margin-top: 10px; font-size: 14px; max-width: 58ch; }
.verdict-next { margin-top: 20px; display: inline-flex; align-items: center; gap: 14px; font-size: 13px; font-weight: 650; color: var(--ink); }
.verdict-aside { background: #f7f2e8; border-left: 1px solid #e8e1d3; padding: 28px; display: flex; flex-direction: column; justify-content: center; }
.verdict-aside dt { font-size: 12px; color: var(--muted); }
.verdict-aside dd { margin: 5px 0 8px; line-height: 1.2; font-size: 42px; letter-spacing: -0.05em; }
.verdict-aside dd span { font-size: 15px; color: var(--muted); letter-spacing: 0; margin-left: 6px; }
.verdict-aside p { font-size: 12px; color: var(--muted); }
.verdict--blocked .verdict-topline { color: var(--red); }
.verdict--approved .verdict-topline { color: var(--green); }
.coverage-track { height: 5px; background: #e2ded5; margin: 16px 0 10px; overflow: hidden; border-radius: 4px; }
.coverage-track > span { height: 100%; background: var(--accent); display: block; }

.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--line); padding: 24px 0; margin-top: 0; }
.metric { padding: 0 24px; border-left: 1px solid var(--line); }
.metric:first-child { padding-left: 0; border-left: 0; }
.metric:last-child { padding-right: 0; }
.metric dt { font-size: 12px; color: var(--muted); }
.metric dd { margin: 5px 0; font-size: 28px; line-height: 1.3; font-weight: 600; letter-spacing: -0.04em; }
.metric dd small { font-size: 13px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
.metric .metric-note { font-size: 11px; color: var(--muted); font-weight: 400; line-height: 1.65; letter-spacing: 0; margin: 0; }
.scope-note { margin-top: 16px; display: flex; gap: 10px; font-size: 12px; color: var(--muted); }
.scope-note b { color: var(--ink); white-space: nowrap; font-weight: 600; }
.scope-note a { white-space: nowrap; text-decoration: underline; }
.scope-note + .scope-note { margin-top: 8px; }

.actions { border-top: 1px solid var(--line); }
.action-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 18px 0; border-bottom: 1px solid var(--line); }
.action-number { font: 12px var(--mono); color: var(--muted); padding-top: 4px; }
.action-title { font-size: 14px; font-weight: 600; line-height: 1.5; }
.action-row p { font-size: 12px; color: var(--muted); margin-top: 5px; }
.action-row a { font-size: 12px; white-space: nowrap; padding-top: 4px; }
.action-id { font: 10px var(--mono); color: var(--muted); display: block; margin-top: 5px; }
.original-note { margin-top: 14px; font-size: 11px; color: var(--muted); }
.empty { padding: 24px 0; color: var(--muted); font-size: 13px; }

.pill, .status, .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; line-height: 1.4; padding: 4px 8px; border-radius: 4px; font-weight: 650; white-space: nowrap; background: #edf0f2; color: #52616c; }
.pill--high, .pill--critical, .pill--fail { background: var(--red-bg); color: var(--red); }
.pill--medium, .pill--partial { background: var(--amber-bg); color: var(--amber); }
.pill--low { background: var(--blue-bg); color: var(--blue); }
.pill--pass, .status--active { background: var(--green-bg); color: var(--green); }
.pill--accepted-risk, .status--revoked, .pill--na, .pill--not-tested { background: var(--purple-bg); color: var(--purple); }
.badge { background: #edf0f2; color: #52616c; }
.badge-warning { background: var(--amber-bg); color: var(--amber); }

.toolbar { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; align-items: center; }
.tabs { display: flex; gap: 4px; background: #eaece9; padding: 4px; border-radius: 6px; }
.tabs button { border: 0; background: transparent; padding: 7px 12px; font-size: 12px; border-radius: 4px; color: var(--muted); }
.tabs button[aria-pressed="true"] { background: #fff; color: var(--ink); box-shadow: 0 1px 3px #122c3810; }
.tabs .tab-count { margin-left: 6px; font: 11px var(--mono); }
.filter-status { font-size: 12px; color: var(--muted); }

.finding-list { border-top: 1px solid var(--line); }
.finding { border-bottom: 1px solid var(--line); background: transparent; }
.finding > summary { list-style: none; display: grid; grid-template-columns: 34px minmax(0, 1fr) 20px; gap: 14px; padding: 20px 2px; align-items: start; }
.finding > summary::-webkit-details-marker { display: none; }
.finding-rank { font: 12px var(--mono); color: var(--muted); padding-top: 4px; }
.finding-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.finding-id { font: 11px var(--mono); color: var(--muted); }
.finding-title { display: block; font-size: 16px; font-weight: 600; line-height: 1.5; max-width: 80ch; overflow-wrap: anywhere; }
.finding-subtitle { font-size: 12px; color: var(--muted); display: block; margin-top: 6px; }
.chevron { font-size: 19px; color: var(--muted); transition: transform 0.15s; }
.finding[open] > summary .chevron { transform: rotate(90deg); }
.finding[open] { background: #fff; }
.finding-body { padding: 0 28px 26px 66px; }
.facts { display: flex; flex-wrap: wrap; gap: 15px 28px; padding: 16px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-bottom: 20px; }
.facts dt { font-size: 11px; color: var(--muted); }
.facts dd { margin: 4px 0 0; font-size: 13px; }
.finding-body h4 { font-size: 12px; font-weight: 650; margin: 18px 0 8px; }
.narrative { font-size: 14px; line-height: 1.85; color: #3e4e5b; max-width: 85ch; white-space: pre-wrap; overflow-wrap: anywhere; }
.correction { border-left: 3px solid var(--accent); background: var(--soft); padding: 16px 18px; margin-bottom: 18px; }
.correction strong { font-size: 14px; }
.correction p { font-size: 13px; margin-top: 8px; }
.archive > summary { font-size: 12px; color: var(--muted); padding: 8px 0; }
.archive .narrative { font-size: 13px; }
#priority-criticality-scatter { display: block; width: 100%; max-width: 480px; height: auto; color: var(--muted); margin-top: 20px; }

.domain-head, .domain-row { display: grid; grid-template-columns: minmax(150px, 1.4fr) 90px minmax(130px, 1fr) 90px; gap: 18px; align-items: center; }
.domain-head { font-size: 11px; color: var(--muted); padding: 12px 0; border-bottom: 1px solid var(--line); }
.domain-row { padding: 14px 0; border-bottom: 1px solid var(--line); }
.domain-name { font-size: 13px; font-weight: 550; }
.domain-score { font: 14px var(--mono); white-space: nowrap; }
.domain-score small { font-size: 10px; color: var(--muted); }
.domain-coverage { display: flex; align-items: center; gap: 12px; }
.domain-track { height: 5px; background: #e0e5e3; flex: 1; overflow: hidden; border-radius: 3px; }
.domain-track span { display: block; height: 100%; background: var(--accent); }
.domain-ratio { font: 11px var(--mono); color: var(--muted); min-width: 38px; }
.domain-state { font-size: 11px; color: var(--muted); }
.legend { font-size: 12px; color: var(--muted); margin-top: 14px; }
.legend strong { color: var(--ink); font-weight: 500; }

.control-tools { display: flex; gap: 10px; flex-wrap: wrap; width: 100%; }
.control-tools input, .control-tools select { background: #fff; border: 1px solid #cbd1d0; border-radius: 5px; padding: 9px 12px; color: var(--ink); font-size: 12px; min-width: 0; }
.control-tools input { flex: 1; min-width: 180px; }
.table-scroll { border: 1px solid var(--line); border-radius: 6px; background: #fff; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 560px; text-align: left; }
caption { text-align: left; padding: 12px 16px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
th, td { padding: 13px 16px; border-bottom: 1px solid #e9ebe8; vertical-align: top; font-size: 12px; }
thead th { background: #eef1ee; color: var(--muted); font-size: 11px; font-weight: 500; }
tbody th { font-weight: 500; }
tbody tr:last-child > * { border-bottom: 0; }
.control-code { display: block; font: 10px var(--mono); color: var(--muted); margin-bottom: 5px; }
.control-title { font-size: 13px; display: block; line-height: 1.6; }
.control-domain { font-size: 10px; color: var(--muted); display: block; margin-top: 5px; }
.control-links { display: flex; gap: 6px 10px; flex-wrap: wrap; }
.control-links a { font: 10px/1.6 var(--mono); }
.status-history { margin-top: 9px; font-size: 11px; color: var(--muted); }
.status-history summary { font-size: 11px; }
.status-history p { margin-top: 5px; }
.gate-label { display: block; margin-top: 6px; font-size: 10px; color: var(--amber); }

.record-list { display: flex; flex-direction: column; gap: 8px; }
.evidence-record { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; }
.evidence-record header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.evidence-record header strong { font: 12px var(--mono); }
.evidence-location { font: 12px/1.7 var(--mono); overflow-wrap: anywhere; color: #435762; }
.record-meta { font-size: 11px; color: var(--muted); margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
.risk-rationale { margin: 6px 0 8px; font-size: 13px; }
.record-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.3rem 1rem; font-size: 12px; }
.record-facts dt { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
.record-facts dd { margin: 0.1rem 0 0; }

.scope-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.scope-block { border-top: 1px solid var(--line); padding-top: 18px; }
.scope-block h3 { margin-bottom: 10px; }
.scope-block ul { padding-left: 18px; margin: 0; font-size: 13px; color: var(--muted); }
.scope-block li + li { margin-top: 8px; }
.definition-list { margin-top: 20px; }
.definition-list > div { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 20px; border-bottom: 1px solid var(--line); padding: 10px 0; }
.definition-list dt { font-size: 12px; color: var(--muted); }
.definition-list dd { font-size: 12px; margin: 0; overflow-wrap: anywhere; }
.integrity-list { padding-left: 1.2em; margin: 8px 0; }
.integrity-list li { margin-block: 4px; color: var(--amber); font-size: 13px; }
.integrity-ok { color: var(--muted); font-size: 13px; margin: 8px 0; }
.limitation-list { padding-left: 1.2em; margin: 8px 0; list-style: disc; }
.limitation-list li { font-size: 13px; color: var(--muted); margin-block: 4px; }
.provenance { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 16px; }
.provenance > summary { font-size: 13px; font-weight: 600; }

footer.report-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 56px; border-top: 1px solid var(--line); padding: 22px 0 32px; color: var(--muted); font-size: 11px; max-width: 1240px; margin-inline: auto; padding-inline: 48px; }
footer.report-footer strong { font-weight: 650; color: var(--ink); }

@media (max-width: 1150px) {
  .shell { grid-template-columns: 188px minmax(0, 1fr); }
  .sidebar { padding: 28px 20px; }
  .page { padding: 36px 30px 0; }
  footer.report-footer { padding-inline: 30px; }
  .metric { padding-inline: 16px; }
  .domain-head, .domain-row { grid-template-columns: minmax(130px, 1.4fr) 76px minmax(90px, 1fr) 70px; gap: 12px; }
  .verdict-main, .verdict-aside { padding: 22px; }
  .finding-title { font-size: 15px; }
}
@media (max-width: 900px) {
  .shell { display: block; }
  .sidebar { position: static; height: auto; }
  .page { padding: 32px 24px 0; }
  footer.report-footer { padding-inline: 24px; }
  .section { margin-top: 44px; }
  .report-meta { gap: 8px 18px; }
  .report-meta span + span { padding-left: 18px; }
  .scope-grid { grid-template-columns: 1fr; gap: 20px; }
}
@media (max-width: 600px) {
  body { font-size: 14px; }
  .page { padding: 28px 18px 0; }
  footer.report-footer { padding-inline: 18px; }
  h1 { font-size: 34px; }
  h2 { font-size: 21px; }
  .verdict { grid-template-columns: 1fr; }
  .verdict-main { padding: 20px; }
  .verdict h2 { font-size: 24px; }
  .verdict-aside { border-left: 0; border-top: 1px solid #e8e1d3; padding: 18px 20px; }
  .verdict-aside dd { font-size: 32px; }
  .metrics { grid-template-columns: 1fr 1fr; gap: 20px 0; padding: 20px 0; }
  .metric { padding: 0 14px; }
  .metric:nth-child(odd) { padding-left: 0; }
  .metric:nth-child(even) { border-left: 0; }
  .action-row { grid-template-columns: 22px minmax(0, 1fr); gap: 8px; }
  .action-row > a { grid-column: 2; padding-top: 0; }
  .finding > summary { grid-template-columns: 20px minmax(0, 1fr) 14px; gap: 8px; padding-block: 18px; }
  .finding-body { padding: 0 16px 20px; }
  .facts { gap: 14px 20px; }
  .domain-head, .domain-row { grid-template-columns: minmax(100px, 1fr) 70px 90px; gap: 10px; }
  .domain-state { display: none; }
  .finding-facts, .record-facts { grid-template-columns: repeat(2, 1fr); }
  .scope-grid { grid-template-columns: 1fr; }
  .definition-list > div { grid-template-columns: 100px minmax(0, 1fr); gap: 12px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
@page { size: A4; margin: 16mm 14mm 18mm; }
@media print {
  body { background: #fff; font-size: 10pt; color: #17232c; }
  .shell { display: block; }
  .sidebar, .toolbar, [data-filter], .finding-rank, .chevron { display: none !important; }
  .page { max-width: none; padding: 0; }
  h1 { font-size: 30pt; }
  .verdict { grid-template-columns: 1.4fr 1fr; break-inside: avoid; }
  .verdict h2 { font-size: 20pt; }
  .metrics { break-inside: avoid; }
  .section { margin-top: 26px; }
  #findings, #domains, #controls, #evidence, #scope { break-before: page; }
  .finding, .evidence-record, tr { break-inside: avoid; }
  details:not([open]) > *:not(summary) { display: block !important; }
  details::details-content { content-visibility: visible !important; block-size: auto !important; overflow: visible !important; }
  thead { display: table-header-group; }
  a { color: inherit; text-decoration: underline; }
  a[href^="#"] { text-decoration: none; }
  .pill, .status, .badge, .coverage-track, .domain-track { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .table-scroll tr[hidden] { display: table-row !important; }
  .finding[hidden], .empty[hidden] { display: block !important; }
  .empty, .empty[hidden] { display: none !important; }
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
      .attr("fill", function (d) {
        var tone = { critical: "#a61b1b", high: "#c2410c", medium: "#8a5a00", low: "#1d4ed8", informational: "#596475" };
        return tone[d.severity] || "#596475";
      })
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
    var buttons = document.querySelectorAll("[data-findings-filter]");
    var findings = document.querySelectorAll("#findings-list > [data-finding]");
    var status = document.getElementById("findings-count");
    var empty = document.getElementById("findings-empty");
    function isActive(node) { var s = node.getAttribute("data-status"); return s === "open" || s === "in_progress"; }
    function currentLang() { return document.documentElement.getAttribute("lang") === "ko" ? "ko" : "en"; }
    function render(mode) {
      findings.forEach(function (node) {
        node.hidden = mode === "active" ? !isActive(node) : mode === "history" ? isActive(node) : false;
      });
      var count = 0;
      findings.forEach(function (node) { if (!node.hidden) count++; });
      var lang = currentLang();
      status.textContent = lang === "ko"
        ? "전체 " + findings.length + "건 중 " + count + "건 표시"
        : "Showing " + count + " of " + findings.length + " findings";
      empty.hidden = count !== 0;
    }
    var currentMode = "active";
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        currentMode = button.getAttribute("data-findings-filter");
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
        render(currentMode);
      });
    });
    render(currentMode);
    window.__csiRenderFindingsStatus = function () { render(currentMode); };
  }

  function wireControlFilter() {
    var rows = document.querySelectorAll("[data-control]");
    var search = document.getElementById("control-search");
    var statusSelect = document.getElementById("control-status");
    var countEl = document.getElementById("controls-count");
    var empty = document.getElementById("controls-empty");
    if (!search || !statusSelect) return;
    function currentLang() { return document.documentElement.getAttribute("lang") === "ko" ? "ko" : "en"; }
    function render() {
      var query = search.value.trim().toLocaleLowerCase();
      var statusValue = statusSelect.value;
      rows.forEach(function (row) {
        var rowStatus = row.getAttribute("data-status");
        var matchesStatus = statusValue === "all"
          || (statusValue === "attention" ? ["FAIL", "PARTIAL", "NOT_TESTED"].indexOf(rowStatus) !== -1
              : statusValue === "gate" ? row.getAttribute("data-gate") === "true"
              : rowStatus === statusValue);
        row.hidden = !matchesStatus || (query !== "" && row.textContent.toLocaleLowerCase().indexOf(query) === -1);
      });
      var count = 0;
      rows.forEach(function (row) { if (!row.hidden) count++; });
      var lang = currentLang();
      countEl.textContent = lang === "ko"
        ? count + "개 표시 / 전체 " + rows.length + "개"
        : "Showing " + count + " of " + rows.length;
      empty.hidden = count !== 0;
    }
    search.addEventListener("input", render);
    statusSelect.addEventListener("change", render);
    render();
    window.__csiRenderControlsStatus = render;
  }

  function revealTarget() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (err) { return; }
    var target = document.getElementById(id);
    if (!target) return;
    if (target.matches("[data-finding]") && target.hidden) {
      document.querySelectorAll("[data-findings-filter]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-findings-filter") === "all")); });
      if (window.__csiRenderFindingsStatus) {
        var findings = document.querySelectorAll("#findings-list > [data-finding]");
        findings.forEach(function (node) { node.hidden = false; });
        window.__csiRenderFindingsStatus();
      }
    }
    if (target.matches("[data-control]") && target.hidden) {
      var search = document.getElementById("control-search");
      var statusSelect = document.getElementById("control-status");
      if (search && statusSelect) { search.value = ""; statusSelect.value = "all"; if (window.__csiRenderControlsStatus) window.__csiRenderControlsStatus(); }
    }
    for (var node = target; node; node = node.parentElement) if (node.tagName === "DETAILS") node.open = true;
    requestAnimationFrame(function () { target.scrollIntoView({ block: "start" }); });
  }
  window.addEventListener("hashchange", revealTarget);
  document.addEventListener("click", function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (link && link.hash === location.hash) revealTarget();
  });

  function wireTocHighlight() {
    var links = document.querySelectorAll("[data-toc-link]");
    if (!links.length || typeof IntersectionObserver === "undefined") return;
    var linkByTargetId = {};
    links.forEach(function (link) {
      var id = link.getAttribute("href").replace("#", "");
      linkByTargetId[id] = link;
    });
    var current = null;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var link = linkByTargetId[entry.target.id];
          if (!link || link === current) return;
          if (current) current.removeAttribute("aria-current");
          link.setAttribute("aria-current", "true");
          current = link;
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
      document.querySelectorAll("details, [hidden]").forEach(function (node) {
        printStates.set(node, { open: node.open, hidden: node.hidden });
        if (node.tagName === "DETAILS") node.open = true;
        if (!node.classList.contains("empty")) node.hidden = false;
      });
    });
    window.addEventListener("afterprint", function () {
      printStates.forEach(function (state, node) {
        if (node.tagName === "DETAILS") node.open = state.open;
        node.hidden = state.hidden;
      });
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
      if (typeof window.__csiRenderControlsStatus === "function") window.__csiRenderControlsStatus();
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
  wireControlFilter();
  wireTocHighlight();
  wirePrintExpansion();
  wireLanguageToggle();
  if (location.hash) revealTarget();
})();
`;

export function renderReportHtml(model: PresentationModel, opts: { d3Source: string }): string {
  const latest = buildLatestControlByControlId(model);
  const main = [
    renderReportHeader(model),
    renderVerdictSection(model),
    renderActionsSection(model, latest),
    renderFindingsSection(model, latest),
    renderDomainsSection(model),
    renderControlsSection(model),
    renderEvidenceSection(model, latest),
    renderScopeSection(model),
  ].join("\n");

  const scriptData = {
    findings: model.findings.map((f) => ({
      findingId: f.findingId, title: f.title, severity: f.severity,
      priorityIndex: f.priorityIndex, criticalityIndex: f.criticalityIndex, status: f.status,
    })),
  };
  const dataJson = escapeForInlineScriptJson(JSON.stringify(scriptData));
  const shortId = model.metadata.reportId.slice(0, 8);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
<title>${text(displayProjectName(model))} — Security Assessment Report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<a class="sr-only" href="#overview">Skip to content / 본문으로 이동</a>
<div class="shell">
${renderSidebar(model)}
<div class="workspace">
<main class="page" id="overview">
${main}
</main>
</div>
</div>
<footer class="report-footer"><p><strong>C.S.I</strong> · Security Assessment Report</p><p>${text(displayProjectName(model))} / ${text(shortId)}</p></footer>
<script type="application/json" id="report-data">${dataJson}</script>
<script>${opts.d3Source}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
