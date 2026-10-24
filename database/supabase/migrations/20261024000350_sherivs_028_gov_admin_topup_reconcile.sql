-- SHERIVS-028 (W10): Sherivs-staff government access console + background reconciliation of pending wallet top-ups.
BEGIN;
-- ===== Government access administration (platform staff with platform.gov.manage only) =====
UPDATE public.platform_roles SET capabilities = array_append(capabilities, 'platform.gov.manage')
 WHERE code = 'platform_admin' AND NOT ('platform.gov.manage' = ANY (capabilities));

CREATE TABLE IF NOT EXISTS public.gov_admin_audit (
  id bigserial PRIMARY KEY, actor uuid NOT NULL, action text NOT NULL CHECK (action IN ('jurisdiction_create','viewer_grant','viewer_revoke')),
  jurisdiction_id uuid, target_user uuid, detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION public._gov_admin_guard() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_platform_capability('platform.gov.manage'), false) THEN
    RAISE EXCEPTION 'not allowed: Sherivs platform staff with government access permission only' USING ERRCODE = '42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gov_jurisdiction_create(p_name text, p_state text, p_lga text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  PERFORM public._gov_admin_guard();
  IF coalesce(length(btrim(p_name)), 0) < 3 OR coalesce(length(btrim(p_state)), 0) < 2 THEN RAISE EXCEPTION 'name and state are required'; END IF;
  INSERT INTO public.gov_jurisdictions (name, state, lga) VALUES (btrim(p_name), btrim(p_state), nullif(btrim(coalesce(p_lga, '')), '')) RETURNING id INTO v;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, detail) VALUES (auth.uid(), 'jurisdiction_create', v, jsonb_build_object('name', p_name, 'state', p_state, 'lga', p_lga));
  RETURN v;
END $$;

-- Grant by the officer's sign-in email (the officer must already have an account). Returns the user id.
CREATE OR REPLACE FUNCTION public.gov_viewer_grant_email(p_email text, p_jurisdiction uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid;
BEGIN
  PERFORM public._gov_admin_guard();
  SELECT id INTO u FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'no account with that email: ask the officer to sign up first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gov_jurisdictions WHERE id = p_jurisdiction) THEN RAISE EXCEPTION 'unknown jurisdiction'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = u) THEN RAISE EXCEPTION 'this account already belongs to a tenant workspace; government officers need a separate account'; END IF;
  INSERT INTO public.gov_viewers (user_id, jurisdiction_id, granted_by) VALUES (u, p_jurisdiction, auth.uid()) ON CONFLICT DO NOTHING;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, target_user, detail) VALUES (auth.uid(), 'viewer_grant', p_jurisdiction, u, jsonb_build_object('email', lower(btrim(p_email))));
  RETURN u;
END $$;

CREATE OR REPLACE FUNCTION public.gov_viewer_revoke(p_user uuid, p_jurisdiction uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  PERFORM public._gov_admin_guard();
  DELETE FROM public.gov_viewers WHERE user_id = p_user AND jurisdiction_id = p_jurisdiction;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, target_user, detail) VALUES (auth.uid(), 'viewer_revoke', p_jurisdiction, p_user, jsonb_build_object('removed', n > 0));
  RETURN n > 0;
END $$;

-- Console listing: jurisdictions, officer emails, opted-in tenant counts, recent audit.
CREATE OR REPLACE FUNCTION public.gov_admin_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_admin_guard();
  RETURN jsonb_build_object(
    'jurisdictions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'state', j.state, 'lga', j.lga,
        'schools_sharing', (SELECT count(*) FROM public.gov_data_sharing d WHERE d.jurisdiction_id = j.id AND d.withdrawn_at IS NULL),
        'viewers', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', v.user_id, 'email', au.email, 'granted_at', v.granted_at) ORDER BY v.granted_at)
                             FROM public.gov_viewers v JOIN auth.users au ON au.id = v.user_id WHERE v.jurisdiction_id = j.id), '[]'::jsonb)) ORDER BY j.state, j.name)
      FROM public.gov_jurisdictions j), '[]'::jsonb),
    'audit', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (SELECT jsonb_build_object('action', a.action, 'at', a.at, 'actor', au.email, 'jurisdiction_id', a.jurisdiction_id, 'detail', a.detail) x
      FROM public.gov_admin_audit a LEFT JOIN auth.users au ON au.id = a.actor ORDER BY a.at DESC LIMIT 50) s), '[]'::jsonb));
