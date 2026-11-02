# ADR-014: SV1 Mobility Follow-up — Advisory, Documents, Notifications, and Fee Allocation

| Field                      | Value                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator review; migration remains unapplied)                                                                                                                                                                                                                                                               |
| Date                       | 2026-11-02                                                                                                                                                                                                                                                                                                            |
| Author                     | copilot-swe-agent[bot] (SV1-MOBILITY implementation)                                                                                                                                                                                                                                                                  |
| Mission                    | SV1-MOBILITY (Scholar runtime; V1 organizational capability)                                                                                                                                                                                                                                                          |
| Capabilities               | Student lifecycle mobility follow-up (issue #260)                                                                                                                                                                                                                                                                     |
| Supersedes-in-part         | [ADR-013](./ADR-013_SV1_MOBILITY_LEGACY_STORE_EXTENSION.md) — only its statement that mobility AI recommendations are not authorized; all tenant-store, RLS, and apply constraints remain                                                                                                                             |
| Cites                      | Issue #260; [ADR-013](./ADR-013_SV1_MOBILITY_LEGACY_STORE_EXTENSION.md); `database/supabase/migrations/20261103000000_sv1_student_mobility_followup.sql`; `frontend/src/lib/runtime/scholar/mobility-advisory.functions.ts`; `frontend/src/lib/scholar/mobility-documents.ts`; AGENTS.md §§17, 19, 20, 21, 26, 28, 45 |
| Minimal ownership artifact | This ADR only — a decision artifact                                                                                                                                                                                                                                                                                   |

## Context

Issue #260 names the remaining student mobility scope: a confirmable bulk request flow, transfer/movement PDFs, request lifecycle notifications, advisory-only AI recommendations, and fee proration across placements. The existing mobility store is the V1 Scholar store and remains tenant-bound by `school_id`; ADR-013 records the original mobility extension and explicitly preserves forced RLS, permission-checked mutations, and file-only migrations.

The existing finance record stores fee amount, paid amount, academic year, and term. Academic periods provide start/end dates. The follow-up therefore records time-weighted allocation snapshots only when a fee's academic year and normalized term identify an academic period. It does not modify invoices, payment records, fee policy, or approval decisions. Notifications are in-app only and resolve recipients within the same school. PDFs are generated from records the caller can already read and disclose that institutional review/signature may still be required.

Mobility AI advice is a narrow exception explicitly named by issue #260, not a general AI decision capability. Inputs are limited to a validated policy preview, authorized by `students.transfer`, minimized to remove student identifiers, and sent through the centralized gateway. The output remains untrusted, explainable, advisory-only, and has no mutation or approval tool.

## Options

### Option 1 — Defer all follow-up features (rejected for this issue)

Leave the V1 mobility workflow at its current request/approval/ledger boundary.

- **Consequences:** Avoids new data flows and migration review, but leaves the specifically requested mobility user flow and financial allocation view incomplete.

### Option 2 — Mutate invoices and let AI recommend or apply changes (rejected)

Write proration into canonical fee/payment rows or allow AI advice to submit or approve movements.

- **Consequences:** Would risk corrupting canonical finance truth, duplicate or alter payments, and bypass human approval. This conflicts with AGENTS.md §§9, 21, 28 and ADR-013's least-privilege boundary.

### Option 3 — Additive, tenant-scoped records and non-binding outputs (recommended)

Create append-only allocation snapshots by intersecting placement intervals with the matching academic period; route in-app notices from mobility state transitions; generate PDFs locally from authorized data; and expose only gateway-backed advice without write access.

- **Consequences:** Preserves source invoices and approval controls and makes derived allocation and advisory provenance explicit. Allocation is unavailable for fees without a matching academic year/term, and AI remains unavailable when the gateway is not configured. New migration vocabulary requires the ADR-004 exception process; no migration is applied by this decision.

## Recommendation (decision)

**Use Option 3 for the exact V1 student mobility follow-up named in issue #260.** Bulk apply continues to create per-student requests through the existing atomic RPC; it never commits placements. Fee allocations use half-open placement intervals in UTC and preserve original invoice/payment rows. Notifications are same-school in-app notices only. PDFs disclose that institutional authorization may be required. AI receives only authorized, schema-validated preview evidence through the existing gateway and cannot access mutation functions or alter eligibility.

### Explicit residual risk

- **The residual risk:** Fee allocations depend on a matching academic period and are derived views, not invoice adjustments or refund authorizations.
- **The sharpest instance:** Missing or inconsistent fee term/session values prevent allocation; overlapping placement intervals are skipped rather than guessed.
- **The accepted rationale:** Failing closed avoids inventing a fee calendar or changing canonical finance truth.
- **Owner of the residual risk:** Scholar mobility and Finance must reconcile unmatched fees before any separately authorized ledger adjustment.

## Consequences (summary)

- **Positive:** Makes the requested V1 mobility flow reviewable, auditable, and tenant-scoped without weakening requester/approver separation.
- **Negative / obligations:** Keep forced RLS and direct-write revocations; validate gateway inputs and label outputs untrusted; include these migration-only neutrality findings under a separate ADR; do not apply the migration absent explicit database authorization.
- **For the wave/program specifically:** SV1-MOBILITY owns this bounded feature slice. This record does not authorize general AI recommendations, cross-tenant notifications, invoice mutation, live provider sends, or V2/V3 capability.

### Neutrality-baseline findings

The six quarantined groups are observed only in the file-only follow-up migration. `school_id` and `get_my_school_id` retain the existing Scholar tenant binding and policy predicate; `fee` and `fees` identify the existing invoice records used to derive allocations without mutating them; `student` is required for the existing mobility event and same-school notices; `principal` is the established fallback reviewer role when no role list is configured. No application-code finding is added or authorized.

## Golden Questions

- **WHO?** SV1-MOBILITY owns the feature; the operator reviews this decision and separately authorizes any database apply.
- **WHAT?** Add a confirmation step, local record PDFs, tenant-local notices, advisory-only gateway output, and immutable placement-based fee allocation snapshots.
- **WHERE?** This ADR records the decision; the new migration records database mechanics; the Scholar screen and mobility modules implement the user-facing behavior and tests.
- **WHY?** Issue #260 requests the residual V1 mobility scope while preserving tenant isolation and human approvals.
- **UNDER WHICH POLICY?** AGENTS.md §§17, 19–21, 26, 28, 45; issue #260; ADR-013; and ADR-004's separately documented migration-neutrality exception mechanism.

## UNKNOWNs

- **Operator review:** The operator must ratify or reject this ADR; until then the record remains proposed.
- **Migration application:** The database owner must review and separately authorize application; this change does not apply the migration.
- **Unmatched fee terms:** Finance must normalize source term/session data before a fee with no matching academic period can receive an allocation.
- **Provider operation:** AI provider configuration and live inference are not established by this code change.
