# SHERIVS-STAGING-SCHEMA-RESTORE-PREP-001

**Mission ID:** SHERIVS-STAGING-SCHEMA-RESTORE-PREP-001
**Mission class:** STAGING-ONLY MIGRATION RECONCILIATION AND RESTORE PREPARATION
**Version target:** ACTIVE-V1 ONLY
**Timestamp (UTC):** 2026-10-14T19:20:00Z
**Role:** Principal Database Architect / Supabase Migration Engineer / Production Safety Engineer / Independent Verification Architect

**Final status:** **B. RESTORE PLAN PARTIAL — SPECIFIC MIGRATION QUESTIONS REMAIN**

This report is a restore **plan**. It does **not** apply migrations, open a
database, copy data, or change production or staging. It does **not** close
SHERIVS-001, SHERIVS-002, or SHERIVS-003. It does **not** authorize proposed
SQL. It does **not** authorize the next mutating restore mission.

---

## 0. Decision summary

The canonical Scholar / CoreGrid application schema **source** is established:

| Source | Commit | `database/supabase/migrations/` tree |
|--------|--------|--------------------------------------|
| `origin/master` (authoritative application) | `d195ba861f80379b79533126653b9cee82a8e872` | `bbd828951e166662bbe831fd74972e1a15488468` (**71** `.sql` files) |
| Catalog-baseline report commit | `83ae504ab51c5e0781baf33efee42fdee033bf66` | **identical** |
| This working tree HEAD (parent of this report) | `7713bf5babe082ff831cfb8e5a0fea0494c0a3b3` | **identical** |

`d195ba8` is an ancestor of `83ae504` and of HEAD. Commits after `d195ba8`
on this document chain are **docs-only**. Migration blobs were not modified
on the report branches. **Do not treat the report branch as a second
application source.**

Staging emptiness (`dvxszhracsjwdancijdc`, PostgreSQL 17.11, no Scholar
objects, no `supabase_migrations` history) is **historical evidence** from
`GATE4-CATALOG-BASELINE-001` (2026-10-14T18:34:55Z). **This mission did not
reopen staging or production.** That catalog must be rechecked in a
separately authorized read-only operation before any apply.

Canonical migrations under `database/supabase/migrations/` are **sufficient
in Git** to create the application schema in an empty Supabase project,
provided they are applied **in filename order** against staging-only
credentials, with the two transport-policy files treated as a **paired
approval** (see §8 and §15).

Proposed remediation files under `docs/security/rls-prep/proposed-sql/`
(`*.sql.proposed`) are **not** in the apply path and **must stay excluded**.

**Restore is not authorized by this document.** Human approval is required
before any mutating SQL. Remaining questions that keep status at **B**:

1. Whether to apply the `20261002000014` + `20261003000041` transport pair
   (V2-named, headers say AUTHORED NOT APPLIED, `00041` verify assumes
   `00014`).
2. Whether staging should match **Git HEAD of the 71-file tree** (recommended)
   or a **production-applied subset** (unproven; production was not catalogued
   here and must not be opened).
3. Live staging catalog may have changed since Gate 4; it was not rechecked.

SHERIVS-001 / 002 / 003 remain **OPEN**. Applying the canonical baseline
**reintroduces** the insecure defaults those findings describe. That is
expected: restore the live schema first, remediate later on staging.

---

## 1. Non-contact and non-mutation statements

- **No database was opened.** No Postgres session, pooler session, or
  Supabase Management API query ran in this mission.
- **No SQL or migration was executed.** Static inspection only (read files,
  `git ls-tree`, regex parse of SQL text). Parsed SQL was never sent to a
  server.
- **Production (`nwrflbpbhyiqdptmlccm`) was unchanged.** It was not used as
  a connection target, fallback, or credential source.
- **Staging (`dvxszhracsjwdancijdc`) was unchanged.** No apply, reset, DDL,
  DML, GRANT, REVOKE, or settings change.
- **No `.sql.proposed` file was copied or applied.**
- **No DNS, Vercel, application configuration, or CI/CD was modified.**
- **No secrets or connection strings are printed in this report.**
- **No production customer data was queried or copied.**

The only working-tree change in this mission is this file.

---

## 2. Repository and commit evidence

### 2.1 Inspection state when this report was authored

| Item | Value |
|------|-------|
| Branch at inspection (before this report branch) | `cursor/sherivs-environment-separation-audit-caab` |
| HEAD | `7713bf5babe082ff831cfb8e5a0fea0494c0a3b3` |
| Subject | `docs: environment separation audit for Sherivs prod vs staging` |
| Working tree before this file | clean (`git status --porcelain` empty) |
| This report branch | `cursor/sherivs-staging-schema-restore-prep-caab` |
| Parent of this report | `7713bf5` (environment-separation audit) |
| Canonical application | `origin/master` @ `d195ba861f80379b79533126653b9cee82a8e872` |
| Catalog-baseline artifact | `83ae504ab51c5e0781baf33efee42fdee033bf66` |
| Migration directory tree id (all three refs) | `bbd828951e166662bbe831fd74972e1a15488468` |

Branches were **not** merged, rebased, or silently switched to `master`.
This report branch was created from the current document-chain HEAD.

### 2.2 Reconciliation of the two named sources

Mission instruction: treat `origin/master` @ `d195ba8` as the canonical
production **source**, and treat `83ae504` as the latest security-preparation
**artifact**, without assuming the report branch is the application source.

Evidence:

1. `git merge-base --is-ancestor d195ba8 83ae504` — true.
2. `git merge-base --is-ancestor d195ba8 HEAD` — true.
3. `git merge-base --is-ancestor 83ae504 HEAD` — true.
4. `git rev-parse <ref>:database/supabase/migrations` is the same tree
   object on `origin/master`, `83ae504`, and HEAD.
5. `git log --oneline origin/master..HEAD` is documentation-only (Gate 3/4
   reports, this chain). **Zero** migration path changes.

**Conclusion:** the 71-file migration set at `d195ba8` **is** the set at
`83ae504` and at this HEAD. There is **no source conflict**. Status is not
**C**.

