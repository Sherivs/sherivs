# Staging test harness

**Never run against production.** `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` must exit 0 on the target URL before any JWT or SQL session is opened.

Missing prerequisite: no isolated staging project is configured in this repository. GATE 4/5 stay blocked until a human provisions a throwaway Supabase project that is **not** `nwrflbpbhyiqdptmlccm` and contains a restored schema **without** customer rows.

## Synthetic identities

Create with service_role on staging, then delete after the run:

| Actor | School | Role | Notes |
|-------|--------|------|-------|
| Student A | A | student | owns student row S-A |
| Student B | B | student | cross-tenant peer |
| Teacher T | A | teacher | class C-A |
| Parent P | A | parent | mapped only to S-A |
| Bursar B | A | bursar | |
| Admin H | A | admin | |
| Admin Z | A | admin | then set `users.is_active = false` |
| Super S | n/a | `super_admins` | |

No real emails. No production password reuse.

## Required negative tests

| ID | Actor | Action | Expected |
|----|-------|--------|----------|
| N1 / R001 | Student A | `PATCH /users?id=eq.<self>` `{role:admin}` | 42501 or 0 rows; role unchanged |
| N2 / R002 | Student A | PATCH `{school_id: school B}` | denied |
| N3 | Student A | SELECT fees/students/attendance of school B | 0 rows |
| N4 / R004 | Student A | UPDATE fees.status to paid | denied (D) |
| N5 / R003 | Student A or Teacher T | SELECT salary,nin,bank_*,face_biometric of a peer | column missing or error |
| N6 / R019 | Admin Z (inactive) | `is_school_admin()` / INSERT classes | false / denied |
| N7 | Student A | INSERT/UPDATE using any remaining overlapping policy | denied; catalog shows no `tenant_all_*` |

## Required positive tests

| ID | Actor | Action | Expected |
|----|-------|--------|----------|
| P1 / R006 | any active user | `updateMyProfile` phone | success |
| P2 / R014 | Admin H | HR salary+role of same-school teacher via server fn | success + audit |
| P3 / R007 | Teacher T | `markClassAttendance` class C-A | success |
| P4 / R010–R011 | Parent P | mapped child fees/attendance; unmapped denied | allow / 0 rows |
| P5 / R012 | Bursar B | INSERT unpaid fee school A | success |
| P6 / R017 | Admin H | `switchActiveOrganization` to an active membership | success (service_role write) |
| P7 | service_role | `createStaffAccount` / founder RPC | success |

Also R008, R009, R013, R015, R016, R018, R020–R022 from the prior design canvas.

## Execution sketch (staging runner — future implementation mission)

1. `node scripts/staging/sherivs-rls-prep/assert-not-production.mjs`
2. Apply B→C→A→F→E-A→E-B→D→E-C→G against staging only (`db-apply-one.mjs` prefixes).
3. `psql "$STAGING_DATABASE_URL" -f scripts/staging/sherivs-rls-prep/catalog-verify.sql`
4. Create synthetic identities; run PostgREST JWT cases with the staging anon key.
5. Destroy identities.

Do not commit staging keys. Do not log tokens.
