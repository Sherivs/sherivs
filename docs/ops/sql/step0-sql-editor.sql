-- =============================================================================
-- SHERIVS STEP 0 — ONE PASTE FOR THE SUPABASE SQL EDITOR (production)
--
-- RUN ONLY AFTER the hotfix app (PR #57) is live on Vercel production and the
-- site works. The old app reads schools with select("*"), which breaks once
-- this revokes the secret column.
--
-- What it does, in ONE transaction (all or nothing):
--   1. guards: stops if this is not the expected pre-release production state;
--   2. ledger repair: records the 70 migrations already applied out of band;
--   3. Paystack fix: migration 20261015000005 (anon/authenticated can no longer
--      SELECT schools.paystack_secret_key; every other column stays readable);
--   4. records 20261015000005 in the ledger, exactly as `supabase db push` would.
-- Then it runs read-only verification queries: every row must say true.
--
-- Same result as: ledger-repair.sql, then `supabase db push` (only 0005 pending).
-- Safe to re-run. Rollback of step 3: database/supabase/rollbacks/20261015000005_*.sql
-- then DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261015000005';
-- =============================================================================
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.consent_records') IS NOT NULL
     OR to_regclass('public.school_tenant_map') IS NOT NULL
     OR to_regprocedure('public.my_active_role()') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: SHERIVS objects already exist; this database is not in the expected pre-release state';
  END IF;
  IF to_regclass('public.organization_memberships') IS NULL THEN
    RAISE EXCEPTION 'STOP: organization_memberships missing; this is not the expected production state';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY,
  statements text[],
  name text
);
-- The CLI (db push) connects as postgres; make sure it owns the ledger even if this
-- script was run under another admin role.
ALTER SCHEMA supabase_migrations OWNER TO postgres;
ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260620122048', '50e590c2-5911-4c98-8931-fb46a4b509f3'),
  ('20260620122110', '178748dc-376f-4c78-911d-ec879dfffce1'),
  ('20260620123741', '7e8b6a59-b1d0-4885-bcfb-ae0dd2dac64e'),
  ('20260620131046', '25e754bd-c51f-409e-90f1-74b622794197'),
  ('20260620150249', 'aeff3a12-2619-4cc9-aa0f-a7f5a844e8f3'),
  ('20260620151525', 'b630392a-2197-480f-b1cb-99da6c869c81'),
  ('20260620163221', 'afd596f8-c5bc-4f1d-8bf0-fd8a2a409d14'),
  ('20260622044140', '557cda0e-ae5c-4abc-b1ef-51ea89d09ff5'),
  ('20260623054451', 'c6c2ad41-5c74-4c10-9920-f6ef5546d4e6'),
  ('20260623054511', '8244a074-f5e6-41b8-8d3e-44bd6d2c7e12'),
  ('20260624115701', 'd5ee45b9-21af-42a5-b99b-4ae1a1eb7a46'),
  ('20260626111823', '66d215f2-2628-4490-93eb-0379825258b9'),
  ('20260626130344', 'f04aa837-2b27-4111-8b1d-0c46287a1bb3'),
  ('20260626131711', 'e05e2ec4-e2d0-4a0e-a905-fe22ea9a3401'),
  ('20260626133221', 'e95464b7-e864-413c-a934-7428cb26da47'),
  ('20260626133249', 'c712dcde-8e28-4f72-968d-a101b1bd5f7e'),
  ('20260626143528', '139a8242-aefe-4b45-bd91-9b17351263bc'),
  ('20260626150625', '35a08443-45fd-46ae-807b-3644b44efe26'),
  ('20260626172336', '78ce7dbb-cbb0-4186-b95c-cd8caea6cd95'),
  ('20260627090513', '8cdbda3b-4bd0-4ac0-a4b5-0adfdc813790'),
  ('20260705002543', 'e6b3e3bb-6d5e-4783-97cd-39e875bece40'),
  ('20260707223958', '421f2364-7989-4069-b78c-fd119f19daeb'),
  ('20260707225659', '58faa06f-1875-4a2b-8365-88a8473383f2'),
  ('20260725063636', 'd379b679-904b-4d2a-b9ed-11b463817fda'),
  ('20260725064521', '96522167-55e3-4281-ae25-6180fe57369f'),
  ('20260725065302', 'ddd47f8e-25ed-4581-84e8-658d1e38ecdb'),
  ('20260726085612', 'c410e01a-1b96-4b65-b539-0eb71556bb31'),
  ('20260729052237', '75252732-97d3-448f-b082-93517558a096'),
  ('20260729054314', '21b2720c-0c44-46ce-8404-e256ce7cf4ee'),
  ('20260819000000', 'coregrid_harden_schools_and_realtime'),
  ('20260903000000', 'coregrid_universal_kernel_substrate'),
  ('20260904010000', 'coregrid_rls_transport_and_grants'),
  ('20260904020000', 'coregrid_l2_identity_tenancy'),
  ('20260907000000', 'coregrid_workforce_kind_substrate'),
  ('20260907000100', 'runtime_scholar_workforce_catalog'),
  ('20260907000300', 'coregrid_workforce_position_rpc'),
  ('20260907000400', 'coregrid_self_primary_position_rpc'),
  ('20260907000500', 'coregrid_end_position_promotion'),
  ('20260907000600', 'runtime_scholar_workforce_ecosystem_extension'),
  ('20260907000700', 'coregrid_org_profile_substrate'),
  ('20260907000800', 'coregrid_role_assignment_substrate'),
  ('20260929000000', 'coregrid_foundation_mission_001'),
  ('20260930000000', 'coregrid_v1_workspace_persistence'),
  ('20261001000000', 'coregrid_v1_org_model'),
  ('20261002000000', 'coregrid_v1_kernel_envelope'),
  ('20261002000001', 'coregrid_v1_neutral_tenant_primitives'),
  ('20261002000002', 'coregrid_v1_worker_definitions'),
  ('20261002000003', 'coregrid_v1_kernel_bitemporal'),
  ('20261002000004', 'coregrid_v1_memory_tier'),
  ('20261002000005', 'coregrid_v1_reconciliation'),
  ('20261002000006', 'coregrid_v1_event_security'),
  ('20261002000007', 'coregrid_v1_event_routing'),
  ('20261002000008', 'coregrid_v1_evidence_lifecycle'),
  ('20261002000009', 'coregrid_v1_reasoning_provenance'),
  ('20261002000010', 'coregrid_v1_cost_attribution'),
  ('20261002000011', 'coregrid_v1_knowledge_currency'),
  ('20261002000012', 'coregrid_v1_tool_runtime'),
  ('20261002000013', 'coregrid_v1_neutral_membership_policies'),
  ('20261002000014', 'coregrid_v2_transport_buses_rls'),
  ('20261002000015', 'coregrid_v1_substrate_policies'),
  ('20261003000016', 'coregrid_v1_file_substrate'),
  ('20261003000017', 'coregrid_v1_idempotency_substrate'),
  ('20261003000018', 'coregrid_v1_idempotency_privilege_revoke'),
  ('20261003000019', 'coregrid_v1_mission_lease'),
  ('20261003000020', 'coregrid_is_super_admin_definer'),
  ('20261003000030', 'coregrid_hermes_observation_substrate'),
  ('20261003000031', 'coregrid_delivery_evidence'),
  ('20261003000040', 'coregrid_school_media_bucket'),
  ('20261003000041', 'coregrid_transport_bus_reads'),
  ('20261003000042', 'platform_capture_out_of_band_tables')
