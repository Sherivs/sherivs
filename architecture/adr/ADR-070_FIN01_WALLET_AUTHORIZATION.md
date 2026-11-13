# ADR-070: Wallet Metering and Top-Up Are Server-Side Financial Operations With a Bounded Overdraft

|| Field | Value |
||---|---|
|| Status | PROPOSED (security review and operator approval before any production migration) |
|| Date | 2026-11-13 |
|| Author | Claude Code coding agent (Claude Sonnet 5.5) under the FIN-01 mission authorization of 2026-11-13. Corrects the PAYG wallet of migration `20261024000260_sherivs_019_wallet_ndpa_campus.sql` and the metering path that `comms_send` calls, delivered by `copilot-swe-agent[bot]` in PR #222 (issue #221). Follows the COMMS-03 financial review. |
|| Mission | FIN-01 — unauthorized wallet debit, overdraft, atomicity and audit of the school wallet |
|| Capabilities | V1 payments and communications metering; the organization wallet (`school_wallets`, `wallet_ledger`, `usage_events`, `term_usage_pools`) |
|| Supersedes-in-part | None. This ADR corrects the authorization and balance rules of the SHERIVS-019 wallet. It does not change prices, allowances, pools, refunds, plan entitlements (ENT-01) or SMS dispatch and charging semantics (COMMS-03). |
|| Cites | `database/supabase/migrations/20261104050000_sherivs_fin01_wallet_authorization.sql`; its rollback; `tests/integration/fin-01-wallet-authorization.local.sql`; `tests/integration/fin-01-wallet-concurrency.local.mjs`; ADR-069 (COMMS-03 review, on its own branch) findings F5 and F6 |
|| Minimal ownership artifact | `database/supabase/migrations/20261104050000_sherivs_fin01_wallet_authorization.sql` and its matching rollback |

## Context

The wallet is the only place the platform holds money on behalf of an organization. Top-ups are credited by the verified Paystack webhook. Every paid message is metered against it by `meter_usage`, which spends the term pool first and then the wallet at the price book.

A database built from the repository migrations, without this change, shows these defects. Each was reproduced by a failing test before any fix (`tests/integration/fin-01-wallet-authorization.local.sql`: 19 pass and 18 fail on the unfixed schema; `fin-01-wallet-concurrency.local.mjs`: 4 pass and 3 fail).

1. **Any signed-in user could debit the wallet.** `meter_usage` was executable by `authenticated`. Its in-function check admitted `ai_tutor.use`, and the legacy permission bridge grants that to every parent and student. The caller chose the item, the quantity, the reference and the priority. With `priority = 'safety'` the wallet may go negative, so one student call took a funded wallet to −NGN 999,000, and a second call by a parent took it to −NGN 1,999,000.
2. **The safety overdraft had no bound.** A call at the safety priority posted any amount. Thirty concurrent NGN 50 safety sends on an empty wallet all succeeded and left −NGN 1,500.
3. **Top-up credit relied on a single in-function check.** `wallet_credit_topup` was executable by `authenticated` and refused callers only inside its body.
4. **Concurrency.** Twelve concurrent calls with one reference produced eleven `23505` unique violations instead of a replay. Twelve concurrent sends for one student on a plan with a one-per-day cap metered nine, because the cap was read before any lock was held.
5. **Cross-organization attribution and blank input.** Usage could be recorded against a student of another organization. A blank reference, a NULL organization and an unknown item were accepted or failed late.
6. **Ledger direction.** The ledger accepted a `usage` line that adds money and a `topup` line that removes it. Usage events were not in the audit trail.

Properties that were already correct and are now pinned by tests as guards: concurrent ordinary debits never overdraw a wallet; the term pool and wallet charge are atomic; a top-up racing debits keeps the balance exact; `wallet_ledger` and `usage_events` are append-only even for the table owner; direct writes to the wallet tables are refused for API roles.

Production state, from a read-only catalog and aggregate check on 2026-11-13 (SELECT only, no customer data read): the exposure is **live at the privilege layer**. `meter_usage` is executable by `authenticated` and its body admits `ai_tutor.use`; `wallet_credit_topup` is executable by `authenticated`; the FIN-01 migration is not applied. There is nothing to drain today: production holds 0 wallets, 0 ledger lines, 0 usage events and 0 organizations, so there is no sign of exploitation and no balance to correct. The risk begins with the first onboarded organization, so the migration should be applied before onboarding.

