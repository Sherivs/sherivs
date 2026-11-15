# ADR-078: Entity Engine Role Packs and Earned Autonomy

| Field                      | Value                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                        |
| Date                       | 2026-11-14                                                                                                                                                                                                                         |
| Author                     | Claude Code agent (ENGINE-01 implementation)                                                                                                                                                                                       |
| Creator                    | Claude Code agent, mission E-001 (epic: docs/engineering/ENTITY_ENGINE_EPIC.md)                                                                                                                                                    |
| Mission                    | ENGINE-01 (Entity Engine: person-level twin and agent, built from Role Packs)                                                                                                                                                      |
| Capabilities               | Versioned declarative Role Packs compiled into twin contexts and agent specs; autonomy earned one rung at a time from evidence                                                                                                     |
| Supersedes-in-part         | None                                                                                                                                                                                                                               |
| Cites                      | [ADR-029](./ADR-029_SV1_TWIN_PERSONAL_PROVISIONING.md); [ADR-030](./ADR-030_SV1_TWIN_ROLE_LENSES.md); [ADR-031](./ADR-031_SV1_TWIN_SLEEP_WAKE.md); [ADR-034](./ADR-034_SV1_TWIN_GATE.md); `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/twin-engine/{role-pack,engine,autonomy-ladder,passport-view,pack-registry.server}.ts`, `cg_role_pack`, `cg_twin_trust`                                                                                           |

## Context

The twin and agent for each role must be produced by an engine, not hand-wired per feature, and an agent must not hold authority it has not earned. The JARVIS risk policy (ADR-035) already defines tiers T0 to T4; role lenses (ADR-030) already narrow authority by intersection.

## Options

- **A. Hand-code each role's agent.** Rejected: it does not scale and drifts.
- **B. Store packs as free configuration.** Rejected: nothing would stop an unsafe declaration.
- **C. Versioned, validated, immutable Role Packs plus an earned-trust ladder.** Chosen.

## Decision

1. A Role Pack declares permissions, capabilities (id, tier, autonomy, required permission, optional connector and approver), playbooks, memory domains, a budget and an escalation policy. It is a CEILING: effective permissions are always the intersection with the server-resolved role assignment (ADR-030).
2. Hard rules enforced both by the TypeScript validator and by a database guard: T4 is never declarable; tenant packs stop at T2 and platform packs at T3; autonomous is allowed only up to T1; T3 requires approval and never by the role owner; cross-tenant memory is never declarable; every pack starts in shadow.
3. Published packs are immutable and versioned; a published version can only be retired, and a new version must exceed the old.
4. Every capability starts in SHADOW: it proposes, logs and executes nothing. Autonomy climbs shadow, propose, assist, autonomous, one rung at a time, only on fresh evaluation evidence that clears a bar (20, 50 and 200 samples at 90, 95 and 98 percent) with no regressions. A regression or a pass rate below 90 percent demotes at once.
5. T3 can never be autonomous. A T2 capability becomes autonomous only if the pack marks it promotable AND the sheriff recorded an explicit promotion. A kill resets to shadow and drops promotions.
6. Effective autonomy is computed, never stored: the lower of the pack declaration and the earned state, with the tier caps applied. The database trust guard enforces the one-rung and T2/T3 rules even against the service role.
7. Packs bind to contexts by `appliesTo` (membership role codes). A context keeps its bound version; changing it is a deliberate rebind.

## Consequences

- Adding a role is publishing a validated pack; the engine compiles lens, agent spec and trust rows.
- A pack that violates a rule cannot be published, even by a service-role writer.
- Autonomy is evidence-gated and reversible, which makes the eval harness (a later mission) a hard dependency for any agent to act.
- The ladder thresholds are policy numbers recorded here; changing them needs a new ADR.

## Verification

- 70 unit tests across `tests/unit/twin-engine-*.test.ts`, including mutation cases for every validator rule and a seeded property test over 400 random evidence sequences. The property test caught a defect during development (a demotion kept the sheriff promotion) which is fixed.
- Database parity tests pin the ceilings in the migration to the TypeScript constants.
- The disposable-database harness proves the trust guard rejects skipped rungs, T3 autonomy and T2 autonomy without a promotion.
