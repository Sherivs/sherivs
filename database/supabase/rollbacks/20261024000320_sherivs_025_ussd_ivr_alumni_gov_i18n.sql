-- Rollback SHERIVS-025. Drops only objects added by 025 (all tables are new in 025).
BEGIN;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['_norm_phone','ussd_handle','ivr_queue_absence_calls','alumni_register','donation_campaign_create',
      'donation_confirm_online','donation_record_offline','donation_campaign_progress','gov_viewer_grant','gov_sharing_set','gov_dashboard','set_my_locale','ui_strings'])
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE'; END LOOP;
END $$;
DROP TABLE IF EXISTS public.user_locales, public.ui_translations, public.gov_data_sharing, public.gov_viewers, public.gov_jurisdictions, public.school_locations,
  public.donations, public.donation_campaigns, public.alumni_profiles, public.ivr_calls, public.ussd_sessions CASCADE;
COMMIT;
