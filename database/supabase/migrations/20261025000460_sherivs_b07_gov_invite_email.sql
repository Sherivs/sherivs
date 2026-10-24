-- SHERIVS-B07: automatic officer-invite email (delivery status tracking). The raw token is never stored;
-- the server function re-presents the one-time token it just received, the DB re-verifies it by hash.
BEGIN;
ALTER TABLE public.gov_admin_audit DROP CONSTRAINT IF EXISTS gov_admin_audit_action_check;
ALTER TABLE public.gov_admin_audit ADD CONSTRAINT gov_admin_audit_action_check CHECK (action IN
  ('jurisdiction_create','viewer_grant','viewer_revoke','host_set','invite_create','invite_revoke','invite_accept','invite_email'));
ALTER TABLE public.gov_officer_invites
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_sent' CHECK (email_status IN ('not_sent','sent','stubbed','failed')),
  ADD COLUMN IF NOT EXISTS email_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_detail text CHECK (email_detail IS NULL OR length(email_detail) <= 200);

-- Returns what the mailer needs for a still-pending invite, only to an MFA'd gov admin holding the token.
CREATE OR REPLACE FUNCTION public.gov_officer_invite_mail_context(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  PERFORM public._gov_admin_mfa_guard();
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{48}$' THEN RAISE EXCEPTION 'invalid invite token'; END IF;
  SELECT i.id, i.email, i.agency_role, i.expires_at, i.email_attempts, j.name AS jname, j.host_label
    INTO r FROM public.gov_officer_invites i JOIN public.gov_jurisdictions j ON j.id = i.jurisdiction_id
   WHERE i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found or no longer pending'; END IF;
  IF r.email_attempts >= 5 THEN RAISE EXCEPTION 'too many email attempts for this invite'; END IF;
  RETURN jsonb_build_object('invite_id', r.id, 'email', r.email, 'agency_role', r.agency_role, 'expires_at', r.expires_at,
    'jurisdiction', r.jname, 'host_label', r.host_label, 'now', now());
END $$;

CREATE OR REPLACE FUNCTION public.gov_officer_invite_mark_email(p_invite uuid, p_status text, p_detail text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid;
BEGIN
  PERFORM public._gov_admin_mfa_guard();
  IF p_status NOT IN ('sent','stubbed','failed') THEN RAISE EXCEPTION 'invalid email status'; END IF;
  UPDATE public.gov_officer_invites SET email_status = p_status, email_attempts = email_attempts + 1, email_last_at = now(),
         email_detail = left(p_detail, 200)
   WHERE id = p_invite AND accepted_at IS NULL AND revoked_at IS NULL AND email_attempts < 5 RETURNING jurisdiction_id INTO j;
  IF j IS NULL THEN RAISE EXCEPTION 'invite not found, no longer pending, or too many attempts'; END IF;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, detail)
    VALUES (auth.uid(), 'invite_email', j, jsonb_build_object('invite_id', p_invite, 'status', p_status));
  RETURN p_status;
END $$;

-- list now shows email delivery status
CREATE OR REPLACE FUNCTION public.gov_officer_invites_list(p_jurisdiction uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_admin_guard();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'email', email, 'agency_role', agency_role, 'created_at', created_at, 'expires_at', expires_at, 'email_status', email_status, 'email_last_at', email_last_at,
      'status', CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired' ELSE 'open' END)
    ORDER BY created_at DESC) FROM public.gov_officer_invites WHERE jurisdiction_id = p_jurisdiction), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.gov_officer_invite_mail_context(text), public.gov_officer_invite_mark_email(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_officer_invite_mail_context(text), public.gov_officer_invite_mark_email(uuid, text, text) TO authenticated;
COMMIT;