Default branch `coregrid-scholar-migration` historically held **69**
migrations (missing memberships `00050` and onboarding `00060`) per
GATE4-CATALOG-BASELINE-001. That default branch is **not** the restore
source. Restore source is `origin/master` @ `d195ba8` (71 files).

### 2.3 Canonical repository and paths

| Item | Evidence |
|------|----------|
| Canonical migration directory | `database/supabase/migrations/` |
| Alternate Supabase CLI workdir | `database/supabase/` (`config.toml`, `--workdir database/supabase`) |
| Other `**/migrations` directories | **none** found besides `database/supabase/migrations` |
| Relationship | CLI and `scripts/db-apply.mjs` both read **this one directory**. There is no second canonical path. |
| Rollback companions | `database/supabase/rollbacks/` — **31** files, not an apply path |
| Proposed SQL | `docs/security/rls-prep/proposed-sql/*.sql.proposed` — **outside** apply path |
| CLI `project_id` | `database/supabase/config.toml` = `nwrflbpbhyiqdptmlccm` (**production default**; must not be used to link/push staging) |

Filename timestamps: **71 unique** prefixes; `uniq -d` on the timestamp
token is empty. **No collisions.** Files were **not** renamed.

---

## 3. Staging condition (historical — not rechecked)

From `docs/security/rls-prep/GATE4-CATALOG-BASELINE-001.md`
(2026-10-14T18:34:55Z), **not repeated as a live fact**:

| Claim | Historical catalog |
|-------|--------------------|
| Project | `dvxszhracsjwdancijdc` |
| PostgreSQL | 17.11 |
| Public Scholar tables / views / indexes | none |
| `supabase_migrations` | schema absent |
| Scholar RLS policies | none |
| Scholar SECURITY DEFINER helpers | none |
| Storage buckets | 0 |
| Extensions already present | `pgcrypto` 1.3, `uuid-ossp` 1.1, `plpgsql`, vault, `pg_stat_statements` |
| Default ACL on future `public` tables | `anon` / `authenticated` / `service_role` **ALL** (including TRUNCATE) |
| Event trigger | `ensure_rls` → `public.rls_auto_enable()` ENABLE RLS on new public tables (does **not** FORCE RLS) |
| `postgres` / `service_role` | `BYPASSRLS` (vendor default) |

**Preflight requirement:** repeat a read-only catalog with
`assert-not-production.mjs` before apply. If Scholar objects now exist, or
if identity is not staging, **stop**.

---

## 4. Apply scripts, harnesses, seeds, and environment names

### 4.1 Scripts that can apply migrations (must not run in this mission)

| Script | Target selection | Records `supabase_migrations`? | Production default? |
|--------|------------------|--------------------------------|---------------------|
| `scripts/db-apply.mjs` | `DATABASE_URL` only; all `*.sql` in filename order; one query per file; stop on first failure | **No** | Unprefixed `DATABASE_URL` in the operator VM was previously reported as **production** (environment-separation audit). **Do not use.** |
| `scripts/db-apply-one.mjs` | `DATABASE_URL` + filename prefix | **No** | Same |
| `scripts/db-apply-mgmt.mjs` | Management API `projects/${projectRef}/database/query`; argv default **`nwrflbpbhyiqdptmlccm`** | No | **Yes — refuse** |
| `scripts/apply-approved-v1-migrations.mjs` | Two files only; argv default production ref | No | **Yes — refuse** |
| `scripts/apply-foundation-migration.mjs` | argv default production ref | No | **Yes — refuse** |
| `scripts/apply-canonical-hardening.mjs` | argv default production ref | No | **Yes — refuse** |
| `scripts/apply-canonical-mr100.mjs` | argv default production ref | No | **Yes — refuse** |
| `scripts/apply-foundation-from-env-local.mjs` | hard-coded production ref | No | **Yes — refuse** |
| `supabase db push --workdir database/supabase` | linked project from `config.toml` / CLI link | **Yes** (CLI history) | `config.toml` project_id is **production** — refuse unless explicitly linked to staging |
| `supabase db reset` / `supabase start` | local or linked | destructive | **Forbidden** |

`db-apply.mjs` does **not** import the staging harness. Each file is sent as
one `client.query(sql)` and commits independently of other files. A mid-list
failure leaves a **partial schema**. There is **no** cross-file transaction.

### 4.2 Staging-target safety harness

| File | Role |
|------|------|
| `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` | Fail-closed if URL contains `nwrflbpbhyiqdptmlccm` or production hosts. Reads **only** `SHERIVS_RLS_STAGING_URL` / `STAGING_DATABASE_URL` / `STAGING_SUPABASE_URL`. Never connects. |
| `scripts/staging/sherivs-rls-prep/catalog-verify.sql` | Read-only **post-remediation** proofs (helpers, freeze triggers, no `tenant_all_%`). **Wrong tool for post-restore** of the live baseline: those objects mostly do not exist until `.sql.proposed` is applied later. |

Harness **must** exit 0 before any future staging session. It is **not**
wired into `db-apply.mjs` today. A restore mission must wrap apply so the
harness runs first and unprefixed `DATABASE_URL` / `SUPABASE_URL` are
**unset or refused**.

### 4.3 Required environment variable **names** (values not printed)

Staging-only (future authorized restore / catalog):

- `STAGING_DATABASE_URL`
- `STAGING_SUPABASE_URL`
- `SHERIVS_RLS_STAGING_URL`
- `STAGING_SUPABASE_PUBLISHABLE_KEY` / `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `COREGRID_DB_CA_CERT` or `SUPABASE_CA_CERT` (TLS pin; names only)

Must **not** be used as staging fallback:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ACCESS_TOKEN` (mgmt scripts default to production ref)
- `SUPABASE_PROJECT_ID` as implied in `.env.example` (comment names production)

`.env.example` documents unprefixed names and comments the production
project id. It does **not** document `STAGING_*` twins.

### 4.4 Seed / fixture / demo paths (exclude from schema restore)

