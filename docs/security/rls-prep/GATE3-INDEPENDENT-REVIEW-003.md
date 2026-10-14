# SHERIVS-RLS-GATE3-INDEPENDENT-REVIEW-003

**Mission:** Independent review of SHERIVS-RLS-GATE3-CORRECTIONS-002 artifacts.

**Reviewer posture:** PostgreSQL/Supabase RLS and application-security review.
This review does **not** reuse `GATE3-CORRECTIONS-002.md` as evidence.
Prior report `GATE3-INDEPENDENT-REVIEW-002.md` is **not** overwritten.

**Version target:** ACTIVE-V1 only. V2/V3 frozen.

**Verdict:** **A. PASS FOR STAGING PREPARATION ONLY**

The static defects that made corrections-001 unsafe to apply (additive
`users` INSERT/DELETE; `pg_trigger_depth()` as membership authorization)
are addressed **in the proposed SQL text**. That is **not** Gate 3 fully
passed, **not** a catalog proof, and **not** authorization to execute SQL.

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.

---

## 0. Review baseline (static)

| Item | Value |
|------|-------|
| Authoritative production git | `origin/master` @ `d195ba8` |
| Previously reviewed corrections-001 | `149a87d8b5307675dcc133df7fd2f216f2a876e6` |
| This checkout | `cursor/sherivs-rls-gate3-independent-review-003-49a0` |
| Reviewed HEAD | `08fa49fb65c615faddad354c71374dc7d9b64aba` (`docs: pin users.is_active grant comment after C3 allowlist`) |
| Remote match | `origin/cursor/sherivs-rls-gate3-corrections-002-49a0` = same SHA after fetch |
| Ancestry | `149a87d` is an ancestor of HEAD. Between them: `d1db23b` (review-002), `c86dee5` (corrections-002), `08fa49f` (comment pin) |
| Proposed SQL | `.sql.proposed` under `docs/security/rls-prep/proposed-sql/` only |
| Production/staging database | **not opened** |
| SQL execution | **none** |
| Isolated staging project | **does not exist in this mission; not used** |
| Hostname routing | out of scope; not reviewed as changed |

Proposed files were **not** applied. Unit tests (`tests/unit/sherivs-rls-implementation-prep.test.ts`)
are filename/string ratchets. They do not execute PostgreSQL, PostgREST, or JWT sessions.

`GATE3-CORRECTIONS-002.md` claims decision A. This review inspected the
SQL and live migrations independently of that claim.

---

## 1. C1 — Auth function resolution

**Classification:** **PASS WITH CONDITIONS**. Runtime: **NOT VERIFIED**.

Every proposed `SECURITY DEFINER` function inspected sets
`SET search_path = pg_catalog, public` and calls `auth.uid()` / `auth.role()`
as two-part names. No proposed file contains a `pg_catalog.auth.uid()` or
`pg_catalog.auth.role()` **call**. Comments that mention the forbidden form
are not executable.

`pg_trigger_depth` appears only as a **rejected-alternative comment** in
`00030`. There is no `pg_catalog.pg_trigger_depth()` call in proposed
function bodies.

Live `create_organization_with_founder` still uses `SET search_path = public`
(`20261008000060`). Out of proposed-SQL scope. `auth.uid()` there remains
two-part.

**Staging required:** parse/execute each proposed function as
`authenticated` and `service_role`; confirm `pg_proc.proconfig` search_path.

**Blocks staging SQL application:** no (static form is valid).
**Blocks production:** yes until runtime parse is recorded.

---

## 2. C3 — Privilege sequence

**Classification:** **PASS WITH CONDITIONS**. Catalog: **NOT VERIFIED**.

Live foundation (`20260620122048`) still contains:

```
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated
```

plus `"School admin manages users" FOR ALL`.

Review-002’s defect was that `GRANT SELECT, UPDATE` is **additive** and
does not remove INSERT/DELETE. That statement is still true in PostgreSQL.
The proposed sequence **no longer relies on additive GRANT alone**.

