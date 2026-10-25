-- Rollback SHERIVS-B02: restores the SHERIVS-027/028 gov guard and listing; drops invites, host labels and the new columns.
BEGIN;
DROP FUNCTION IF EXISTS public.gov_officer_invites_list(uuid);
DROP FUNCTION IF EXISTS public.gov_console_session(text);
DROP FUNCTION IF EXISTS public.gov_officer_invite_accept(text);
DROP FUNCTION IF EXISTS public.gov_officer_invite_revoke(uuid);
DROP FUNCTION IF EXISTS public.gov_officer_invite_create(text, uuid, text, int, int);
DROP FUNCTION IF EXISTS public.gov_jurisdiction_by_host(text);
DROP FUNCTION IF EXISTS public.gov_jurisdiction_set_host(uuid, text);
DROP TABLE IF EXISTS public.gov_officer_invites;
CREATE OR REPLACE FUNCTION public._gov_guard(p_jurisdiction uuid, p_view text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (EXISTS (SELECT 1 FROM public.gov_viewers WHERE user_id = auth.uid() AND jurisdiction_id = p_jurisdiction) OR coalesce(public.is_super_admin(), false)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.gov_view_log (user_id, jurisdiction_id, view) VALUES (auth.uid(), p_jurisdiction, p_view);
END $$;
CREATE OR REPLACE FUNCTION public.gov_my_jurisdictions() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'state', j.state, 'lga', j.lga) ORDER BY j.name), '[]'::jsonb)
  FROM public.gov_viewers v JOIN public.gov_jurisdictions j ON j.id = v.jurisdiction_id WHERE v.user_id = auth.uid();
$$;
DROP FUNCTION IF EXISTS public._gov_admin_mfa_guard();
DROP FUNCTION IF EXISTS public._gov_is_aal2();
-- gov_admin_audit is append-only, so B02 rows (host_set/invite_*) stay; the original action list is restored NOT VALID
-- (enforced for new rows, existing history kept).
ALTER TABLE public.gov_admin_audit DROP CONSTRAINT IF EXISTS gov_admin_audit_action_check;
ALTER TABLE public.gov_admin_audit ADD CONSTRAINT gov_admin_audit_action_check CHECK (action IN ('jurisdiction_create','viewer_grant','viewer_revoke')) NOT VALID;
ALTER TABLE public.gov_viewers DROP COLUMN IF EXISTS mfa_required, DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS agency_role;
DROP INDEX IF EXISTS public.gov_jurisdictions_host_label_uq;
ALTER TABLE public.gov_jurisdictions DROP CONSTRAINT IF EXISTS gov_jurisdictions_host_label_chk;
ALTER TABLE public.gov_jurisdictions DROP COLUMN IF EXISTS host_label;
COMMIT;
