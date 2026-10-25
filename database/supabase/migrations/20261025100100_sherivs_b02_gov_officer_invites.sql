-- SHERIVS-B02 (Track B, Day 2): government console realm on <state>.gov.sherivs.com + invite-only officers.
-- * A jurisdiction can own a host label (borno -> borno.gov.sherivs.com); anyone may resolve the label to a name (public info).
-- * Platform staff with platform.gov.manage, signed in with MFA, invite an officer by email with an agency role and an expiry.
--   Only a hash of the one-time token is stored. The invited person accepts while signed in with the SAME email.
-- * Invited officers get an expiry and must be at MFA level aal2 for every console read (_gov_guard), server-side.
-- * Officers stay separate from tenant accounts (SHERIVS-028 rule): a school account cannot accept an invite.
BEGIN;

CREATE OR REPLACE FUNCTION public._gov_is_aal2() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

ALTER TABLE public.gov_jurisdictions ADD COLUMN IF NOT EXISTS host_label text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gov_jurisdictions_host_label_chk') THEN
    ALTER TABLE public.gov_jurisdictions ADD CONSTRAINT gov_jurisdictions_host_label_chk CHECK (host_label IS NULL OR host_label ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$');
  END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS gov_jurisdictions_host_label_uq ON public.gov_jurisdictions (host_label) WHERE host_label IS NOT NULL;

ALTER TABLE public.gov_viewers ADD COLUMN IF NOT EXISTS agency_role text, ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.gov_admin_audit DROP CONSTRAINT IF EXISTS gov_admin_audit_action_check;
ALTER TABLE public.gov_admin_audit ADD CONSTRAINT gov_admin_audit_action_check CHECK (action IN
  ('jurisdiction_create','viewer_grant','viewer_revoke','host_set','invite_create','invite_revoke','invite_accept'));

CREATE TABLE IF NOT EXISTS public.gov_officer_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.gov_jurisdictions(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  agency_role text NOT NULL CHECK (agency_role IN ('commissioner','permanent_secretary','director','board_chair','inspector','planning_officer','data_officer','viewer')),
  token_hash text NOT NULL UNIQUE,
  access_days int NOT NULL DEFAULT 365 CHECK (access_days BETWEEN 1 AND 730),
  invited_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz, accepted_by uuid, revoked_at timestamptz, revoked_by uuid);
CREATE UNIQUE INDEX IF NOT EXISTS gov_officer_invites_open_uq ON public.gov_officer_invites (jurisdiction_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.gov_officer_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gov_officer_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gov_officer_invites_staff_read ON public.gov_officer_invites;
CREATE POLICY gov_officer_invites_staff_read ON public.gov_officer_invites FOR SELECT TO authenticated
  USING (coalesce(public.has_platform_capability('platform.gov.manage'), false));
REVOKE ALL ON public.gov_officer_invites FROM anon;
GRANT SELECT ON public.gov_officer_invites TO authenticated;

CREATE OR REPLACE FUNCTION public._gov_admin_mfa_guard() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_admin_guard();
  IF NOT public._gov_is_aal2() THEN RAISE EXCEPTION 'mfa required: verify with your authenticator app first' USING ERRCODE = '42501'; END IF;
END $$;

-- Read guard: unchanged for legacy grants, plus expiry and (for invited officers) MFA.
CREATE OR REPLACE FUNCTION public._gov_guard(p_jurisdiction uuid, p_view text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.gov_viewers;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.gov_viewers WHERE user_id = auth.uid() AND jurisdiction_id = p_jurisdiction;
  IF v.user_id IS NULL OR (v.expires_at IS NOT NULL AND v.expires_at <= now()) THEN
    IF NOT coalesce(public.is_super_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSIF v.mfa_required AND NOT public._gov_is_aal2() THEN
    RAISE EXCEPTION 'mfa required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.gov_view_log (user_id, jurisdiction_id, view) VALUES (auth.uid(), p_jurisdiction, p_view);
END $$;

-- Expired grants no longer list.
CREATE OR REPLACE FUNCTION public.gov_my_jurisdictions() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'state', j.state, 'lga', j.lga, 'host_label', j.host_label,
           'agency_role', v.agency_role, 'expires_at', v.expires_at) ORDER BY j.name), '[]'::jsonb)
  FROM public.gov_viewers v JOIN public.gov_jurisdictions j ON j.id = v.jurisdiction_id
  WHERE v.user_id = auth.uid() AND (v.expires_at IS NULL OR v.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.gov_jurisdiction_set_host(p_jurisdiction uuid, p_label text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l text := nullif(lower(btrim(coalesce(p_label, ''))), '');
BEGIN
  PERFORM public._gov_admin_mfa_guard();
  IF l IN ('www','app','api','admin','console','internal','gov','mail','status') THEN RAISE EXCEPTION 'reserved host label'; END IF;
  UPDATE public.gov_jurisdictions SET host_label = l WHERE id = p_jurisdiction;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown jurisdiction'; END IF;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, detail) VALUES (auth.uid(), 'host_set', p_jurisdiction, jsonb_build_object('host_label', l));
  RETURN l;
END $$;

-- Public: which jurisdiction does <label>.gov.sherivs.com belong to? Name only; no officer or school data.
CREATE OR REPLACE FUNCTION public.gov_jurisdiction_by_host(p_label text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', id, 'name', name, 'state', state, 'lga', lga, 'host_label', host_label)
  FROM public.gov_jurisdictions WHERE host_label = lower(btrim(p_label)) $$;

-- Invite: returns the raw token ONCE (to be emailed by the console); only its sha256 is stored.
CREATE OR REPLACE FUNCTION public.gov_officer_invite_create(p_email text, p_jurisdiction uuid, p_agency_role text,
  p_valid_days int DEFAULT 7, p_access_days int DEFAULT 365) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e text := lower(btrim(coalesce(p_email, ''))); tok text := encode(extensions.gen_random_bytes(24), 'hex'); i uuid; x timestamptz;
BEGIN
  PERFORM public._gov_admin_mfa_guard();
  IF p_valid_days IS NULL OR p_valid_days NOT BETWEEN 1 AND 14 THEN RAISE EXCEPTION 'invite validity must be 1 to 14 days'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gov_jurisdictions WHERE id = p_jurisdiction) THEN RAISE EXCEPTION 'unknown jurisdiction'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users au JOIN public.users u ON u.id = au.id WHERE lower(au.email) = e) THEN
    RAISE EXCEPTION 'this email belongs to a tenant workspace account; government officers need a separate (official) email'; END IF;
  x := now() + make_interval(days => p_valid_days);
  INSERT INTO public.gov_officer_invites (jurisdiction_id, email, agency_role, token_hash, access_days, invited_by, expires_at)
    VALUES (p_jurisdiction, e, p_agency_role, encode(extensions.digest(tok, 'sha256'), 'hex'), coalesce(p_access_days, 365), auth.uid(), x) RETURNING id INTO i;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, detail) VALUES (auth.uid(), 'invite_create', p_jurisdiction,
    jsonb_build_object('invite_id', i, 'email', e, 'agency_role', p_agency_role, 'expires_at', x));
  RETURN jsonb_build_object('id', i, 'token', tok, 'expires_at', x);
END $$;

CREATE OR REPLACE FUNCTION public.gov_officer_invite_revoke(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid;
BEGIN
  PERFORM public._gov_admin_mfa_guard();
  UPDATE public.gov_officer_invites SET revoked_at = now(), revoked_by = auth.uid()
   WHERE id = p_id AND accepted_at IS NULL AND revoked_at IS NULL RETURNING jurisdiction_id INTO j;
  IF j IS NULL THEN RETURN false; END IF;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, detail) VALUES (auth.uid(), 'invite_revoke', j, jsonb_build_object('invite_id', p_id));
  RETURN true;
END $$;

-- Accept: signed in, same email as invited, not a tenant account, invite open and unexpired. Grants an expiring, MFA-required seat.
CREATE OR REPLACE FUNCTION public.gov_officer_invite_accept(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE inv public.gov_officer_invites; me text; until timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO inv FROM public.gov_officer_invites WHERE token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') FOR UPDATE;
  IF inv.id IS NULL OR inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invite is invalid, used, revoked or expired' USING ERRCODE = '42501'; END IF;
  SELECT lower(email) INTO me FROM auth.users WHERE id = auth.uid();
  IF me IS DISTINCT FROM inv.email THEN RAISE EXCEPTION 'this invite was sent to a different email address' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()) THEN RAISE EXCEPTION 'tenant workspace accounts cannot become government officers' USING ERRCODE = '42501'; END IF;
  until := now() + make_interval(days => inv.access_days);
  INSERT INTO public.gov_viewers (user_id, jurisdiction_id, granted_by, agency_role, expires_at, mfa_required)
    VALUES (auth.uid(), inv.jurisdiction_id, inv.invited_by, inv.agency_role, until, true)
    ON CONFLICT (user_id, jurisdiction_id) DO UPDATE SET agency_role = excluded.agency_role, expires_at = excluded.expires_at, mfa_required = true;
  UPDATE public.gov_officer_invites SET accepted_at = now(), accepted_by = auth.uid() WHERE id = inv.id;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, target_user, detail) VALUES (auth.uid(), 'invite_accept', inv.jurisdiction_id, auth.uid(),
    jsonb_build_object('invite_id', inv.id, 'agency_role', inv.agency_role, 'expires_at', until));
  RETURN jsonb_build_object('jurisdiction_id', inv.jurisdiction_id, 'agency_role', inv.agency_role, 'expires_at', until);
