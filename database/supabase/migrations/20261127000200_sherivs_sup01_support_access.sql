-- SUP-01 (ADR-143 A, ADR-153): support access grants. NOT APPLIED. Founder approval and a backup are required first.
-- A platform super admin may read or write inside an organisation only on that organisation's request, through a grant
-- that is a record, time-boxed, revocable, four-eyes on write, and fully audited. There is no standing access and no
-- agent ever holds a grant. This adds no access by itself: other functions must call support_access_log to use a grant.

-- The write approval spends one fresh passkey step-up (A3). Allow its kind.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.wf_sensitive_step_up'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%agent_promotion%';
  IF c IS NULL THEN RAISE EXCEPTION 'SUP-01: step-up action kind constraint not found'; END IF;
  EXECUTE format('ALTER TABLE public.wf_sensitive_step_up DROP CONSTRAINT %I', c);
  ALTER TABLE public.wf_sensitive_step_up ADD CONSTRAINT wf_sensitive_step_up_action_kind_check
    CHECK (action_kind IN ('agent_promotion', 'production_change', 'support_write'));
END $$;

CREATE TABLE public.support_access_grant (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  holder           uuid NOT NULL,
  request_source   text NOT NULL CHECK (request_source IN ('ticket', 'head_request', 'legal_safety', 'break_glass')),
  request_ref      text NOT NULL CHECK (length(btrim(request_ref)) BETWEEN 1 AND 200),
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  modules          text[] NOT NULL CHECK (cardinality(modules) BETWEEN 1 AND 20),
  mode             text NOT NULL CHECK (mode IN ('read', 'write')),
  minutes          integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  confirmed_by     uuid,
  confirmed_at     timestamptz,
  second_approver  uuid,
  second_approved_at timestamptz,
  starts_at        timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_grant_break_glass_read_only CHECK (request_source <> 'break_glass' OR (mode = 'read' AND minutes <= 60)),
  CONSTRAINT support_grant_no_self_confirm CHECK (confirmed_by IS NULL OR confirmed_by <> holder),
  CONSTRAINT support_grant_no_self_second CHECK (second_approver IS NULL OR second_approver <> holder),
  CONSTRAINT support_grant_window CHECK (expires_at IS NULL OR (starts_at IS NOT NULL AND expires_at > starts_at))
);
CREATE INDEX support_access_grant_org_idx ON public.support_access_grant (org_id, created_at DESC);
CREATE INDEX support_access_grant_holder_idx ON public.support_access_grant (holder) WHERE revoked_at IS NULL;

-- Append-only, hash-chained per grant.
CREATE TABLE public.support_access_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id   uuid NOT NULL REFERENCES public.support_access_grant (id) ON DELETE RESTRICT,
  org_id     uuid NOT NULL,
  seq        integer NOT NULL,
  action     text NOT NULL CHECK (action ~ '^[a-z_:.]{3,80}$'),
  severity   text NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal', 'high')),
  actor      uuid,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(detail::text) <= 8192),
  prev_hash  text,
  row_hash   text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grant_id, seq)
);
CREATE INDEX support_access_audit_org_idx ON public.support_access_audit (org_id, at DESC);

CREATE FUNCTION public.support_audit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'support_access_audit is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER support_audit_no_change BEFORE UPDATE OR DELETE ON public.support_access_audit
  FOR EACH ROW EXECUTE FUNCTION public.support_audit_guard();
CREATE TRIGGER support_audit_no_truncate BEFORE TRUNCATE ON public.support_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.support_audit_guard();

