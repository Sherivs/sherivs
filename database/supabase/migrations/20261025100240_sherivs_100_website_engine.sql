-- SHERIVS-100: Dynamic Website Engine (docs/website-engine/SPEC.md).
-- site > pages > sections > blocks stored as a validated JSON document per version; draft/publish/rollback;
-- anonymous read of the PUBLISHED document + a public-only data bundle, resolved from a verified domain or slug.
-- No existing data is changed. schools.section_*_enabled are left in place (no longer read by the app).

-- 1. Block catalog (seed generated from frontend/src/lib/website/catalog.ts; parity checked by unit test)
CREATE TABLE IF NOT EXISTS public.website_block_types (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  label text NOT NULL,
  category text NOT NULL,
  data_source text,
  variants text[] NOT NULL DEFAULT '{}',
  opt_in boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO public.website_block_types (key, label, category, data_source, variants, opt_in) VALUES
  ('hero', 'Hero', 'identity', 'school', ARRAY['centered', 'split', 'minimal']::text[], false),
  ('about', 'About', 'identity', 'school', ARRAY['prose', 'pillars']::text[], false),
  ('leadership', 'Leadership', 'identity', NULL, ARRAY['grid', 'list']::text[], false),
  ('stats', 'At a glance', 'identity', 'stats', ARRAY['band']::text[], false),
  ('sections_offered', 'Schools & sections', 'academics', 'school_sections', ARRAY['cards', 'list']::text[], false),
  ('programmes', 'Programmes', 'academics', 'academic_programs', ARRAY['cards', 'list', 'table']::text[], false),
  ('departments', 'Faculties & departments', 'academics', NULL, ARRAY['grouped', 'list']::text[], false),
  ('admissions', 'Admissions', 'admissions', 'admissions', ARRAY['panel', 'banner']::text[], false),
  ('fees_summary', 'Fees summary', 'admissions', NULL, ARRAY['table']::text[], false),
  ('facilities', 'Facilities', 'campus_life', 'school_facilities', ARRAY['grid', 'list']::text[], false),
  ('boarding', 'Boarding & hostels', 'campus_life', 'hostels', ARRAY['panel']::text[], false),
  ('transport', 'School bus', 'campus_life', 'school_transport', ARRAY['panel']::text[], false),
  ('news', 'News', 'updates', 'news', ARRAY['cards', 'list']::text[], false),
  ('events', 'Events & calendar', 'updates', 'events', ARRAY['list', 'cards']::text[], false),
  ('gallery', 'Gallery', 'campus_life', 'school_gallery', ARRAY['grid', 'strip']::text[], false),
  ('staff_directory', 'Staff directory', 'community', 'school_staff', ARRAY['grid', 'list']::text[], true),
  ('results_checker', 'Result checker', 'admissions', 'result_pins', ARRAY['panel']::text[], false),
  ('alumni', 'Alumni', 'community', 'alumni_profiles', ARRAY['panel']::text[], false),
  ('donations', 'Give / donations', 'community', 'donation_campaigns', ARRAY['cards']::text[], false),
  ('campuses', 'Campuses', 'contact', 'campuses', ARRAY['list', 'cards']::text[], false),
  ('contact', 'Contact', 'contact', 'school', ARRAY['panel', 'split']::text[], false),
  ('map', 'Map', 'contact', 'school', ARRAY['links']::text[], false),
  ('faqs', 'FAQs', 'contact', 'faqs', ARRAY['accordion']::text[], false),
  ('testimonials', 'Testimonials', 'community', 'testimonials', ARRAY['quotes', 'cards']::text[], false),
  ('accreditation', 'Accreditation', 'identity', NULL, ARRAY['badges']::text[], false),
  ('rich_text', 'Text', 'content', NULL, ARRAY['prose', 'callout']::text[], false),
  ('cta', 'Call to action', 'content', NULL, ARRAY['banner']::text[], false),
  ('links', 'Links & downloads', 'content', NULL, ARRAY['list', 'buttons']::text[], false),
  ('agencies', 'Agencies & services', 'content', NULL, ARRAY['cards']::text[], false),
  ('video', 'Video', 'content', NULL, ARRAY['lite']::text[], false)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category, data_source = EXCLUDED.data_source,
  variants = EXCLUDED.variants, opt_in = EXCLUDED.opt_in, is_active = true;

-- 2. Sites, immutable versions, audit
CREATE TABLE IF NOT EXISTS public.websites (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  draft jsonb NOT NULL,
  draft_rev integer NOT NULL DEFAULT 1,
  published_version integer,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.website_versions (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('publish', 'rollback')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, version)
);
CREATE TABLE IF NOT EXISTS public.website_audit (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL,
  actor uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_audit_school_idx ON public.website_audit (school_id, at DESC);

CREATE OR REPLACE FUNCTION public._website_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS website_versions_immutable ON public.website_versions;
CREATE TRIGGER website_versions_immutable BEFORE UPDATE OR DELETE ON public.website_versions
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public._website_immutable();
DROP TRIGGER IF EXISTS website_audit_immutable ON public.website_audit;
CREATE TRIGGER website_audit_immutable BEFORE UPDATE OR DELETE ON public.website_audit
  FOR EACH ROW EXECUTE FUNCTION public._website_immutable();
-- (school deletion cascades versions; the cascade runs at trigger depth 1 and is allowed)

-- 3. Permission
INSERT INTO public.permission_catalog (code, module, label, sensitivity, protected)
VALUES ('website.manage', 'communication', 'Edit and publish the public website', 'internal', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on)
SELECT t.code, 'website.manage', 'optional', true -- optional (on): mandatory grants are irreversible by design (role_catalog_guard)
FROM public.role_templates t WHERE t.code IN ('head_of_institution', 'proprietor', 'ict_head')
ON CONFLICT DO NOTHING;

-- 4. RLS: reads for website managers; no write policies (RPC only)
ALTER TABLE public.website_block_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS website_block_types_read ON public.website_block_types;
CREATE POLICY website_block_types_read ON public.website_block_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS websites_read ON public.websites;
CREATE POLICY websites_read ON public.websites FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'website.manage'));
DROP POLICY IF EXISTS website_versions_read ON public.website_versions;
CREATE POLICY website_versions_read ON public.website_versions FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'website.manage'));
DROP POLICY IF EXISTS website_audit_read ON public.website_audit;
CREATE POLICY website_audit_read ON public.website_audit FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'website.manage'));
REVOKE ALL ON public.websites, public.website_versions, public.website_audit FROM anon;
GRANT SELECT ON public.website_block_types TO anon, authenticated;
GRANT SELECT ON public.websites, public.website_versions, public.website_audit TO authenticated;

