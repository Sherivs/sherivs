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

## Part 2: triage of the 21 known failures (27 Nov 2026, A7b)

Run on a fresh PG16 database, 10% scale, 206 migrations applied: 293 pass, 7 fail (was 279 and 21).

**Fixed (14), all stale scenario setup, no product change:**
- payroll x2: the approver was given `ng.acting_provost`, which now requires a verified authority link (M009 B1). The scenario now uses `ng.finance_manager_school`. Payroll arithmetic was never wrong (PAYE, pension, loan 40,000, net 361,580 all hold).
- grading, leakage, results, tertiary x4: the scenario wrote result rows as the acting user and then published them as the same user, which the result-publication separation-of-duties rule correctly refuses. Setup rows are now written on a new `asSystem` path with no end-user identity.
- result checker: `check_result` now answers a refusal as `{ok:false,error}` (uniform failures) instead of raising; the assertions read the body.
- scopes x2, scope_sets x2, structure: the scenarios assigned a class-scoped role at `org` scope, which the template-scope guard now refuses, so every later scope check ran against nothing and some passed or failed vacuously. They now use org-scoped roles (`ng.vice_principal_academics`, `ng.head_teacher`). The expiry scenario also needed an earlier `started_at`.

**Still failing (7), baselined, with findings:**
1. **Probable real defect, class and department scoped roles cannot use school-level approvals.** `course_reg_decide` and `malpractice_decide` (and the scope-set functions) check `scholar_can(school, permission)` at school level. The `ng.academic_adviser` (class) and `ng.chief_invigilator` (department) templates can only be assigned at class, subject or self scope since the template-scope guard, so the people the feature is for cannot approve. Needs a decision: check the permission against the resource (the student's class) instead of the school. Affects: courses, exams (malpractice), scopes (assigner), scope_sets x3.
2. biometric: `biometric_checkin` is refused to the caller (device gateway only) as designed; which assertion fails is not yet isolated.
3. scope_sets audit: the scenario's "edit" of `role_scope_audit` is refused as append-only, as designed; the add and remove counts (1 and 0) point to the same assignment problem as item 1.

**UNVERIFIED:** items 1 to 3 are diagnosed from error text and function source, not fixed. The 3 audit and payment scenarios still fail on a second run on the same database.
