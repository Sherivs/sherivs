# Proposed SQL — not an apply path

Review artifacts for SHERIVS-RLS-IMPLEMENTATION-PREP-001 after
SHERIVS-RLS-GATE3-CORRECTIONS-001.

They MUST NOT be copied into `database/supabase/migrations/` until a later
implementation mission is explicitly authorized, independently re-reviewed,
and applied to **staging first**.

`scripts/db-apply.mjs` and `scripts/db-apply-one.mjs` only read
`database/supabase/migrations/*.sql`. The `.sql.proposed` suffix is
intentional so those runners cannot pick these files up.

Filenames are lexicographic and match the required apply order (H1).

| Order | File | Change set |
|------:|------|------------|
| 1 | `20261015000010_sherivs_authz_helpers_active.sql.proposed` | B helpers |
| 2 | `20261015000020_sherivs_admin_hr_rpcs.sql.proposed` | C HR RPCs |
| 3 | `20261015000030_sherivs_users_identity_freeze.sql.proposed` | A identity + C2/C4 |
| 4 | `20261015000040_sherivs_users_sensitive_column_revoke.sql.proposed` | F columns |
| 5 | `20261015000050_sherivs_rls_wave_a_classes_calendar_timetable.sql.proposed` | E-A |
| 6 | `20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql.proposed` | E-B + H2 |
| 7 | `20261015000070_sherivs_fees_settlement_and_rls_wave_c.sql.proposed` | D + E-C |
| 8 | `20261015000080_sherivs_rls_grant_hygiene.sql.proposed` | G + C3 |
| 9 | `20261015000090_sherivs_users_force_rls.sql.proposed` | H optional FORCE |

## Auth resolution (C1)

Functions use `SET search_path = pg_catalog, public`.

- Unqualified names resolve only in `pg_catalog` then `public` (no
  attacker-created `public.auth.uid` shadowing of an unqualified call).
- Session identity uses schema-qualified `auth.uid()` and `auth.role()`.
  Those are two-part names (`schema.function`) in the Supabase `auth`
  schema. They do **not** use search_path.
- Do **not** write `pg_catalog.auth.uid()` (three-part / cross-database).
- Do **not** add `auth` to search_path (avoids unqualified-name surprises
  if `public` ever gained similarly named objects).

## Production apply is GATE 6

This directory is not GATE 6. GATE 3 remains **PASS WITH CONDITIONS**
until an independent re-review of these corrected artifacts.
 SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
