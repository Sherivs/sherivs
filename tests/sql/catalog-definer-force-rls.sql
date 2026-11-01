-- Disposable proof: FORCE RLS on the six catalogs breaks SECURITY DEFINER
-- functions whose owner has neither superuser nor BYPASSRLS, and
-- 20261029001100 restores exactly that path.
-- Run as a superuser against an empty database:
--   sudo -u postgres psql -d catalog_rls_test -v ON_ERROR_STOP=1 -f tests/sql/catalog-definer-force-rls.sql
\set ON_ERROR_STOP on
\echo == setup roles, catalogs, and production-shaped policies ==

DROP ROLE IF EXISTS anon, authenticated, service_role, app_owner;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE app_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, app_owner;

CREATE TABLE public.website_block_types (
  key text PRIMARY KEY, label text NOT NULL, category text NOT NULL,
  data_source text, variants text[] NOT NULL DEFAULT '{}',
  opt_in boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.websites (
  school_id uuid PRIMARY KEY, draft jsonb NOT NULL, draft_rev integer NOT NULL DEFAULT 1,
  published_version integer, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.website_versions (
  id bigserial PRIMARY KEY, school_id uuid NOT NULL, version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL, source text NOT NULL CHECK (source IN ('publish', 'rollback')),
  note text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, version));
CREATE TABLE public.website_audit (
  id bigserial PRIMARY KEY, school_id uuid NOT NULL, actor uuid, action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.exam_bodies (
  code text PRIMARY KEY, name text NOT NULL, min_subjects int NOT NULL, max_subjects int NOT NULL,
  default_levels text[] NOT NULL, note text);
CREATE TABLE public.connector_manifests (
  key text PRIMARY KEY, name text NOT NULL, version text NOT NULL DEFAULT '1.0.0',
  category text NOT NULL, auth_type text NOT NULL, entities text[] NOT NULL,
  directions text[] NOT NULL DEFAULT ARRAY['inbound'], status text NOT NULL DEFAULT 'beta',
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true), '')::jsonb->>'role' = 'service_role'
      OR coalesce(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
         = '11111111-1111-1111-1111-111111111111'
$$;

CREATE FUNCTION public._website_validate(p_doc jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_types text[]; blk text;
BEGIN
  blk := p_doc #>> '{pages,0,sections,0,blocks,0,type}';
  SELECT array_agg(key) INTO v_types FROM public.website_block_types WHERE is_active;
  IF NOT (coalesce(blk, '') = ANY (v_types)) THEN
    RAISE EXCEPTION 'website: unknown block %', blk USING ERRCODE = '22023';
  END IF;
END $$;

CREATE FUNCTION public._website_data(p_school uuid, p_doc jsonb, p_all boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce((SELECT jsonb_agg(key ORDER BY key) FROM public.website_block_types WHERE is_active), '[]'::jsonb);
END $$;

CREATE FUNCTION public.website_public(p_host text DEFAULT NULL, p_slug text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc jsonb; v_ver int;
BEGIN
  SELECT w.published_version, v.document INTO v_ver, v_doc
    FROM public.websites w
    JOIN public.website_versions v ON v.school_id = w.school_id AND v.version = w.published_version
   WHERE w.school_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  RETURN jsonb_build_object('version', v_ver, 'document', v_doc);
END $$;

CREATE FUNCTION public.website_get(p_school uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w record; n int;
BEGIN
  IF NOT public.scholar_can(p_school, 'website.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.websites WHERE school_id = p_school;
  SELECT count(*) INTO n FROM public.website_versions WHERE school_id = p_school;
  RETURN jsonb_build_object('exists', w.school_id IS NOT NULL, 'draft_rev', w.draft_rev, 'versions', n);
END $$;

CREATE FUNCTION public.website_save_draft(p_school uuid, p_document jsonb, p_expected_rev integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rev int;
BEGIN
  IF NOT public.scholar_can(p_school, 'website.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public._website_validate(p_document);
  SELECT draft_rev INTO v_rev FROM public.websites WHERE school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN
    IF coalesce(p_expected_rev, 0) <> 0 THEN RAISE EXCEPTION 'website: the site was removed; reload' USING ERRCODE = '40001'; END IF;
    INSERT INTO public.websites (school_id, draft, draft_rev) VALUES (p_school, p_document, 1);
    INSERT INTO public.website_audit (school_id, actor, action) VALUES (p_school, NULL, 'create');
    RETURN 1;
  END IF;
  IF p_expected_rev IS DISTINCT FROM v_rev THEN RAISE EXCEPTION 'website: someone else saved changes; reload to continue' USING ERRCODE = '40001'; END IF;
  UPDATE public.websites SET draft = p_document, draft_rev = v_rev + 1 WHERE school_id = p_school;
  RETURN v_rev + 1;
END $$;

CREATE FUNCTION public.website_publish(p_school uuid, p_note text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w record; v_next int;
BEGIN
  IF NOT public.scholar_can(p_school, 'website.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.websites WHERE school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'website: nothing to publish yet' USING ERRCODE = '22023'; END IF;
  PERFORM public._website_validate(w.draft);
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.website_versions WHERE school_id = p_school;
  INSERT INTO public.website_versions (school_id, version, document, source, note)
  VALUES (p_school, v_next, w.draft, 'publish', left(p_note, 300));
  UPDATE public.websites SET published_version = v_next WHERE school_id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action, detail)
  VALUES (p_school, NULL, 'publish', jsonb_build_object('version', v_next));
  RETURN v_next;
END $$;

CREATE FUNCTION public.website_rollback(p_school uuid, p_version integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc jsonb; v_next int;
BEGIN
  IF NOT public.scholar_can(p_school, 'website.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.websites WHERE school_id = p_school FOR UPDATE;
  SELECT document INTO v_doc FROM public.website_versions WHERE school_id = p_school AND version = p_version;
  IF v_doc IS NULL THEN RAISE EXCEPTION 'website: version % not found', p_version USING ERRCODE = '22023'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.website_versions WHERE school_id = p_school;
  INSERT INTO public.website_versions (school_id, version, document, source, note)
  VALUES (p_school, v_next, v_doc, 'rollback', 'Restored version ' || p_version);
  UPDATE public.websites SET published_version = v_next, draft = v_doc, draft_rev = draft_rev + 1 WHERE school_id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action) VALUES (p_school, NULL, 'rollback');
  RETURN v_next;
END $$;

CREATE FUNCTION public.exam_window_upsert(p_org uuid, p_body text, p_year int, p_opens date, p_closes date,
  p_late_closes date DEFAULT NULL, p_fee numeric DEFAULT 0, p_late_fee numeric DEFAULT 0, p_levels text[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.exam_bodies WHERE code = p_body) THEN
    RAISE EXCEPTION 'unknown exam body';
  END IF;
  RETURN gen_random_uuid();
END $$;

CREATE FUNCTION public.exam_candidate_register(p_window uuid, p_student uuid, p_subjects text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  SELECT min_subjects INTO n FROM public.exam_bodies WHERE code = 'WAEC_WASSCE';
  IF n IS NULL THEN RAISE EXCEPTION 'exam body invisible'; END IF;
  RETURN jsonb_build_object('min', n);
END $$;

CREATE FUNCTION public.integration_connect(p_school uuid, p_connector text, p_name text, p_mode text DEFAULT 'mirror')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m text;
BEGIN
  SELECT key INTO m FROM public.connector_manifests WHERE key = p_connector AND status <> 'retired';
  IF m IS NULL THEN RAISE EXCEPTION 'unknown connector %', p_connector USING ERRCODE = '22023'; END IF;
  RETURN gen_random_uuid();
END $$;

CREATE FUNCTION public.integration_set_outbound(p_integration uuid, p_enabled boolean, p_config jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  SELECT key INTO k FROM public.connector_manifests
   WHERE key = 'rest-webhook' AND 'outbound' = ANY (directions);
  IF p_enabled AND k IS NULL THEN
    RAISE EXCEPTION 'connector % has no outbound support', 'rest-webhook' USING ERRCODE = '22023';
  END IF;
END $$;

ALTER TABLE public.website_block_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_block_types_read ON public.website_block_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY websites_read ON public.websites FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'website.manage'));
CREATE POLICY website_versions_read ON public.website_versions FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'website.manage'));
CREATE POLICY website_audit_read ON public.website_audit FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'website.manage'));
CREATE POLICY exam_bodies_read ON public.exam_bodies FOR SELECT TO authenticated USING (true);
CREATE POLICY connector_manifests_read ON public.connector_manifests FOR SELECT TO authenticated USING (status <> 'retired');

REVOKE ALL ON public.websites, public.website_versions, public.website_audit FROM anon;
GRANT SELECT ON public.website_block_types TO anon, authenticated;
GRANT SELECT ON public.websites, public.website_versions, public.website_audit TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.websites, public.website_versions, public.website_audit, public.website_block_types
  TO anon, authenticated;
\echo == revoke direct client writes; preserve catalog reads ==
\ir ../../database/supabase/migrations/20261030000100_sherivs_catalog_revoke_client_writes.sql
\ir ../../database/supabase/migrations/20261030000100_sherivs_catalog_revoke_client_writes.sql
DO $client_catalog_privileges$
DECLARE
  v_role text;
  v_table text;
  v_privilege text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'websites', 'website_versions', 'website_audit', 'website_block_types'
    ] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'FAIL: % retains % on %', v_role, v_privilege, v_table;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT has_table_privilege('anon', 'public.website_block_types', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.website_block_types', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.websites', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.website_versions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.website_audit', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a client SELECT grant changed';
  END IF;
END
$client_catalog_privileges$;
REVOKE ALL ON public.exam_bodies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exam_bodies TO authenticated;
REVOKE ALL ON public.connector_manifests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.connector_manifests TO authenticated;
GRANT ALL ON public.connector_manifests TO service_role;
GRANT SELECT ON public.websites, public.exam_bodies, public.website_block_types TO service_role;

REVOKE ALL ON FUNCTION public.website_public(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_public(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.website_get(uuid), public.website_save_draft(uuid, jsonb, integer),
  public.website_publish(uuid, text), public.website_rollback(uuid, integer),
  public.exam_window_upsert(uuid, text, int, date, date, date, numeric, numeric, text[]),
  public.exam_candidate_register(uuid, uuid, text[]),
  public.integration_connect(uuid, text, text, text),
  public.integration_set_outbound(uuid, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_get(uuid), public.website_save_draft(uuid, jsonb, integer),
  public.website_publish(uuid, text), public.website_rollback(uuid, integer),
  public.exam_window_upsert(uuid, text, int, date, date, date, numeric, numeric, text[]),
  public.exam_candidate_register(uuid, uuid, text[]),
  public.integration_connect(uuid, text, text, text),
  public.integration_set_outbound(uuid, boolean, jsonb) TO authenticated;

ALTER TABLE public.website_block_types OWNER TO app_owner;
ALTER TABLE public.websites OWNER TO app_owner;
ALTER TABLE public.website_versions OWNER TO app_owner;
ALTER TABLE public.website_audit OWNER TO app_owner;
ALTER TABLE public.exam_bodies OWNER TO app_owner;
ALTER TABLE public.connector_manifests OWNER TO app_owner;
ALTER SEQUENCE public.website_versions_id_seq OWNER TO app_owner;
ALTER SEQUENCE public.website_audit_id_seq OWNER TO app_owner;
ALTER FUNCTION public.scholar_can(uuid, text) OWNER TO app_owner;
ALTER FUNCTION public._website_validate(jsonb) OWNER TO app_owner;
ALTER FUNCTION public._website_data(uuid, jsonb, boolean) OWNER TO app_owner;
ALTER FUNCTION public.website_public(text, text) OWNER TO app_owner;
ALTER FUNCTION public.website_get(uuid) OWNER TO app_owner;
ALTER FUNCTION public.website_save_draft(uuid, jsonb, integer) OWNER TO app_owner;
ALTER FUNCTION public.website_publish(uuid, text) OWNER TO app_owner;
ALTER FUNCTION public.website_rollback(uuid, integer) OWNER TO app_owner;
ALTER FUNCTION public.exam_window_upsert(uuid, text, int, date, date, date, numeric, numeric, text[]) OWNER TO app_owner;
ALTER FUNCTION public.exam_candidate_register(uuid, uuid, text[]) OWNER TO app_owner;
ALTER FUNCTION public.integration_connect(uuid, text, text, text) OWNER TO app_owner;
ALTER FUNCTION public.integration_set_outbound(uuid, boolean, jsonb) OWNER TO app_owner;

INSERT INTO public.website_block_types (key, label, category) VALUES ('hero', 'Hero', 'identity');
INSERT INTO public.exam_bodies VALUES ('WAEC_WASSCE', 'WAEC', 7, 9, ARRAY['SS3'], NULL);
INSERT INTO public.connector_manifests (key, name, category, auth_type, entities, directions, status)
VALUES ('rest-webhook', 'REST', 'api', 'hmac_webhook', ARRAY['student'], ARRAY['inbound', 'outbound'], 'beta');
INSERT INTO public.websites (school_id, draft, draft_rev, published_version)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 1, 1);
INSERT INTO public.website_versions (school_id, version, document, source)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 'publish');

-- Before FORCE the owner bypasses RLS. This is the production behavior today.
SET ROLE app_owner;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
DECLARE v int; pub jsonb;
BEGIN
  v := public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 0);
  IF v <> 1 THEN RAISE EXCEPTION 'FAIL: owner save before FORCE returned %', v; END IF;
  pub := public.website_public(NULL, NULL);
  IF pub->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: public read before FORCE %', pub; END IF;
  PERFORM public.exam_window_upsert('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WAEC_WASSCE', 2026, CURRENT_DATE, CURRENT_DATE);
  PERFORM public.integration_connect('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rest-webhook', 'x', 'mirror');
  PERFORM public.integration_set_outbound('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, NULL);
END $$;
RESET ROLE;
DELETE FROM public.websites WHERE school_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DELETE FROM public.website_audit WHERE school_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

\echo == FORCE the six catalogs (the approved migration) ==
ALTER TABLE public.websites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_block_types FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bodies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connector_manifests FORCE ROW LEVEL SECURITY;

\echo == owner without BYPASSRLS is now denied ==
SET ROLE app_owner;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
DECLARE pub jsonb; n int; msg text;
BEGIN
  pub := public.website_public(NULL, NULL);
  IF pub->>'version' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: public read still returned a version after FORCE: %', pub;
  END IF;
  SELECT count(*) INTO n FROM public.website_block_types;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: owner still sees % block types', n; END IF;
  SELECT count(*) INTO n FROM public.exam_bodies;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: owner still sees % exam bodies', n; END IF;

  BEGIN
    PERFORM public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 0);
    RAISE EXCEPTION 'FAIL: save_draft succeeded under FORCE without a definer policy';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.exam_window_upsert('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WAEC_WASSCE', 2026, CURRENT_DATE, CURRENT_DATE);
    RAISE EXCEPTION 'FAIL: exam_window_upsert succeeded while the catalog was invisible';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%unknown exam body%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.integration_connect('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rest-webhook', 'x', 'mirror');
    RAISE EXCEPTION 'FAIL: integration_connect succeeded while the catalog was invisible';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%unknown connector%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.integration_set_outbound('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, NULL);
    RAISE EXCEPTION 'FAIL: set_outbound succeeded while the catalog was invisible';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%no outbound support%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

\echo == service_role still bypasses ==
SET ROLE service_role;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.exam_bodies;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: service_role saw % exam bodies', n; END IF;
  SELECT count(*) INTO n FROM public.websites;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: service_role saw % websites', n; END IF;
END $$;
RESET ROLE;

\echo == apply definer policies ==
\ir ../../database/supabase/migrations/20261029001100_sherivs_catalog_definer_rls_policies.sql

\echo == same functions, still as the non-bypass owner, now succeed ==
SET ROLE app_owner;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
DECLARE v int; pub jsonb; got jsonb; n int;
BEGIN
  pub := public.website_public(NULL, NULL);
  IF pub->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: public read after policy %', pub; END IF;
  IF (public._website_data('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, false))::text NOT LIKE '%hero%' THEN
    RAISE EXCEPTION 'FAIL: block catalog still invisible to _website_data';
  END IF;
  v := public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 0);
  IF v <> 1 THEN RAISE EXCEPTION 'FAIL: save_draft returned %', v; END IF;
  v := public.website_publish('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'first');
  IF v <> 1 THEN RAISE EXCEPTION 'FAIL: publish returned %', v; END IF;
  v := public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 1);
  IF v <> 2 THEN RAISE EXCEPTION 'FAIL: second save returned %', v; END IF;
  v := public.website_publish('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'second');
  IF v <> 2 THEN RAISE EXCEPTION 'FAIL: second publish returned %', v; END IF;
  v := public.website_rollback('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1);
  IF v <> 3 THEN RAISE EXCEPTION 'FAIL: rollback returned %', v; END IF;
  got := public.website_get('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  IF (got->>'versions')::int <> 3 THEN RAISE EXCEPTION 'FAIL: version history %', got; END IF;
  BEGIN
    PERFORM public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '{"pages":[{"sections":[{"blocks":[{"type":"not_a_block"}]}]}]}'::jsonb, 2);
    RAISE EXCEPTION 'FAIL: unknown block was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '22023' THEN RAISE; END IF;
  END;
  PERFORM public.exam_window_upsert('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WAEC_WASSCE', 2026, CURRENT_DATE, CURRENT_DATE);
  got := public.exam_candidate_register('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ARRAY['English']);
  IF (got->>'min')::int <> 7 THEN RAISE EXCEPTION 'FAIL: exam body min %', got; END IF;
  PERFORM public.integration_connect('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rest-webhook', 'x', 'mirror');
  PERFORM public.integration_set_outbound('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, NULL);

  -- Owner writes without the manager predicate stay denied. DELETE stays denied.
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.websites (school_id, draft) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: owner insert without scholar_can succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  DELETE FROM public.websites WHERE school_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: owner deleted % website rows', n; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  UPDATE public.website_versions SET note = 'x' WHERE school_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: owner updated % immutable versions', n; END IF;
END $$;
RESET ROLE;

\echo == authenticated caller runs the definer as the non-bypass owner ==
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
DECLARE v int;
BEGIN
  v := public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 3);
  IF v <> 4 THEN RAISE EXCEPTION 'FAIL: authenticated save returned %', v; END IF;
  PERFORM public.exam_window_upsert('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WAEC_WASSCE', 2026, CURRENT_DATE, CURRENT_DATE);
  PERFORM public.integration_set_outbound('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, NULL);
END $$;
RESET ROLE;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.websites WHERE school_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: published website disappeared (% )', n; END IF;
END $$;

\echo == client roles are unchanged ==
SET ROLE anon;
DO $$
DECLARE n int; pub jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.website_block_types;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: anon block catalog count %', n; END IF;
  BEGIN
    PERFORM count(*) FROM public.websites;
    RAISE EXCEPTION 'FAIL: anon selected websites';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  pub := public.website_public(NULL, NULL);
  IF pub->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: anon public RPC %', pub; END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.exam_bodies;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: authenticated exam catalog %', n; END IF;
  SELECT count(*) INTO n FROM public.websites;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: other user sees % websites', n; END IF;
  BEGIN
    INSERT INTO public.websites (school_id, draft) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: authenticated inserted a website';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.website_save_draft('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 2);
    RAISE EXCEPTION 'FAIL: non-manager save succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE '%definer%'
      AND roles::text[] && ARRAY['anon', 'authenticated', 'public']::text[]
  ) THEN
    RAISE EXCEPTION 'FAIL: a definer policy names a client role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'websites_read' AND 'authenticated' = ANY (roles::text[])) THEN
    RAISE EXCEPTION 'FAIL: client websites_read policy missing';
  END IF;
END $$;

\echo == re-apply is idempotent ==
\ir ../../database/supabase/migrations/20261029001100_sherivs_catalog_definer_rls_policies.sql
SET ROLE app_owner;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
BEGIN
  IF public.website_public(NULL, NULL)->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'FAIL: public read failed after re-apply';
  END IF;
END $$;
RESET ROLE;

\echo == bypass owner: policies are removed and functions still work ==
ALTER ROLE app_owner BYPASSRLS;
\ir ../../database/supabase/migrations/20261029001100_sherivs_catalog_definer_rls_policies.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%definer%') THEN
    RAISE EXCEPTION 'FAIL: definer policies remained for a BYPASSRLS owner';
  END IF;
END $$;
SET ROLE app_owner;
DO $$
BEGIN
  PERFORM public.exam_window_upsert('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WAEC_WASSCE', 2026, CURRENT_DATE, CURRENT_DATE);
END $$;
RESET ROLE;

\echo == removing bypass restores the policies ==
ALTER ROLE app_owner NOBYPASSRLS;
\ir ../../database/supabase/migrations/20261029001100_sherivs_catalog_definer_rls_policies.sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%definer%';
  IF n <> 9 THEN RAISE EXCEPTION 'FAIL: expected 9 definer policies, found %', n; END IF;
END $$;

\echo == rollback returns owner bypass-without-FORCE and keeps client policies ==
\ir ../../database/supabase/rollbacks/20261029001100_sherivs_catalog_definer_rls_policies.sql
\ir ../../database/supabase/rollbacks/20261029001000_sherivs_force_rls_catalog_tables.sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname IN
     ('websites','website_versions','website_block_types','website_audit','exam_bodies','connector_manifests')
     AND c.relforcerowsecurity;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % catalogs still forced after rollback', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE '%definer%') THEN
    RAISE EXCEPTION 'FAIL: definer policy survived rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'exam_bodies_read') THEN
    RAISE EXCEPTION 'FAIL: client exam policy dropped by rollback';
  END IF;
END $$;
SET ROLE app_owner;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
DECLARE v int;
BEGIN
  v := public.website_save_draft('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '{"pages":[{"sections":[{"blocks":[{"type":"hero"}]}]}]}'::jsonb, 0);
  IF v <> 1 THEN RAISE EXCEPTION 'FAIL: owner save after rollback returned %', v; END IF;
END $$;
RESET ROLE;

\echo HARNESS PASS
SELECT 'catalog definer force rls' AS harness, true AS ok;
