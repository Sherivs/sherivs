# ADR-030: SV1 Personal Twin Role Lenses

| Field                      | Value                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                            |
| Date                       | 2026-11-13                                                                                                                                                             |
| Author                     | Claude Code agent (SV1-TWIN-02 implementation)                                                                                                                         |
| Creator                    | Claude Code agent, mission T-002 (issue #287)                                                                                                                          |
| Mission                    | SV1-TWIN-02 (authorization-bounded role lenses)                                                                                                                        |
| Capabilities               | TWIN-01 personal twin (ADR-029); existing role template catalog and permission ids; workspace resolution                                                               |
| Supersedes-in-part         | None                                                                                                                                                                   |
| Cites                      | [ADR-029](./ADR-029_SV1_TWIN_PERSONAL_PROVISIONING.md); [role template catalog](../../frontend/src/lib/scholar/roles/role-template-catalog.ts); AGENTS.md §§13, 16, 21 |
| Minimal ownership artifact | `frontend/src/lib/scholar/personal-twin/role-lens.ts` (pure functions); no migration, no table                                                                         |

## Context

A personal twin acts for a user who may hold several roles in several workspaces. It must act in one role context at a time, and it must never hold more authority than the user's current role grants there.

## Decision

A lens is derived, never stored. Its permissions are the intersection of what it requests and what the user's current assignment grants (supplied by the server from the role engine). An empty request means no permissions, never all. Persona is a validated label with no effect on authority. Scoped tools are available only when the lens holds the tool's required permission. Every resolution re-reads the current assignments, so removing a role removes its lens at once, a lens cannot resolve against another assignment's workspace, and a workspace switch builds a new context from the new selection only. Each lens has a distinct context key so twin memory scopes do not mix across roles.

## Consequences

- Positive: the subset law holds by construction and is checked by property tests over every real template.
- Not done here: the server function that supplies assignments, binding a context key to the `cg_memory_*` scope in TWIN-01's tables, and workspace-shell wiring (TWIN-05). No migration is created; the reserved block `20261103155000`-`20261103155999` is unused.

## Verification

`tests/unit/sv1-twin-role-lens.test.ts` (14 tests, including a 2000-case seeded property test), `tests/unit/role-template-catalog.test.ts` and the TWIN-01 suite pass. Mutation checks: removing the intersection, treating an empty request as all, ungating tools, ignoring the workspace match, sharing the context key, or skipping persona validation each fail tests.
