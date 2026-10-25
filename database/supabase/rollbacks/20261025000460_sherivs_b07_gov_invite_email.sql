BEGIN;
-- gov_admin_audit is append-only: the widened action check (incl. 'invite_email') is intentionally kept.
CREATE OR REPLACE FUNCTION public.gov_officer_invites_list(p_jurisdiction uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_admin_guard();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'email', email, 'agency_role', agency_role, 'created_at', created_at, 'expires_at', expires_at,
      'status', CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired' ELSE 'open' END)
    ORDER BY created_at DESC) FROM public.gov_officer_invites WHERE jurisdiction_id = p_jurisdiction), '[]'::jsonb);
END $$;
DROP FUNCTION IF EXISTS public.gov_officer_invite_mark_email(uuid, text, text);
DROP FUNCTION IF EXISTS public.gov_officer_invite_mail_context(text);
ALTER TABLE public.gov_officer_invites DROP COLUMN IF EXISTS email_detail, DROP COLUMN IF EXISTS email_last_at,
  DROP COLUMN IF EXISTS email_attempts, DROP COLUMN IF EXISTS email_status;
COMMIT;
