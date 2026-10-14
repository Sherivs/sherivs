# Verification and rollback

## GATE 5 catalog proofs

Run `scripts/staging/sherivs-rls-prep/catalog-verify.sql` on staging after each wave.

Pass when:

1. Helper definitions are SECURITY DEFINER, `search_path` includes `pg_catalog`, bodies require `users.is_active`, and `get_my_school_id` / `get_my_role` / `is_school_admin` do **not** SELECT `organization_memberships`.
2. Triggers `users_identity_freeze`, `memberships_identity_freeze`, `fees_settlement_freeze`, and `lesson_plans_approval_freeze` exist and are enabled.
3. Zero rows for `polname LIKE 'tenant_all_%'` on the named Scholar tables.
4. `authenticated`/`anon`/`PUBLIC` have no UPDATE on `users.role`/`school_id` and no SELECT/UPDATE on the six sensitive columns. `users.is_active` UPDATE may remain for `authenticated`; self-change is trigger-denied. Fee settlement columns have no UPDATE for `authenticated`. After G, `organization_memberships` has no INSERT/UPDATE/DELETE for `authenticated`.
5. `authenticated`/`anon` have no TRUNCATE/TRIGGER/REFERENCES on named tables.
6. EXECUTE on helpers is granted to `authenticated` and `service_role` only.
7. After H: `users.relforcerowsecurity` is true.

## Application verification (staging UI or server-fn tests)

- Profile settings save.
- HR staff list shows salary for admin; student cannot.
- Teacher attendance mark.
- Parent child fees.
- Paystack init writes reference only as service_role (assert via DB after init).
- Org switch (**NOT VERIFIED** until GATE 4).
- Founder provisioning (**NOT VERIFIED** until GATE 4).
- Teacher self-approve lesson plan denied.
- Self-reactivation denied; `setTeacherActive` on another teacher allowed.

## Rollback / failure containment

| Failure | Containment | Forbidden |
|---------|-------------|-----------|
| HR form 42501 | disable HR tab; keep freeze | GRANT UPDATE(role) TO authenticated |
| Paystack init fails | disable pay buttons; webhook still settles | GRANT UPDATE(status) TO authenticated |
| Teacher attendance denied | inspect teaching-staff policy; hotfix policy body | recreate `tenant_all_attendance` |
| Inactive admin locked out | intended | skip `is_active` in helpers |
| FORCE RLS breaks owner jobs | `NO FORCE ROW LEVEL SECURITY` | disable RLS entirely |

Inverse SQL files must drop **new** policies/functions/triggers and recreate the previous **secure** objects from the change-set files, not from `20260620122048`.

Membership **sync** trigger stays. It is consistency. It is only dangerous while identity UPDATE is accepted from a user JWT.

## Hostname routing

No rollback involves `frontend` host classification. PR #9 (`d195ba8`) stays.
