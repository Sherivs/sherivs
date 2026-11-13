# COMMS-03 financial integrity and entitlement: migration proposal

**Status: PROPOSAL. Nothing here has been applied to any shared or production database, and none of it is in `database/supabase/migrations/`.** The SQL files carry a `.sql.txt` extension on purpose so no migration tooling picks them up. Approval of the financial policy and of each part is the owner's decision (ADR-069, "Financial integrity and tenant entitlement review").

## What was tested, and where

Every claim in ADR-069 about database behavior was reproduced on a throwaway local PostgreSQL 16 server with all 168 repository migrations applied and synthetic data only (no production data, no production connection, no secret). Two environment notes, both stated so the evidence is not over-read:

- CI uses PostgreSQL 17. The local server is 16, which does not know the 17-only `MAINTAIN` privilege used by migrations `20261003000042` and `20261020000130`; those two words were stripped from a copy in `/tmp` so the chain could apply. The repository files are unchanged.
- The behavior of the production database was **not** inspected. If production carries out-of-band grants or objects (the repository itself records some), the findings need one read-only catalog check there first (ADR-069, "Awaiting your approval").

## The parts

| Part | File                                         | What it changes                                                                                                                                             | Mission                 | Depends on |
| ---- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| 01   | `01-refund-primitives.sql.txt`               | New append-only table `usage_event_reversals`; internal `_comms_refund_charge`; operator function `comms_refund_unsubmitted`                                | COMMS-03 (needs policy) | none       |
| 02   | `02-dispatcher-write-path.sql.txt`           | `comms_sms_claim`, `comms_sms_settle` (compare-and-set, optional atomic refund), `comms_sms_report_delivery`; service_role only                             | COMMS-03 (**blocker**)  | 01         |
| 03   | `03-comms-send-policy.sql.txt`               | `comms_send` with two marked edits: **[B1]** a simulated send is not metered, **[D4]** SMS plan gate (`blocked_plan`); `sms_plan_entitled`; status CHECK    | COMMS-03 (needs policy) | none       |
| 04   | `04-meter-usage-lockdown.sql.txt`            | `REVOKE EXECUTE ON meter_usage FROM authenticated`                                                                                                          | **FIN-01 (separate)**   | none       |
| 05   | `05-schools-commercial-column-guard.sql.txt` | `BEFORE UPDATE` trigger: only service role or a super admin may change `subscription_tier`, `subscription_status`, `subscription_expires_at`, `monthly_fee` | **ENT-01 (separate)**   | none       |

Parts 04 and 05 close defects that exist today and are independent of SMS. They are written here because the same evidence produced them, but they belong to their own missions and should not wait for COMMS-03.

## Results (throwaway database, `tests.sql.txt`)

| Run                                    | Pass | Fail | File                                |
| -------------------------------------- | ---- | ---- | ----------------------------------- |
| Before the proposal                    | 5    | 16   | `evidence/tests-before.txt`         |
| After parts 01-05                      | 21   | 0    | `evidence/tests-after.txt`          |
| After the rollback (with data present) | 5    | 16   | `evidence/tests-after-rollback.txt` |

Also on the throwaway database after applying 01-05: the repository security audit (`tools/sim-lab/sim/security-audit.mjs`, the CI gate) reports no table without row level security, no table without forced row level security and no `SECURITY DEFINER` function without a fixed `search_path`; none of the new functions is executable by `anon`. The rollback restores `comms_send` byte for byte and the `meter_usage` grant. A committed `blocked_plan` row was converted to `failed` / `blocked_plan` so the old CHECK constraint could be restored without losing it.

The "before" failures are the defects, reproduced: a parent can debit and overdraw the wallet with no message (C1); a school admin can change its own plan (C2a); a simulated send is charged (B1); a Trial organization with `sms_live` on is queued and charged (D4a); and nothing can claim, settle or refund through the database (F1, B2).

## How to run it again (throwaway database only)

```bash
# a scratch cluster that is NOT a shared database, built from the repository migrations
psql -h 127.0.0.1 -p 54330 -U postgres -X -q -f tests.sql.txt        # before: expect failures
for f in 0[1-5]-*.sql.txt; do (echo BEGIN; cat "$f"; echo COMMIT) | psql -h 127.0.0.1 -p 54330 -U postgres -X -q -v ON_ERROR_STOP=1; done
psql -h 127.0.0.1 -p 54330 -U postgres -X -q -f tests.sql.txt        # after: expect pass=21 fail=0
(echo BEGIN; cat rollback.sql.txt; echo COMMIT) | psql -h 127.0.0.1 -p 54330 -U postgres -X -q -v ON_ERROR_STOP=1
```

`tests.sql.txt` builds its own synthetic organizations and ends with `ROLLBACK`, so it leaves nothing behind. Do not point it at a shared database.

## What shipping it would also require (not done here)

- **Part 02 needs an application change.** The dispatcher and the delivery-report route currently issue direct `UPDATE`s on `outbound_messages` through the service role; they must call `comms_sms_claim`, `comms_sms_settle` and `comms_sms_report_delivery` instead, and the unit-test database double must model them. The refund argument must be passed only for outcomes that provably never reached the provider (a rejection before the claim, `provider_rejected`, `provider_duplicate`) and never for ambiguous ones (`provider_error`, `provider_response_invalid`, a timeout).
- **Part 03** adds the status `blocked_plan`; TypeScript status types and any screen that switches on status must learn it. The plan list in `sms_plan_entitled` mirrors the TypeScript catalog and needs a parity test.
- **Part 04** breaks one existing caller: `tools/sim-lab/sim/scenarios.mjs` (about lines 1973-1990) calls `meter_usage` as the school admin; it must use the `asOwner` helper (or the service role). No application code calls `meter_usage`.
- **Promotion.** A promoted migration needs the repository's own file naming, the matching file under `database/supabase/rollbacks/`, and the CI `migrations-sim` job on PostgreSQL 17.
- **Known limits of the refund.** It does not restore the per-student daily cap (that cap is unreachable from the approved-proposal path, which passes no student) and it does not refund a message the provider accepted and later reported as failed (the provider's refund treatment is unknown).
