# ADR-013: SV1 Student Mobility Extends the Legacy Scholar Store

| Field                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (issue #249 authorizes the V1 feature; neutrality-baseline exception awaits operator ratification)                                                                                                                                                                                                                                                                                                                  |
| Date                       | 2026-11-01                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Author                     | SV1-MOBILITY implementation                                                                                                                                                                                                                                                                                                                                                                                                  |
| Creator                    | `copilot-swe-agent[bot]`                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mission                    | SV1-MOBILITY (Scholar runtime; V1 organizational capability)                                                                                                                                                                                                                                                                                                                                                                 |
| Capabilities               | Student promotion, transfer, and lifecycle mobility (issue #249)                                                                                                                                                                                                                                                                                                                                                             |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Cites                      | Issue #249; `database/supabase/migrations/20261101110000_sv1_student_mobility.sql`; `database/supabase/migrations/20261101120000_sv1_student_mobility_bulk.sql`; `frontend/src/lib/scholar/progression.ts`; `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`; ADR-004; `architecture/coregrid-mvp-architecture/adr/ADR-013_MULTIMEMBERSHIP_LEGACY_STORE_EXTENSION.md`; AGENTS.md §§17, 26, 28, 38, 45 |
| Minimal ownership artifact | This ADR only — a decision artifact                                                                                                                                                                                                                                                                                                                                                                                          |

## Context

Issue #249 authorizes V1 student mobility in the existing Scholar model. The
additive migrations record immutable placement snapshots, requests, approvals,
mobility events, finance links, consented transfer imports, eligibility previews,
and atomic bulk requests. They extend the existing `students` row for
compatibility and use the existing `school_id`, `get_my_school_id()`,
`scholar_can()`, and Scholar tables for tenant identity, authorization, and
historical academic data. The original migration's RLS policies are enabled and
forced; direct table writes are revoked from client roles, and mutation is
exposed through permission-checked functions. The follow-up migration adds
permission-checked RPCs and grants no direct table access.

The domain-neutrality guard scans every SQL migration. Its live scan observes
new `(kind, file, token)` groups in these migrations. The existing
neutral-tenant substrate is not the active Scholar identity/RLS store, and its
conversion remains outside this additive V1 feature. The guard's baseline
ratchet policy normally allows removals only; ADR-004 requires a separate ADR
for an authorized extension. Issue #249 authorizes the feature, but does not by
itself ratify a neutrality-policy exception or authorize applying the migration
to a database.

## Options

### Option 1 — Convert Scholar to the neutral tenant substrate first (rejected)

Move the live student, academic, and finance data and their RLS predicates to
the neutral tenant model before implementing mobility.

- **Consequences:** This would reduce future legacy-store coupling, but requires
  a tenant conversion and data migration outside the V1 mobility issue. The
  substrate is not the active Scholar authorization store, so using it now would
  risk breaking tenant isolation and violate the additive-only database
  constraint.

### Option 2 — Hide or suppress the observed vocabulary (rejected)

Construct identifiers dynamically, weaken the guard, or omit the observed
groups from its report.

- **Consequences:** This could make the guard pass without a baseline extension,
  but would obscure the actual schema and authorization dependencies. It would
  undermine review and the Constitution's auditability and security
  requirements (AGENTS.md §§17, 18, 30).

### Option 3 — Record a narrow, temporary baseline exception (proposed)

Keep the migrations on the current Scholar store and record only the observed
groups for these named migrations, with this ADR as their provenance.

- **Consequences:** This preserves the active tenant/RLS contract and makes the
  exception visible to CI and reviewers. It also retains domain-specific
  migration vocabulary in the shared migration directory until tenant-store
  conversion; the exception must be removed when that conversion replaces this
  adapter.

## Recommendation (decision)

**Use Option 3, subject to operator ratification of the baseline exception.**
The baseline may contain only the observed groups for
`20261101110000_sv1_student_mobility.sql` and
`20261101120000_sv1_student_mobility_bulk.sql`, with current hit counts and
lines and a reference to this ADR. Do not suppress further findings, add
unrelated files, change the neutrality guard, or grant broader privileges.
Keep RLS forced, mutation permission-checked, cross-organization imports
consented and separate, and the migration unapplied absent explicit database
authorization.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** Mobility remains coupled to Scholar's legacy
  `school_id` tenant identity and domain-specific public-schema migration.
- **The sharpest instance:** The neutral-tenant conversion may require adapting
  these placement, request, and finance-link records and their RLS predicates.
- **The accepted rationale:** The existing Scholar identity/RLS store is the
  active V1 contract; issue #249 authorizes this additive feature, while
  conversion is separate work.
- **Owner of the residual risk:** The Scholar runtime and the future
  neutral-tenant conversion owner; the latter must remove these exact baseline
  entries when it replaces this adapter.

## Consequences (summary)

- **Positive:** The V1 mobility migration can be evaluated by the existing
  neutrality guard without hiding its legacy-store dependencies.
- **Negative / obligations:** The baseline records the observed groups for both
  migrations. Any changed line counts require refreshing the entries; new
  groups need separate review. This ADR does not authorize applying migrations, AI
  recommendations, autonomous decisions, or V2/V3 scope.
- **For the wave/program specifically:** SV1-MOBILITY owns the feature
  implementation; the operator owns ratification of this neutrality exception
  and any database-apply authorization.

## Golden Questions

- **WHO?** SV1-MOBILITY owns the V1 feature; the operator rules this proposed
  exception; the neutral-tenant conversion owner retires it.
- **WHAT?** Quarantine only the two migrations' observed neutrality groups,
  pending operator ratification.
- **WHERE?** This ADR records the decision; the baseline records exact groups;
  the two migrations and progression module implement the mechanics and tests.
- **WHY?** Issue #249 extends the active Scholar store, whose required domain
  vocabulary is detected by the migration-wide neutrality guard.
- **UNDER WHICH POLICY?** AGENTS.md §§17, 26, 28, 38, 45; ADR-004's new-ADR
  baseline-extension mechanism; and the V1 authorization in issue #249.

## UNKNOWNs

- **Operator ratification:** The operator must approve or reject this
  neutrality-baseline exception; until then it remains proposed.
- **Database integration:** A database-backed migration/integration test has
  not run. The database owner must validate the migration against the deployed
  schema before any separately authorized apply.
- **Retirement:** The neutral-tenant conversion owner must remove these
  migration entries in the same change that replaces this legacy adapter.