### Actual order in `00080` (executable statements, not comments)

1. `REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated`
   (and the other named tables).
2. `GRANT SELECT, UPDATE ON TABLE public.users TO authenticated`
   — no INSERT, no DELETE in this GRANT.
3. `GRANT ALL ... TO service_role` on a subset of tables.
4. `REVOKE INSERT, DELETE ON TABLE public.users FROM PUBLIC, anon, authenticated`
   after the allowlist GRANT.
5. Column `REVOKE UPDATE (role, school_id)`, `REVOKE SELECT, UPDATE` of HR
   columns, `REVOKE UPDATE` of fee settlement columns — **after** the table
   GRANT UPDATE.

`00030` also `REVOKE INSERT, DELETE ON public.users` and drops the FOR ALL
school-admin policy before later GRANTs. `00090` does not GRANT anything.

No proposed file after `00080` restores `INSERT` or `DELETE` on `users` to
`authenticated`. No file contains `GRANT SELECT, INSERT ... ON TABLE public.users TO authenticated`
or `GRANT ALL ON TABLE public.users TO authenticated`.

`GRANT SELECT, UPDATE ON TABLE` **does** restore column UPDATE on `role`,
`school_id`, `salary`, and settlement columns. The column REVOKEs in the
same file after that GRANT are the control. Order inside `00080` is
internally consistent.

`00040` / `00070` column REVOKEs would be undone by `00080`’s table GRANT
if step 5 were omitted. It is not omitted.

### School-admin policy split (`00030`)

`DROP POLICY "School admin manages users"` then:

- `users_school_admin_select` FOR SELECT
- `users_school_admin_update_staff` FOR UPDATE, staff-role pin, same school
- **no** INSERT policy, **no** DELETE policy

INSERT/DELETE are therefore denied at **privilege** (after G) and at
**policy** even if a later GRANT mistake restored table INSERT/DELETE.

### Static privilege matrix — NOT VERIFIED

Derived from live table GRANTs plus proposed `00010`–`00080`. `00090`
excluded. Comments in `00080` were **not** used as proof.

#### anon

No table DML on the named REVOKE ALL set after `00080`. **NOT VERIFIED.**

#### service_role

Table ALL where `00080` GRANTs ALL, plus foundation ALL on other tenant
tables. BYPASSRLS (Supabase default — **NOT VERIFIED**). SQL does not
constrain fee amount matching or HR role writes.

#### authenticated — table grants after `00080`

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `users` | Y | **N** | Y | **N** |
| `organization_memberships` | Y | **N** | **N** | **N** |
| `parent_student_map` | Y | **N** | **N** | **N** |
| `fraud_attempts` | Y | **N** | **N** | **N** |
| `fees` | Y | Y | Y | **N** |
| `attendance` | Y | Y | Y | **N** |
| `staff_payroll` | Y | Y | Y | **N** |
| `teacher_biometrics` | Y | Y | Y | **N** |
| `students`, `classes`, calendar, timetables, slots, `lesson_plans`, `attendance_logs`, `subscriptions`, `grades` | Y | Y | Y | Y |

#### authenticated — `users` columns after `00080`

| Column | SELECT | UPDATE |
|--------|--------|--------|
| `role`, `school_id` | Y | **N** |
| `is_active` | Y | Y |
| `salary`, `nin`, `bank_*`, `face_biometric` | **N** | **N** |
| other profile columns | Y | Y |

RLS still applies. Table GRANT is not row authorization.

**Residual:** other roles (`postgres`, `authenticator`, default privileges)
were not inventoried. Staging `information_schema.role_table_grants` is
required.

**Blocks staging SQL application:** no static additive-GRANT defect remains
in the proposed text.
**Blocks production:** yes until catalog-verify empty-set for `users`
INSERT/DELETE is recorded on isolated staging.

---

## 3. C2 — Membership authorization

