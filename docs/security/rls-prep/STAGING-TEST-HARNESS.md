# Staging test harness

**Never run against production.** `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` must exit 0 on the target URL before any JWT or SQL session is opened.

Missing prerequisite: no isolated staging project is configured in this repository. GATE 4/5 stay blocked until a human provisions a throwaway Supabase project that is **not** `nwrflbpbhyiqdptmlccm` and contains a restored schema **without** customer rows.

These are **test designs**. Do not run them against production. Do not use
customer identities.

## Synthetic identities

Create with service_role on staging, then delete after the run:

| Actor | School | Role | Notes |
|-------|--------|------|-------|
| Student A | A | student | owns student row S-A |
| Student B | B | student | cross-tenant peer |
| Teacher T | A | teacher | class C-A; owns a lesson plan |
| Parent P | A | parent | mapped only to S-A |
| Bursar B | A | bursar | |
| Admin H | A | admin | not the teacher of T's plans |
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
| N8 / C4 | Admin Z or Student A | PATCH own `users.is_active=true` | `self_activation_frozen`; row unchanged |
| N9 / C2 | Admin H | direct INSERT `organization_memberships` | denied (grant and/or trigger); depth 1 |
| N10 / LP-01 | Teacher T | UPDATE own lesson_plan `status=approved` | denied (policy + trigger) |
| N11 | Teacher T | SELECT `staff_payroll` / `teacher_biometrics` of a peer | **today allowed (003 OPEN)**; after follow-on: denied |
| N12 / HR-02 | Teacher T | `admin_hr_staff_write` / HR salary read | not_authorized |
| N13 / HR-03 | Admin H | HR write targeting a student id | `not_staff_target` |
| N14 / PAY-01 | verify path | amount kobo != outstanding | reject; status unpaid |
| N15 / PAY-03 | verify path | reference/fee_id mismatch | reject |
| N16 / PAY-04 | webhook | missing `metadata.fee_id` | no UPDATE |

## Required positive tests

| ID | Actor | Action | Expected |
|----|-------|--------|----------|
| P1 / R006 | any active user | `updateMyProfile` phone | success |
| P2 / R014 | Admin H | HR salary of same-school teacher via RPC | success |
| P3 / R007 | Teacher T | `markClassAttendance` class C-A | success |
| P4 / R010–R011 | Parent P | mapped child fees/attendance; unmapped denied | allow / 0 rows |
| P5 / R012 | Bursar B | INSERT unpaid fee school A | success |
| P6 / R017 | Admin H | `switchActiveOrganization` to an active membership | success (service_role write + nested sync) **NOT VERIFIED until run** |
| P7 | authenticated founder JWT | `create_organization_with_founder` | users INSERT + memberships row via depth>1 **NOT VERIFIED until run** |
| P8 / C4 | Admin H | `setTeacherActive` on Teacher T | success (other id) |
| P9 / LP-02 | Admin H | approve Teacher T's submitted plan | success (`teacher_id <> admin`) |
| P10 / PAY-06 | webhook | duplicate charge.success | idempotent |
| P11 / PAY-07 | concurrent verify + webhook | one paid row | no double settlement |

Also R008, R009, R013, R015, R016, R018, R020–R022 from the prior design canvas.

## Gate 3 correction cases (must be in GATE 4)

| ID | Case | Expected |
|----|------|----------|
| ID-01 | Direct identity-column UPDATE denied | N1/N2 |
| ID-02 | Self-reactivation denied | N8 |
| ID-03 | Trusted founder provisioning remains functional | P7 |
| ID-04 | Organization switching remains functional | P6 |
| ID-05 | Authorized administrator staff updates remain functional | P2 + future role path |
| ID-06 | Unauthorized HR reads/writes denied | N12/N13 |
| ID-07 | Teachers cannot self-approve lesson plans | N10 |
| ID-08 | Sensitive payroll and biometric access denied to unauthorized roles | N11 — **follow-on SQL required; 003 stays OPEN** |
| ID-09 | Fee amount mismatch rejected | N14 |
| ID-10 | Fee/reference mismatch rejected | N15 |
| ID-11 | Missing webhook identifiers rejected | N16 |
| ID-12 | Duplicate payment callbacks idempotent | P10 |
| ID-13 | Concurrent payment verification does not corrupt settlement | P11 |
| ID-14 | Existing hostname-routing tests remain unchanged | `d195ba8` files; unit tests that pin hosts |

## Execution sketch (staging runner — future implementation mission)

1. `node scripts/staging/sherivs-rls-prep/assert-not-production.mjs`
2. Apply `00010`→`00080` lexicographically against staging only (`db-apply-one.mjs` prefixes after files are authorized into `migrations/`).
3. `psql "$STAGING_DATABASE_URL" -f scripts/staging/sherivs-rls-prep/catalog-verify.sql`
4. Create synthetic identities; run PostgREST JWT cases with the staging anon key.
5. Destroy identities.

Do not commit staging keys. Do not log tokens.
