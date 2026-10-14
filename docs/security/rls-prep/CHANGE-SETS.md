# Change sets A–H

Companion to `docs/security/SHERIVS-RLS-IMPLEMENTATION-PREP-001.md`.
Proposed SQL: `docs/security/rls-prep/proposed-sql/`.

## A — Trusted identity-column enforcement

| Field | Value |
|-------|-------|
| Files (later) | `database/supabase/migrations/20261015000010_sherivs_users_identity_freeze.sql` + rollback; `frontend/src/lib/runtime/scholar/hr.functions.ts` (role writes) |
| DB objects | `freeze_users_identity_columns()`, trigger `users_identity_freeze`; `freeze_membership_identity_columns()`, trigger `memberships_identity_freeze`; column UPDATE revoke on `users(role, school_id)`; `sync_organization_membership_on_user_write()` search_path tighten |
| Preconditions | GATE 1 baseline; C HR path ready in the same release train; switcher already service_role |
| Invariant | An authenticated JWT cannot change `users.role` / `users.school_id` or membership identity columns. `auth.role() = 'service_role'` is the only UPDATE/INSERT identity path. Never NEW.* |
| Compatibility | Profile edits OK. Org switch OK. Provisioning OK. `saveStaff` role **breaks** unless C is live |
| Tests | R001, R002, R016, R017, R022 |
| Rollback | Drop the two freeze triggers. Do not re-GRANT identity columns to `authenticated` |

## B — Inactive-user helpers

| Field | Value |
|-------|-------|
| Files (later) | `20261015000020_sherivs_authz_helpers_active.sql` + rollback; unit ratchet extending `tests/unit/rls-helper-definer-posture.test.ts` |
| DB objects | `get_my_school_id`, `get_my_role`, `is_school_admin`, `is_super_admin`, `get_my_memberships` |
| Preconditions | Memberships table exists (`20261008000050`) |
| Invariant | Helpers read the **committed active `users` row**. Inactive callers get NULL / false. Memberships are the SET via `get_my_memberships` only |
| Compatibility | Deactivated admins lose portal writes — intended. Active membership switch still writes `users` then helpers follow |
| Tests | R019; helper source contains `is_active IS TRUE` and does not SELECT memberships for `get_my_school_id` |
| Rollback | Restore `20261008000050` helper bodies only if staging proves a switcher break; prefer fixing the switcher |

## C — Replacement HR paths

| Field | Value |
|-------|-------|
| Files | `hr.functions.ts` (new); `admin/hr.tsx`; optional SQL `admin_hr_staff_list` / `admin_hr_staff_write` |
| Preconditions | B for inactive-admin deny; A for role freeze |
| Invariant | Salary/role HR reads/writes require `is_school_admin()` or `is_super_admin()` from committed rows. No client `school_id`. Role UPDATE uses service_role. Never writes `school_id` (B5) |
| Compatibility | Required for current HR form |
| Tests | R014, R015; HR cannot read other-school salary |
| Rollback | Disable HR tab |

## D — Fee-payment reference path

| Field | Value |
|-------|-------|
| Files | `paystack.functions.ts`; `20261015000050_sherivs_fees_settlement_freeze.sql` |
| Preconditions | Visibility SELECT still works under E fees policies |
| Invariant | JWT cannot write `status`, `paid_amount`, `paid_at`, `paystack_reference`, `paystack_access_code` |
| Compatibility | Init/verify must use service_role after JWT SELECT. Webhook already compatible. Manual paid is B8 |
| Tests | R004; bursar INSERT unpaid allowed (R012); cross-school denied (R013) |
| Rollback | Pause Paystack buttons; do not re-GRANT settlement columns |

## E — Command-specific policies

| Field | Value |
|-------|-------|
| Files | three forward migrations, not one; `student/dashboard.tsx` add `status = 'approved'` for lesson plans |
| Preconditions | B so inactive users fail closed |
| Invariant | No `tenant_all_*` remains on the named tables. No overlapping FOR ALL. Permissive OR-set is only the command policies in the proposed file |
| Compatibility | See per-table matrix |
| Tests | R005–R013, overlap test (student cannot ride a second permissive policy) |
| Rollback | Do not restore `tenant_all_*`. Re-apply last good command policies |

## F — Sensitive columns

| Field | Value |
|-------|-------|
| Files | `20261015000030_sherivs_users_sensitive_column_revoke.sql`; `app-context.tsx` explicit select |
| Preconditions | C live so HR can still display salary |
| Invariant | `authenticated` cannot SELECT/UPDATE salary, nin, bank_*, face_biometric, including own row via PostgREST |
| Compatibility | `getMyProfile` already omits them (B6) |
| Tests | R003 |
| Rollback | Keep revoke; fix HR RPC rather than re-GRANT |

## G — Grants

| Field | Value |
|-------|-------|
| Files | `20261015000090_sherivs_rls_grant_hygiene.sql` |
| Preconditions | E policies exist so tightening table grants cannot surprise writes that still expected FOR ALL |
| Invariant | No anon/authenticated TRUNCATE/TRIGGER/REFERENCES on named tables. `parent_student_map` authenticated SELECT only. `fraud_attempts` authenticated SELECT only |
| Tests | catalog-verify.sql privilege queries |
| Rollback | Re-assert the G GRANT list, never TRUNCATE |

## H — Independent verification

| Field | Value |
|-------|-------|
| Files | `scripts/staging/sherivs-rls-prep/catalog-verify.sql`; optional `FORCE RLS` last |
| Preconditions | A–G applied on staging; production-ref assert passed |
| Invariant | Catalog matches the matrix. Helper ACL: EXECUTE for authenticated+service_role, not PUBLIC/anon. `users.relforcerowsecurity` true only after the optional last migration |
| Tests | GATE 5 queries + JWT matrix |
| Rollback | `ALTER TABLE public.users NO FORCE ROW LEVEL SECURITY` if FORCE blocks owner maintenance |
