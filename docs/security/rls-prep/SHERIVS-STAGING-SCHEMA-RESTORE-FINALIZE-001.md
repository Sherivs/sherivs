# SHERIVS-STAGING-SCHEMA-RESTORE-FINALIZE-001

**Mission ID:** SHERIVS-STAGING-SCHEMA-RESTORE-FINALIZE-001
**Mission class:** RESTORE-PLAN FINALIZATION — NO DATABASE CHANGES
**Version target:** ACTIVE-V1 ONLY
**Timestamp (UTC):** 2026-10-14T19:39:42Z
**Role:** Principal Database Architect / Supabase Migration Engineer / Production Safety Engineer / Independent Verification Architect

**Final status:** **A. RESTORE PLAN FINALIZED — READY FOR INDEPENDENT REVIEW**

This document **finalizes the staging schema restoration plan**. It does
**not** restore staging. It does **not** authorize migration execution. It
does **not** close SHERIVS-001, SHERIVS-002, or SHERIVS-003.

---

## 0. Decision summary

The proposed staging baseline is the **71-file canonical tree** at
`origin/master` @ `d195ba861f80379b79533126653b9cee82a8e872`, directory
`database/supabase/migrations/`, Git tree
`bbd828951e166662bbe831fd74972e1a15488468`.

**OPTION A is accepted for that proposed baseline.** Both transport
migrations are included, in canonical filename order, and neither is
omitted:

| Seq | Filename |
|----:|----------|
| 59 | `20261002000014_coregrid_v2_transport_buses_rls.sql` |
| 69 | `20261003000041_coregrid_transport_bus_reads.sql` |

`00014` removes the legacy `transport_buses` policies and client grants.
`00041` establishes FORCE RLS, the authenticated SELECT grant, and the
driver-assignment read policy. Skipping one of the pair is **not** a
supported restore path.

This decision is limited to the **staging restoration plan**. It does not
authorize applying either file, or any other file, to any database.

Canonical `*.sql` migrations are distinct from `*.sql.proposed`
remediation. Proposed files are **excluded**. Applying the 71-file
baseline **reintroduces** the insecure Scholar defaults described by
SHERIVS-001 / 002 / 003. Those findings remain **OPEN**.

Existing apply scripts are **unsafe** for this restore (unprefixed
`DATABASE_URL`, production argv defaults, hardening marshal skips `00014`).
They are **not modified in this mission**. A future staging-only runner
must be built and authorized separately.

**Restore execution remains blocked** until independent review of this
plan, a fresh staging-only catalog preflight, a staging-only runner, and
written human authorization. Finalized plan ≠ authorized apply.

---

## 1. Non-contact and non-mutation statements

- **No database was opened.** No Postgres session, pooler session, or
  Supabase Management API query ran in this mission.
- **No SQL or migration was executed.** Static inspection only (`git`
  objects, file reads, offline regex/statement parse). Parsed SQL was
  never sent to a server.
- **Production (`nwrflbpbhyiqdptmlccm`) was not used as a target, fallback,
  or credential source.**
- **Staging (`dvxszhracsjwdancijdc`) was unchanged.** No apply, reset, DDL,
  DML, GRANT, REVOKE, or settings change.
- **No `.sql.proposed` file was copied or applied.**
- **No migration file and no application code was modified.**
- **No environment variable or secret was changed.**
- **No deploy, merge, or publish of a restore occurred.** (This report
  branch is documentation only.)
- **No production customer data was queried or copied.**
- **This mission does not execute the plan after producing the report.**

The only intended working-tree change is this file.

---

## 2. Authoritative source and repository verification

### 2.1 Inspection state (this mission)

| Item | Value |
|------|-------|
| Agent start branch | `coregrid-scholar-migration` |
| Agent start HEAD | `857d4fee1ccc9d11b3c4a34f1142ff6a0da1f7fe` |
| Working tree before this file | clean |
| This report branch | `cursor/sherivs-staging-schema-restore-finalize-517e` |
| `origin/master` (fetched, not checked out) | `d195ba861f80379b79533126653b9cee82a8e872` |
| `origin/master` subject | `Merge pull request #9 from vibeoraai-bit/cursor/v1-production-host-routing-5cb8` |
| `d195ba8` is `origin/master` | **yes** (`git rev-parse` equal) |
| Silent switch to `master` | **no** |
| History rewrite | **no** |

Default branch `coregrid-scholar-migration` is **not** the restore source.
Its migration tree is `a104d5e34f0f4020ffe0d6e36b97cc444459c3f2` (**69**
files). It is missing:

- `20261008000050_coregrid_organization_memberships.sql`
- `20261008000060_organization_onboarding.sql`

Those two files **are** in the 71-file `origin/master` tree and **are**
part of the proposed staging baseline.

### 2.2 Canonical migration tree

| Item | Evidence |
|------|----------|
| Authoritative commit | `d195ba861f80379b79533126653b9cee82a8e872` |
| Canonical directory | `database/supabase/migrations/` |
| Full Git tree hash | `bbd828951e166662bbe831fd74972e1a15488468` |
| File count | **71** `.sql` files |
| Timestamp-prefix collisions | **none** (`71` unique leading `YYYYMMDDHHMMSS` tokens) |
| Other `**/migrations` directories at `d195ba8` | none besides this path |
| `CREATE EXTENSION` in any canonical file | **none** |
| `ALTER DEFAULT PRIVILEGES` in any canonical file | **none** |
| Statement-start `DROP TABLE` / `TRUNCATE` / `DROP SCHEMA` / `DROP DATABASE` | **none** |
| Production project ref in SQL bodies after comment-stripping | **none** (9 files mention `nwrflbpbhyiqdptmlccm` in **comments/headers only**) |

`git rev-parse d195ba8:database/supabase/migrations` was re-measured in
this mission and matches the restore-prep and transport-review tree id.

### 2.3 Input reports consumed (Git artifacts; not modified)

These files are **not** on `origin/master`. They were read from their
report branches without merging those branches into this working tree.

