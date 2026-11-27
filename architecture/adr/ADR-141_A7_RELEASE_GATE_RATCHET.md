# ADR-141: The Sim Scenario Gate Fails Closed (A7, issue #465)

- Status: PROPOSED
- Date: 2026-11-26

## Context

The job "Migration dry-run + sim smoke" runs about 300 scenarios and reports them, but the step succeeds whether or not a scenario fails. Twenty-one fail on master (issue #465), several of them security or integrity checks (scope widening, payroll separation of duties, result-leakage gating, result checker, exam malpractice), and nothing stops a new failure from landing.

## Decision

1. A ratchet step runs after the scenarios (`tools/sim-lab/sim/scenario-ratchet.mjs`) against a committed baseline (`scenario-baseline.json`) of the 21 known failures, reproduced on 26 Nov 2026 on a fresh database (279 of 300 pass; the same 21 as the issue).
2. It fails on: a missing, empty, malformed or duplicate-named results file; fewer scenarios than the baseline minimum; any failing scenario not in the baseline; any baseline entry that now passes or no longer exists. The list can only shrink, and only by fixing a scenario.
3. The runner now writes a boolean `pass` for every scenario (one scenario passed a truthy id).

## Consequences

- A new regression turns the job red at the pull request. Fixing one of the 21 turns it red too until the entry is removed, which keeps the list honest.
- The 21 are not fixed here. Each needs a decision: a product regression to fix, or a scenario that no longer matches intended behaviour (see the mission note for the grouping).
- The scenarios are not re-runnable on a used database (three audit and payment scenarios fail on a second run); the ratchet is for a fresh seed, as in CI.

## Rollback

Remove the CI step and the two files; restore the runner line.
