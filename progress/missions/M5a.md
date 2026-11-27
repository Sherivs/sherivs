# Mission M5a: Organization reality interview graph (engine only)

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §8.1, §8.2, §8.4 (first bullet), §6.1, §9.1, §12.1 M5.
Origin: Claude Code agent, mission E-009 (M5a interview graph)
Creator: Claude Code agent
Created: 2026-11-17

Status: IMPLEMENTED and TESTED on branch `mission/M5a-interview-graph`; not merged. No migration, nothing applied.
Active persona: Principal Architect.

## Objective

Deliver the pure TypeScript engine behind the sherivs.com organization reality interview: a versioned
directed question graph with branches for every §6.1 family, a safe predicate language, graph
validation, a resumable walker and a deterministic answers-to-plan generator with golden files.
Tables, public routes and forms belong to another agent (M5b).

## Plan

1. Model and predicate evaluator (`graph/types.ts`, `graph/predicate.ts`).
2. Entry module (question 1 = organization type, ownership for ambiguous types, state) and twelve family modules.
3. Validator, walker, lazy registry, full graph.
4. Neutral plan primitives in `lib/onboarding/plan`; plan generator in `lib/scholar/reality/graph/plan.ts`.
5. Golden fixtures (private secondary, public primary via SUBEB, federal polytechnic, college of nursing, SUBEB oversight).
6. ADR-107.

## Report

- Files: `frontend/src/lib/scholar/reality/graph/**`, `frontend/src/lib/onboarding/plan/**`,
  `tests/unit/m5a-reality-graph.test.ts`, `tests/unit/m5a-onboarding-plan.test.ts`,
  `tests/fixtures/onboarding-plans/*.json`, ADR-107 and its INDEX row.
- Existing R1/R3 files are unchanged; the graph reuses their answer types and validation shape.
- Evidence: see the pull request (tsc, vitest counts, guards).
- Not done / UNVERIFIED: real role-pack codes (placeholders `ng.<type>@0.1.0`); website template codes are
  placeholders; state board and health board names, and NBTE as regulator for colleges of agriculture,
  technical colleges and IEIs/VEIs, are flagged, not asserted; §9.1 admissions interpretation awaits the founder;
  i18n copy for ha/yo/ig is not written (prompt keys only).