ON CONFLICT (version) DO NOTHING;

-- Expect: 70 rows, last version 20261003000042.

-- ---- 20261015000005_sherivs_002_secret_column_privilege.sql (verbatim) ----
DO $schools_column_privilege$
DECLARE
  v_cols text;
BEGIN
  IF to_regclass('public.schools') IS NULL THEN
    RAISE EXCEPTION 'public.schools missing; cannot assert column privileges';
  END IF;

  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'schools'
     AND column_name <> 'paystack_secret_key';

  IF v_cols IS NULL OR position('id' IN v_cols) = 0 THEN
    RAISE EXCEPTION 'public.schools column list could not be resolved';
  END IF;

  -- Removes the table-level grant and any column-level SELECT grants.
  REVOKE SELECT ON public.schools FROM anon, authenticated;

  EXECUTE format('GRANT SELECT (%s) ON public.schools TO anon, authenticated', v_cols);
END
$schools_column_privilege$;

-- Post-apply verification (expect false / false, then true / true):
--   SELECT has_column_privilege('anon','public.schools','paystack_secret_key','SELECT'),
--          has_column_privilege('authenticated','public.schools','paystack_secret_key','SELECT');
--   SELECT has_column_privilege('anon','public.schools','name','SELECT'),
--          has_column_privilege('authenticated','public.schools','name','SELECT');

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261015000005', 'sherivs_002_secret_column_privilege')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---- Verification (read-only). Every "ok" must be true. ----
SELECT check_name, ok FROM (VALUES
  ('ledger has 71 versions (70 baseline + 0005)',
     (SELECT count(*) FROM supabase_migrations.schema_migrations) = 71),
  ('Paystack fix recorded',
     EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261015000005')),
  ('anon cannot read paystack_secret_key',
     NOT has_column_privilege('anon', 'public.schools', 'paystack_secret_key', 'SELECT')),
  ('authenticated cannot read paystack_secret_key',
     NOT has_column_privilege('authenticated', 'public.schools', 'paystack_secret_key', 'SELECT')),
  ('anon can still read school name/slug',
     has_column_privilege('anon', 'public.schools', 'name', 'SELECT')
     AND has_column_privilege('anon', 'public.schools', 'slug', 'SELECT')),
  ('service_role still reads the secret (server side)',
     has_column_privilege('service_role', 'public.schools', 'paystack_secret_key', 'SELECT')),
  ('ledger owned by postgres',
     (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'supabase_migrations.schema_migrations'::regclass) = 'postgres')
) AS t(check_name, ok);
