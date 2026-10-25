-- Rollback SHERIVS-101 website v2. Removes posts (website content only), v2 RPCs, v2 block types and variants, and
-- restores the v1 validator and data bundle. Documents that use v2 blocks must be republished after rollback.
BEGIN;
DROP FUNCTION IF EXISTS public.website_set_brand(uuid, text, text);
DROP FUNCTION IF EXISTS public.website_post_delete(uuid, uuid);
DROP FUNCTION IF EXISTS public.website_post_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.website_posts_list(uuid);
DROP FUNCTION IF EXISTS public._website_localized_ok(jsonb, int);
DROP FUNCTION IF EXISTS public._website_post_role(uuid);
DROP FUNCTION IF EXISTS public.website_public_post(text, text, text);
DROP FUNCTION IF EXISTS public._website_data(uuid, jsonb, boolean);
ALTER FUNCTION public._website_data_v1(uuid, jsonb, boolean) RENAME TO _website_data;
REVOKE ALL ON FUNCTION public._website_data(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
DROP TABLE IF EXISTS public.website_posts;
DELETE FROM public.role_template_permissions WHERE permission_code = 'website.posts' OR (permission_code = 'website.manage' AND template_code = 'pr');
DELETE FROM public.permission_catalog WHERE code = 'website.posts';
DELETE FROM public.website_block_types WHERE key IN ('blog', 'policies', 'rules', 'calendar', 'downloads', 'careers', 'pta');
UPDATE public.website_block_types SET variants = ARRAY['centered', 'split', 'minimal']::text[] WHERE key = 'hero';
UPDATE public.website_block_types SET variants = ARRAY['prose', 'pillars']::text[] WHERE key = 'about';
UPDATE public.website_block_types SET variants = ARRAY['band']::text[] WHERE key = 'stats';
UPDATE public.website_block_types SET variants = ARRAY['grid', 'list']::text[] WHERE key = 'facilities';
UPDATE public.website_block_types SET variants = ARRAY['grid', 'strip']::text[] WHERE key = 'gallery';
UPDATE public.website_block_types SET variants = ARRAY['cards', 'list']::text[] WHERE key = 'sections_offered';
UPDATE public.website_block_types SET variants = ARRAY['accordion']::text[] WHERE key = 'faqs';
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
     OR coalesce(p_doc#>>'{theme,radius}', 'soft') NOT IN ('square', 'soft', 'round') THEN
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
COMMIT;
