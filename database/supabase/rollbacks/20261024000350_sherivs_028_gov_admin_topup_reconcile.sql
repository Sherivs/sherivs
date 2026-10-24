-- Rollback SHERIVS-028. Restores the super-admin-only gov_viewer_grant from 025. Audit rows are dropped with their table.
BEGIN;
DROP FUNCTION IF EXISTS public.wallet_topup_expire_stale(interval), public.wallet_topup_mark_checked(text), public.wallet_topup_pending_for_check(interval, int),
  public.gov_admin_overview(), public.gov_viewer_revoke(uuid, uuid), public.gov_viewer_grant_email(text, uuid), public.gov_jurisdiction_create(text, text, text);
CREATE OR REPLACE FUNCTION public.gov_viewer_grant(p_user uuid, p_jurisdiction uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.is_super_admin(), false) THEN RAISE EXCEPTION 'not allowed: Sherivs staff only' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.gov_viewers (user_id, jurisdiction_id, granted_by) VALUES (p_user, p_jurisdiction, auth.uid()) ON CONFLICT DO NOTHING;
END $$;
DROP FUNCTION IF EXISTS public._gov_admin_guard();
DROP TABLE IF EXISTS public.gov_admin_audit;
ALTER TABLE public.wallet_topup_intents DROP COLUMN IF EXISTS check_count, DROP COLUMN IF EXISTS last_checked_at;
UPDATE public.platform_roles SET capabilities = array_remove(capabilities, 'platform.gov.manage') WHERE code = 'platform_admin';
COMMIT;
