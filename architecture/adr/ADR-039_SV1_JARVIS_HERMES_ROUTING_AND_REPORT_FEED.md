# ADR-039: SV1 JARVIS Hermes Routing, Controls and Report Feed

| Field                      | Value                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required; nothing is scheduled or delivered by this change)                                                                                                                                                                             |
| Date                       | 2026-11-13                                                                                                                                                                                                                                                              |
| Author                     | Claude Code agent (SV1-JARVIS-05 implementation)                                                                                                                                                                                                                        |
| Creator                    | Claude Code agent, mission J-005 (issue #294)                                                                                                                                                                                                                           |
| Mission                    | SV1-JARVIS-05 (governed JARVIS routing and reports)                                                                                                                                                                                                                     |
| Capabilities               | Hermes classifier ([hermes-classifier.ts](../../frontend/src/lib/hermes/hermes-classifier.ts)); ADR-035 policy; ADR-036 inbox; ADR-038 playbooks; existing briefing composer                                                                                            |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                    |
| Cites                      | [ADR-035](./ADR-035_SV1_JARVIS_GOVERNED_AGENT_REGISTRY_AND_RISK_POLICY.md); [ADR-038](./ADR-038_SV1_JARVIS_BOUNDED_ROLE_PLAYBOOKS.md); [J0 threat model](../../docs/jarvis/J0-inventory-gap-and-threat-model.md); [briefing](../../frontend/src/lib/jarvis/briefing.ts) |
| Minimal ownership artifact | `frontend/src/lib/jarvis/hermes-routing.ts` and `report-feed.ts`; pure functions, no migration                                                                                                                                                                          |

## Context

The J0 threat model requires one coordinator (Hermes), a way to stop routing at once, a cap on runaway loops, a daily brief, and a feed for the Grok orchestrator that carries no personal or tenant record content.

## Decision

- Routing passes every request through the existing `classifyHermesAction`; no new runtime, timer, worker or I/O is added (a source-level test enforces this). Each JARVIS action maps to a Hermes action class via a reviewed table (reads and recommendations to a recorded observability act, approval requests to human escalation, T2/T3 to a critical action that Hermes always sends to a human, T4 and deploy to Hermes' own deny classes). The stricter of playbook and Hermes wins.
- The kill switch is checked first. While engaged every request is denied and consumes nothing. Any actor may engage it; only a verified human sheriff with passkey step-up may release it.
- The budget caps routed requests per window (denials included, so a loop cannot probe indefinitely) and escalations separately; at the cap everything is denied.
- The report feed is built from an explicit allowlist: counts by workspace and decision, approval counts by status, and control usage. It never copies ids, actors, tenants, digests or free text, and it is deeply frozen.
- The daily brief reuses `composeBriefing` over the last 24 hours of already-redacted events (verbatim restatement; unparseable events fail closed).

## Consequences

- Positive: halting and limiting are testable and independent of any model; the feed can be exposed read-only without a content-review step.
- Not done here: persisting controls, the scheduler that triggers the daily brief, delivery to Grok, and wiring `routeJarvisAction` into the Hermes cycle. The class mapping is a proposal for owner review.

## Verification

`tests/unit/jarvis-hermes-routing.test.ts` (22 tests) and `tests/unit/jarvis-briefing.test.ts` pass. Mutation checks: ignoring the kill switch, ignoring the budget, not counting denials, bypassing Hermes, letting an AI release the switch, leaking a requester id into the feed, or not freezing the feed each fail tests.
