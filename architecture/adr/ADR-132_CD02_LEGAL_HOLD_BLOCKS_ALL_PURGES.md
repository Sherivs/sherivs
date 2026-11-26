# ADR-132: Any Active Legal Hold Blocks All Workflow Purges (CD-02)

| Field      | Value                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| Status     | PROPOSED in the CD-02/03 PR; nothing applied to any hosted database               |
| Date       | 2026-11-26                                                                         |
| Creator    | Claude Code agent, missions CD-02 and CD-03; AI-generated                          |
| Decision   | Founder, Decision Pack consent agenda, 26 Nov 2026 ("decide as a cautious CTO would") |
| Depends on | [ADR-124](ADR-124_WF12_QUOTAS_WALLET_CAPS_RETENTION.md)                            |
| Migration  | `database/supabase/migrations/20261117000961_sherivs_cd02_legal_hold_blocks_all_purges.sql`                                                  |
| Rollback   | `database/supabase/rollbacks/20261117000961_sherivs_cd02_legal_hold_blocks_all_purges.sql`                                                   |

## Context

WF-12 refused a purge only for tenant and category holds, and read a missing hold register as "no hold". A subject or record hold (a single learner or record under legal hold) did not stop the organisation's workflow purge, and an unreadable register failed open.

## Decision

`wf_retention_legal_hold(org)` is true when the organisation has ANY active hold (tenant, category, subject or record), and also when the register cannot be read. Both the dry run and the purge refuse with `legal_hold` and log it, as before.

## Consequences

- Cautious by design: one record hold pauses workflow purges for the whole organisation until it is released. Workflow data is operational history, so the cost is storage, not compliance risk.
- Counsel confirms whether a narrower rule is acceptable (UNVERIFIED legal question; this ADR is not legal advice).
- No other purge path (M12 tombstones) is changed.
