-- =============================================================================
-- SHERIVS — PURGE ALL TEST DATA (production). Paste into the Supabase SQL editor.
--
-- The owner confirmed (2026-10-20) that EVERY school, user, membership and auth
-- account in production is test/demo data. This removes all of it, plus the
-- audit log and the CoreGrid foundation-probe test rows.
--
-- KEEPS: platform_config (pricing), cg_workforce_kind (71-row catalogue),
--   cg_domain_runtime ('runtime:scholar' — it is NOT test data: deleting it
--   would CASCADE-delete the whole cg_workforce_kind catalogue), seeds, the
--   migration ledger, storage buckets (both empty), every table and policy.
-- DELETES: 6 schools and everything hanging off them (cascade), all
--   public.users, organization_memberships, ALL 10 auth users (identities,
--   sessions, refresh tokens cascade), all audit_logs, and the foundation
--   probe rows in cg_entity, cg_delivery_evidence, cg_execution_history,
--   cg_execution_record, cg_foundation_evidence, cg_mission_intent,
--   cg_verification_result.
-- Append-only tables: cg_execution_history and cg_delivery_evidence reject
--   DELETE via BEFORE DELETE triggers. Their triggers are disabled ONLY inside
--   this transaction, the rows deleted, and the triggers re-enabled before
--   COMMIT (a final check proves they are enabled again).
--
-- One transaction: any STOP or error rolls back everything.
-- Safe to re-run: if already purged, it changes nothing and every check is true.
-- Backup taken before: ~/backups/sherivs-prod-20261020T193545Z.dump.gpg (server).
--
-- AFTER THIS: there is NO super admin. Sign up with the real Sherivs company
-- email, then run docs/ops/sql/create-super-admin.sql straight away.
-- =============================================================================
BEGIN;

-- 0. Guards: either the exact inventoried state, or already purged.
DO $guard$
DECLARE
  n_schools int := (SELECT count(*) FROM public.schools);
  n_auth    int := (SELECT count(*) FROM auth.users);
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'STOP: storage now holds files; review them before purging';
  END IF;
  IF NOT ((n_schools = 6 AND n_auth = 10) OR (n_schools = 0 AND n_auth = 0)) THEN
    RAISE EXCEPTION 'STOP: unexpected state (% schools, % auth users; expected 6/10, or 0/0 if already purged)', n_schools, n_auth;
  END IF;
END
$guard$;

-- 1. Before-counts
CREATE TEMP TABLE purge_counts ON COMMIT DROP AS
SELECT 'public.' || relname AS tbl,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) n FROM public.%I', relname), false, true, '')))[1]::text::bigint AS before,
       NULL::bigint AS after
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
INSERT INTO purge_counts VALUES ('auth.users', (SELECT count(*) FROM auth.users), NULL);

-- 2. Tenant data: schools cascade to every school-scoped table, incl. users + memberships
DELETE FROM public.schools;
DELETE FROM public.organization_memberships;
DELETE FROM public.users;

-- 3. All auth accounts (identities, sessions, refresh tokens, MFA, super_admins,
--    notification_preferences cascade)
DELETE FROM auth.users;

-- 4. Audit log
DELETE FROM public.audit_logs;

-- 5. CoreGrid foundation-probe test rows (FK-safe order)
ALTER TABLE public.cg_execution_history DISABLE TRIGGER cg_execution_history_append_only;
DELETE FROM public.cg_execution_history;
ALTER TABLE public.cg_execution_history ENABLE TRIGGER cg_execution_history_append_only;

ALTER TABLE public.cg_delivery_evidence DISABLE TRIGGER cg_delivery_evidence_append_only;
DELETE FROM public.cg_delivery_evidence;
ALTER TABLE public.cg_delivery_evidence ENABLE TRIGGER cg_delivery_evidence_append_only;

DELETE FROM public.cg_conformance_assessment;  -- empty today; references cg_verification_result
DELETE FROM public.cg_mission_lease;           -- empty today; references cg_execution_record
DELETE FROM public.cg_verification_result;
DELETE FROM public.cg_execution_record;
DELETE FROM public.cg_mission_intent;
DELETE FROM public.cg_foundation_evidence;
DELETE FROM public.cg_relationship;            -- empty today; references cg_entity
DELETE FROM public.cg_observation;             -- empty today; references cg_entity
UPDATE public.cg_identity SET entity_id = NULL WHERE entity_id IS NOT NULL;  -- empty today
DELETE FROM public.cg_entity;

-- 6. After-counts
UPDATE purge_counts p
   SET after = (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) n FROM %s', p.tbl), false, true, '')))[1]::text::bigint;

-- 7. Hard asserts (any failure rolls everything back)
DO $post$
BEGIN
  IF (SELECT count(*) FROM public.schools) <> 0
     OR (SELECT count(*) FROM public.users) <> 0
     OR (SELECT count(*) FROM public.organization_memberships) <> 0
     OR (SELECT count(*) FROM auth.users) <> 0
     OR (SELECT count(*) FROM public.cg_workforce_kind) = 0
     OR (SELECT count(*) FROM public.platform_config) = 0 THEN
    RAISE EXCEPTION 'STOP: post-purge state unexpected; rolling back';
  END IF;
END
$post$;

-- Tables whose row count changed (for the record)
SELECT tbl, before, after FROM purge_counts WHERE before <> after ORDER BY tbl;

COMMIT;

-- ---- Verification (read-only). Every "ok" must be true. ----
SELECT check_name, ok FROM (VALUES
  ('no schools',                    (SELECT count(*) FROM public.schools) = 0),
  ('no users rows',                 (SELECT count(*) FROM public.users) = 0),
  ('no memberships',                (SELECT count(*) FROM public.organization_memberships) = 0),
  ('no auth accounts',              (SELECT count(*) FROM auth.users) = 0),
  ('no audit rows',                 (SELECT count(*) FROM public.audit_logs) = 0),
  ('no foundation probe rows',      (SELECT count(*) FROM public.cg_entity) + (SELECT count(*) FROM public.cg_execution_record)
                                    + (SELECT count(*) FROM public.cg_execution_history) + (SELECT count(*) FROM public.cg_delivery_evidence) = 0),
  ('append-only triggers re-enabled',
     (SELECT bool_and(tgenabled = 'O') FROM pg_trigger
       WHERE tgname IN ('cg_execution_history_append_only','cg_delivery_evidence_append_only'))),
  ('catalogue kept (cg_workforce_kind)', (SELECT count(*) FROM public.cg_workforce_kind) > 0),
  ('pricing kept (platform_config)',     (SELECT count(*) FROM public.platform_config) > 0),
  ('migration ledger kept',              (SELECT count(*) FROM supabase_migrations.schema_migrations) > 0)
) AS t(check_name, ok);
