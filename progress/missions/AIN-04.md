# AIN-04: Evaluation and Guardrail Layer in the Run Path (Provider-Free Slice)

Authority: workflow hand-off roadmap (17 Nov 2026), Phase 2 entry AIN-04; standing written approval for the build cycle; the founder's rules in the hand-off master prompt.
Origin: Claude Code agent, mission AIN-04 (issue #478)
Creator: Claude Code agent
Created: 2026-11-20

Status: Draft implementation (PR stacked on #477, #475, #473, #471, #469, #467, #455; issue #478); NOT APPLIED, not deployed. `WORKFLOWS_ENABLED` is untouched. No model was called and nothing was sent.

| Field     | Value                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Decision  | [ADR-128](../../architecture/adr/ADR-128_AIN04_EVALUATION_AND_GUARDRAIL_LAYER.md)                         |
| Migration | `database/supabase/migrations/20261117000995_sherivs_ain04_evaluation_guardrail_layer.sql`                |
| Rollback  | `database/supabase/rollbacks/20261117000995_sherivs_ain04_evaluation_guardrail_layer.sql`                 |
| Base      | PR #477 head `e5048323` (AIN-03 mission file: CI evidence), stacked on #475, #473, #471, #469, #467, #455 |

## Step 1: could it be built now?

Yes, as a provider-free slice. The roadmap entry (Part B section 5, item 8) names no founder decision as its blocker.
It needs no paid service and no new account, calls no model and gives no tenant data to any AI.

- Decision 3 (AI route) does not block the build and stays respected. Everything here is deterministic and inside the
  database. The only suite kind is the screener itself (a CHECK); a suite that runs a real agent or model needs the AI
  route and is NOT built. WF-11 stays blocked for tenant data.
- Decision 9 (only the founder promotes an agent) is untouched; nothing here reads or writes autonomy (a harness check
  searches the function sources for it). Decision 7 (minors) is untouched; the screener flags personal-data shapes and
  decides no lawful basis.

So no "blocked on decision N" issue was written. Issue #478 holds the spec and acceptance criteria.

## Existing work found

- No `wf_safety*` object, screening corpus, injection list or open PR for the capability. `wf_template.eval_suite` (WF-03)
  is a name column only. ENGINE-13 `eval_suites` / `eval_results` rows are platform-side proposals with no tenant anchor.
  AIN-02 `wf_autonomy_evidence` records caller-asserted numbers for an agent; it was not changed.
- Reused, not duplicated: `wf_org_settings` (tenant anchor and `workflows_enabled`), `wf_run` (the run the check belongs
  to), `wf_audit_append`, `wf_append_only`, `wf_act_as` / `wf_act_restore` / `wf_can` (WF-07, WF-01), the permission
  `workflows.approve` (WF-02).
- Open PRs checked on 2026-11-20 (all of them, by listing every open branch's tree for `20261117000991`..`000999`,
  `ADR-128`, `ADR-129`, `wf_safety`, `wf_eval`, `ain04`): nothing collides. `20261117000995` and ADR-128 are free.
  The name prefix `wf_guard` was avoided because `wf_guard_row` exists (WF-01).

## Implemented

- Migration (inside `BEGIN`/`COMMIT`): `wf_safety_pattern` (22 reviewed patterns), `wf_safety_eval_suite`,
  `wf_safety_eval_case` (47 cases), the append-only ledgers `wf_safety_eval_run` (platform), `wf_safety_check` and
  `wf_safety_review` (tenant); `wf_safety_norm`, `wf_safety_screen`, `wf_safety_suite_sha`, `wf_safety_eval_compute`,
  `wf_safety_verified`; the guards (`wf_safety_eval_run_guard`, `wf_safety_check_guard`, `wf_safety_review_guard`,
  `wf_safety_audit`); four entry points; privileges; the migration runs its own suite and aborts if it does not pass.
- `frontend/src/lib/workflow/ai-guardrails.ts` (pure): the corpus, the normalization, `screenText`, the caps, a request
  pre-check, the text hash and `outputUsable`.
- Tests: SQL harness, ACL test, unit file (58 tests), concurrency e2e.
- `verify.yml` (additions only): an AIN-04 default-privileges step, an AIN-04 harness step, one e2e line after AIN-03's.
- `wf12-default-privileges.local.sql`: four functions added to the allow-list.
- Docs: ADR-128, one INDEX row, a runbook section.

## Lessons applied

- (a) Default privileges: every table and function is revoked from PUBLIC, anon, authenticated and service_role before any
  grant; the service role has SELECT only on the six tables (never INSERT, UPDATE, DELETE, TRUNCATE) and EXECUTE only on
  four entry points; the fifteen internal functions are executable by nobody. Proved under
  `ALTER DEFAULT PRIVILEGES FOR ROLE sim_migrator ... TO anon, authenticated, service_role` with an ACL test whose failure
  was shown by granting one privilege (and one execute) back.
- (b) Guards cover UPDATE and upsert: the three ledgers are append-only (UPDATE, DELETE, TRUNCATE refused), so
  `INSERT ... ON CONFLICT DO UPDATE` is refused in the update half; the harness runs it on all three. The insert guards
  also refuse a write outside the function window, a window of the wrong actor, and a hand-opened window that breaks a rule.
- (c) SQL is the backstop for every cap in code: 20000 characters, 200 checks per run, 5000 per organization per day, 100
  suite runs per day, reviewer authority and the starter rule, verdict and codes shape. Hand-opened windows in the harness
  simulate a faulty function.
- (d) No earlier assertion was weakened: no existing test file changed except the allow-list additions below.
- (e) The service role trust model is stated in ADR-128: SQL decides organization, run state, caps, authority and
  separation of duties; it cannot decide which text the service role submits, only bind the hash.

## Existing tests and files changed

- `tests/integration/wf12-default-privileges.local.sql`: four functions added to the allow-list and the header comment
  names AIN-04 (41 -> 45 functions checked). No assertion removed.
- `.github/workflows/verify.yml`: two steps and one e2e line added; nothing edited.
- `architecture/adr/INDEX.md` (one row), `docs/runbooks/workflows-enablement.md` (one section).
- No change to any WF or AIN-01 to AIN-03 harness, e2e script or migration.

## Evidence (20 Nov 2026, local PostgreSQL 16.15, every migration applied as a non-superuser migrator)

- `AIN04 ALL PASS: 157 checks` (`tests/integration/ain04-guardrail-layer.local.sql`; the same count after re-applying AIN-04
  under Supabase default privileges).
- `AIN04-PRIV ALL PASS: 251 checks` (`tests/integration/ain04-default-privileges.local.sql`).
- `AIN04-E2E RESULT: concurrent_checks=250 landed=200 refused=50 over_cap=0 mixed=30 clean=10 flagged=10 blocked=10 usable=10 reviews=20 reviewed=1 review_refused=19 starter_refused=1 suite_runs=10 suite_reused=10 new_runs=0 direct_write_refused=4 member_sees_other_org=0 sent_live=0 dup=0` (plain `pg`, no PostgREST).
- Regression with AIN-04 applied, same clean database: `WF01 ALL PASS: 92 checks`, `WF02 ALL PASS: 24 checks`, `WF03 ALL PASS`,
  `WF05 ALL PASS: 23 checks`, `WF06 ALL PASS: 29 checks`, `WF07 ALL PASS: 96 checks`, `WF08 ALL PASS: 113 checks`,
  `WF12 ALL PASS: 213 checks`, `AIN01 ALL PASS: 136 checks`, `AIN02 ALL PASS: 193 checks`, `AIN03 ALL PASS: 217 checks`,
  `AIN02-E2E RESULT: ... dup=0` and `AIN03-E2E RESULT: ... dup=0` (both unchanged lines).
- The CI default-privileges steps, rehearsed locally in scratch databases: AIN-04 step (`AIN04 ALL PASS: 157 checks`,
  `AIN04-PRIV ALL PASS: 251 checks`); AIN-01 step with AIN-04 present (`AIN01 ALL PASS: 136 checks`,
  `AIN01-PRIV ALL PASS: 124 checks`, then AIN-02, AIN-03 and AIN-04 harnesses still pass); WF-08/WF-12 step with the extended
  allow-list (`WF12-PRIV ALL PASS: 45 functions checked`, was 41).
- Rollback rehearsal: with rows present the rollback refuses (`check or review rows exist`); on a fresh database it removes
  every AIN-04 object (none left), `WF06`, `WF12`, `AIN01`, `AIN02` and `AIN03` harnesses pass again, re-applied,
  `AIN04 ALL PASS: 157 checks`.
- Sensitivity (mutations made in scratch databases, each killed by the harness): starter rule off, run-active check off,
  verification link always true, organization daily cap off, blocked output reviewable, text-hash binding off, severity
  CHECK off, eval-run recompute replaced by the row's own claims. The e2e fails with the per-organization advisory lock
  removed (`landed=236 over_cap=36`). The ACL test fails when INSERT is granted back on a ledger and when an internal
  function is made executable.
- Unit: `ain04-ai-guardrails.test.ts` 58 passed (every seed row of the corpus and all 47 cases parsed from the migration
  and re-run in JavaScript); `tsc --noEmit` exit 0, eslint and prettier clean on the new files.
- Guards: `verify-domain-neutrality` PASS (case texts reworded to stay neutral, no quarantine), `verify-migration-grants`
  PASS, `verify-provenance-metadata` PASS.

## CI evidence

CI_PLACEHOLDER

## Not verified

- The e2e scripts of AIN-01, WF-06, 07, 08 and 12 need PostgREST and were not run locally (AIN-02, AIN-03 and AIN-04 run
  over plain `pg` and were). CI runs them.
- PostgreSQL 17 was used only in CI; locally PostgreSQL 16.15. `normalize(text, NFKC)` and the regex escapes were proved
  on 16.
- A hosted Supabase: PostgREST exposure of the new functions and the apply as the `postgres` role. Nothing ran against a
  hosted database.
- Fourteen of the repository's older migrations (whatsapp and calling) fail to apply on the local sim database for
  reasons outside this mission (they need objects that are not there); AIN-04 and everything it stacks on applied.
- No scheduler route, server function or UI calls the four entry points yet. Nothing was timed at production volume.
- Usefulness of the corpus on real Nigerian school messages (English, Pidgin, Hausa, Yoruba, Igbo, Arabic): not measured;
  the cases are synthetic. False positives on real text, and attacks that paraphrase or use another language, are not
  covered. The corpus catches known shapes only.
- JavaScript and PostgreSQL may differ on a newer Unicode version; both pass the same 47 cases.
- The AIN-02 harness now reports 193 checks on a clean database; the AIN-03 mission file recorded 184 (that file predates
  the merge of AIN-02 review round 1). Not changed here.

## Founder decisions needed

1. Ratify or change the caps (20000 characters, 200 checks per run, 5000 per organization per day, 100 suite runs a day,
   one hour reuse) and the corpus itself (22 patterns; what blocks and what flags).
2. Who may clear flagged output: v1 is `workflows.approve` and never the person who started the run. In a one-person
   organization that person cannot clear their own run's output at all.
3. Decision 3 (AI route): unchanged and still blocking WF-11, and any suite that evaluates a real agent or model.
4. Decision 7 (minors): the screener flags email, phone and eleven-digit shapes but does not decide whether such data may
   enter a prompt.
5. Whether memory notes (AIN-03) must pass the screener on write (a later reviewed change).
6. Migration number `20261117000995` and `BEGIN`/`COMMIT` inside the migration (as AIN-01 to AIN-03).
