# AIN-03: Tenant Memory and Context Scopes, Audited Writes and Retention

Authority: workflow hand-off roadmap (17 Nov 2026), Phase 2 entry AIN-03; standing written approval for the build cycle; the founder's rules in the hand-off master prompt.
Origin: Claude Code agent, mission AIN-03 (issue #476)
Creator: Claude Code agent
Created: 2026-11-20

Status: Draft implementation (PR stacked on #475, #473, #471, #469, #467, #455; issue #476); NOT APPLIED, not deployed. `WORKFLOWS_ENABLED` is untouched. No model was called and nothing was sent. Review round 1 (the five findings of the coordinator review, 2026-11-25) is implemented on this branch: see "Review round 1" and the re-run evidence below.

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
  `wf_memory_change`; `wf_memory_value_ok`, `wf_memory_org_item_cap`, `wf_memory_org_proposal_cap`, `wf_memory_agent_daily_proposals`; the guard
  `wf_memory_item_guard` (insert and update, so also every upsert), `wf_memory_item_delete_guard`,
  `wf_memory_item_audit`; the write window helpers; the six entry points; privileges; rollback.
- `frontend/src/lib/workflow/tenant-memory.ts` (pure): scopes, caps, the value shape and a write pre-check.
- Tests: SQL harness, ACL test, unit file (15 tests), concurrency e2e.
- `verify.yml`: a default-privileges step (AIN-03 rolled back, Supabase default privileges switched on for the migrator,
  re-applied, harness and ACL test run), a harness step, one e2e line after AIN-02's; the AIN-01 default-privileges step
  now undoes and re-applies AIN-03 around AIN-02 and AIN-01 (AIN-03 has a foreign key to `wf_agent`).
- `wf12-default-privileges.local.sql`: the six entry points added to the allow-list.
- Docs: ADR-127, one INDEX row, a runbook section.

## Lessons applied

- (a) Default privileges: every table and function is revoked from PUBLIC, anon, authenticated and service_role before
  any grant; the service role has NO privilege on `wf_memory_item` and SELECT only on the ledger and the reference data;
  EXECUTE only on the six entry points; the nine internal functions are executable by nobody. Proved under
  `ALTER DEFAULT PRIVILEGES FOR ROLE sim_migrator ... TO anon, authenticated, service_role`, with an ACL test whose
  failure was shown by granting one privilege back.
- (b) Guards cover UPDATE and upsert: one BEFORE INSERT OR UPDATE trigger; the lifetime cap, the identity, the status
  machine, the version and the agent rules are checked on the update half too. Harness cases use
  `INSERT ... ON CONFLICT DO UPDATE` for the lifetime, the shape, the scope move and the proposal-goes-live paths.
- (c) SQL is the backstop for every cap in code: item cap per scope, 2000 per organization, 50 proposals per agent per
  day, value shape and size, lifetimes. Hand-opened write windows in the harness simulate a faulty function.
- (d) No earlier assertion was weakened. Review round 1 changed some existing harness assertions to the reviewed behaviour; each is listed under "Existing tests and files changed".

## Existing tests and files changed

- `tests/integration/wf12-default-privileges.local.sql`: six functions added to the allow-list (the header comment names
  AIN-01 and AIN-03). No assertion removed.
- `.github/workflows/verify.yml`: the additions listed above; the AIN-01 default-privileges step also undoes and
  re-applies AIN-03.
- `architecture/adr/INDEX.md` (one row), `docs/runbooks/workflows-enablement.md` (one section).
- No change to any WF or AIN-01 or AIN-02 harness, e2e script or migration.
- Review round 1 (2026-11-25) changed these existing AIN-03 assertions, all to follow a reviewed behaviour change and none
  loosened without a replacement:
  - helper `ain03t.live()` counted every non-retired row; it now counts active, unexpired rows (the organization cap no
    longer counts waiting proposals);
  - the internal-function count 8 became 9 and `wf_memory_org_proposal_cap` joined the allow-list; the function count 14
    became 15; the cap check also asserts `wf_memory_org_proposal_cap() = 200`;
  - "the write left one ledger row (write, person, a hash and no content)" now asserts a `reference` write leaves
    `value_sha256` NULL (a reference value has no hash any more);
  - "the ledger holds the hash of a value ... (spot check)" asserted the plain SHA-256 of a `reference` value, which is
    the defect; it is replaced by the item 2 assertions (a note's hash is salted and is not the plain hash, no ledger
    row of any item holds a plain hash, a reference has none, retire and purge leave nothing recomputable);
  - `ain03-default-privileges.local.sql`: `wf_memory_org_proposal_cap()` added to the no-one-may-execute list;
  - `tests/unit/ain03-tenant-memory.test.ts`: function count 14 became 15, the proposal cap constant is asserted, and a
    new test requires the rollback to drop every function and table the migration creates (the first version of this fix
    forgot `wf_memory_org_proposal_cap()` in the rollback; the new test fails without that line).

## Evidence

Re-run on 25 Nov 2026 after review round 1, on local PostgreSQL 16, every migration applied as a non-superuser migrator
(the figures from 20 Nov are superseded: harness 217 became 254 checks, ACL test 148 became 153, unit 14 became 15 tests).

- `AIN03 ALL PASS: 254 checks` (`tests/integration/ain03-tenant-memory.local.sql`; 217 earlier checks, 34 for the five
  review items in section 12b, 3 for rejecting a proposal under a legal hold; the same count after rollback and
  re-apply under Supabase default privileges).
- `AIN03-PRIV ALL PASS: 153 checks` (`tests/integration/ain03-default-privileges.local.sql`).
- `AIN03-E2E RESULT: proposals=60 proposed=50 refused=10 over_cap=0 same_key=30 same_key_inserted=1 puts=20 live_after_puts=1 version_after_puts=20 org_scope_writes=320 org_scope_inserted=300 org_scope_refused=20 accepts=10 accepted=1 mixed_winners=1 purged=10 writes_during_purge=15 direct_write_refused=4 member_sees_other_org=0 sent_live=0 dup=0` (plain `pg`, no PostgREST; identical to the line CI expects, so `verify.yml` needs no change).
- Regression with AIN-03 applied (review round 1), same database: `WF01 ALL PASS: 92 checks`, `WF02 ALL PASS: 24 checks`,
  `WF03 ALL PASS`, `WF05 ALL PASS: 23 checks`, `WF06 ALL PASS: 29 checks`, `WF07 ALL PASS: 96 checks`,
  `WF08 ALL PASS: 113 checks`, `WF12 ALL PASS: 213 checks`, `AIN01 ALL PASS: 136 checks`,
  `AIN02 ALL PASS: 193 checks` (the 20 Nov record of 184 was stale: AIN-02's review round added 9).
- The CI default-privileges steps, rehearsed locally in scratch databases: AIN-01 step (AIN-03, AIN-02 and AIN-01 rolled
  back with the rollback files of this branch, Supabase default privileges switched on for the migrator, all three
  re-applied: `AIN01 ALL PASS: 136`, `AIN01-PRIV ALL PASS: 124`, `AIN02 ALL PASS: 193`, `AIN02-PRIV ALL PASS: 241`,
  `AIN03 ALL PASS: 254`, `AIN03-PRIV ALL PASS: 153`), the AIN-03 step, and the WF-12 allow-list
  (`WF12-PRIV ALL PASS: 41 functions checked`).
- Rollback rehearsal: rolled back (no AIN-03 object left), re-applied, `AIN03 ALL PASS: 254 checks`. After the e2e the
  rollback refuses (`memory items or ledger rows exist`). The first version of review round 1 omitted
  `DROP FUNCTION public.wf_memory_org_proposal_cap()` from the rollback, which made the next re-apply fail
  ("function already exists"); found by the mutation runs, fixed, and now caught by a unit test.
- Sensitivity, round 1 (nine mutations of the migration, each applied in a scratch database and each failing the
  harness): proposal cap removed; organization cap counts proposals again; plain hash back for references; salt kept on
  retire; purge window starvation back; hold check off in the guard; hold check off in the delete guard; expired agent
  row blocks again; notes hashed without the salt. Earlier mutations of 20 Nov (agent content-fixed rule, update-time
  lifetime check, AI-route check, daily cap, acceptance-actor check, insert-actor check, delete guard widened, legal hold
  ignored, organization cap, agent-scope rule) were not repeated. The e2e failed with the advisory lock removed on 20
  Nov and was not re-tried.
- Unit: `ain03-tenant-memory.test.ts` 15 passed (new: the rollback drops every function and table; failing when the
  `DROP FUNCTION public.wf_memory_org_proposal_cap()` line is removed); `tsc --noEmit`, eslint and prettier clean on the
  changed files.
- Guards (25 Nov, local): `verify-domain-neutrality` STATUS=PASS (no new hit), `verify-migration-grants` STATUS=PASS,
  `verify-provenance-metadata` exit 0 (advisory only). `verify-migration-ledger` was not checked (it needs a read-only
  database connection; nothing was checked against any database).

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
