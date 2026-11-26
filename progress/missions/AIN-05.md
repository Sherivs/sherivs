# AIN-05: Agent Console (Read Models and Screen)

Authority: workflow hand-off roadmap (17 Nov 2026), Phase 2 entry AIN-05; standing written approval for the build cycle; the founder's rules in the hand-off master prompt.
Origin: Claude Code agent, mission AIN-05 (issue #504)
Creator: Claude Code agent
Created: 2026-11-26

Status: Draft implementation (PR stacked on #479 and the earlier stack; issue #504); NOT APPLIED, not deployed. `WORKFLOWS_ENABLED` is untouched. No model was called and nothing was sent.

| Field     | Value                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------- |
| Decision  | [ADR-129](../../architecture/adr/ADR-129_AIN05_AGENT_CONSOLE.md)                               |
| Migration | `database/supabase/migrations/20261117000996_sherivs_ain05_agent_console_read_models.sql`      |
| Rollback  | `database/supabase/rollbacks/20261117000996_sherivs_ain05_agent_console_read_models.sql`       |
| Base      | PR #479 (AIN-04) head `2f0e7e0a`-line stack; see the PR for the exact head                      |

## Step 1: could it be built now?

Yes. It needs no founder decision: decision 3 (AI route) stays respected (the screen says the route is closed), decision 9
(only the founder promotes) is respected (no promote control exists), and no paid service is involved.

## Implemented

- Three read functions: `wf_console_agents`, `wf_console_memory_list`, `wf_console_safety_list` (SECURITY DEFINER, empty
  search_path, service role only, no table, no write). Errors use the `ain05:` prefix.
- Server operations and functions (`agent-console.ts`, `.server.ts`, `workflow-agent-console.functions.ts`): strict parsers,
  safe sentences for every database code, fixed reason sentences (10 to 300 characters), the verified person from the session.
- A lazy screen with three tabs (agents, memory, output review), confirmations, a banner while the AI route is closed, and a
  menu entry and route (`/home/s/agent-console`).
- Docs: ADR-129, the ADR index, the runbook section.

## Names

The functions are `wf_console_*`, not `wf_agent_*`, `wf_memory_*` or `wf_safety_*`: AIN-01, AIN-03 and AIN-04 assert the exact
set of functions under those prefixes, and a console function under them would break those checks.

## Evidence (26 Nov 2026; local PostgreSQL 16.15, every migration applied as a non-superuser migrator)

- Harness `ain05-agent-console.local.sql`: `AIN05 ALL PASS: 60 checks`.
- Privileges under Supabase default privileges (the CI step re-run locally): `AIN05 ALL PASS: 60 checks`,
  `AIN05-PRIV ALL PASS: 17 checks`; the WF-08/WF-12 privilege step still passes with three new allow-listed functions
  (`WF12-PRIV ALL PASS: 48 functions checked`).
- Earlier harnesses unchanged and passing on this tip: WF07 98, WF08 131, WF12 214, AIN01 136, AIN02 205, AIN03 254, AIN04 173.
- Sim e2e `ain05-console-e2e.mjs`: `AIN05-E2E RESULT: concurrent_reads=60 read_ok=60 proposals=20 pending_before=20 decided=20 reads_during_decides_failed=0 pending_after=0 tenant_leaks=0 plain_refused=3 client_refused=3 reads_changed_rows=0 sent_live=0 dup=0`.
- Unit tests: `ain05-agent-console.test.ts`, `ain05-agent-console-static.test.ts`, and the P08 enforcement surface test.
- Type check: no errors in the new or changed files.

## Not verified (UNVERIFIED)

- The screen was not rendered in a browser and has no screenshot test. It is typed, linted by the type check, and wired,
  but its layout, focus order and mobile fit are unchecked.
- PostgreSQL 17 and a hosted Supabase project were not used. Nothing was applied to any hosted database.
- The full unit suite was not run in the worktree (missing `expo`, as for the other missions). Only the new and the affected
  files were run.
- Evidence is per agent, not per organisation (AIN-02): the console shows the same latest numbers to every organisation that
  has the agent. They are counts only. Whether that is acceptable once many tenants share a platform agent is a founder call.
- `meets_bar` is information. It repeats the test on the latest evidence but not the supersession rule; the promotion guard
  is the authority.
- There is no promotion screen. Promotion stays a founder action (a founder has no organisation, so this console cannot show
  them an organisation's agents). A founder surface is a follow-up.
- The demotion path reads the caller's own `users` row to find the organisation; the database re-checks it.
- No independent adversarial review has been done yet. One is required before merge.

## Founder decisions needed

None new. The open ones (3, 2, 4, 7, per-mission ratification, the `super_admins` write question) are unchanged.
