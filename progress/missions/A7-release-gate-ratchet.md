# A7: Make the sim scenario gate fail closed (issue #465)

| Field    | Value                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Status   | Draft PR stacked on A6 (#517). Part 2 of the issue (the ratchet) is done; part 1 (triage and fix of the 21) is NOT |
| Decision | [ADR-141](../../architecture/adr/ADR-141_A7_RELEASE_GATE_RATCHET.md)                                               |

## Built

- `tools/sim-lab/sim/scenario-ratchet.mjs`, `scenario-baseline.json`, a CI step after "Scenarios", unit test (6 tests), and `pass` coerced to boolean in the runner.

## Evidence (26 Nov 2026; local PostgreSQL 16, 206 migrations, 10% seed)

- Fresh database: 279 of 300 pass; the 21 failures are exactly the 21 in the issue (compared name by name). Ratchet exits 0.
- Altered results: a new failure, a fixed-but-still-listed scenario, a missing file, and an empty list each exit 1.
- Re-running the scenarios on a used database gives 276 of 300 (three audit and payment scenarios depend on a fresh seed); the ratchet correctly reports those three as new failures.

## Triage of the 21 (hypotheses from the failure text; NOT verified by reading each scenario)

| Group                           | Scenarios                                                                         | What the failure text suggests                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Separation of duties            | grading carry-over, leakage                                                       | "result author cannot publish the same result": the scenario uses one person to enter and publish; the rule is intended, so the scenario likely needs two people   |
| Direct table or function access | scopes (3), scope_sets (5), attendance biometric                                  | "permission denied for table role_assignment_scopes" and "for function biometric_checkin": privileges were hardened; scenarios may need the supported entry points |
| Expected-allow denied           | exams malpractice, courses adviser, payroll SoD, results checker                  | an allowed action is refused or a limit is not enforced; could be a real regression or a changed rule                                                              |
| Calculation                     | payroll line (loan deduction 0 instead of 40,000; net 401,580 instead of 361,580) | a payroll number is wrong by exactly the loan; treat as a possible real defect first                                                                               |
| Tertiary                        | GPA, degree class, standing, standing report                                      | empty results; probably downstream of publishing (same SoD cause)                                                                                                  |
| Structure                       | delete guards                                                                     | a delete that should be refused is allowed when the item is scoped                                                                                                 |

## UNVERIFIED

- None of the 21 was fixed or individually diagnosed. Payroll, scope widening and result-leakage are security or money checks and should be looked at before the others.
- The baseline was reproduced on PostgreSQL 16; CI's sim lab uses PostgreSQL 17. If CI differs, the ratchet reports it and the baseline is corrected from the CI run.
- Not run in CI.
