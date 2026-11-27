# M9B cash path to the fee ledger

Status: draft PR, not applied anywhere. Founder approved the direction on 2026-11-28 ("redirect it").

Built: migration 20261127000900 (record_cash_payment posts through cg_fee_record_payment), rollback (restores the previous body), harness tests/integration/m9b-cash-path-to-ledger.local.sql (M9C ALL PASS: 20 checks), CI step, ADR-156.
Evidence: harness passes on a chain DB built from master plus this migration; with the rollback applied the harness fails at its presence guard; migration re-applies and passes again.
Not built: back-fill of historical offline_payments (no production data); a screen that picks the invoice when more than one is open (the function refuses instead of guessing); cheque and other methods (the ledger has no account for them).
Behaviour change to tell Tumi: a school with no M07 invoice for the term cannot record cash through this function.
Tumi to check: that cashiers are assigned ng.cashier at campus scope for the campuses whose invoices they take cash against (the ledger checks campus authority separately from payments.record_cash).
