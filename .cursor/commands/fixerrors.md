# /fixerrors — collect evidence, then repair

## Responsibility

The script is a diagnostic tool. The chat engineer is the decision-maker: run the collector, read its evidence, investigate with available tools, and attempt to fix the reported problems. Do not stop at an export, acknowledgement, classifier disposition or renewed investigation record.

Use this chat's attached repository. Never substitute another project's runbook or database. A request to change this workflow is not a request to run it against production.

## Normal workflow

1. Run `npm run fixerrors` from the repository root. Read `private/fixerrors/error-analysis.md`, the snapshot, and `private/fixerrors/acknowledged-backlog.md`. The script gathers OPEN and ACKNOWLEDGED faults, bounded event/request evidence, history, code refs and suggested groups. Read the printed limitations. A group is not a proven common cause.
2. Acknowledge unchanged OPEN issues with the printed checksum-bound command: inspect its dry run, then apply. Reconcile pending archived releases when present. These are bookkeeping, not repairs.
3. Assess the whole unresolved backlog, then investigate actionable families using judgment about severity, user impact, recurrence and available evidence. Prioritize critical faults and explicit user reports; include overdue cases rather than silently recycling them. Use existing findings to avoid repeating work. Script labels such as `needs-person`, `report-only` and source-frame limitations mean handoff to the engineer, not refusal to investigate.
4. Read the owning code and use relevant logs, database evidence, browser interactions, deployment facts and regression tests. Reproduce the reported interaction where practical; a generic page-load smoke test does not establish the cause of an interaction failure. Decide whether the evidence supports a root-cause repair, a preventive mitigation, or a specific next evidence-gathering action.
5. Implement proportionate repairs on staging, preserving concurrent work. Test the failure and relevant boundaries. Use independent review where required by the repair helper or warranted by risk. Follow existing release authorization and staging-to-main policy; do not infer new deployment approval from collecting faults.
6. Report separately: faults examined, fixes implemented/tested/deployed, preventive mitigations and their uncertainty, and remaining issues with concrete blockers or next actions. State what was actually attempted. Report data collection as collection, never as successful repair.

## Evidence sufficiency is an engineering judgment

- **Lower-risk browser faults:** exact historical causality is not always necessary for a useful defensive change. A bounded recovery path, safer resource handling, or graceful fallback may prevent the observed user impact. Explain the supported failure mechanism, test it, assess side effects, retain useful diagnostics and define how effectiveness will be checked. A retry must be bounded and safe for the operation; never retry non-idempotent writes blindly. An error boundary cannot prevent every browser error.
- **Database connections, persistence, payments, security or data integrity:** establish the cause before changing behavior. Check current connection/configuration, server evidence and affected operations. Do not guess at pool sizes, weaken validation, hide failures, or add blanket retries. Existing approval gates remain. Actual impact overrides an incorrect severity label.
- **Unknown cause:** do not wait indefinitely for a perfect stack if a defensible low-risk mitigation is available. Conversely, do not force a speculative patch merely to reduce the unresolved count. Explain why a fix is or is not justified. If evidence is insufficient, make collection more useful where practical and name the exact missing facts and next diagnostic action.
- **Noise versus prevention:** suppressing alerts, catching and discarding exceptions, or muting generic network/RSC failures is not a preventive fix. Only classify noise when evidence establishes expected behavior.

## Repairs and mechanical safeguards

The legacy classifier is advisory. For a proven non-critical repair outside its automatic eligibility, use `--engineer-reviewed` with `--commit-cluster`, retaining the bound cluster's original `--lane`. This permits a tested, independently reviewed repair even without an original source frame or when the hint is `needs-person`/`report-only`. Explain the diagnosis, evidence sufficiency and why the earlier limitation is overcome in the review evidence. A previous failed fix requires a different supported approach, not blindly repeating it.

This flag does not remove snapshot expiry/checksums, unique issue membership, baseline/path checks, clean staging, exact staged diff review, tests, or production verification. Report-only repairs are recorded as guarded releases. CRITICAL lanes/members still require the separate approved critical workflow; investigation can continue immediately. Use the ordinary reviewed project workflow for approved critical repairs, not a classifier bypass.

For a preventive mitigation whose effect on the original incident is unproven, use the ordinary project change/release workflow and record the mitigation and verification plan in the issue investigation. Do not register it as a proven repair for automatic resolution. Diagnostic improvements also do not resolve the underlying fault. Verified repairs may use the snapshot-bound release helper; close only the issue subset the evidence supports.

The complete argument/reference guide is [fixerrors-command-reference.md](../../docs/fixerrors-command-reference.md). Use it for exact mutation commands, not as a second decision-making process. Historical records remain readable.

## Investigation records and better collection

Retain valid unchanged plans without rewriting dates or occurrence baselines. Update records when diagnosis, mitigation, evidence or next action actually changes. An overdue retained plan remains overdue and must be mentioned if it could not be progressed. Full record coverage is bookkeeping, not a completion metric.

Improve the collector when a real investigation exposes missing useful evidence: add the smallest privacy-safe fields or correlation needed, test the capture/export path, and document what question the evidence answers. Do not build a new classifier or rule engine for each incident. Keep bounded payloads, provenance, redaction, original fault visibility and operational timeouts.

## Completion for a run

The engineer has attempted justified repairs and useful diagnostic actions, or identified specific blockers that prevent them. Remaining issues need honest, actionable explanations; zero OPEN issues, 100% plan coverage, or a passing smoke test alone never means the job is done. Do not promise that one run can eliminate all historical or external faults.
