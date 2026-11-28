# ADR-163: Posting Settled Online Payments into the M07 Fee Ledger (M9B)

| Field                      | Value                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (the migration is not applied; founder approval and a backup are needed first; Tumi reviews it because it changes the money ledger)               |
| Date                       | 2026-11-28                                                                                                                                                 |
| Author                     | Claude Code agent (M9B online posting)                                                                                                                     |
| Creator                    | Claude Code agent, mission M9B (Paystack posting into M07)                                                                                                 |
| Origin                     | Founder instruction 28 Nov 2026 (levies and Paystack posting next); `progress/handoff/M9B_REMAINING_DESIGN_2026-11-27.md` section 3; ADR-150 item 6        |
| Mission                    | M9B online posting, gap W-027                                                                                                                              |
| Capabilities               | Post a settled Paystack payment against the student's single open M07 invoice; park what cannot be mapped; online clearing account                          |
| Cites                      | ADR-150, ADR-155, ADR-156                                                                                                                                  |
| Minimal ownership artifact | `database/supabase/migrations/20261128000800_sherivs_m9b_online_payment_posting.sql`                                                                       |

## Context

A Paystack charge settles the legacy `fees` row and the `cg_financial_*` engine, but the M07 ledger (`cg_fee_*`) never sees it, so the ledger shows an online payer as still owing. Reading the code also showed that levies (`fee_levy_create`) are legacy `fees` rows with no M07 invoice, and that the M07 payment function accepts only cash, bank transfer and POS, authorised for a signed-in cashier.

## Options

- **A. Let the webhook call `cg_fee_record_payment`.** Rejected: it needs a signed-in cashier and would book online money into the cash account, which the cash-day close counts.
- **B. A service-role function that posts to a new online clearing account, with a parking queue.** Chosen.
- **C. Build the levy-to-invoice bridge first.** Deferred: it needs a decision on schedules, campuses and scope bindings per levy.

## Decision

1. `cg_fee_post_online_payment(fee, reference, amount_kobo)` (service role only) posts method `online` against the student's only open invoice for the fee's year and term, debiting `online_clearing` and crediting accounts receivable, with a receipt. It is idempotent by Paystack reference (a different fee or amount under the same reference is refused).
2. It posts nothing it cannot map safely. Instead it records the payment in `cg_fee_online_posting` as `unposted` with a reason: `actor_not_configured`, `levy_not_in_ledger`, `no_open_invoice`, `ambiguous_invoices`, `exceeds_outstanding`. Nothing is lost and nothing is guessed.
3. Online payments are attributed to one configured system user (`cg_fee_online_actor`). Creating that user is an operations step; until it exists everything is parked. No identity is invented in a migration.
4. `cg_fee_refund_request` refuses an online payment; online refunds follow the second-person approval path (ADR-155).
5. Human recording stays as it was: `cg_fee_record_payment` still refuses `online`.
6. Test mode only (ADR-150 item 6); nothing here touches keys or live charges.

## Consequences

- Once wired and applied, the ledger and receipts show online payments; the school's finance team gets a queue of payments to map by hand.
- Online money sits in `online_clearing` until reconciled to Paystack settlement. That reconciliation is not built.
- Found in the cash path (#539, ADR-156): `record_cash_payment` posts cash for any fee row, including a levy, against the student's open tuition invoice. This is a defect to fix there (see the mission note).

## Not proven

- The webhook is not yet wired to call the function (the migration must be applied and the actor configured first); the call point is `settlePaystackCharge` success in `paystack.functions.ts`.
- Hosted behaviour, concurrency with a cash payment on the same invoice (the invoice row lock serialises them by design, not by a race test).
- Reconciliation of `online_clearing` to Paystack settlements, and online refunds posting.
