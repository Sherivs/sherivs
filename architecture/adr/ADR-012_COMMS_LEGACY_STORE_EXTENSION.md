# ADR-012: V1 Communications Extends the Legacy Organization Store (COND-003)

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification requested) |
| Date | 2026-11-01 |
| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #221) |
| Mission | Issue #221 — scope-locked V1 communications |
| Capabilities | V1 organizational communications; V1CAP-067 (domain-neutrality guard) |
| Supersedes-in-part | None |
| Cites | ADR-004; ADR-012/ADR-013 in `architecture/coregrid-mvp-architecture/adr/`; AGENTS.md §§17, 26, 28, 38, 45; `database/supabase/migrations/20261024000270_sherivs_020_comms_results_admissions.sql`; issue #221 |
| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

The live V1 identity store binds organization membership and communication records through `schools.id`, `school_id`, and `get_my_school_id()`. Issue #221 requires the existing communication tables to gain an explicit `org_id` while retaining `school_id` where relevant; the scope-lock migration keeps both identifiers bound by checks, forced RLS, recipient validation, and server-side authorization.

The domain-neutrality guard scans every SQL migration and flags legacy `school_id`, `school`, `student`, and `get_my_school_id` vocabulary. The new additive communications migration produces 62 hits in four `(kind, file, token)` groups. These references describe the existing V1 data contract; they do not add domain code to the universal TypeScript surface. ADR-004 requires a dedicated ADR for baseline growth, and ADR-012/ADR-013 in the CoreGrid MVP architecture directory establish the migration-quarantine precedent.

The neutral tenant substrate remains separate. Its UUID/text conversion is unresolved under COND-003 and is outside this V1 issue; V2/V3 and future-unassigned work remains frozen under AGENTS.md §45.

## Options

### Option 1 — Move communications onto the neutral tenant substrate now (rejected)

This would avoid the legacy vocabulary in a new migration.

- **Consequences:** It would cross the unresolved tenant-ID conversion boundary and move live V1 RLS away from its existing identity store. That migration is not authorized by issue #221 and conflicts with the V1 execution boundary.

### Option 2 — Obfuscate legacy identifiers or rewrite an applied migration (rejected)

This would hide the guard hits or attempt to make the new behavior appear in an older migration.

- **Consequences:** SQL string construction would undermine observability and the guard's purpose. Rewriting an already-applied migration would not reliably update deployed databases and would violate migration history.

### Option 3 — Keep the additive V1 migration and record its legacy vocabulary (proposed)

Retain the live `school_id` bindings, add the explicit `org_id` mirror and its constraints, and link only the four observed groups to this ADR in the neutrality baseline.

- **Consequences:** This keeps the migration additive and the V1 tenant boundary enforceable. The baseline continues to warn on the legacy vocabulary until a separately authorized neutral-tenant conversion can remove it.

## Recommendation (decision)

**Use Option 3.** This proposed decision authorizes only the four observed domain-neutrality baseline groups for `20261101001000_sherivs_033_communication_scope_lock.sql`. It does not authorize a tenant-model conversion, production database changes, new direct table-write grants, or V2/V3 functionality. The migration must continue enforcing `org_id = school_id`, forced RLS, verified recipient membership, and governed proposal/approval RPCs.

## Consequences (summary)

- **Positive:** The communications fabric can bind message rows to an explicit organization without rewriting the active V1 identity store or weakening recipient and RLS checks.
- **Negative / obligations:** The migration's four legacy-vocabulary groups remain visible in the guard's warning output and must be removed with the neutral-tenant conversion, not silently deleted from the baseline.
- **For the issue:** Implementation remains classified as V1 organizational capability; this ADR does not authorize deployment or live provider enablement.

## Golden Questions

- **WHO?** Issue #221 implements the V1 communication scope lock; the operator rules this proposed ADR; the future authorized tenant-conversion owner removes the baseline entries.
- **WHAT?** Retain the live V1 identity binding while recording the migration's four necessary legacy-vocabulary groups.
- **WHERE?** This ADR and its referenced entries in `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`.
- **WHY?** The existing communication and membership tables remain keyed to `schools.id`; issue #221 requires an additive organization binding, not a tenant-model conversion.
- **UNDER WHICH POLICY?** ADR-004's ADR-for-baseline-growth mechanism, ADR-013's legacy-store migration precedent, and AGENTS.md §§17, 26, 28, 38, 45.

## UNKNOWNs

- **Operator ratification:** The operator must approve, amend, or reject this proposal; no production database action is authorized by this ADR.
- **Baseline removal:** The future owner of the neutral-tenant conversion removes these four entries in the same change that removes the legacy bindings, after explicit authorization and COND-003 resolution.