**Classification:** **PASS WITH CONDITIONS**. Runtime: **NOT VERIFIED**.
**Not BLOCKED** as a proven mechanism: the review-002 blocker (leftover
`users` INSERT + depth latch) is not present in this SQL.

### What the SQL actually does

`freeze_membership_identity_columns` (`00030`):

- Allows the row if `auth.role() = 'service_role'`.
- Else allows if `EXISTS` a `public.users` row with the same
  `(id, school_id, role)` as `NEW`.
- Else raises `membership_identity_frozen`.
- **Does not** call `pg_trigger_depth()`.
- **Does not** read a GUC.

Write policies `organization_memberships_insert|update|delete` are dropped.
`00080` GRANTs `SELECT` only, then REVOKEs INSERT/UPDATE/DELETE.

`sync_organization_membership_on_user_write` is replaced with
`search_path = pg_catalog, public`. EXECUTE revoked from
PUBLIC/anon/authenticated. The existing `organization_memberships_sync`
trigger on `users` is not dropped; it continues to point at this function.

### Row equality is consistency, not caller authorization

The mirror `EXISTS` proves the membership tuple matches a `users` row. It
does **not** prove that the session is a trusted provisioning principal.
Any writer that can produce a matching tuple would pass the freeze.

Authorization of **who may cause that tuple** is therefore:

1. Client PostgREST membership DML: no GRANT, no write policy → deny.
2. Who may INSERT/UPDATE `public.users` identity columns.
3. `service_role` (freeze short-circuit; BYPASSRLS).

(1) is statically present. (2) after C3: authenticated has no `users`
INSERT/DELETE GRANT; identity UPDATE is frozen unless `service_role`;
school-admin policy is SELECT + staff UPDATE only.

### Traces (source, not runtime)

| Path | Writer | Nested memberships | Static result |
|------|--------|--------------------|---------------|
| `create_organization_with_founder` | DEFINER INSERT `users` (owner privileges; JWT stays `authenticated`) | AFTER INSERT sync upsert | Freeze: JWT is not `service_role`; mirror matches the just-inserted users row → allow **if** the DEFINER writer can INSERT under memberships FORCE RLS |
| `switchActiveOrganization` | `service_role` UPDATE `users.school_id/role` | sync | freeze allows `service_role`; JWT cannot UPDATE those columns |
| `createStaffAccount` / `inviteTeacher` / demo | `service_role` INSERT/upsert `users` | sync | freeze allows `service_role` |
| `setTeacherActive` | JWT UPDATE other teacher `is_active` | sync updates membership `is_active` | freeze fires on `ON CONFLICT ... SET role` (column listed). Mirror still matches. Intended for teachers; see C4 residual |
| Direct PostgREST memberships DML | JWT | none | no GRANT / no policy |
| School-admin PostgREST INSERT `users` | JWT | would have nested-written at depth 2 under the old design | **no INSERT GRANT; no INSERT policy** → sync does not run |

App `memberships.functions.ts` SELECTs memberships and writes `users` only
via `supabaseAdmin`. No second production SQL writer of memberships was
found in `database/supabase/migrations/` besides sync and the original
backfill.

### SECURITY DEFINER and FORCE RLS (the remaining C2 risk)

`organization_memberships` **already** has FORCE RLS in live
`20261008000050`. After write policies are dropped, a SECURITY DEFINER
sync INSERT succeeds only if the function owner **BYPASSRLS** (or an
INSERT policy exists). Owner-bypass is disabled by FORCE.

Live founder may today succeed either via BYPASSRLS **or** via the
school-admin INSERT policy (the new users row is visible in the AFTER
INSERT trigger, so `is_school_admin()` can be true). Dropping that
policy removes the second path.

This review did **not** query `pg_proc.proowner` / `rolbypassrls`.
Supabase-typical `postgres` BYPASSRLS is **not** treated as proven.

If FND-01 fails on staging, the design needs a proven DEFINER/BYPASSRLS
inventory or a different trusted writer — not a return of trigger depth.