| Item | Path | Restore action |
|------|------|----------------|
| Demo enterprise provision | `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` | **Exclude.** Env-gated; writes demo school/users. |
| E2E fixture helper | `tests/e2e/helpers.ts` `provisionLegacyFixture` | **Exclude.** |
| Critical-flow probe emails | `scripts/verify-critical-flows.mjs` | **Exclude.** |
| Playwright `ALLOW_DEMO_PROVISIONING` | `playwright.config.ts` | **Exclude** from schema restore. |
| `database/` seed directory | glob `*seed*` empty | None |
| Founder RPC | `create_organization_with_founder` in `20261008000060` | Schema **include** (function). **Do not call** during baseline apply. Later synthetic onboarding only. |
| `provisionOrganization` / `createStaffAccount` | application functions | **Exclude** from apply. Later synthetic data mission. |

**Never** dump production `students`, `users`, `fees`, credentials, or
storage objects into staging.

---

## 5. Migration inventory (ordered sequence)

Authoritative directory: `database/supabase/migrations/`
Count: **71** `.sql` files
Order: lexicographic filename order (same as `scripts/db-apply.mjs`)

Static parse: comments stripped, statement regex over SQL text. Function
bodies can contain `INSERT`/`UPDATE`/`DELETE` that do **not** run at apply
time. Headers are comments, not proof of apply.

Legend for **Class**:

- `SCHOLAR` — live Scholar application schema
- `V1-SUB` — CoreGrid V1 kernel / substrate (`cg_*`)
- `AUTHZ` — authorization / RLS / helper rewrite
- `CATALOG` — reference rows (pricing, workforce kinds, bucket metadata)
- `HELD` — canonical file; human must approve before restore includes it

**Include** = proposed for the Git-complete staging baseline (all 71)
unless the human **holds the transport pair** (§8). Proposed SQL is never
in this table.

