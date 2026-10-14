# SHERIVS-RLS-GATE3-INDEPENDENT-REVIEW-002

**Mission:** Independent review of SHERIVS-RLS-GATE3-CORRECTIONS-001 artifacts.

**Reviewer posture:** PostgreSQL/Supabase RLS and application-security review.
This review does **not** reuse the correction report as evidence.

**Version target:** ACTIVE-V1 only. V2/V3 frozen.

**Verdict:** **PASS WITH CONDITIONS**

The corrected artifacts are **not safe to apply**. SHERIVS-001, SHERIVS-002,
and SHERIVS-003 remain **OPEN**. Gate 3 is **not** fully passed.

This is a second-round conditions pass: C1, C4, H1, H2 (static), and the
H5 SQL signature are improved. C3 is **not** actually satisfied. C2 is
**BLOCKED** as a proven mechanism. H3/H4/H5 application work remains
unresolved. Unit tests do **not** prove database security.

---

## 0. Review baseline (static)

| Item | Value |
|------|-------|
| Authoritative production git | `origin/master` @ `d195ba8` |
| Corrections commit reviewed | `origin/cursor/sherivs-rls-gate3-corrections-49a0` @ `149a87d8b5307675dcc133df7fd2f216f2a876e6` |
| Local HEAD at review start | same `149a87d` (fetched; not a stale checkout) |
| Proposed SQL | `.sql.proposed` under `docs/security/rls-prep/proposed-sql/` only |
| Production/staging database | **not opened** |
| SQL execution | **none** |
| Hostname routing | out of scope; not reviewed as changed |

Proposed SQL is **not** live SQL. No proposed file has been applied.

Source tests (`tests/unit/sherivs-rls-implementation-prep.test.ts`) are
plan-integrity ratchets (filenames, forbidden `pg_catalog.auth.uid()`
**calls**, heading pins). They do not execute PostgreSQL, PostgREST, or
JWT sessions.

---

## 1. C1 — Auth function resolution

**Static finding:** **ADDRESSED** in proposed function bodies.

**Runtime resolution:** **NOT VERIFIED**.

Every proposed `SECURITY DEFINER` function sets
`search_path = pg_catalog, public` and calls `auth.uid()` / `auth.role()`
as two-part names. Those names do not use `search_path`. Unqualified names
resolve only in `pg_catalog` then `public`. The `auth` schema is not added
to `search_path`. There are no `pg_catalog.auth.uid()` / `auth.role()`
calls in `.sql.proposed` files.

RLS policy bodies in `00050`–`00070` also use two-part `auth.uid()`.
Policies cannot SET `search_path`; qualified `auth.uid()` is the normal
Supabase form.

`pg_catalog.pg_trigger_depth()` in `00030` is a valid catalog-qualified
call (`schema.function`), not the invalid three-part `pg_catalog.auth.*`
pattern.

**Shadowing:** An attacker would need the ability to create a schema named
`auth` or replace `public.get_my_*`. `authenticated` cannot do that under
normal Supabase privileges. **NOT VERIFIED** against the live catalog of
role privileges.

**Out of proposed-SQL scope:** live `create_organization_with_founder`
still uses `SET search_path = public` (`20261008000060`). Its `auth.uid()`
call is still two-part. This review does not treat that as a C1 fail of
the proposed files.

**Staging required:** parse/execute each proposed function as
`authenticated` and `service_role`; `SELECT auth.uid()` inside a DEFINER
function with the locked search_path; confirm `search_path` on
`pg_proc.proconfig`.

---

## 2. C2 — Membership synchronization — **BLOCKED** as proven

The correction report’s “design-compatible” founder claim is **not**
accepted as proof.

### Intended founder flow (source)

`create_organization_with_founder` (`20261008000060`):

1. Caller JWT remains `authenticated` (`auth.uid()` stored in `v_caller`).
2. DEFINER `INSERT` into `public.users` (identity freeze is UPDATE-only, so
   it does not block this INSERT).
3. Existing `organization_memberships_sync` AFTER INSERT on `users` runs
   `sync_organization_membership_on_user_write`.
4. That function `INSERT ... ON CONFLICT DO UPDATE` into
   `organization_memberships`.

Static depth model (PostgreSQL `pg_trigger_depth()`):

