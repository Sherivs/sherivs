# Identity provisioning paths (ACTIVE-V1)

**Status:** design review. Compatibility is **NOT VERIFIED** on staging.
Do not treat this table as a production-apply authorization.

Staff set: `teacher`, `admin`, `principal`, `bursar`, `driver`, `librarian`,
`nurse`.

## Founder provisioning

| Field | Value |
|-------|-------|
| Path | `create_organization_with_founder` (`20261008000060`) |
| Caller | unlinked `authenticated` JWT |
| Trust boundary | SECURITY DEFINER function; EXECUTE granted to authenticated only; checks unlinked |
| Allowed fields | INSERT `users (id=caller, school_id=new org, full_name, role=admin, email, is_active=true)` |
| Target | caller only; rejects if users/memberships row exists |
| Tenant | new `schools` row created in the same function |
| DB privileges | function owner INSERT (authenticated **has no** users INSERT GRANT after A/G) |
| RLS | owner/BYPASSRLS typically; **NOT VERIFIED** under FORCE RLS (`00090` not eligible) |
| Staging | unlinked JWT founds org; memberships row mirrors users; second call `FOUNDER_ALREADY_LINKED`; school-admin JWT cannot PostgREST INSERT users. C2 uses users-row mirror, **not** `pg_trigger_depth`. **NOT VERIFIED.** |

## Staff account creation

| Field | Value |
|-------|-------|
| Path | `createStaffAccount` |
| Caller | JWT + `requireSchoolAdminScope` / platform super-admin |
| Trust boundary | `supabaseAdmin` (`service_role`) upsert |
| Allowed fields | `id, school_id, full_name, email, phone, role, is_active=true` |
| Target | new or reused auth user; `role` from `CREATABLE_ROLES` (includes parent/student) |
| Tenant | `access.scope` from the gate, not the client body |
| DB privileges | service_role table ALL; identity freeze allows `service_role` |
| RLS | bypassed |
| Staging | admin creates teacher in school A; cannot set `school_id` of school B; student JWT cannot call |

## Teacher invitation

| Field | Value |
|-------|-------|
| Path | `inviteTeacher` |
| Caller | JWT school-admin gate |
| Trust boundary | `supabaseAdmin` INSERT `users` role=teacher |
| Allowed fields | identity insert teacher |
| Target | invited email’s auth user |
| Tenant | gate school |
| Staging | same as staff create, role pinned teacher |

## Demo provisioning

| Field | Value |
|-------|-------|
| Path | `demo-provision.functions.ts` |
| Caller | environment-gated; **must stay off in production** |
| Trust boundary | `service_role` upsert |
| Staging | confirm production env refuses the function |

## Organization switching

| Field | Value |
|-------|-------|
| Path | `switchActiveOrganization` |
| Caller | JWT; must hold **active** membership of the target org |
| Trust boundary | JWT SELECT memberships (RLS); `service_role` UPDATE `users.school_id, role` |
| Allowed fields | only those two, copied from the membership row |
| Target | caller’s own users row |
| Tenant | membership `school_id` |
| DB privileges | service_role UPDATE(role, school_id); JWT cannot UPDATE those columns |
| Staging | switch succeeds; JWT PATCH school_id denied; inactive user denied |

## setTeacherActive

| Field | Value |
|-------|-------|
| Path | `setTeacherActive` |
| Caller | JWT + `requireSchoolAdminScope` |
| Trust boundary | JWT UPDATE `is_active` `.eq("id").eq("role","teacher")` |
| Allowed fields | `is_active` only |
| Target | **other** teacher (freeze denies self); staff UPDATE policy |
| Tenant | RLS school admin + same school |
| DB privileges | authenticated UPDATE table + UPDATE(`is_active`); no INSERT/DELETE |
| Staging | admin deactivates teacher T; T cannot PATCH self `is_active=true`; admin cannot INSERT users |

## School-admin user management (PostgREST)

| Field | Value |
|-------|-------|
| Path | leftover `"School admin manages users" FOR ALL` — **removed** in `00030` |
| After design | SELECT same school; UPDATE staff rows only; **no INSERT; no DELETE** |
| Role / school_id | frozen for JWT (column REVOKE + freeze). Cannot mint privileged identities by inserting a users row |
| is_active | other **staff** only; not self; not students/parents. Peer-admin deactivate via PostgREST is a residual product decision (BLOCKED) |
| Staging | POST `/users` as admin → 401/42501; DELETE `/users` → denied; INSERT student as admin denied |

## Self-profile updates

| Field | Value |
|-------|-------|
| Path | `updateMyProfile` Zod allowlist |
| Caller | JWT self |
| Allowed fields | name, phone, address, emergency_*, avatar |
| Forbidden | role, school_id, is_active, salary, nin, bank_*, face_biometric |
| Staging | phone OK; role PATCH denied; salary column missing |

## HR saveStaff (LIVE — incompatible)

JWT `users.update(rest)` including role and salary. **Release blocker.**
Must move to `hr.functions.ts` per `HR-RPC-CONTRACT.md` in the same
release as A/F. Not implemented in this mission.
