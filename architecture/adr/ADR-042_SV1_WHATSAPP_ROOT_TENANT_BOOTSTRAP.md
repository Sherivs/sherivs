# ADR-042: SV1 WhatsApp Root Tenant Bootstrap

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator review before production execution) |
|| Date | 2026-11-03 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #303) |
|| Mission | SV1 WhatsApp go-live (communications; V1 organizational capability) |
|| Capabilities | Existing tenant/org communications substrate |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md` §§13, 17, 26, 27, 30, 31, 37, 45; `database/supabase/migrations/20260904020000_coregrid_l2_identity_tenancy.sql:45-59`; `.github/workflows/sv1-wa-create-root-org.yml:27-43,52-96`; issue #303 (M008 boundary) |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

The production database check recorded in issue #303 found no `cg_tenant` row,
while the existing `sv1-wa-create-root-org` workflow requires an active root
tenant before it can create the Sherivs root organization. The tenant schema
requires an ID, tenant type, name, and unique slug; status and environment have
defaults that are not suitable for this production bootstrap. No account or
membership provisioning is needed for this prerequisite.

## Options

### Option 1 — Operator-supplied tenant ID (rejected)

Require an ID input at dispatch and use it to create the row.

- **Consequences:** It avoids a code-level identifier but creates a repeated
  operator choice that can drift across runs and makes the tenant's identity
  less deterministic.

### Option 2 — Fixed tenant ID and slug (ruled)

Use the fixed ID `3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201` and slug `sherivs`.
On rerun, verify that the sole matching tenant has the exact expected identity,
root status, and production environment; reject conflicts and duplicates.

- **Consequences:** Retries are deterministic and the operator can pass the
  emitted ID to the organization workflow. The identifier is a stable public
  reference, not a credential. A conflicting existing row requires human
  investigation rather than automatic selection.

## Recommendation (decision)

**Use the fixed tenant ID and slug. The manual-only workflow may create only one
`public.cg_tenant` row with `tenant_type='organization'`, `name='Sherivs'`,
`slug='sherivs'`, `status='ACTIVE'`, `parent_tenant_id IS NULL`, and
`environment='production'`; it must run behind the master/Production/typed
confirmation gates in one serializable transaction, roll back dry runs, verify
an exact existing row on retry, and refuse all ambiguous or conflicting rows.**

The workflow does not create organizational units, principals, memberships,
auth users, profiles, roles, invitations, or grants and changes no RLS,
permissions, or authentication behavior. This is a prerequisite bootstrap only;
M008 continues to prohibit self-service registration and account provisioning.

## Consequences (summary)

- **Positive:** The existing WhatsApp organization workflow receives a
  deterministic active root tenant and can be rehearsed before commit.
- **Negative / obligations:** Production execution remains explicitly gated;
  operators must review the printed tenant ID and run dry-run mode first.
- **For the wave/program specifically:** The SV1 communications workflow
  consumes the tenant row; tenant authorization and identity provisioning
  remain owned by existing systems and are not changed here.

## Golden Questions

- **WHO?** The SV1 communications operator runs the bootstrap; Production
  environment review gates writes.
- **WHAT?** Create or verify only the fixed ACTIVE Sherivs root tenant.
- **WHERE?** This decision is recorded here; the workflow and focused tests
  contain the mechanics and checks.
- **WHY?** The existing root-organization workflow cannot proceed without an
  active root tenant, and production currently has none.
- **UNDER WHICH POLICY?** AGENTS §§13, 17, 26, 27, 30, 31, 37, and 45; M008's
  no-self-service-registration and no-account-provisioning boundary.

## UNKNOWNs

- The operator must confirm the intended production database target and
  authorize the non-dry-run dispatch; the workflow does not run as part of this
  change.
- Any pre-existing tenant row that conflicts with the fixed identity must be
  investigated by the operator before retrying.
