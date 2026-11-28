# PSA-01c: bound the school wallet on the cash path

Status: draft PR, not applied anywhere. Gap W-028. Stacked on #547 (PSA-01) and #539 (cash path); this branch merges #539 under #547, so review those first.

Why: PSA-01 found that `record_cash_payment` took the platform share from the school wallet with no limit (`_wallet_post` only enforces the overdraft limit for kind `usage`), so a school that never topped up could be taken arbitrarily negative by its own cashier.

Decision (CTO call, reviewable): the cash is always recorded, because it was physically received; only the share is bounded. The share is taken from the wallet while the balance after the debit stays at or above minus `platform_share_policy.debt_limit` (default 0 when no policy row exists). Otherwise the share row stays `pending`, no wallet line is written, the result says `share_parked: true`, and the operator report counts it as paid at the school with the share not taken. It is taken later by the existing settle function once the wallet is topped up and the school has a recorded agreement. This reuses the one debt limit that PSA-01 already defines, so there is a single rule on both paths.

Built: migration 20261128000900 (replaces `record_cash_payment`; same signature and grants; one new result key), rollback (restores the cash-path body; parked rows stay as real accruals), harness `tests/integration/psa01c-cash-wallet-bound.local.sql` (WBND ALL PASS: 12 checks), CI step.

Evidence (local PG16, combined chain): WBND 12/12; M9C 22/22 and PSA01 46/46 still pass against the new function; FIN-01 pass=37 fail=0; rollback then re-apply 0 errors.

Not built / caveats: the wallet row is locked (`FOR UPDATE`) for the check, but a school with no wallet row yet has nothing to lock, so two simultaneous first-ever payments could both pass the check before the wallet exists (bounded by the number of concurrent cashiers; `_wallet_post` still serialises the writes). A school-facing message for a parked share is not built. Whether a parked share should ever block the cashier (instead of being recorded) is a commercial call for the founder and Tumi; this build never blocks cash.
