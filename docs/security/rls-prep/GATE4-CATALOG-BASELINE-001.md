# SHERIVS-RLS-GATE4-CATALOG-BASELINE-001

**Mission ID:** SHERIVS-RLS-GATE4-CATALOG-BASELINE-001
**Mission class:** READ-ONLY SECURITY VERIFICATION
**Version target:** ACTIVE-V1 ONLY
**Timestamp (UTC):** 2026-10-14T18:34:55Z
**Role:** Principal Database Security Architect / PostgreSQL–Supabase RLS Auditor / Independent Verification Engineer

**Final status:** **A. CATALOG BASELINE COMPLETE — READY FOR INDEPENDENT REVIEW**

This report is a catalog baseline of the **actual** staging database. It is
not a close of SHERIVS-001, SHERIVS-002, or SHERIVS-003. It does not
authorize proposed-SQL apply, live-migration apply, or production contact.

---

## 0. Decision summary

Staging project `dvxszhracsjwdancijdc` was positively identified and opened
in a TLS-verified, transaction-read-only session. Catalog metadata was
inspected. **No Scholar / application schema is present.**

The staging database is a default Supabase project (auth, storage,
realtime, vault, extensions). There is no `supabase_migrations` schema, no
`public.users`, no tenant tables, no Scholar policies, no Scholar
SECURITY DEFINER helpers, and no storage buckets.

Git still contains 71 canonical migrations on `origin/master` @ `d195ba8`.
Those files existing in Git is **not** evidence they were applied here.

SHERIVS-001 / 002 / 003 remain **OPEN**. They cannot be evaluated against
Scholar objects that do not exist in this catalog. Founder provisioning
and payment invariants likewise have **no live objects** to assess.

Exact next gate: restore the **live** `database/supabase/migrations/*.sql`
schema onto this isolated staging project (not proposed SQL), then capture
a **post-restore** catalog before any `.sql.proposed` apply.

---

## 1. Repository revision and working-tree state

| Item | Value |
|------|-------|
| Default checkout when the agent started | `coregrid-scholar-migration` @ `857d4fee1ccc9d11b3c4a34f1142ff6a0da1f7fe` |
| Working tree **before** | clean (`git status --porcelain` empty) |
| Authoritative Gate 4 source | `origin/cursor/sherivs-rls-gate4-staging-provision-49a0` @ `41f2c0369ae550664d7f726b97e03ab8fd9dc51f` |
| Authoritative production git | `origin/master` @ `d195ba861f80379b79533126653b9cee82a8e872` |
| This report branch | `cursor/sherivs-rls-gate4-catalog-baseline-caab` |
| Parent of this report | Gate 4 provision `41f2c03` |
| Working tree **after** | this file only |