| # | Filename | Class | Header (abbrev.) | Primary objects | Notes |
|--:|----------|-------|------------------|-----------------|-------|
| 1 | `20260620122048_50e590c2-5911-4c98-8931-fb46a4b509f3.sql` | SCHOLAR | (none) | 31 tables incl. `schools`,`users`,`fees`,`students`; helpers `is_super_admin`,`get_my_school_id`,`get_my_role`,`is_school_admin`; grants; `tenant_all_*` FOR ALL | Foundation. Sensitive columns on `users`. **SHERIVS-001/002/003 source.** |
| 2 | `20260620122110_178748dc-376f-4c78-911d-ec879dfffce1.sql` | AUTHZ | (none) | Recreates helpers | Later superseded in part by DEFINER files |
| 3 | `20260620123741_7e8b6a59-b1d0-4885-bcfb-ae0dd2dac64e.sql` | SCHOLAR | (none) | Functions + GRANT incl. anon | |
| 4 | `20260620131046_25e754bd-c51f-409e-90f1-74b622794197.sql` | SCHOLAR | (none) | Additive | |
| 5 | `20260620150249_aeff3a12-2619-4cc9-aa0f-a7f5a844e8f3.sql` | AUTHZ | (none) | Policies; DROP POLICY | |
| 6 | `20260620151525_b630392a-2197-480f-b1cb-99da6c869c81.sql` | AUTHZ | (none) | DEFINER helpers | |
| 7 | `20260620163221_afd596f8-c5bc-4f1d-8bf0-fd8a2a409d14.sql` | SCHOLAR | (none) | `ALTER PUBLICATION` attendance | Needs vendor `supabase_realtime` |
| 8 | `20260622044140_557cda0e-ae5c-4abc-b1ef-51ea89d09ff5.sql` | AUTHZ | (none) | Replaces `tenant_all_messages/notifications` | |
| 9 | `20260623054451_c6c2ad41-5c74-4c10-9920-f6ef5546d4e6.sql` | SCHOLAR | (none) | `notification_preferences`; publication | UPDATE in SQL is table DML in file — review as apply-time vs trigger |
| 10 | `20260623054511_8244a074-f5e6-41b8-8d3e-44bd6d2c7e12.sql` | AUTHZ | (none) | Policies | |
| 11 | `20260624115701_d5ee45b9-21af-42a5-b99b-4ae1a1eb7a46.sql` | SCHOLAR | (none) | Realtime `attendance_logs` | |
| 12 | `20260626111823_66d215f2-2628-4490-93eb-0379825258b9.sql` | SCHOLAR+CATALOG | (none) | `school_api_keys`,`platform_config`,`news_reads`; INSERT pricing | Catalog seed `ON CONFLICT DO NOTHING` |
| 13 | `20260626130344_f04aa837-2b27-4111-8b1d-0c46287a1bb3.sql` | SCHOLAR | (none) | Additive | |
| 14 | `20260626131711_e05e2ec4-e2d0-4a0e-a905-fe22ea9a3401.sql` | AUTHZ | (none) | DROP `tenant_all_*` on audit/TPP/webhooks/qr | |
| 15 | `20260626133221_e95464b7-e864-413c-a934-7428cb26da47.sql` | SCHOLAR | (none) | Digital twin config/calls + sports | GRANT incl. anon |
| 16 | `20260626133249_c712dcde-8e28-4f72-968d-a101b1bd5f7e.sql` | AUTHZ | (none) | Policies | |
| 17 | `20260626143528_139a8242-aefe-4b45-bd91-9b17351263bc.sql` | CATALOG | (none) | INSERT `platform_config` per-student fees `ON CONFLICT DO UPDATE` | Catalog overwrite of key `per_student_fees` only |
| 18 | `20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql` | SCHOLAR | (none) | Transport, expenses, ads, `transport_buses`, `school_staff_types`; `seed_default_staff_types` | Function-body INSERT, not apply-time rows |
| 19 | `20260626172336_78ce7dbb-cbb0-4186-b95c-cd8caea6cd95.sql` | SCHOLAR | (none) | UPDATE `schools` in file | Likely column backfill; empty staging ⇒ 0 rows |
| 20 | `20260627090513_8cdbda3b-4bd0-4ac0-a4b5-0adfdc813790.sql` | SCHOLAR | (none) | Realtime `transport_buses` idempotent | |
| 21 | `20260705002543_e6b3e3bb-6d5e-4783-97cd-39e875bece40.sql` | SCHOLAR | (none) | `school_staff`,`school_gallery`; GRANT SELECT to **anon** on staff | Public faculty read |
| 22 | `20260707223958_421f2364-7989-4069-b78c-fd119f19daeb.sql` | AUTHZ | (none) | Storage policies for `school-media` | Bucket row comes later (`00040`) |
| 23 | `20260707225659_58faa06f-1875-4a2b-8365-88a8473383f2.sql` | SCHOLAR | (none) | Additive | |
| 24 | `20260725063636_d379b679-904b-4d2a-b9ed-11b463817fda.sql` | SCHOLAR | (none) | Hostel/clinic/library/discipline/`staff_payroll`/`staff_leave` | **SHERIVS-003** HR tables + broad grants |
| 25 | `20260725064521_96522167-55e3-4281-ae25-6180fe57369f.sql` | SCHOLAR | (none) | Additive | |
| 26 | `20260725065302_ddd47f8e-25ed-4581-84e8-658d1e38ecdb.sql` | SCHOLAR | (none) | Tables + grants | |
| 27 | `20260726085612_c410e01a-1b96-4b65-b539-0eb71556bb31.sql` | SCHOLAR | (none) | `student_platform_fee_ledger` | |
| 28 | `20260729052237_75252732-97d3-448f-b082-93517558a096.sql` | SCHOLAR | (none) | `teacher_biometrics` (+ hash), verification log, geofence; FOR ALL-style school isolation | **SHERIVS-003**. Duplicate CREATE later. |
| 29 | `20260729054314_21b2720c-0c44-46ce-8404-e256ce7cf4ee.sql` | SCHOLAR | (none) | `CREATE TABLE IF NOT EXISTS` same three tables; AI/study tables; policy name `school_isolation` (different from `biometrics_school_isolation`) | Idempotent tables; **second** biometric policy |
| 30 | `20260819000000_coregrid_harden_schools_and_realtime.sql` | AUTHZ | (none) | Realtime publication completeness; REVOKE | |
| 31 | `20260903000000_coregrid_universal_kernel_substrate.sql` | V1-SUB | AUTH NOT VALIDATED | `cg_entity` family; REVOKE anon/authenticated; GRANT service_role | Empty-DB create |
| 32 | `20260904010000_coregrid_rls_transport_and_grants.sql` | AUTHZ | (none) | Replace `buses_school_rw`; scoped bus policies; REVOKE TRUNCATE on buses/`users` | Scholar transport usable by clients |
| 33 | `20260904020000_coregrid_l2_identity_tenancy.sql` | V1-SUB | (none) | `cg_identity`,`cg_tenant` | |
| 34 | `20260907000000_coregrid_workforce_kind_substrate.sql` | V1-SUB | APPLIED+VERIFIED (prod comment) | `cg_workforce_kind`,`cg_workforce_position` | Prod ref in **comment only** |
| 35 | `20260907000100_runtime_scholar_workforce_catalog.sql` | CATALOG | APPLIED+VERIFIED | INSERT `cg_domain_runtime`,`cg_workforce_kind` | Reference catalog, not PII |
| 36 | `20260907000300_coregrid_workforce_position_rpc.sql` | V1-SUB | APPLIED+VERIFIED | DEFINER RPCs; INSERT/UPDATE in **function bodies** | |
| 37 | `20260907000400_coregrid_self_primary_position_rpc.sql` | V1-SUB | APPLIED+VERIFIED | RPC | |
| 38 | `20260907000500_coregrid_end_position_promotion.sql` | V1-SUB | APPLIED+VERIFIED | RPC | |
| 39 | `20260907000600_runtime_scholar_workforce_ecosystem_extension.sql` | CATALOG | APPLIED+VERIFIED | more `cg_workforce_kind` INSERTs | |
| 40 | `20260907000700_coregrid_org_profile_substrate.sql` | V1-SUB | APPLIED+VERIFIED | `cg_org_profile` + RPCs | |
| 41 | `20260907000800_coregrid_role_assignment_substrate.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_role_assignment`,`cg_role_grant` | Needed by later `00013` |
| 42 | `20260929000000_coregrid_foundation_mission_001.sql` | V1-SUB | AUTHORED NOT APPLIED | mission/evidence tables | |
| 43 | `20260930000000_coregrid_v1_workspace_persistence.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_workspace*` | |
| 44 | `20261001000000_coregrid_v1_org_model.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_org_unit`,`cg_org_membership` | |
| 45 | `20261002000000_coregrid_v1_kernel_envelope.sql` | V1-SUB | AUTHORED NOT APPLIED | envelope | |
| 46 | `20261002000001_coregrid_v1_neutral_tenant_primitives.sql` | V1-SUB | AUTHORED NOT APPLIED | `get_my_tenant_id` / `is_tenant_admin` + RPCs | Later policy files depend on these |
| 47 | `20261002000002_coregrid_v1_worker_definitions.sql` | V1-SUB | AUTHORED NOT APPLIED | worker tables; REVOKE client | |
| 48 | `20261002000003_coregrid_v1_kernel_bitemporal.sql` | V1-SUB | AUTHORED NOT APPLIED | function | |
| 49 | `20261002000004_coregrid_v1_memory_tier.sql` | V1-SUB | AUTHORED NOT APPLIED | memory tables | |
| 50 | `20261002000005_coregrid_v1_reconciliation.sql` | V1-SUB | AUTHORED NOT APPLIED | reconciliation tables | |
| 51 | `20261002000006_coregrid_v1_event_security.sql` | V1-SUB | AUTHORED NOT APPLIED | event security tables | |
| 52 | `20261002000007_coregrid_v1_event_routing.sql` | V1-SUB | AUTHORED NOT APPLIED | routing tables | |
| 53 | `20261002000008_coregrid_v1_evidence_lifecycle.sql` | V1-SUB | AUTHORED NOT APPLIED | evidence tables | |
| 54 | `20261002000009_coregrid_v1_reasoning_provenance.sql` | V1-SUB | AUTHORED NOT APPLIED | provenance | |
| 55 | `20261002000010_coregrid_v1_cost_attribution.sql` | V1-SUB | AUTHORED NOT APPLIED | cost tables | |
| 56 | `20261002000011_coregrid_v1_knowledge_currency.sql` | V1-SUB | AUTHORED NOT APPLIED | knowledge tables | |
| 57 | `20261002000012_coregrid_v1_tool_runtime.sql` | V1-SUB | AUTHORED NOT APPLIED | tool runtime | |
| 58 | `20261002000013_coregrid_v1_neutral_membership_policies.sql` | AUTHZ | AUTHORED-then-APPLIED (prod comment) | FORCE RLS + policies on cg membership tables | Prod ref in comment |
| 59 | `20261002000014_coregrid_v2_transport_buses_rls.sql` | AUTHZ **HELD** | AUTHORED NOT APPLIED | DROP 5 bus policies; REVOKE ALL client; GRANT ALL `service_role`; verify zero policies | V2 **filename**; Scholar transport client path **denied**. Pair with #68. |
| 60 | `20261002000015_coregrid_v1_substrate_policies.sql` | AUTHZ | AUTHORED NOT APPLIED | FORCE RLS + policies | |
| 61 | `20261003000016_coregrid_v1_file_substrate.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_file_object` | |
| 62 | `20261003000017_coregrid_v1_idempotency_substrate.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_idempotency_record`; prune fn contains DELETE | DELETE is **function body**, not apply-time truncate |
| 63 | `20261003000018_coregrid_v1_idempotency_privilege_revoke.sql` | AUTHZ | AUTHORED NOT APPLIED | REVOKE/GRANT idempotency | Compensates default ACLs |
| 64 | `20261003000019_coregrid_v1_mission_lease.sql` | V1-SUB | AUTHORED NOT APPLIED | lease/quarantine tables; comments mention DROP TABLE as **rollback**, not forward | |
| 65 | `20261003000020_coregrid_is_super_admin_definer.sql` | AUTHZ | (none) | `CREATE OR REPLACE is_super_admin` SECURITY DEFINER | Required to avoid `54001` recursion. Include. |
| 66 | `20261003000030_coregrid_hermes_observation_substrate.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_hermes_observation` deny-by-default | |
| 67 | `20261003000031_coregrid_delivery_evidence.sql` | V1-SUB | AUTHORED NOT APPLIED | `cg_delivery_evidence` | |
| 68 | `20261003000040_coregrid_school_media_bucket.sql` | CATALOG | AUTHORED NOT APPLIED | INSERT `storage.buckets` `school-media` | Metadata only; no object copy |
| 69 | `20261003000041_coregrid_transport_bus_reads.sql` | AUTHZ **HELD** | AUTHORED NOT APPLIED | FORCE RLS; GRANT SELECT authenticated; one driver SELECT policy; **DO block fails unless `00014` zeroed policies** | Must be applied **with** #59 or **neither** |
| 70 | `20261008000050_coregrid_organization_memberships.sql` | SCHOLAR | APPLIED (prod comment) | `organization_memberships`; FORCE RLS; sync trigger; backfill INSERT from `users` | Empty staging ⇒ backfill inserts 0 rows |
| 71 | `20261008000060_organization_onboarding.sql` | SCHOLAR | NOT YET APPLIED | `create_organization_with_founder` DEFINER | **Include** on empty staging (founder path). INSERT only when RPC is called later. |

