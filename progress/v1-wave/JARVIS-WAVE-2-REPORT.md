# JARVIS-WAVE-2 REPORT — Workforce performance lens + human-decision evidence packs (2026-10-07)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, §65 absolute prohibitions, §39 no destructive refactoring, §45 V1-only envelope, §7 agent authority boundary (analyze/recommend/propose — never decide).
Operator authorization: in-chat instruction 2026-10-07 — "Scan this remaining works and outlined the best and the perfect professional move then execute toward it professionally."
Governance record: DECISIONS.md **#207 (PLATFORM-016 — Workforce performance lens V1 slice + human-decision evidence packs)**, RATIFIED 2026-10-07.
Version-target classification: **V1 organizational capability envelope only** (§45).

## The professional move (scan → outline → execute)

The wave-1 remaining-work items split by WHO owns them:

| Item | Owner | Professional move executed this wave |
| --- | --- | --- |
| Workforce performance metrics (§40/§41 — "measure workers… optimize verified outcomes") | Agent (directive-authorized V1; #206 ratified the directive) | **BUILT**: the measurement lens |
| Scheduler/queue daemon | Deferred by design | **NOT built** — no daemon runtime exists; would duplicate lease/host substrate (§58). Restraint recorded in #207(d) |
| Durable workflow persistence | Deferred by design | **NOT built** — requires an approved migration + schema decision (§28/§38). Restraint recorded in #207(d) |
| Phase-52 hash drift | HUMAN-ONLY | **Evidence pack + 3 options + recommendation** — nothing rewritten |
| PLATFORM-003 (blocks 2 roles) | HUMAN-ONLY | **Impact brief + 3 options + recommendation** — roles stay frozen |

## Implemented

- **`frontend/src/lib/workforce/performance-metrics.ts` (NEW)** — `computeWorkforcePerformance({tenantId, now, missions, evidence, transitions})`: pure, deterministic lens over the ONE canonical mission substrate (consumes `mission/mission-contract.ts`; no duplicate system, §58). Computes §40 metrics: completion rate, failure rate, verification pass rate (reuses `missionEvidenceCovers` usable-evidence law), rework rate, rollback rate, mean time to completion, mean time to recovery, per-actor attribution, and a composite quality score labeled `claimClass: "inferred"` (§21). **Anti-fabrication law enforced structurally (§65)**: token usage, compute cost, tool errors, and security violations have no wired observation substrate and are returned `not_observable` with §65-cited reasons — never guessed, never defaulted. Tenant isolation: cross-tenant records excluded AND counted (§13). Fail-closed on invalid mission cores, non-canonical transition states, unparseable clocks, unattributed actors.
- **Machine gate extended** (`scripts/verification/workforce-role-catalog-validate.mjs`, check 6): the lens must resolve, pass a golden computation (completion=1, MTTC=7,200,000ms), and prove §65 honesty for the four unobservables. Wired into `verify:workforce` (already in the verify chain).
- **Tests**: `tests/unit/workforce/performance-metrics.test.ts` — 19 tests, all passing.
- **Two decision briefs** (agent PROPOSES, owner DECIDES — §7):
  - `architecture/jarvis-workforce/PHASE52-HASH-DRIFT-DECISION-BRIEF.md` — root cause OBSERVED: the corpus file has exactly one git revision (`2d9621b`, 2026-09-29) hashing `7365DA0E…`/1,728,535 B (identical to the working tree); the cited `A69A3E74…`/1,844,342 B matches NO revision in repo history — the extraction pipeline ran against a byte-sequence never preserved here (−115,807 B, ≈6.3%). Risk contained (Campaign-52 denies implementation; Phase 52 not canonical; no V1 consumer). Options: A ratify preserved file canonical (recommended), B re-preserve true source + regenerate, C demote derived artifacts. NO artifact was modified.
  - `architecture/jarvis-workforce/PLATFORM-003-WORKFORCE-IMPACT-BRIEF.md` — PLATFORM-003 (#195) remains PROPOSED/unratified; the §45 interplay is recorded (ratifying picks the canonical OWNER; it does not authorize P36/P48 implementation in V1 — civilization/V3 interplay). Options: A ratify as written → both roles become DEFERRED_BEYOND_V2; B ratify + separate §45 V1-scope authorization naming the existing intelligence-plane memory store as V1 substrate → `memory_systems_engineer` may go V1; C explicit deferral with revisit date. Roles stay frozen in either case until the owner's line.

## Reconciliation (§60)

- **REUSED**: `mission-contract.ts` lifecycle + evidence laws, kernel envelope vocabulary, `verify:workforce` gate chain. No new engine, no second memory/metrics system — a measurement lens, not a store.
- **BUILT (new, minimal)**: one pure module, one gate check, 19 tests, two briefs, one decision entry.
- **NOT BUILT (restraint)**: scheduler daemon, durable persistence, token/cost/tool/security observation plumbing — each needs its own governed substrate decision (recorded in #207(d)); the lens honestly reports `not_observable` until then.

## Security Validation

- §13 tenant isolation: cross-tenant missions/evidence/transitions excluded and counted in the report — never mixed, never hidden.
- §21/§65 anti-hallucination: unobservable metrics structurally `not_observable`; the quality score carries `claimClass: "inferred"`; the gate machine-asserts the §65 honesty of the four unobservables.
- §39: zero modifications to Phase-52 artifacts; the drift is documented, not silently repaired.
- §45: no V2/V3/civilization scope implemented; the two blocked roles remain frozen (gate-asserted).
- §30: no secrets touched.

## Verification

- `npx tsc --noEmit` → exit 0.
- `npx vitest run tests/unit/workforce/performance-metrics.test.ts` → 19/19 passed.
- `npm run verify:workforce` → PASS (64 roles + executive loop wired + performance lens wired and §65-honest).
- Full `npm run verify` gate recorded in the commit.

## Known Risks

- The lens consumes RECORDED transitions; no transition-log persistence exists yet, so time-based metrics depend on callers supplying recorded history (declared in the input contract, not fabricated).
- Quality score weights (0.4/0.3/0.2/0.1) are fixed in code; changing them is a governance tweak, not a code accident.

## Remaining Work

- **Owner (one line each)**: Phase-52 drift adjudication (A/B/C from the brief); PLATFORM-003 adjudication (A/B/C from the brief).
- **Next agent window (after owner lines)**: wire the lens output into JARVIS briefing/morning-report assembly; add the token/cost observation substrate decision if the owner wants those §40 metrics to become observable.
- **Still deliberately deferred**: scheduler daemon, durable workflow persistence (#207(d)).