**Does a school-admin JWT mint arbitrary memberships?** Statically no:
they cannot INSERT `users`, cannot UPDATE `role`/`school_id`, cannot
INSERT memberships. They can UPDATE `is_active` on other **staff** rows,
which syncs membership `is_active` for that same `(user, school, role)`.
That is not an extra-organization grant.

**Founder without generic client INSERT:** statically the intended path
is DEFINER owner INSERT, not `GRANT INSERT ON users TO authenticated`.
Whether that INSERT is visible to RLS under FORCE on `users` is a `00090`
issue. Whether nested membership INSERT is visible under **already-forced**
memberships RLS is FND-01. Neither was executed here.

**Blocks staging SQL application:** no further proposed-SQL redesign is
required before an isolated FND-01. Applying `00030` on staging is a
**later GATE 4 action**, not authorized by this review.
**Blocks production:** yes until FND-01, MEM-01/02, INS-01, SW-01 pass.

---

## 4. C4 and identity provisioning

**Classification:** **PASS WITH CONDITIONS**. Runtime: **NOT VERIFIED**.

| Path | Caller | Trust boundary | Permitted | DB priv / RLS | Staging |
|------|--------|----------------|-----------|---------------|---------|
| Self-promotion `role` | JWT | freeze + column REVOKE | none | UPDATE table yes; UPDATE(`role`) no; `User updates self` | ID-01 |
| Tenant reassignment `school_id` | JWT | same | none | UPDATE(`school_id`) no | ID-02 |
| Self-reactivation | JWT | freeze `NEW.id = auth.uid()` | none | UPDATE(`is_active`) remains | C4-01 |
| `setTeacherActive` | JWT-srv school-admin | freeze allows **other** id | `is_active` of `role=teacher` | table UPDATE + staff UPDATE policy | ACT-01 |
| School-admin PostgREST INSERT `users` | JWT admin | no GRANT, no INSERT policy | none | — | INS-01 |
| School-admin DELETE `users` | JWT admin | no GRANT, no DELETE policy | none | — | DEL-01 |
| Founder | unlinked JWT | DEFINER function | INSERT own admin row | owner DML; authenticated has no INSERT GRANT | FND-01 **NOT VERIFIED** |
| Org switch | JWT + service_role | service_role UPDATE two columns copied from own active membership | own row only | freeze allows service_role | SW-01 |
| `createStaffAccount` / `inviteTeacher` | JWT gate + service_role | `supabaseAdmin` | identity insert | service_role ALL | not a client INSERT |
| `updateMyProfile` | JWT-srv | Zod allowlist | name/phone/address/emergency/avatar | `User updates self`; frozen cols blocked | P1 |
| `saveStaff` | JWT | **none** | live writes `role` and `salary` | **incompatible** with A+F | release blocker H5 |

**Residual (not a C2 fail):** `users_school_admin_update_staff` allows a
school-admin JWT to UPDATE `is_active` of **any same-school staff**
(including another admin), not only teachers. Narrower than the old FOR
ALL (students/parents excluded). Broader than `setTeacherActive`. Product
decision remains BLOCKED for admin lifecycle.

`"User updates self"` still matches an inactive user’s own row. Helpers
after `00010` require `is_active`, so inactive admins lose admin policies.
Self `is_active` stays trigger-denied.

Do **not** assume founder works because INSERT GRANT was removed. FND-01
is mandatory.

---

## 5. H6 / `00045` — payroll and biometrics

**Classification:** **PASS WITH CONDITIONS** as **design** for those two
tables. SHERIVS-003 remains **OPEN**. Runtime: **NOT VERIFIED**.

Live:

- `staff_payroll_school_isolation` FOR ALL, same school, GRANT including DELETE.
- `teacher_biometrics`: `biometrics_school_isolation` and duplicate
  `school_isolation` FOR ALL; GRANT including DELETE.

Proposed `00045` drops those three policies and creates command policies
`TO authenticated`. No `CREATE POLICY ... FOR ALL` in that file.

### `staff_payroll`

