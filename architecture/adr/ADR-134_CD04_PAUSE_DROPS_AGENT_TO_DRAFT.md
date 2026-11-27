# ADR-134: A Pause Drops an Agent to Draft, and Rising Again Needs Fresh Evidence (CD-04)

| Field      | Value                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| Status     | PROPOSED in the CD-04 PR; nothing applied to any hosted database                            |
| Date       | 2026-11-26                                                                                  |
| Creator    | Claude Code agent, mission CD-04; AI-generated                                              |
| Decision   | Founder, Decision Pack consent agenda, 26 Nov 2026 ("decide as a cautious CTO would")       |
| Depends on | AIN-02 (autonomy scale and promotion gate), ENGINE-16 (agent pause state)                   |
| Migration  | `database/supabase/migrations/20261117000981_sherivs_cd04_pause_drops_to_draft.sql`          |
| Rollback   | `database/supabase/rollbacks/20261117000981_sherivs_cd04_pause_drops_to_draft.sql`           |

## Context

A pause stops an agent from running (AIN-01) but left its earned level untouched. Resuming it handed back
whatever autonomy it had before, on evidence that predates the reason for the pause.

## Decision

An AFTER INSERT trigger on `agent_pause_events` (pause events only) lowers every agent that is now paused, has a
pause rule, and holds more than `draft`, to `draft` in every organisation. It goes through the AIN-02 apply path as a
ledger `demote` decided by the person who paused, so the existing rule "evidence is superseded by a later
demotion" makes all evidence evaluated before the pause unusable. Rising again needs the founder, one rung, and
evidence evaluated after the pause. Resuming restores nothing.

## Consequences

- Agents without a pause rule are never demoted by a pause (`is_agent_paused` reads those as paused).
- A pause of `all` or of a cascading agent drops everything it covers, in one transaction with the pause event.
- Levels at `suggest` or `draft` are untouched; the drop never raises anything.
- The ledger is the audit trail; no new table.
