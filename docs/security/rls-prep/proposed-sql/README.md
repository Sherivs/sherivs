# Proposed SQL — not an apply path

Review artifacts after SHERIVS-RLS-GATE3-CORRECTIONS-002.

They MUST NOT be copied into `database/supabase/migrations/` until a later
implementation mission is explicitly authorized, independently re-reviewed,
and applied to **staging first**.

`scripts/db-apply.mjs` and `scripts/db-apply-one.mjs` only read
`database/supabase/migrations/*.sql`. The `.sql.proposed` suffix is
intentional so those runners cannot pick these files up.

Filenames are lexicographic and match the required apply order.

| Order | File | Change set | Apply eligibility |
|------:|------|------------|-------------------|
| 1 | `20261015000010_sherivs_authz_helpers_active.sql.proposed` | B helpers | staging after re-review |
| 2 | `20261015000020_sherivs_admin_hr_rpcs.sql.proposed` | C HR RPCs | same release as A + `hr.functions.ts` |
| 3 | `20261015000030_sherivs_users_identity_freeze.sql.proposed` | A identity + C2/C4 | same release as G + HR app |
| 4 | `20261015000040_sherivs_users_sensitive_column_revoke.sql.proposed` | F columns | same release as C + app-context |
| 4b | `20261015000045_sherivs_rls_payroll_biometrics.sql.proposed` | E-HR | required before 003 can close |
| 5 | `20261015000050_sherivs_rls_wave_a_classes_calendar_timetable.sql.proposed` | E-A | staging |
| 6 | `20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql.proposed` | E-B + H2 | staging |
| 7 | `20261015000070_sherivs_fees_settlement_and_rls_wave_c.sql.proposed` | D + E-C | **blocked** until Paystack app |
| 8 | `20261015000080_sherivs_rls_grant_hygiene.sql.proposed` | G + C3 | with A–F |
| 9 | `20261015000090_sherivs_users_force_rls.sql.proposed` | H optional FORCE | **not eligible** until founder+DEFINER staging |

## Auth resolution (C1)

Functions use `SET search_path = pg_catalog, public`.

- Unqualified names resolve only in `pg_catalog` then `public`.
- Session identity uses two-part `auth.uid()` / `auth.role()`.
- Do **not** write `pg_catalog.auth.uid()`.
- Do **not** add `auth` to search_path.

## Production apply is GATE 6

GATE 3 remains **PASS WITH CONDITIONS** until another independent review.
SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
`00090` is not eligible to apply.