| Command | Proposed | Peer teacher/student/parent? |
|---------|----------|------------------------------|
| SELECT | admin/principal/bursar/hq + super-admin, same school | **no** (role pin) |
| INSERT | admin/principal/bursar + super-admin, same school | no |
| UPDATE | same as INSERT, WITH CHECK repeats tenant/role | no |
| DELETE | no policy; `00080` REVOKEs DELETE | no |

INSERT/UPDATE do **not** pin `user_id` to a staff role. A bursar could
attach a payroll row to a student `user_id`. That is not peer-read of
salary; it is a writer-hygiene gap. Not a reason to keep FOR ALL.

### `teacher_biometrics`

| Command | Proposed |
|---------|----------|
| SELECT | owner `user_id = auth.uid()` OR super-admin; **plus** school-admin same school |
| INSERT | own `user_id`, same school, role in teacher/admin/principal |
| UPDATE | owner only, same school (no role pin on UPDATE) |
| DELETE | none; GRANT DELETE withdrawn in `00080` |

Permissive OR: a teacher sees own row, not peers. A student matches
neither own-id (unless they have a row) nor school-admin. Admin sees
same-school hashes. Admin write of another teacher’s row is not granted.

`00080` GRANT SELECT, INSERT, UPDATE matches those commands. DELETE
revoked.

### Equivalent 003 paths still open

| Object | After proposed sequence | 003 close? |
|--------|-------------------------|------------|
| `users.salary` / nin / bank / `face_biometric` | F+G column revoke | design yes; **unapplied** |
| `staff_payroll` | `00045` | design yes; **unapplied** |
| `teacher_biometrics` | `00045` | design yes; **unapplied** |
| `staff_leave` | live school isolation FOR ALL + full GRANT | **No** — adjacent residual |
| `attendance_verification_log` | live isolation + full GRANT | **No** — 003-adjacent |
| `school_api_keys`, fee ledger | not in this P0 | follow-on HIGH |

SHERIVS-003 **cannot close** while those residual paths remain and while
`00045`+F are unapplied and untested.

**Blocks staging SQL application of `00045`:** no static FOR ALL remainder
in the proposed replacement.
**Blocks production 003 close:** yes.

---

## 6. SHERIVS-002 — named `tenant_all_*`

**Classification:** **NOT VERIFIED** / remains **OPEN**.

Live `20260620122048` created `tenant_all_*` FOR ALL on the tenant table
array. Later migrations dropped some (`grades`, `messages`, …). Remaining
named Scholar tables still have `tenant_all_*` until E waves.

Proposed replacements (command-split, `TO authenticated`):

| Table | File | SELECT | INSERT | UPDATE | DELETE | Product default |
|-------|------|--------|--------|--------|--------|-----------------|
| `classes`, `school_calendar`, `timetables`, `timetable_slots` | `00050` | same school | school admin | school admin | school admin | documented B-wave |
| `students` | `00060` | staff / self / mapped parent | school admin | school admin | school admin | B2 teachers |
| `parent_student_map` | `00060` | own parent + school staff | **none** | **none** | **none** | B1 BLOCKED |
| `lesson_plans` | `00060` | owner / admin / approved class | teacher draft/submitted | split H2 | owner or admin | B3 + H2 |
| `attendance` | `00060` | teaching staff / self / parent | teaching staff `marked_by` | teaching staff | **none** | B4 |
| `attendance_logs` | `00060` | own or admin | self | admin | admin | |
| `fees` | `00070` | finance / self / parent | finance unpaid/partial | finance (settlement frozen by D) | **none** | B4; B8 BLOCKED |
| `fraud_attempts` | `00070` | admin | **none** | **none** | **none** | B7 |
| `subscriptions` | `00070` | super-admin | super-admin | super-admin | super-admin | |

Hostel, clinic, library, discipline, transport, meals, sports, expenses:
**not** in proposed SQL. Product permissions were **not** invented. Those
live isolation FOR ALL policies remain until a later decision.

