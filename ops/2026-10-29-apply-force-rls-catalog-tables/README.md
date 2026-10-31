# Apply FORCE RLS on the six catalogs

Version target: **V1**. Owner-approved migration: `20261029001000_sherivs_force_rls_catalog_tables` (merged in PR #161). Companion, required unless preflight says otherwise: `20261029001100_sherivs_catalog_definer_rls_policies`.

Nothing in this folder has been run against production.

## How production SQL is applied

There is **no GitHub Actions workflow that applies SQL migrations to production**. Do not dispatch one.

| Path | What it actually does | Use for this change |
| --- | --- | --- |
| Supabase SQL editor | The documented production path. `docs/ops/sql/step0-sql-editor.sql`, `docs/ops/RELEASE-2026-10-21.md`, `docs/ops/ROLLOUT-SHERIVS-001-005.md`, and open PR #71 (`docs/ops/sql/apply-release-60-migrations.sql`) all paste one transaction into the dashboard. The ledger is `supabase_migrations.schema_migrations` (`version`, plus `name` when that column exists). | **Yes. This runbook.** |
| Laptop `supabase db push --db-url "$PROD_DB_URL"` | Applies **every** pending file under `database/supabase/migrations/`, not this pair. Documented in the same rollout notes. | No, unless a dry-run lists only `20261029001000` and `20261029001100`. |
| `.github/workflows/infrastructure-plan-apply.yml` | Terraform plan/apply. `workflow_dispatch` inputs: `provider` (`environments/production`, `oci`, `hetzner`, `vultr`, `cloudflare`, `supabase`), `action` (`plan` or `apply`), `confirm_apply` (must be `APPLY`). Environments named in the file: `infrastructure-plan`, `infrastructure-apply`. Secrets by name: `TF_STATE_ACCESS_KEY_ID`, `TF_STATE_SECRET_ACCESS_KEY`, `OCI_PRIVATE_KEY_PEM`, `TF_VAR_oci_tenancy_ocid`, `TF_VAR_oci_user_ocid`, `TF_VAR_oci_fingerprint`, `TF_VAR_hetzner_token`, `TF_VAR_vultr_api_key`, `TF_VAR_cloudflare_api_token`, `TF_VAR_supabase_access_token`, `SUPABASE_DB_URL`. | **No.** Those two environments are not created (API 404). The workflow has no recorded runs. It does not run this SQL. |
| `.github/workflows/release.yml` | App image build and SSH deploy. Environment: `production`. Fails closed when `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, or `DEPLOY_SSH_KEY` is empty. Also references `DOCKER_REGISTRY`, `DOCKER_USERNAME`, `DOCKER_PASSWORD`, `DOCKER_NAMESPACE`. | **No.** No release runs are recorded. It does not apply SQL. |
| `.github/workflows/nightly-db-backup.yml` | Read-only `pg_dump`. Fails closed without `PROD_DB_URL_BACKUP` and `BACKUP_PASSPHRASE`. Recent scheduled runs succeeded, so those two secrets are set. | **No.** Do not point an apply at the backup URL. |
| `scripts/db-apply.mjs` | Applies every local migration file through `DATABASE_URL`. Security review refuses it for production. | **No.** |

Repository secret **names** could not be listed (GitHub API 403 for this token). That does not matter for the SQL-editor path: it uses the dashboard session, not an Actions secret.

## Why the companion migration exists

`FORCE ROW LEVEL SECURITY` makes the table owner obey RLS unless that role is a superuser or has `BYPASSRLS`. `service_role` is created `BYPASSRLS` (sim bootstrap and the Supabase platform). The six catalogs' policies are `TO anon` / `TO authenticated` only. A `SECURITY DEFINER` function runs as its **owner**, not as the caller.

On a role that owns those functions and has neither superuser nor `BYPASSRLS`, Postgres 16 showed:

| Call, as that owner | After FORCE, before the companion | After the companion |
| --- | --- | --- |
| `website_public` | published version comes back null | returns the published document |
| `website_save_draft` / `website_publish` / `website_rollback` | `42501` new-row RLS violation | save, publish, and rollback succeed for a manager |
| `_website_validate` (invoker, called by those RPCs) | catalog lookup sees 0 keys | unknown block types raise `22023` again |
| `exam_window_upsert` | `unknown exam body` | resolves `WAEC_WASSCE` |
| `integration_connect` | `unknown connector` | resolves `rest-webhook` |
| `integration_set_outbound` | `no outbound support` | sees the outbound direction |
| `service_role` `SELECT` | still sees the rows (BYPASSRLS) | unchanged |
| `anon` `SELECT` on `websites` | permission denied | still permission denied |
| owner `DELETE` / `UPDATE` of versions | 0 rows changed | still 0 rows (no delete/update policy) |

The companion adds at most nine policies, and only for function owners that fail both `rolsuper` and `rolbypassrls`. Writes still require `public.scholar_can(school_id, 'website.manage')`. If every affected owner already bypasses RLS, it creates no policy. Re-running it is safe. It does not `GRANT`, does not change role attributes, and does not edit the anon/authenticated policies.

Local proof (disposable Postgres 16, not production): `tests/sql/catalog-definer-force-rls.sql` → `HARNESS PASS`. The same database then ran this folder's `preflight.sql` (`combined_apply_safe` = YES, `force_alone_safe` = NO), `apply.sql`, `verify.sql` (19/19 true), a second paste (`APPLY REFUSED: already recorded`), and `rollback.sql`.

`tools/sim-lab` Postgres is created by `initdb` as a superuser, so the stock sim cannot show this failure. The harness sets the function and table owner to `app_owner` with `NOSUPERUSER NOBYPASSRLS` and runs each affected function as that role.

## Impact

Objects that read or write the six tables, and whether FORCE changes them.

| Object | Runs as | Affected if the owner lacks superuser and BYPASSRLS? | Evidence |
| --- | --- | --- | --- |
| `website_public(text,text)` | function owner (SECURITY DEFINER). Caller: anon key in `frontend/src/lib/website/public-site.functions.ts` | Yes. Published read returns null | Harness, before vs after companion |
| `website_get`, `website_save_draft`, `website_publish`, `website_rollback` | function owner. Caller: signed-in `rpc()` in `frontend/src/lib/website/bootstrap.ts`; PostgREST exposes them to `authenticated` | Yes. Writes raise `42501`; reads see no row | Harness, including a call as `authenticated` |
| `_website_validate` | invoker. From the RPCs above that is the function owner | Yes. Active block keys disappear, so the unknown-block check stops firing | Harness `22023` returns only after the companion |
| `_website_data` | function owner | Yes. Block-key aggregate becomes `[]` | Harness |
| `exam_window_upsert`, `exam_candidate_register` | function owner. `GRANT` to `authenticated` | Yes. `exam_bodies` lookup misses every code | Harness |
| `integration_connect`, `integration_set_outbound` | function owner. `GRANT` to `authenticated` | Yes. Manifest lookup misses every key | Harness |
| `integration_claim_due_jobs`, `integration_ingest`, `integration_job_done`, `integration_outbox_claim`, `integration_outbox_ack`, `integration_webhook_target` | function owner, but they do not touch these six tables | No | `frontend/src/lib/integrations-hub/runtime.server.ts` and `frontend/src/routes/api/public/cron/integrations-sync.ts` call those RPCs via the service-role client |
| Cron `GET/POST /api/public/cron/integrations-sync` | service role for `.from("integrations")` | No. Does not read the six catalogs. `service_role` bypasses RLS | same cron route |
| `_website_immutable` trigger | invoker (the role that `UPDATE`/`DELETE`s `website_versions` or `website_audit`) | The RPC path does not update those tables. A non-bypass owner `UPDATE` changes 0 rows, so the row stays immutable. `service_role` still hits the trigger | Harness: owner `UPDATE` row count 0 |
| Client `SELECT` policies (`website_block_types_read`, `websites_read`, `website_versions_read`, `website_audit_read`, `exam_bodies_read`, `connector_manifests_read`) | `anon` / `authenticated` | No. Non-owners were already subject to RLS | Harness anon/authenticated checks; verify.sql |
| Direct `.from("websites" \| …)` in `frontend/` | none found | No | repo search on `origin/master` |
| Views on these tables | none | No | no `CREATE VIEW` |
| `pg_cron` jobs | none in repo | No | no `cron.schedule` |
| Edge functions | none in repo | No | no `supabase/functions` |
| `service_role` direct reads | `service_role` (`BYPASSRLS`) | No | Harness count stays 1 after FORCE |

Foreign-key checks bypass RLS. No view or policy was widened for `anon` or `authenticated`.

## Steps

1. Confirm a database backup from the last 24 hours (Dashboard → Database → Backups). Stop if there is not one.
2. Open the production SQL editor. Paste `preflight.sql`. Run it alone.
3. Read section **Z**. Continue only when every Z row is `ok = true` and `combined_apply_safe` is `YES — paste apply.sql`.
4. Read `force_alone_safe`.
   - `YES` means every affected function owner already bypasses RLS. `apply.sql` will force the tables and add no policy.
   - `NO` means `apply.sql` will also add the nine owner policies. Do not paste `20261029001000` by itself.
5. New query. Paste `apply.sql`. Run once.
6. Expected: `NOTICE: APPLY guard passed`, six `ALTER TABLE`, then either `catalog definer policy … for <owner>` or `no non-bypass owner; policy not created`, then `COMMIT`, then six rows with `relforcerowsecurity = t`.
7. New query. Paste `verify.sql`. Every row must be `ok = true` (19 rows on the fixture; production has the same checks plus live catalog counts greater than 0).
8. Smoke: open a published school site; as a website manager, save a draft. As an exams officer, the body list still loads. As a settings manager, connector connect still resolves a known key.
9. A second paste of `apply.sql` must stop with `APPLY REFUSED: already recorded (20261029001000, 20261029001100)`.

## Go / no-go

**Go** when all of these are true:

- Backup is current.
- Preflight section Z is all `ok = true`.
- You paste `apply.sql` (both migrations, one transaction), not the FORCE file alone, unless `force_alone_safe` is true.
- `verify.sql` is all `ok = true` and the smoke checks pass.

**No-go** when any of these are true:

- Any preflight Z row is false (missing table, RLS off, already forced, missing function, missing `scholar_can`, missing ledger, version already recorded).
- You were about to paste only `20261029001000` and `force_alone_safe` is false.
- `apply.sql` raises. The transaction rolls back; do not retry blindly.
- `verify.sql` has any `ok = false`, or a public site / draft save / exam-body list / connector connect fails. Run `rollback.sql`.

## Rollback

`rollback.sql` is one transaction:

- `NO FORCE` on the six tables (the existing rollback file).
- `DROP` of the nine definer policies only (the companion rollback). Client policies stay.
- Deletes ledger versions `20261029001000` and `20261029001100`.

It does not drop data. After it commits, a non-bypass table owner bypasses RLS again, which is the pre-change behavior. Paste it only to undo this apply.
