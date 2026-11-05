# Sherivs Master Engineering Execution Roadmap

**Status:** Provisional; ordered by safety and dependency, not by product ambition.  
**Baseline:** `master` at `e4be19c` (2026-11-05).

## Execution principles

- Separate code readiness from operational deployment readiness.
- Preserve existing production data; schema reconciliation is read-only until a separately reviewed migration is authorized.
- Keep V2/V3 frozen. Implement only explicitly approved bounded slices and existing V1 requirements.
- Use one owner per workstream and isolated branches/worktrees; all work returns to the master orchestrator for review.
- No paid-service activation, live messages/calls/payments, production migration, or deployment without the specific operational authorization and budget.
- Do not merge draft work or mark a feature complete until source review, focused tests, and required CI all pass.

## Wave 0 — Finish repository intelligence (in progress)

**Objective:** establish an evidence-backed baseline and identify a minimum controlled-launch scope.

- Complete the 16 audit workstreams and reconcile their reports.
- Publish `MASTER_EXECUTION_AUDIT.md`, `PRODUCTION_READINESS_MATRIX.md`, `AGENT_WORKFORCE_REGISTRY.md`, and this roadmap.
- Reconcile conflicting deployed-state documentation and migration ledgers without writing to production.
- Rank candidate launch journeys and explicitly classify P0/P1/P2.

**Exit gate:** each production-critical claim has code/test/CI or approved operational evidence; unknowns remain explicitly blocked.

## Wave 1 — Prove tenant and release safety (P0)

**Dependencies:** Wave 0 audit; owner/operator approval for any live observation.

- Establish the canonical production schema and migration ledger read-only; document tenant-key mapping and ownership per domain.
- Verify tenant authorization end-to-end across server handlers and database policies using local/disposable isolation tests.
- Repair release-critical cron/authentication defects and demonstrate scheduled job behavior locally.
- Verify release environment inputs, monitoring/alert routing, secret provisioning procedure, rollback, backup custody, and restore drill.
- Define the minimum commercial V1 launch surface; hide or clearly disable unimplemented routes and capabilities.

**Exit gate:** no unresolved cross-tenant access path; no unaudited production schema mutation; release can be reproduced and rolled back; restore and alerts are evidenced.

## Wave 2 — Complete minimum school workflows (P0)

**Dependencies:** Wave 1; product owner accepts minimum launch scope.

- Build only the missing route-backed workflows needed for the approved launch: administrator setup and core school operations, teacher daily actions, student essentials, guardian access, and finance where included.
- Reuse existing domain services, authorization, tables, design system, and navigation; do not make UI-only stubs.
- Add route/service integration tests and at least two-tenant authorization tests for data access.
- Remove navigation entries whose workflow cannot yet be completed.

**Exit gate:** every exposed launch journey is functional at desktop/mobile breakpoints, server-authorized, and covered by tests.

## Wave 3 — Operational finance and communications (P1 / launch-scope dependent)

- Prove provider sandbox payment settlement, replay/idempotency, reconciliation, receipt and refund behavior.
- Complete only the communication channels selected for launch; require verified destinations, consent, rate/spend controls, deduplication, and delivery logs.
- Keep voice, outbound SMS, and human escalation gated until their migrations, operational controls, and provider sandbox tests pass.

**Exit gate:** no frontend success is treated as settlement; provider events and delivery state are durable, tenant-bound, and replay-safe.

## Wave 4 — Intelligence capabilities (P2; staged)

- Unify role-context, digital-twin identity, memory, approval, agent mission state, and tool execution only after the Wave 1 authorization and persistence boundaries are established.
- Require registry-backed model routing; remove or explicitly prohibit the legacy direct-model path for governed execution.
- Make approvals and audit records durable, identity-bound, tenant-scoped, expiry-aware, and enforced at the execution boundary.
- Run credential-gated provider drills only in an approved, budgeted test window; never use customer data for test prompts.

**Exit gate:** restart/replay, tenant isolation, tool restrictions, auditability, human approval, usage budgets, and provider failure paths are demonstrated.

## Wave 5 — Controlled release and operational handover

- Complete a production runbook, on-call/escalation ownership, cost budget, RTO/RPO acceptance, migration/rollback notes, backup restore evidence, and support workflow.
- Execute the release pipeline only after explicit release approval; verify health, smoke tests, monitoring, and rollback readiness.
- Publish a release report with limitations and remaining P1/P2 work.

**Exit gate:** owner accepts the exact release scope and evidence; no unresolved P0 item remains.

## Active work

| Work | Status | Next action |
|---|---|---|
| 16-workstream repository audit | IN PROGRESS | Review remaining agent reports and reconcile evidence. |
| R1 taxonomy/registry PR #336 | CI PENDING | Review remote checks on `21f2fd5`; preserve draft until owner review. |
| Scheduling PR #324 | READY FOR REVIEW | Remote checks are green; keep draft/unmerged pending explicit review. |
| R3 interview #334 | AUTHORIZED / NOT STARTED | Confirm reuse/persistence model; reserve migration range on issue before any migration work. |
| R9 website sync #335 | AUTHORIZED / DEPENDENCY BLOCKED | Start after R3 contract; reuse existing generator and only publish explicitly approved public-safe fields. |

## Founder/operator decisions still needed

- The minimum commercial launch scope and which role journeys must be live on day one.
- Accepted production tenant/schema canonical mapping and migration-ledger source of truth.
- Approved production environment, budget ceilings, provider/channel selection, and contact/alert ownership.
- Accepted RTO/RPO and backup retention/custody plus the window for a restore drill.
- Any production migration/deployment window and the approver for rollback.

No values, credentials, production identifiers, or costs are inferred by this roadmap.
