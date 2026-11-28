# M9B open invoices for the cash picker

Status: draft PR, not applied anywhere.

Built: migration 20261128000600 adds `cash_open_invoices_for_student(school, student, year?, term?)`, read-only, up to 50 rows, each with invoice, schedule label, year, term, campus, amount and outstanding kobo, ordered by due date. Rollback, harness `tests/integration/m9b-open-invoices.local.sql` (M9D ALL PASS: 15 checks) and a CI step.
Evidence: harness passes on a local chain DB; rollback removes the function and the migration re-applies and passes again. Outstanding is computed exactly as the ledger and `record_cash_payment` do (accounts_receivable debit minus credit). Listing writes nothing (counted).
Authorization: `payments.record_cash` in the same school. The legacy bridge lets school admins and principals pass that check, so they can list invoices; the ledger still checks campus authority separately when cash is recorded.

Not built (decisions needed, so not guessed):
- `record_cash_payment` still cannot target a chosen invoice: it refuses when more than one is open. Letting the picker's choice reach it needs a new optional invoice argument, which changes the function signature (a new overload or replacing the old one). That is a separate change on top of the cash-path PR (#539).
- The picker screen itself.
- Campus filtering of the list by the caller's campus authority.
