# ADR-157: Relief Reversal in the Fee Ledger (M9 part B)

- Creator: Claude Code agent, mission M9 part B (relief reversal) (provenance id W-021); AI-generated
- Origin: Mission: W-021; Authority: ADR-150 (finance core, relief posting) and the M9B remaining-design note section 1

- Status: PROPOSED. Migration not applied anywhere. Needs a backup and Tumi's review.
- Date: 2026-11-28

## Context

ADR-150 lets approved relief (A05 `fee_adjustments`) post into the M07 ledger: debit `fee_relief`, credit `accounts_receivable`. `fee_relief_revoke` only set the adjustment to `revoked`. A relief that had been posted stayed in the ledger, so the student kept owing less after the school had withdrawn the relief.

## Decision

1. New posting event `relief_reversal`: debit `accounts_receivable`, credit `fee_relief`, same amount as the relief posting, linked by `reverses_posting_id` and `adjustment_id`, with a reason. It never touches cash. The event-type check, the shape check and the balance trigger change together; one reversal per relief posting (unique index).
2. New `cg_fee_reverse_relief(invoice, adjustment, reason)`: bursar with `fees.manage_plans`, and not the person who requested the relief and not the person who decided it. Idempotent (a second call returns `duplicate`).
3. `fee_relief_revoke` refuses (`55000`) while a posted relief has no reversal. Order of events is therefore: reverse, then revoke. Relief that was never posted revokes as before.
4. The guard that stops reversing an invoice carrying relief now only blocks while the relief is unreversed.

## Consequences

- Ledger history is append-only: nothing is edited or deleted; the reversal is a new posting.
- Rollback restores the previous bodies and refuses (`55000`) if any reversal has been posted.
- Existing data: relief revoked before this change that was already posted stays unreversed; it cannot be reversed here because the adjustment's `decided_by` now names the revoker. Counted as zero today (no production data); Tumi to check before applying anywhere that has data.
- `fee_relief_revoke` overwrites `decided_by` with the revoker; the original approver is lost. Out of scope; recorded here.
- Neutrality: baselined under stream M9B-RR with removal condition "legacy fee_adjustments retired".
