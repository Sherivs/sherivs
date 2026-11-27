# ADR-156: Cash Path Posts to the Fee Ledger (M9 part B)

- Creator: Claude Code agent, mission M9 part B (cash path) (provenance id W-020); AI-generated
- Origin: Mission: W-020; Authority: ADR-150 (finance core), founder decision 2026-11-28 "redirect record_cash_payment into the M07 ledger"

- Status: PROPOSED. Migration not applied anywhere. Needs a backup and Tumi's review.
- Date: 2026-11-28

## Context

Two functions record money a cashier takes in person. `cg_fee_record_payment` (M07) writes the payment, the double-entry ledger lines and a receipt, and is what the cashier desk, the day close and reconciliation read. The older `record_cash_payment` wrote `offline_payments` and the `fees` row and debited the platform-share wallet, but never touched the M07 ledger. Cash taken through it was invisible to the day close.

## Decision

`record_cash_payment` keeps its signature, permission (`payments.record_cash`) and grants, and gains one step: it finds the student's single open M07 invoice for the given academic year and term and posts the payment with `cg_fee_record_payment`, inside the same transaction as the legacy writes and the wallet debit. The invoice is found only from keys the caller already supplies: `subject_ref` is the student id as text (as ADR-150's relief posting already assumes), and the schedule carries the year and term. No new table, column or mapping is introduced.

Rules, each tested:
1. No open invoice for that student, year and term: refuse (`P0002`). A payment with no invoice has nowhere to post.
2. More than one open invoice: refuse (`22023`). The function does not guess.
3. Method mapping: `cash`→`cash`, `pos`→`pos`, `bank_deposit`→`bank_transfer`. `cheque` and `other` are refused (`22023`) because the ledger has no account for them.
4. Amounts must be positive and in whole kobo. A payment above the outstanding balance is refused by the ledger (`23514`); the legacy path allowed it.
5. Idempotency key is `legacy-cash:` plus the new offline payment id; the receipt number is passed as the external reference.
6. Atomic: any refusal leaves no `offline_payments` row, no `fees` change and no ledger posting.
7. The return value gains `ledger_payment` and `receipt_number`; existing keys are unchanged.

## Consequences

- Cash taken through either function now reaches the day close and reconciliation.
- Behaviour change for callers: schools that have not issued an M07 invoice for the term can no longer record cash through this function. There is no production data yet; the frontend does not call it (it appears only in the role template catalog), so the blast radius is the cashier RPC itself.
- Historical `offline_payments` rows are not back-filled (no production data exists).
- Rollback restores the previous body; payments already posted stay posted.
- Neutrality: the function is domain code in a migration, baselined under stream M9B with removal condition "legacy `offline_payments` and `fees` retired".
