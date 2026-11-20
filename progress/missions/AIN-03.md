# AIN-03: Tenant Memory and Context Scopes, Audited Writes and Retention

Authority: workflow hand-off roadmap (17 Nov 2026), Phase 2 entry AIN-03; standing written approval for the build cycle; the founder's rules in the hand-off master prompt.
Origin: Claude Code agent, mission AIN-03 (issue #476)
Creator: Claude Code agent
Created: 2026-11-20

Status: Draft implementation (PR stacked on #475, #473, #471, #469, #467, #455; issue #476); NOT APPLIED, not deployed. `WORKFLOWS_ENABLED` is untouched. No model was called and nothing was sent.

| Field     | Value                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| Decision  | [ADR-127](../../architecture/adr/ADR-127_AIN03_TENANT_MEMORY_AND_CONTEXT_SCOPES.md)          |
| Migration | `database/supabase/migrations/20261117000990_sherivs_ain03_tenant_memory_context_scopes.sql` |
| Rollback  | `database/supabase/rollbacks/20261117000990_sherivs_ain03_tenant_memory_context_scopes.sql`  |
| Base      | PR #475 head `cb9b7ec8` (AIN-02 mission file), stacked on #473, #471, #469, #467, #455       |

## Step 1: could it be built now?

Yes, as a provider-free slice. The mission stores what a tenant wants remembered, decides who may write it, how long
it lives and who may read it. It adds no paid service or account, calls no model and gives no tenant data to any AI.

- Decision 3 (AI route) does not block the build and stays respected: the only agent read path
  (`wf_memory_agent_read`) fails with `ain03:ai_route_closed` while `wf_ai_route_approved()` (AIN-01) is false. WF-11
  stays blocked for tenant data. Nothing in the engine can read a stored memory value at all: the service role has no
  privilege on the table.
- Decision 9 (only the founder promotes an agent) is untouched; nothing here writes `wf_agent_autonomy`. An agent can
  only PROPOSE memory and a person accepts it, which is at least as strict as the `draft` cap whatever the agent earned.
- Decisions 2, 4 and 7 are untouched. Decision 7 (minors, lawful basis) bounds what may be stored: see "Founder
  decisions needed".

So no "blocked on decision N" issue was written.

## Existing work found

- No `wf_memory*` object, tenant memory table or open PR for the capability. ENGINE-13 (`database/proposals`,
  `agent_memory` scope rows) and the twin proposals are platform-side, unapplied and have no tenant anchor, so they were
  not extended.
- Reused, not duplicated: `wf_org_settings` (tenant anchor and the `workflows_enabled` switch), `wf_agent` and
  `wf_agent_state_code` (AIN-01), `wf_ai_route_approved` (AIN-01), `wf_act_as` / `wf_act_restore` / `wf_can` (WF-07, WF-01),
  `wf_audit_append`, `wf_append_only`, `wf_retention_legal_hold` (WF-12, reads M12 `retention_legal_holds`).
- Open PRs checked on 2026-11-20: #475, #473, #471, #469, #467, #464, #463, #462, #461, #460, #459, #455, #452, #449, #448,
  #439, #438, #437, #436, #435, #434, #433, #423, #422 and the dependabot PR. None defines tenant memory or uses the
  names `wf_memory*`. Migration `20261117000990` and ADR-127 are free on every open branch (`..000980` is AIN-02, ADR-126
  is AIN-02; `..001000` is used by other PRs; the highest ADR in use is 126).

## Implemented

- Migration (inside `BEGIN`/`COMMIT`): `wf_memory_scope_kind` (4 reviewed rows), `wf_memory_item`, the append-only
  `wf_memory_change`; `wf_memory_value_ok`, `wf_memory_org_item_cap`, `wf_memory_agent_daily_proposals`; the guard
  `wf_memory_item_guard` (insert and update, so also every upsert), `wf_memory_item_delete_guard`,
  `wf_memory_item_audit`; the write window helpers; the six entry points; privileges; rollback.
- `frontend/src/lib/workflow/tenant-memory.ts` (pure): scopes, caps, the value shape and a write pre-check.
- Tests: SQL harness, ACL test, unit file (14 tests), concurrency e2e.
- `verify.yml`: a default-privileges step (AIN-03 rolled back, Supabase default privileges switched on for the migrator,
  re-applied, harness and ACL test run), a harness step, one e2e line after AIN-02's; the AIN-01 default-privileges step
  now undoes and re-applies AIN-03 around AIN-02 and AIN-01 (AIN-03 has a foreign key to `wf_agent`).
- `wf12-default-privileges.local.sql`: the six entry points added to the allow-list.
- Docs: ADR-127, one INDEX row, a runbook section.

## Lessons applied

- (a) Default privileges: every table and function is revoked from PUBLIC, anon, authenticated and service_role before
  any grant; the service role has NO privilege on `wf_memory_item` and SELECT only on the ledger and the reference data;
  EXECUTE only on the six entry points; the eight internal functions are executable by nobody. Proved under
  `ALTER DEFAULT PRIVILEGES FOR ROLE sim_migrator ... TO anon, authenticated, service_role`, with an ACL test whose
  failure was shown by granting one privilege back.
- (b) Guards cover UPDATE and upsert: one BEFORE INSERT OR UPDATE trigger; the lifetime cap, the identity, the status
  machine, the version and the agent rules are checked on the update half too. Harness cases use
  `INSERT ... ON CONFLICT DO UPDATE` for the lifetime, the shape, the scope move and the proposal-goes-live paths.
- (c) SQL is the backstop for every cap in code: item cap per scope, 2000 per organization, 50 proposals per agent per
  day, value shape and size, lifetimes. Hand-opened write windows in the harness simulate a faulty function.
- (d) No earlier assertion was weakened: no existing test file changed except the allow-list line additions below.

## Existing tests and files changed

- `tests/integration/wf12-default-privileges.local.sql`: six functions added to the allow-list (the header comment names
  AIN-01 and AIN-03). No assertion removed.
- `.github/workflows/verify.yml`: the additions listed above; the AIN-01 default-privileges step also undoes and
  re-applies AIN-03.
- `architecture/adr/INDEX.md` (one row), `docs/runbooks/workflows-enablement.md` (one section).
- No change to any WF or AIN-01 or AIN-02 harness, e2e script or migration.

## Evidence (20 Nov 2026, local PostgreSQL 16, every migration applied as a non-superuser migrator)

- `AIN03 ALL PASS: 217 checks` (`tests/integration/ain03-tenant-memory.local.sql`; the same count after re-applying
  AIN-03 under Supabase default privileges).
- `AIN03-PRIV ALL PASS: 148 checks` (`tests/integration/ain03-default-privileges.local.sql`).
- `AIN03-E2E RESULT: proposals=60 proposed=50 refused=10 over_cap=0 same_key=30 same_key_inserted=1 puts=20 live_after_puts=1 version_after_puts=20 org_scope_writes=320 org_scope_inserted=300 org_scope_refused=20 accepts=10 accepted=1 mixed_winners=1 purged=10 writes_during_purge=15 direct_write_refused=4 member_sees_other_org=0 sent_live=0 dup=0` (plain `pg`, no PostgREST).
- Regression with AIN-03 applied, same database: `WF01 ALL PASS: 92 checks`, `WF02 ALL PASS: 24 checks`, `WF03 ALL PASS`,
  `WF05 ALL PASS: 23 checks`, `WF06 ALL PASS: 29 checks`, `WF07 ALL PASS: 96 checks`, `WF08 ALL PASS: 113 checks`,
  `WF12 ALL PASS: 213 checks`, `AIN01 ALL PASS: 136 checks`, `AIN02 ALL PASS: 184 checks`, `AIN02-E2E RESULT: ... dup=0`
  (unchanged line).
- The CI default-privileges steps, rehearsed locally in scratch databases: AIN-01 step with AIN-03 undone and re-applied
  around it (`AIN01 ALL PASS: 136 checks`, `AIN01-PRIV ALL PASS: 124 checks`, `AIN03-PRIV ALL PASS: 148 checks`), AIN-02 step
  (`AIN02 ALL PASS: 184 checks`, `AIN02-PRIV ALL PASS: 241 checks`), AIN-03 step, WF-08/WF-12 step with the extended list
  (`WF12-PRIV ALL PASS: 41 functions checked`, was 35).
- Rollback rehearsal: rolled back (no AIN-03 object left), `WF06`, `WF12`, `AIN01` and `AIN02` harnesses pass again, re-applied,
  `AIN03 ALL PASS: 217 checks`. After the e2e the rollback refuses (`memory items or ledger rows exist`).
- Sensitivity (mutations made in scratch databases, each killed by the harness): agent content-fixed rule off, update-time
  lifetime check off, AI-route check off in the read path, daily cap off, acceptance-actor check off, insert-actor check
  inverted, delete guard widened, legal hold ignored, organization cap off, agent-scope rule off. The e2e also fails
  with the per-organization advisory lock removed (`proposed=60`, `inserted=320`, `version=14`).
- Unit: `ain03-tenant-memory.test.ts` 14 passed; `tsc --noEmit`, eslint and prettier clean on the new files.
- Guards: `verify-domain-neutrality` PASS (no new hit, no quarantine needed), `verify-migration-grants` PASS,
  `verify-provenance-metadata` PASS.

## CI evidence

PR #477, head 169b5989 (includes a merge of AIN-02 review round 1, 638a6ef1; the first push cdac1578 got no CI because the base had moved and the PR was not mergeable). All check runs completed green: Migration dry-run + sim smoke (AIN-03 harness, ACL step and e2e), RLS isolation battery, Unit tests, Typecheck, Lint, Secret scan (gitleaks), Registry/drift/neutrality/secrets guards + build, Mobile typecheck, Workspace shell E2E, Role management UI screenshots, Vercel preview. Skipped by design: Vercel production deploy, Restore/recovery drill, Supabase Preview.

## Not verified

- The e2e scripts of AIN-01, WF-06, 07, 08 and 12 need PostgREST and were not run locally (AIN-02's and AIN-03's e2e run
  over plain `pg` and were). CI runs them.
- PostgreSQL 17 was used only in CI; locally PostgreSQL 16.
- A hosted Supabase: PostgREST exposure of the new functions and the apply as the `postgres` role (the local runs used a
  non-superuser migration role with BYPASSRLS and a superuser harness role). Nothing ran against a hosted database.
- The harness simulates the AI route being open by replacing `wf_ai_route_approved()` inside the rolled-back transaction;
  there is no real route to test against.
- The legal hold is exercised against the real `retention_legal_holds` table of this branch's migrations; its behaviour in
  production was not checked.
- No scheduler route, server function or UI calls the six entry points yet. Nothing was timed at production volume; the
  count queries behind the caps are indexed range scans per insert, serialized per organization by an advisory lock.
- Whether the engineering defaults (lifetimes, caps, 30-day retired window, 50 proposals a day) suit real tenants.
- The `reference` shape rule stops names and free text; it cannot tell that an id is itself personal.

## Founder decisions needed

1. Ratify or change the scope lifetimes and caps (organization 365/1095 d and 300 items; workflow 180/730 and 200; agent
   90/365 and 200; run 7/30 and 50; 2000 per organization; 50 proposals per agent per day).
2. Decision 7: may memory ever hold personal data of learners or guardians, and on what lawful basis? Until decided, do not
   store any (the shape rule is a floor, not a guarantee).
3. Decision 3 (AI route): unchanged and still blocking WF-11 and the agent read path. Opening `wf_memory_agent_read`
   needs a reviewed migration replacing `wf_ai_route_approved()`; even then only a person's `ai_readable` reference items
   are returned.
4. Whether an agent at a high earned level may ever have its proposals accepted automatically (v1: never).
5. Whether accepting a proposal needs passkey step-up (v1: no; the note is never readable by an agent).
6. Migration number `20261117000990` and `BEGIN`/`COMMIT` inside the migration (as AIN-01 and AIN-02).
