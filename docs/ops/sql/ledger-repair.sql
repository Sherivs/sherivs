-- =============================================================================
-- SHERIVS-005 LEDGER REPAIR (production, ONE-TIME, run BEFORE any `supabase db push`)
--
-- Production has no supabase_migrations ledger: its schema was built outside the
-- CLI. A `db push` without this would try to replay all 70 historical
-- migrations. This records the 70 migrations whose effects are ALREADY in
-- production (verified 2026-10-20: a local replay of exactly these 70 files
-- matches production's public schema statement-for-statement).
--
-- It creates only the ledger (same shape the Supabase CLI uses) and inserts
-- version rows. It does not touch any application table. Safe to re-run.
-- It refuses to run if any SHERIVS migration object already exists.
--
-- Equivalent CLI (no link needed):
--   supabase migration repair --status applied --db-url "$DB_URL" <the 70 versions below>
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
SELECT count(*) AS recorded, max(version) AS last_version FROM supabase_migrations.schema_migrations;

COMMIT;