END $$;

-- The old super-admin-only grant now also accepts platform.gov.manage, and is audited.
CREATE OR REPLACE FUNCTION public.gov_viewer_grant(p_user uuid, p_jurisdiction uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._gov_admin_guard();
  INSERT INTO public.gov_viewers (user_id, jurisdiction_id, granted_by) VALUES (p_user, p_jurisdiction, auth.uid()) ON CONFLICT DO NOTHING;
  INSERT INTO public.gov_admin_audit (actor, action, jurisdiction_id, target_user) VALUES (auth.uid(), 'viewer_grant', p_jurisdiction, p_user);
END $$;

-- ===== Wallet top-up reconciliation (service role only; driven by the scheduled job) =====
ALTER TABLE public.wallet_topup_intents ADD COLUMN IF NOT EXISTS last_checked_at timestamptz, ADD COLUMN IF NOT EXISTS check_count int NOT NULL DEFAULT 0;

-- Pending intents older than p_min_age that have not been checked in the last p_min_age, oldest first.
CREATE OR REPLACE FUNCTION public.wallet_topup_pending_for_check(p_min_age interval DEFAULT interval '5 minutes', p_limit int DEFAULT 50) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT i.reference FROM public.wallet_topup_intents i
    WHERE i.status = 'pending' AND i.created_at < now() - p_min_age AND (i.last_checked_at IS NULL OR i.last_checked_at < now() - p_min_age)
    ORDER BY i.created_at LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END $$;

CREATE OR REPLACE FUNCTION public.wallet_topup_mark_checked(p_reference text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.wallet_topup_intents SET last_checked_at = now(), check_count = check_count + 1 WHERE reference = p_reference AND status = 'pending';
END $$;

-- Pending intents older than p_after with no confirmation become failed (expired). A late real payment still settles:
-- wallet_topup_settle credits any non-paid intent whose amount/currency match.
CREATE OR REPLACE FUNCTION public.wallet_topup_expire_stale(p_after interval DEFAULT interval '24 hours') RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_after < interval '1 hour' THEN RAISE EXCEPTION 'expiry must be at least 1 hour'; END IF;
  UPDATE public.wallet_topup_intents SET status = 'failed', failure_reason = 'expired: no payment confirmation'
   WHERE status = 'pending' AND created_at < now() - p_after;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

ALTER TABLE public.gov_admin_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gov_admin_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gov_admin_audit FROM anon, authenticated, service_role;
GRANT SELECT ON public.gov_admin_audit TO authenticated;
DROP POLICY IF EXISTS gov_admin_audit_read ON public.gov_admin_audit;
CREATE POLICY gov_admin_audit_read ON public.gov_admin_audit FOR SELECT TO authenticated USING (coalesce(public.has_platform_capability('platform.gov.manage'), false));
DROP TRIGGER IF EXISTS trg_gov_admin_audit_append_only ON public.gov_admin_audit;
CREATE TRIGGER trg_gov_admin_audit_append_only BEFORE UPDATE OR DELETE ON public.gov_admin_audit FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
REVOKE ALL ON FUNCTION public._gov_admin_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gov_jurisdiction_create(text, text, text), public.gov_viewer_grant_email(text, uuid), public.gov_viewer_revoke(uuid, uuid), public.gov_admin_overview(), public.gov_viewer_grant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gov_jurisdiction_create(text, text, text), public.gov_viewer_grant_email(text, uuid), public.gov_viewer_revoke(uuid, uuid), public.gov_admin_overview(), public.gov_viewer_grant(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.wallet_topup_pending_for_check(interval, int), public.wallet_topup_mark_checked(text), public.wallet_topup_expire_stale(interval) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wallet_topup_pending_for_check(interval, int), public.wallet_topup_mark_checked(text), public.wallet_topup_expire_stale(interval) TO service_role;
COMMIT;
