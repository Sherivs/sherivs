-- SHERIVS-101 Website Engine v2: content types (blog posts, policies, rules, calendar, downloads, careers, PTA),
-- brand theming fields (font pairing, dark scheme, footer credit, crest, favicon/OG), more layout variants,
-- post authoring roles, and a brand-colour setter on the existing org branding fields.
-- Additive: no existing column or row is changed except website_block_types variants (superset) and the two
-- website helper functions (validator extended; data bundle wrapped). Rollback: ../rollbacks/20261025100260_sherivs_101_website_v2.sql
BEGIN;

-- 1. Block catalog: new content types + extra variants (supersets of v1, so stored documents stay valid).
INSERT INTO public.website_block_types (key, label, category, data_source, variants, opt_in) VALUES
  ('blog', 'Blog & news posts', 'updates', 'website_posts', ARRAY['featured', 'grid', 'list']::text[], false),
  ('policies', 'Policies', 'policies', NULL, ARRAY['accordion', 'cards']::text[], false),
  ('rules', 'School rules & code of conduct', 'policies', NULL, ARRAY['grouped', 'numbered']::text[], false),
  ('calendar', 'Term dates & calendar', 'updates', NULL, ARRAY['table', 'timeline']::text[], false),
  ('downloads', 'Downloads & forms', 'content', NULL, ARRAY['list', 'grid']::text[], false),
  ('careers', 'Careers & vacancies', 'community', NULL, ARRAY['list', 'cards']::text[], false),
  ('pta', 'Parents (PTA)', 'community', NULL, ARRAY['panel', 'split']::text[], false)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category, data_source = EXCLUDED.data_source,
  variants = EXCLUDED.variants, opt_in = EXCLUDED.opt_in, is_active = true;
UPDATE public.website_block_types SET variants = ARRAY['centered', 'split', 'minimal', 'banner', 'crest']::text[] WHERE key = 'hero';
UPDATE public.website_block_types SET variants = ARRAY['prose', 'pillars', 'split']::text[] WHERE key = 'about';
UPDATE public.website_block_types SET variants = ARRAY['band', 'cards']::text[] WHERE key = 'stats';
UPDATE public.website_block_types SET variants = ARRAY['grid', 'list', 'feature']::text[] WHERE key = 'facilities';
UPDATE public.website_block_types SET variants = ARRAY['grid', 'strip', 'mosaic']::text[] WHERE key = 'gallery';
UPDATE public.website_block_types SET variants = ARRAY['cards', 'list', 'tiles']::text[] WHERE key = 'sections_offered';
UPDATE public.website_block_types SET variants = ARRAY['accordion', 'columns']::text[] WHERE key = 'faqs';

-- 2. Permissions: authors write post drafts; website managers publish (separation of writing and publishing).
INSERT INTO public.permission_catalog (code, module, label, sensitivity, protected)
VALUES ('website.posts', 'communication', 'Write website blog/news posts (drafts)', 'internal', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on)
SELECT t.code, 'website.posts', 'optional', true
FROM public.role_templates t WHERE t.code IN ('pr', 'admissions', 'alumni', 'deputy_admin', 'ict_staff', 'student_affairs')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on)
SELECT t.code, 'website.manage', 'optional', true FROM public.role_templates t WHERE t.code IN ('pr')
ON CONFLICT DO NOTHING;

