# ADR-150: Finance Separation of Duties and Ledger Integrity (M9 part A)

| Field                      | Value                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval required before the migration is applied; NOT APPLIED)                                                        |
| Date                       | 2026-11-18                                                                                                                               |
| Author                     | Claude Code agent (mission M9 part A)                                                                                                    |
| Creator                    | Claude Code agent, mission E-018 (M9 finance, part A)                                                                                    |
| Mission                    | M9 (finance), part A                                                                                                                     |
| Capabilities               | Database-enforced separation of duties for cash, refunds, reconciliation, payroll and expenses; balanced term ledger including relief    |
| Cites                      | ADR-070 (FIN-01); ADR-101 (SEC-M0); ADR-103..105 (WF engine); ADR-106 (card registry, PR #433); ADR-109 (outbox, PR #449); PR #275 (M07) |
| Minimal ownership artifact | `database/supabase/migrations/20261117003300_sherivs_m9_finance_core.sql`                                                                |

## Context

Production already holds the money engines: the M07 double-entry fees ledger (`cg_fee_*`), Paystack intents and reconciliation (`cg_financial_*`), A05 relief (`fee_adjustments`), FIN-01 wallet, payroll and expense guards, and the role engine's SoD rules. Read-only checks on 2026-11-17 found that these still allow: a payroll line or expense to be self-approved by naming someone else as preparer or raiser (both were client-sent on INSERT); approved payroll amounts to change; a cashier, or the person who recorded a payment, to decide its refund; online refunds started by a cashier; no cash day close or cash reconciliation at all; the default accountant assignment to violate the existing record-cash-versus-reconcile rule; A05 relief never reaching the ledger. All finance tables in production were empty, so no row conflicts.

## Options

- **A. Enforce in server functions and the UI.** Rejected: §2.1 item 6 requires the database, and any other caller (service role, future screens, agents) would skip it.
- **B. A new finance module with its own tables and approval engine.** Rejected: duplicates M07, A05 and the WF engine (ADDENDUM rule).
- **C. Extend the applied tables with table-level triggers and a small number of functions.** Chosen.

## Decision

1. The preparer of a payroll line and the raiser of an expense are the caller on INSERT. An approved line names a preparer and an approver who differ from each other and from the payee; the approver is fixed once set; approved and paid amounts are frozen; whoever changes a draft's figures becomes its preparer. Both tables are audited.
2. Refund decisions refuse the requester, the person who recorded the payment and any holder of `payments.record_cash`; online reversals refuse a requester who holds it. New SoD rule `payments.record_cash x payments.refund`.
3. Cash day close (`cg_fee_cash_day_close`): the cashier counts; expected totals are computed from the ledger; a closed day accepts no more cash or POS from that cashier at that campus. Cash reconciliation (`cg_fee_cash_reconciliation`) is by a bursar or accountant who is not the closer, recorded no payment at that campus that day and holds no cash permission; a variance needs a note and cannot be called matched. Both append-only, audited, read under the M07 read rule, written only through `SECURITY DEFINER` functions.
4. The accountant template no longer has `payments.record_cash` on by default.
5. An approved A05 adjustment posts into M07 as `relief` (debit `fee_relief`, credit receivable), computed on the server, once per invoice, never by its requester; an invoice with relief cannot be fully reversed.
6. Paystack stays TEST-only; nothing here touches keys or live charges. Approval chains (expense thresholds, refund escalation) are WF templates in part B, not a new engine.

## Consequences

- `tests/sql/m9-finance-core.sql` reproduces each gap on the applied definitions, then proves the fix (110 assertions, a second run and the rollback).
- The rollback restores the applied function bodies verbatim and refuses to run once day closes or relief postings exist.
- The cashier desk (`a.record_cash`) is live in the card registry and queues through the SV1-LITE outbox.
