# ADR-079: Entity Engine Internal AI Workforce Role Packs

| Field                      | Value                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                        |
| Date                       | 2026-11-14                                                                                                                                                                                                                         |
| Author                     | Claude Code agent (ENGINE-01 implementation)                                                                                                                                                                                       |
| Creator                    | Claude Code agent, mission E-001 (epic: docs/engineering/ENTITY_ENGINE_EPIC.md)                                                                                                                                                    |
| Mission                    | ENGINE-01 (Entity Engine: person-level twin and agent, built from Role Packs)                                                                                                                                                      |
| Capabilities               | One department agent pack per internal platform role; common operating model; every internal staff member gets a twin context automatically                                                                                        |
| Supersedes-in-part         | None                                                                                                                                                                                                                               |
| Cites                      | [ADR-029](./ADR-029_SV1_TWIN_PERSONAL_PROVISIONING.md); [ADR-030](./ADR-030_SV1_TWIN_ROLE_LENSES.md); [ADR-031](./ADR-031_SV1_TWIN_SLEEP_WAKE.md); [ADR-034](./ADR-034_SV1_TWIN_GATE.md); `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/twin-engine/packs/platform-workforce-packs.ts`                                                                                                                                                                   |

## Context

Sherivs staff are people too: each should get a twin and an agent on the same engine as customers, and the internal AI workforce needs a professional operating design rather than ad hoc prompts. The platform-staff migration already defines internal roles with capability strings.

## Options

- **A. A separate internal agent framework.** Rejected: two engines, two permission models.
- **B. The same engine, platform-kind packs.** Chosen.

## Decision

1. One pack per internal role that is not human-only: support, engineering, security, finance, sales and operations. `platform_admin` and super admins stay human-only.
2. Permissions are exactly the capability strings seeded for the role in the platform-staff migration (checked by a test).
3. Operating model common to every department agent: wake on an event or schedule, run the playbook, sleep; observe and draft freely (T0); make reversible internal changes (T1); route customer-visible or externally effective actions (T2) to platform staff and financial, public-posting, production and credential actions (T3) to the sheriff; hand off through work orders and write a shift report each run.
4. Connectors are named, never credentialed (`whatsapp`, `email`, `github`, `crm`, `payments`, `social`); a pack cannot hold a secret. The tool broker (ADR-081) is the only path to an external system.
5. Every pack starts in shadow and earns autonomy under ADR-078.

## Consequences

- Staff gain a twin context when their staff record becomes active, with the department agent bound automatically.
- Departments without a pack (and future ones) wait as `pending_pack`.
- The packs reference connectors that do not exist yet; until the broker lands they can only run in shadow, which is the intended state.

## Verification

- Pack validation, tier ceilings, sheriff routing of every T3 capability, playbook integrity and the permission cross-check against the migration are covered by `tests/unit/twin-engine-role-pack.test.ts`.
- The disposable-database harness proves a staff invitation creates nothing and activation creates the platform context on the same person twin.