The current default branch (`coregrid-scholar-migration`) **does not**
contain `scripts/staging/sherivs-rls-prep/` or `docs/security/rls-prep/`.
Those artifacts live on the Gate 4 document chain (PR #15 and ancestors).
They were **not** assumed to be in the default checkout.

Harness and `catalog-verify.sql` were executed from an **extracted copy**
of Gate 4 blobs (same method as the credential-verify mission):

| File | Git blob (Gate 4 HEAD) | Extracted `git hash-object` |
|------|------------------------|-----------------------------|
| `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` | `af6cadbfe4bb8f49ac60d77375f4281a27383057` | identical |
| `scripts/staging/sherivs-rls-prep/catalog-verify.sql` | `6244d278f5e66f4025a3cd4075d6156eb1305cb0` | identical |

No application files, migrations, proposed SQL, governance decisions, or
canonical architecture files were modified.

Read (not modified): `GATE4-STAGING-PROVISION-001.md`,
`GATE3-INDEPENDENT-REVIEW-003.md`, `STAGING-TEST-HARNESS.md`,
`catalog-verify.sql`, `assert-not-production.mjs`,
`scripts/lib/pg-ssl.mjs`, live migration names on `origin/master`.

---

## 2. Staging project identity and production non-contact

| Check | Result |
|-------|--------|
| Canonical production ref | `nwrflbpbhyiqdptmlccm` — **never used as a database target** |
| Staging project ref | `dvxszhracsjwdancijdc` |
| `STAGING_SUPABASE_URL` hostname | `dvxszhracsjwdancijdc.supabase.co` |
| `SHERIVS_RLS_STAGING_URL` hostname | `dvxszhracsjwdancijdc.supabase.co` |
| `STAGING_DATABASE_URL` hostname | `db.dvxszhracsjwdancijdc.supabase.co` port `5432` database `postgres` |
| Production `SUPABASE_URL` hostname | `nwrflbpbhyiqdptmlccm.supabase.co` |
| Production `DATABASE_URL` hostname | `aws-1-eu-west-1.pooler.supabase.com` (string contains production ref) |
| Staging vs production URL hashes | **not equal** (anon, service_role, publishable, database, API URL) |
| Staging Auth health | `GET /auth/v1/health` with **staging-prefixed** anon key → **HTTP 200**, GoTrue `v2.197.0` |
| Response header `sb-project-ref` | `dvxszhracsjwdancijdc` |
| Production database opened | **NO** |
| Production credentials used as fallback | **NO** (`DATABASE_URL` / `SUPABASE_URL` / production service-role deleted from the inspector process before connect) |

Credential values are not printed. Length/hash/hostname evidence only.

---

## 3. Safety harness

`node scripts/staging/sherivs-rls-prep/assert-not-production.mjs`
(extracted Gate 4 copy). **No database was opened by the harness.**

| Input | Result | Exit |
|-------|--------|------|
| Process staging vars (`SHERIVS_RLS_STAGING_URL` first) | `STAGING_TARGET_OK` | **0** |
| `STAGING_DATABASE_URL` only (other staging URL names unset) | `STAGING_TARGET_OK` | **0** |
| Production `DATABASE_URL` / `SUPABASE_URL` substituted into the three harness names | `REFUSED` `canonical_production_supabase_ref` | **2** |
| `https://nwrflbpbhyiqdptmlccm.supabase.co` | `REFUSED` `canonical_production_supabase_ref` | **2** |

Independent parser (not the harness): staging hostname equals
`db.dvxszhracsjwdancijdc.supabase.co`; production ref absent; staging ref
present; database name `postgres`.

---

## 4. Connection safety and read-only proof (before catalog queries)

### 4.1 Direct host

`STAGING_DATABASE_URL` targets `db.dvxszhracsjwdancijdc.supabase.co:5432`.
That name has only an AAAA record
(`2a05:d018:837:ae02:ec24:31b0:e008:dc7c`). This Cloud Agent VM has **no
IPv6 addresses**. Direct connect returned `ENETUNREACH`.

Repository procedure (`scripts/lib/pg-ssl.mjs`): Supabase direct hosts are
IPv6-only; IPv4-only clients use the **session pooler**.

### 4.2 IPv4 session pooler (same staging project)

A pooler URL was constructed **only** from staging material:

- Host: `aws-0-eu-west-1.pooler.supabase.com:5432`
- Username: `postgres.dvxszhracsjwdancijdc` (staging ref; production ref refused)
- Password: taken from `STAGING_DATABASE_URL` only
- Database: `postgres`
- Harness on the constructed URL: `STAGING_TARGET_OK`
- TLS: `rejectUnauthorized: true` plus `COREGRID_DB_CA_CERT` (Supabase Root
  2021 CA). `COREGRID_DB_INSECURE_TLS` was unset and deleted. `sslmode` was
  **not** placed in the URL (node-pg would otherwise ignore the pinned CA).

**Evidence the pooler reached the same Postgres as the staging direct
host:** after connect, `inet_server_addr` =
`2a05:d018:837:ae02:ec24:31b0:e008:dc7c/128`, which is the AAAA of
`db.dvxszhracsjwdancijdc.supabase.co`.

### 4.3 Read-only session (recorded before catalog)

| Setting | Value at identity snapshot |
|---------|----------------------------|
| `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` | executed |
| `default_transaction_read_only` | `on` |
| `transaction_read_only` (inside `BEGIN READ ONLY`) | `on` |
| `ssl` GUC | `on` |
| `pg_stat_ssl` for backend pid | `ssl=false` (expected behind Supavisor; client→pooler still used TLS with pinned CA) |
| Still read-only after identity `ROLLBACK` | `default_transaction_read_only=on` |
| Still read-only at end | `transaction_read_only=on` |

Catalog queries then ran as separate autocommit statements under
`default_transaction_read_only=on`, so a missing-relation error could not
abort the rest of the inventory. A write would have failed.

---

## 5. Database identity evidence (redacted)

| Field | Value |
|-------|-------|
| `current_database` | `postgres` |
| `current_user` / `session_user` | `postgres` |
| `server_version` | `17.11` |
| Server inet | `2a05:d018:837:ae02:ec24:31b0:e008:dc7c` port `5432` |
| Verified staging ref | `dvxszhracsjwdancijdc` |
| Connected as BYPASSRLS role | **yes** — `postgres.rolbypassrls = true` (Supabase default). Catalog inspection used this privileged **read-only** session. This is **not** a JWT/`authenticated` proof. |

Secrets, passwords, and keys are omitted.

---

## 6. Migration state

### 6.1 History tables in this database

| Relation | Present? |
|----------|----------|
| `supabase_migrations.schema_migrations` | **NO** (relation does not exist) |
| `supabase_migrations.schema_migrations_history` | **NO** |
| `public.schema_migrations` | **NO** |
| `auth.schema_migrations` | **YES** (GoTrue internal; 82 version stamps, first `00`, last `20260831180000`) |
| `realtime.schema_migrations` | table exists (not dumped) |
| `storage.migrations` | table exists (not dumped) |

`auth.schema_migrations` versions are GoTrue service stamps. They are
**not** Scholar application migrations.

### 6.2 Git vs this database

| Source | Migration `.sql` files |
|--------|------------------------|
| `origin/master` @ `d195ba8` | **71** files under `database/supabase/migrations/` |
| Gate 4 branch | **71** (same names as master) |
| Default checkout `coregrid-scholar-migration` @ `857d4fe` | **69** (missing `20261008000050_coregrid_organization_memberships.sql` and `20261008000060_organization_onboarding.sql`) |
| Applied Scholar versions in staging | **none detectable** — no `supabase_migrations` schema |

**Evidence vs inference:** evidence is “no CLI migration history table and
no `public` relations.” Inference that “migrations were never applied” is
the straightforward reading of that evidence. Absence of a history table
is not by itself a row-count of customer data.

Do **not** infer a Git file was applied.

---

## 7. Schema inventory

### 7.1 Schemas

| Schema | Owner | Notes |
|--------|-------|-------|
| `public` | `pg_database_owner` | USAGE for anon/authenticated/service_role; CREATE only for `postgres` |
| `auth` | `supabase_admin` | GoTrue |
| `storage` | `supabase_admin` | Storage |
| `realtime` | `supabase_admin` | |
| `extensions` | `postgres` | |
| `graphql` / `graphql_public` | `supabase_admin` | |
| `vault` | `supabase_admin` | |
| `pgbouncer` | `pgbouncer` | |
| `pg_catalog` / `information_schema` | `supabase_admin` | |

`public` ACL: `{pg_database_owner=UC, =U, postgres=U, anon=U, authenticated=U, service_role=U}` (USAGE for PUBLIC and API roles; no CREATE for API roles).

### 7.2 `public` relations

**Zero** tables, views, sequences, or indexes in `public`
(`pg_class` counts for relkinds `r/p/v/m/S/f/i` = empty).

The only `public` object of security interest is function
`public.rls_auto_enable()` (see §10).

### 7.3 Expected Scholar tables (`to_regclass` existence only — no row reads)

All **39** probed names are **absent**, including: `users`,
`organization_memberships`, `students`, `staff_payroll`,
`teacher_biometrics`, `staff_leave`, `grades`, `attendance`,
`attendance_logs`, `fees`, `subscriptions`, `parent_student_map`,
`classes`, `lesson_plans`, `timetables`, `timetable_slots`,
`school_calendar`, `messages`, `notifications`, `audit_logs`,
`webhook_logs`, `schools`, `super_admins`, `fraud_attempts`,
`attendance_verification_log`, hostel/clinic/library/discipline/sports/
meals/transport/expenses tables, `school_geofence`, `school_api_keys`.

### 7.4 Non-public tables/views (existence, owners, RLS flags)

Default Supabase objects only. Representative facts:

- `auth.*` tables owned by `supabase_auth_admin`. Many have RLS enabled;
  **none** have FORCE RLS. Includes `auth.users` (GoTrue). **No SELECT
  was issued against `auth.users` or any auth data table.**
- `storage.buckets`, `storage.objects`, and related tables owned by
  `supabase_storage_admin`, RLS enabled, FORCE off.
- `realtime.messages` partitioned, RLS enabled, FORCE off.
- `vault.secrets` table and `vault.decrypted_secrets` view exist; RLS
  **not** enabled on `vault.secrets`. **Contents were not queried.**
- `extensions.pg_stat_statements` views.

No Scholar partitioning.

---

## 8. Policies

| Scope | Count |
|-------|-------|
| Policies in `public`, `storage`, `auth`, `realtime` | **0** |
| `FOR ALL` (`polcmd = '*'`) in `public`/`storage` | **0** |
| `tenant_all_%` | **0** |
| Policies on `staff_payroll` / `teacher_biometrics` / `staff_leave` / `attendance_verification_log` | **n/a** (tables absent) |
| Storage policies (`pg_policies` where `schemaname = 'storage'`) | **0** |

**Evidence:** empty `pg_policy` join for those schemas. **Inference:** a
fresh project has not yet created PostgREST policies on `storage.objects`;
table GRANTs still exist (see §9). Do not assume production policy names.

Broad `FOR ALL` Scholar policies cannot be listed because Scholar tables
do not exist.

---

## 9. Privileges

### 9.1 `public` table privileges

No public tables ⇒ `information_schema.role_table_grants` for
anon/authenticated/PUBLIC INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES
on `public` is **empty**. `users` table grants: empty (relation absent).

### 9.2 Default privileges (apply to **future** objects)

This is the material least-privilege finding for the **next** apply:

`postgres` default ACL on `public` **tables**:
`anon=arwdDxtm`, `authenticated=arwdDxtm`, `service_role=arwdDxtm`
(ALL, including TRUNCATE/TRIGGER/REFERENCES/MAINTAIN).

Same pattern on `public` sequences (`rwU`) and functions (`X`), and on
`storage` objects created by `postgres`.

When live Scholar migrations run as `postgres`, new tables inherit these
defaults **unless** the migration REVOKEs them. Foundation SQL on master
also issues explicit `GRANT SELECT, INSERT, UPDATE, DELETE` to
`authenticated`. Both must be inventoried again **after** schema restore.

### 9.3 Storage table privileges (live)

| Table | anon / authenticated | service_role |
|-------|----------------------|--------------|
| `storage.buckets` | SELECT, INSERT, UPDATE, DELETE | ALL including TRUNCATE/TRIGGER/REFERENCES |
| `storage.objects` | SELECT, INSERT, UPDATE, DELETE | ALL including TRUNCATE/TRIGGER/REFERENCES |
| `storage.buckets_analytics` | SELECT, INSERT, UPDATE, DELETE | ALL |
| `storage.buckets_vectors` | SELECT | SELECT |
| `storage.s3_multipart_uploads(_parts)` | SELECT | ALL |
| `storage.vector_indexes` | SELECT | SELECT |

**No storage policies** were present, so table GRANTs are not constrained
by RLS policies on those objects. Bucket list is empty (see §13). No
customer objects were listed or downloaded.

### 9.4 Column privileges

No matching sensitive / identity columns in `public` ⇒ column privilege
query returned **0** rows. Cannot report `users.role` column UPDATE
because `public.users` does not exist.

---

## 10. Functions

### 10.1 Scholar helpers — **absent**

`pg_proc` lookup for `get_my_school_id`, `get_my_role`, `is_school_admin`,
`is_super_admin`, `get_my_memberships`, `create_organization_with_founder`,
`sync_organization_membership_on_user_write`, freeze helpers, HR RPCs,
and name patterns `%founder%` / `%membership%` / `%paystack%` / `%settle%`
/ `%payroll%` / `%biometric%` / `%switch%` in `public`: **0 rows**.

### 10.2 Functions that do exist

| Function | SECURITY | Owner | search_path | EXECUTE |
|----------|----------|-------|-------------|---------|
| `public.rls_auto_enable()` | **DEFINER** | `postgres` | `pg_catalog` | PUBLIC, anon, authenticated, service_role, postgres |
| `storage.*` helpers (19) | INVOKER | `supabase_storage_admin` | some `pg_catalog` | default (owner) |

`rls_auto_enable` is an event-trigger function. Body (redacted; no
secrets): on `CREATE TABLE` / `CREATE TABLE AS` / `SELECT INTO` in schema
`public`, it `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. It does **not**
FORCE RLS. Event trigger `ensure_rls` (`ddl_command_end`) calls it.

**Inference:** future Scholar tables created in `public` will likely get
RLS enabled automatically. That is **not** a substitute for policies,
GRANTs, or FORCE RLS. Runtime of that trigger was not invoked.

No function definitions contained credential-like literals. Redaction
patterns did not fire on returned bodies.

---

## 11. Triggers

| Trigger | Table | Enabled | Function |
|---------|-------|---------|----------|
| `enforce_bucket_name_length_trigger` | `storage.buckets` | origin | `storage.enforce_bucket_name_length` INVOKER |
| `protect_bucket_control_insert` | `storage.buckets` | origin | `storage.protect_bucket_control_columns` INVOKER |
| `protect_bucket_control_update` | `storage.buckets` | origin | `storage.protect_bucket_control_columns` INVOKER |
| `protect_bucket_control_update_role` | `storage.buckets` | origin | `storage.enforce_bucket_lifecycle_service_role` INVOKER |
| `protect_buckets_delete` | `storage.buckets` | origin | `storage.protect_delete` INVOKER |
| `protect_objects_delete` | `storage.objects` | origin | `storage.protect_delete` INVOKER |
| `update_objects_updated_at` | `storage.objects` | origin | `storage.update_updated_at_column` INVOKER |

**No** `users` → `organization_memberships` sync trigger. Those tables
do not exist.

Event triggers (enabled origin): `ensure_rls`, GraphQL/pg_cron/pg_net
grant helpers, `pgrst_ddl_watch`, `pgrst_drop_watch`. Not invoked.

---

## 12. Tenant-sensitive table inventory

**None present** in `public`. Auth/storage/realtime/vault system tables
exist as vendor schema only. Application-table contents were **not**
queried. Row counts of `auth.users` / `storage.objects` were **not**
taken. Zero customer rows is **not** claimed.

---

## 13. Storage buckets

`SELECT id, name, public, file_size_limit, allowed_mime_types, avif_autodetection FROM storage.buckets`
returned **0 rows**. Metadata method existed and was used. **No**
`storage.objects` listing or download.

Storage policies: **0**. Grants: §9.3.

---

## 14. Security configuration

### 14.1 Extensions

| Extension | Version | Schema |
|-----------|---------|--------|
| `pg_stat_statements` | 1.11 | `extensions` |
| `pgcrypto` | 1.3 | `extensions` |
| `plpgsql` | 1.0 | `pg_catalog` |
| `supabase_vault` | 0.3.1 | `vault` |
| `uuid-ossp` | 1.1 | `extensions` |

### 14.2 Role attributes (RLS bypass)

| Role | `rolsuper` | `rolbypassrls` | `rolcanlogin` |
|------|------------|----------------|---------------|
| `anon` | false | **false** | false |
| `authenticated` | false | **false** | false |
| `authenticator` | false | false | true |
| `service_role` | false | **true** | false |
| `postgres` | false | **true** | true |
| `supabase_admin` | **true** | **true** | true |
| `supabase_etl_admin` | false | **true** | true |
| `supabase_read_only_user` | false | **true** | true |
| `dashboard_user` | false | false | false |
| `pgbouncer` | false | false | true |
| `supabase_auth_admin` | false | false | true |
| `supabase_storage_admin` | false | false | true |
| `supabase_realtime_admin` | false | false | false |
| `supabase_replication_admin` | false | false | true |

`anon` / `authenticated` do **not** bypass RLS. `service_role` and
`postgres` **do** (Supabase default). **Not altered.**

### 14.3 Publications

`pg_publication_tables`: **0** rows.

---

## 15. Special security questions

### SHERIVS-001 (identity writability)

**Catalog answer:** `public.users` does not exist. There are no policies,
no column grants on `role` / `school_id` / `is_active`, no INSERT/DELETE
grants, and no membership sync trigger/function.

This **does not** prove the production posture. It **does** prove staging
has no current identity surface to freeze.

**Status:** OPEN. Re-evaluate after live schema restore.

### SHERIVS-002 (broad FOR ALL / DML grants)

**Catalog answer:** no Scholar tenant tables; no `tenant_all_*`; no public
DML grants; no FOR ALL policies.

Default ACLs will grant ALL on future `public` tables to
anon/authenticated/service_role unless migrations revoke them.

**Status:** OPEN. Re-evaluate after live schema restore.

### SHERIVS-003 (HR / biometric / payroll columns)

**Catalog answer:** columns `salary`, `nin`, `bank_name`, `account_number`,
`account_name`, `face_biometric`, `basic_salary`, `net_salary`,
`face_template_hash` are **not present**. Tables `staff_payroll`,
`teacher_biometrics`, `staff_leave`, `attendance_verification_log` are
**absent**. No SELECT privileges to report.

**Status:** OPEN. Re-evaluate after live schema restore.

### Founder provisioning

`create_organization_with_founder` is **absent**. No
`organization_memberships` table, RLS, FORCE RLS, or sync trigger.

Catalog cannot prove founder provisioning safe or unsafe. FND-01 remains
unrun. **Do not claim founder provisioning is safe.**

### Payments

No `fees` / `subscriptions` / `fraud_attempts` tables, constraints, unique
indexes, settlement functions, or grants. Paystack functions absent.
Payment records were not inspected. Amount validation, payer ownership,
concurrency, and idempotency are **not** established.

`00070` remains **BLOCKED** per Gate 3 review-003 until a Paystack
companion exists. Not applied (nothing to apply against).

---

## 16. Coverage limitations

| Item | Status |
|------|--------|
| `supabase_migrations.*` | relation missing — not a privilege denial |
| `public.users` / `organization_memberships` policy queries | relation missing |
| Direct IPv6 `db.<ref>.supabase.co` | unreachable from this VM; pooler used |
| Management API `GET /v1/projects/dvxszhracsjwdancijdc` | HTTP 401 invalid access token — not used further |
| `pg_stat_ssl` on pooled backend | shows `ssl=false`; client TLS still verified |
| `authenticated` JWT catalog | not opened (postgres BYPASSRLS session only) |
| GraphQL/pgbouncer internals | schema listed; not fully enumerated |
| `catalog-verify.sql` as a single script | not meaningful until Scholar objects exist; equivalent probes were run |
| Customer/application row counts | **not queried**; zero-row claim **not** made |
| Production catalog | **not opened** |

Do not infer absence of an object from insufficient privileges: the
inspector role was `postgres`. Missing Scholar objects are missing
relations, not hidden by RLS.

---

## 17. Evidence vs inference

**Evidence (observed):**

- Staging ref in URL, Auth health header, pooler username, and
  `inet_server_addr` matching the staging AAAA.
- Read-only GUCs `on` before catalog queries.
- No `public` tables; no Scholar functions/policies/triggers.
- No `supabase_migrations` schema.
- Default ACLs grant ALL on future public tables to anon/authenticated.
- `service_role` and `postgres` have BYPASSRLS.
- Harness exit 0 on staging, exit 2 on production strings.

**Inference (not proven):**

- The project was created empty and never received Scholar migrations.
- `ensure_rls` will enable RLS on the first `CREATE TABLE` in `public`.
- After migration apply, default ACLs plus foundation GRANTs will make
  authenticated DML broad until proposed `00080` (or equivalent) runs.
- Staging currently holds no customer application rows (unproven; not
  counted).

---

## 18. Execution and change log

| Question | Answer |
|----------|--------|
| Customer / application rows queried? | **NO** |
| `auth.users` / `storage.objects` contents queried? | **NO** |
| SQL executed? | **YES** — read-only catalog `SELECT` / `SHOW` / `to_regclass` / `pg_catalog` / `information_schema` / `storage.buckets` metadata. Session `SET` for read-only. `BEGIN READ ONLY` / `ROLLBACK` for the identity snapshot only. |
| INSERT/UPDATE/DELETE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/COMMENT? | **NO** |
| `.sql.proposed` applied? | **NO** |
| Live migrations applied? | **NO** |
| Application / policy / function / trigger / grant / env / deploy changes? | **NO** |
| Production contacted as a database? | **NO** |
| Schema/database/app/prod changes? | **NO** |

---

## 19. Exact next gate and blockers

**Next permitted gate:** independent review of **this** catalog baseline,
then a separately authorized **live-schema restore** onto staging
(`database/supabase/migrations/*.sql` in filename order from
`origin/master` @ `d195ba8`, which includes memberships/onboarding).
That restore is **not** proposed-SQL apply.

After restore: a **new** catalog snapshot (this file is the empty-project
baseline). Only then may a later mission consider eligible
`.sql.proposed` files (`00070` still skipped without Paystack companion;
`00090` still ineligible).

| Blocker | Status |
|---------|--------|
| Staging identity ≠ production | **proven** |
| Read-only catalog of current staging | **complete** |
| Scholar schema present | **missing** — blocks SHERIVS-001/002/003 evaluation |
| Isolated JWT / FND-01 / PAY-* tests | **not in this mission** |
| Customer-row emptiness | **unproven** |
| Proposed SQL apply | **not authorized** |
| Production apply | **forbidden** |
| GATE 6 | **BLOCKED** |

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.

---

## 20. Confirmations

- Production was not opened and was refused by the harness.
- Connection used staging-prefixed credentials and the staging project ref.
- Catalog inspection ran only after read-only was proven.
- No application data was read.
- No remediation SQL was applied.
- This mission does not proceed to a later gate automatically.
