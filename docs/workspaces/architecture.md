# Workspace role engine

## Boundary

This V1 engine composes role templates, scoped assignments, responsibilities,
permissions, and approval authority. It is not a new identity or tenant system:
institution membership remains canonical in `public.organization_memberships`,
with active context in `public.users`; assignments remain in
`public.user_role_assignments`. Permission enforcement continues through
`public.effective_permissions`, `public.has_permission`, `public.scholar_can`,
and RLS. A workspace manifest is a projection of active assignments, not an
authorization grant.

The shared TypeScript contract is
`frontend/src/lib/workspaces/contract.ts`. The pure manifest resolver is
`frontend/src/lib/workspaces/manifest-resolver.ts`. Database changes are in
`20261101000010_sherivs_m009_a1_role_responsibility_engine.sql`; the paired
rollback retains the append-only assignment audit events.

## Assignment and permission flow

1. An authorized HR/Admin assigns an existing role through a security-definer
   RPC. Custom roles continue to use the existing `role_create_custom` RPC.
2. The database validates active tenant membership, role-template scope ceilings,
   effective dates, org-unit ownership, and scope references. `lga` and
   `authority` scopes are rejected until a verified authority-link contract is
   implemented; this migration does not create authority links.
3. Core/custom responsibilities contribute their registered, non-protected
   permissions. An add-on contributes permissions only while its effective
   grant is active. Delegations inherit the source assignment's scope and
   expire no later than that assignment.
4. `effective_permissions` unions permissions across active assignments and
   active delegations. Missing identity, tenant, role, permission, scope, or
   effective window fails closed. Scoped grants require a matching scope in
   `has_permission`; a tenant-wide check accepts only an institution-scoped
   grant. Multi-dimensional scope sets require a complete resource check in
   the relevant RLS policy and are not flattened into a broad permission.
5. RLS continues to be the data boundary. A manifest or hidden navigation
   item never substitutes for the database permission check.

## Separation of duties and audit

Database triggers reject mutually exclusive permission combinations when a
role, permission setting, responsibility, assignment, add-on grant, or
delegation changes. Validation checks permission windows at every effective
start/end boundary, including future-dated assignments and delegations, so a
later activation cannot introduce a conflict without a mutation. The fixed
rules include finance entry/approval, grade-entry/result-publication,
cash/reconciliation, and auditor independence. A tenant/user transaction lock
serializes all SoD-changing mutations before their schedule is validated.
The grade publication trigger stamps the entry actor and prevents that actor
from publishing the same result.

Every role-engine mutation writes an event to
`public.role_assignment_audit_events` in the same transaction. The event records
actor, target, scope, before/after state, and transaction time. Direct writes
are revoked, and update/delete/truncate are blocked. Its events are retained by
the rollback.

## Scope and rollout

Supported assignment scopes include class, subject, campus, shift, institution,
and group. Legacy template scopes remain supported but cannot exceed the
template's declared scope. Authority scopes are represented in the contract and
schema but cannot be assigned without a verified link. No catalog rows, UI,
onboarding, or authority-link workflow are introduced here.

Migrations and rollback files are authored only; do not apply them to a live
database. Run `tests/integration/m009-a1-role-engine.local.sql` only against a
loopback disposable database after replaying the repository migrations.

## Release order

M009-A1 depends on SHERIVS-017, introduced by
`20261024000240_sherivs_017_role_permission_catalog.sql`. Release and verify
SHERIVS-017 in an approved non-production environment before applying M009-A1.
M009-A1 fails before changing schema when any required SHERIVS-017 object is
absent. Production application requires separate owner approval; this work
authorizes no live database changes.
