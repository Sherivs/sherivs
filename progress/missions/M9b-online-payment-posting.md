# M9B online payment posting into the M07 fee ledger

Status: draft PR, not applied anywhere. ADR-163, gap W-027. Test mode only.

Built: migration 20261128000800 (online method and `online_clearing` account; `cg_fee_post_online_payment`; parking queue; configured system actor; refund-request guard), rollback (refuses while online payments exist), harness `tests/integration/m9b-online-payment-posting.local.sql` (M9E ALL PASS: 22 checks), CI step.
Evidence: posts, receipts, idempotency, conflict, parking of ambiguous / none / levy / too-large / no-actor, service-role only, cashier refund refused, ledger balanced, human function still refuses `online`; rollback round-trip.

Read first (levy and M07 relation): levies are legacy `fees` rows (`fee_type = 'levy:<name>'`) with no M07 invoice. They are parked as `levy_not_in_ledger` rather than applied to tuition.
DEFECT in #539 (cash path, ADR-156): `record_cash_payment` posts cash for any fee row, including a levy, against the student's open tuition invoice for the term. Fixed on that branch (#539, same day): levy rows are recorded as before, not posted to the ledger, and the result reports `ledger_posted: false`.

Not built: the webhook call (wire `cg_fee_post_online_payment` after `settlePaystackCharge` succeeds, best effort, only after apply and actor setup); the actor user (ops step: create a user, insert into `cg_fee_online_actor`); a bursar view of the parked queue; reconciliation of `online_clearing` to Paystack settlement; the levy-to-invoice bridge; online refund posting.
Decisions: which user is the system actor; whether levies become M07 schedules and invoices; who clears the parked queue.
