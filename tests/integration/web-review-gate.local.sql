-- WEB-REVIEW: website_publish refuses a draft whose generated texts are still pending review. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WEBR FAIL: refusing to run outside the local disposable database';
  END IF;
  IF pg_get_functiondef('public.website_publish(uuid,text)'::regprocedure) NOT LIKE '%still need your review%' THEN
    RAISE EXCEPTION 'WEBR FAIL: the review-gate migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wr;
CREATE TABLE wr.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE wr.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO wr.ids (name) VALUES ('org'), ('org2'), ('admin'), ('admin2'), ('nobody');
CREATE FUNCTION wr.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM wr.ids WHERE name = p $$;
CREATE FUNCTION wr.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WEBR FAIL [%]', p_label; END IF;
  INSERT INTO wr.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION wr.err(p_label text, p_sql text, p_state text, p_like text DEFAULT '%') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND SQLERRM LIKE p_like THEN INSERT INTO wr.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'WEBR FAIL [%]: expected % like % got % (%)', p_label, p_state, p_like, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WEBR FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION wr.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', wr.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', wr.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION wr.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA wr TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA wr TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA wr TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wr TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM wr.ids WHERE name IN ('admin', 'admin2', 'nobody');
INSERT INTO public.schools (id, name, slug) VALUES (wr.id('org'), 'WEBR Org', 'webr-org'), (wr.id('org2'), 'WEBR Org Two', 'webr-org-two');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (wr.id('admin'), wr.id('org'), 'admin', 'admin@webr.invalid', 'admin', true),
  (wr.id('admin2'), wr.id('org2'), 'admin2', 'admin2@webr.invalid', 'admin', true),
  (wr.id('nobody'), wr.id('org'), 'nobody', 'nobody@webr.invalid', 'parent', true);
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES
  (wr.id('admin'), wr.id('org'), 'admin'), (wr.id('admin2'), wr.id('org2'), 'admin');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION wr.doc(p_extra jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schema', 1, 'locales', jsonb_build_array('en'),
    'theme', jsonb_build_object('primary', '#112233', 'secondary', '#445566', 'font', 'system', 'radius', 'soft'),
    'pages', jsonb_build_array(
      jsonb_build_object('id', 'p-home', 'slug', 'home', 'title', jsonb_build_object('en', 'Home'), 'nav', true,
        'sections', jsonb_build_array(jsonb_build_object('id', 'home-s0', 'background', 'default', 'layout', 'stack',
          'blocks', jsonb_build_array(jsonb_build_object('id', 'home-hero-0', 'type', 'hero', 'props', '{}'::jsonb))))))
    || p_extra)
$$;
-- A policies page with two sections; the second holds the pending block, to prove the check looks everywhere.
CREATE FUNCTION wr.policies(p_review text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(jsonb_build_object('id', 'p-policies', 'slug', 'policies', 'title', jsonb_build_object('en', 'Policies'), 'nav', false,
    'sections', jsonb_build_array(
      jsonb_build_object('id', 'policies-s0', 'background', 'default', 'layout', 'stack',
        'blocks', jsonb_build_array(jsonb_build_object('id', 'policies-rich-0', 'type', 'rich_text', 'props', jsonb_build_object('body', jsonb_build_object('en', 'Our own words'))))),
      jsonb_build_object('id', 'policies-s1', 'background', 'muted', 'layout', 'stack',
        'blocks', jsonb_build_array(jsonb_build_object('id', 'policies-policies-1', 'type', 'policies', 'variant', 'accordion', 'review', p_review, 'props', '{}'::jsonb))))))
$$;
GRANT EXECUTE ON FUNCTION wr.doc(jsonb), wr.policies(text) TO PUBLIC;

-- 1 a clean site publishes as before
SELECT wr.act('admin');
SELECT public.website_save_draft(wr.id('org'), wr.doc('[]'::jsonb), 0);
CREATE TEMP TABLE v1 AS SELECT public.website_publish(wr.id('org'), 'first') AS v;
GRANT SELECT ON v1 TO PUBLIC;
SELECT wr.back();
SELECT wr.ok('a site with no review marks publishes as version 1', (SELECT v = 1 FROM v1));

-- 2 a draft with a pending text can be saved, and the saved draft keeps the mark
SELECT wr.act('admin');
SELECT public.website_save_draft(wr.id('org'), wr.doc(wr.policies('pending')), 1);
SELECT wr.back();
SELECT wr.ok('the pending draft is saved with its mark',
  (SELECT jsonb_path_exists(draft, '$.pages[*].sections[*].blocks[*] ? (@.review == "pending")') FROM public.websites WHERE school_id = wr.id('org')));

-- 3 publishing is refused and says how many; nothing changes
SELECT wr.act('admin');
SELECT wr.err('publishing with a pending text is refused and names the count',
  format($q$SELECT public.website_publish(%L, 'second')$q$, wr.id('org')), '22023', '%1 generated text(s) still need your review%');
SELECT wr.back();
SELECT wr.ok('no new version was written and the live version is still 1',
  (SELECT count(*) = 1 FROM public.website_versions WHERE school_id = wr.id('org'))
  AND (SELECT published_version = 1 FROM public.websites WHERE school_id = wr.id('org')));

-- 4 two pending texts are both counted
SELECT wr.act('admin');
SELECT public.website_save_draft(wr.id('org'), wr.doc(
  (SELECT jsonb_set(wr.policies('pending'), '{0,sections,0,blocks,0,review}', '"pending"'))), 2);
SELECT wr.err('two pending texts are counted',
  format($q$SELECT public.website_publish(%L, 'x')$q$, wr.id('org')), '22023', '%2 generated text(s)%');
SELECT wr.back();

-- 5 accepted texts publish, and the document keeps the accepted mark
SELECT wr.act('admin');
SELECT public.website_save_draft(wr.id('org'), wr.doc(wr.policies('accepted')), 3);
CREATE TEMP TABLE v2 AS SELECT public.website_publish(wr.id('org'), 'after review') AS v;
GRANT SELECT ON v2 TO PUBLIC;
SELECT wr.back();
SELECT wr.ok('an accepted text publishes as version 2', (SELECT v = 2 FROM v2));
SELECT wr.ok('the published document keeps the accepted mark',
  (SELECT jsonb_path_exists(document, '$.pages[*].sections[*].blocks[*] ? (@.review == "accepted")') FROM public.website_versions WHERE school_id = wr.id('org') AND version = 2));

-- 6 removing the pending text (a draft with none) also publishes
SELECT wr.act('admin');
SELECT public.website_save_draft(wr.id('org'), wr.doc('[]'::jsonb), 4);
SELECT wr.ok('a draft with the pending text removed publishes as version 3', public.website_publish(wr.id('org'), 'removed') = 3);
SELECT wr.back();

-- 7 authorisation and tenancy are unchanged
SELECT wr.act('nobody');
SELECT wr.err('a user without website.manage is still refused',
  format($q$SELECT public.website_publish(%L, 'x')$q$, wr.id('org')), '42501');
SELECT wr.back();
SELECT wr.act('admin2');
SELECT wr.err('another school admin cannot publish this school',
  format($q$SELECT public.website_publish(%L, 'x')$q$, wr.id('org')), '42501');
SELECT wr.back();

-- 8 rollback to an earlier published version still works
SELECT wr.act('admin');
SELECT wr.ok('rolling back to version 1 still works', public.website_rollback(wr.id('org'), 1) IS NOT NULL);
SELECT wr.back();

DO $done$ BEGIN RAISE NOTICE 'WEBR ALL PASS: % checks', (SELECT count(*) FROM wr.passed); END $done$;
ROLLBACK;