| Operation | Depth inside `memberships_identity_freeze` | Proposed result |
|-----------|--------------------------------------------|-----------------|
| Direct PostgREST INSERT/UPDATE on `organization_memberships` | 1 | deny unless `auth.role() = 'service_role'` |
| Nested write from `users` AFTER sync | 2 | allow (`> 1`) |
| `switchActiveOrganization` service_role UPDATE `users` then sync | 2, and `auth.role()` is `service_role` | allow either clause |
| `setTeacherActive` JWT UPDATE other user’s `is_active` then sync | 2 | allow via depth, not via service_role |

Trigger depth **does not prove caller authorization**. It only proves the
memberships write was caused by another trigger. The real trust boundary
is: whoever was allowed to INSERT/UPDATE `users` identity/`is_active`.

### Writers of `organization_memberships` (source inventory)

| Writer | Kind |
|--------|------|
| `sync_organization_membership_on_user_write` | ONLY runtime SQL writer in `database/supabase/migrations/` after backfill |
| One-time backfill in `20261008000050` | migration DML, not a recurring trigger |
| `organization_memberships_touch` | BEFORE UPDATE `updated_at` only; does not write identity columns |
| App `memberships.functions.ts` | **SELECT** only; switcher writes `users` via `service_role` |
| e2e `authenticated-shell.spec.ts` | service_role DELETE (test) |

No second production trigger that writes memberships was found in
migrations. Residual: **any future** trigger that writes memberships also
sees depth > 1. The freeze does not bind `TG_NAME` / parent trigger
identity.

### GRANT revoke does not yet close the client write path on `users`

`00080` REVOKEs `INSERT/UPDATE/DELETE` on `organization_memberships` from
`authenticated` (explicit `REVOKE`, not merely a narrower `GRANT`). That
pattern is correct **for memberships**.

