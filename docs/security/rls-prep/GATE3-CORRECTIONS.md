# SHERIVS-RLS-GATE3-CORRECTIONS-001

**Mission:** Correct Gate 3 review findings C1–C4 and H1–H7.

**Version target:** ACTIVE-V1 only.

**Gate status:** GATE 3 remains **PASS WITH CONDITIONS**. These artifacts
are returned for another independent review. This mission does **not**
declare Gate 3 fully passed and does **not** declare SHERIVS-001,
SHERIVS-002, or SHERIVS-003 remediated.

**Production:** no SQL executed. No database connection. No files under
`database/supabase/migrations/`. No GRANT/REVOKE/DDL/DML against any
database. No hostname-routing, DNS, Vercel, or Supabase project change.

Authoritative baseline remains `origin/master` @ `d195ba8`.

---

## C1 — Auth function references

**Finding:** `pg_catalog.auth.uid()` / `pg_catalog.auth.role()` are invalid
three-part names.

**Correction:** Every proposed function uses
`SET search_path = pg_catalog, public` and calls `auth.uid()` /
`auth.role()` (two-part, `auth` schema). Policies call `auth.uid()` the
same way. `auth` is **not** added to search_path so unqualified names
cannot resolve to a shadowed `public` object that happens to be named
like a catalog routine, and so we never bind a surprising `auth`
relation from search_path.

Trusted helpers stay `public.get_my_school_id()` / `public.is_school_admin()`
schema-qualified in policy bodies.

Letter-named proposed files that contained `pg_catalog.auth.*` were
deleted.

**NOT VERIFIED:** staging parse/execute of `auth.uid()` under the locked
search_path.

## C2 — Membership synchronization

**Finding:** Founder RPC is SECURITY DEFINER with an **authenticated** JWT
and INSERTs `users` before the AFTER sync trigger writes
`organization_memberships`. A freeze that required `auth.role() =
'service_role'` on membership INSERT would break founder provisioning.

**Correction:** `freeze_membership_identity_columns` allows the write if:

1. `pg_catalog.pg_trigger_depth() > 1`, or
2. `auth.role() = 'service_role'`

**`pg_trigger_depth()` behaviour:**

| Context | Depth | Result |
|---------|------:|--------|
| Outside triggers | 0 | n/a |
| Direct PostgREST INSERT/UPDATE on `organization_memberships` | 1 | deny unless service_role |
| `users` AFTER `organization_memberships_sync` performing INSERT/UPDATE | 2 | allow (trusted sync) |
| Trigger on some other table that later writes memberships | 2+ | would also allow |

Direct DML is always depth 1, so an ordinary authenticated user — including
a school admin whose INSERT policy would otherwise pass — cannot use the
depth latch to authorize a client write.

Nested sync covers:

- `create_organization_with_founder` (authenticated JWT, DEFINER INSERT
  `users`, then depth-2 membership upsert)
- `switchActiveOrganization` / `inviteTeacher` / `createStaffAccount`
  (service_role users write; also allowed via `auth.role()`)

G additionally REVOKEs INSERT/UPDATE/DELETE on memberships from
`authenticated`, so PostgREST cannot write the table even if a policy
remains. DEFINER sync runs as owner and still writes.

No client-settable GUC.

**Residual risk / NOT VERIFIED:** any *future* trigger on another table
that writes `organization_memberships` would inherit depth > 1.
`origin/master` has only `organization_memberships_sync` as that writer.
Founder + switcher compatibility is a **design claim**, not a staging
proof (H7).

## C3 — GRANT regression

**Finding:** `GRANT UPDATE ON TABLE` restores every column, undoing A/D/F
REVOKEs.

**Correction:** `20261015000080` uses least-privilege table grants, then
**re-REVOKEs**:

- `users.role`, `users.school_id` UPDATE
- `users.salary`, `nin`, `bank_name`, `account_number`, `account_name`,
  `face_biometric` SELECT/UPDATE
- `fees.status`, `paid_amount`, `paid_at`, `paystack_reference`,
  `paystack_access_code` UPDATE

`users.is_active` UPDATE remains granted to `authenticated` for
`setTeacherActive`. Self-change is C4.

Expected catalog state is commented in the proposed file and queried by
`catalog-verify.sql`.

## C4 — Inactive user protection

