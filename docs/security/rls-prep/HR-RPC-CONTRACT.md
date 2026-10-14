# HR RPC and application contract (H5)

**Status:** design only. `frontend/src/lib/runtime/scholar/hr.functions.ts` is
**not implemented** in this mission. `admin/hr.tsx` `saveStaff` still does
`supabase.from("users").update(rest)` with the user JWT.

**Version target:** ACTIVE-V1.

SHERIVS-003 remains **OPEN**. This contract is the reviewed replacement, not
a remediation claim.

## Why the previous RPC was rejected

`admin_hr_staff_write` previously accepted `p_role` and then never wrote it.
The UPDATE also lacked a staff-role pin on the target row, so a school
admin JWT DEFINER path could have updated any same-school user (including
students/parents) for salary/profile.

Role writes cannot happen inside a user-JWT SECURITY DEFINER function:
`auth.role()` stays `'authenticated'`, and change set A freezes
`users.role` unless `auth.role() = 'service_role'`.

## Actors and paths

| Path | Auth | Writes |
|------|------|--------|
| SQL `admin_hr_staff_list()` | user JWT, DEFINER | none (salary-inclusive SELECT) |
| SQL `admin_hr_staff_write(...)` | user JWT, DEFINER | profile + salary only |
| Future `hr.functions.ts` `updateStaffHr` | `requireSchoolAdminScope` then **service_role** | role, salary, profile; never `school_id` |
| `setTeacherActive` | JWT-srv, existing | `is_active` of another teacher only |
| `createStaffAccount` / `inviteTeacher` | service_role | INSERT identity |
| PostgREST `users` UPDATE of role/salary | **denied** after A+F | — |

## SQL RPC contract (`admin_hr_staff_write`)

Signature (proposed `20261015000020`):

```
admin_hr_staff_write(
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_subject_specialty text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_salary numeric DEFAULT NULL
)
```

There is **no** `p_role`, `p_school_id`, `p_is_active`, or client admin flag.

| Check | Rule |
|-------|------|
| Authentication | `auth.uid()` not null |
| Actor active + role | `is_school_admin() OR is_super_admin()` (helpers require `users.is_active`) |
| Tenant | non-super-admin: `get_my_school_id()` equals target `school_id` |
| Target exists | else `P0002` |
| Target staff set | `role IN ('teacher','admin','principal','bursar','driver','librarian','nurse')` else `not_staff_target` |
| Permitted fields | full_name, email, phone, subject_specialty, employment_type, salary |
| Forbidden fields | role, school_id, is_active, nin, bank_*, face_biometric |
| EXECUTE | `authenticated`, `service_role`. Revoked from `PUBLIC`/`anon` |

The UPDATE WHERE clause repeats the staff-role pin and tenant pin.

## Future `hr.functions.ts` contract (not implemented here)

`updateStaffHr` MUST NOT perform an unbounded privileged update by arbitrary
user ID (`supabaseAdmin.from("users").update(rest).eq("id", userId)`).

Required sequence:

1. `requireSupabaseAuth`.
2. `requireSchoolAdminScope` (committed active admin/principal; lifecycle-aware).
3. Zod-parse an allowlist: `userId`, optional profile fields, optional
   `salary`, optional `role`. Reject unknown keys including `school_id`,
   `is_active` (use `setTeacherActive`), `nin`, bank, `face_biometric`.
4. Load the target with **service_role** using **all** of:
   - `id = userId`
   - `school_id = actorSchool` (from the gate, not the client)
   - `role IN STAFF_ROLES`
   Zero rows => deny (`not_found` / `not_authorized`). Do not proceed.
5. Role change extra gates (only if `role` is present):
   - New role must be in `STAFF_ROLES`.
   - Actor cannot change **their own** role.
   - Cannot assign a role outside the staff set (no `super_admin`, no
     `student`/`parent` conversion on this path).
   - Write via service_role `update({ role }).eq("id", target.id).eq("school_id", actorSchool)`.
6. Salary/profile writes: either call `admin_hr_staff_write` with the user
   JWT **or** service_role update of the allowlisted columns with the same
   `id` + `school_id` + staff-role pin.
7. Never write `school_id` (B5).
8. Audit `hr.staff_update` fail-closed with actor, tenant, target id,
   changed fields (not raw salary unless already in audit policy), outcome.
9. `admin/hr.tsx` `saveStaff` must call this server function. JWT
   `users.update(rest)` is incompatible with A+F.

## `setTeacherActive` (existing, keep)

JWT-srv updates `is_active` of **another** user with `role = 'teacher'`
after `requireSchoolAdminScope`. Compatible with C4: the identity freeze
denies only `NEW.id = auth.uid()`. Column UPDATE(`is_active`) stays
granted to `authenticated`. Self-reactivation via `User updates self`
is trigger-denied.

Deactivating an admin is **not** in this function. Product decision:
BLOCKED until a dedicated admin-lifecycle RPC exists.

## Service-role update scope

Every privileged users UPDATE must include:

- equality on `id` (the loaded target, not a client-only id after the load)
- equality on `school_id = actorSchool`
- column allowlist in the patch object
- staff-role predicate on the pre-update row

No `.update(payload)` without those pins.

## Audit

| Event | When |
|-------|------|
| `hr.staff_list` | optional; list is already tenant-scoped |
| `hr.staff_update` | every write, including salary-only |
| `hr.staff_role_change` | when role changes |
| `teacher.set_active` | existing `setTeacherActive` |

## EXECUTE / grants

See proposed `20261015000020`. Do not GRANT EXECUTE to `anon` or PUBLIC.

## Remaining NOT VERIFIED

- Staging JWT: unauthorized teacher cannot EXECUTE list/write.
- Staging JWT: admin cannot write a student/parent row.
- Staging: role change via future server fn succeeds; JWT role PATCH fails.
- Cross-school target denied.
- Inactive admin denied (`is_school_admin()` false after B).