| Report | Git location | Role here |
|--------|--------------|-----------|
| Restore prep | `origin/cursor/sherivs-staging-schema-restore-prep-caab` commit `615fe53f871809c69f89d60ee337dc860b1613b2` — `docs/security/rls-prep/SHERIVS-STAGING-SCHEMA-RESTORE-PREP-001.md` (PR #18) | Prior plan; status **B** pending transport pair |
| Transport review | `origin/cursor/sherivs-transport-migration-review-1f50` commit `3907f43421fd79991ea0e9718401b6345346bb83` — `docs/security/rls-prep/SHERIVS-TRANSPORT-MIGRATION-REVIEW-001.md` (PR #19) | OPTION A recommendation and pair SQL contract |
| Catalog baseline | `origin/cursor/sherivs-rls-gate4-catalog-baseline-caab` commit `83ae504ab51c5e0781baf33efee42fdee033bf66` — `docs/security/rls-prep/GATE4-CATALOG-BASELINE-001.md` (PR #16) | **Historical** empty-staging catalog (2026-10-14T18:34:55Z) |

`d195ba8` is an ancestor of `83ae504`. Migration blobs at `d195ba8` and
`83ae504` share tree `bbd828951e166662bbe831fd74972e1a15488468`. Report
branches after `d195ba8` are documentation; they are **not** a second
application source.

Environment-separation audit (`SHERIVS-ENVIRONMENT-SEPARATION-AUDIT-001`,
PR #17) was consulted for operator-script defaults only. It was not
modified.

### 2.4 Source-safety conclusion

Authoritative source, directory, count, ordering, and full tree hash are
**proven from Git**. Status is not **C**.

---

## 3. Accepted transport migration decision

### 3.1 Decision (plan scope only)

**OPTION A — include both files in canonical filename order in the 71-file
staging baseline.**

Do not skip `20261002000014`. Do not skip `20261003000041`. Do not skip
one of the pair.

Authority for this plan decision:

1. Operator instruction for this mission: OPTION A is accepted for the
   proposed staging baseline.
2. `SHERIVS-TRANSPORT-MIGRATION-REVIEW-001` final recommendation: OPTION A
   for a Git-complete empty-staging restore matching `d195ba8`.
3. Independent re-measure in this mission: both blobs exist at `d195ba8`;
   filename positions are **#59** then **#69**; sha256 and git blob ids
   match the transport review.

| Token | Path at `d195ba8` | sha256 | git blob | Seq |
|-------|-------------------|--------|----------|----:|
| `00014` | `database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql` | `a1e3bcc3b0f1436de6c49d4ccd601cd894fdd10bdae5f25d692b02f37be83517` | `74e4a1860f1b78403f57f8e3650109dd0086abd6` | 59 |
| `00041` | `database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql` | `9a1e0194dcfebde50e031c63fd3701b9b6c7cbed712f9968c646bd83976ab3cf` | `ebf648c583843e3172e8c99f0a94150035f0d599` | 69 |

### 3.2 Why both, and why this order

| File | Plan role |
|------|-----------|
| `#18` `20260626150625_…` | Creates `public.transport_buses`, ENABLE RLS, legacy `buses_school_rw`, client DML grants |
| `#32` `20260904010000_…` | Replaces `buses_school_rw` with four scoped policies; revokes TRUNCATE/TRIGGER/REFERENCES |
| `#59` `20261002000014_…` | Drops all five known policy names; `REVOKE ALL` from `anon` / `authenticated` / `PUBLIC`; `GRANT ALL` to `service_role`; `DO` guard requires **zero** remaining policies |
| `#69` `20261003000041_…` | `FORCE ROW LEVEL SECURITY`; `GRANT SELECT` to `authenticated`; `CREATE POLICY transport_buses_select_driver_assigned … USING (driver_id = auth.uid())`; `DO` guard requires **exactly that one SELECT policy**, SELECT-only authenticated grants, FORCE on |

`00041` is the successor posture of `00014`, not a substitute. On a
greenfield apply that also runs `#32`, `00041`’s guard is expected to
**fail** unless `00014` has already zeroed policies and client DML grants.
`GRANT SELECT` does not strip leftover INSERT/UPDATE/DELETE; only
`00014`’s `REVOKE ALL` produces the grant set `00041` asserts.

No later canonical file after `#69` references `transport_buses` or these
policy names. `#70` / `#71` are independent.

### 3.3 What OPTION A does **not** do

- It does **not** un-freeze V2 device/IoT (AGENTS.md §45). The `v2` token
  in the `00014` filename is a Git naming artifact on V1 Scholar table
  `public.transport_buses`.
- It does **not** make parent tracking, admin fleet DML, or driver
  GPS/status **writes** succeed. Those remain denied after `#69` (T-D
  remainder). Driver **read** (`getMyDriverBus`) is the intended client
  SELECT.
- It does **not** authorize `scripts/apply-canonical-hardening.mjs` as the
  empty-staging runner. That marshal **unconditionally SKIPs** `00014`
  because `declared.supersededBy` points at `00041`, then would attempt
  `00041` and fail the guard on a database that still has `#32` policies.
- It does **not** treat SQL headers (`AUTHORED, NOT APPLIED`) or
  `CANONICAL_APPLY_RECORD_HARDENING.json` (`APPLIED_AND_VERIFIED`) as live
  staging or production history.

### 3.4 Rejected alternatives (plan)

| Option | Plan status |
|--------|-------------|
| B — skip both | **Rejected** for a Git-complete `d195ba8` staging baseline. Would leave `#32` helper policies and would not match the 71-file tree. |
| C — hold both | **Rejected** as the restore-plan decision. Holding is operationally identical to B on a 69-file apply. |
| Skip only `00014` | **Forbidden.** `00041` expected to fail closed. |
| Skip only `00041` | **Forbidden.** Zero-policy; driver read dead; posture JSON / T-D tests expect `#69`. |

---

## 4. Proposed migration sequence (do not execute)

Authoritative directory: `database/supabase/migrations/`
Count: **71**
Order: lexicographic filename order (same as `scripts/db-apply.mjs` `.sort()`
on `*.sql` names).

**Include all 71.** Transport pair included. Proposed SQL excluded.

| # | Filename | Class | Primary objects / change | Staging notes |
|--:|----------|-------|--------------------------|---------------|
| 1 | `20260620122048_50e590c2-5911-4c98-8931-fb46a4b509f3.sql` | SCHOLAR | ~31 tables (`schools`,`users`,`fees`,`students`,…); helpers; `tenant_all_*`; broad GRANTs | **SHERIVS-001/002/003 source.** `CREATE TABLE` not IF NOT EXISTS — not re-runnable. |
| 2 | `20260620122110_178748dc-376f-4c78-911d-ec879dfffce1.sql` | AUTHZ | Recreates helpers | Later DEFINER files supersede in part |
| 3 | `20260620123741_7e8b6a59-b1d0-4885-bcfb-ae0dd2dac64e.sql` | SCHOLAR | Functions + GRANT incl. anon | Public-read surface |
| 4 | `20260620131046_25e754bd-c51f-409e-90f1-74b622794197.sql` | SCHOLAR | `qr_tokens` columns; fee indexes | Additive |
| 5 | `20260620150249_aeff3a12-2619-4cc9-aa0f-a7f5a844e8f3.sql` | AUTHZ | Policies; DROP POLICY | |
| 6 | `20260620151525_b630392a-2197-480f-b1cb-99da6c869c81.sql` | AUTHZ | DEFINER helpers | |
| 7 | `20260620163221_afd596f8-c5bc-4f1d-8bf0-fd8a2a409d14.sql` | SCHOLAR | `ALTER PUBLICATION supabase_realtime ADD TABLE attendance` | Needs vendor publication |
| 8 | `20260622044140_557cda0e-ae5c-4abc-b1ef-51ea89d09ff5.sql` | AUTHZ | Replace `tenant_all_messages/notifications` | |
| 9 | `20260623054451_c6c2ad41-5c74-4c10-9920-f6ef5546d4e6.sql` | SCHOLAR | `notification_preferences`; publication; `UPDATE messages.thread_id` | Empty staging ⇒ 0 row updates |
| 10 | `20260623054511_8244a074-f5e6-41b8-8d3e-44bd6d2c7e12.sql` | AUTHZ | Policies | |
| 11 | `20260624115701_d5ee45b9-21af-42a5-b99b-4ae1a1eb7a46.sql` | SCHOLAR | Replica identity + realtime `attendance_logs` | DO-guarded ADD TABLE |
| 12 | `20260626111823_66d215f2-2628-4490-93eb-0379825258b9.sql` | SCHOLAR+CATALOG | `school_api_keys`,`platform_config`,`news_reads`; INSERT pricing | Catalog `ON CONFLICT DO NOTHING` |
| 13 | `20260626130344_f04aa837-2b27-4111-8b1d-0c46287a1bb3.sql` | SCHOLAR | `notification_preferences` quiet-hours columns | Additive |
| 14 | `20260626131711_e05e2ec4-e2d0-4a0e-a905-fe22ea9a3401.sql` | AUTHZ | DROP `tenant_all_*` on audit/TPP/webhooks/qr | |
| 15 | `20260626133221_e95464b7-e864-413c-a934-7428cb26da47.sql` | SCHOLAR | Digital twin + admissions; GRANT incl. anon | V1 Scholar tables, not V3 implementation |
| 16 | `20260626133249_c712dcde-8e28-4f72-968d-a101b1bd5f7e.sql` | AUTHZ | Policies | |
| 17 | `20260626143528_139a8242-aefe-4b45-bd91-9b17351263bc.sql` | CATALOG | INSERT `platform_config.per_student_fees` `ON CONFLICT DO UPDATE` | Overwrites that catalog key on re-run |
| 18 | `20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql` | SCHOLAR | Transport/expenses/ads/`transport_buses` | Transport table created here |
| 19 | `20260626172336_78ce7dbb-cbb0-4186-b95c-cd8caea6cd95.sql` | SCHOLAR | UPDATE `schools.active_features` | Empty staging ⇒ 0 rows |
| 20 | `20260627090513_8cdbda3b-4bd0-4ac0-a4b5-0adfdc813790.sql` | SCHOLAR | Replica identity + realtime `transport_buses` | Idempotent ADD TABLE |
| 21 | `20260705002543_e6b3e3bb-6d5e-4783-97cd-39e875bece40.sql` | SCHOLAR | `school_staff`,`school_gallery`; GRANT SELECT **anon** on staff | Public faculty read |
| 22 | `20260707223958_421f2364-7989-4069-b78c-fd119f19daeb.sql` | AUTHZ | Storage policies for `school-media` | Bucket **row** comes at #68; policies may exist first |
| 23 | `20260707225659_58faa06f-1875-4a2b-8365-88a8473383f2.sql` | SCHOLAR | `SET statement_timeout=0`; UPDATE all schools to `enterprise`; DEFAULT enterprise | **Session GUC persists** on `db-apply` client; empty staging ⇒ 0 updates |
| 24 | `20260725063636_d379b679-904b-4d2a-b9ed-11b463817fda.sql` | SCHOLAR | Hostel/clinic/library/discipline + HR tables | **SHERIVS-003** surface |
| 25 | `20260725064521_96522167-55e3-4281-ae25-6180fe57369f.sql` | SCHOLAR | Admission status check constraint | Additive |
| 26 | `20260725065302_ddd47f8e-25ed-4581-84e8-658d1e38ecdb.sql` | SCHOLAR | `staff_payroll`,`staff_leave` | **SHERIVS-003** |
| 27 | `20260726085612_c410e01a-1b96-4b65-b539-0eb71556bb31.sql` | SCHOLAR | `student_platform_fee_ledger` | |
| 28 | `20260729052237_75252732-97d3-448f-b082-93517558a096.sql` | SCHOLAR | `teacher_biometrics` + policy `biometrics_school_isolation` | **SHERIVS-003**; FOR ALL-style |
| 29 | `20260729054314_21b2720c-0c44-46ce-8404-e256ce7cf4ee.sql` | SCHOLAR | IF NOT EXISTS same biometrics tables; second policy `school_isolation`; AI tables | Duplicate policy names **differ**; apply can succeed |
| 30 | `20260819000000_coregrid_harden_schools_and_realtime.sql` | AUTHZ | REVOKE `schools.paystack_secret_key` SELECT from clients; publication completeness | Vendor publication required |
| 31 | `20260903000000_coregrid_universal_kernel_substrate.sql` | V1-SUB | `cg_entity` family; REVOKE client; GRANT service_role | |
| 32 | `20260904010000_coregrid_rls_transport_and_grants.sql` | AUTHZ | Four scoped bus policies; REVOKE TRUNCATE on buses/`users` | Intermediate transport posture; later removed by #59 |
| 33 | `20260904020000_coregrid_l2_identity_tenancy.sql` | V1-SUB | `cg_identity`,`cg_tenant` | |
| 34 | `20260907000000_coregrid_workforce_kind_substrate.sql` | V1-SUB | `cg_workforce_kind`,`cg_workforce_position` | Prod ref in comment only |
| 35 | `20260907000100_runtime_scholar_workforce_catalog.sql` | CATALOG | INSERT `cg_domain_runtime`,`cg_workforce_kind` | Reference catalog, not PII |
| 36 | `20260907000300_coregrid_workforce_position_rpc.sql` | V1-SUB | DEFINER RPCs | DML in **function bodies** |
| 37 | `20260907000400_coregrid_self_primary_position_rpc.sql` | V1-SUB | RPC | |
| 38 | `20260907000500_coregrid_end_position_promotion.sql` | V1-SUB | RPC | |
| 39 | `20260907000600_runtime_scholar_workforce_ecosystem_extension.sql` | CATALOG | more `cg_workforce_kind` INSERTs | |
| 40 | `20260907000700_coregrid_org_profile_substrate.sql` | V1-SUB | `cg_org_profile` + RPCs | |
| 41 | `20260907000800_coregrid_role_assignment_substrate.sql` | V1-SUB | `cg_role_assignment`,`cg_role_grant` | Needed by later `#58` |
| 42 | `20260929000000_coregrid_foundation_mission_001.sql` | V1-SUB | mission/evidence tables | Header NOT APPLIED ≠ omit |
| 43 | `20260930000000_coregrid_v1_workspace_persistence.sql` | V1-SUB | `cg_workspace*` | |
| 44 | `20261001000000_coregrid_v1_org_model.sql` | V1-SUB | `cg_org_unit`,`cg_org_membership` | |
| 45 | `20261002000000_coregrid_v1_kernel_envelope.sql` | V1-SUB | Additive envelope columns on kernel tables | Depends on #31 |
| 46 | `20261002000001_coregrid_v1_neutral_tenant_primitives.sql` | V1-SUB | `get_my_tenant_id` / `is_tenant_admin` + RPCs | Later policies depend on these |
| 47 | `20261002000002_coregrid_v1_worker_definitions.sql` | V1-SUB | worker tables; REVOKE client | |
| 48 | `20261002000003_coregrid_v1_kernel_bitemporal.sql` | V1-SUB | function | |
| 49 | `20261002000004_coregrid_v1_memory_tier.sql` | V1-SUB | memory tables | |
| 50 | `20261002000005_coregrid_v1_reconciliation.sql` | V1-SUB | reconciliation tables | |
| 51 | `20261002000006_coregrid_v1_event_security.sql` | V1-SUB | event security tables | |
| 52 | `20261002000007_coregrid_v1_event_routing.sql` | V1-SUB | routing tables | |
| 53 | `20261002000008_coregrid_v1_evidence_lifecycle.sql` | V1-SUB | evidence tables | |
| 54 | `20261002000009_coregrid_v1_reasoning_provenance.sql` | V1-SUB | provenance | |
| 55 | `20261002000010_coregrid_v1_cost_attribution.sql` | V1-SUB | cost tables | |
| 56 | `20261002000011_coregrid_v1_knowledge_currency.sql` | V1-SUB | knowledge tables | |
| 57 | `20261002000012_coregrid_v1_tool_runtime.sql` | V1-SUB | tool runtime | |
| 58 | `20261002000013_coregrid_v1_neutral_membership_policies.sql` | AUTHZ | FORCE RLS + policies on cg membership tables | Prod ref in comment; `CREATE POLICY` not generally re-runnable |
| 59 | `20261002000014_coregrid_v2_transport_buses_rls.sql` | AUTHZ **INCLUDED** | Drop 5 bus policies; REVOKE client; GRANT service_role; zero-policy guard | **OPTION A first half.** Fail-closed if any policy remains. |
| 60 | `20261002000015_coregrid_v1_substrate_policies.sql` | AUTHZ | FORCE RLS + policies on selected `cg_*` tables | Does **not** touch `transport_buses` |
| 61 | `20261003000016_coregrid_v1_file_substrate.sql` | V1-SUB | `cg_file_object` FORCE RLS | |
| 62 | `20261003000017_coregrid_v1_idempotency_substrate.sql` | V1-SUB | `cg_idempotency_record`; prune fn contains DELETE | DELETE is **function body**, not apply-time wipe |
| 63 | `20261003000018_coregrid_v1_idempotency_privilege_revoke.sql` | AUTHZ | REVOKE/GRANT idempotency | Compensates default ACLs |
| 64 | `20261003000019_coregrid_v1_mission_lease.sql` | V1-SUB | lease/quarantine tables | Comments mention DROP TABLE as **rollback**, not forward |
| 65 | `20261003000020_coregrid_is_super_admin_definer.sql` | AUTHZ | `CREATE OR REPLACE is_super_admin` SECURITY DEFINER | Required to avoid `54001` recursion. Include. |
| 66 | `20261003000030_coregrid_hermes_observation_substrate.sql` | V1-SUB | `cg_hermes_observation` deny-by-default | Observation **substrate table** already on `master`; not a V3 un-freeze |
| 67 | `20261003000031_coregrid_delivery_evidence.sql` | V1-SUB | `cg_delivery_evidence` | |
| 68 | `20261003000040_coregrid_school_media_bucket.sql` | CATALOG | INSERT `storage.buckets` `school-media` | Metadata only; no object copy |
| 69 | `20261003000041_coregrid_transport_bus_reads.sql` | AUTHZ **INCLUDED** | FORCE RLS; GRANT SELECT authenticated; driver SELECT policy; exact-posture guard | **OPTION A second half.** Not idempotent (`CREATE POLICY` without IF NOT EXISTS). |
| 70 | `20261008000050_coregrid_organization_memberships.sql` | SCHOLAR | `organization_memberships`; FORCE RLS; sync trigger; backfill FROM `users` | Absent from default branch. Empty staging ⇒ 0 backfill rows |
| 71 | `20261008000060_organization_onboarding.sql` | SCHOLAR | `create_organization_with_founder` DEFINER | Absent from default branch. **Include function. Do not CALL during apply.** |

**Filename collisions:** none.
**Approximate unique `CREATE TABLE` names (static):** **121**.

Headers (`AUTHORED, NOT APPLIED` / `APPLIED + VERIFIED`) describe
**claimed** historical apply status in Git comments. They are **not** a
production or staging catalog. Canonical membership is determined by
presence in the 71-file tree, not by those headers.

---

## 5. Migrations requiring explicit human review before application

No canonical file is omitted from the sequence. The following require
**written acknowledgement** in the restore-authorization record because of
security, fail-closed guards, vendor coupling, or session/data effects.

### 5.1 Whole-plan acknowledgement (required)

The human authorizes **all 71 files** at `d195ba8` / tree `bbd82895…`
against staging `dvxszhracsjwdancijdc` only, knowing SHERIVS-001/002/003
defaults will exist afterward.

### 5.2 Heightened review (still included)

| Seq | File | Why review is required |
|----:|------|------------------------|
| 1 | foundation `20260620122048_…` | Creates `users.role` / `school_id` / `is_active` writability, `tenant_all_*` FOR ALL, sensitive `users` columns, `schools.paystack_secret_key`. **SHERIVS-001/002/003.** Not re-runnable. |
| 3, 15, 18, 21 | GRANT-to-anon files | Public read of marketing / staff / selected Scholar objects |
| 7, 9, 11, 18, 20, 30 | realtime publication | Require vendor `supabase_realtime`; failure stops apply |
| 22 then 68 | storage policies then bucket row | Order is filename-correct; bucket insert talks to `storage.buckets` |
| 23 | enterprise backfill | Apply-time UPDATE of `schools`; `SET statement_timeout = '0'` is **session-level** and persists on a long-lived `db-apply` client |
| 24, 26, 28, 29 | HR / payroll / biometrics | **SHERIVS-003**; #28 and #29 can both install policies |
| 32 then 59 then 69 | transport triple | OPTION A accepted; still the fail-closed pair. `#69` not idempotent. |
| 58, 60, 69, 70 | FORCE RLS files | Authorization posture changes; `#58`/`#69` policies generally lack IF NOT EXISTS |
| 65 | `is_super_admin` DEFINER | Privileged helper; required for recursion fix |
| 70 | memberships backfill | INSERT FROM `users`; FORCE RLS; missing on default branch |
| 71 | founder RPC | SECURITY DEFINER; must not be invoked during schema apply |

### 5.3 Not a reason to omit

- Header `AUTHORED, NOT APPLIED`
- V2 token in `00014` filename
- Encoding of OPEN RLS findings
- Presence of companion rollback SQL (rollbacks are **not** an apply path)

---

## 6. Migration safety inventory (all 71)

Static parse: comments stripped, dollar-quoted bodies treated as opaque,
statements split on `;` outside quotes. Function bodies can contain
INSERT/UPDATE/DELETE that **do not run at apply time**. This inventory
does not execute SQL.

Legend — **Suitability** is for an **empty** staging project matching the
Gate 4 historical catalog, after a **fresh** preflight. It is not a live
proof.

### 6.1 Cross-cutting facts

| Topic | Finding |
|-------|---------|
| Objects created | ~121 public tables (union of `CREATE TABLE` / `IF NOT EXISTS` names), plus functions, policies, triggers, indexes, one `storage.buckets` row (`school-media`), catalog rows in `platform_config` / `cg_workforce_kind` / `cg_domain_runtime` |
| Dependencies | Filename order. Scholar tables before policies. `#18` before transport pair. `#31` before envelope `#45`. `#41`/`#44`/`#46` before `#58`. `#62` before `#63`. Vendor: `pgcrypto`/`uuid-ossp` (used; never `CREATE EXTENSION`), `auth.uid()`, `storage.buckets`, publication `supabase_realtime` |
| Destructive DDL | No statement-start `DROP TABLE` / `TRUNCATE` / `DROP SCHEMA` / `DROP DATABASE`. `DROP POLICY` in #5, #8, #12, #14, #32, **#59**. `DROP CONSTRAINT IF EXISTS` in #25. Column REVOKE in #30 |
| Data backfills | Apply-time: #9 thread_id, #12/#17 platform_config, #19 school features, **#23 enterprise tier**, #35/#39 workforce catalog, #68 bucket metadata, #70 memberships FROM users. Empty tables ⇒ 0 people/payment rows. #23 still changes column DEFAULT |
| Environment-specific assumptions | Comments naming production ref are **not** SQL. `config.toml` `project_id` is production (CLI hazard). #23 `statement_timeout=0` is session GUC. Default ACLs on staging (historical) grant ALL on future public tables unless a file REVOKEs |
| Grants / RLS | Foundation installs broad authenticated DML + FOR ALL. Later V1 files often ENABLE RLS and REVOKE clients on `cg_*`. Vendor `ensure_rls` event trigger ENABLES RLS on new public tables and does **not** FORCE. `postgres` / `service_role` BYPASSRLS (vendor). FORCE RLS: #58, #60, #61, #62, #69, #70 |
| Reversibility | **Not** a 71-file transaction. Companion rollbacks exist for **31** later files only (from `20260907000800` through `20261008000060`, including both transport files). Foundation Scholar tables have **no** rollback SQL. Transport `#59` rollback re-creates J-005-banned helper policies — a security regression needing separate authorization |
| Staging suitability | **Suitable as Git-complete schema restore onto an empty isolated staging project** after preflight and a staging-only runner. **Unsuitable** as a security-oracle close of SHERIVS-001/002/003. **Unsuitable** if staging is no longer empty |

### 6.2 Per-file compressed risk rows

Columns: **Dep** = principal dependency; **Dest** = destructive/authorization-destructive; **Data** = apply-time DML; **Env** = environment assumption; **RLS/GRANT**; **Rev** = reversibility; **Suit** = empty-staging suitability.

| # | Dep | Dest | Data | Env | RLS/GRANT | Rev | Suit |
|--:|-----|------|------|-----|-----------|-----|------|
| 1 | empty `public` + `gen_random_uuid` | none DDL-drop | none | uuid extension | Broad DML + `tenant_all_*` + sensitive columns | **No rollback file** | Include; security-weak |
| 2 | #1 helpers | replace fn | none | — | helper rewrite | no file | Include |
| 3 | #1 | — | none | — | GRANT anon | no file | Include; public read |
| 4 | #1 `qr_tokens`,`fees` | — | none | — | — | no file | Include |
| 5 | #1 | DROP POLICY | none | — | new policies | no file | Include |
| 6 | #1 | — | none | — | DEFINER | no file | Include |
| 7 | #1 `attendance` + `supabase_realtime` | — | none | **vendor publication** | — | no file | Include; stop if publication missing |
| 8 | #1 | DROP POLICY | none | — | replace tenant_all on messages/notifications | no file | Include |
| 9 | #1 | — | UPDATE `messages` | publication | ENABLE RLS + GRANTs | no file | Include; 0 rows if empty |
| 10 | #9 | — | none | — | policies | no file | Include |
| 11 | `attendance_logs` | — | none | publication DO | — | no file | Include |
| 12 | #1 | DROP POLICY | INSERT catalog | — | ENABLE RLS | no file | Include |
| 13 | #9 | — | none | — | — | no file | Include |
| 14 | #1 | DROP POLICY `tenant_all_*` | none | — | tighter on audit/TPP/webhooks/qr | no file | Include |
| 15 | #1 | — | none | — | GRANT anon | no file | Include |
| 16 | #15 | — | none | — | policies | no file | Include |
| 17 | #12 `platform_config` | overwrite catalog key | INSERT ON CONFLICT UPDATE | — | — | no file | Include |
| 18 | #1 | — | fn-body seed only | publication | many GRANTs + `buses_school_rw` | no file | Include |
| 19 | #1 `schools` | — | UPDATE features | — | — | no file | Include; 0 rows if empty |
| 20 | #18 | — | none | publication DO | — | no file | Include |
| 21 | #1 | — | none | — | GRANT SELECT anon on staff | no file | Include; public faculty |
| 22 | `storage.objects` + helpers | — | none | storage schema | school-media policies (anon read included) | no file | Include before bucket row |
| 23 | #1 `schools` | session `statement_timeout=0` | UPDATE all schools → enterprise | **GUC persists on apply client** | — | no file | Include; 0 updates if empty; DEFAULT changes |
| 24 | #1 | — | none | — | HR GRANTs | no file | Include; SHERIVS-003 |
| 25 | admissions table | DROP/ADD CHECK | none | — | — | no file | Include |
| 26 | #1 | — | none | — | payroll/leave RLS + GRANTs | no file | Include; SHERIVS-003 |
| 27 | #1 | — | none | — | ledger RLS | no file | Include |
| 28 | #1 | — | none | — | biometrics FOR ALL-style | no file | Include; SHERIVS-003 |
| 29 | #28 tables IF NOT EXISTS | second policy | none | DO | more GRANTs | no file | Include; dual policies possible |
| 30 | #1 `schools` | column REVOKE | none | publication DO | paystack_secret_key hidden from clients | no file | Include |
| 31 | empty + extensions | — | none | — | REVOKE client; GRANT service_role; ENABLE RLS | rollback later era only | Include |
| 32 | #18 | DROP `buses_school_rw` | none | — | four scoped bus policies; REVOKE TRUNCATE | no file | Include; later removed by #59 |
| 33 | #31 | — | none | — | ENABLE RLS; REVOKE client | later rollback era | Include |
| 34–41 | prior `cg_*` | — | catalog INSERTs in #35,#39; RPC DML in bodies | prod ref **comments** | ENABLE RLS; GRANTs to service/authenticated per file | #41 has rollback | Include |
| 42–57 | prior `cg_*` / #31 | — | none apply-time (except fn bodies) | headers NOT APPLIED | typical REVOKE client + ENABLE RLS | **31-file rollback set covers most of these** | Include; do not omit for header |
| 58 | #41,#44,#46 | — | none | prod comment | FORCE RLS + policies | has rollback | Include; not re-runnable if policies exist |
| 59 | #18, #32 | DROP 5 policies; REVOKE ALL client | none | fail-closed `DO` | zero-policy; service_role ALL | has rollback (**banned helpers**) | **Include (OPTION A)** |
| 60 | #50–#55 tables | — | none | — | FORCE RLS + policies | has rollback | Include |
| 61 | — | — | none | — | FORCE RLS | has rollback | Include |
| 62 | — | DELETE in prune **fn** | none apply-time | — | FORCE RLS | has rollback | Include |
| 63 | #62 | REVOKE | none | default ACLs | GRANT hygiene | has rollback | Include |
| 64 | — | — | none | — | ENABLE RLS; REVOKE | has rollback | Include |
| 65 | #1/`#2` `is_super_admin` | replace fn | none | — | DEFINER | has rollback | Include |
| 66–67 | — | — | none | — | deny-by-default substrate | has rollback | Include (V1 files on master) |
| 68 | `storage.buckets` | — | INSERT bucket | storage vendor | — | has rollback | Include; no object copy |
| 69 | **#59 must have run** after #32 | CREATE POLICY (no IF NOT EXISTS) | none | fail-closed `DO` | FORCE RLS; SELECT-only authenticated | has rollback (restores zero-policy) | **Include (OPTION A); apply once** |
| 70 | #1 `users` | — | INSERT FROM users | missing on default branch | FORCE RLS | has rollback | Include; 0 backfill if empty |
| 71 | #70 + helpers | — | none unless RPC called | missing on default branch | DEFINER founder fn | has rollback | Include fn; **do not call** |

### 6.3 Effects that cannot be established statically

| Item | Why static analysis is insufficient |
|------|-------------------------------------|
| Live staging emptiness | Gate 4 catalog is **historical** (2026-10-14T18:34:55Z). This mission did not reopen staging. |
| Production applied-subset | Headers, apply-record JSON, and posture JSON contradict each other. Production must not be opened. Matching production is **not** this plan. |
| `ensure_rls` event trigger | Historical catalog documents ENABLE-without-FORCE on new public tables. Runtime of the trigger was not invoked here. |
| Default ACL interaction | Historical staging default ACL ALL for anon/authenticated on future tables. Which grants remain after each file is catalog-after-apply work. |
| Session GUC leak (#23) | `SET statement_timeout=0` persists for later files **if** the runner keeps one session (true of `db-apply.mjs`). A different runner might not. |
| Implicit per-file transaction | `client.query(entire file)` uses PostgreSQL simple-query semantics. A `DO` `RAISE EXCEPTION` should abort that file. Files with internal `COMMIT`/`BEGIN` (present inside some function/DO text) are **not** proven as a single implicit transaction for every file. **No** cross-file transaction exists. |
| Duplicate biometric policies | SQL allows both policy names. Live `pg_policy` after apply is a catalog fact. |
| Repeat-run | Foundation `CREATE TABLE` without IF NOT EXISTS will fail. `#69` `CREATE POLICY` will fail if the policy exists. Static parse cannot prove every file is idempotent. |
| Function-body DML | Parser can confuse body text with apply-time DML. This mission treated dollar-quoted bodies as opaque and grepped statement-start DML separately; residual uncertainty remains on unusual quoting. |
| IPv6 vs pooler | Gate 4: direct `db.<ref>` was IPv6-only and unreachable from the Cloud Agent VM. That network fact was not re-tested here. |

---

## 7. Execution-mechanism review (scripts not run)

All statements below are from **reading** Git at `d195ba8` (scripts on
HEAD are byte-identical for `db-apply.mjs`, `db-apply-one.mjs`,
`db-apply-mgmt.mjs`, `scripts/lib/pg-ssl.mjs`). **No script was executed.**

### 7.1 `scripts/db-apply.mjs` — current 71-file path, **unsafe for this restore**

| Question | Finding |
|----------|---------|
| Target selection | **`process.env.DATABASE_URL` only.** No `STAGING_*`. No harness import. |
| Unprefixed `DATABASE_URL` | **Required.** Environment-separation audit: in the operator VM this name has historically been **production**. |
| Production fallback | If `DATABASE_URL` is unset, exit 2 (does not fall back to another name). If it **is** set to production — **applies to production**. Absence of fallback is not isolation. |
| Target validation | **None.** No project-ref check, no hostname allow-list, no refuse-production. |
| Strict TLS | Uses `pgSslConfig(dbUrl)`. Default `{ rejectUnauthorized: true }`. `COREGRID_DB_CA_CERT` pins CA. **`COREGRID_DB_INSECURE_TLS=1` sets `rejectUnauthorized: false`.** `sslmode=disable` / `ssl=false` in the URL disables TLS entirely. Does **not** read `SUPABASE_CA_CERT`. |
| Transaction behavior | One `client.query(sql)` per file on a **single long-lived client**. Files commit independently. `#23` session GUC leaks forward. |
| Partial failure | `break` on first error; remaining files not applied. Error message printed. Process exit 1. |
| Abort log bug | Prints `Aborted after ${files.length} migrations` using the **list length (71)**, not how many succeeded. |
| Migration-history recording | **None.** Does not create or insert `supabase_migrations.schema_migrations`. |
| Repeat-run | Re-reads and re-executes **every** `*.sql` in the **working tree** directory. Foundation `#1` is expected to fail on a second run. |
| Filename ordering | `readdirSync` + `.endsWith(".sql")` + `.sort()`. Correct lexicographic order **of whatever tree is checked out**. |
| Working-tree trap | If invoked from `coregrid-scholar-migration`, it would apply **69** files and **omit #70 and #71**. Restore must pin `d195ba8` blobs, not HEAD of the default branch. |
| Logging / secrets | Logs `OK`/`FAIL` + filename + `err.message`. Connection string is not printed. PostgreSQL error text can include query fragments; operators must treat FAIL logs as sensitive. |
| `.sql.proposed` | Not in this directory glob. Safe **unless** someone copies proposed files into `database/supabase/migrations/`. |

**Verdict:** do **not** use `scripts/db-apply.mjs` as-is for staging restore.
Do **not** modify it in this mission.

### 7.2 Other mechanisms — refuse for this restore

| Script / tool | Why refuse |
|---------------|------------|
| `scripts/db-apply-one.mjs` | Same unprefixed `DATABASE_URL`. No harness. Not a 71-file runner. `--dry-run` is file-only (not used here). |
| `scripts/db-apply-mgmt.mjs` | `projectRef = argv[2] ?? "nwrflbpbhyiqdptmlccm"` — **production default**. Management API mutate. No history table. |
| `scripts/db-run.mjs` / `db-run-mgmt.mjs` | Arbitrary SQL via `DATABASE_URL` or mgmt API. |
| `scripts/apply-canonical-hardening.mjs` | Production argv default. **SKIP `00014`** as superseded. Empty-staging Option A **fails**. `--manifest` is offline (not run in this mission). |
| `scripts/apply-canonical-mr100.mjs` | Production argv default; subset apply. |
| `scripts/apply-approved-v1-migrations.mjs` | Production argv default; two-file subset. |
| `scripts/apply-foundation-migration.mjs` | Production argv default; one file. |
| `scripts/apply-foundation-from-env-local.mjs` | **Hard-coded production ref.** Can `POST /v1/projects/{prod}/restore` (unpause). Forbidden. |
| `scripts/apply-campaign52-recommended-batch.mjs` / banner/classification appliers | Not a 71-file Scholar restore. |
| `supabase db push --workdir database/supabase` | `database/supabase/config.toml` `project_id = "nwrflbpbhyiqdptmlccm"`. Records CLI history **if** linked to the **linked** project — production unless explicitly re-linked. |
| `supabase db reset` / `supabase start` | Destructive / local. Forbidden. |

Staging harness `scripts/staging/sherivs-rls-prep/assert-not-production.mjs`
exists on the Gate 4 document chain (blob `af6cadbf…`), **not** on
`origin/master` / this HEAD. It **never connects**. It fail-closes on the
production ref and production host markers. It does **not** positively
require `dvxszhracsjwdancijdc`. It does **not** refuse a set unprefixed
`DATABASE_URL`. It is **not** imported by `db-apply.mjs`.

`catalog-verify.sql` is a **post-remediation** proof (freeze helpers, no
`tenant_all_%`). It is the **wrong** pass/fail tool for post-restore of
the live canonical baseline.

### 7.3 Requirements for a future staging-only runner

Do **not** implement these in this mission. A later authorized engineering
mission must satisfy:

1. **Pin** migration bytes to `d195ba8` tree `bbd828951e166662bbe831fd74972e1a15488468` (or a subsequently authorized identical tree). Refuse to run from a 69-file working tree.
2. **Read connection material only from staging-prefixed names** (`STAGING_DATABASE_URL` and/or `SHERIVS_RLS_STAGING_URL`). Never read `DATABASE_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` as the apply target.
3. **Refuse to start** if unprefixed `DATABASE_URL` or `SUPABASE_URL` is set in the apply process, or if any target string contains `nwrflbpbhyiqdptmlccm`.
4. **Positively require** project ref `dvxszhracsjwdancijdc` in hostname and (when pooled) in username (`postgres.dvxszhracsjwdancijdc`).
5. Run the production-refusal harness **and** the positive staging-identity checks in §8 **before** opening a mutating session.
6. TLS: `rejectUnauthorized: true` plus pinned CA (`COREGRID_DB_CA_CERT`). Refuse `COREGRID_DB_INSECURE_TLS=1` and refuse `sslmode=disable`.
7. Apply **all 71** files in filename order, including both transport files. Do not use the hardening marshal skip logic.
8. Stop on first failure. Log succeeded count **and** failed filename. Do not print secrets or full connection strings. Redact passwords in any target evidence.
9. Do not apply `*.sql.proposed`. Do not apply `database/supabase/rollbacks/`. Do not call `create_organization_with_founder`.
10. Record apply history with a **documented staging-only** method (CLI history only after the CLI is linked to staging, or an explicit recorder). Do not claim `supabase_migrations` exists if it was not written.
11. Do not keep using the same session for unrelated operator SQL after apply. If session GUCs are changed (#23), record that in the apply log.
12. Human written authorization artifact must be present before connect.

Until that runner exists, restore execution stays blocked even though this
**plan** is finalized.

---

## 8. Target isolation — future preflight (read-only, then mutate only if authorized)

A future restore mission must complete this preflight **before** any
mutating SQL. This mission does **not** run it.

### 8.1 Positive staging identity

1. Parse the candidate URL(s). Hostname or username must contain
   `dvxszhracsjwdancijdc`.
2. Auth health (if used) must return header `sb-project-ref:
   dvxszhracsjwdancijdc` using **staging-prefixed** anon/publishable key
   only (method from GATE4-CATALOG-BASELINE-001).
3. Direct host `db.dvxszhracsjwdancijdc.supabase.co` **or** session pooler
   whose username is `postgres.dvxszhracsjwdancijdc`. If pooler is used,
   prove it reached the staging instance (Gate 4 used `inet_server_addr`
   matching the staging AAAA). Do not mix production pooler host with
   staging password or vice versa.
4. `current_database` expected `postgres`; record `server_version`.

### 8.2 Production rejection

1. Reject if any target string, hostname, username, or header contains
   `nwrflbpbhyiqdptmlccm`.
2. Reject production host markers used by the existing harness
   (`nwrflbpbhyiqdptmlccm.supabase.co`, `www.sherivs.com`, `app.sherivs.com`,
   `console.sherivs.com`, and the production apex as currently listed).
3. Existing harness is **necessary but not sufficient** (it does not
   require the staging ref).

### 8.3 Staging-specific credentials only

Allowed names (values never printed):

- `STAGING_DATABASE_URL`
- `STAGING_SUPABASE_URL`
- `SHERIVS_RLS_STAGING_URL`
- `STAGING_SUPABASE_PUBLISHABLE_KEY` / `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `COREGRID_DB_CA_CERT` (TLS pin)

Forbidden as apply/catalog target or fallback:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ACCESS_TOKEN` used with default production project ref
- `SUPABASE_PROJECT_ID` implying production

### 8.4 Ambiguous / missing configuration

Refuse if:

- No staging-prefixed URL is set
- Multiple staging URL names disagree on project ref
- Unprefixed production names are present in the apply process
- Project ref is neither staging nor production (third project)
- CA pin missing while the endpoint requires the managed CA
- Operator cannot state Git pin `d195ba8` / tree `bbd82895…`

### 8.5 Strict TLS and no production fallback

- `rejectUnauthorized: true`
- Pinned CA
- No `COREGRID_DB_INSECURE_TLS`
- No `sslmode=disable`
- No “if staging URL missing, use `DATABASE_URL`”
- Prefer deleting unprefixed URL names from the apply process (Gate 4
  inspector pattern) rather than hoping scripts ignore them

### 8.6 Fresh emptiness / drift check (read-only)

Under `default_transaction_read_only=on` after identity proof:

- Expect no Scholar `public` tables **or** stop and re-plan
- Expect `supabase_migrations` schema absent **or** document unexpected history
- Confirm `pgcrypto`, `uuid-ossp`, publication `supabase_realtime`
- Do not query `auth.users` contents, `storage.objects` contents, or PII columns

If Scholar objects now exist, **stop**. Recreate-vs-continue is a new
human decision. Do not dump production to “fix” drift.

### 8.7 Redacted target evidence to record

Record, without secrets:

- Project ref string
- Hostname (password stripped)
- Whether pooler or direct
- `sb-project-ref` header if Auth was used
- `inet_server_addr` / `server_version` / `current_user` (role name only)
- Git commit + full migration tree hash
- Harness exit code
- TLS: `rejectUnauthorized` true; CA present yes/no (not the PEM)
- Confirmation that unprefixed `DATABASE_URL` was unset/refused

---

## 9. Baseline vs remediation; findings remain OPEN

### 9.1 Canonical vs proposed

| Set | Path | In staging restore? |
|-----|------|---------------------|
| Canonical 71 | `database/supabase/migrations/*.sql` at `d195ba8` | **YES** (plan) |
| Proposed RLS | `docs/security/rls-prep/proposed-sql/*.sql.proposed` | **NO** |

Proposed files (exclude):

- `20261015000010_sherivs_authz_helpers_active.sql.proposed`
- `20261015000020_sherivs_admin_hr_rpcs.sql.proposed`
- `20261015000030_sherivs_users_identity_freeze.sql.proposed`
- `20261015000040_sherivs_users_sensitive_column_revoke.sql.proposed`
- `20261015000045_sherivs_rls_payroll_biometrics.sql.proposed`
- `20261015000050_sherivs_rls_wave_a_classes_calendar_timetable.sql.proposed`
- `20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql.proposed`
- `20261015000070_sherivs_fees_settlement_and_rls_wave_c.sql.proposed`
- `20261015000080_sherivs_rls_grant_hygiene.sql.proposed`
- `20261015000090_sherivs_users_force_rls.sql.proposed`

`00070` remains Gate-3 blocked until a Paystack companion. `00090` remains
ineligible until founder+DEFINER staging exists **after** restore. None of
that is in this baseline.

### 9.2 Canonical restore creates known weaknesses

That is expected. Restore the live Git schema first; remediate later on
staging after a **post-restore catalog**. Do not “fix” grants during
restore by editing canonical files.

| ID | Status | After a Git-complete restore |
|----|--------|------------------------------|
| SHERIVS-001 | **OPEN** | `users` self-update / admin FOR ALL identity writability **present** |
| SHERIVS-002 | **OPEN** | Broad authenticated DML and remaining `tenant_all_*` / FOR ALL **present** |
| SHERIVS-003 | **OPEN** | Sensitive `users` columns, `staff_payroll`, `teacher_biometrics` **present** |

This finalize mission does **not** claim those findings resolved.

### 9.3 Synthetic data is out of band

Catalog INSERTs inside canonical files (pricing, workforce kinds, bucket
metadata) **are** schema restore. Demo provision, e2e fixtures,
production dumps, and calling `create_organization_with_founder` are
**not**.

---

## 10. Recovery plan and stop conditions

### 10.1 Recreate staging as recovery

Because GATE4-CATALOG-BASELINE-001 recorded an empty default Supabase
project (no Scholar relations, no `supabase_migrations` schema),
**recreating the staging project is a viable recovery option** after a
failed or unwanted apply — **subject to a fresh preflight and explicit
authorization**.

This mission did **not** re-verify emptiness. Recreate is **not**
pre-authorized here. Recreate is also **not** a license to copy
production data into the new project.

Operator-owned snapshots / PITR were **not** verified.

### 10.2 Do not assume transactional reversibility

- The 71-file set is **not** one transaction.
- Per-file simple-query abort is **not** a proven undo of previously
  successful files.
- 31 rollback files cover later migrations only. Running them on a
  partial schema can fail. `#59` rollback is a **security regression**
  (restores banned helper policies).
- Foundation tables have no rollback SQL.
- `#69` is not idempotent; do not “retry just 00041” after a partial
  success of 00041’s earlier statements unless the runner guaranteed a
  single aborted transaction for that file.

**Practical recovery for partial failure: stop; do not continue the list;
do not apply proposed SQL; prefer recreate staging after authorization.**

### 10.3 Stop conditions (future apply)

Stop and do not continue if any of:

- Preflight harness ≠ 0
- Staging ref not positively proven
- Production ref present in any target
- Unprefixed `DATABASE_URL` / `SUPABASE_URL` would be used
- Git tree ≠ `bbd828951e166662bbe831fd74972e1a15488468` (unless a later
  human pin supersedes this plan)
- Working tree would omit #70/#71 or omit the transport pair
- Preflight shows unexpected Scholar objects
- Missing `pgcrypto` / `uuid-ossp` / `supabase_realtime`
- Any file FAILs
- Operator abort
- Any path would open production
- Attempt to include `*.sql.proposed`
- Attempt to use `apply-canonical-hardening.mjs` as the 71-file runner
- Attempt to `supabase db reset` or unpause/restore production via
  Management API

### 10.4 Independent post-restore verification (future read-only mission)

Do **not** use `catalog-verify.sql` as the baseline pass/fail.

After apply, a separately authorized staging-only read-only catalog must:

1. Re-prove staging identity (ref, hostname, TLS).
2. Count `public` tables/views/indexes vs Git-created names (~121 tables).
3. `to_regclass` for `users`, `schools`, `organization_memberships`,
   `students`, `fees`, `staff_payroll`, `teacher_biometrics`,
   `transport_buses`, and a `cg_*` sample.
4. List `pg_policy` on `users`, `fees`, `staff_payroll`,
   `teacher_biometrics`, `transport_buses`, `organization_memberships`.
5. Transport **must** match OPTION A: FORCE on; exactly one policy
   `transport_buses_select_driver_assigned`; authenticated SELECT-only;
   no `#32` four-policy set.
6. Helpers: `is_super_admin` SECURITY DEFINER (`#65`), `get_my_school_id`,
   `get_my_role`, `is_school_admin`, `create_organization_with_founder`
   present and **uncalled**.
7. `storage.buckets` contains `school-media`; do not dump `storage.objects`.
8. `platform_config` keys `subscription_tiers_pricing`, `per_student_fees`.
9. Document that authenticated DML on foundation tables **is present**
   (do not “fix”).
10. Migration history: absence of `supabase_migrations` is **not** proof of
    failure if relations exist and the runner did not record history.
11. No PII payload SELECTs (`users.nin`, salary, face templates).
12. Do **not** claim production parity. Do **not** claim SHERIVS-001/002/003
    closed.

Compare object **names** and transport posture to this plan. Then a later
mission may consider eligible proposed SQL.

---

## 11. Required approvals (before any mutating restore)

A human must explicitly authorize **all** of the following. This document
does not constitute that authorization.

1. Target = staging project `dvxszhracsjwdancijdc` only.
2. Git pin = `d195ba861f80379b79533126653b9cee82a8e872` / tree
   `bbd828951e166662bbe831fd74972e1a15488468`.
3. **OPTION A:** apply both transport files in filename order; omit
   neither.
4. Acceptance that SHERIVS-001 / 002 / 003 defaults will exist on staging
   until a later remediation mission.
5. Acceptance that parent/admin/driver-**write** bus surfaces will deny
   after `#69`.
6. A **staging-only runner** meeting §7.3 exists and will be used. Existing
   `db-apply.mjs` / mgmt / hardening / CLI-with-production-`config.toml`
   will **not** be used as-is.
7. Fresh preflight (§8) has passed, including emptiness or an explicit
   drift decision.
8. Recovery = recreate staging project (or a verified snapshot, if one
   later exists). No claimed 71-file transactional rollback.
9. No production data copy. No `.sql.proposed` apply in the same mission.
10. Independent post-restore catalog mission is scheduled; restore is not
    self-certifying.

---

## 12. Unresolved risks (do not block plan finalization; block execution)

| Risk | Owner of next action |
|------|----------------------|
| Staging catalog may have changed since 2026-10-14T18:34:55Z | Future read-only preflight |
| No staging-only 71-file runner exists today | Future engineering mission; do not use current scripts as-is |
| `assert-not-production.mjs` does not positively pin staging ref and is not on `origin/master` | Must be part of preflight/runner design |
| `db-apply.mjs` working-tree 69-file trap on default branch | Pin `d195ba8` blobs |
| Session GUC leak from #23 | Runner log + optional RESET |
| Git “APPLIED” comments vs live unknown production | Do not match production; do not open production |
| H3-040 markdown vs T-D posture JSON | Hygiene; not a SQL omit |
| Default ACLs ALL on future public tables | Post-restore catalog; later proposed `00080` |
| `#69` identity-scoped policy vs J-005 tenant equality | Recorded deviation; accepted with OPTION A |
| Dual biometric policies | Post-restore catalog |
| Recreate-project operational details (billing, DNS, secrets re-issue) | Operator; not verified |
| IPv6 direct host vs IPv4 pooler | Re-test in preflight |

These keep **execution** blocked. They do not reopen OPTION A or the 71-file
membership.

---

## 13. Version-target classification

**ACTIVE-V1 ONLY.**

This mission inspects V1 Scholar schema and V1 `cg_*` substrate files that
already sit on `origin/master`. It does **not** implement V2 device/IoT or
V3 Reality Intelligence. Including the V2-**named** transport file is
authorization-posture restore of a V1 Scholar table already present on
`origin/master`. Including `cg_hermes_observation` is inclusion of a V1
tree file, not a V3 un-freeze.

---

## 14. Explicit confirmation

- Authoritative source `origin/master` @ `d195ba861f80379b79533126653b9cee82a8e872` verified.
- Full migration tree hash `bbd828951e166662bbe831fd74972e1a15488468` verified.
- Exact migration count **71** verified; sequence listed; no timestamp collisions.
- OPTION A accepted: `20261002000014` (#59) and `20261003000041` (#69) both included in filename order; neither omitted.
- No database was opened.
- No SQL was executed against any server.
- No migration was applied.
- Production and staging were unchanged.
- Canonical migration files were not modified.
- Application code was not modified.
- Proposed SQL was not applied.
- SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
- Staging schema has **not** been restored.
- The plan will **not** be executed as a consequence of this report.

---

## 15. Agent report

**Implemented:** finalized staging schema restoration **plan** (document
only), incorporating the accepted OPTION A transport decision.

**Files changed:** `docs/security/rls-prep/SHERIVS-STAGING-SCHEMA-RESTORE-FINALIZE-001.md`

**Architecture impact:** none to running systems. Documents that the
proposed staging baseline is the 71-file `d195ba8` tree including both
transport migrations, and that canonical restore reintroduces OPEN RLS
findings.

**Tests:** static Git tree comparison; independent sha256/blob check of
the transport pair; offline statement parse of all 71 files; script source
review. No database tests. No apply. No script execution of apply
runners.

**Security validation:** production and staging non-contact by not
connecting; proposed SQL excluded; unsafe runners listed and not used;
findings left OPEN.

**Known risks:** stale staging catalog; no safe runner yet; session GUC
leak; working-tree 69-file trap; Git apply-status comments unverified live.

**Remaining work:** independent human review of this plan; staging-only
runner; fresh preflight; written apply authorization; then a **separate**
mutating restore mission; then post-restore catalog; then (later)
eligible proposed SQL.

**Final status:** **A. RESTORE PLAN FINALIZED — READY FOR INDEPENDENT REVIEW**
