# PSA-01: platform share accrual, settlement and collections

Status: draft PR, not applied anywhere. ADR-162, gap W-026.

Why: Sherivs only took its per-student share when a payment event happened, so unrecorded cash and unpaid students were invisible. Founder direction (28 Nov): each school has a wallet; when cash is recorded Sherivs takes its share through it; Sherivs needs the list of enrolled students, who paid and what Sherivs took. Commercial terms (agreement, grace, which features pause) are agreements with each school, not code.

Built: migration 20261128000700 (policy and event tables; accrue, settle_overdue, waive, set_policy, collections, student_list; all operator-only), rollback, harness `tests/integration/psa01-platform-share-accrual.local.sql` (PSA01 ALL PASS: 46 checks), CI step, ADR-162.

Evidence (local PG16, 239-migration chain): accrual idempotent, withdrawn and zero-share schools skipped; auto debit only with a recorded agreement, after grace, within the debt limit, never for a withdrawn student, never twice; waiver reasons and events; events append-only; operator-only; the real `fee_checkout_split` and `fee_split_settle` reserve and collect the accrued row, and refund the wallet if a Paystack split arrives after an automatic debit. Rollback removes the objects and the migration re-applies.

Not built: any feature pause (agreement-based); cron to run accrue and settle; a school-facing statement; a screen for the Sherivs operator view; per-school invoicing of the debt.
Found, not changed: `record_cash_payment` can take a school wallet arbitrarily negative (no limit for platform_share lines).
Decisions for the founder and Tumi: grace days default 14 and debt limit default 0, per school; whether to bound the cash path's negative balance; who may waive; the contract wording for automatic debit; cron cadence.
