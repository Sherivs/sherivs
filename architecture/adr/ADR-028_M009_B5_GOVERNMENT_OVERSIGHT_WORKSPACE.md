# ADR-028: Oversight Roles Require Verified Authority and the Workspace Shows Aggregates Only (M009 Stage B-5)

| Field | Value |
|---|---|
| Status | PROPOSED (operator review required before production rollout) |
| Date | 2026-11-13 |
| Author | Claude (M009 Stage B-5 build) |
| Creator | Claude Code agent, mission B-005 (issue #284) |
| Mission | M009 Stage B-5 — Government Education Oversight workspace |
| Cites | ADR-024 (verified authority gate); ADR-025; `database/supabase/migrations/20261103153000_sherivs_m009_b5_oversight_authority_gate.sql`; `tests/integration/m009-b5-authority.local.sql`; `frontend/src/lib/workspaces/government-oversight.ts` |
| Minimal ownership artifact | This ADR, the B-5 migration with rollback, and the oversight spec |

## Context

Oversight roles (ministry, board, inspectorate and agency officers) must see aggregated data by default, scoped to a mandate that is backed by a **verified** institution-authority link. No oversight access may exist for unverified or invented relationships, and the reporting stage is out of scope. B-1 (ADR-024) added the gate (`role_catalog.requires_verified_authority_link`) but flagged only executive roles; the 68 roles on the `regulator` and `regulator_inspector` templates were unflagged.

## Options

1. **Client-side hiding only** — rejected: a view cannot make an assignment ineligible.
2. **Per-role flag list in the migration** — rejected: it would miss roles added later to those templates.
3. **Flag by template, plus an aggregate-only view (retained)** — one forward-only `UPDATE` flags every global role on the two oversight templates. The workspace shows one metric per authorized widget and forbids every widget that can carry identifiable learner, health, counselling or incident data.

## Recommendation (decision)

Adopt option 3. The migration inserts, seeds and grants nothing; it only makes oversight assignments depend on the B-1 gate. Production has no oversight assignments (read-only check 2026-11-13), so no existing access changes. The migration depends on the B-1 migration and fails with a clear error if it is absent.

## Consequences

- **Positive:** The harness proves the defect before the fix (68 of 68 oversight roles unflagged) and the fix after (denials for unverified, expired, not-yet-effective, wrong-tenant, missing, ambiguous and malformed evidence; allowed with an independent verified link; revoked when the link reverts), plus a mutation check. The rollback was applied and the migration re-applied on the scratch database.
- **Negative:** Until authority links are verified by an independent party, nobody can hold an oversight role. That is the intended fail-closed behaviour.
- **Not done:** The mandate scope per authority (which institutions an authority may see) is not modelled here; the workspace relies on the existing tenant-scoped widget feed. Backend end-to-end tests (visibility, notification, audit) need a non-production Supabase stack and were not run. Nothing was applied to production.

## Golden Questions

- **WHO?** M009 Stage B-5 owns the gate and view; the operator ratifies both.
- **WHAT?** Oversight templates become authority-dependent; the view is aggregate-only.
- **WHERE?** One migration with rollback, the spec, the local harness and unit tests.
- **WHY?** A mandate must be verified, and aggregates are enough for oversight by default.
- **UNDER WHICH POLICY?** AGENTS identity versus authorization, privacy by default, honesty rules.

## UNKNOWNs

- Mandate scoping across multiple institutions for one authority.
- Whether authority verification must become operator-only (open in ADR-024).
- Operator ruling: unratified until reviewed.