**Filename collisions:** none.
**CREATE EXTENSION:** none in any file. Relies on staging already having
`pgcrypto` / `uuid-ossp` (historical catalog). `gen_random_uuid()` is used
in foundation defaults.
**ALTER DEFAULT PRIVILEGES:** none in canonical migrations. Staging vendor
defaults still grant ALL on future public tables until each file REVOKEs.

---

## 6. Migration classification (canonical vs proposed)

### 6.1 Canonical application migrations

All **71** files in `database/supabase/migrations/*.sql` at `d195ba8`.
Headers that say `AUTHORED, NOT APPLIED` describe **production/dev apply
status as claimed in comments**. They are still canonical Git files. This
mission **cannot** verify those claims (production must not be opened).

Do **not** omit a canonical file solely because it encodes SHERIVS-001/002/003
defaults. Flag it and require approval to restore **knowing** those findings
will be live on staging until a later remediation mission.

### 6.2 Excluded proposed remediation (not baseline)

These are **unapplied review artifacts**. `db-apply.mjs` only reads `*.sql`
under `database/supabase/migrations/`. Do **not** copy them.

| Order | File | Change set | Baseline? |
|------:|------|------------|-----------|
| 1 | `20261015000010_sherivs_authz_helpers_active.sql.proposed` | B helpers | **EXCLUDE** |
| 2 | `20261015000020_sherivs_admin_hr_rpcs.sql.proposed` | C HR RPCs | **EXCLUDE** |
| 3 | `20261015000030_sherivs_users_identity_freeze.sql.proposed` | A identity | **EXCLUDE** |
| 4 | `20261015000040_sherivs_users_sensitive_column_revoke.sql.proposed` | F columns | **EXCLUDE** |
| 4b | `20261015000045_sherivs_rls_payroll_biometrics.sql.proposed` | E-HR | **EXCLUDE** |
| 5 | `20261015000050_sherivs_rls_wave_a_classes_calendar_timetable.sql.proposed` | E-A | **EXCLUDE** |
| 6 | `20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql.proposed` | E-B | **EXCLUDE** |
| 7 | `20261015000070_sherivs_fees_settlement_and_rls_wave_c.sql.proposed` | D + E-C | **EXCLUDE** (Gate 3: blocked until Paystack app) |
| 8 | `20261015000080_sherivs_rls_grant_hygiene.sql.proposed` | G + C3 | **EXCLUDE** |
| 9 | `20261015000090_sherivs_users_force_rls.sql.proposed` | H FORCE | **EXCLUDE** (not eligible until founder+DEFINER staging) |

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**. None of the
above is classified resolved.

---

## 7. Destructive-operation findings

Forward migrations: **no** `DROP TABLE` / `TRUNCATE` at statement start
(grep `^DROP TABLE` / `^TRUNCATE` empty).

