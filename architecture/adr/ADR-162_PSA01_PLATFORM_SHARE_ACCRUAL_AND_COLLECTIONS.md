# ADR-162: Platform Share Accrual, Settlement and Collections (PSA-01)

| Field                      | Value                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                     | PROPOSED (the migration is not applied; founder approval and a backup are needed first; Tumi reviews it because it moves school wallet money)        |
| Date                       | 2026-11-28                                                                                                                                             |
| Author                     | Claude Code agent (PSA-01)                                                                                                                             |
| Creator                    | Claude Code agent, mission PSA-01 (platform share accrual)                                                                                             |
| Origin                     | Founder instruction 28 Nov 2026: Sherivs must know which students paid, including cash, and take its share through the school wallet                   |
| Mission                    | PSA-01, gap W-026                                                                                                                                      |
| Capabilities               | Accrue the per-student term share at term open; settle it by Paystack split, recorded cash (wallet) or an agreed automatic wallet debit; collections reports |
| Cites                      | ADR-156                                                                                                                                                |
| Minimal ownership artifact | `database/supabase/migrations/20261128000700_sherivs_psa01_platform_share_accrual.sql`                                                                 |

## Context

Sherivs earns a per-student, per-term share (`platform_share_per_student`). Before this change the share was taken only when a payment event happened: a Paystack split (`fee_checkout_split`, `fee_split_settle`) or a recorded cash payment (`record_cash_payment`, which debits the school wallet). A student whose payment was never recorded, or who was never charged, produced no share and no signal. The existing `platform_fee_leakage` report only counted students who had paid. Sherivs also had no per-school view of enrolled, paid online, paid in cash and unpaid students.

## Options

- **A. Keep collecting only on payment events.** Rejected: offline cash and unrecorded payments stay invisible.
- **B. Block cash recording unless the wallet is funded.** Rejected: it stops a school doing its work and pushes cash outside the system.
- **C. Accrue per active student at term open, settle by the first available route, report by channel.** Chosen. The share is a per-student fee, so how the parent paid does not change the amount.

## Decision

1. `platform_share_accrue` inserts a `pending` row per active student for the term (idempotent; schools with a zero share skipped). These are the same rows the checkout reserves and the cash path upgrades, so the existing paths work unchanged (proven in the harness).
2. `platform_share_settle_overdue` debits the school wallet for pending shares older than the school's grace period, only when the school has a policy with `auto_debit` and a recorded agreement reference and date (the database refuses `auto_debit` without them). It never takes the wallet below minus the policy's `debt_limit` (default 0), skips students who are no longer active, and leaves unfunded rows pending. A later Paystack split for the same share refunds the wallet.
3. `platform_share_waive` lets a Sherivs operator waive a pending share with a reason. Schools cannot.
4. `platform_share_collections` and `platform_share_student_list` give operators the per-school and per-student view: enrolled, accrued, collected online, collected by wallet (cash path), collected by automatic debit, waived, pending, overdue, wallet balance, the gap the wallet cannot cover, and students who paid but whose share was not taken. Ids only, no names.
5. Everything is operator-only (service role or super admin). Every accrual, settlement, waiver and policy change is an append-only event.
6. The code locks no school feature. Whether and when to pause commercial features is an agreement between Sherivs and each school and is not implemented here.

## Consequences

- Sherivs sees every enrolled student's share state per term and can chase overdue schools.
- Automatic debit exists only for schools that have signed. The agreement text, the grace period and the debt limit are commercial terms to settle with each school; the code records them.
- Observed, not changed here: `record_cash_payment` posts the share with negative balances allowed and no limit for `platform_share` lines, so a school can run its wallet arbitrarily negative through cash. The automatic debit respects the debt limit, the cash path does not. Decision needed.
- Accrued pending rows are left in place by the rollback because the checkout and cash paths create the same rows.

## Not proven

- Hosted behaviour; concurrency between a debit and a Paystack settle (the row lock and the wallet reference make a double take impossible by design, not by a race test).
- The mapping of terms to the academic year and term text each school uses (the caller passes them).
- Scheduling: nobody calls accrue or settle yet; a cron is Tumi's decision.
- A school-facing statement of what it owes.