## Options

### Option 1 — Fix only the in-function check (rejected)

Remove `ai_tutor.use` from the check and leave `meter_usage` executable by `authenticated`.

- **Consequences:** A signed-in teacher or admin could still debit the wallet at will, choose the priority, and exhaust the school's money. The permission model is the wrong control for a function whose only legitimate callers are the platform's own send path and trusted server code. It would also leave the unbounded safety overdraft.

### Option 2 — Rebuild metering as a second ledger or an application-layer service (rejected)

Move metering into an edge function with its own balance tracking.

- **Consequences:** It duplicates the wallet, the audit trail and the idempotency rules. The brief for this mission forbids a disconnected financial mechanism. The database already holds the balance, so the correction belongs there.

### Option 3 — Privilege the operation, lock per organization, bound the overdraft, constrain the ledger (ruled)

- Remove `authenticated`, `anon` and `PUBLIC` from `EXECUTE` on `meter_usage` and `wallet_credit_topup`; grant them to `service_role` only. `comms_send` (a `SECURITY DEFINER` function with the same owner) keeps calling `meter_usage`.
- Keep the in-function authorization as defense in depth, now `service_role` or `scholar_can(p_school, 'comms.send_class')`; `ai_tutor.use` is removed.
- Serialize all metering for one organization on its `school_wallets` row, taken first and always before the pool row, so the replay check, the daily cap, the pool arithmetic and the balance cannot race and no lock cycle forms. Advisory locks were rejected because they consume shared lock-table slots that a large broadcast transaction needs.
- Add `school_wallets.safety_overdraft_limit` (default NGN 1,000, never negative, `0` means never negative). `_wallet_post` refuses a usage line that would take the balance below `−limit`. Only platform staff change the limit, through `wallet_set_safety_overdraft_limit`, with a reason.
- Add `wallet_ledger_direction_check` as `NOT VALID`: new lines are constrained, history is not scanned or rejected.
- Validate the organization, the student's organization, the item, the quantity, the reference and the priority before any write.
- Audit every usage event.

## Recommendation (decision)

**Use Option 3.** Metering and top-up are server-side financial operations. No browser or mobile client calls them. The platform's send path and trusted server code call them with the service role, and each one is authorized, tenant-checked, serialized, bounded and audited.

The migration does not touch existing balances, ledger lines or usage events and is not applied to production by this change.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual negative path.** Safety and authentication sends (OTP, emergency notice) still go out on an empty wallet, up to the per-wallet limit. This is deliberate: refusing an OTP is worse than a bounded loss. `comms_send` only keeps the safety priority for templates of category safety or authentication, so a school administrator cannot request it for a marketing message. The maximum exposure is the limit per wallet and the exposure is visible as a `negative_balance` alert.
- **Other negative paths.** `platform_share` (a per-student fee from plan allowances) and a staff `wallet_adjust` can still take a balance below zero. They are staff or platform-initiated, audited, and outside this mission.
- **The ledger constraint is `NOT VALID`.** Existing lines are not checked. It must be validated only after the read-only production check shows no violating row.
- **Owner of the residual risk:** the platform finance owner, for the default limit and for approving any non-default value.

### Neutrality baseline extension (ADR-004)

The wallet tables are keyed by `school_id`, the live organization key, so the migration cannot avoid that column name. This ADR records the decision to add exactly two observed groups to `NEUTRALITY_GUARD_BASELINE.json` for this migration file: `school_id` (22 hits, structural) and `student` (1 hit, the existing `daily_cap` error text that callers already match by prefix). The rest of the migration's wording was neutralized rather than baselined. No application-code entry and no table grant was added. The guard passes with no new violation after the extension.

## Consequences (summary)

