# Change sets A–H (post GATE 3 corrections)

Companion to `docs/security/SHERIVS-RLS-IMPLEMENTATION-PREP-001.md`.
Proposed SQL: `docs/security/rls-prep/proposed-sql/` (lexicographic H1).

GATE 3 remains **PASS WITH CONDITIONS**. Findings remain **OPEN**.
Provisioning compatibility is a design claim, **NOT VERIFIED** on staging
(H7). Do not copy these files into `database/supabase/migrations/`.

Apply order (filenames sort this way):

1. B helpers `00010`
2. C HR RPCs `00020`
3. A identity freeze `00030`
4. F sensitive columns `00040`
5. E-A `00050`
6. E-B `00060`
7. D + E-C `00070`
8. G grants `00080`
9. H FORCE RLS `00090` optional last

## B — Inactive-user helpers (`00010`)

| Field | Value |
|-------|-------|
| Files (later) | `database/supabase/migrations/20261015000010_sherivs_authz_helpers_active.sql` + rollback |
| DB objects | `get_my_school_id`, `get_my_role`, `is_school_admin`, `is_super_admin`, `get_my_memberships` |
| Preconditions | Memberships table exists (`20261008000050`) |
| Invariant | Helpers read the **committed active `users` row**. Inactive callers get NULL / false. Memberships are the SET via `get_my_memberships` only |
| C1 | `auth.uid()` two-part; `search_path = pg_catalog, public`; `auth` not on search_path |
| Compatibility | Deactivated admins lose portal writes — intended |
| Tests | R019; N6 |
| Rollback | Restore `20261008000050` helper bodies only if staging proves a switcher break |

## C — Replacement HR paths (`00020` + future app)

| Field | Value |
|-------|-------|
| Files | SQL RPCs now; `hr.functions.ts` **not in this mission** — see `HR-RPC-CONTRACT.md` |
| Preconditions | B for inactive-admin deny |
| Invariant | List/write require active school admin or super-admin. Target must be staff-role set. SQL RPC has **no** `p_role` and never writes `school_id` / `is_active` |
| Compatibility | Current `admin/hr.tsx` JWT `saveStaff` **breaks** under A+F until the TanStack function exists |
| Tests | R014, R015; HR-01..HR-04 |
| Rollback | Disable HR tab |

## A — Trusted identity-column enforcement (`00030`)

| Field | Value |
|-------|-------|
| Files (later) | `20261015000030_sherivs_users_identity_freeze.sql` + rollback |
| DB objects | `freeze_users_identity_columns`, `users_identity_freeze`; `freeze_membership_identity_columns`, `memberships_identity_freeze`; column REVOKE UPDATE(`role`,`school_id`); sync search_path tighten |
| Preconditions | B; C SQL RPC; **app role path in the same release train** |
| Invariant | User JWT cannot change `users.role` / `users.school_id`. Self cannot change `users.is_active` (C4). Membership identity writes: `service_role` OR `pg_trigger_depth() > 1` (C2). No GUC latch. Never NEW.* |
| Compatibility | Profile edits OK. Org switch **design-compatible** (service_role). Founder INSERT **design-compatible** (nested sync). **NOT VERIFIED** until staging (H7). `saveStaff` role breaks unless C app is live |
| Tests | R001, R002, R016, R017, R022, C4 self-reactivation |
| Rollback | Drop freeze triggers. Do not re-GRANT identity columns to `authenticated` |

## F — Sensitive columns (`00040`)

| Field | Value |
|-------|-------|
| Files | later `20261015000040_sherivs_users_sensitive_column_revoke.sql`; `app-context.tsx` explicit select **not in this mission** |
| Preconditions | C SQL RPC so HR can still display salary |
| Invariant | `authenticated` cannot SELECT/UPDATE salary, nin, bank_*, face_biometric, including own row via PostgREST |
| Compatibility | `getMyProfile` already omits them (B6). `select("*")` **breaks** until app-context is updated |
| Tests | R003 |
| Rollback | Keep revoke; fix HR RPC rather than re-GRANT |

## E-A — First RLS policy wave (`00050`)

| Field | Value |
|-------|-------|
| Tables | `classes`, `school_calendar`, `timetables`, `timetable_slots` |
| Invariant | No `tenant_all_*`. Command policies TO authenticated |
| Tests | R005, overlap |

## E-B — Second RLS policy wave (`00060`)

| Field | Value |
|-------|-------|
| Tables | `students`, `parent_student_map`, `lesson_plans`, `attendance`, `attendance_logs` |
| H2 | Owner UPDATE cannot set `approved`. Trigger + admin review policy |
| B1 | Map writes denied (BLOCKED product writer) |
| Tests | R007–R011, LP-01 teacher self-approve denied |

## D + E-C — Payment compatibility and fee policy wave (`00070`)

| Field | Value |
|-------|-------|
| Files | later combined migration; `paystack.functions.ts` **not in this mission** — see `PAYMENT-INVARIANTS.md` |
| Invariant | JWT cannot write settlement columns. `tenant_all_fees` / fraud / subscriptions replaced |
| Compatibility | Init/verify **must** move to service_role with amount/reference/ownership checks in the same release. Webhook must refuse missing identifiers. Manual paid is B8 BLOCKED |
| Tests | R004, R012, R013, PAY-01..PAY-11 |
| Rollback | Pause Paystack buttons; do not re-GRANT settlement columns |

## G — Grants (`00080`)

| Field | Value |
|-------|-------|
| Invariant | No anon/authenticated TRUNCATE/TRIGGER/REFERENCES on named tables. Least-privilege table grants. **After** table GRANT, re-REVOKE A/D/F columns (C3). Memberships: authenticated SELECT only |
| Tests | catalog-verify.sql privilege queries including `users.role`, `school_id`, `is_active`, HR columns, fee settlement columns |
| Rollback | Re-assert the G GRANT list plus column REVOKEs, never TRUNCATE |

## H — Independent verification (`00090` optional)

| Field | Value |
|-------|-------|
| Files | `scripts/staging/sherivs-rls-prep/catalog-verify.sql`; optional FORCE RLS last |
| Preconditions | 00010–00080 proven on staging |
| Tests | GATE 5 + JWT matrix |
| Rollback | `NO FORCE ROW LEVEL SECURITY` if FORCE blocks owner maintenance |
