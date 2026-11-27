# ADR-129: Agent Console, Read Models for Agents, Memory Proposals and Output Review (AIN-05)

| Field          | Value                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the AIN-05 PR; nothing applied to any hosted database                                                                                  |
| Date           | 2026-11-26                                                                                                                                         |
| Creator        | Claude Code agent, mission AIN-05 (provenance id A-001, issue #504); AI-generated                                                                  |
| Version target | V1 organizational workflows, Phase 2 (AI-native core)                                                                                              |
| Depends on     | ADR-125 (agents as actors), ADR-126 (autonomy and promotion gate), ADR-127 (tenant memory), ADR-128 (evaluation and guardrail layer)              |
| Migration      | `database/supabase/migrations/20261117000996_sherivs_ain05_agent_console_read_models.sql` (the founder confirms the number before apply)            |
| Rollback       | `database/supabase/rollbacks/20261117000996_sherivs_ain05_agent_console_read_models.sql`                                                           |

## Provenance

| Item                   | Source                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement            | Issue #504; the AIN-05 roadmap entry ("agent console") in the workflow hand-off                                                                               |
| Existing work checked  | AIN-01..04 write paths already exist and are audited; no read model for people exists. The console adds reads and a screen, and calls the existing writes.     |
| Open founder decisions | 3 (AI route) is respected: the screen says plainly while the route is closed. 9 (only the founder promotes) is respected: the console has no promote control. |

## Context

AIN-01..04 built agents, levels, memory and screening, all behind service-role functions. A person who runs a school
cannot see any of it. The console gives a manager one place to see which agents work for the organisation and what each
has earned, to decide the memory proposals that agents make, and to review outputs the screener flagged.

## Decision

1. Three read functions, `wf_console_agents`, `wf_console_memory_list` and `wf_console_safety_list`: SECURITY DEFINER, empty
   `search_path`, EXECUTE for the service role only, no table added, nothing written. Each takes the verified person and
   decides for that person's own organisation.
2. Permissions are the existing ones. Viewing agents and output checks needs `workflows.view`; the memory list needs
   `workflows.manage` (it shows values); reviewing needs `workflows.approve` and a person who did not start the run.
3. What is shown is allow-listed. Agents: level, ceiling, next rung and its bar, the latest evaluation's numbers, five recent
   changes as kind, from, to and time (no reason, no person), use in 24 hours, budget. Memory: key, scope, status, source, the
   short value a manager may already read. Output checks: codes, size, verdict, decision and time; never the text or its hash.
4. The numbers against the bar are information. `meets_bar` repeats the AIN-02 test on the latest evidence; the promotion
   guard stays the authority.
5. Writes go through the existing audited functions: accept, reject and retire a memory item; clear or reject a flagged
   output; lower an agent's level. The person picks a reason from a fixed list and the server sends a fixed sentence, so free
   text never reaches a ledger. Raising a level is not offered: only the founder promotes, on evidence.
6. Evidence is recorded per agent, not per organisation (AIN-02). The console shows the same latest numbers to every
   organisation that has the agent. They are aggregate counts only.

## Consequences

- Positive: a manager can see and act without a database tool; no new write path, no new table, nothing to backfill.
- Negative: the screen is not exercised in a browser by CI here; promotion has no screen yet (a founder surface is a
  follow-up). Reading platform agents' evidence is shared across organisations by design of AIN-02.
- Rollback drops three functions and touches nothing else.

## Golden questions

WHO: a person with the permission above, in their own organisation. WHAT: reads, plus calls to existing audited writes.
WHERE: SECURITY DEFINER functions, service-role callable only. WHEN: on request; nothing runs on a schedule. WHY: so people
can supervise agents. HOW SAFE: no text of an output, no raise of level, no free text, no cross-tenant row.
