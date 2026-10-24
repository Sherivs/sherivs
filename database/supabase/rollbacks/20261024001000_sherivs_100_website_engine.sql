-- Rollback SHERIVS-100 website engine. Drops sites, versions and audit (website content only; school data untouched).
DROP FUNCTION IF EXISTS public.website_rollback(uuid, integer);
DROP FUNCTION IF EXISTS public.website_publish(uuid, text);
DROP FUNCTION IF EXISTS public.website_save_draft(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.website_preview_data(uuid, jsonb);
DROP FUNCTION IF EXISTS public.website_facts(uuid);
DROP FUNCTION IF EXISTS public.website_get(uuid);
DROP FUNCTION IF EXISTS public._website_guard(uuid);
DROP FUNCTION IF EXISTS public.website_public(text, text);
DROP FUNCTION IF EXISTS public._website_data(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public._website_validate(jsonb);
DROP TABLE IF EXISTS public.website_audit;
DROP TABLE IF EXISTS public.website_versions;
DROP TABLE IF EXISTS public.websites;
DROP TABLE IF EXISTS public.website_block_types;
DROP FUNCTION IF EXISTS public._website_immutable();
DELETE FROM public.role_template_permissions WHERE permission_code = 'website.manage';
DELETE FROM public.permission_catalog WHERE code = 'website.manage';
DROP INDEX IF EXISTS public.website_news_pub_idx, public.website_events_pub_idx, public.website_gallery_pub_idx,
  public.website_facilities_pub_idx, public.website_staff_pub_idx, public.website_testimonials_pub_idx, public.website_faqs_pub_idx,
  public.website_programs_pub_idx, public.website_calendar_idx, public.website_alumni_idx, public.website_donation_campaigns_idx,
  public.website_result_pin_batches_idx, public.website_school_sections_idx;
