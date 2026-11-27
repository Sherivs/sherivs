# ADR-155: Online Refund Second-Person Approval (M9 part B, first piece)

- Creator: Claude Code agent, mission M9 part B (online refund approval) (provenance id W-019); AI-generated
- Origin: Mission: W-019; Authority: ADR-150 decision 2 and 6 (approval chains in part B), closure register item 463

- Status: PROPOSED. Migration not applied anywhere. Needs the founder's approval, a backup, and Tumi's review.
- Date: 2026-11-27

## Context

ADR-150 made in-person refunds (`cg_fee_decide_refund`) need a second person. Online refunds (`cg_financial_reversal`) did not: the service role could move a requested reversal to `processing` with no decision by anyone.

## Decision

1. `cg_financial_reversal_decision` records one decision per reversal (approved or rejected), append-only, closed to every client role.
2. `cg_financial_decide_reversal` is for a signed-in bursar holding `payments.refund` in that organisation (`cg_fee_authorize`). It refuses the requester, any holder of `payments.record_cash`, a second different decision, and any reversal not in `requested`. A rejection cancels the reversal.
3. `cg_financial_finish_reversal` refuses `processing` or `processed` from `requested` without an approved decision. `failed` and `cancelled` stay free.

## Not built (open)

- The rest of M9 part B: two cash paths, bursar and payroll screens, relief revocation, levies, Paystack posting into M07.
- A screen or TypeScript helper to decide a reversal; the existing server helpers do not call the decision function.
- Refund amount thresholds (a larger refund needing a higher role) are a workflow-template matter.

## Verification

`tests/integration/m9b-online-refund-approval.local.sql`: 20 checks (closed table, no send without approval, requester and cash holder refused, outsider and service role refused, approval, idempotence, no flipping, rejection cancels, append-only).