-- 3. Blog posts. Published = status 'published' and publish_at <= now() (a future publish_at is "scheduled").
CREATE TABLE IF NOT EXISTS public.website_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  title jsonb NOT NULL CHECK (jsonb_typeof(title) = 'object'),
  excerpt jsonb CHECK (excerpt IS NULL OR jsonb_typeof(excerpt) = 'object'),
  body jsonb CHECK (body IS NULL OR jsonb_typeof(body) = 'object'),
  category text CHECK (category IS NULL OR length(category) <= 40),
  cover_url text CHECK (cover_url IS NULL OR (length(cover_url) <= 500 AND cover_url ~ '^(https://|/)[^\s"<>]*$')),
  author_name text CHECK (author_name IS NULL OR length(author_name) <= 80),
  seo jsonb CHECK (seo IS NULL OR jsonb_typeof(seo) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  publish_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, slug),
  CHECK (status = 'draft' OR publish_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS website_posts_pub_idx ON public.website_posts (school_id, publish_at DESC) WHERE status = 'published';
ALTER TABLE public.website_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_posts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS website_posts_read ON public.website_posts;
CREATE POLICY website_posts_read ON public.website_posts FOR SELECT TO authenticated
  USING (public.scholar_can(school_id, 'website.manage') OR public.scholar_can(school_id, 'website.posts'));
REVOKE ALL ON public.website_posts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.website_posts FROM authenticated;
GRANT SELECT ON public.website_posts TO authenticated;

-- 4. Document validator: v2 theme fields (pairing, dark, credit, crest) and seo (favicon, og_image).
CREATE OR REPLACE FUNCTION public._website_validate(p_doc jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  pg jsonb; sec jsonb; blk jsonb; v_slugs text[] := '{}'; v_ids text[] := '{}'; v_blocks int := 0;
  v_types text[]; v_variants text[];
BEGIN
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' OR p_doc->>'schema' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'website: document must be an object with schema 1' USING ERRCODE = '22023'; END IF;
  IF octet_length(p_doc::text) > 600000 THEN RAISE EXCEPTION 'website: site is too large' USING ERRCODE = '22023'; END IF;
  IF p_doc::text ~* '"\s*(javascript|vbscript|data|file)\s*:' THEN
    RAISE EXCEPTION 'website: script or data URLs are not allowed' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_doc->'locales') <> 'array' OR jsonb_array_length(p_doc->'locales') < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_doc->'locales') l WHERE l NOT IN ('en', 'ha', 'yo', 'ig', 'pcm')) THEN
    RAISE EXCEPTION 'website: locales must be en, ha, yo, ig or pcm' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_doc#>>'{theme,primary}', '') !~ '^#[0-9a-fA-F]{6}$' OR coalesce(p_doc#>>'{theme,secondary}', '') !~ '^#[0-9a-fA-F]{6}$'
     OR coalesce(p_doc#>>'{theme,font}', 'system') NOT IN ('system', 'serif', 'rounded')
     OR coalesce(p_doc#>>'{theme,radius}', 'soft') NOT IN ('square', 'soft', 'round')
     OR coalesce(p_doc#>>'{theme,pairing}', 'classic') NOT IN ('classic', 'scholarly', 'modern', 'friendly', 'civic', 'heritage')
     OR coalesce(p_doc#>>'{theme,dark}', 'auto') NOT IN ('auto', 'light', 'dark')
     OR (p_doc#>'{theme,credit}' IS NOT NULL AND jsonb_typeof(p_doc#>'{theme,credit}') <> 'boolean')
     OR (p_doc ? 'seo' AND jsonb_typeof(p_doc->'seo') <> 'object')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY[p_doc#>>'{theme,logo}', p_doc#>>'{theme,crest}', p_doc#>>'{seo,favicon}', p_doc#>>'{seo,og_image}']) u
                WHERE u IS NOT NULL AND u <> '' AND (length(u) > 500 OR u !~ '^(https://|/)[^\s"<>]*$')) THEN
    RAISE EXCEPTION 'website: invalid theme' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_doc->'pages') <> 'array' OR jsonb_array_length(p_doc->'pages') NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'website: 1 to 60 pages' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(key) INTO v_types FROM public.website_block_types WHERE is_active;
  FOR pg IN SELECT * FROM jsonb_array_elements(p_doc->'pages') LOOP
    IF coalesce(pg->>'slug', '') !~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$' THEN
      RAISE EXCEPTION 'website: invalid page slug %', pg->>'slug' USING ERRCODE = '22023'; END IF;
    IF (pg->>'slug') = ANY (v_slugs) THEN RAISE EXCEPTION 'website: duplicate page %', pg->>'slug' USING ERRCODE = '22023'; END IF;
    v_slugs := v_slugs || (pg->>'slug');
    IF coalesce(pg->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' OR (pg->>'id') = ANY (v_ids) THEN
      RAISE EXCEPTION 'website: bad or duplicate id %', pg->>'id' USING ERRCODE = '22023'; END IF;
    v_ids := v_ids || (pg->>'id');
    IF jsonb_typeof(pg->'sections') <> 'array' OR jsonb_array_length(pg->'sections') > 40 THEN
      RAISE EXCEPTION 'website: page % has invalid sections', pg->>'slug' USING ERRCODE = '22023'; END IF;
    FOR sec IN SELECT * FROM jsonb_array_elements(pg->'sections') LOOP
      IF coalesce(sec->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' OR (sec->>'id') = ANY (v_ids) THEN
        RAISE EXCEPTION 'website: bad or duplicate id %', sec->>'id' USING ERRCODE = '22023'; END IF;
      v_ids := v_ids || (sec->>'id');
      IF coalesce(sec->>'background', 'default') NOT IN ('default', 'muted', 'brand') OR coalesce(sec->>'layout', 'stack') NOT IN ('stack', 'split') THEN
        RAISE EXCEPTION 'website: invalid section style' USING ERRCODE = '22023'; END IF;
      IF jsonb_typeof(sec->'blocks') <> 'array' OR jsonb_array_length(sec->'blocks') > 20 THEN
        RAISE EXCEPTION 'website: invalid blocks in a section of %', pg->>'slug' USING ERRCODE = '22023'; END IF;
      FOR blk IN SELECT * FROM jsonb_array_elements(sec->'blocks') LOOP
        v_blocks := v_blocks + 1;
        IF coalesce(blk->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' OR (blk->>'id') = ANY (v_ids) THEN
          RAISE EXCEPTION 'website: bad or duplicate id %', blk->>'id' USING ERRCODE = '22023'; END IF;
        v_ids := v_ids || (blk->>'id');
        IF NOT (coalesce(blk->>'type', '') = ANY (v_types)) THEN
          RAISE EXCEPTION 'website: unknown block %', blk->>'type' USING ERRCODE = '22023'; END IF;
        IF blk ? 'variant' AND blk->>'variant' IS NOT NULL THEN
          SELECT variants INTO v_variants FROM public.website_block_types WHERE key = blk->>'type';
          IF NOT ((blk->>'variant') = ANY (v_variants)) THEN
            RAISE EXCEPTION 'website: % has no variant %', blk->>'type', blk->>'variant' USING ERRCODE = '22023'; END IF;
        END IF;
        IF jsonb_typeof(blk->'props') IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'website: % props must be an object', blk->>'type' USING ERRCODE = '22023'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT ('home' = ANY (v_slugs)) THEN RAISE EXCEPTION 'website: a page with slug "home" is required' USING ERRCODE = '22023'; END IF;
  IF v_blocks > 1500 THEN RAISE EXCEPTION 'website: too many blocks' USING ERRCODE = '22023'; END IF;
END $$;

-- 5. Data bundle: wrap v1 and add published posts when the document uses the blog block (or for the builder).
ALTER FUNCTION public._website_data(uuid, jsonb, boolean) RENAME TO _website_data_v1;
REVOKE ALL ON FUNCTION public._website_data_v1(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._website_data(p_school uuid, p_doc jsonb, p_all boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE out jsonb := public._website_data_v1(p_school, p_doc, p_all);
BEGIN
  IF out IS NULL THEN RETURN NULL; END IF;
  IF p_all OR jsonb_path_exists(coalesce(p_doc, '{}'), '$.pages[*].sections[*].blocks[*] ? (@.type == "blog")') THEN
    out := out || jsonb_build_object('posts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'slug', x.slug, 'title', x.title,
        'excerpt', x.excerpt, 'category', x.category, 'cover_url', x.cover_url, 'author_name', x.author_name, 'published_at', x.publish_at)
        ORDER BY x.publish_at DESC)
      FROM (SELECT * FROM public.website_posts WHERE school_id = p_school AND status = 'published' AND publish_at <= now()
             ORDER BY publish_at DESC LIMIT 30) x), '[]'));
  END IF;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public._website_data(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- 6. Public single post (same tenant resolution as website_public; the post must belong to that tenant).
CREATE OR REPLACE FUNCTION public.website_public_post(p_host text DEFAULT NULL, p_slug text DEFAULT NULL, p_post text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE site jsonb := public.website_public(p_host, p_slug); v_post jsonb;
BEGIN
  IF site IS NULL OR p_post IS NULL THEN RETURN site; END IF;
  SELECT jsonb_build_object('id', id, 'slug', slug, 'title', title, 'excerpt', excerpt, 'body', body, 'category', category,
           'cover_url', cover_url, 'author_name', author_name, 'published_at', publish_at, 'seo', seo)
    INTO v_post FROM public.website_posts
   WHERE school_id = (site->>'school_id')::uuid AND slug = lower(btrim(p_post)) AND status = 'published' AND publish_at <= now();
  RETURN site || jsonb_build_object('post', v_post);
END $$;
GRANT EXECUTE ON FUNCTION public.website_public_post(text, text, text) TO anon, authenticated;

-- 7. Post authoring RPCs (the only write path).
CREATE OR REPLACE FUNCTION public._website_post_role(p_school uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_school IS NULL THEN RETURN NULL; END IF;
  IF public.scholar_can(p_school, 'website.manage') THEN RETURN 'editor'; END IF;
  IF public.scholar_can(p_school, 'website.posts') THEN RETURN 'author'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._website_post_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._website_post_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.website_posts_list(p_school uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text := public._website_post_role(p_school);
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('role', v_role, 'posts', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'school_id' ORDER BY coalesce(p.publish_at, p.updated_at) DESC)
    FROM public.website_posts p WHERE p.school_id = p_school), '[]'));
END $$;

CREATE OR REPLACE FUNCTION public._website_localized_ok(p jsonb, p_max int) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NULL OR (jsonb_typeof(p) = 'object'
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p) e WHERE e.key NOT IN ('en', 'ha', 'yo', 'ig', 'pcm') OR jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > p_max));
$$;

CREATE OR REPLACE FUNCTION public.website_post_save(p_school uuid, p_post jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text := public._website_post_role(p_school); v_id uuid; v_old public.website_posts; v_status text; v_at timestamptz;
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_post IS NULL OR jsonb_typeof(p_post) <> 'object' THEN RAISE EXCEPTION 'website: post must be an object' USING ERRCODE = '22023'; END IF;
  IF p_post::text ~* '"\s*(javascript|vbscript|data|file)\s*:' THEN RAISE EXCEPTION 'website: script or data URLs are not allowed' USING ERRCODE = '22023'; END IF;
  IF NOT public._website_localized_ok(p_post->'title', 200) OR NOT EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(p_post->'title', '{}')) WHERE btrim(value) <> '')
     OR NOT public._website_localized_ok(p_post->'excerpt', 600) OR NOT public._website_localized_ok(p_post->'body', 60000) THEN
    RAISE EXCEPTION 'website: a post needs a title; text fields must be per-language strings' USING ERRCODE = '22023'; END IF;
  v_status := coalesce(p_post->>'status', 'draft');
  IF v_status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'website: invalid status' USING ERRCODE = '22023'; END IF;
  IF v_status = 'published' AND v_role <> 'editor' THEN
    RAISE EXCEPTION 'only website managers can publish posts' USING ERRCODE = '42501'; END IF;
  v_at := CASE WHEN v_status = 'published' THEN coalesce(nullif(p_post->>'publish_at', '')::timestamptz, now()) END;
  IF p_post ? 'id' AND nullif(p_post->>'id', '') IS NOT NULL THEN
    SELECT * INTO v_old FROM public.website_posts WHERE id = (p_post->>'id')::uuid AND school_id = p_school FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'post not found' USING ERRCODE = 'P0002'; END IF;
    IF v_role = 'author' AND (v_old.status = 'published' OR v_old.created_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'authors can only edit their own drafts' USING ERRCODE = '42501'; END IF;
    UPDATE public.website_posts SET slug = p_post->>'slug', title = p_post->'title', excerpt = p_post->'excerpt', body = p_post->'body',
      category = nullif(btrim(p_post->>'category'), ''), cover_url = nullif(p_post->>'cover_url', ''), author_name = nullif(btrim(p_post->>'author_name'), ''),
      seo = p_post->'seo', status = v_status, publish_at = v_at, updated_by = auth.uid(), updated_at = now()
     WHERE id = v_old.id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.website_posts (school_id, slug, title, excerpt, body, category, cover_url, author_name, seo, status, publish_at, created_by, updated_by)
    VALUES (p_school, p_post->>'slug', p_post->'title', p_post->'excerpt', p_post->'body', nullif(btrim(p_post->>'category'), ''),
            nullif(p_post->>'cover_url', ''), nullif(btrim(p_post->>'author_name'), ''), p_post->'seo', v_status, v_at, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.website_audit (school_id, actor, action, detail)
  VALUES (p_school, auth.uid(), 'post.save', jsonb_build_object('post', v_id, 'status', v_status, 'publish_at', v_at));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'website: another post already uses this link' USING ERRCODE = '23505';
          WHEN check_violation THEN RAISE EXCEPTION 'website: invalid post (link, cover image or lengths)' USING ERRCODE = '22023';
END $$;

CREATE OR REPLACE FUNCTION public.website_post_delete(p_school uuid, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text := public._website_post_role(p_school); v_old public.website_posts;
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_old FROM public.website_posts WHERE id = p_id AND school_id = p_school;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_role = 'author' AND (v_old.status = 'published' OR v_old.created_by IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'authors can only delete their own drafts' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.website_posts WHERE id = p_id AND school_id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action, detail) VALUES (p_school, auth.uid(), 'post.delete', jsonb_build_object('post', p_id, 'slug', v_old.slug));
END $$;

-- 8. Brand colours live on the existing org branding fields (schools.primary_color / secondary_color).
CREATE OR REPLACE FUNCTION public.website_set_brand(p_school uuid, p_primary text, p_secondary text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._website_guard(p_school);
  IF coalesce(p_primary, '') !~ '^#[0-9a-fA-F]{6}$' OR coalesce(p_secondary, '') !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'website: colours must be #rrggbb' USING ERRCODE = '22023'; END IF;
  UPDATE public.schools SET primary_color = lower(p_primary), secondary_color = lower(p_secondary) WHERE id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action, detail)
  VALUES (p_school, auth.uid(), 'brand.set', jsonb_build_object('primary', lower(p_primary), 'secondary', lower(p_secondary)));
END $$;

REVOKE ALL ON FUNCTION public.website_posts_list(uuid), public.website_post_save(uuid, jsonb), public.website_post_delete(uuid, uuid),
  public.website_set_brand(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_posts_list(uuid), public.website_post_save(uuid, jsonb), public.website_post_delete(uuid, uuid),
  public.website_set_brand(uuid, text, text) TO authenticated;

COMMIT;