It does **not** `REVOKE INSERT, DELETE` on `public.users` (see C3). Live
foundation SQL still has:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated
```

plus policy `"School admin manages users" FOR ALL`.

**Statically derived consequence:** after the proposed sequence as written,
a school-admin JWT can still `INSERT` (and likely `DELETE`) `public.users`
via PostgREST. That INSERT fires nested memberships sync at depth 2 and
**is allowed by the C2 exception**. Depth then authorizes an unintended
memberships write that originated from a client users INSERT, not from
founder DEFINER or service_role provisioning.

That is why C2 is **BLOCKED** as a complete authorization argument:

1. Depth is a nesting latch, not an authorization decision.
2. Nested allow is only as safe as the `users` write gate.
3. The `users` write gate still includes authenticated INSERT (C3).
4. Runtime depth for `INSERT ... ON CONFLICT DO UPDATE` is **NOT VERIFIED**.

No client-settable GUC was introduced. That part of the prior condition is
statically clear.

### SECURITY DEFINER / ownership

Freeze and sync functions are DEFINER with locked search_path. They run as
the function owner (typically a BYPASSRLS superuser in Supabase).
`auth.uid()` / `auth.role()` still read the session JWT. **NOT VERIFIED**
against live `pg_proc.proowner` / `rolbypassrls`.

`organization_memberships` already has FORCE RLS. DEFINER owner with
BYPASSRLS bypasses it. Nested sync therefore does not need the INSERT
policy. Client PostgREST still needs table GRANT + policy; after `00080`
memberships GRANT is SELECT-only, so **direct** memberships DML should
fail at privilege check. **NOT VERIFIED** in catalogs.

### Staging evidence required before C2 can be unblocked

- Founder RPC as an unlinked authenticated JWT: users row + memberships
  row created; `pg_trigger_depth` path not required to be logged if the
  rows exist and a second founder call is denied.
- Direct authenticated INSERT/UPDATE/DELETE on memberships: denied.
- School-admin PostgREST INSERT into `users`: **must be denied** after G
  (this currently fails the static GRANT analysis).
- Org switch via `switchActiveOrganization`: succeeds; JWT UPDATE of
  `users.school_id` denied.
- No other trigger writes memberships (`pg_trigger` inventory).

Until those exist, do **not** claim founder provisioning is compatible.

---

## 3. C3 — GRANT regression — **NOT SATISFIED**

**Column re-REVOKE after `GRANT UPDATE ON TABLE` is ordered correctly
inside `00080`.** That specific prior bug (table GRANT restoring every
column) is statically addressed **for the columns the file revokes**.

**PostgreSQL `GRANT` is additive.** `GRANT SELECT, UPDATE ON TABLE
public.users TO authenticated` does **not** remove existing
`INSERT`/`DELETE` from `20260620122048`.

`00080` uses the correct `REVOKE INSERT, UPDATE, DELETE` pattern only for
`organization_memberships`. It does **not** revoke withdrawn table
privileges on:

| Table | Comment claims | Static leftover from live GRANT |
|-------|----------------|----------------------------------|
| `users` | SELECT+UPDATE only; no INSERT/DELETE | INSERT, DELETE remain |
| `fees` | no DELETE | DELETE remains (RLS has no DELETE policy → deny unless FORCE/owner) |
| `attendance` | no DELETE | DELETE remains (no DELETE policy) |
| `parent_student_map` | SELECT only | INSERT/UPDATE/DELETE remain (no write policies → RLS deny) |
| `students`, `classes`, … | full DML | matches comment |

**HIGH:** leftover `users` INSERT + `"School admin manages users" FOR ALL`
preserves a client identity-create path and nested memberships sync (C2).

**HIGH:** leftover `users` DELETE + the same FOR ALL policy preserves
school-admin user deletion via PostgREST.

Fees/attendance/map leftovers are lower severity **if** command policies
have no DELETE/write (RLS fail-closed). Privileges should still match the
comments; catalogs will otherwise contradict `catalog-verify.sql`
expectations that assume the comments.

Required correction: for every table whose intended grant is narrower than
live, `REVOKE` the withdrawn commands **then** `GRANT` the remainder.
Re-run column REVOKEs after any table `GRANT UPDATE`.

---

## 4. C4 — Self-reactivation — **ADDRESSED statically**

`users_identity_freeze` fires `BEFORE UPDATE OF school_id, role, is_active`.
Self-change of `is_active` with a user JWT raises `self_activation_frozen`.
`setTeacherActive` updates a **different** id, `eq("role", "teacher")`,
after `requireSchoolAdminScope`. Statically compatible.

`"User updates self"` still matches an inactive user’s own row. The
**trigger** is the control, not the policy and not a column REVOKE.
`authenticated` keeps `UPDATE(is_active)` by design.

After `00010`, `is_school_admin()` / `get_my_school_id()` require
`users.is_active IS TRUE`, so inactive admins lose the school-admin users
policy. They still have `"User updates self"` for profile fields.

**Residual:** school admin JWT may still `UPDATE is_active` on **any**
same-school user (not only teachers), because the freeze only blocks
self-change and `"School admin manages users"` is FOR ALL. Narrower than
role/tenant theft; broader than `setTeacherActive`.

**Runtime:** NOT VERIFIED.

---

## 5. Effective privilege matrix (STATICALLY DERIVED)

Assumes the full proposed sequence `00010`–`00080` applied to the live
master grants. **Not** a staging catalog. `00090` FORCE RLS excluded
(optional, last, extra founder risk).

Legend: Y = permitted by grant **and** a matching RLS policy or DEFINER
path; G = table GRANT present but RLS should deny; N = no grant or
explicit column revoke; T = trigger denies even if grant+RLS match.

### `authenticated` student / teacher / parent JWT

| Object | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `users` own row (non-sensitive cols) | Y | G leftover INSERT; no INSERT policy except school-admin FOR ALL → N for these roles | Y profile; T self `is_active`; N `role`/`school_id` | G leftover DELETE; no DELETE policy for these roles → N |
| `users.salary` / `nin` / `bank_*` / `face_biometric` | N after F+G | — | N | — |
| `organization_memberships` | Y own/admin policies | N after explicit REVOKE | N | N |
| `fees` settlement cols | Y if fees SELECT policy | — | N column + T | G leftover; no DELETE policy → N |
| `staff_payroll` / `teacher_biometrics` | Y school-wide FOR ALL (**003 OPEN**) | Y | Y | Y |

### `authenticated` school admin / principal JWT

| Object | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `users` same school | Y (peer SELECT; salary N) | **Y leftover INSERT + FOR ALL** | Y profile/`is_active` others; N `role`/`school_id`; T self `is_active` | **Y leftover DELETE + FOR ALL** |
| HR salary | Y via `admin_hr_staff_list` DEFINER | — | Y via `admin_hr_staff_write` DEFINER (staff-role pin) | — |
| `users.role` | Y | via INSERT of a new row (**leftover**) | N PostgREST; future `hr.functions.ts` only | — |

### `service_role`

Table ALL / BYPASSRLS on named tables in proposed GRANTs. Identity and
settlement column writes allowed by triggers. **Application** must still
constrain fee id+reference+amount (H3/H4). Unbounded `update().eq("id")`
remains a live Paystack/HR risk until those apps change.

### Inactive user

Helpers return NULL/false. Admin policies fail. Self profile UPDATE still
possible. Self `is_active` T. Cannot switch org (app checks `is_active`).

---

## 6. H1 — Migration order

**Static finding:** filename order `00010`–`00090` matches the required
graph. Letter-named files are gone.

| Step | Depends on | Static OK? |
|------|------------|------------|
| `00010` helpers | live `users`, `organization_memberships`, `super_admins` | Y |
| `00020` HR RPCs | `00010` `is_school_admin` / `get_my_school_id` | Y |
| `00030` identity freeze | helpers not required in trigger body; sync function replace does not drop the existing `users` trigger | Y |
| `00040` F | `00020` for salary display via RPC | Y as SQL; app `select("*")` still incompatible |
| `00050` E-A | `00010` | Y |
| `00060` E-B + H2 | `00010`; drops `tenant_all_*` then creates command policies | Y |
| `00070` D+E-C | freeze before dropping `tenant_all_fees` in the same file | Y |
| `00080` G | should restore A/D/F columns after table GRANT — column part Y; table least-privilege **N** (C3) | **N** |
| `00090` FORCE RLS | last; founder INSERT policy under FORCE **NOT VERIFIED** | optional / **BLOCKED** to apply |

No proposed file references a helper that is created later.

Rollback SQL is still documentation-only. Inverse files are not in this
review set.

---

## 7. H2 — Lesson-plan approval — **ADDRESSED statically**

Permissive RLS ORs policies. `lesson_plans_update_owner_content` cannot
`WITH CHECK` `approved`. `lesson_plans_update_admin_review` **can**,
including when the actor is both owner and school admin.

The BEFORE UPDATE OF status trigger is the self-approval control:

- `status -> approved` requires `is_school_admin()` or `is_super_admin()`
  (or `service_role`).
- If `NEW.teacher_id = auth.uid()` and not super-admin → deny.

Ordinary teacher: denied by policy and trigger. Teacher+admin: denied by
trigger. Other school admin: allowed. Super-admin may approve a plan they
own.

INSERT WITH CHECK limits non-super-admin to `draft`/`submitted`. Trigger
does not cover INSERT; super-admin INSERT of `approved` is possible.

Teacher UI writes `draft`/`submitted` only. Admin UI updates status
without comparing `teacher_id` to self — a teaching principal will get
`lesson_plan_self_approval_denied`. Compatibility gap, not a self-approve
bypass.

Unauthorized transitions (`needs_revision` by teacher): owner WITH CHECK
only `draft`/`submitted`. **NOT VERIFIED** at runtime.

`service_role` bypasses the self-approve rule. Documented.

---

## 8. H3 / H4 — Paystack and fee settlement — **UNRESOLVED**

Application code has **not** changed. Live defects in
`paystack.functions.ts` and `webhooks/paystack.ts` remain. `00070` only
blocks **user-JWT** settlement writes. `service_role` is unconstrained in
SQL.

Keep **unresolved** until implementation **and** isolated tests exist for:

- Exact amount (kobo) and currency match against the fee row
- Binding verified `reference` to the intended fee `id` (not metadata alone)
- Ownership/relationship authorization beyond RLS visibility
- Refusal of webhooks missing `reference` or `metadata.fee_id`
- Idempotent duplicate `charge.success` (no `paid_at` rewrite)
- Concurrent verify + webhook (single conditional UPDATE / row lock)
- No privileged UPDATE by fee id without reference and `school_id`
- No client-controlled `status=paid` (B8 remains BLOCKED)

`PAYMENT-INVARIANTS.md` correctly records these as application invariants.
That document is **not** evidence they hold.

D SQL is an incomplete but directionally correct JWT freeze. It must not
ship without the app change. Shipping D alone breaks `initFeePayment` /
`verifyFeePayment` (they UPDATE settlement columns with the user JWT).

---

## 9. H5 — HR RPC — SQL improved; apply **BLOCKED** without the app

`admin_hr_staff_write` no longer accepts `p_role` and pins the target to
the staff-role set on SELECT and UPDATE. Actor checks use `00010` helpers
(active admin/principal or super-admin). Tenant pin for non-super-admin.
EXECUTE revoked from PUBLIC/anon.

`HR-RPC-CONTRACT.md` forbids unbounded `supabaseAdmin.update(rest).eq("id")`.
**Not implemented.** Live `admin/hr.tsx` `saveStaff` still JWT-updates
`role` and `salary`.

Applying A+F without `hr.functions.ts` breaks the HR form (documented).
Role changes still have no authorized user-JWT path (correct) and no
implemented service_role path (missing).

SQL RPC does not audit. Email updates are privileged DEFINER writes.
Staff set includes `admin`/`principal` (salary of peer admins). Acceptable
only as a product decision, not as identity freeze.

---

## 10. H6 — Related policies

`RELATED-POLICIES.md` is an inventory, not a remediation. Agree:

- Named `tenant_all_*` must be gone before SHERIVS-002 can close.
- `staff_payroll` and `teacher_biometrics` FOR ALL must be command-split
  (or equivalent) before SHERIVS-003 can close, in addition to F.

Inventory gaps (same defect class, not named 002 tables):
`school_api_keys`, `student_platform_fee_ledger`, `admission_applications`,
`school_staff`, `ai_interaction_log`, `study_sessions`. Secrets/financial
tables are closer to 003 than hostel room metadata. Mark **BLOCKED** for
003 close-out until payroll/biometrics are split; treat api_keys/ledger as
follow-on HIGH.

Unsupported product permissions remain BLOCKED (B1, B8, B9, hostel-warden,
parent discipline, admin-lifecycle).

---

## 11. H7 — Provisioning compatibility claims

| Claim | This review |
|-------|-------------|
| Founder INSERT `users` not blocked by A | True (UPDATE-only freeze) |
| Nested memberships write allowed at depth > 1 | Plausible; **NOT VERIFIED**; **BLOCKED** as proof |
| `switchActiveOrganization` service_role | Plausible; **NOT VERIFIED** |
| `createStaffAccount` / `inviteTeacher` service_role | Plausible; **NOT VERIFIED** |
| School-admin PostgREST INSERT `users` removed | **False** in proposed G (C3) |
| FORCE RLS `00090` founder INSERT | **NOT VERIFIED**; likely needs BYPASSRLS owner; treat `00090` as **BLOCKED** to apply |
| `saveStaff` / Paystack / `select("*")` compatible | **False** until app work |

Do not treat any of the first four as production-compatible.

Live `20261008000060` header still says the founder function is “NOT YET
APPLIED”. Prep docs say it was applied to the canonical project. This
review did not query `supabase_migrations`. Founder **path** is reviewed
from SQL source only. Apply-stamp is **UNKNOWN**.

---

## 12. Conditions that remain (must fix before SQL is apply-eligible)

1. **C3:** `REVOKE` withdrawn table privileges on `users` (INSERT, DELETE)
   and any other table whose comments claim a narrower command set; then
   `GRANT` the remainder; then re-REVOKE identity/HR/settlement columns.
2. **C2:** After (1), re-argue nested depth as subordinate to the users
   write gate; staging founder + negative memberships tests.
3. **H5/H3/H4:** implement the documented app contracts in the **same
   release** as A/F/D; until then those change sets are not releasable.
4. **C1/C4/H2:** staging JWT proofs. Static review is not runtime.
5. **H6:** payroll/biometrics command-split before closing 003.
6. **00090:** do not apply until founder INSERT under FORCE RLS is proven.
7. Catalog-verify queries must assert `users` INSERT/DELETE **absent** for
   `authenticated`, not only TRUNCATE/column revokes.

## What may proceed

- Further design correction of `00080` (and catalog-verify) only.
- Independent re-review of that delta.
- Staging project provisioning by a human (GATE 4 prerequisite).

## What remains prohibited

- Copying `.sql.proposed` into `database/supabase/migrations/`
- Any database connection or SQL execution against production/staging
- GATE 6
- Closing SHERIVS-001 / 002 / 003
- Hostname, DNS, Vercel, Supabase project, or deployment changes

---

## 13. Explicit non-execution

No SQL was executed. No database was opened. No customer data was read.
No grants, policies, triggers, or application code were modified by this
review. Proposed files were not applied.

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
