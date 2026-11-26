# AIN-02: One Autonomy Scale, Per-Step Enforcement and the Promotion Gate

Authority: workflow hand-off roadmap (17 Nov 2026), Phase 2 entry AIN-02; standing written approval for the build cycle; the founder's rules in the hand-off master prompt.
Origin: Claude Code agent, mission AIN-02 (issue #474)
Creator: Claude Code agent
Created: 2026-11-20

Status: Draft implementation (PR stacked on #473, #471, #469, #467, #455; issue #474); NOT APPLIED, not deployed. `WORKFLOWS_ENABLED` is untouched. No model was called and nothing was sent.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Decision  | [ADR-126](../../architecture/adr/ADR-126_AIN02_AUTONOMY_SCALE_AND_PROMOTION_GATE.md)              |
| Migration | `database/supabase/migrations/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql` |
| Rollback  | `database/supabase/rollbacks/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql`  |
| Base      | PR #473 head `b9d66658` (AIN-01 mission file), stacked on #471 (WF-12), #469, #467, #455          |

## Step 1: could it be built now?

Yes, entirely. The mission changes who can change an earned level and what evidence it needs; it adds no paid
service or account, calls no model and gives no tenant data to any AI.

- Decision 3 (AI route) does not block it and stays respected: `wf_ai_route_approved()` is untouched and still
  false; `ai_model` steps are capped at `suggest`.
- Decision 9 (only the founder promotes) is implemented as decided: only an active super admin promotes.
- Decisions 2 and 4 are untouched.

So no "blocked on decision N" issue was written. The founder is asked to ratify the defaults listed at the end.

## Existing work found

- The engine scale `suggest < draft < act_with_approval < act_and_report` and `effectiveWorkflowAutonomy`
  (`workflow-actions.ts`, WF-06); `wf_agent_autonomy` and the step guard `wf_autonomy_guard` (WF-03, WF-06).
- The twin engine's earned-autonomy ladder and evidence bars (`twin-engine/autonomy-ladder.ts`, ENGINE-01,
  ADR-078). Reused: the bars and the demote floor are restated from it, and a unit test ties them together.
- The registry and state (`wf_agent`, `wf_agent_state_code`, tiers, grants; AIN-01, ADR-125).
- Open PRs checked on 2026-11-20 for the same capability or name: none defines an autonomy scale, evidence table or
  promotion ledger; no open branch uses the `wf_autonomy_*` table names. Migration `20261117000980` and ADR-126 are
  free on every open branch (`..000970` is AIN-01; `..001000` is used by other PRs; highest ADR in use is 125).

## Implemented

- Migration (inside `BEGIN`/`COMMIT`): `wf_autonomy_scale`, `wf_autonomy_class_cap`, `wf_autonomy_agent_tier_cap`,
  `wf_autonomy_bar`, the append-only `wf_autonomy_evidence` and `wf_autonomy_change`; `wf_autonomy_rank`,
  `wf_autonomy_level_of`, `wf_autonomy_ceiling`, `wf_effective_autonomy`; the replaced step guard; the earned-level
  write gate (`wf_agent_autonomy_05_gate`); the ledger guard and audit; `wf_autonomy_record_evidence`,
  `wf_autonomy_promote`, `wf_autonomy_demote`; the outbox backstop (`wf_action_sandbox_outbox_90_autonomy`); the run
  actor freeze (`wf_run_08_freeze_actor`); privileges (service role SELECT only on the registry tables and on
  `wf_agent_autonomy`; EXECUTE only on the three entry points); rollback.
- `frontend/src/lib/workflow/autonomy-scale.ts` (pure): scale, ladder mapping, bars, caps, an effective-level mirror and
  a promotion explainer.
- Tests: SQL harness, ACL test, unit file (18 tests), concurrency e2e.
- `verify.yml`: a default-privileges step (AIN-02 rolled back, Supabase default privileges switched on for the
  migrator, re-applied, harness and ACL test run), a harness step, one e2e line after AIN-01's; the AIN-01
  default-privileges step now undoes and re-applies AIN-02 around AIN-01.
- Docs: ADR-126, one INDEX row, a runbook section.

## Existing tests and files changed

- `tests/integration/wf03-workflow-runtime.local.sql`: the autonomy insert goes through the fixture, and the pinned
  service-role privilege on `wf_agent_autonomy` is now SELECT only (that is the new truth).
- `wf12-default-privileges` (three entry points added to its list), `wf06-actions`, `wf07-approval-inbox`, `wf08-run-history`, `wf12-quotas-retention`, `ain01-agent-actors`
  (harnesses): earned levels are seeded with `ain02_set_level` (gate off for one statement as the owner, back on
  straight after); steps that must record an executed action are marked with `ain02_allow_execution`; WF-08's one
  re-pointing of a run's template is wrapped in a disable and enable of `wf_run_08_freeze_actor`. The shared helper is
  `tests/integration/ain02-autonomy-fixture.sql`. No assertion was weakened.
- `tools/sim-lab/load/wf06-action-e2e.mjs`, `wf07-approval-e2e.mjs`, `wf08-run-history-e2e.mjs`,
  `wf12-quota-e2e.mjs`: the autonomy insert is bracketed by disabling and enabling the gate trigger as the owner.
- `.github/workflows/verify.yml`, `architecture/adr/INDEX.md` (one row), `docs/runbooks/workflows-enablement.md`.

## Evidence (round 2, 26 Nov 2026, local PostgreSQL 16, every migration applied as a non-superuser migrator)

- `AIN02 ALL PASS: 205 checks` (main database and, after rollback and re-apply, under Supabase default privileges). Round 1 head `638a6ef1` had 193; the original `602bb1fe` head reported 193 in its first evidence but 184 when re-run by the round 2 reviewer, so treat 193 as the round 1 number.
- `AIN02-PRIV ALL PASS: 251 checks`; `AIN01 ALL PASS: 136`, `AIN01-PRIV ALL PASS: 124`, `WF12-PRIV ALL PASS: 35 functions checked` (AIN-03 not installed in this branch).
- `AIN02-E2E RESULT: concurrent=20 promoted=1 refused=19 ledger_rows=1 rivals=10 rivals_promoted=1 nonfounder_promoted=0 direct_write_refused=4 auto_demoted=2 replay_demoted=0 race_demoted=1 race_level=draft rung_race_demoted=1 rung_race_level=suggest record_waited=true record_after_demotion=42501 step_after_promote=act_with_approval step_after_demote=suggest sent_live=0 dup=0` (over plain `pg`; no PostgREST).
- Earlier suites with AIN-02 applied: `WF06 ALL PASS: 29 checks`, `WF07 ALL PASS: 96 checks`, `WF08 ALL PASS: 113 checks`, `WF12 ALL PASS: 213 checks`, `WF03 ALL PASS`, `WF05 ALL PASS: 23 checks`, `AIN01 ALL PASS: 136 checks` (the AIN-01 count is from the clean run before any e2e).
- Round 2: WF-06, 07, 08 and 12 e2e scripts re-run on local PostgREST 12.2.3: all pass with the same result lines as in CI. Seven mutations (no agent lock, no shared outbox lock, draft not bound, ceiling on every write, no template pin, no tie rule, no truncate trigger) each fail the harness or e2e.
- Unit: `ain02-autonomy-scale.test.ts` 18 passed; `tsc --noEmit`, eslint and prettier clean on the new files.
- Guards: `verify-domain-neutrality` PASS, `verify-migration-grants` PASS, `verify-provenance-metadata` PASS.
- The rollback was exercised against the applied migration and the migration applied again.

## CI evidence

Head `602bb1fe` (PR #475): every check green (Migration dry-run + sim smoke, Secret scan, Typecheck, Unit tests,
Lint, guards and build, RLS battery, E2E); the Vercel preview is not a CI gate. In the CI log: `AIN02 ALL PASS: 193 checks`
(twice: default-privileges scratch database and main), `AIN02-PRIV ALL PASS: 241 checks`, `AIN01 ALL PASS: 136 checks`,
`WF12 ALL PASS: 213 checks`, and the `AIN02-E2E RESULT` line above. The four modified WF e2e scripts ran green on
PostgREST. The first CI run failed twice and was fixed: gitleaks flagged two idempotency-key literals in the harness,
and `wf12-default-privileges.local.sql` (which lists every function the service role may execute) needed the three
new entry points added.

## Review round 1 (coordinator review of head cb9b7ec8)

Fixed in new commits (history kept):

1. Superseded evidence: a promotion is refused (`ain02:evidence_superseded`) when the agent has later evidence or
   the organization has a later demotion; the ledger guard repeats it. Harness section 10b; earlier harness
   promotions after a demotion now use evidence from after it.
2. Race in `wf_autonomy_record_evidence`: `wf_autonomy_apply` now takes only the kind for `auto_demote` and derives
   the target from the level re-read under the lock (a level of `suggest` is skipped). New e2e scenario G holds an
   uncommitted promotion while a regression is recorded: the regression is recorded and lowers one rung from the
   committed level (`race_demoted=1 race_level=draft`).
3. Stale in-flight level: the outbox guard uses the lower of the stored level and the current
   `wf_effective_autonomy` for the step's run, template and class. Harness case: step at act_and_report, agent
   demoted, executed record refused. The WF-07/08/12 fixtures that mark steps executable now also switch the
   outbox backstop off for that rolled-back harness (they test quotas, approvals and history).
4. ADR-126 now has a plain trust model section; the tier-cap comment says "engineering default for the founder to
   ratify"; a demotion that lowers nothing (including an org administrator on an agent with no row) fails with
   `ain02:nothing_to_lower`.

## Review round 2 (independent adversarial review of head 638a6ef1)

See ADR-126 "Review round 2" for the ten findings and what was done. Changed existing assertions, disclosed: in the
promotion section the regression-shaped fixtures (`d_r17`, `d_crit`, `bk_below`, `bk_crit`) are now evaluated two hours
before the evidence they sit beside, because a regression recorded later with an equal evaluation time now supersedes
(finding 7); `sup_g` is a 60-case record so it clears the bar of the level it is promoted to; the outbox positive twin
now names its draft (finding 3); one count (15 guard functions) and the function-count (18) include the two new
functions. No assertion was weakened.

## Not verified

- Round 2 CI has not yet run on the new head. The e2e scenarios H and I use two simultaneous sessions and a one-and-a-half second wait; a very slow runner could in principle make them flaky, not wrong.
- PostgreSQL 17 was used only in CI; locally PostgreSQL 16.
- The organization add-on state is a stub of the reviewed ENGINE-20 shape; the real objects were not available.
- Promotion trusts the identity the server passes, as WF-07 does. There is no passkey step-up and no UI.
- Nothing ran against a hosted database.

## Founder decisions needed

1. Ratify the ceilings: executive `act_with_approval`, assurance `draft`, department and organization
   `act_and_report` for the four plain classes only.
2. Passkey step-up on promotion (decision 9 follow-up).
3. Evidence rule: one piece of evidence promotes once, per agent, within 30 days.
4. Whether a pause should reset an earned level.
5. Decision 3 (AI route) remains open and blocks WF-11 for tenant data.