- **Positive:** A parent, student, teacher or school administrator cannot debit or credit a wallet through the API. A school wallet cannot be driven below the bounded overdraft by any client call. Concurrent metering is exact. Every usage event and ledger change is auditable.
- **Negative / obligations:** Applying `20261104050000` is an operator step. Any code that calls `meter_usage` or `wallet_credit_topup` as a signed-in user stops working; the repository's own callers are `comms_send` (a definer function) and `wallet_topup_settle` (service role only, called by the Paystack webhook and the reconcile job); no TypeScript source calls either function directly (the sim-lab wallet scenarios were changed to call metering as the service role and to assert the new refusals). The wallet row lock serializes one organization's sends, which is the intended cost of exactness.
- **Rollback:** `database/supabase/rollbacks/20261104050000_sherivs_fin01_wallet_authorization.sql` restores the previous function bodies and grants verbatim and drops the new column, constraints, setter and trigger. **Rolling back re-opens the vulnerabilities above.** It is for an emergency in which the new rules block a legitimate payment flow, and it must be followed by a fix, not left in place. On scratch PostgreSQL 16 databases it was applied and the two test suites re-run: the original 18 and 3 failures returned, and the forward migration re-applied cleanly. On a populated database, a funded wallet's balance and ledger lines were identical before the rollback, after it and after the forward migration was applied again.

## Golden Questions

- **WHO?** The platform's send path (`comms_send`) and trusted server code (service role) meter and credit. Platform staff set the overdraft limit. Parents, students, teachers and school administrators do neither.
- **WHAT?** Metering and top-up as database operations that only the server can invoke, with a per-organization lock, a bounded safety overdraft, direction-checked ledger lines and an audit row per usage event.
- **WHERE?** Migration `20261104050000_sherivs_fin01_wallet_authorization.sql`, its rollback, the two integration suites, the sim-lab wallet scenarios and the CI `migrations-sim` job.
- **WHY?** A client could drain or overdraw any wallet it could name. The wallet is the platform's liability to the organization.
- **UNDER WHICH POLICY?** Forced RLS and append-only financial tables stay as they are. No secret is read or stored. Prices, entitlements, refunds and dispatch are unchanged.

## Pre-apply read-only checks and apply order

Run these before applying `20261104050000`. They only read. They should be run by an operator or by an approved read-only connection, and their output belongs in the apply ticket.

```sql
-- 1. Wallets that are already negative (the migration does not change them; it stops new negative usage beyond the limit)
SELECT count(*) FILTER (WHERE balance < 0) AS negative_wallets, min(balance) AS lowest_balance, count(*) AS wallets FROM public.school_wallets;

-- 2. Ledger lines the new direction check would reject (must be 0 before VALIDATE CONSTRAINT)
SELECT kind, count(*) FROM public.wallet_ledger
WHERE (kind = 'usage' AND amount >= 0) OR (kind = 'topup' AND amount <= 0) GROUP BY kind;

-- 3. Ledger consistency: each wallet's balance equals its latest ledger balance_after
SELECT count(*) AS inconsistent_wallets FROM public.school_wallets w
WHERE w.balance IS DISTINCT FROM (SELECT l.balance_after FROM public.wallet_ledger l WHERE l.school_id = w.school_id ORDER BY l.created_at DESC, l.id DESC LIMIT 1)
  AND EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.school_id = w.school_id);

-- 4. Who can execute the two functions today
SELECT p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, (SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r
WHERE n.nspname = 'public' AND p.proname IN ('meter_usage', 'wallet_credit_topup');
```

Apply order: after `20261104033000`. Apply in a maintenance-quiet moment (the wallet row locks are short, but a deploy of the new grants is immediate). After applying, run both suites against a restored copy, then validate the ledger constraint once check 2 returns no rows.

## UNKNOWNs

- **Whether anything changes between the 2026-11-13 read-only check and the apply.** Re-run the pre-apply checks below immediately before applying.
- **Behavior on the production PostgreSQL major version.** The suites ran on PostgreSQL 16 locally; the repository's CI job builds PostgreSQL 17. The CI result is the authority and has not been observed for this change.
- **Whether any out-of-repository caller** (an n8n flow, an edge function not in this repository, a mobile build) calls `meter_usage` as a signed-in user. The repository contains none. The pre-apply check 4 and a search of the edge function sources before apply close this.
- **The right default overdraft.** NGN 1,000 (100 SMS pages at NGN 10) is a conservative starting point and is owner-tunable per wallet.
