# M9 part B: remaining pieces, design for Tumi's review

Status: design only. No code. Written 27 Nov 2026. Online refund approval is built separately (ADR-155, #533).

## 1. Relief revocation (ledger change)

Today `fee_relief_revoke` only sets the adjustment's status to `revoked`. If relief was already posted into the M07 ledger (`cg_fee_post_relief`: debit `fee_relief`, credit `accounts_receivable`), revoking leaves the ledger saying the student owes less. Nothing reverses it.

Proposed:
- New posting event type `relief_reversal`: debit `accounts_receivable`, credit `fee_relief`, same amount as the relief posting, linked by `reverses_posting_id` and the adjustment id.
- Three places must change together: the `event_type` check, the shape check on `cg_fee_ledger_posting` (the long CHECK that ties event types to their foreign keys), and the balance trigger `cg_fee_posting_balanced` (add the `relief_reversal` case).
- New function `cg_fee_reverse_relief(invoice, adjustment, reason)`: bursar with `fees.manage_plans`, not the requester of the relief and not the person who decided it (two people, as for posting). One reversal per relief posting. A reversal only re-opens the receivable; it never touches cash.
- `fee_relief_revoke` then refuses to revoke an adjustment with an unreversed posting.
- Open for Tumi: do existing postings need a data check before the constraints change; PostgreSQL 17 constraint rewrite cost on a populated ledger.

## 2. Two cash paths

- Legacy: `record_cash_payment` writes `offline_payments` and updates `fees`, and debits the platform wallet for the per-student share. It does not write to the M07 ledger.
- M07: `cg_fee_record_payment` writes the ledger and is the one the cash-day close and reconciliation read.
- Recommended: make `record_cash_payment` a thin wrapper that calls the M07 path and then does the wallet debit, so the cashier desk and the day close see every cash payment. Needs founder decision (asked in chat) and an invoice for the fee; a payment with no invoice has nowhere to post.
- Not decided: what happens to historical `offline_payments` (there is no production data yet, so likely nothing).

## 3. Levies, bursar and payroll screens, Paystack posting

- Levies: `fee_levy_create` exists; its relation to M07 invoices was not read.
- Screens: need the card registry entries and server functions; no database change expected.
- Paystack posting into M07: `cg_financial_*` records settled entries; posting each into the fee ledger needs a mapping from the Paystack reference to an invoice. Test mode only (ADR-150 item 6).

## Acceptance (any of the above)

A harness proving: closed tables, two-person rule, idempotence, ledger balance after every path, rollback restores the old bodies, no change to anyone else's permissions.
