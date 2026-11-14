# ADR-077: Entity Engine Person Passport and Membership Contexts

| Field                      | Value                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                        |
| Date                       | 2026-11-14                                                                                                                                                                                                                         |
| Author                     | Claude Code agent (ENGINE-01 implementation)                                                                                                                                                                                       |
| Creator                    | Claude Code agent, mission E-001 (epic: docs/engineering/ENTITY_ENGINE_EPIC.md)                                                                                                                                                    |
| Mission                    | ENGINE-01 (Entity Engine: person-level twin and agent, built from Role Packs)                                                                                                                                                      |
| Capabilities               | One twin per person across every membership; isolated per-membership contexts; automatic provisioning when a membership becomes active                                                                                             |
| Supersedes-in-part         | ADR-029 (twin scope: one per identity and tenant becomes one per person with contexts; `cg_personal_twin` retained until repoint)                                                                                                  |
| Cites                      | [ADR-029](./ADR-029_SV1_TWIN_PERSONAL_PROVISIONING.md); [ADR-030](./ADR-030_SV1_TWIN_ROLE_LENSES.md); [ADR-031](./ADR-031_SV1_TWIN_SLEEP_WAKE.md); [ADR-034](./ADR-034_SV1_TWIN_GATE.md); `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `cg_twin_person`, `cg_twin_context`, their policies, the provisioning functions and triggers, `tests/integration/engine01-person-twin.local.sql`                                                                                   |

## Context

ADR-029 binds a twin to an (identity, tenant) pair. A person with three memberships therefore holds three unrelated twins, and every new role means another twin, another agent and more wiring. The founder direction is the opposite: the twin and its agent belong to the PERSON, and each organization or platform role the person holds is only a context in which that twin acts. The same direction asks that a twin and an agent appear automatically for anyone who joins, including internal Sherivs staff. The risk this creates is cross-tenant leakage: one twin that spans tenants must never let one tenant's data surface while the person acts in another.

## Options

- **A. Keep one twin per (identity, tenant) (ADR-029).** Rejected: N twins and N agents per person, no shared personal core, and role changes create new twins.
- **B. An organization-owned twin.** Rejected: the person would lose their twin when a membership ends and the tenant would own personal memory.
- **C. One person twin with isolated membership contexts.** Chosen.
- **D. Provision at invitation time.** Rejected: an invited person is not yet a verified identity and has not consented. Provisioning follows the ACTIVE membership, which is still instant and automatic.

## Decision

1. `cg_twin_person` holds exactly one row per identity (unique `identity_id`). Its memory scope lives in the namespace `person:<identity>`, which can never equal a tenant id.
2. `cg_twin_context` holds one row per (twin, kind, tenant, role). Each context has its OWN memory scope bound to its tenant (`twin-context:<identity>:<tenant>:<role>`). Platform staff contexts use the tenant `sherivs-platform`.
3. Provisioning is automatic and idempotent. Database triggers on the membership table (insert, activation change, role change), on platform staff status and on platform staff roles call `cg_twin_ensure_context`. A membership that is inactive or an invitation not yet accepted creates nothing; activation creates the person twin (if absent), the context and shadow trust rows.
4. A provisioning failure never blocks the membership change. It is audited (`twin.provision.failed`), and `cg_twin_reconcile` repairs any gap. The failure record itself cannot raise.
5. Ending a membership suspends the context. Nothing is deleted: the person twin, memory and earned trust survive, and reactivation resumes them. A role change suspends the old context and ensures the new one.
6. A role with no published Role Pack still receives a context in `pending_pack`; publishing a pack binds it automatically (ADR-078).
7. Context data may enter the person's core only when the tenant's policy allows export AND the person consented, and restricted data never moves (`canFlowToCore`).
8. Row-level security forces each person to read only their own twin, contexts and trust. Clients cannot write. Provisioning functions are service-role only.
9. `cg_personal_twin` (ADR-029) is left untouched. The twin stack on #320 to #371 keeps working against it. A follow-up ADR will repoint it to contexts and retire the old table after a data move; this ADR does not drop or migrate it.

## Consequences

- A person has one twin however many organizations they join; each tenant sees only its own context.
- Adding a role needs no new twin code: a Role Pack is published and contexts bind to it.
- Existing members have no contexts until `cg_twin_reconcile` runs once after the migration is applied. That backfill is an operator action.
- The migration adds the `school_id` column reference to the membership trigger, which the neutrality guard flags; the quarantine entry is recorded in the baseline with this ADR (ADR-004).
- `cg_personal_twin` and `cg_twin_context` coexist until the follow-up repoint.

## Verification

- `tests/integration/engine01-person-twin.local.sql` on a disposable PostgreSQL 16 replay: guard on posture, pack invariants, activation provisioning, one twin across two memberships, idempotent reconcile, suspend and reactivate, pending pack binding, role change, platform staff invite versus activation, trust ladder guards, failure isolation and repair, and per-person row-level isolation. All pass.
- Seven deliberate mutants (open policy, trust guard removed, provisioning on invitation, no bind on publish, blocking trigger, client write grant, pack guard removed) each make the harness fail.
- `npx vitest run tests/unit/twin-engine-*.test.ts` covers the pure rules, including parity checks against this migration.
