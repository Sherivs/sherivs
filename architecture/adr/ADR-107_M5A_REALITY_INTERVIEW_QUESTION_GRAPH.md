# ADR-107: Reality Interview Question Graph, Predicate Language and Versioning

| Field                      | Value                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder review required; no migration, nothing applied)                                                                                                                |
| Date                       | 2026-11-17                                                                                                                                                                       |
| Author                     | Claude Code agent (mission M5 part A)                                                                                                                                            |
| Creator                    | Claude Code agent, mission E-009 (M5a interview graph)                                                                                                                           |
| Mission                    | M5 part A (organization reality interview engine), master brief §8.1, §8.2, §8.4, §6.1, §9.1                                                                                     |
| Capabilities               | Adaptive interview as a versioned directed graph; safe declarative edge predicates; pure deterministic answers-to-plan                                                           |
| Cites                      | [ADR-051](./ADR-051_SV1_REALITY_R1_TAXONOMY_QUESTION_REGISTRY.md) (R1 registry), [ADR-053](./ADR-053_SV1_REALITY_R3_ADAPTIVE_ONBOARDING_INTERVIEW.md) (R3 interview); issue #332 |
| Minimal ownership artifact | `frontend/src/lib/scholar/reality/graph/`, `frontend/src/lib/onboarding/plan/`, `tests/fixtures/onboarding-plans/`                                                               |

## Context

The R1 registry (ADR-051) and R3 interview (ADR-053) choose questions by per-question visibility lists for three V1 school types. The pre-tenant interview on sherivs.com must cover every §6.1 family, pick each next question from earlier answers, be served one small step at a time, resume from stored answers, and end in a provisioning plan that Sherivs staff review (§8.4).

## Options

- **A. Extend R1 visibility lists to all families.** Consequences: no explicit order, branching is implicit, and "next question" needs a fixed-point pass over the whole registry, so a step cannot be served small.
- **B. JSONLogic (as §8.2 suggests).** Consequences: a new dependency and a much larger operator set (map, reduce, var paths) than needed; harder to prove safe.
- **C. A small in-repo predicate language over an explicit edge list.** Chosen.

## Decision

1. **Model.** `question(id, type, promptKey, options, validation, dataClass ∈ {public, internal, personal}, writesTo)` and `edge(from, condition, to, priority)`; `to` is a question id or `$end`. Answer types and `QuestionValidation` are the R1 ones. Question 1 (`entry.org.institution_type`) is the organization type, using §6.1 codes (modifiers and regulators/exam bodies excluded, see `institution-types.ts`).
2. **Routing.** From an answered question, edges are tried in ascending priority and the first whose condition holds is taken. Authors write ordered steps with optional skip conditions; `chainEdges` compiles them to edges and partially evaluates conditions against steps that were skipped. Every question ends with an `always` edge.
3. **Predicate language.** `always, exists, equals, in, gt, gte, lt, lte, and, or, not`, JSON only, evaluated by a switch (no eval), depth ≤ 8 and ≤ 64 nodes, unknown operators fail closed. Absent answers are unknown: `exists` and every comparison are false. `equals`/`in` on a multi answer mean contains / intersects.
4. **Validation** (`validateGraph`, unit-tested): unique ids, edge endpoints exist, unique priorities, fallback edge, no cycles, all reachable from the root, all can reach END, predicates read only the question itself or its ancestors, predicate option values exist, numeric operators only on number questions, `writesTo` is a known plan path.
5. **Walker.** `walk(graph, answers)` is pure: it uses only answers on the walked path (off-path answers are reported as ignored, never errors), stops at the first unanswered or invalid answer, and reports completion as answered / (answered + longest remaining path), which never decreases.
6. **Size.** Graph data is one entry module plus twelve family modules. The entry never imports a family (tested); `registry.ts` lazy-loads the one family the answers select; `full-graph.ts` is for server use.
7. **Plan.** `generatePlan(answers)` writes each on-path answer to its plan path, then derives role pack, org units, calendar, grading, curricula, modules, website template, admissions, authority link candidates, profile and flags. Output is canonical JSON; golden files pin five cases. Domain-neutral helpers (canonical JSON, plan paths, unverified links, envelope with digests) live in `lib/onboarding/plan`; all vocabulary stays under `lib/scholar`.
8. **Honesty rules.** Role packs are placeholders `ng.<institution_type>` at `0.1.0` until the role-pack catalogue agent publishes real codes; website template codes are placeholders too (both flagged). Every authority link candidate is `unverified`. Oversight types get `oversight_workspace` disabled with gate `mandate_status: 'unverified'`. Items marked [VERIFY] in the brief, and defaults we could not confirm, become `verify:` / `unconfirmed:` flags. Admissions follow §9.1 (on for public and tertiary, off until chosen for private) and carry `founder_confirm:admissions_availability`.
9. **Versioning.** The graph carries `REALITY_GRAPH_ID` and `REALITY_GRAPH_VERSION` (semver, now 1.0.0). Any data change bumps it. Sessions store the version with the answers; replaying the same version and answers reproduces the same step and plan. When a stored version differs, the server re-walks under the current graph; answers that fall off the path are ignored, not lost.

## Golden Questions

- **WHO:** prospective organizations answer; Sherivs staff review the plan; nobody is provisioned by this code.
- **WHAT:** a pure graph, walker and plan generator; no tables, routes or UI.
- **WHERE:** `lib/scholar/reality/graph` (vocabulary) and `lib/onboarding/plan` (neutral).
- **WHY:** §8 requires an adaptive, resumable, small-step interview with a deterministic plan.
- **UNDER WHICH POLICY:** request-based onboarding (§8.4 founder rule); oversight disabled until mandate verified; authority links unverified until evidenced.

## UNKNOWNs

- Real role-pack codes and versions (catalogue mission).
- Admissions availability interpretation (§9.1, founder to confirm).
- Names of state boards and health licensing bodies ([VERIFY]); NBTE as regulator of colleges of agriculture, technical colleges and IEIs/VEIs is not checked.
- Hausa, Yoruba and Igbo copy for prompt keys (content to be supplied).