**Finding:** `User updates self` plus UPDATE(`is_active`) lets an inactive
user PATCH `is_active=true`.

**Correction:** `users_identity_freeze` also fires `BEFORE UPDATE OF
is_active`. If `NEW.is_active IS DISTINCT FROM OLD.is_active` and
`NEW.id = auth.uid()` and `auth.role() <> 'service_role'`, raise
`self_activation_frozen`.

`setTeacherActive` updates a **different** id with a school-admin JWT and
remains allowed here. RLS `School admin manages users` still applies.
After B, inactive admins fail `is_school_admin()`.

Helpers in 00010 already require `users.is_active IS TRUE`.

---

## H1 — Migration order

Required order is now the **filename** order (`20261015000010` …
`00090`). `scripts/db-apply*.mjs` sorts lexicographically; letter names
`A-` … `H-` would have applied A before B.

Old letter-named `.sql.proposed` files are removed so they cannot be
copied in the wrong order.

These files stay under `docs/security/rls-prep/proposed-sql/` with suffix
`.sql.proposed`. They are not on the production apply path.

## H2 — Lesson plan approval

Broad owner UPDATE is replaced by:

- `lesson_plans_update_owner_content` — owner, non-approved statuses only
- `lesson_plans_update_admin_review` — `is_school_admin()` / super-admin
- trigger `lesson_plans_approval_freeze` — `status -> approved` requires
  school admin **and** `teacher_id <> auth.uid()` (super-admin excepted)

Teacher UI already only writes `draft`/`submitted`. Admin UI writes
approval via JWT; that remains the authorized path once E-B is applied.

## H3 / H4 — Paystack security design

See `PAYMENT-INVARIANTS.md`. D SQL only freezes JWT settlement writes.
Amount/currency match, reference+fee binding, webhook identifier
refusal, idempotency, concurrency, and service_role query shape are
application invariants. **Not implemented** in this mission.

## H5 — HR server-side write path

See `HR-RPC-CONTRACT.md`. SQL RPC has no `p_role` and pins the target to
the staff-role set. Future `hr.functions.ts` must not unbounded-update by
id. **Not implemented** in this mission.

## H6 — Related RLS policies

See `RELATED-POLICIES.md`. `staff_payroll` and `teacher_biometrics` FOR
ALL policies **must** be addressed before SHERIVS-003 can close.
Named `tenant_all_*` must be gone before SHERIVS-002 can close.
Unsupported product permissions are marked BLOCKED.

## H7 — Provisioning compatibility claims

| Claim | Support in proposed SQL | Status |
|-------|-------------------------|--------|
| Founder RPC INSERT `users` | A is UPDATE-only | Design OK |
| Founder membership row | C2 depth > 1 on sync | Design OK, **NOT VERIFIED** |
| `switchActiveOrganization` | service_role users write + sync | Design OK, **NOT VERIFIED** |
| `createStaffAccount` / `inviteTeacher` | service_role | Design OK, **NOT VERIFIED** |
| `saveStaff` JWT role/salary | **incompatible** until `hr.functions.ts` | Must land in same release as A/F |
| `initFeePayment` JWT settlement | **incompatible** until Paystack app change | Must land with D |
| `app-context` `select("*")` | **incompatible** with F | Must land with F |
| Provisioning "proven compatible" | no staging JWT run | **NOT VERIFIED** — do not claim |

---

## Remaining NOT VERIFIED

- All staging JWT matrix rows (GATE 4/5 still BLOCKED — no staging project).
- `pg_trigger_depth() > 1` founder path on a live Postgres.
- Catalog after G matches the commented privilege list.
- Duplicate `school_isolation` + `biometrics_school_isolation` live state.
- Paystack amount/reference/idempotency (app not changed).
- `hr.functions.ts` (not created).
- FORCE RLS owner-maintenance impact.

## Remaining BLOCKED

- GATE 4/5/6.
- B1 parent_student_map authenticated writes.
- B8 manual mark-paid.
- B9 student medical / clinic visibility.
- B10 related isolation command-split (required for 003 on payroll/biometrics).
- Hostel-warden / nurse-only clinic / parent discipline reads.
- Admin deactivating another admin.

## Explicit non-execution

No SQL was executed. No database was opened or changed. Canonical
production project `nwrflbpbhyiqdptmlccm` was not targeted.
