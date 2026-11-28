# LEVY-M07: levy invoices in the M07 fee ledger

Status: draft PR, not applied anywhere. Gap W-029. Stacked on #550 (PSA-01c), which sits on #547 and #539; this branch contains them until they merge. Review order: #539, #547, #550, then this.

Why: a levy (`fee_levy_create`) is a legacy `fees` row with no M07 invoice. #539 stopped levy cash landing on the tuition invoice, but that left levy cash outside the ledger the cashier day close reads.

Built: migration 20261128001000. `fee_levy_ledger_issue(levy, scope_ref, campus, limit)` lets a bursar (checked by the ledger's own authorisation on every call, including repeats) create one M07 schedule per levy and one invoice per charged student, idempotently, in batches. Link tables `fee_levy_ledger_schedule` and `fee_levy_ledger_invoice` (RLS on, closed to API roles). `record_cash_payment` now posts levy cash to the levy invoice when one exists; a levy with no invoice behaves exactly as in #539 (recorded, not posted); a levy invoice with nothing outstanding refuses with P0002. Rollback restores the PSA-01c body and refuses while any levy link exists.

Decisions made, no guessing: students carry no campus, so the bursar chooses the campus and scope per levy; a levy already issued under one scope or campus refuses another. The invoice principal is the student's parent id when there is one, otherwise `student:<id>`; the real guardian model (`student_guardian_relationships`) is not wired in.

Evidence (local PG16, combined chain): harness `tests/integration/levy-m07-bridge.local.sql` (LEVY ALL PASS: 18 checks) covers issue, idempotence, amounts, levy cash on the levy invoice with the tuition invoice untouched, unissued levy unchanged, overpay refused with nothing left behind, and refusals for cashier, wrong campus, second scope and unknown scope. M9C 22, WBND 12, PSA01 46 and FIN-01 pass=37 still pass; rollback then re-apply 0 errors. The rollback refusal while links exist is written but not exercised by a test.

Not built: wiring the online posting function (#548) to look up levy invoices, so an online levy payment still parks as `levy_not_in_ledger`; a screen to issue levy invoices; guardian-based principal; automatic issue at levy creation (kept explicit so the bursar picks the campus).