-- Grants only move forward through the functions below: block direct edits to who, what and when.
CREATE FUNCTION public.support_grant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'support_access_grant cannot be deleted' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.org_id, NEW.holder, NEW.request_source, NEW.request_ref, NEW.reason, NEW.modules, NEW.mode, NEW.minutes)
     IS DISTINCT FROM (OLD.id, OLD.org_id, OLD.holder, OLD.request_source, OLD.request_ref, OLD.reason, OLD.modules, OLD.mode, OLD.minutes) THEN
    RAISE EXCEPTION 'support_access_grant: the request is immutable' USING ERRCODE = '42501';
  END IF;
  IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR (OLD.starts_at IS NOT NULL AND NEW.starts_at IS DISTINCT FROM OLD.starts_at)
     OR (OLD.expires_at IS NOT NULL AND NEW.expires_at > OLD.expires_at) THEN
    RAISE EXCEPTION 'support_access_grant: a grant can only end sooner' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER support_grant_no_edit BEFORE UPDATE OR DELETE ON public.support_access_grant
  FOR EACH ROW EXECUTE FUNCTION public.support_grant_guard();
CREATE TRIGGER support_grant_no_truncate BEFORE TRUNCATE ON public.support_access_grant
  FOR EACH STATEMENT EXECUTE FUNCTION public.support_grant_guard();

ALTER TABLE public.support_access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_access_grant, public.support_access_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.support_access_grant, public.support_access_audit TO service_role;
CREATE POLICY support_grant_service_read ON public.support_access_grant FOR SELECT TO service_role USING (true);
CREATE POLICY support_audit_service_read ON public.support_access_audit FOR SELECT TO service_role USING (true);

