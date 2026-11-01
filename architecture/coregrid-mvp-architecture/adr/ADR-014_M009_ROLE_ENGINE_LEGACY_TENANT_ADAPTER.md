# ADR-014: M009 Role Engine Uses the Live Tenant Identity Adapter

| Field        | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Status       | PROPOSED (draft implementation; no production database changes authorized) |
| Date         | 2026-10-31                                                                 |
| Author       | M009-A1 role engine implementation                                         |
| Capabilities | V1 organizational role and responsibility management                       |
| Cites        | ADR-004, ADR-013, issue #176, AGENTS.md §§17, 26, 28, 38, 45               |
| Supersedes   | Nothing                                                                    |

## Context

M009-A1 adds scoped assignments, effective permissions, responsibility grants,
delegations, and audit records to the existing role system. The live tenant
identity and authorization model is still the legacy organization store:
`organization_memberships` records active affiliations, while existing tenant
RLS and permission helpers bridge into that store. The new migration therefore
references existing organization membership and scope tables, the current
tenant helper, and existing permission codes.

The neutral tenant substrate remains deliberately unapplied and its conversion
is frozen pending the relevant architecture authority. Re-keying live role
assignments onto it would exceed this V1 feature and violate the additive-only
database constraint. The migration must use the live membership and scope
contracts rather than invent a parallel tenant system.

## Decision

1. Quarantine the three observed neutrality-guard groups for
   `20261101000010_sherivs_m009_a1_role_responsibility_engine.sql` under this
   ADR: the legacy tenant-column reference (`school_id`), the current-tenant
   helper (`get_my_school_id`), and the existing permission code
   (`payroll.approve`).
2. These references are confined to the additive database adapter. The
   migration creates no new domain-neutrality exception in TypeScript and
   grants no direct client write access to the new tables.
3. Assignments and delegations require an active row in the existing
   organization-membership set. Effective permission resolution checks that
   membership again, so inactive memberships fail closed.
4. `lga` and `authority` remain unavailable until a verified-link contract is
   authorized. No migration is applied to a live database by this change.
5. Remove these baseline entries when the authorized neutral-tenant conversion
   replaces the live legacy adapter, in the same change that performs that
   conversion.

## Options considered

- **Move live role data onto the neutral substrate now:** rejected because the
  substrate is not the active tenant RLS store and its conversion is outside
  this V1 authorization.
- **Hide legacy identifiers through generated SQL or string construction:**
  rejected as obfuscation that would undermine schema clarity and review.
- **Use the live identity adapter and record the narrow exception:** adopted,
  following ADR-013's additive identity-store precedent.

## Security and operations

RLS remains enabled and forced for the new tables, direct client writes remain
revoked, and mutation RPCs retain existing authorization checks. This ADR does
not authorize a live database apply, additional privileges, or authority-scope
assignments. The entries are a visible, temporary integration debt rather than
a change to the domain-neutrality policy.
