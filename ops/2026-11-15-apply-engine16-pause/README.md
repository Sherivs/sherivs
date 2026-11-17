# Apply the agent pause state to production (2026-11-15)

Applied at the founder's instruction. The migration is `database/supabase/migrations/20261115000800_sherivs_engine16_agent_pause_state.sql`, the ENGINE-16 proposal with two changes, both disclosed: the append-only trigger function now has `SET search_path = pg_catalog` and public execute revoked (otherwise it would recreate the advisor warning SEC-02 cleared), and the transaction wrapper is removed.

Verified in production inside a rolled-back transaction: 25 rules; an unknown agent reads as paused (fail closed); a pause on the executive cascades to departments but not to assurance agents; UPDATE and DELETE on the event log are refused; anon cannot execute the trigger function.

Not applied: ENGINE-13 (agent workspace scopes). The migration call timed out on a server prompt that went unanswered and nothing was written. It is still in `database/proposals/`.

Rollback: `database/supabase/rollbacks/20261115000800_sherivs_engine16_agent_pause_state.sql`.
