# Apply SEC-02 and DB-12 to production (2026-11-15)

Applied at the founder's instruction ("execute all"). Both migrations are the files in `database/supabase/migrations/`, unchanged except the status header.

- SEC-02 (`20261104034500`): `org_credential_inventory`, `cg_fee_invoice_balances` and `cg_fee_receipt_sequence_status` are SELECT-only for signed-in users and closed to anon; the 11 helper and trigger functions the advisor flagged (0011) have `search_path = pg_catalog`; `schools_audit_commercial_change()` is no longer executable by anon or authenticated.
- DB-12 (`20261105000200`): `feature_flags` gets a surrogate primary key (9 rows, all received ids; `feature_flags_scope` kept for `flag_set`); the duplicate index `idx_biometrics_user` was dropped.

Before: `authenticated` held INSERT, UPDATE and DELETE on `org_credential_inventory`, a view that runs as its owner, so a tenant administrator could have written credential rows through it. The live bodies of the 11 functions were read first and use only pg_catalog objects.

Still flagged by the advisor and left as designed: `org_credential_inventory` stays a SECURITY DEFINER view because it masks ciphertext and filters to tenant admins; it is read-only now. 91 tables have RLS enabled with no policy (deny by default, service role only). The 15 anon-callable definer functions are public-page helpers (result checker, school host resolution, website, stats) and need a per-function review.

Rollbacks: `database/supabase/rollbacks/20261104034500_*` and `20261105000200_*`.
