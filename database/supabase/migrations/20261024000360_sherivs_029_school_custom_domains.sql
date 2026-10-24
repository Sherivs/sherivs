-- SHERIVS-029 (W11): per-school custom domains (.sch.ng / .edu.ng / own domain).
-- A school admin registers a hostname, publishes a TXT token, and Sherivs (service role) marks it verified
-- after a DNS check. Only verified + active domains resolve to a school. A domain can belong to one school only.
-- Login on a school's domain is limited to that school's members (school_domain_login_allowed).
BEGIN;
CREATE TABLE IF NOT EXISTS public.school_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  hostname text NOT NULL CHECK (hostname = lower(hostname) AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' AND length(hostname) <= 253),
  purpose text NOT NULL DEFAULT 'app' CHECK (purpose IN ('app','login','public_site')),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','removed')),
  verification_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  vercel_status text NOT NULL DEFAULT 'not_requested' CHECK (vercel_status IN ('not_requested','stubbed','added','error')),
  last_checked_at timestamptz, verified_at timestamptz, failure_reason text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
-- one live owner per hostname, across all schools
CREATE UNIQUE INDEX IF NOT EXISTS school_domains_host_live_uniq ON public.school_domains (hostname) WHERE status <> 'removed';
CREATE UNIQUE INDEX IF NOT EXISTS school_domains_primary_uniq ON public.school_domains (school_id) WHERE is_primary AND status <> 'removed';
CREATE INDEX IF NOT EXISTS school_domains_school_idx ON public.school_domains (school_id);
ALTER TABLE public.school_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_domains FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.school_domains FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.school_domains TO authenticated;
GRANT ALL ON public.school_domains TO service_role;
DROP POLICY IF EXISTS school_domains_admin_read ON public.school_domains;
CREATE POLICY school_domains_admin_read ON public.school_domains FOR SELECT TO authenticated
  USING ((school_id = (SELECT public.get_my_school_id()) AND (SELECT public.is_school_admin())) OR (SELECT public.is_super_admin()));

CREATE TABLE IF NOT EXISTS public.school_domain_audit (
  id bigserial PRIMARY KEY, domain_id uuid, school_id uuid, actor uuid, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.school_domain_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_domain_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.school_domain_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.school_domain_audit TO service_role;
CREATE OR REPLACE FUNCTION public._school_domain_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'school_domain_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS school_domain_audit_immutable ON public.school_domain_audit;
CREATE TRIGGER school_domain_audit_immutable BEFORE UPDATE OR DELETE ON public.school_domain_audit FOR EACH ROW EXECUTE FUNCTION public._school_domain_audit_immutable();

-- Platform hosts can never be claimed by a school.
CREATE OR REPLACE FUNCTION public._is_platform_hostname(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p = ANY (ARRAY['sherivs.com','universalschoolos.com','vercel.app','vercel.sh','localhost'])
      OR p ~ '\.(sherivs\.com|universalschoolos\.com|vercel\.app|vercel\.sh)$'
      OR p IN ('edu.ng','sch.ng','com.ng','org.ng','gov.ng','ng','net.ng','name.ng') $$;

CREATE OR REPLACE FUNCTION public.school_domain_add(p_hostname text, p_purpose text DEFAULT 'app') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h text := lower(btrim(coalesce(p_hostname, ''))); s uuid := public.get_my_school_id(); d public.school_domains;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN
    RAISE EXCEPTION 'not allowed: school administrators only' USING ERRCODE = '42501'; END IF;
  h := regexp_replace(regexp_replace(h, '^https?://', ''), '[/:].*$', '');
  h := rtrim(h, '.');
  IF h !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' THEN RAISE EXCEPTION 'invalid domain name'; END IF;
  IF public._is_platform_hostname(h) THEN RAISE EXCEPTION 'this domain is reserved and cannot be added'; END IF;
  IF EXISTS (SELECT 1 FROM public.school_domains WHERE hostname = h AND status <> 'removed') THEN
    RAISE EXCEPTION 'this domain is already registered on Sherivs'; END IF;
  IF (SELECT count(*) FROM public.school_domains WHERE school_id = s AND status <> 'removed') >= 5 THEN
    RAISE EXCEPTION 'limit reached: at most 5 domains per school'; END IF;
  INSERT INTO public.school_domains (school_id, hostname, purpose, created_by)
    VALUES (s, h, coalesce(nullif(p_purpose, ''), 'app'), auth.uid()) RETURNING * INTO d;
  INSERT INTO public.school_domain_audit (domain_id, school_id, actor, action, detail) VALUES (d.id, s, auth.uid(), 'add', jsonb_build_object('hostname', h, 'purpose', d.purpose));
  RETURN jsonb_build_object('id', d.id, 'hostname', d.hostname, 'status', d.status,
    'txt_name', '_sherivs-verify.' || d.hostname, 'txt_value', 'sherivs-verify=' || d.verification_token,
    'cname_target', 'cname.vercel-dns.com');
END $$;

CREATE OR REPLACE FUNCTION public.school_domain_set_primary(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id();
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.school_domains WHERE id = p_id AND school_id = s AND status = 'verified') THEN
    RAISE EXCEPTION 'only a verified domain of your school can be primary'; END IF;
  UPDATE public.school_domains SET is_primary = false WHERE school_id = s AND is_primary;
  UPDATE public.school_domains SET is_primary = true WHERE id = p_id;
  INSERT INTO public.school_domain_audit (domain_id, school_id, actor, action) VALUES (p_id, s, auth.uid(), 'set_primary');
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.school_domain_remove(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid := public.get_my_school_id(); n int;
BEGIN
  IF auth.uid() IS NULL OR s IS NULL OR NOT coalesce(public.is_school_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.school_domains SET status = 'removed', is_primary = false WHERE id = p_id AND school_id = s AND status <> 'removed';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN INSERT INTO public.school_domain_audit (domain_id, school_id, actor, action) VALUES (p_id, s, auth.uid(), 'remove'); END IF;
  RETURN n > 0;
END $$;

-- Service role only: called by the server after it checked the TXT record (and, later, added the host on Vercel).
CREATE OR REPLACE FUNCTION public.school_domain_record_check(p_id uuid, p_txt_ok boolean, p_vercel_status text DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.school_domains;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: service role only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.school_domains WHERE id = p_id AND status IN ('pending','failed','verified') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown domain'; END IF;
  UPDATE public.school_domains SET
    status = CASE WHEN p_txt_ok THEN 'verified' WHEN status = 'verified' THEN 'verified' ELSE 'failed' END,
    verified_at = CASE WHEN p_txt_ok AND verified_at IS NULL THEN now() ELSE verified_at END,
    vercel_status = coalesce(p_vercel_status, vercel_status), last_checked_at = now(),
    failure_reason = CASE WHEN p_txt_ok THEN NULL ELSE left(coalesce(p_reason, 'TXT record not found'), 300) END
  WHERE id = p_id RETURNING * INTO d;
  INSERT INTO public.school_domain_audit (domain_id, school_id, action, detail) VALUES (p_id, d.school_id, 'check', jsonb_build_object('txt_ok', p_txt_ok, 'vercel', p_vercel_status, 'status', d.status));
  RETURN d.status;
END $$;

-- Service role only: expected TXT value for a pending domain (the server never trusts the browser for it).
CREATE OR REPLACE FUNCTION public.school_domain_for_check(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: service role only' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT jsonb_build_object('id', id, 'school_id', school_id, 'hostname', hostname, 'txt_value', 'sherivs-verify=' || verification_token, 'status', status)
          FROM public.school_domains WHERE id = p_id AND status <> 'removed');
END $$;

-- Public (anon) resolver: verified, active domains only; returns the minimum needed to brand the page.
CREATE OR REPLACE FUNCTION public.resolve_school_by_host(p_host text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('school_id', s.id, 'slug', s.slug, 'name', s.name, 'purpose', d.purpose, 'is_primary', d.is_primary)
  FROM public.school_domains d JOIN public.schools s ON s.id = d.school_id
  WHERE d.hostname = rtrim(lower(btrim(coalesce(p_host, ''))), '.') AND d.status = 'verified' AND coalesce(s.is_active, true)
  LIMIT 1 $$;

-- Login guard: on a registered school host, only that school's members may hold a session there.
-- Unregistered hosts (platform, previews) return true; the platform hosts keep the existing rules.
CREATE OR REPLACE FUNCTION public.school_domain_login_allowed(p_host text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb := public.resolve_school_by_host(p_host);
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF r IS NULL THEN RETURN NOT EXISTS (SELECT 1 FROM public.school_domains WHERE hostname = rtrim(lower(btrim(coalesce(p_host, ''))), '.') AND status <> 'removed'); END IF;
  RETURN EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.school_id = (r->>'school_id')::uuid AND coalesce(u.is_active, true))
      OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.school_id = (r->>'school_id')::uuid AND m.is_active);
END $$;

REVOKE ALL ON FUNCTION public.school_domain_add(text, text), public.school_domain_set_primary(uuid), public.school_domain_remove(uuid),
  public.school_domain_record_check(uuid, boolean, text, text), public.school_domain_for_check(uuid), public.resolve_school_by_host(text),
  public.school_domain_login_allowed(text), public._is_platform_hostname(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_domain_add(text, text), public.school_domain_set_primary(uuid), public.school_domain_remove(uuid),
  public.school_domain_login_allowed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_school_by_host(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.school_domain_record_check(uuid, boolean, text, text), public.school_domain_for_check(uuid),
  public.resolve_school_by_host(text), public.school_domain_login_allowed(text) TO service_role;
COMMIT;