-- Internal: append one audit row, chained to the previous one of the same grant.
CREATE FUNCTION public.support_audit_write(p_grant uuid, p_action text, p_severity text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.support_access_grant; v_seq integer; v_prev text; v_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO g FROM public.support_access_grant WHERE id = p_grant FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'support:unknown_grant' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.support_access_audit WHERE grant_id = p_grant;
  SELECT row_hash INTO v_prev FROM public.support_access_audit WHERE grant_id = p_grant AND seq = v_seq - 1;
  INSERT INTO public.support_access_audit (grant_id, org_id, seq, action, severity, actor, detail, prev_hash, row_hash, at)
  VALUES (p_grant, g.org_id, v_seq, p_action, p_severity, auth.uid(), coalesce(p_detail, '{}'::jsonb), v_prev,
    encode(sha256(convert_to(coalesce(v_prev, '') || '|' || p_grant::text || '|' || v_seq::text || '|' || p_action || '|'
      || coalesce(p_detail, '{}'::jsonb)::text || '|' || coalesce(auth.uid()::text, '') || '|' || v_at::text, 'UTF8')), 'hex'), v_at);
END $$;

-- 1. A platform super admin requests a grant. It does nothing until the organisation confirms it.
CREATE FUNCTION public.support_grant_request(
  p_org uuid, p_source text, p_ref text, p_reason text, p_modules text[], p_mode text, p_minutes integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid; v_min integer;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'support:platform_admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_source NOT IN ('ticket', 'head_request', 'legal_safety') THEN
    RAISE EXCEPTION 'support:request_must_come_from_the_organisation' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('read', 'write') THEN RAISE EXCEPTION 'support:bad_mode' USING ERRCODE = '22023'; END IF;
  IF NOT (SELECT bool_and(m ~ '^[a-z][a-z0-9_.]{1,60}$') FROM unnest(p_modules) m) THEN
    RAISE EXCEPTION 'support:bad_modules' USING ERRCODE = '22023';
  END IF;
  v_min := coalesce(p_minutes, CASE p_mode WHEN 'write' THEN 60 ELSE 240 END);
  IF v_min < 1 OR v_min > 1440 THEN RAISE EXCEPTION 'support:duration_out_of_range' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.support_access_grant (org_id, holder, request_source, request_ref, reason, modules, mode, minutes)
  VALUES (p_org, auth.uid(), p_source, p_ref, p_reason, p_modules, p_mode, v_min) RETURNING id INTO v_id;
  PERFORM public.support_audit_write(v_id, 'requested', 'normal',
    jsonb_build_object('mode', p_mode, 'modules', p_modules, 'minutes', v_min, 'source', p_source));
  RETURN v_id;
END $$;

-- 2. The organisation's own administrator confirms. Read becomes active now; write waits for a second platform approver.
CREATE FUNCTION public.support_grant_confirm(p_grant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.support_access_grant;
BEGIN
  SELECT * INTO g FROM public.support_access_grant WHERE id = p_grant FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'support:unknown_grant' USING ERRCODE = '42501'; END IF;
  IF auth.uid() IS NULL OR coalesce(public.is_super_admin(), false) OR NOT public.can_administer_org(g.org_id) THEN
    RAISE EXCEPTION 'support:organisation_administrator_only' USING ERRCODE = '42501';
  END IF;
  IF g.revoked_at IS NOT NULL OR g.confirmed_at IS NOT NULL OR g.request_source = 'break_glass'
     OR g.created_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'support:not_confirmable' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_access_grant SET confirmed_by = auth.uid(), confirmed_at = now(),
    starts_at = CASE WHEN g.mode = 'read' THEN now() END,
    expires_at = CASE WHEN g.mode = 'read' THEN now() + make_interval(mins => g.minutes) END
   WHERE id = p_grant;
  PERFORM public.support_audit_write(p_grant, 'head_confirmed', 'normal', jsonb_build_object('mode', g.mode));
  RETURN jsonb_build_object('grant', p_grant, 'state', CASE WHEN g.mode = 'read' THEN 'active' ELSE 'waiting_second_approver' END);
END $$;

-- 3. Write only: a second platform approver (not the holder) with a fresh passkey step-up.
CREATE FUNCTION public.support_grant_second_approve(p_grant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.support_access_grant;
BEGIN
  SELECT * INTO g FROM public.support_access_grant WHERE id = p_grant FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'support:unknown_grant' USING ERRCODE = '42501'; END IF;
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) OR auth.uid() = g.holder THEN
    RAISE EXCEPTION 'support:second_platform_approver_only' USING ERRCODE = '42501';
  END IF;
  IF g.mode <> 'write' OR g.confirmed_at IS NULL OR g.second_approved_at IS NOT NULL OR g.revoked_at IS NOT NULL
     OR g.created_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'support:not_approvable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.wf_step_up_consume(auth.uid(), 'support_write', public.wf_step_up_digest('support_write', ARRAY[p_grant::text]));
  UPDATE public.support_access_grant SET second_approver = auth.uid(), second_approved_at = now(),
    starts_at = now(), expires_at = now() + make_interval(mins => g.minutes)
   WHERE id = p_grant;
  PERFORM public.support_audit_write(p_grant, 'second_approved', 'normal', '{}'::jsonb);
  RETURN jsonb_build_object('grant', p_grant, 'state', 'active');
END $$;

-- 4. Break-glass: read-only, one hour, high severity. The organisation is told through the audit trail it can read.
CREATE FUNCTION public.support_break_glass_open(p_org uuid, p_reason text, p_modules text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'support:platform_admin_only' USING ERRCODE = '42501';
  END IF;
  IF NOT (SELECT bool_and(m ~ '^[a-z][a-z0-9_.]{1,60}$') FROM unnest(p_modules) m) THEN
    RAISE EXCEPTION 'support:bad_modules' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.support_access_grant (org_id, holder, request_source, request_ref, reason, modules, mode, minutes,
                                           starts_at, expires_at)
  VALUES (p_org, auth.uid(), 'break_glass', 'break_glass', p_reason, p_modules, 'read', 60, now(), now() + interval '60 minutes')
  RETURNING id INTO v_id;
  PERFORM public.support_audit_write(v_id, 'break_glass_opened', 'high', jsonb_build_object('modules', p_modules));
  RETURN v_id;
END $$;

-- 5. Revoke: the organisation's administrator, the holder or any platform admin; effective immediately.
CREATE FUNCTION public.support_grant_revoke(p_grant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.support_access_grant;
BEGIN
  SELECT * INTO g FROM public.support_access_grant WHERE id = p_grant FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'support:unknown_grant' USING ERRCODE = '42501'; END IF;
  IF auth.uid() IS NULL OR NOT (auth.uid() = g.holder OR public.can_administer_org(g.org_id)) THEN
    RAISE EXCEPTION 'support:not_allowed' USING ERRCODE = '42501';
  END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.support_access_grant SET revoked_at = now(), revoked_by = auth.uid(),
    expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE least(expires_at, greatest(now(), starts_at + interval '1 millisecond')) END
   WHERE id = p_grant;
  PERFORM public.support_audit_write(p_grant, 'revoked', 'normal', '{}'::jsonb);
END $$;

-- 6. Use: other dedicated functions call this before they touch organisation content. Every use is audited.
CREATE FUNCTION public.support_access_log(p_grant uuid, p_module text, p_kind text, p_object text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE g public.support_access_grant;
BEGIN
  SELECT * INTO g FROM public.support_access_grant WHERE id = p_grant;
  IF g.id IS NULL OR auth.uid() IS NULL OR g.holder <> auth.uid() OR NOT coalesce(public.is_super_admin(), false)
     OR g.revoked_at IS NOT NULL OR g.starts_at IS NULL OR g.starts_at > now() OR g.expires_at <= now()
     OR NOT (p_module = ANY (g.modules)) OR p_kind NOT IN ('read', 'write')
     OR (p_kind = 'write' AND (g.mode <> 'write' OR g.second_approved_at IS NULL)) THEN
    RAISE EXCEPTION 'support:no_active_grant' USING ERRCODE = '42501';
  END IF;
  PERFORM public.support_audit_write(p_grant, 'access:' || p_kind, 'normal',
    jsonb_build_object('module', p_module, 'object', left(p_object, 200), 'detail', coalesce(p_detail, '{}'::jsonb)));
END $$;

-- 7. Visibility: the organisation's administrator and platform admins read the same grants and the same log.
CREATE FUNCTION public.support_grants_list(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_org(p_org) THEN
    RAISE EXCEPTION 'support:not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', g.id, 'holder', g.holder, 'mode', g.mode, 'modules', g.modules, 'source', g.request_source, 'reason', g.reason,
    'created_at', g.created_at, 'confirmed_at', g.confirmed_at, 'second_approved_at', g.second_approved_at,
    'starts_at', g.starts_at, 'expires_at', g.expires_at, 'revoked_at', g.revoked_at,
    'state', CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
                  WHEN g.starts_at IS NOT NULL THEN 'active'
                  WHEN g.confirmed_at IS NOT NULL THEN 'waiting_second_approver'
                  WHEN g.created_at < now() - interval '24 hours' THEN 'lapsed' ELSE 'requested' END)
    ORDER BY g.created_at DESC) FROM (SELECT * FROM public.support_access_grant WHERE org_id = p_org
                                       ORDER BY created_at DESC LIMIT 100) g), '[]'::jsonb);
END $$;

CREATE FUNCTION public.support_audit_list(p_org uuid, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_org(p_org) THEN
    RAISE EXCEPTION 'support:not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('grant', a.grant_id, 'seq', a.seq, 'action', a.action,
    'severity', a.severity, 'actor', a.actor, 'detail', a.detail, 'at', a.at) ORDER BY a.at DESC)
    FROM (SELECT * FROM public.support_access_audit WHERE org_id = p_org
           ORDER BY at DESC LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)) a), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.support_audit_write(uuid, text, text, jsonb), public.support_audit_guard(), public.support_grant_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.support_grant_request(uuid, text, text, text, text[], text, integer),
  public.support_grant_confirm(uuid), public.support_grant_second_approve(uuid),
  public.support_break_glass_open(uuid, text, text[]), public.support_grant_revoke(uuid),
  public.support_access_log(uuid, text, text, text, jsonb),
  public.support_grants_list(uuid), public.support_audit_list(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.support_grant_request(uuid, text, text, text, text[], text, integer),
  public.support_grant_confirm(uuid), public.support_grant_second_approve(uuid),
  public.support_break_glass_open(uuid, text, text[]), public.support_grant_revoke(uuid),
  public.support_access_log(uuid, text, text, text, jsonb),
  public.support_grants_list(uuid), public.support_audit_list(uuid, integer)
  TO authenticated;
