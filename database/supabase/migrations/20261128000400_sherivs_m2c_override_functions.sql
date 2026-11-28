-- M2c: tenant role overrides can be proposed, approved and ended by an organization administrator with their own session.
-- Until now tenant_role_overrides was writable only by the service role. These functions are the only client route:
-- they run as the caller (auth.uid()), take the organization from get_my_school_id(), and leave every rule to the existing
-- guard trigger (four-eyes, template in the installed pack, guardrails, separation of duties, immutable payload) and the
-- audit trigger. A fourth function gives any member an opaque epoch string so a client can tell when its cached
-- permissions may be stale.
-- NOT APPLIED. Founder approval and a backup are required first. Changes who can change access; Tumi's review is required.

CREATE OR REPLACE FUNCTION public.role_override_create(
  p_template text, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_effective_to timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.get_my_school_id();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR NOT public.role_pack_caller_is_org_admin(v_org) THEN
    RAISE EXCEPTION 'only an administrator of the organization may propose a role override' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.tenant_role_overrides (org_id, template_code, override_kind, payload, effective_to, created_by)
  VALUES (v_org, p_template, p_kind, coalesce(p_payload, '{}'::jsonb), p_effective_to, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.role_override_approve(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.get_my_school_id();
  v_row public.tenant_role_overrides%ROWTYPE;
BEGIN
  IF v_org IS NULL OR NOT public.role_pack_caller_is_org_admin(v_org) THEN
    RAISE EXCEPTION 'only an administrator of the organization may approve a role override' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.tenant_role_overrides o WHERE o.id = p_id AND o.org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'override not found' USING ERRCODE = '42704';
  END IF;
  IF v_row.approved_by IS NOT NULL THEN
    RAISE EXCEPTION 'override is already approved' USING ERRCODE = '55000';
  END IF;
  IF v_row.effective_to IS NOT NULL AND v_row.effective_to <= pg_catalog.now() THEN
    RAISE EXCEPTION 'override has ended' USING ERRCODE = '55000';
  END IF;
  UPDATE public.tenant_role_overrides SET approved_by = auth.uid() WHERE id = p_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.role_override_end(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org uuid := public.get_my_school_id();
BEGIN
  IF v_org IS NULL OR NOT public.role_pack_caller_is_org_admin(v_org) THEN
    RAISE EXCEPTION 'only an administrator of the organization may end a role override' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenant_role_overrides o
     SET effective_to = greatest(o.effective_from, pg_catalog.now())
   WHERE o.id = p_id AND o.org_id = v_org AND (o.effective_to IS NULL OR o.effective_to > pg_catalog.now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'override not found or already ended' USING ERRCODE = '42704';
  END IF;
END
$function$;

-- An opaque change marker for the caller's organization. It moves whenever an override is proposed, approved or ended.
-- It says nothing about what changed, so any member may read it. A window that simply runs out on the clock does not move
-- it; clients also keep a short time limit on what they cache.
CREATE OR REPLACE FUNCTION public.role_override_epoch()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.count(*)::text || ':' || pg_catalog.count(o.approved_by)::text || ':' ||
         pg_catalog.count(o.effective_to)::text || ':' ||
         coalesce(pg_catalog.max(greatest(o.created_at, o.approved_at, o.effective_to))::text, '')
    FROM public.tenant_role_overrides o
   WHERE o.org_id = public.get_my_school_id() AND public.get_my_school_id() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.role_override_create(text, text, jsonb, timestamptz), public.role_override_approve(uuid),
  public.role_override_end(uuid), public.role_override_epoch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_override_create(text, text, jsonb, timestamptz), public.role_override_approve(uuid),
  public.role_override_end(uuid), public.role_override_epoch() TO authenticated, service_role;