SHERIVS-002 stays OPEN until named `tenant_all_*` are gone **in a catalog**
and the unresolved domain tables are either split under an approved
product rule or explicitly deferred without claiming 002 closed.

---

## 7. H5 — HR release dependency

**Classification:** SQL RPC **PASS WITH CONDITIONS**; release **BLOCKED**.
Application: **unchanged**.

`admin_hr_staff_write` (`00020`) has no `p_role`. Actor:
`auth.uid()` + `is_school_admin() OR is_super_admin()`. Target staff-role
pin on SELECT and on UPDATE WHERE. Tenant pin for non-super-admin.
EXECUTE granted to `authenticated`, `service_role`; revoked from PUBLIC/anon.

Live `frontend/src/routes/_authenticated/admin/hr.tsx` `saveStaff` still
does `supabase.from("users").update(rest).eq("id", id)` with the user JWT,
spreading `role` and `salary`. `hr.functions.ts` is **not** in the tree.

`HR-RPC-CONTRACT.md` still requires active admin, tenant pin, staff
allowlist, field allowlist, no unbounded `update().eq("id")`, audit,
fail-closed errors. That document is **not** an implementation.

A/F proposed SQL is **not eligible to ship** with this live HR path.

**Blocks staging SQL of `00020` for catalog tests:** no (isolated JWT HR-01/02).
**Blocks production A/F:** yes.

---

## 8. H3 / H4 — payment release dependency

**Classification:** **UNRESOLVED** / **BLOCKED** for `00070` apply.
Payment security is **not** corrected.

Inspected live (unchanged vs `d195ba8`):

- `initFeePayment` JWT UPDATE of `paystack_reference` / `paystack_access_code`
- `verifyFeePayment` JWT UPDATE `status: "paid"` using `amount / 100`; no
  currency field check; metadata `fee_id`
- Webhook path (inventory) still documented as updating by reference if
  `fee_id` missing

`00070` freezes settlement columns for non-`service_role` and drops
`tenant_all_fees`. `service_role` writes remain unconstrained in SQL.
`PAYMENT-INVARIANTS.md` lists amount, currency, id+reference bind, payer
authz beyond RLS, missing-identifier refusal, uniqueness, idempotency,
concurrency, narrow privileged UPDATE. **Not implemented.**

B8 manual mark-paid remains **BLOCKED**.

`00070` header marks RELEASE BLOCKER. Shipping D alone breaks live JWT
init/verify. This review agrees.

**Blocks staging apply of `00070`:** yes until Paystack companion exists
**or** staging explicitly tests D in isolation without claiming payment
security.
**Blocks production:** yes.

---

## 9. H1 — order and FORCE RLS

**Classification:** **PASS WITH CONDITIONS**.

Lexicographic filenames: `00010` → `00020` → `00030` → `00040` → `00045`
→ `00050` → `00060` → `00070` → `00080` → `00090`. `00045` uses helpers
from `00010`. No proposed file references a helper created later.

`00090` is a single `ALTER TABLE public.users FORCE ROW LEVEL SECURITY`.
After `00030` there is **no** `users` INSERT policy. FORCE binds the
owner. Founder DEFINER INSERT needs BYPASSRLS or it fails. Header says
**NOT ELIGIBLE**. This review agrees. Do not copy `00090` into
`database/supabase/migrations/`.

A plausible call chain is not runtime proof.

---

## 10. Tests and evidence

None of the staging JWT cases were executed. No isolated staging project
was used. Unit tests are not RLS proofs.

