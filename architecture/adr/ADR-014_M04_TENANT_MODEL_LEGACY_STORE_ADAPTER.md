# ADR-014: M04 Extends the Existing Organization Tenant Store (COND-003)

|| Field | Value |
||---|---|
|| Status | PROPOSED (draft implementation; operator ratification requested; no production database changes authorized) |
|| Date | 2026-11-02 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #183) |
|| Mission | M04 / issue #183 (V1 organizational tenancy) |
|| Capabilities | V1 organization, campus, shift, and authority-link model |
|| Supersedes-in-part | None |
|| Cites | ADR-004, ADR-012; `architecture/coregrid-mvp-architecture/adr/ADR-013_MULTIMEMBERSHIP_LEGACY_STORE_EXTENSION.md`; `architecture/coregrid-mvp-architecture/adr/ADR-014_M009_ROLE_ENGINE_LEGACY_TENANT_ADAPTER.md`; issues #175 and #183; `AGENTS.md` §§17, 26, 28, 38, 45; `database/supabase/migrations/20261008000050_coregrid_organization_memberships.sql`; `database/supabase/migrations/20261024000260_sherivs_019_wallet_ndpa_campus.sql`; `database/supabase/migrations/20261024000280_sherivs_021_scope_sets_authz_onboarding.sql`; `database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql` |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

The M04 issue requires an organization → campus → shift hierarchy, tenant-scoped
authority links, and reuse of the existing membership helpers. The active V1
identity store is `organization_memberships`, while the existing hierarchy is
represented by `schools`, `campuses`, and `school_shifts`. M009-A1 already
validates campus and shift assignment scopes against those existing tenant
tables. The separate neutral tenant substrate remains outside the active
identity/RLS path; switching M04 to it would create a second tenant authority.

The neutrality guard scans every SQL migration and reports the existing tenant
contract's vocabulary. ADR-004 requires a dedicated ADR before adding any
baseline entry. M04 must preserve the live V1 tenant contract without creating
new universal TypeScript domain vocabulary or widening access.

## Options

### Option 1 — Re-key M04 to the neutral tenant substrate (rejected)

Create a new tenant path on the neutral `cg_*` substrate and use it for the
hierarchy and authority links.

- **Consequences:** This would avoid references to the legacy tenant contract,
  but that substrate is not the active tenant RLS store and the conversion is
  outside the assigned V1 scope. It would create split tenant authority and
  violate the additive-only requirement.

### Option 2 — Obscure legacy identifiers to satisfy the neutrality scan (rejected)

Construct identifiers dynamically or route queries through opaque SQL.

- **Consequences:** This could hide scanner matches, but would reduce
  inspectability and make tenant predicates harder to audit. It is not a valid
  substitute for the existing membership helpers.

### Option 3 — Extend the live tenant adapter and record the narrow migration exception (proposed)

Reuse `schools`, `campuses`, `school_shifts`, and the membership helper, and
record the unavoidable migration-only vocabulary under this ADR.

- **Consequences:** This preserves one active tenant authority, current RLS
  semantics, and existing role-scope IDs. The migration remains visibly
  quarantined until the authorized neutral-tenant conversion; it adds no
  TypeScript exception and no production apply.

## Recommendation (decision)

**Use Option 3 for M04, subject to operator ratification.** Preserve the
existing V1 organization/campus/shift tables and membership helpers, enforce
same-tenant campus-parent references for shifts, and keep authority links
tenant-scoped, forced-RLS, effective-dated, evidence-gated, and actor-audited.
Only the new SQL migration's observed legacy tenant vocabulary may be added to
the neutrality baseline under this ADR; the guard itself and its behavior must
not change.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** The deployed identity schema still uses legacy
  organization identifiers and helper names.
- **The sharpest instance:** The M04 migration must name those contracts to
  preserve referential integrity and tenant RLS.
- **The accepted rationale:** The existing identity store is the active V1
  authorization authority; a parallel tenant system would be less safe.
- **Owner of the residual risk:** The V1 tenancy owner; the baseline entries
  must be removed with the authorized tenant-substrate conversion.

## Consequences (summary)

- **Positive:** M04 keeps one tenant identity source, and the campus/shift
  relationship becomes database-enforced without rewriting earlier migrations.
- **Negative / obligations:** The M04 migration's baseline entries remain
  visible as warnings and must be removed with the future authorized conversion.
  Authority candidates are not seeded without source-backed material.
- **For the wave/program specifically:** M04 provides the hierarchy reader and
  auditable authority-link store consumed by role assignments; it does not
  enable authority-scoped role assignments.

## Golden Questions

- **WHO?** M04 implements the V1 organizational model; the operator ratifies
  this ADR and approves any future tenant-substrate conversion.
- **WHAT?** Reuse the current tenant adapter and record only the migration
  vocabulary it necessarily requires.
- **WHERE?** This ADR records the decision; the new migration and rollback
  implement it; the neutrality baseline records the observed migration hits.
- **WHY?** Issue #183 requires current membership helpers, and the active
  identity store remains the V1 tenant authority.
- **UNDER WHICH POLICY?** AGENTS §§17, 26, 28, 38, 45; ADR-004's baseline-growth
  mechanism; the M04 issue's additive migration and tenant-isolation constraints.

## UNKNOWNs

- Operator ratification of this proposed ADR and its narrowly scoped baseline
  exception remains open; no production apply is authorized.
- Source-backed authority candidates and legal bases remain unverified and
  unseeded; the data owner must provide evidence before adding candidate rows.
- The neutral-tenant conversion remains governed by its own explicit
  authorization and migration plan.
