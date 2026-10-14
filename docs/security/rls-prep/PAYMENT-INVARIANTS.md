# Payment-security invariant matrix (H3 / H4)

**Status:** design only. `paystack.functions.ts` and
`webhooks/paystack.ts` are **not modified** in this mission.

**Version target:** ACTIVE-V1.

Inspected at `origin/master` @ `d195ba8`:

- `frontend/src/lib/runtime/scholar/paystack.functions.ts`
- `frontend/src/routes/api/public/webhooks/paystack.ts`
- Unique index `fees_paystack_reference_uniq` (`20260620131046`)

SHERIVS-001/002/003 remain **OPEN**. This matrix does not claim the live
Paystack path is safe.

## Live defects (must not ship under D)

| ID | Live behaviour | Required invariant |
|----|----------------|--------------------|
| P-1 | `initFeePayment` JWT UPDATE of `paystack_reference` / `paystack_access_code` | After D, only `service_role` may write those columns. JWT SELECT first. |
| P-2 | `verifyFeePayment` JWT UPDATE `status='paid'` with `body.data.amount / 100` | No client-controlled paid status. Settlement is service_role after Paystack verify. |
| P-3 | Verify does not compare kobo amount/currency to the fee row | Server must reject amount or currency mismatch. |
| P-4 | Verify uses `metadata.fee_id` and `.eq("id", feeId).eq("paystack_reference", reference)` — metadata is attacker-influenced at init time if a client can init another visible fee | Bind verified reference to the **intended** fee loaded before init, not only metadata. |
| P-5 | Webhook updates by `paystack_reference` even when `fee_id` is missing | Refuse ambiguous webhooks missing `data.reference` **or** `metadata.fee_id`. |
| P-6 | Webhook writes `paid_amount` from provider amount without matching `fees.amount` | Same amount/currency check as verify. |
| P-7 | RLS visibility is treated as payer authorization (`Fee not found or not visible`) | After E, same-school students no longer see all fees, but bursars/admins still would. Require relationship: mapped parent of `student_id`, the student user, or finance staff initiating on behalf of the school. |
| P-8 | Duplicate `charge.success` rewrites `paid_at` | Idempotent: if already paid with same reference and matching amount, return success without mutating. |
| P-9 | Verify and webhook can race | Single-row lock or conditional `UPDATE ... WHERE id AND reference AND status IN ('unpaid','partial')`. Winner settles; loser is no-op success if state already matches. |
| P-10 | `service_role` can update any fee id | Privileged UPDATE must include `id` **and** `paystack_reference` **and** `school_id` of the loaded fee. No `.eq("id", arbitrary)`. |
| P-11 | `admin/fees.tsx` JWT can set `status=paid` | B8 BLOCKED. D trigger denies user JWT. |

## Required init (`initFeePayment`)

1. Authenticate (`requireSupabaseAuth`).
2. JWT SELECT the fee by `id` with columns `id, amount, paid_amount, status, school_id, student_id, currency if present, paystack_reference`.
3. Authorization **beyond RLS**:
   - student: `students.user_id = caller` for `fee.student_id`
   - parent: row in `parent_student_map` for that student
   - bursar/admin/principal: `get_my_role()` in finance set **and** `fee.school_id = get_my_school_id()`
   - else deny. Visibility alone is insufficient.
4. Reject if `status = 'paid'` or outstanding `<= 0`.
5. Build reference server-side (already `uos_<fee-id-prefix>_<ms>`). Do not accept a client reference.
6. Call Paystack initialize with `amount = round(outstanding * 100)`, `currency = 'NGN'` (or the school's recorded currency if product adds one — today hardcoded NGN).
7. `supabaseAdmin` UPDATE **only** `paystack_reference`, `paystack_access_code` WHERE `id = fee.id` AND `school_id = fee.school_id`. Do not write `status`.
8. Unique index makes a colliding reference fail closed.

## Required verify (`verifyFeePayment`)

1. Authenticate.
2. GET Paystack `/transaction/verify/:reference` with the platform secret.
3. Require `data.status === 'success'`.
4. Require `data.currency === 'NGN'` (or the fee/school currency).
5. Load fee by **both** `paystack_reference = reference` and `id = metadata.fee_id`. If either identifier is missing, or the row count is not 1, **refuse**.
6. Re-check ownership/relationship (same as init) unless the caller is the webhook (no user).
7. Compare `data.amount` (kobo) to `round((fee.amount - coalesce(fee.paid_amount,0)) * 100)` **or** to `round(fee.amount * 100)` according to a documented full-vs-outstanding rule. Mismatch => refuse, do not mark paid.
8. `supabaseAdmin` conditional UPDATE:
   - SET status paid, paid_amount from verified amount, paid_at from time-authority
   - WHERE `id` AND `paystack_reference` AND `school_id` AND `status IN ('unpaid','partial')`
9. If 0 rows, SELECT the row: if already paid with same reference and same amount, return `{ paid: true, idempotent: true }`. Else refuse.

## Required webhook

1. HMAC-SHA512 of **raw** body vs `x-paystack-signature` (already present).
2. Parse bounded schema. Require `event`, `data.reference`, `data.amount`, `data.currency`, `data.status`, `metadata.fee_id` (uuid). Missing identifiers => **400/ignore without UPDATE**.
3. On `charge.success` only.
4. `supabaseAdmin` load fee by `id = fee_id` AND `paystack_reference = reference`. 0 or >1 rows => refuse.
5. Amount/currency match as in verify.
6. Same conditional UPDATE as verify. Duplicate delivery => idempotent success.
7. Do not update by reference alone.
8. Time via the kernel time-authority, not `new Date()`.

## Concurrent verify + webhook

Use one UPDATE statement with the unpaid/partial predicate. PostgreSQL
row lock serializes. Unique `paystack_reference` prevents two fees
sharing a reference. Do not wrap "read then write" without `SELECT ... FOR UPDATE`.

## What D SQL does and does not do

D (`20261015000070`) only denies **user-JWT** writes of settlement columns.
It allows any `service_role` write. Amount matching, fee-id binding,
ownership, webhook identifier refusal, and idempotency are **application**
invariants. They are NOT VERIFIED until implemented and staging-tested.

## Test cases (design only — do not run against production)

| ID | Case | Expected |
|----|------|----------|
| PAY-01 | Verify amount kobo != fee outstanding | reject; status unchanged |
| PAY-02 | Verify currency != NGN | reject |
| PAY-03 | Verify reference belongs to fee A, metadata.fee_id is fee B | reject |
| PAY-04 | Webhook missing `metadata.fee_id` | no UPDATE |
| PAY-05 | Webhook missing `data.reference` | no UPDATE |
| PAY-06 | Duplicate charge.success | second is idempotent; paid_at unchanged |
| PAY-07 | Concurrent verify + webhook | one settler; final row paid once |
| PAY-08 | Student JWT UPDATE fees.status | 42501 after D |
| PAY-09 | Init without parent/student/finance relationship | deny even if RLS would show the row |
| PAY-10 | service_role UPDATE by id only (no reference) | forbidden in app; staging must assert the query shape |
| PAY-11 | Hostname-routing tests | unchanged (`d195ba8`) |

Manual mark-paid from `admin/fees.tsx` is **B8 BLOCKED**.
