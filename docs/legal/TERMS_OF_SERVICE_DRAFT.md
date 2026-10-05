# Terms of Service — DRAFT, NOT LEGAL ADVICE

> **Do not show this to a paying customer as-is.** This is a starting
> structure for LEGAL-LICENSE-001 (commercialization-readiness audit,
> 2026-10-05), written by an AI assistant without legal training. Every
> bracketed `[ ]` placeholder needs a real decision, and the whole
> document needs a lawyer licensed in your jurisdiction to review it
> before it governs a real transaction. Treat the sections below as "the
> topics a security-tool ToS needs to cover," not "the wording to ship."

## Why this document exists

C.S.I-mcp evaluates a target codebase against a control catalog and
produces findings, scores, and a release-gate verdict. Three properties of
that output create legal exposure a generic SaaS ToS doesn't cover, and
this draft exists specifically to address them:

1. **False negatives are inherent, not incidental.** The tool's own
   documented known-limitations (`docs/superpowers/specs/`,
   `src/core/release-evaluator.ts`) include real bypass paths
   (`ACCEPTED_RISK` trusted without validation, `N/A` requiring no
   evidence, stale assessments going undetected). A customer who reads
   `result: "approved"` as "this codebase has no critical vulnerabilities"
   is wrong, and the terms need to say so before, not after, an incident.
2. **The tool's output can inform a release decision with real
   consequences.** If a customer ships based on an `"approved"` verdict
   and gets breached, "we relied on your tool" is a foreseeable claim.
3. **The tool processes the customer's own vulnerability data.** Findings
   recorded during an assessment are, by construction, a list of the
   customer's unpatched weaknesses — arguably more sensitive than the
   customer's ordinary business data, and worth its own confidentiality
   language rather than inheriting a generic SaaS data clause.

## 1. No Warranty of Completeness or Accuracy

[Standard "AS IS" disclaimer] **plus**, specific to this tool: the Service
identifies a subset of security weaknesses visible to its control catalog
and assessment methodology at the time of the assessment. It does not
guarantee detection of all vulnerabilities, does not constitute a
penetration test, security certification, or compliance attestation, and
a `"result": "approved"` verdict means the gate's specific, documented
checks passed — not that the target is free of security defects.

## 2. Not a Substitute for Independent Security Review

For [production / customer-facing / SVL-3 — fill in threshold] systems,
Customer acknowledges the Service is a supplementary tool and does not
replace independent penetration testing, code audit, or compliance
certification where those are otherwise required by law, contract, or
Customer's own policy.

## 3. Limitation of Liability

[Standard cap — e.g. fees paid in the preceding 12 months] and exclusion
of indirect/consequential damages, **with counsel confirming this clause
is enforceable for a security-tool context in your jurisdiction** —
liability waivers for security products get read more skeptically by
courts than for generic software, precisely because the harm (a breach)
is the thing the product claims to help prevent.

## 4. Customer Retains Remediation Responsibility

The Service reports findings and a gate verdict; it does not remediate
them. Decisions to ship, delay, or accept risk on any finding remain
Customer's, including any use of the `ACCEPTED_RISK` assessment status —
Customer, not the Service, is the actor making that risk-acceptance
decision and bears responsibility for it. [Tie this explicitly to the
TRUST-RISKACCEPT-001 gap once that subsystem exists: today the tool
doesn't even validate who accepted what.]

## 5. Confidentiality of Assessment Data

Findings, assessment records, and reports generated for Customer's
project(s) are Customer Confidential Information. [Define: retention
period, who at the vendor can access raw findings, whether/how findings
are used in aggregate/anonymized form for product improvement, deletion
on contract termination.] This section exists because — unlike most SaaS
data — the content here is literally a list of Customer's unpatched
security weaknesses.

## 6. Acceptable Use

Customer will only run assessments against codebases/systems it owns or
is authorized to assess. [Standard authorized-use clause, same spirit as
any pentesting-adjacent tool's ToS.]

## 7. Service Availability / Support

[Fill in once BIZ-SUPPORT-001 on the readiness dashboard is decided — SLA
tier, response times, support channel.]

## 8. Fees, Term, Termination

[Fill in once BIZ-PRICING-001 is decided — self-hosted license vs. SaaS
subscription changes this section substantially; don't draft it until
INFRA-DEPLOY-001 is decided.]

## 9. Governing Law / Dispute Resolution

[Jurisdiction placeholder — pick based on where the business entity is
actually incorporated.]

---

**Before this leaves draft status:** have a lawyer (a) confirm Sections 1–3
actually hold up for a product whose entire value proposition is "finding
security problems," (b) fill in every bracket above, and (c) check this
against whatever jurisdiction(s) you plan to sell into.