| Kind | Files | Restore implication |
|------|-------|---------------------|
| `DROP POLICY` | `20150249`, `22044140`, `26111823`, `26131711`, `20260904010000`, **`20261002000014` (5 policies)** | Idempotent `IF EXISTS` except where unguarded. On empty staging, early drops are no-ops (policies not yet created) **except** drops that follow creates in **later** files of the same sequence (transport pair). |
| `DELETE FROM` in text | `20261003000017` | Inside prune **function**, not apply-time wipe |
| `UPDATE` in text | messages, schools, workforce/role RPCs, memberships sync | Function bodies or empty-table no-ops |
| `INSERT` apply-time | `platform_config` (2 files), `cg_workforce_kind` catalog, `storage.buckets`, memberships backfill | Catalog / empty backfill — not customer PII |
| `ON CONFLICT DO UPDATE` | `20260626143528` `platform_config.per_student_fees` | Overwrites that **catalog key** if re-run |
| Publication `ADD TABLE` | attendance, messages, notifications, buses, harden list | Requires vendor publication `supabase_realtime` (default Supabase). Failure would stop apply. |

**Not transactionally reversible as a 71-file set.** Each `db-apply.mjs`
file commits separately. Companion rollbacks exist for **31** later files
only. Foundation Scholar tables have **no** rollback SQL. Recovery for a
failed or unwanted staging apply is **recreate the staging project** (or
restore a snapshot if the operator has one — **not verified here**).

Do **not** invent a PITR / transactional undo guarantee.

---

## 8. Production-reference and V1-boundary risks

### 8.1 Hard-coded production project id in SQL

`nwrflbpbhyiqdptmlccm` appears in **comments / headers only** (9 files).
After comment-stripping, the **SQL body contains zero** production refs.
Migrations are **environment-independent** as SQL.

`database/supabase/config.toml` `project_id` is production. CLI link/push
without an explicit staging project is a **production-apply hazard**.

### 8.2 Transport pair (held pending explicit review)

`20261002000014_coregrid_v2_transport_buses_rls.sql`:

- Canonical Git file at `d195ba8` (do not silently omit).
- Filename and header are **V2**; AGENTS.md V2 (device/IoT) is **frozen**.
  The SQL actually mutates V1 Scholar table `public.transport_buses`
  (created 20260626, corrected 20260904).
- Header: AUTHORED, NOT APPLIED.
- Drops all known client policies, REVOKEs ALL from anon/authenticated/PUBLIC,
  GRANTs ALL to `service_role`, asserts **zero** remaining policies.
- Client REST/realtime bus access **denies** after this file until `00041`.

`20261003000041_coregrid_transport_bus_reads.sql`:

- Adds FORCE RLS, `GRANT SELECT` to authenticated, one policy
  `transport_buses_select_driver_assigned` (`driver_id = auth.uid()`).
- Verification `DO` block **fails loudly** unless the table has exactly that
  one SELECT policy and client writes are absent — i.e. **`00014` must have
  run**. Skipping `00014` and applying `00041` is expected to **FAIL** because
  `20260904010000` policies would still exist.

**Approval decision (required before restore):**

- **Option Git-complete (recommended for “match `d195ba8`”):** apply both
  in order as part of the 71. Staging transport will **not** match the
  20260904 parent/driver/admin client posture; it will match Git after
  `00041` (driver self-SELECT only; writes via `service_role`).
- **Option Scholar-transport-preserve:** skip **both** files. Then client
  policies from `20260904010000` remain. Staging would **not** match the
  full Git tree. Do not skip only one of the pair.

This unresolved choice is a primary reason status is **B**.

### 8.3 Duplicate biometric objects

`20260729052237` creates `teacher_biometrics` and policy
`biometrics_school_isolation` (no command → FOR ALL).
`20260729054314` uses `CREATE TABLE IF NOT EXISTS` (safe) then a **second**
policy `school_isolation` if not present. Both can exist. Broad
authenticated DML grants remain. **SHERIVS-003 stays OPEN.** Apply still
succeeds (different policy names).

---

## 9. Default-grant and security-policy risks

These are **canonical**. They must be applied if the goal is the live
Scholar schema. They require a **separate security review before any
production use of staging as a security oracle**, and they keep findings
OPEN.

| Risk | Source file | What lands on staging |
|------|-------------|------------------------|
| `users.role` / `school_id` / `is_active` writable via `User updates self` UPDATE + `School admin manages users` FOR ALL | foundation `20260620122048` | **SHERIVS-001** |
| `GRANT SELECT, INSERT, UPDATE, DELETE` to `authenticated` on tenant tables; `GRANT ALL` to `service_role` | foundation DO-loop + later tables | **SHERIVS-002** |
| Dynamic `tenant_all_*` FOR ALL on classes/students/fees/attendance/… | foundation | **SHERIVS-002** (some later files drop individual `tenant_all_*`) |
| Sensitive `users` columns (`salary`,`nin`,`bank_*`,`face_biometric`) with table-level SELECT for same-school users | foundation | **SHERIVS-003** |
| `staff_payroll`, `teacher_biometrics` (`face_template_hash`), leave, verification log | `20260725` / `20260729` | **SHERIVS-003**; school-wide FOR ALL-style policies |
| `schools.paystack_secret_key` column + admin table grants | foundation | Secret column in tenant table |
| GRANT SELECT to **anon** on marketing tables and `school_staff` | foundation + `20260705002543` | Public read by design; still a review item |
| SECURITY DEFINER helpers `search_path = public` | foundation / later | Recursion mitigations exist (`00020`); still privileged |
| Vendor default ACL ALL for anon/authenticated on new tables | staging catalog (historical) | Later V1 files often REVOKE; early Scholar files often do **not** REVOKE TRUNCATE except `20260904010000` (buses/users) and memberships |
| `postgres` / `service_role` BYPASSRLS | vendor | Unchanged; service-role key must be staging-only |

**Do not remove or alter these grants in the restore mission.** Remediation
belongs to a later authorized staging apply of `.sql.proposed` **after**
post-restore catalog.

---

## 10. Proposed staging baseline sequence (do not execute)

### 10.1 Authoritative Git commit

`d195ba861f80379b79533126653b9cee82a8e872` (`origin/master`)
Migration tree `bbd828951e166662bbe831fd74972e1a15488468`
Directory: `database/supabase/migrations/`

Working tree for operators may be this document chain; **blobs are
identical**. Pin the tree id in the apply log.

### 10.2 Ordered list

All **71** filenames in §5, in that order, **if** the transport pair is
approved.

If the transport pair is **held**: the other **69** files in the same
relative order (omit `20261002000014` and `20261003000041` only).

### 10.3 Extensions and prerequisites

