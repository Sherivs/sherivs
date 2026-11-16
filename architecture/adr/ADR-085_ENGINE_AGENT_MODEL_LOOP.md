# ADR-085: Per-Context Agent Model Loop (Draft-Only)

| Field                      | Value                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                              |
| Date                       | 2026-11-14                                                                                                                                                                                               |
| Author                     | Claude Code agent (ENGINE-07 implementation)                                                                                                                                                             |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                                           |
| Mission                    | ENGINE-07 (Per-context agent model loop, draft-only, through the existing AI gateway)                                                                                                                    |
| Capabilities               | One model turn per wake event that can only propose Role Pack capabilities; context-scoped memory; budget gates before any call; strict untrusted-output parsing; gateway-backed model port              |
| Supersedes-in-part         | None                                                                                                                                                                                                     |
| Cites                      | [ADR-078](./ADR-078_ENGINE_ROLE_PACKS_AND_EARNED_AUTONOMY.md); [ADR-081](./ADR-081_ENGINE_TOOL_BROKER_AND_CONNECTOR_VAULT.md); [ADR-083](./ADR-083_ENGINE_PLAYBOOK_RUNNER.md); `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/agent-loop/agent-loop.ts`                                                                                                                                                              |

## Context

The engine decides authority and routes work, but no model yet reasons for a context's agent. A loop that can act, read another context's memory or trust model text would undo the authority model.

## Options

- **A. A model loop that calls tools directly.** Rejected: bypasses the broker and the ladder.
- **B. A draft-only loop that returns proposals for the runner and broker to govern.** Chosen.

## Decision

1. A turn runs only if the kill switch is off, the context is active, and the pack's daily model-call budget and cost cap hold before the call. Refusals make no model call.
2. Memory comes only from the acting context: items from another context or tenant, a domain the pack does not declare, or above the pack's sensitivity ceiling are dropped and counted. The gateway's own persistent-memory retrieval is not engaged.
3. Memory and the instruction are fenced as untrusted data, delimiter characters are removed, and secret-shaped text is withheld before the prompt is built.
4. Model output must be strict JSON. Capability ids must exist in the pack, T4 capabilities can never be proposed, duplicates and extras are rejected, and rationales are withheld of secret-shaped text.
5. Proposals carry the required approver (T2 capability approver or pack default; T3 the pack's T3 approver) and are marked shadow notes while the capability is still in shadow. The result always states `executed: false`.
6. The model is reached only through the existing AI gateway (purpose workflow_assistance, agent identity as actor), which keeps provider choice, budgets and metering.

## Consequences

- The caller routes proposals through the playbook runner and broker; nothing here can cause an external effect.
- The loop does not persist turns, spend, or proposals. A caller must supply today's calls and spend and store results.
- Quality of proposals is not evaluated. Promotion on the ladder still needs evidence (ADR-078).

## Verification

- `tests/unit/agent-loop.test.ts` (20 tests) covers refusals before any model call, memory isolation by context, tenant, domain and sensitivity, prompt fencing, strict output parsing, approver mapping, shadow marking, an 800-case property test, and the gateway port mapping.
- Mutation testing: 30 of 30 source mutants killed (one literal-type mutant could not be applied after formatting and is covered by the property test).
- Not verified: any real model call, output quality, or the gateway with live credentials.
