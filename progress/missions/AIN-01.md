# AIN-01: Agents as Engine Actors (Identity, Capabilities, Budgets)

Authority: workflow hand-off roadmap (17 Nov 2026), Phase 2 entry AIN-01; standing written approval for the build cycle; the founder's rules in the hand-off master prompt.
Origin: Claude Code agent, mission AIN-01 (issue #472)
Creator: Claude Code agent
Created: 2026-11-20

Status: Draft implementation (PR stacked on #471, #469, #467, #455; issue #472); NOT APPLIED, not deployed. `WORKFLOWS_ENABLED` is untouched. No model was called and nothing was sent.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Decision  | [ADR-125](../../architecture/adr/ADR-125_AIN01_AGENTS_AS_ENGINE_ACTORS.md)                        |
| Migration | `database/supabase/migrations/20261117000970_sherivs_ain01_agents_as_engine_actors.sql`           |
| Rollback  | `database/supabase/rollbacks/20261117000970_sherivs_ain01_agents_as_engine_actors.sql`            |
| Base      | PR #471 head `53b3de9b` (WF-12 mission file), stacked on #469 (WF-08), #467 (WF-07), #455 (WF-06) |

## Step 1: could it be built now?

Yes, entirely. The mission records who an agent is, what it may do and how much, and refuses an agent step that
breaks those records. It adds no paid service or account, calls no model and gives no tenant data to any AI.

- Decision 3 (AI route) does not block the build. It is respected: `wf_ai_route_approved()` returns false and a
  step of kind `ai` cannot be created for anyone until a reviewed migration replaces it. WF-11 stays blocked for
  tenant data.
- Decision 9 (only the founder promotes an agent) is respected: nothing here writes `wf_agent_autonomy`.
- Decisions 2 and 4 are untouched.

So no "blocked on decision N" issue was written. The one thing the founder must still decide that this mission
exposes is decision 3 (see "Founder decisions needed").

## Existing work found

- Platform workforce already defined: 25 packs and charters (ADR-088), pause state (ENGINE-16, applied), workspace
  scopes (ENGINE-13, applied). Reused: the pack code is the identity key, `is_agent_paused` is the pause check.
- Organization workforce already defined: 17 `org-*` packs (ADR-095) and, in production, `org_agent_catalog`,
  `org_agent_addon_events`, `org_agent_state()`, `change_org_agent()` (ENGINE-20/22). Those objects are applied
  outside `database/supabase/migrations`, so the CI database does not have them. Reused, not duplicated: enable,
  disable, pause and plan checks stay there; the step guard reads that state.
- Engine: `wf_agent_autonomy`, `wf_autonomy_guard`, `agent_ref` on runs, steps and templates (WF-03). `agent_ref`
  was free text; nothing validated it. AIN-01 adds the registry and makes it binding without touching the autonomy
  scale (AIN-02).
- Open PRs checked on 2026-11-20 for the same capability or name: none defines an agent registry; no open branch
  uses the table names `wf_agent`, `wf_agent_capability`, `wf_agent_tier_action_class`, `wf_agent_platform_grant`.
  Migration `20261117000970` and ADR-125 are free on every open branch (`..000960` is WF-12, `..001000` is used
  by #448, #461, #462 and #464; ADR numbers 116 and 121 are each used by more than one PR, not mine; the highest
  number in use is 124).

## Implemented

- Migration (inside `BEGIN`/`COMMIT`): `wf_agent` (42 rows), `wf_agent_capability` (188), `wf_agent_tier_action_class`
  (22), `wf_agent_platform_grant` (empty); constraints that restate the charter rules; the BEFORE INSERT step guard
  `wf_step_run_07_agent` and the BEFORE UPDATE `wf_step_run_07_agent_immutable` (review B1); `wf_agent_state_code`, `wf_agent_class_allowed`, `wf_ai_route_approved`,
  `wf_agent_registry_get`; the daily-count index; a grant audit trigger; rollback.
- Definitions: `frontend/src/lib/workforce-charter/engine-actors.ts` (pure), the generator
  `scripts/ops/generate-ain01-agent-seed.mjs` (writes or `--check`s the seed block in the migration).
- Tests: SQL harness, unit file (14 tests), concurrency and HTTP e2e. verify.yml has one harness step after
  WF-12's and one e2e line after WF-12's.
- Docs: ADR-125, one INDEX row, a runbook section.

## Existing tests and files changed

- `tests/integration/wf03-workflow-runtime.local.sql`, `wf06-actions`, `wf07-approval-inbox`, `wf08-run-history`,
  `wf12-quotas-retention` (harnesses) and `tools/sim-lab/load/wf06-action-e2e.mjs`, `wf07-approval-e2e.mjs`,
  `wf08-run-history-e2e.mjs`, `wf12-quota-e2e.mjs`: they ran steps under a made-up agent name. Since AIN-01 an agent
  step needs a registered identity, so each now registers one throwaway platform agent (ceiling T3, huge budget,
  no model use) granted to its organizations, right after it creates its autonomy rows. The harnesses share the
  helper `tests/integration/ain01-agent-fixture.sql`. The e2e agent names lost their dots (`wf06.e2e.agent...` is now
  `wf06-e2e-agent-...`) because the identity pattern has no dots. No assertion changed.
  `WF03`, `WF06 ALL PASS: 29 checks`, `WF07 ALL PASS: 96 checks`, `WF08 ALL PASS: 113 checks` and
  `WF12 ALL PASS: 213 checks` are the same before and after.
- `.github/workflows/verify.yml`: two additions after WF-12's (harness step, e2e line).
- `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`: regenerated by the quarantine script
  for the migration (32 hits, ADR-125). The hits are the school words in the 17 organization agents' capability
  names and codes (attendance, admission, timetable, ...), which come from the existing ADR-095 definitions.
- `architecture/adr/INDEX.md` (one row), `docs/runbooks/workflows-enablement.md` (one section).

## Evidence (20 Nov 2026, local PostgreSQL 16 on a fresh database with every migration applied)

- `AIN01 ALL PASS: 136 checks` (`tests/integration/ain01-agent-actors.local.sql`).
- Regression on the same database with AIN-01 applied: `WF01 ALL PASS: 92 checks`, `WF02 ALL PASS: 24 checks`,
  `WF03 ALL PASS: runtime claims, autonomy cap, grants and audit`, `WF05 ALL PASS: 23 checks`,
  `WF06 ALL PASS: 29 checks`, `WF07 ALL PASS: 96 checks`, `WF08 ALL PASS: 113 checks`, `WF12 ALL PASS: 213 checks`.
- Default-privileges rehearsal (as the new CI step, AIN-01 rolled back and re-applied with Supabase default privileges
  in force for the migrator): `AIN01 ALL PASS: 136 checks` and `AIN01-PRIV ALL PASS: 124 checks`. The WF-08/WF-12
  privilege step passes with AIN-01 present: `WF08 ALL PASS: 113 checks`, `WF12 ALL PASS: 213 checks`,
  `WF12-PRIV ALL PASS: 32 functions checked`.
- Rollback rehearsal on a fresh database: the rollback refuses while a platform grant exists (seen after the e2e
  left grants); with none, it removes every AIN-01 function, table, trigger and index; the original WF-03, WF-06,
  WF-07, WF-08 and WF-12 harnesses (from the base commit) pass again (`29`, `96`, `113`, `213` checks); re-applied,
  all pass and `AIN01 ALL PASS: 136 checks`.
- `AIN01-E2E RESULT: budget=5 concurrent=20 inserted=5 refused=15 over_budget=0 replay_refused=0 paused_inserted=0
ungranted_inserted=0 ai_inserted=0 registry_org_agents=17 cross_org_leak=0 sent_live=0 dup=0`. Sensitivity check:
  with the advisory lock removed from the guard in the local database, the same run inserted 13 steps against a
  budget of 5 and failed; the lock was restored. Existing e2e unchanged with AIN-01 applied:
  `WF06-E2E RESULT: in_app_sandbox=1 drafts=1 refused_live=1 sent_live=0 dup=0`,
  `WF07-E2E RESULT: approved_dispatched=1 single_approval_dispatched=0 rejected_dispatched=0 expired_dispatched=0 refusals=11 sent_live=0 dup=0`,
  `WF08-E2E RESULT: cancelled_dispatched=0 retried_dispatched=1 retry_runs=1 refusals=7 sent_live=0 dup=0`,
  `WF12-E2E RESULT: hourly_executed=2 daily_runs=2->4 purged_runs=4 kept_pending_approvals=1 refusals=8 sent_live=0 dup=0`.
- Unit tests: `tests/unit/ain01-engine-actors.test.ts`, 14 tests (seed drift, charter invariants, organization codes
  equal the applied catalogue, purity, migration hygiene). Full `tests/unit` run: see the PR for the final count.
- `tsc --noEmit`, ESLint and Prettier on every changed ts/mjs/md file: clean.
- Guards: `verify-domain-neutrality` PASS (after the quarantine above), `verify-provenance-metadata` PASS,
  `verify-migration-grants` PASS.
- CI on PR #473, head `7303497ebc4f9e4eb28acfed65ac2f543fed1321` (PostgreSQL 17, CI sim DB): Unit tests, Typecheck,
  Lint, Registry/drift/neutrality/secrets guards + build, Migration dry-run + sim smoke (includes the AIN-01 harness
  and e2e steps), RLS isolation battery, Secret scan, Mobile typecheck, Workspace shell E2E, Role management UI
  screenshots, Vercel preview: all success. Production deploy, Supabase Preview, restore drill: skipped.

## Review round 1 (coordinator review of head 6b1a033)

- B1 fixed: the class gate ran only on INSERT. `wf_step_run_07_agent_immutable` now rejects any change to
  `action_class`, `kind` or `agent_ref` of an existing step (plain UPDATE and the `INSERT ... ON CONFLICT DO UPDATE`
  path, as the service role, for agent and agentless steps). Harness cases cover both paths, the same-value positive
  twins, and the `DO NOTHING` replay. With the trigger disabled the harness fails on the first case.
- Note 4 fixed: the AI tripwire also refuses `action_class = 'ai_model'` (kinds action and notify, agent or none).
- Note 1 fixed: the rollback header no longer claims a check on steps; it checks grants only.
- Stacking: merged `claude/wf-12-quotas-retention` (1b998f41, service_role over-grant fix) with a merge commit. CI has
  a new step that applies AIN-01 under Supabase default privileges and asserts the ACLs
  (`tests/integration/ain01-default-privileges.local.sql`: service_role SELECT only on the four tables, EXECUTE only on
  `wf_agent_registry_get` and `wf_ai_route_approved`, nothing for anon, authenticated or PUBLIC). The two functions
  were added to the WF-12 list in `wf12-default-privileges.local.sql`.
- Documented as accepted limitations or follow-ups (ADR-125): pause blocks new steps only (note 2); `wf_run.agent_ref`
  stays mutable by the service role, pre-existing (3); the budget scope is per organization and agent (5); capability
  fields are informational (6); ENGINE-20 state is service-role writable and outside the migrations folder (7); a plan
  downgrade is read at the next new step (8).

- CI on PR #473 after review round 1, head `ef7e82df9fb8db971c2137308bc8fd9252144319` (merge of WF-12 `1b998f41`):
  Unit tests, Typecheck, Lint, guards + build, Migration dry-run + sim smoke (includes the AIN-01 harness, e2e and the
  new default-privileges step), RLS isolation battery, Secret scan, Mobile typecheck, Workspace shell E2E, role UI
  screenshots, Vercel preview: all success; production deploy, Supabase Preview, restore drill skipped.

## Not verified

- A hosted Supabase, including PostgREST exposure of the new functions and the apply as the `postgres` role (the
  local runs used a non-superuser migration role with BYPASSRLS and a superuser harness role). PostgreSQL 17 is
  covered only by CI.
- The organization add-on state against production. The guard reads `org_agent_addon_events` by name and the
  harness uses a stub with the shape of the reviewed source (`database/proposals/ENGINE-20_...sql`). Whether the
  production table has exactly that shape was not checked (no production access was used).
- Two-session concurrency is covered only by the local e2e (20 connections, one organization and agent). Other
  agents, other organizations at the same instant and very large step counts were not tested. The daily count is an
  indexed range scan per insert; no timing at production volume.
- What a refused step does to the runtime: a refusal inside `wf_create_event_run` fails event processing, so such
  an event is retried and eventually dead-lettered. The sim e2e ran only allowed paths through the runtime. A
  graceful deferral (as WF-12 does for the daily run quota) is not built.
- The tier-to-class table, the 24-hour window and one budget unit per step are my engineering defaults, not
  reviewed policy.
- Model-call and cost budgets are stored, not enforced: there is no model call to meter before WF-11.
- No screen, no server function and no UI: the registry is reachable only through `wf_agent_registry_get` (SQL,
  service role). AIN-05 owns the console.
- The `engine-actors.ts` definitions were checked against the packs and charters of this branch, not against any
  later pack change.

## Founder decisions needed

1. Decision 3 (AI route): unchanged and still blocking WF-11. Until it is made, `wf_ai_route_approved()` stays
   false and no `ai` step can exist. Replacing the function is a reviewed migration.
2. Ratify or change the tier-to-class table (T0 internal and waits; T1 adds tasks, unclassified and `ai_model`; T2 adds
   communications; T3 adds the six capped classes), including that `unclassified` actions are allowed from T1
   because the autonomy guard already caps them at draft.
3. Confirm that no internal (Sherivs) agent may act inside any tenant until WF-13 designates the platform tenant
   and adds a sheriff-gated grant path. Today the grant table is empty and has no write path except a migration.
4. Confirm that organization agents are switched on only through the existing add-on state (plan-gated by
   `change_org_agent`) and that the engine adds no second switch. Note the add-on objects are not in the migrations
   folder, so a database built only from the folder cannot run an organization agent; bringing them into the folder
   (or the engine reading a mirrored table) is a follow-up.
5. Migration number `20261117000970` (WF-12 uses `..000960`; `..001000` is used on other branches) and
   `BEGIN`/`COMMIT` inside the migration, as in WF-08 and WF-12.
6. The e2e and harness fixture changes above (agent names, one registered throwaway agent each).
