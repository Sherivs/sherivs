-- Disposable proof for 20261117001400_sherivs_m11_admissions_model.sql (M11 part A, ADR-111).
-- A small production-shaped fixture (admission_applications with its production columns,
-- grants and policies as read on 2026-11-17; helper functions shaped like production), then
-- positive, negative and cross-organization cases, a second run and the rollback.
-- It is a fixture, not a replay of production.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m11a_test -v ON_ERROR_STOP=1 -f tests/sql/m11-admissions-model.sql
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.role', true), '') $$;

CREATE TABLE public.schools (id uuid PRIMARY KEY, name text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid, role text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.organization_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, school_id uuid,
  role text, is_primary boolean DEFAULT false, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, school_id uuid, user_id uuid, action text, table_name text,
  record_id uuid, old_value jsonb, new_value jsonb);
-- test-only stand-in for the catalogue role assignments behind has_permission()
CREATE TABLE public.fixture_permissions (user_id uuid, org_id uuid, perm text);

CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT u.role FROM public.users u WHERE u.id = auth.uid() AND u.is_active $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT false $$;
CREATE FUNCTION public.has_permission(p_org uuid, p_perm text, p_a text DEFAULT NULL, p_b text DEFAULT NULL) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM public.fixture_permissions f WHERE f.user_id = auth.uid() AND f.org_id = p_org AND f.perm = p_perm) $$;
-- scholar_can exactly as production (2026-11-17)
CREATE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR coalesce(public.is_super_admin(), false) THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF public.has_permission(p_org, p_perm) THEN RETURN true; END IF;
  IF public.get_my_school_id() IS DISTINCT FROM p_org THEN RETURN false; END IF;
  r := public.get_my_role();
  IF p_perm IN ('payroll.approve', 'audit.view', 'roles.assign', 'roles.configure', 'malpractice.decide') THEN RETURN false; END IF;
  RETURN CASE WHEN r IN ('admin', 'principal') THEN true ELSE false END;
END $$;
REVOKE ALL ON FUNCTION public.scholar_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scholar_can(uuid, text) TO authenticated, service_role;
CREATE FUNCTION public.can_manage_admissions() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.role IN ('admin', 'principal')) $$;
CREATE FUNCTION public.scholar_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  INSERT INTO public.audit_logs (school_id, action, table_name, record_id)
  VALUES (coalesce((j->>'school_id')::uuid, (j->>'org_id')::uuid), 'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, (j->>'id')::uuid);
  RETURN NULL;
END $$;
CREATE FUNCTION public.append_only_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = ''
  AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = 'pg_catalog'
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- admission_applications: production columns, constraints, grants, policies (2026-11-17)
CREATE TABLE public.admission_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  application_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','interview_scheduled','shortlisted','accepted','rejected','withdrawn','waitlist')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  student_first_name text NOT NULL, student_last_name text NOT NULL, student_date_of_birth date NOT NULL,
  student_gender text, student_nationality text, student_religion text, student_blood_group text, student_genotype text,
  student_address text, applying_for_class text NOT NULL, academic_year_applying text NOT NULL,
  previous_school_name text, previous_school_address text, previous_class_completed text, year_completed text,
  reason_for_leaving text, academic_achievements text, was_disciplined boolean DEFAULT false, discipline_explanation text,
  parent_one_name text NOT NULL, parent_one_relationship text NOT NULL, parent_one_phone text NOT NULL, parent_one_email text NOT NULL,
  parent_one_occupation text, parent_one_address text, parent_two_name text, parent_two_relationship text, parent_two_phone text,
  parent_two_email text, parent_two_occupation text, parent_two_address text, guardian_name text, guardian_relationship text,
  guardian_phone text, emergency_contact_name text, emergency_contact_relationship text, emergency_contact_phone text,
  medical_conditions text, has_special_needs boolean DEFAULT false, disabilities_or_special_needs text,
  has_allergies boolean DEFAULT false, allergies_detail text, interview_date timestamptz, interview_notes text,
  decision_notes text, documents_uploaded jsonb NOT NULL DEFAULT '{}'::jsonb, interview_responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  ai_review_result jsonb, ai_reviewed_at timestamptz, ai_recommendation text, student_id uuid,
  stage text NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','exam_scheduled','exam_taken','interview','offered','accepted','enrolled','rejected','withdrawn')),
  entrance_exam_at timestamptz, entrance_exam_score numeric CHECK (entrance_exam_score IS NULL OR entrance_exam_score BETWEEN 0 AND 100),
  scored_by uuid, offer_letter jsonb, offered_by uuid, offer_expires_at timestamptz, acceptance_fee numeric,
  acceptance_fee_paid_at timestamptz, acceptance_reference text);
CREATE TRIGGER admission_applications_touch BEFORE UPDATE ON public.admission_applications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.admission_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY "public can submit applications" ON public.admission_applications FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'pending' AND interview_date IS NULL AND interview_notes IS NULL AND decision_notes IS NULL
    AND ai_review_result IS NULL AND ai_reviewed_at IS NULL AND ai_recommendation IS NULL
    AND EXISTS (SELECT 1 FROM public.schools s WHERE s.id = admission_applications.school_id AND s.is_active = true));
CREATE POLICY "school admins read applications" ON public.admission_applications FOR SELECT TO authenticated
  USING ((school_id = public.get_my_school_id() AND public.can_manage_admissions()) OR public.is_super_admin());
CREATE POLICY "school admins update applications" ON public.admission_applications FOR UPDATE TO authenticated
  USING ((school_id = public.get_my_school_id() AND public.can_manage_admissions()) OR public.is_super_admin())
  WITH CHECK ((school_id = public.get_my_school_id() AND public.can_manage_admissions()) OR public.is_super_admin());