- Staging project identity `dvxszhracsjwdancijdc` re-verified.
- PostgreSQL compatible with PG 17 (historical 17.11).
- Extensions: `pgcrypto`, `uuid-ossp` (do **not** `CREATE EXTENSION` in
  app migrations; fail if missing).
- Vendor schemas `auth`, `storage`, publication `supabase_realtime`.
- TLS: pinned CA; prefer IPv4 session pooler if direct `db.<ref>` IPv6 is
  unreachable (method from Gate 4 catalog — **reconnect only when
  authorized**).
- Role `postgres` (or a role that can DDL in `public` and `storage`).
- **No** customer dump loaded.

### 10.4 Synthetic seed data

**Not** part of schema restore.

After a successful post-restore catalog, a **later** mission may create
synthetic schools/users via:

- `create_organization_with_founder` (after `00060`)
- service_role fixtures from `STAGING-TEST-HARNESS.md`
- **not** `provisionDemoEnterprise` unless explicitly approved for staging
- **not** production rows

Catalog INSERTs inside canonical migrations (`platform_config`,
`cg_workforce_kind`, `school-media` bucket metadata) **are** part of schema
restore. They are not people.

### 10.5 Staging identity preflight (read-only)

1. `node scripts/staging/sherivs-rls-prep/assert-not-production.mjs` exit 0
   using only `STAGING_*` / `SHERIVS_RLS_STAGING_URL`.
2. Parse hostname: must contain `dvxszhracsjwdancijdc`; must **not** contain
   `nwrflbpbhyiqdptmlccm`.
3. Refuse if `DATABASE_URL` or `SUPABASE_URL` is in the apply environment.
4. Repeat Gate 4 catalog queries under `default_transaction_read_only=on`
   (separately authorized): expect still-empty public Scholar relations
   unless documented otherwise.
5. Confirm extensions and `supabase_realtime` exist.

### 10.6 Required approval before mutation

A human must explicitly authorize **all** of:

1. Target = staging `dvxszhracsjwdancijdc` only.
2. Git pin = `d195ba8` / tree `bbd82895…`.
3. Transport pair Option Git-complete **or** Option skip-pair (§8.2).
4. Acceptance that SHERIVS-001/002/003 defaults will exist after apply.
5. Acceptance that apply is **not** recorded in `supabase_migrations` if
   `db-apply.mjs` is used, unless the operator also uses a staging-linked
   CLI push (with `config.toml` **not** silently pointing at production).
6. Recovery = recreate staging project; no claimed transactional rollback.

### 10.7 Recommended apply wrapper (future mission — not run here)

- Harness first.
- Connection string **only** from `STAGING_DATABASE_URL`.
- **Do not** run `db-apply-mgmt.mjs` / `apply-*-migrations.mjs` with default
  argv.
- **Do not** `supabase db reset`.
- **Do not** `supabase link` using `config.toml` production id.
- Apply files in order; log `OK`/`FAIL` per file; stop on first failure.
- Optionally record versions in `supabase_migrations.schema_migrations`
  **only** with a documented, staging-only method (not designed in
  `db-apply.mjs` today).

### 10.8 Stop conditions

Stop and do not continue apply if any of:

- Harness exit ≠ 0
- Target hostname/ref is production or unknown
- Unprefixed `DATABASE_URL` would be used
- Preflight shows unexpected Scholar objects (drift from empty)
- `CREATE EXTENSION` missing dependency (`gen_random_uuid`)
- Any file FAILs
- Operator requests abort
- Any command would open production
- Attempt to include `.sql.proposed`

---

## 11. Post-restore verification plan (future read-only mission)

Do **not** run `catalog-verify.sql` as a pass/fail of **baseline** restore.
That file expects freeze helpers and absence of `tenant_all_%` **after**
proposed SQL.

Post-restore catalog (staging-only, read-only, harness first):

1. `current_database`, `inet_server_addr`, `version()` — identity still
   staging; PG version.
2. Count `public` tables / views / indexes vs Git-created names in §12.
3. `to_regclass` for Scholar set: `users`, `schools`, `organization_memberships`,
   `students`, `fees`, `staff_payroll`, `teacher_biometrics`, `transport_buses`, …
4. List `pg_policy` on `public.users`, `fees`, `staff_payroll`,
   `teacher_biometrics`, `transport_buses`, `organization_memberships`.
5. Confirm helpers exist: `is_super_admin`, `get_my_school_id`, `get_my_role`,
   `is_school_admin`, `create_organization_with_founder` (if `00060` applied),
   `sync_organization_membership_on_user_write`.
6. `is_super_admin` must be SECURITY DEFINER (`00020`).
7. Transport: either 20260904 four policies **or** `00014`+`00041` posture
   matching the approved option.
8. `storage.buckets` contains `school-media` **if** `00040` applied; **do
   not** list `storage.objects` beyond existence counts if empty.
9. `platform_config` keys `subscription_tiers_pricing`, `per_student_fees`.
10. Privileges: authenticated DML on foundation tables **will** be present
    (document; do not “fix”).
11. Migration history: if CLI was not used, `supabase_migrations` may still
    be absent — that is **not** proof apply failed if relations exist.
12. No application PII queries; no `SELECT` of `users.nin` / salary / face
    payloads — existence of columns only.

Compare object **names** to Git. Do not claim production parity.

---

## 12. Expected schema objects after a Git-complete restore

Approximate, from static `CREATE TABLE` (unique **121** public tables),
plus functions, policies, triggers, and one storage bucket. Not a live
catalog.

**Scholar / product (non-exhaustive):**
`schools`, `super_admins`, `users`, `classes`, `students`,
`parent_student_map`, `grades`, `attendance`, `attendance_logs`,
`lesson_plans`, `timetables`, `timetable_slots`, `school_calendar`,
`news`, `events`, `teacher_performance_profiles`, `fees`, `fraud_attempts`,
`qr_tokens`, `notifications`, `testimonials`, `faqs`, `academic_programs`,
`school_facilities`, `why_us_items`, `blog_posts`, `subscriptions`,
`super_admin_logs`, `webhook_logs`, `messages`, `audit_logs`,
`notification_preferences`, `school_api_keys`, `platform_config`,
`news_reads`, `admission_applications`, `digital_twin_config`,
`digital_twin_calls`, `school_sports`, `school_meals`, `school_transport`,
`transport_buses`, `school_staff_types`, `school_expenses`,
`school_expense_budgets`, `platform_complaints`, `school_ad_campaigns`,
`school_staff`, `school_gallery`, hostel/clinic/library/discipline tables,
`staff_payroll`, `staff_leave`, `student_platform_fee_ledger`,
`teacher_biometrics`, `attendance_verification_log`, `school_geofence`,
`ai_conversations`, `ai_interaction_log`, `study_sessions`,
`organization_memberships`.