| ID | Invariant | Exists as spec? | Run? | Staging DB? |
|----|-----------|-----------------|------|-------------|
| FND-01 | founder DEFINER + memberships mirror | STAGING-TEST-HARNESS | no | no |
| SW-01 | switcher service_role | yes | no | no |
| MEM-01/02 | direct memberships DML deny | yes | no | no |
| INS-01 / DEL-01 | users INSERT/DELETE deny | yes | no | no |
| ID-01/02 / C4-01 | identity freeze | yes | no | no |
| ACT-01 | setTeacherActive other teacher | yes | no | no |
| HR-01/02 | salary column / RPC | yes | no | no |
| PAYR / BIO | 00045 isolation | yes | no | no |
| LP-01/02 | H2 | yes | no | no |
| PAY-01..05 | Paystack invariants | spec only; **app missing** | no | no |
| INACT-01 | inactive admin | yes | no | no |
| HOST-01 | hostname units | `sherivs-canonical-hosts.test.ts` | not re-run in this review | n/a |
| catalog-verify | users INSERT/DELETE empty; no payroll FOR ALL | SQL file present | **not executed** | no |

Plan ratchets still refuse: proposed SQL on `database/supabase/migrations/`,
`pg_catalog.auth.*` calls, C2 trigger-depth **calls**, C3 `REVOKE ALL`
before allowlist, production ref `nwrflbpbhyiqdptmlccm`. They were **not**
weakened in this review (this mission did not edit them).

---

## 11. Finding roll-up

| ID | Class | Severity | Blocks staging apply (later GATE 4)? | Blocks production |
|----|-------|----------|--------------------------------------|-------------------|
| C1 | PASS WITH CONDITIONS | MED | no | yes until parse proof |
| C2 | PASS WITH CONDITIONS | HIGH residual (DEFINER+FORCE) | no redesign; FND-01 required before treating 00030 as compatible | yes |
| C3 | PASS WITH CONDITIONS | HIGH residual (catalog) | no static additive GRANT defect | yes until catalog empty-set |
| C4 | PASS WITH CONDITIONS | MED residual peer-staff `is_active` | no | yes until C4-01/ACT-01 |
| H1 | PASS WITH CONDITIONS | MED (`00090`) | skip `00090` | `00090` ineligible |
| H2 | PASS WITH CONDITIONS | MED | no | yes until LP-01/02 |
| H3/H4 | BLOCKED for `00070` | HIGH | do not apply `00070` without Paystack app | yes |
| H5 | BLOCKED for A/F release | HIGH | `00020` catalog-testable; A/F not releasable with live `saveStaff` | yes |
| H6 | PASS WITH CONDITIONS (design) | HIGH until applied | `00045` eligible for staging tests | 003 stays OPEN |
| H7 | NOT VERIFIED | HIGH | FND-01/SW-01 | yes |

No new static defect equivalent to review-002’s leftover `users` INSERT
or trigger-depth authorization was found in the proposed SQL text.

---

## 12. Final decision

**A. PASS FOR STAGING PREPARATION ONLY**

| Item | Status |
|------|--------|
| Gate 3 | **not fully passed**. Static corrections-002 defects from review-002 are addressed in SQL text. Independent runtime proof is absent. |
| GATE 4/5 | **BLOCKED** — no isolated staging project; no SQL executed |
| Isolated staging used | **no** |
| SQL executed | **none** |
| Production changed | **no** |
| SHERIVS-001 | **OPEN** |
| SHERIVS-002 | **OPEN** |
| SHERIVS-003 | **OPEN** |
| GATE 6 | **BLOCKED** |
| Hostname / DNS / Vercel | not modified |

**Exact next permitted action:** a human provisions a throwaway Supabase
project that is **not** `nwrflbpbhyiqdptmlccm` and holds **no** customer
rows. A later GATE 4 mission may apply **eligible** `.sql.proposed` files
there (`00070` only with Paystack companion; **never** `00090` until
founder/DEFINER proofs). This review does **not** authorize that apply.

Do **not**: copy `.sql.proposed` into `database/supabase/migrations/`;
connect to production; close 001/002/003; implement HR/Paystack in a
review mission; treat unit tests as database security evidence.

---

## 13. Explicit non-execution

No SQL was executed. No database was opened. No customer data was read.
No grants, policies, triggers, or application code were modified by this
review. Proposed files were not applied. Previous review reports were not
overwritten.

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