-- 5. Public-read indexes (content tables had no school_id index)
CREATE INDEX IF NOT EXISTS website_news_pub_idx ON public.news (school_id, published_at DESC) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_events_pub_idx ON public.events (school_id, event_date) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_gallery_pub_idx ON public.school_gallery (school_id, order_index) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_facilities_pub_idx ON public.school_facilities (school_id, order_index) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_staff_pub_idx ON public.school_staff (school_id, order_index) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_testimonials_pub_idx ON public.testimonials (school_id, order_index) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_faqs_pub_idx ON public.faqs (school_id, order_index) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_programs_pub_idx ON public.academic_programs (school_id, order_index) WHERE is_published;
CREATE INDEX IF NOT EXISTS website_calendar_idx ON public.school_calendar (school_id, start_date);
CREATE INDEX IF NOT EXISTS website_alumni_idx ON public.alumni_profiles (school_id) WHERE verified;
CREATE INDEX IF NOT EXISTS website_donation_campaigns_idx ON public.donation_campaigns (school_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS website_result_pin_batches_idx ON public.result_pin_batches (school_id);
CREATE INDEX IF NOT EXISTS website_school_sections_idx ON public.school_sections (school_id);

-- 6. Document validator (authoritative; mirrored in frontend/src/lib/website/validate.ts)
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

-- 7. Public-only data bundle for the block types a document uses (all types when p_all / no document).
CREATE OR REPLACE FUNCTION public._website_data(p_school uuid, p_doc jsonb, p_all boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text[]; out jsonb; s record;
BEGIN
  SELECT * INTO s FROM public.schools WHERE id = p_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_all THEN t := ARRAY(SELECT key FROM public.website_block_types);
  ELSIF p_doc IS NULL THEN t := ARRAY(SELECT key FROM public.website_block_types WHERE NOT opt_in);
  ELSE
    t := ARRAY(SELECT DISTINCT b->>'type' FROM jsonb_array_elements(p_doc->'pages') pg,
               jsonb_array_elements(pg->'sections') sc, jsonb_array_elements(sc->'blocks') b
               WHERE coalesce((b->>'hidden')::boolean, false) = false);
  END IF;
  out := jsonb_build_object('school', jsonb_build_object(
    'name', s.name, 'slug', s.slug, 'motto', s.motto, 'about', s.about, 'vision', s.school_vision, 'mission', s.school_mission,
    'founded_year', s.founded_year, 'logo_url', s.logo_url, 'primary_color', s.primary_color, 'secondary_color', s.secondary_color,
    'phone', s.phone, 'email', s.email, 'address', s.address, 'office_hours', s.office_hours, 'institution_category', s.institution_category,
    'socials', jsonb_strip_nulls(jsonb_build_object(
      'facebook', coalesce(s.social_facebook_url, s.facebook_url), 'x', coalesce(s.social_twitter_url, s.twitter_url),
      'instagram', coalesce(s.social_instagram_url, s.instagram_url), 'youtube', s.social_youtube_url,
      'linkedin', s.social_linkedin_url, 'tiktok', s.social_tiktok_url)),
    'map', CASE WHEN coalesce(s.show_map_on_website, false) THEN jsonb_build_object('embed_url', s.google_maps_embed_url,
      'lat', s.geofence_latitude, 'lng', s.geofence_longitude) END));
  IF t && ARRAY['campuses', 'map', 'stats'] THEN
    out := out || jsonb_build_object('campuses', coalesce((SELECT jsonb_agg(jsonb_build_object('name', c.name, 'code', c.code, 'address', c.address) ORDER BY c.name)
      FROM public.campuses c WHERE c.school_id = p_school AND coalesce(c.is_active, true)), '[]'));
  END IF;
  IF t && ARRAY['sections_offered', 'boarding', 'hero'] THEN
    out := out || jsonb_build_object('sections', coalesce((SELECT jsonb_agg(jsonb_build_object('name', x.name, 'kind', x.kind, 'gender', x.gender,
      'residency', x.residency, 'campus', c.name) ORDER BY array_position(ARRAY['early_years','nursery','primary','junior_secondary','senior_secondary','technical','tertiary'], x.kind), x.name)
      FROM public.school_sections x LEFT JOIN public.campuses c ON c.id = x.campus_id WHERE x.school_id = p_school), '[]'));
  END IF;
  IF t && ARRAY['programmes'] THEN
    out := out || jsonb_build_object('programmes', coalesce((SELECT jsonb_agg(jsonb_build_object('name', p.name, 'description', p.description,
      'age_range', p.age_range, 'duration', p.duration, 'subjects', p.subjects, 'features', p.features) ORDER BY p.order_index NULLS LAST, p.name)
      FROM (SELECT * FROM public.academic_programs WHERE school_id = p_school AND is_published ORDER BY order_index NULLS LAST LIMIT 100) p), '[]'));
  END IF;
  IF t && ARRAY['facilities'] THEN
    out := out || jsonb_build_object('facilities', coalesce((SELECT jsonb_agg(jsonb_build_object('name', f.name, 'description', f.description, 'image_url', f.image_url) ORDER BY f.order_index NULLS LAST)
      FROM (SELECT * FROM public.school_facilities WHERE school_id = p_school AND is_published ORDER BY order_index NULLS LAST LIMIT 60) f), '[]'));
  END IF;
  IF t && ARRAY['news'] THEN
    out := out || jsonb_build_object('news', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'excerpt', coalesce(n.excerpt, left(n.content, 220)),
      'cover_image_url', n.cover_image_url, 'published_at', n.published_at, 'category', n.category) ORDER BY n.is_pinned DESC NULLS LAST, n.published_at DESC NULLS LAST)
      FROM (SELECT * FROM public.news WHERE school_id = p_school AND is_published AND coalesce(target_audience, 'all') IN ('all', 'public', 'everyone')
            ORDER BY is_pinned DESC NULLS LAST, published_at DESC NULLS LAST LIMIT 12) n), '[]'));
  END IF;
  IF t && ARRAY['events'] THEN
    out := out || jsonb_build_object('events', coalesce((SELECT jsonb_agg(e ORDER BY e->>'date') FROM (
      (SELECT jsonb_build_object('id', ev.id, 'title', ev.title, 'description', ev.description, 'location', ev.location, 'date', ev.event_date,
        'end_date', ev.end_date, 'time', ev.event_time) e FROM public.events ev
       WHERE ev.school_id = p_school AND ev.is_published AND coalesce(ev.end_date, ev.event_date) >= current_date
         AND coalesce(ev.target_audience, 'all') IN ('all', 'public', 'everyone') ORDER BY ev.event_date LIMIT 12)
      UNION ALL
      (SELECT jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description, 'location', k.location, 'date', k.start_date,
        'end_date', k.end_date, 'time', k.start_time) FROM public.school_calendar k
       WHERE k.school_id = p_school AND k.target_audience = 'public' AND coalesce(k.end_date, k.start_date) >= current_date ORDER BY k.start_date LIMIT 12)) z), '[]'));
  END IF;
  IF t && ARRAY['gallery', 'hero'] THEN
    out := out || jsonb_build_object('gallery', coalesce((SELECT jsonb_agg(jsonb_build_object('title', g.title, 'caption', g.caption, 'image_url', g.image_url) ORDER BY g.order_index NULLS LAST)
      FROM (SELECT * FROM public.school_gallery WHERE school_id = p_school AND is_published ORDER BY order_index NULLS LAST LIMIT 24) g), '[]'));
  END IF;
  IF t && ARRAY['staff_directory'] THEN
    out := out || jsonb_build_object('staff', coalesce((SELECT jsonb_agg(jsonb_build_object('full_name', x.full_name, 'role', x.role, 'avatar_url', x.avatar_url,
      'qualification', x.qualification, 'subject_specialty', x.subject_specialty) ORDER BY x.order_index NULLS LAST, x.full_name)
      FROM (SELECT * FROM public.school_staff WHERE school_id = p_school AND is_published ORDER BY order_index NULLS LAST LIMIT 200) x), '[]'));
  END IF;
  IF t && ARRAY['testimonials'] THEN
    out := out || jsonb_build_object('testimonials', coalesce((SELECT jsonb_agg(jsonb_build_object('name', x.name, 'role', x.role, 'content', x.content, 'avatar_url', x.avatar_url) ORDER BY x.order_index NULLS LAST)
      FROM (SELECT * FROM public.testimonials WHERE school_id = p_school AND is_published ORDER BY order_index NULLS LAST LIMIT 12) x), '[]'));
  END IF;
  IF t && ARRAY['faqs'] THEN
    out := out || jsonb_build_object('faqs', coalesce((SELECT jsonb_agg(jsonb_build_object('question', x.question, 'answer', x.answer, 'category', x.category) ORDER BY x.order_index NULLS LAST)
      FROM (SELECT * FROM public.faqs WHERE school_id = p_school AND is_published ORDER BY order_index NULLS LAST LIMIT 50) x), '[]'));
  END IF;
  IF t && ARRAY['transport'] THEN
    out := out || jsonb_build_object('transport', (SELECT jsonb_build_object('coverage_areas', x.coverage_areas, 'morning_pickup_start', x.morning_pickup_start,
      'afternoon_departure_time', x.afternoon_departure_time, 'live_tracking_enabled', x.live_tracking_enabled, 'buses_air_conditioned', x.buses_air_conditioned,
      'safety_features', x.safety_features, 'monthly_fee', x.monthly_transport_fee) FROM public.school_transport x WHERE x.school_id = p_school AND x.transport_enabled));
  END IF;
  IF t && ARRAY['boarding'] THEN
    out := out || jsonb_build_object('hostels', coalesce((SELECT jsonb_agg(jsonb_build_object('gender', h.gender, 'rooms', h.rooms, 'capacity', h.capacity))
      FROM (SELECT gender, count(*)::int rooms, coalesce(sum(capacity), 0)::int capacity FROM public.hostel_rooms
            WHERE school_id = p_school AND coalesce(is_active, true) GROUP BY gender) h), '[]'));
  END IF;
  IF t && ARRAY['alumni'] THEN
    out := out || jsonb_build_object('alumni', (SELECT jsonb_build_object('verified', count(*), 'first_year', min(grad_year), 'last_year', max(grad_year))
      FROM public.alumni_profiles WHERE school_id = p_school AND verified));
  END IF;
  IF t && ARRAY['donations'] THEN
    out := out || jsonb_build_object('donations', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'goal', x.goal, 'ends_on', x.ends_on) ORDER BY x.created_at DESC)
      FROM (SELECT * FROM public.donation_campaigns WHERE school_id = p_school AND status = 'open' AND (ends_on IS NULL OR ends_on >= current_date) LIMIT 6) x), '[]'));
  END IF;
  IF t && ARRAY['admissions', 'hero'] THEN
    out := out || jsonb_build_object('admissions', jsonb_build_object('requirements', s.admission_requirements, 'deadline', s.admission_deadline,
      'timeline', s.admission_timeline, 'open', s.admission_deadline IS NULL OR s.admission_deadline >= current_date));
  END IF;
  IF t && ARRAY['results_checker'] THEN
    out := out || jsonb_build_object('results_checker', EXISTS (SELECT 1 FROM public.result_pin_batches WHERE school_id = p_school));
  END IF;
  IF t && ARRAY['stats'] THEN
    out := out || jsonb_build_object('stats', jsonb_build_object(
      'students', (SELECT (count(*) / 10) * 10 FROM public.students WHERE school_id = p_school),
      'teachers', (SELECT count(*) FROM public.users WHERE school_id = p_school AND role = 'teacher' AND coalesce(is_active, true)),
      'programmes', (SELECT count(*) FROM public.academic_programs WHERE school_id = p_school AND is_published),
      'campuses', (SELECT count(*) FROM public.campuses WHERE school_id = p_school AND coalesce(is_active, true)),
      'founded_year', s.founded_year));
  END IF;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public._website_data(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- 8. Anonymous public read. Exactly one of host (custom domain, verified only) or slug (platform hosts).
CREATE OR REPLACE FUNCTION public.website_public(p_host text DEFAULT NULL, p_slug text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_school uuid; v_doc jsonb; v_ver int; v_canon text;
BEGIN
  IF p_host IS NOT NULL AND btrim(p_host) <> '' THEN
    SELECT d.school_id INTO v_school FROM public.school_domains d JOIN public.schools s ON s.id = d.school_id
     WHERE d.hostname = rtrim(lower(btrim(p_host)), '.') AND d.status = 'verified' AND coalesce(s.is_active, true) LIMIT 1;
  ELSIF p_slug IS NOT NULL THEN
    SELECT id INTO v_school FROM public.schools WHERE slug = lower(btrim(p_slug)) AND coalesce(is_active, true);
  END IF;
  IF v_school IS NULL THEN RETURN NULL; END IF;
  SELECT w.published_version, v.document INTO v_ver, v_doc
    FROM public.websites w JOIN public.website_versions v ON v.school_id = w.school_id AND v.version = w.published_version
   WHERE w.school_id = v_school;
  SELECT hostname INTO v_canon FROM public.school_domains WHERE school_id = v_school AND status = 'verified'
   ORDER BY (purpose = 'public_site') DESC, is_primary DESC, created_at LIMIT 1;
  RETURN jsonb_build_object('school_id', v_school, 'version', v_ver, 'canonical_host', v_canon, 'document', v_doc,
                            'data', public._website_data(v_school, v_doc, false));
END $$;
GRANT EXECUTE ON FUNCTION public.website_public(text, text) TO anon, authenticated;

-- 9. Builder RPCs
CREATE OR REPLACE FUNCTION public._website_guard(p_school uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_school IS NULL OR NOT public.scholar_can(p_school, 'website.manage') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._website_guard(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.website_get(p_school uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w record;
BEGIN
  PERFORM public._website_guard(p_school);
  SELECT * INTO w FROM public.websites WHERE school_id = p_school;
  RETURN jsonb_build_object('exists', w IS NOT NULL AND w.school_id IS NOT NULL, 'draft', w.draft, 'draft_rev', coalesce(w.draft_rev, 0),
    'published_version', w.published_version, 'updated_at', w.updated_at,
    'versions', coalesce((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'source', v.source, 'note', v.note, 'created_at', v.created_at) ORDER BY v.version DESC)
      FROM (SELECT * FROM public.website_versions WHERE school_id = p_school ORDER BY version DESC LIMIT 50) v), '[]'));
END $$;

CREATE OR REPLACE FUNCTION public.website_facts(p_school uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._website_guard(p_school);
  RETURN jsonb_build_object('data', public._website_data(p_school, NULL, true),
    'onboarding', (SELECT answers FROM public.onboarding_sessions WHERE school_id = p_school ORDER BY (status = 'applied') DESC, updated_at DESC NULLS LAST LIMIT 1));
END $$;

/** Same bundle as the public site but for an unpublished draft (builder preview). */
CREATE OR REPLACE FUNCTION public.website_preview_data(p_school uuid, p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._website_guard(p_school);
  RETURN public._website_data(p_school, p_document, p_document IS NULL);
END $$;

CREATE OR REPLACE FUNCTION public.website_save_draft(p_school uuid, p_document jsonb, p_expected_rev integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rev int;
BEGIN
  PERFORM public._website_guard(p_school);
  PERFORM public._website_validate(p_document);
  SELECT draft_rev INTO v_rev FROM public.websites WHERE school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN
    IF coalesce(p_expected_rev, 0) <> 0 THEN RAISE EXCEPTION 'website: the site was removed; reload' USING ERRCODE = '40001'; END IF;
    INSERT INTO public.websites (school_id, draft, draft_rev, updated_by) VALUES (p_school, p_document, 1, auth.uid());
    INSERT INTO public.website_audit (school_id, actor, action) VALUES (p_school, auth.uid(), 'create');
    RETURN 1;
  END IF;
  IF p_expected_rev IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'website: someone else saved changes; reload to continue' USING ERRCODE = '40001'; END IF;
  UPDATE public.websites SET draft = p_document, draft_rev = v_rev + 1, updated_by = auth.uid(), updated_at = now() WHERE school_id = p_school;
  RETURN v_rev + 1;
END $$;

CREATE OR REPLACE FUNCTION public.website_publish(p_school uuid, p_note text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w record; v_next int;
BEGIN
  PERFORM public._website_guard(p_school);
  SELECT * INTO w FROM public.websites WHERE school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'website: nothing to publish yet' USING ERRCODE = '22023'; END IF;
  PERFORM public._website_validate(w.draft);
  IF (SELECT count(*) FROM public.website_versions WHERE school_id = p_school AND created_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'website: publish limit reached (60 per hour)' USING ERRCODE = '54000'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.website_versions WHERE school_id = p_school;
  INSERT INTO public.website_versions (school_id, version, document, source, note, created_by)
  VALUES (p_school, v_next, w.draft, 'publish', left(p_note, 300), auth.uid());
  UPDATE public.websites SET published_version = v_next, updated_at = now() WHERE school_id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action, detail) VALUES (p_school, auth.uid(), 'publish', jsonb_build_object('version', v_next));
  RETURN v_next;
END $$;

CREATE OR REPLACE FUNCTION public.website_rollback(p_school uuid, p_version integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc jsonb; v_next int;
BEGIN
  PERFORM public._website_guard(p_school);
  PERFORM 1 FROM public.websites WHERE school_id = p_school FOR UPDATE;
  SELECT document INTO v_doc FROM public.website_versions WHERE school_id = p_school AND version = p_version;
  IF v_doc IS NULL THEN RAISE EXCEPTION 'website: version % not found', p_version USING ERRCODE = '22023'; END IF;
  PERFORM public._website_validate(v_doc); -- catalog may have changed since
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.website_versions WHERE school_id = p_school;
  INSERT INTO public.website_versions (school_id, version, document, source, note, created_by)
  VALUES (p_school, v_next, v_doc, 'rollback', 'Restored version ' || p_version, auth.uid());
  UPDATE public.websites SET published_version = v_next, draft = v_doc, draft_rev = draft_rev + 1, updated_by = auth.uid(), updated_at = now()
   WHERE school_id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action, detail) VALUES (p_school, auth.uid(), 'rollback', jsonb_build_object('from', p_version, 'version', v_next));
  RETURN v_next;
END $$;

REVOKE ALL ON FUNCTION public.website_get(uuid), public.website_facts(uuid), public.website_preview_data(uuid, jsonb),
  public.website_save_draft(uuid, jsonb, integer), public.website_publish(uuid, text), public.website_rollback(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_get(uuid), public.website_facts(uuid), public.website_preview_data(uuid, jsonb),
  public.website_save_draft(uuid, jsonb, integer), public.website_publish(uuid, text), public.website_rollback(uuid, integer) TO authenticated;
