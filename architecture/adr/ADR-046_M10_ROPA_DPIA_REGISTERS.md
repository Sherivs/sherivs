# ADR-046: V1 Tenant-Scoped ROPA and DPIA Registers (M10)

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator ratification and owner review remain required; no production database changes authorized) |
|| Date | 2026-11-04 |
|| Author | GitHub Copilot Coding Agent (M10 / issue #189) |
|| Creator | copilot-swe-agent[bot] |
|| Mission | M10 (V1 organizational privacy registers) |
|| Capabilities | V1 organizational ROPA and DPIA registers |
|| Supersedes-in-part | None |
|| Cites | Issue #175 and #189; `AGENTS.md` §§13, 16–19, 26–28, 31, 38, 42, 45; `database/supabase/migrations/20261024000260_sherivs_019_wallet_ndpa_campus.sql:297-302,323-340`; `database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql:468-502`; `database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql:775-783,1133`; `database/supabase/migrations/20261104012000_sherivs_m10_ropa_dpia_register.sql`; `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json` |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

The V1 database already has a tenant-bound `dpia_records` table with processing
activity, data categories, risk level, mitigations, preparer and approval fields.
Its existing approval function permits broad NDPA/admin permissions rather than
requiring the assigned DPO role, and the schema does not record an explicit risk
list or a dedicated DPIA sign-off audit event. There is no complete ROPA register
covering purpose, data subjects/data, recipients, transfers, retention reference
and security measures.

The existing M04 tenant authority and M009 role engine are the active contracts;
the exact catalog role `ng.data_protection_officer_dpo` already exists. The
CoreGrid execution boundary limits this work to the V1 organizational envelope.
No live database apply is authorized.

The existing DPIA record and tenant boundary use the legacy Scholar store.
Migration SQL must name those tables, columns and helpers to preserve the
existing RLS contract, so its observed vocabulary is migration-only and is
recorded under this ADR in the neutrality baseline. No universal TypeScript
surface receives domain vocabulary or new tenant authority.

## Options

### Option 1 — Create a second DPIA table (rejected)

Add a new DPIA table alongside `dpia_records`.

- **Consequences:** This avoids changing the legacy row shape, but splits the
  existing compliance surface and leaves consumers of `dpia_records` with a
  second, inconsistent DPIA record of truth.

### Option 2 — Extend existing DPIA records and add a ROPA register (proposed)

Add the risk-list field and strict DPO sign-off to `dpia_records`; add a separate
ROPA table for the distinct processing-activity record. Use forced RLS,
authenticated-only RPC writes, and immutable audit events. Global ROPA seed rows
are synthetic and explicitly require owner review.

- **Consequences:** Existing DPIA records and consumers remain in place, while
  the owner-review state and DPO action are enforceable. The migration must
  replace the prior broad approval path and preserve the existing table's
  tenant policy and audit trigger behavior. Only the SQL migration's observed
  legacy tenant/domain terms are quarantined under this ADR; the guard remains
  strict on all other files and vocabulary.

### Option 3 — Store both registers in application-managed files (rejected)

Keep register entries outside the tenant database and rely on the UI to enforce
scope.

- **Consequences:** This avoids schema work but would violate the mandatory
  database tenant boundary, make isolation non-auditable and leave the DPO
  approval gate outside the canonical authorization layer.

## Recommendation (decision)

**Use Option 2 for the ACTIVE-V1 organizational capability.** Tenant rows remain
bound to the caller's resolved organization; global ROPA rows are visible only
to platform super-admins. The exact effective DPO role is required for DPIA
sign-off, and the sign-off plus export actions are recorded in an append-only
register audit table within the same database transaction. All writes use
authenticated RPCs with an empty `search_path`; direct API table writes remain
revoked. Platform seed entries contain synthetic descriptions and require owner
review before they are treated as verified processing facts.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** Seed descriptions are placeholders, not an assertion
  that any particular data flow, recipient, transfer or retention period is
  verified.
- **The sharpest instance:** An owner could mistake a synthetic platform entry
  for a completed legal inventory without completing its review flag.
- **The accepted rationale:** The issue requires a seed to make the register
  reviewable, while the Constitution prohibits fabricated facts.
- **Owner of the residual risk:** The platform privacy owner and each tenant's
  controller/DPO must verify and correct entries before operational reliance.

## Consequences (summary)

- **Positive:** The existing DPIA store remains canonical, cross-tenant access
  is database-enforced, only the assigned DPO can sign off, and each signature
  and export has an immutable audit record.
- **Negative / obligations:** Owners must review synthetic platform entries;
  tenants must provide accurate purpose, categories, recipients, transfers,
  retention references, security measures, risks and mitigations.
- **For the wave/program specifically:** M10 consumes the M04 tenant model and
  M009 role engine and does not change authentication, onboarding, tenant
  creation, frozen V2/V3 scope, or production state.

## Golden Questions

- **WHO?** M10 owns the register implementation; a tenant's assigned DPO signs
  off its DPIAs; platform owners review platform ROPA placeholders.
- **WHAT?** V1 processing and DPIA registers use the existing tenant and role
  contracts with database-enforced isolation and attributed audit.
- **WHERE?** This decision is here; schema and RPCs are in the reserved M10
  migration; rollback and local-only SQL acceptance tests accompany it.
- **WHY?** Issue #189 requires tenant and platform registers, DPO-only audited
  DPIA sign-off, owner-reviewable synthetic ROPA seeds and export.
- **UNDER WHICH POLICY?** Issue #175 non-negotiables; AGENTS §§13, 16–19,
  26–28, 31, 38, 42, 45; the existing M04 tenant contract and M009 DPO role;
  no-live-database and forward-only migration constraints.

## UNKNOWNs

- Operator ratification and application of the migration remain unapproved.
- Platform seed text, recipients, transfers, retention and security measures
  remain unverified until the platform owner completes its review.
- Each tenant controller/DPO must supply and review that tenant's lawful
  processing facts before relying on its register or DPIAs.