**V1 `cg_*` substrate:** entity/relationship/event/observation/runtime,
identity/tenant, workforce, org profile/roles, mission/evidence,
workspace, org unit/membership, workers, memory, reconciliation, event
security/routing, evidence lifecycle, provenance, cost, knowledge, tools,
file, idempotency, mission lease, hermes, delivery evidence.

**Helpers (baseline, not proposed freeze/HR RPCs):**
`is_super_admin`, `get_my_school_id`, `get_my_role`, `is_school_admin`,
`touch_updated_at`, workforce/org/role RPCs, `get_my_tenant_id`,
`holds_tenant_role`, `is_tenant_admin`, `get_my_memberships`,
`sync_organization_membership_on_user_write`,
`create_organization_with_founder`.

**Not expected until proposed SQL:** freeze triggers, `admin_hr_staff_*`,
column-level REVOKEs on `users.salary`, FORCE RLS on `users`.

Row counts for people/payments: **expect 0** if no seed mission ran.
Catalog rows: platform_config keys, workforce kinds, possibly empty
memberships.

---

## 13. Recovery limitations

| Scenario | Recovery | Guarantee? |
|----------|----------|------------|
| Fail mid-file | Postgres implicit transaction for that simple-query string **may** roll back that file; **not** proven for every file that contains internal `DO` blocks | **No** cross-file guarantee |
| Fail after file N of 71 | Schema partial; remaining files not applied | Recreate staging project |
| Unwanted full apply | Drop/recreate staging Supabase project | Operator-owned; **not** verified |
| File-level rollback SQL | 31 files under `database/supabase/rollbacks/` | Inverse of **later** migrations only; **do not** run in this mission; running them on a partial DB can fail |
| Foundation 20260620 tables | No rollback files | Recreate project |
| Data | Staging should have no customer data | Do not copy prod to “fix” staging |

---

## 14. Seed-data separation plan

**Phase S0 — schema (this plan, not executed):** canonical `*.sql` only.
Catalog INSERTs allowed. No demo provision. No production dump.

**Phase S1 — synthetic identities (later, approved):** harness actors in
`STAGING-TEST-HARNESS.md` (Student A/B, Teacher T, Parent P, Bursar,
Admin H/Z, Super S, Unlinked U). Clearly fake emails. Empty Paystack
school secrets. No real NIN/bank/face templates.

**Phase S2 — proposed SQL (later, after post-restore catalog):** eligible
`00010`–`00060`,`00080` only per Gate 3; skip `00070`/`00090`.

**Phase S3 — JWT matrix.** Destroy synthetic identities afterward.

Excluded forever from “make staging look like prod”: production students,
parents, staff, payments, credentials, storage objects, merchant keys.

---

## 15. Open questions and required approvals

1. **Transport pair** `00014`+`00041`: Git-complete vs skip-both (§8.2).
2. **Recheck staging catalog** in a separately authorized read-only
   session before apply.
3. **Apply runner:** wrap `db-apply` with harness + `STAGING_DATABASE_URL`,
   vs a new staging-only script. Current `db-apply.mjs` is unsafe on this
   operator VM because unprefixed `DATABASE_URL` was production.
4. **History recording:** accept absent `supabase_migrations` or add a
   staging-safe recorder. CLI push is unsafe while `config.toml` names
   production.
5. **Confirm** empty staging still has `pgcrypto` / `uuid-ossp` /
   `supabase_realtime`.
6. **Human written authorization** for mutating staging.
7. **Do not** treat comment headers (`APPLIED` / `NOT APPLIED`) as a
   production catalog. Matching production exactly would require a
   production catalog this mission **must not** collect.

Until (1) and (6) are decided, restore execution stays blocked even though
the Git source is proven.

---

## 16. Findings status (unchanged)

| ID | Status | Relation to restore |
|----|--------|---------------------|
| SHERIVS-001 | **OPEN** | Will be **present** after foundation apply |
| SHERIVS-002 | **OPEN** | Broad grants / FOR ALL will be **present** |
| SHERIVS-003 | **OPEN** | HR/financial/biometric columns and policies will be **present** |

Proposed SQL does not land in this baseline. Nothing is resolved.

---

## 17. Version-target classification

**ACTIVE-V1 ONLY.**

This mission inspected V1 Scholar schema and V1 `cg_*` substrate files that
already sit on `origin/master`. It does **not** implement V2 device/IoT or
V3 Reality Intelligence. The V2-**named** transport file is a Git artifact
of the V1 tree; inclusion is an approval question, not an un-freeze of V2
scope.

---

## 18. Explicit non-execution close

- No database was opened.
- No SQL or migration was executed.
- Production and staging were unchanged.
- No restore was started.
- Do not apply migrations automatically after this report.

---

## 19. Agent report

**Implemented:** evidence-backed staging schema restore **plan** (document
only).

**Files changed:** `docs/security/rls-prep/SHERIVS-STAGING-SCHEMA-RESTORE-PREP-001.md`

**Architecture impact:** none to running systems. Documents that canonical
migrations encode OPEN RLS findings.

**Tests:** static Git tree comparison; static SQL inventory of 71 files;
path/script inspection. No database tests. No apply.

**Security validation:** production non-contact by not connecting;
proposed SQL excluded; harness identified; unsafe default scripts listed.

**Known risks:** transport-pair ambiguity; default ACLs; `db-apply.mjs`
production-URL hazard; headers ≠ applied truth; staging catalog stale.

**Remaining work:** independent review; catalog recheck; human approval;
then a **separate** mutating restore mission.

**Final status:** **B. RESTORE PLAN PARTIAL — SPECIFIC MIGRATION QUESTIONS REMAIN**