REVOKE ALL ON public.admission_applications FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.admission_applications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.admission_applications TO authenticated;
GRANT SELECT ON public.schools TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- A minimal storage schema so the bucket and object policy can be proved.
CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects TO authenticated;

INSERT INTO public.schools VALUES ('11111111-1111-1111-1111-111111111111', 'A', true),
  ('22222222-2222-2222-2222-222222222222', 'B', true), ('33333333-3333-3333-3333-333333333333', 'C', false);
-- people: a* in A, b* in B
INSERT INTO public.users VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'admin', true),     -- a_admin
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_config
  ('00000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_scorer
  ('00000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_drafter
  ('00000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_approver (also scores)
  ('00000000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_approver2
  ('00000000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_viewer
  ('00000000-0000-0000-0000-0000000000a8', '11111111-1111-1111-1111-111111111111', 'staff', true),     -- a_screener
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'admin', true),     -- b_admin
  ('00000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'staff', true);     -- b_drafter
INSERT INTO public.fixture_permissions VALUES
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'admissions.configure'),
  ('00000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'admissions.score'),
  ('00000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'admissions.offer'),
  ('00000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'admissions.offer'),
  ('00000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'admissions.score'),
  ('00000000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'admissions.offer'),
  ('00000000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', 'admissions.view'),
  ('00000000-0000-0000-0000-0000000000a8', '11111111-1111-1111-1111-111111111111', 'admissions.screen'),
  ('00000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'admissions.offer');

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs a statement as an API role for a caller; returns 'ok:<rows>' or 'err:<SQLSTATE>'.
CREATE FUNCTION pg_temp.try(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; result text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  PERFORM set_config('sim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; result := 'ok:' || n;
  EXCEPTION WHEN others THEN result := 'err:' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('sim.uid', '', true); PERFORM set_config('sim.role', '', true);
  RETURN result;
END $$;
CREATE FUNCTION pg_temp.val(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  PERFORM set_config('sim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN others THEN v := 'err:' || SQLSTATE; END;
  RESET ROLE;
  PERFORM set_config('sim.uid', '', true); PERFORM set_config('sim.role', '', true);
  RETURN v;
END $$;

-- Shape of admission_applications before the migration, for the rollback comparison.
CREATE TABLE public.fixture_before AS
  SELECT (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
           WHERE attrelid = 'public.admission_applications'::regclass AND attnum > 0 AND NOT attisdropped) AS cols,
         (SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.admission_applications'::regclass) AS cons,
         (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.admission_applications'::regclass AND NOT tgisinternal) AS trgs,
         (SELECT string_agg(policyname || '/' || cmd || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), ',' ORDER BY policyname)
            FROM pg_policies WHERE tablename = 'admission_applications') AS pols,
         (SELECT string_agg(r || ':' || p, ',' ORDER BY r, p) FROM (SELECT g.grantee::regrole::text r, g.privilege_type p
            FROM pg_class c, aclexplode(c.relacl) g WHERE c.oid = 'public.admission_applications'::regclass) x) AS acl;

\echo == apply the migration ==
\i database/supabase/migrations/20261117001400_sherivs_m11_admissions_model.sql

\echo == structure ==
SELECT pg_temp.expect('every new table forces row-level security',
  (SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'admission\_%'
     AND relname NOT IN ('admission_applications') AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity), '9');
SELECT pg_temp.expect('every new table has the audit trigger',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg_admission\_%\_audit' AND tgfoid = 'public.scholar_audit'::regproc), '9');
SELECT pg_temp.expect('anon holds no privilege on any new table',
  (SELECT count(*)::text FROM pg_class c, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'admission\_%' AND c.relname <> 'admission_applications'
      AND c.relkind = 'r' AND has_table_privilege('anon', c.oid, p)), '0');
SELECT pg_temp.expect('anon table privileges in public are exactly INSERT on admission_applications plus the fixture schools read',
  (SELECT string_agg(c.relname || ':' || p, ',' ORDER BY c.relname, p) FROM pg_class c,
     unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v') AND has_table_privilege('anon', c.oid, p)),
  'admission_applications:INSERT,schools:SELECT');
SELECT pg_temp.expect('anon cannot execute any new function',
  (SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'admission%'
     AND has_function_privilege('anon', oid, 'EXECUTE')), '0');
SELECT pg_temp.expect('every policy on admission_applications, the anonymous insert policy included, is unchanged',
  (SELECT string_agg(policyname || '/' || cmd || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), ',' ORDER BY policyname)
     FROM pg_policies WHERE tablename = 'admission_applications'), (SELECT pols FROM public.fixture_before));
SELECT pg_temp.expect('the bucket is private', (SELECT public::text FROM storage.buckets WHERE id = 'admission-documents'), 'false');

\echo == the anonymous path ==
CREATE FUNCTION pg_temp.app_sql(p_org text, p_no text, p_extra_cols text DEFAULT '', p_extra_vals text DEFAULT '') RETURNS text
LANGUAGE sql AS $$ SELECT format($f$INSERT INTO public.admission_applications (school_id, application_number, student_first_name,
  student_last_name, student_date_of_birth, student_gender, student_religion, medical_conditions, parent_one_occupation,
  applying_for_class, academic_year_applying, parent_one_name, parent_one_relationship, parent_one_phone, parent_one_email%s)
  VALUES (%L, %L, 'Ada', 'Obi', '2014-02-01', 'female', 'faith-x', 'asthma', 'trader', 'JSS1', '2026/2027', 'P', 'mother',
  '0800', 'p@example.test'%s)$f$, p_extra_cols, p_org, p_no, p_extra_vals) $$;
SELECT pg_temp.expect('anon can still submit an application to an active organization',
  pg_temp.try('anon', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-001')), 'ok:1');
SELECT pg_temp.expect('anon cannot apply to an inactive organization',
  pg_temp.try('anon', '', pg_temp.app_sql('33333333-3333-3333-3333-333333333333', 'C-001')), 'err:42501');
SELECT pg_temp.expect('anon cannot set the new link columns',
  pg_temp.try('anon', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-x1', ', form_version', ', 1')), 'err:42501');
SELECT pg_temp.expect('anon cannot set the tertiary columns',
  pg_temp.try('anon', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-x2', ', jamb_reg_no', ', ''12345678AB''')), 'err:42501');
SELECT pg_temp.expect('a signed-in caller without admissions.process cannot set them either',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a7',
    pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-x3', ', utme_score', ', 250')), 'err:42501');
SELECT pg_temp.expect('anon reads nothing of admission_applications',
  pg_temp.val('anon', '', 'SELECT count(*)::text FROM public.admission_applications'), 'err:42501');
SELECT pg_temp.expect('anon reads no new table',
  pg_temp.val('anon', '', 'SELECT count(*)::text FROM public.admission_cycles'), 'err:42501');
-- more applications (owner-created fixture rows)
SELECT pg_temp.expect('fixture step', pg_temp.try('service_role', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-002')), 'ok:1');
SELECT pg_temp.expect('fixture step', pg_temp.try('service_role', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-003')), 'ok:1');
SELECT pg_temp.expect('fixture step', pg_temp.try('service_role', '', pg_temp.app_sql('22222222-2222-2222-2222-222222222222', 'B-001')), 'ok:1');
CREATE TABLE public.fixture_ids AS SELECT application_number k, id FROM public.admission_applications;
CREATE FUNCTION pg_temp.app(k text) RETURNS text LANGUAGE sql AS $$ SELECT id::text FROM public.fixture_ids WHERE fixture_ids.k = $1 $$;

\echo == cycles ==
SELECT pg_temp.expect('a configurer creates a cycle in their own organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$INSERT INTO public.admission_cycles
    (id, org_id, session_label, intake, opens_at, closes_at, application_fee_minor)
    VALUES ('c0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', '2026/2027', 'main', now(), now() + interval '60 days', 500000)$q$), 'ok:1');
SELECT pg_temp.expect('a configurer cannot create a cycle for another organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$INSERT INTO public.admission_cycles
    (org_id, session_label, opens_at, closes_at) VALUES ('22222222-2222-2222-2222-222222222222', '2026/2027', now(), now() + interval '1 day')$q$), 'err:42501');
SELECT pg_temp.expect('a viewer cannot create a cycle',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a7', $q$INSERT INTO public.admission_cycles
    (org_id, session_label, opens_at, closes_at) VALUES ('11111111-1111-1111-1111-111111111111', '2026/2027', now(), now() + interval '1 day')$q$), 'err:42501');
SELECT pg_temp.expect('created_by is the caller, not the client',
  (SELECT created_by::text FROM public.admission_cycles WHERE id = 'c0000000-0000-0000-0000-0000000000a1'), '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.admission_cycles (id, org_id, session_label, intake, opens_at, closes_at) VALUES
  ('c0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', '2026/2027', 'main', now(), now() + interval '60 days'),
  ('c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', '2026/2027', 'direct_entry', now(), now() + interval '60 days'),
  ('c0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', '2026/2027', 'main', now(), now() + interval '60 days'),
  ('c0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', '2027/2028', 'main', now(), now() + interval '60 days');
SELECT pg_temp.expect('a cycle that closes before it opens is refused',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_cycles (org_id, session_label, opens_at, closes_at)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026/2027', now(), now() - interval '1 day')$q$), 'err:23514');
SELECT pg_temp.expect('a bad session label is refused',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_cycles (org_id, session_label, opens_at, closes_at)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-27', now(), now() + interval '1 day')$q$), 'err:23514');
SELECT pg_temp.expect('opening the first main cycle works',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_cycles SET status = 'open' WHERE id = 'c0000000-0000-0000-0000-0000000000a2'$q$), 'ok:1');
SELECT pg_temp.expect('a second open cycle for the same organization and intake is refused',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$UPDATE public.admission_cycles SET status = 'open'
    WHERE id = 'c0000000-0000-0000-0000-0000000000a1'$q$), 'err:23505');
SELECT pg_temp.expect('another intake may be open at the same time',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_cycles SET status = 'open' WHERE id = 'c0000000-0000-0000-0000-0000000000a3'$q$), 'ok:1');
SELECT pg_temp.expect('another organization may open its own main cycle',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_cycles SET status = 'open' WHERE id = 'c0000000-0000-0000-0000-0000000000b1'$q$), 'ok:1');
SELECT pg_temp.expect('an open cycle cannot return to draft',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_cycles SET status = 'draft' WHERE id = 'c0000000-0000-0000-0000-0000000000a3'$q$), 'err:23514');

\echo == programmes and composite keys ==
INSERT INTO public.admission_programmes (id, org_id, cycle_id, code, name, entry_level, quota) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'JSS1', 'Junior entry', 'JSS1', 120),
  ('d0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 'JSS1', 'Junior entry', 'JSS1', 120),
  ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000b1', 'ND-CS', 'Computing', 'ND1', 60);
SELECT pg_temp.expect('a programme cannot point at another organization''s cycle',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_programmes (org_id, cycle_id, code, name, entry_level)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b1', 'X', 'X', 'X')$q$), 'err:23503');
SELECT pg_temp.expect('a programme code is unique within a cycle',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_programmes (org_id, cycle_id, code, name, entry_level)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'JSS1', 'Again', 'JSS1')$q$), 'err:23505');

\echo == forms ==
SELECT pg_temp.expect('a configurer adds a draft form to a draft cycle',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$INSERT INTO public.admission_forms (id, org_id, cycle_id, programme_id, version, schema)
    VALUES ('e0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1',
            'd0000000-0000-0000-0000-0000000000a1', 1, '{"type":"object"}')$q$), 'ok:1');
SELECT pg_temp.expect('a draft form can be edited',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$UPDATE public.admission_forms SET ui_schema = '{"x":1}'
    WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$q$), 'ok:1');
SELECT pg_temp.expect('a draft form can be published',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$UPDATE public.admission_forms SET status = 'published'
    WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$q$), 'ok:1');
SELECT pg_temp.expect('a published form version cannot be edited, even by the server',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_forms SET schema = '{}' WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$q$), 'err:23514');
SELECT pg_temp.expect('a published form cannot be unpublished',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_forms SET status = 'draft' WHERE id = 'e0000000-0000-0000-0000-0000000000a1'$q$), 'err:23514');
SELECT pg_temp.expect('staff cannot delete a form',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$DELETE FROM public.admission_forms$q$), 'err:42501');
SELECT pg_temp.expect('a new draft version is allowed while the cycle is draft',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (id, org_id, cycle_id, version)
    VALUES ('e0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 2)$q$), 'ok:1');
SELECT pg_temp.expect('a version number is unique within a cycle',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (org_id, cycle_id, version)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 2)$q$), 'err:23505');
SELECT pg_temp.expect('a form cannot point at another organization''s cycle',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (org_id, cycle_id, version)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b2', 9)$q$), 'err:23503');
SELECT pg_temp.expect('a form cannot use a programme of another cycle',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (org_id, cycle_id, programme_id, version)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2', 9)$q$), 'err:23503');
-- the main cycle a2 is already open
SELECT pg_temp.expect('no new form version once the cycle is open',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (org_id, cycle_id, version)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 1)$q$), 'err:23514');
SELECT pg_temp.expect('no form can be added to another organization''s open cycle either',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (id, org_id, cycle_id, version, status)
    VALUES ('e0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000b1', 1, 'draft')$q$), 'err:23514');
-- open the a1 cycle after closing a2, then the draft form v2 in a1 is frozen
UPDATE public.admission_cycles SET status = 'closed' WHERE id = 'c0000000-0000-0000-0000-0000000000a2';
UPDATE public.admission_cycles SET status = 'open' WHERE id = 'c0000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('a draft form cannot be edited once its cycle is open',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$UPDATE public.admission_forms SET schema = '{"y":1}'
    WHERE id = 'e0000000-0000-0000-0000-0000000000a2'$q$), 'err:23514');
SELECT pg_temp.expect('a draft form cannot be published once its cycle is open',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_forms SET status = 'published' WHERE id = 'e0000000-0000-0000-0000-0000000000a2'$q$), 'err:23514');
SELECT pg_temp.expect('a closed cycle still freezes its forms',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_forms (org_id, cycle_id, version)
    VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 5)$q$), 'err:23514');

\echo == application links and tertiary fields ==
SELECT pg_temp.expect('admissions staff link an application to a cycle, programme and published form of their organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a1', format($q$UPDATE public.admission_applications
    SET cycle_id = 'c0000000-0000-0000-0000-0000000000a1', programme_id = 'd0000000-0000-0000-0000-0000000000a1', form_version = 1,
        jamb_reg_no = '12345678AB', utme_score = 260, caps_status = 'in_progress', entry_mode = 'utme' WHERE id = %L$q$, pg_temp.app('A-001'))), 'ok:1');
SELECT pg_temp.expect('an application cannot point at another organization''s cycle',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET cycle_id = 'c0000000-0000-0000-0000-0000000000b1'
    WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23503');
SELECT pg_temp.expect('an application cannot point at another organization''s programme',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET cycle_id = 'c0000000-0000-0000-0000-0000000000b1',
    programme_id = 'd0000000-0000-0000-0000-0000000000b1' WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23503');
SELECT pg_temp.expect('a programme needs a cycle',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET programme_id = 'd0000000-0000-0000-0000-0000000000a1'
    WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23514');
SELECT pg_temp.expect('a form version must exist in that cycle',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET cycle_id = 'c0000000-0000-0000-0000-0000000000a1', form_version = 7
    WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23503');
SELECT pg_temp.expect('a malformed JAMB number is refused',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET jamb_reg_no = 'abc' WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23514');
SELECT pg_temp.expect('a UTME score above 400 is refused',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET utme_score = 401 WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23514');
SELECT pg_temp.expect('an unknown entry mode is refused',
  pg_temp.try('service_role', '', format($q$UPDATE public.admission_applications SET entry_mode = 'shortcut' WHERE id = %L$q$, pg_temp.app('A-002'))), 'err:23514');
SELECT pg_temp.expect('admissions staff still read the ordinary columns',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a1', 'SELECT count(application_number)::text FROM public.admission_applications'), '3');
SELECT pg_temp.expect('no signed-in caller reads the tertiary columns from the table',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a1', 'SELECT max(jamb_reg_no) FROM public.admission_applications'), 'err:42501');
SELECT pg_temp.expect('authenticated holds no column SELECT on any tertiary column',
  (SELECT string_agg(c, ',') FROM unnest(ARRAY['jamb_reg_no','utme_score','caps_status','entry_mode']) c
    WHERE has_column_privilege('authenticated', 'public.admission_applications', c, 'SELECT')), NULL);
SELECT pg_temp.expect('a holder of admissions.view reads them through the reader',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a7',
    format('SELECT jamb_reg_no || ''/'' || utme_score FROM public.admission_application_tertiary(%L)', pg_temp.app('A-001'))), '12345678AB/260');
SELECT pg_temp.expect('another organization gets nothing from the reader',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1',
    format('SELECT count(*)::text FROM public.admission_application_tertiary(%L)', pg_temp.app('A-001'))), '0');
SELECT pg_temp.expect('a scorer without admissions.view cannot use the reader',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3',
    format('SELECT count(*)::text FROM public.admission_application_tertiary(%L)', pg_temp.app('A-001'))), 'err:42501');

\echo == blind scoring surface ==
SELECT pg_temp.expect('a scorer gets the applications of their organization through the blind surface',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3', 'SELECT count(*)::text FROM public.admission_blind_applications()'), '3');
SELECT pg_temp.expect('the blind surface is limited to a cycle when asked',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3',
    $q$SELECT count(*)::text FROM public.admission_blind_applications('c0000000-0000-0000-0000-0000000000a1')$q$), '1');
SELECT pg_temp.expect('another organization''s admin sees only their own applications',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1', 'SELECT string_agg(application_number, '','') FROM public.admission_blind_applications()'), 'B-001');
SELECT pg_temp.expect('the blind surface returns no protected or identifying column',
  (SELECT string_agg(c, ',') FROM unnest(ARRAY['student_first_name','student_last_name','student_gender','student_date_of_birth',
     'student_religion','student_nationality','student_genotype','student_blood_group','student_address','medical_conditions',
     'has_special_needs','disabilities_or_special_needs','allergies_detail','parent_one_name','parent_one_occupation',
     'parent_two_occupation','guardian_name','previous_school_name','was_disciplined','jamb_reg_no','utme_score','ai_recommendation']) c
    WHERE pg_get_function_result('public.admission_blind_applications(uuid)'::regprocedure) ~ ('\m' || c || '\M')), NULL);
SELECT pg_temp.expect('a scorer cannot read the protected columns from the table (no rows)',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3',
    'SELECT count(*)::text FROM public.admission_applications WHERE student_religion IS NOT NULL OR student_gender IS NOT NULL'), '0');
SELECT pg_temp.expect('a scorer cannot read the date of birth from the table',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3', 'SELECT max(student_date_of_birth)::text FROM public.admission_applications'), NULL);
SELECT pg_temp.expect('someone without admissions.score cannot use the blind surface',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a7', 'SELECT count(*)::text FROM public.admission_blind_applications()'), 'err:42501');
SELECT pg_temp.expect('anon cannot use the blind surface',
  pg_temp.val('anon', '', 'SELECT count(*)::text FROM public.admission_blind_applications()'), 'err:42501');

\echo == question bank and screenings ==
SELECT pg_temp.expect('a configurer adds a question; owner is the caller',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$WITH x AS (INSERT INTO public.admission_question_bank
    (org_id, type, prompt, rubric, difficulty, tags, owner_id) VALUES ('11111111-1111-1111-1111-111111111111', 'likert', 'Motivation',
    '{"levels":5}', 2, '{interview}', '00000000-0000-0000-0000-0000000000a9') RETURNING owner_id) SELECT owner_id::text FROM x$q$),
  '00000000-0000-0000-0000-0000000000a2');
SELECT pg_temp.expect('an unknown question type is refused',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_question_bank (org_id, type, prompt)
    VALUES ('11111111-1111-1111-1111-111111111111', 'essay_ai', 'x')$q$), 'err:23514');
SELECT pg_temp.expect('another organization cannot see the question bank',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1', 'SELECT count(*)::text FROM public.admission_question_bank'), '0');
SELECT pg_temp.expect('a screener schedules an interview with an interviewer from the same organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a8', format($q$INSERT INTO public.admission_screenings
    (id, org_id, application_id, kind, scheduled_at, slot, interviewer_ids) VALUES ('f0000000-0000-0000-0000-0000000000a1',
    '11111111-1111-1111-1111-111111111111', %L, 'interview', now() + interval '2 days', '09:00-09:20',
    ARRAY['00000000-0000-0000-0000-0000000000a3']::uuid[])$q$, pg_temp.app('A-001'))), 'ok:1');
SELECT pg_temp.expect('an interviewer from another organization is refused',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_screenings (org_id, application_id, kind, interviewer_ids)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'panel', ARRAY['00000000-0000-0000-0000-0000000000b1']::uuid[])$q$, pg_temp.app('A-001'))), 'err:23503');
SELECT pg_temp.expect('a screening cannot reference another organization''s application',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_screenings (org_id, application_id, kind)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'cbt')$q$, pg_temp.app('B-001'))), 'err:23503');
SELECT pg_temp.expect('a screener cannot schedule for another organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a8', format($q$INSERT INTO public.admission_screenings (org_id, application_id, kind)
    VALUES ('22222222-2222-2222-2222-222222222222', %L, 'cbt')$q$, pg_temp.app('B-001'))), 'err:42501');
SELECT pg_temp.expect('another organization cannot see the screenings',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1', 'SELECT count(*)::text FROM public.admission_screenings'), '0');

\echo == scores ==
SELECT pg_temp.expect('a scorer records a score; the scorer id is the caller even if the client sends another',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3', format($q$WITH x AS (INSERT INTO public.admission_scores
    (id, org_id, application_id, screening_id, criterion, weight, raw_score, scorer_id) VALUES ('a0000000-0000-0000-0000-0000000000a1',
    '11111111-1111-1111-1111-111111111111', %L, 'f0000000-0000-0000-0000-0000000000a1', 'motivation', 30, 70,
    '00000000-0000-0000-0000-0000000000a6') RETURNING scorer_id) SELECT scorer_id::text FROM x$q$, pg_temp.app('A-001'))),
  '00000000-0000-0000-0000-0000000000a3');
SELECT pg_temp.expect('the approver-to-be also scores this application',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a5', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id) VALUES ('11111111-1111-1111-1111-111111111111', %L,
    'oral', 20, 15, '00000000-0000-0000-0000-0000000000a5')$q$, pg_temp.app('A-001'))), 'ok:1');
SELECT pg_temp.expect('a score cannot be updated, even by the server',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_scores SET raw_score = 99$q$), 'err:42501');
SELECT pg_temp.expect('a scorer cannot update a score', pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a3',
  $q$UPDATE public.admission_scores SET raw_score = 99$q$), 'err:42501');
SELECT pg_temp.expect('a score cannot be deleted', pg_temp.try('service_role', '', $q$DELETE FROM public.admission_scores$q$), 'err:42501');
SELECT pg_temp.expect('a correction without a reason is refused',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a3', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id, corrects_score_id) VALUES ('11111111-1111-1111-1111-111111111111', %L,
    'motivation', 30, 75, '00000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a1')$q$, pg_temp.app('A-001'))), 'err:23514');
SELECT pg_temp.expect('a correction is a new row that references the old one, with a reason',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a3', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id, corrects_score_id, correction_reason) VALUES
    ('11111111-1111-1111-1111-111111111111', %L, 'motivation', 30, 75, '00000000-0000-0000-0000-0000000000a3',
    'a0000000-0000-0000-0000-0000000000a1', 'rubric level misread')$q$, pg_temp.app('A-001'))), 'ok:1');
SELECT pg_temp.expect('a score is corrected at most once',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id, corrects_score_id, correction_reason) VALUES
    ('11111111-1111-1111-1111-111111111111', %L, 'motivation', 30, 76, '00000000-0000-0000-0000-0000000000a3',
    'a0000000-0000-0000-0000-0000000000a1', 'second try at it')$q$, pg_temp.app('A-001'))), 'err:23505');
SELECT pg_temp.expect('a correction keeps the criterion',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id, corrects_score_id, correction_reason)
    SELECT '11111111-1111-1111-1111-111111111111', %L, 'other', 30, 76, '00000000-0000-0000-0000-0000000000a3', id, 'wrong criterion'
      FROM public.admission_scores WHERE criterion = 'oral'$q$, pg_temp.app('A-001'))), 'err:23514');
SELECT pg_temp.expect('a correction cannot reference a score of another application',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id, corrects_score_id, correction_reason)
    SELECT '11111111-1111-1111-1111-111111111111', %L, 'oral', 20, 1, '00000000-0000-0000-0000-0000000000a3', id, 'cross application'
      FROM public.admission_scores WHERE criterion = 'oral'$q$, pg_temp.app('A-002'))), 'err:23503');
SELECT pg_temp.expect('a score cannot be above its maximum',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_scores (org_id, application_id, criterion, weight, raw_score, scorer_id)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'x', 10, 101, '00000000-0000-0000-0000-0000000000a3')$q$, pg_temp.app('A-002'))), 'err:23514');
SELECT pg_temp.expect('a scorer cannot score for another organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a3', format($q$INSERT INTO public.admission_scores
    (org_id, application_id, criterion, weight, raw_score, scorer_id) VALUES ('22222222-2222-2222-2222-222222222222', %L, 'x', 10, 1,
    '00000000-0000-0000-0000-0000000000a3')$q$, pg_temp.app('B-001'))), 'err:42501');
SELECT pg_temp.expect('another organization cannot see the scores',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1', 'SELECT count(*)::text FROM public.admission_scores'), '0');

\echo == offers ==
SELECT pg_temp.expect('a drafter creates a draft offer; drafted_by is the caller',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a4', format($q$WITH x AS (INSERT INTO public.admission_offers
    (id, org_id, application_id, programme_id, expires_at, acceptance_fee_minor, drafted_by, approved_by) VALUES
    ('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', %L, 'd0000000-0000-0000-0000-0000000000a1',
     now() + interval '14 days', 2500000, '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a6')
    RETURNING drafted_by::text || '/' || coalesce(approved_by::text, 'none')) SELECT * FROM x$q$, pg_temp.app('A-001'))),
  '00000000-0000-0000-0000-0000000000a4/none');
SELECT pg_temp.expect('an offer cannot start as issued',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_offers (org_id, application_id, programme_id, status, drafted_by)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'd0000000-0000-0000-0000-0000000000a1', 'issued', '00000000-0000-0000-0000-0000000000a4')$q$,
    pg_temp.app('A-002'))), 'err:23514');
SELECT pg_temp.expect('one live offer per application',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_offers (org_id, application_id, programme_id, drafted_by)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'd0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4')$q$,
    pg_temp.app('A-001'))), 'err:23505');
SELECT pg_temp.expect('an offer cannot use another organization''s programme',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_offers (org_id, application_id, programme_id, drafted_by)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a4')$q$,
    pg_temp.app('A-002'))), 'err:23503');
SELECT pg_temp.expect('an offer cannot reference another organization''s application',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_offers (org_id, application_id, programme_id, drafted_by)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'd0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4')$q$,
    pg_temp.app('B-001'))), 'err:23503');
SELECT pg_temp.expect('a draft goes to approval',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a4', $q$UPDATE public.admission_offers SET status = 'pending_approval'
    WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'ok:1');
SELECT pg_temp.expect('the drafter cannot approve their own offer',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a4', $q$UPDATE public.admission_offers SET status = 'issued'
    WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'err:42501');
SELECT pg_temp.expect('a person who scored the application cannot approve its offer (rule on by default)',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a5', $q$UPDATE public.admission_offers SET status = 'issued'
    WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'err:42501');
SELECT pg_temp.expect('the server cannot issue an offer without a named approver',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_offers SET status = 'issued' WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'err:42501');
SELECT pg_temp.expect('terms cannot change once the offer left draft',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a4', $q$UPDATE public.admission_offers SET acceptance_fee_minor = 1
    WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'err:23514');
SELECT pg_temp.expect('a different officer who did not score approves and issues',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a6', $q$UPDATE public.admission_offers SET status = 'issued',
    approved_by = '00000000-0000-0000-0000-0000000000a4' WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'ok:1');
SELECT pg_temp.expect('approved_by and issued_by are the approver, not a client value',
  (SELECT approved_by::text || '/' || issued_by::text FROM public.admission_offers WHERE id = 'b0000000-0000-0000-0000-0000000000a1'),
  '00000000-0000-0000-0000-0000000000a6/00000000-0000-0000-0000-0000000000a6');
SELECT pg_temp.expect('an issued offer cannot go back to draft',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_offers SET status = 'draft' WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'err:23514');
SELECT pg_temp.expect('a current offer can be accepted',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_offers SET status = 'accepted' WHERE id = 'b0000000-0000-0000-0000-0000000000a1'$q$), 'ok:1');
SELECT pg_temp.expect('another organization cannot see the offers',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1', 'SELECT count(*)::text FROM public.admission_offers'), '0');
-- expiry: issue an offer that expires in two seconds, wait, try to accept
SELECT pg_temp.expect('fixture step', pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a4', format($q$INSERT INTO public.admission_offers
  (id, org_id, application_id, programme_id, expires_at, drafted_by) VALUES ('b0000000-0000-0000-0000-0000000000a2',
  '11111111-1111-1111-1111-111111111111', %L, 'd0000000-0000-0000-0000-0000000000a1', now() + interval '2 seconds',
  '00000000-0000-0000-0000-0000000000a4')$q$, pg_temp.app('A-002'))), 'ok:1');
SELECT pg_temp.expect('fixture step', pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a4', $q$UPDATE public.admission_offers SET status = 'pending_approval'
  WHERE id = 'b0000000-0000-0000-0000-0000000000a2'$q$), 'ok:1');
SELECT pg_temp.expect('the second offer is issued by a non-scorer',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a6', $q$UPDATE public.admission_offers SET status = 'issued'
    WHERE id = 'b0000000-0000-0000-0000-0000000000a2'$q$), 'ok:1');
SELECT pg_sleep(2.5) \g /dev/null
SELECT pg_temp.expect('an expired offer cannot be accepted',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_offers SET status = 'accepted' WHERE id = 'b0000000-0000-0000-0000-0000000000a2'$q$), 'err:23514');
SELECT pg_temp.expect('an expired offer can be marked expired',
  pg_temp.try('service_role', '', $q$UPDATE public.admission_offers SET status = 'expired' WHERE id = 'b0000000-0000-0000-0000-0000000000a2'$q$), 'ok:1');
-- the separation rule is per organization: B switches it off, then a scorer may approve
INSERT INTO public.admission_settings (org_id, score_offer_separation) VALUES ('22222222-2222-2222-2222-222222222222', false);
SELECT pg_temp.expect('fixture step', pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_scores (org_id, application_id, criterion, weight, raw_score, scorer_id)
  VALUES ('22222222-2222-2222-2222-222222222222', %L, 'oral', 10, 5, '00000000-0000-0000-0000-0000000000b1')$q$, pg_temp.app('B-001'))), 'ok:1');
SELECT pg_temp.expect('fixture step', pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000b2', format($q$INSERT INTO public.admission_offers
  (id, org_id, application_id, programme_id, drafted_by) VALUES ('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', %L,
  'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')$q$, pg_temp.app('B-001'))), 'ok:1');
SELECT pg_temp.expect('fixture step', pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000b2', $q$UPDATE public.admission_offers SET status = 'pending_approval'
  WHERE id = 'b0000000-0000-0000-0000-0000000000b1'$q$), 'ok:1');
SELECT pg_temp.expect('with the rule off, a scorer may approve (still not the drafter)',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000b1', $q$UPDATE public.admission_offers SET status = 'issued'
    WHERE id = 'b0000000-0000-0000-0000-0000000000b1'$q$), 'ok:1');
SELECT pg_temp.expect('staff cannot change the separation setting',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a1', $q$INSERT INTO public.admission_settings (org_id, score_offer_separation)
    VALUES ('11111111-1111-1111-1111-111111111111', false)$q$), 'err:42501');

\echo == documents ==
INSERT INTO public.admission_documents (org_id, application_id, kind, storage_path, size_bytes, mime_type, sha256, scan_status, scanned_at)
SELECT '11111111-1111-1111-1111-111111111111', id, v.kind, '11111111-1111-1111-1111-111111111111/' || id || '/' || v.kind || '.pdf', 1000,
       'application/pdf', repeat('a', 64), v.s, CASE WHEN v.s = 'pending' THEN NULL ELSE now() END
  FROM public.fixture_ids, (VALUES ('birth_record', 'clean'), ('photo', 'pending'), ('result_slip', 'rejected')) v(kind, s)
 WHERE fixture_ids.k = 'A-001';
INSERT INTO storage.objects (bucket_id, name) SELECT 'admission-documents', storage_path FROM public.admission_documents;
SELECT pg_temp.expect('staff with admissions.view see only the clean document',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a7', 'SELECT string_agg(kind, '','') FROM public.admission_documents'), 'birth_record');
SELECT pg_temp.expect('staff can download only the clean object from the private bucket',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a7', 'SELECT count(*)::text FROM storage.objects'), '1');
SELECT pg_temp.expect('even the organization admin cannot see unclean documents',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a1', $q$SELECT count(*)::text FROM public.admission_documents WHERE scan_status <> 'clean'$q$), '0');
SELECT pg_temp.expect('another organization sees no document and no object',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1',
    'SELECT (SELECT count(*) FROM public.admission_documents) + (SELECT count(*) FROM storage.objects)'), '0');
SELECT pg_temp.expect('a scorer without admissions.view sees no document',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a3', 'SELECT count(*)::text FROM public.admission_documents'), '0');
SELECT pg_temp.expect('staff cannot write document rows (server only)',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a1', $q$UPDATE public.admission_documents SET scan_status = 'clean'$q$), 'err:42501');
SELECT pg_temp.expect('a document path outside its organization and application is refused',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_documents (org_id, application_id, kind, storage_path, size_bytes, mime_type, sha256)
    VALUES ('11111111-1111-1111-1111-111111111111', %L, 'photo', '22222222-2222-2222-2222-222222222222/x/photo.png', 10, 'image/png', %L)$q$,
    pg_temp.app('A-001'), repeat('b', 64))), 'err:23514');
SELECT pg_temp.expect('an executable upload type is refused',
  pg_temp.try('service_role', '', format($q$INSERT INTO public.admission_documents (org_id, application_id, kind, storage_path, size_bytes, mime_type, sha256)
    VALUES ('11111111-1111-1111-1111-111111111111', %1$L, 'photo', '11111111-1111-1111-1111-111111111111/' || %1$L || '/a.exe', 10,
    'application/x-msdownload', %2$L)$q$, pg_temp.app('A-001'), repeat('b', 64))), 'err:23514');

\echo == cross-organization isolation for every new table ==
SELECT pg_temp.expect('the other organization''s admin sees none of organization A''s rows in any new table',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000b1', $q$SELECT (
      (SELECT count(*) FROM public.admission_settings WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_cycles WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_programmes WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_forms WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_question_bank WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_screenings WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_scores WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_offers WHERE org_id <> '22222222-2222-2222-2222-222222222222')
    + (SELECT count(*) FROM public.admission_documents WHERE org_id <> '22222222-2222-2222-2222-222222222222'))::text$q$), '0');
SELECT pg_temp.expect('organization A''s admin sees A''s cycles but not B''s',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a1',
    $q$SELECT count(*) FILTER (WHERE org_id = '11111111-1111-1111-1111-111111111111') || '/' || count(*) FILTER (WHERE org_id <> '11111111-1111-1111-1111-111111111111') FROM public.admission_cycles$q$), '3/0');
SELECT pg_temp.expect('staff cannot move a row into another organization',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000a2', $q$UPDATE public.admission_question_bank
    SET org_id = '22222222-2222-2222-2222-222222222222'$q$), 'err:42501');
SELECT pg_temp.expect('a signed-in person with no organization sees nothing',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000ff', 'SELECT (SELECT count(*) FROM public.admission_cycles) + (SELECT count(*) FROM public.admission_offers)'), '0');
SELECT pg_temp.expect('writes on the new tables are audited',
  (SELECT (count(DISTINCT table_name) >= 9)::text FROM public.audit_logs WHERE table_name LIKE 'admission\_%' AND table_name <> 'admission_applications'), 'true');

\echo == second run ==
\i database/supabase/migrations/20261117001400_sherivs_m11_admissions_model.sql
SELECT pg_temp.expect('after a second run the one-open-cycle rule still holds',
  pg_temp.try('service_role', '', $q$INSERT INTO public.admission_cycles (org_id, session_label, intake, opens_at, closes_at, status)
    VALUES ('11111111-1111-1111-1111-111111111111', '2027/2028', 'main', now(), now() + interval '1 day', 'open')$q$), 'err:23505');
SELECT pg_temp.expect('after a second run the tertiary columns are still hidden',
  pg_temp.val('authenticated', '00000000-0000-0000-0000-0000000000a1', 'SELECT max(utme_score)::text FROM public.admission_applications'), 'err:42501');
SELECT pg_temp.expect('after a second run anon still submits',
  pg_temp.try('anon', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-004')), 'ok:1');
SELECT pg_temp.expect('after a second run data is intact',
  (SELECT count(*)::text FROM public.admission_scores), '4');

\echo == rollback ==
\i database/supabase/rollbacks/20261117001400_sherivs_m11_admissions_model.sql
SELECT pg_temp.expect('rollback removes the nine tables and the functions',
  (SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'admission\_%' AND relkind = 'r')
  || '/' || (SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'admission%'), '1/0');
SELECT pg_temp.expect('rollback leaves admission_applications columns exactly as before (cycle_id, programme_id, form_version, jamb_reg_no, utme_score, caps_status, entry_mode removed)',
  (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.admission_applications'::regclass AND attnum > 0 AND NOT attisdropped), (SELECT cols FROM public.fixture_before));
SELECT pg_temp.expect('rollback leaves the constraints as before', (SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint
  WHERE conrelid = 'public.admission_applications'::regclass), (SELECT cons FROM public.fixture_before));
SELECT pg_temp.expect('rollback leaves the triggers as before', (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
  WHERE tgrelid = 'public.admission_applications'::regclass AND NOT tgisinternal), (SELECT trgs FROM public.fixture_before));
SELECT pg_temp.expect('rollback leaves the policies as before',
  (SELECT string_agg(policyname || '/' || cmd || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), ',' ORDER BY policyname)
     FROM pg_policies WHERE tablename = 'admission_applications'), (SELECT pols FROM public.fixture_before));
SELECT pg_temp.expect('rollback leaves the table grants as before',
  (SELECT string_agg(r || ':' || p, ',' ORDER BY r, p) FROM (SELECT g.grantee::regrole::text r, g.privilege_type p
     FROM pg_class c, aclexplode(c.relacl) g WHERE c.oid = 'public.admission_applications'::regclass) x), (SELECT acl FROM public.fixture_before));
SELECT pg_temp.expect('rollback leaves no column-level grant behind',
  (SELECT count(*)::text FROM pg_attribute WHERE attrelid = 'public.admission_applications'::regclass AND NOT attisdropped AND attacl IS NOT NULL), '0');
SELECT pg_temp.expect('after rollback anon still submits and reads nothing',
  pg_temp.try('anon', '', pg_temp.app_sql('11111111-1111-1111-1111-111111111111', 'A-005')) || '/' ||
  pg_temp.val('anon', '', 'SELECT count(*)::text FROM public.admission_applications'), 'ok:1/err:42501');
SELECT pg_temp.expect('after rollback the storage policy is gone (the bucket is dropped only when empty)',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'admission documents clean read'), '0');
\echo M11A ADMISSIONS MODEL TESTS PASSED