END $$;

-- Console gate for <label>.gov.sherivs.com.
CREATE OR REPLACE FUNCTION public.gov_console_session(p_label text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.gov_jurisdictions; v public.gov_viewers;
BEGIN
  SELECT * INTO j FROM public.gov_jurisdictions WHERE host_label = lower(btrim(coalesce(p_label, '')));
  IF j.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown_jurisdiction'); END IF;
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status', 'signed_out', 'jurisdiction', j.name); END IF;
  SELECT * INTO v FROM public.gov_viewers WHERE user_id = auth.uid() AND jurisdiction_id = j.id AND (expires_at IS NULL OR expires_at > now());
  IF v.user_id IS NULL THEN RETURN jsonb_build_object('status', 'not_an_officer', 'jurisdiction', j.name); END IF;
  IF NOT public._gov_is_aal2() THEN RETURN jsonb_build_object('status', 'mfa_required', 'jurisdiction', j.name); END IF;
  RETURN jsonb_build_object('status', 'ok', 'jurisdiction_id', j.id, 'jurisdiction', j.name, 'agency_role', v.agency_role, 'expires_at', v.expires_at);
END $$;

-- Staff listing of invites (no token hashes).
CREATE OR REPLACE FUNCTION public.gov_officer_invites_list(p_jurisdiction uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_admin_guard();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'email', email, 'agency_role', agency_role, 'created_at', created_at, 'expires_at', expires_at,
      'status', CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired' ELSE 'open' END)
    ORDER BY created_at DESC) FROM public.gov_officer_invites WHERE jurisdiction_id = p_jurisdiction), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.gov_jurisdiction_set_host(uuid, text), public.gov_officer_invite_create(text, uuid, text, int, int),
  public.gov_officer_invite_revoke(uuid), public.gov_officer_invite_accept(text), public.gov_console_session(text),
  public.gov_officer_invites_list(uuid), public._gov_admin_mfa_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_jurisdiction_set_host(uuid, text), public.gov_officer_invite_create(text, uuid, text, int, int),
  public.gov_officer_invite_revoke(uuid), public.gov_officer_invite_accept(text), public.gov_console_session(text),
  public.gov_officer_invites_list(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.gov_jurisdiction_by_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gov_jurisdiction_by_host(text) TO anon, authenticated;
COMMIT;
