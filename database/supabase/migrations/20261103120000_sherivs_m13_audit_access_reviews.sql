-- M13: tenant-scoped access-review campaigns and immutable review audit events.
DO $guard$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regclass('public.role_assignment_audit_events') IS NULL
     OR to_regprocedure('public.get_my_school_id()') IS NULL
     OR to_regprocedure('public.can_manage_roles(uuid,text)') IS NULL
     OR to_regprocedure('public.workspace_role_engine_tenant_lock(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M13 requires the M009 role engine and M04 tenant model'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

BEGIN;

CREATE TABLE public.role_access_review_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (id, org_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX role_access_review_campaigns_tenant_due
  ON public.role_access_review_campaigns (org_id, due_at DESC);

CREATE TABLE public.role_access_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_code text NOT NULL,
  scope_type text NOT NULL,
  scope_ref text,
  assignment_started_at timestamptz NOT NULL,
  assignment_valid_until timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','retained','revoked','already_ended')),
  decided_by uuid,
  decided_at timestamptz,
  UNIQUE (campaign_id, assignment_id),
  FOREIGN KEY (campaign_id, org_id)
    REFERENCES public.role_access_review_campaigns(id, org_id) ON DELETE CASCADE,
  CHECK (assignment_valid_until IS NULL OR assignment_valid_until > assignment_started_at),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);
CREATE INDEX role_access_review_items_pending
  ON public.role_access_review_items (org_id, campaign_id, status);
CREATE INDEX role_access_review_items_assignment
  ON public.role_access_review_items (org_id, assignment_id);

CREATE TABLE public.role_access_review_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  item_id uuid,
  assignment_id uuid,
  target_user_id uuid,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'campaign_created',
    'assignment_retained',
    'assignment_revoked',
    'assignment_already_ended',
    'campaign_completed'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX role_access_review_audit_tenant_time
  ON public.role_access_review_audit_events (org_id, occurred_at DESC);
CREATE INDEX role_access_review_audit_campaign
  ON public.role_access_review_audit_events (org_id, campaign_id, occurred_at);

CREATE OR REPLACE FUNCTION public.workspace_access_review_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'access-review audit events are append-only'
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER role_access_review_audit_immutable
  BEFORE UPDATE OR DELETE ON public.role_access_review_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.workspace_access_review_audit_immutable();
CREATE TRIGGER role_access_review_audit_no_truncate
  BEFORE TRUNCATE ON public.role_access_review_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.workspace_access_review_audit_immutable();

ALTER TABLE public.role_access_review_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_access_review_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_access_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_access_review_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_access_review_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_access_review_audit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.role_access_review_campaigns,
  public.role_access_review_items,
  public.role_access_review_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.role_access_review_campaigns,
  public.role_access_review_items,
  public.role_access_review_audit_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.role_assignment_audit_events
  FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY role_access_review_campaigns_read ON public.role_access_review_campaigns
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.get_my_school_id())
    AND (
      public.can_manage_roles(org_id, 'roles.assign')
      OR public.scholar_can(org_id, 'audit.view')
    )
  );
CREATE POLICY role_access_review_items_read ON public.role_access_review_items
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.get_my_school_id())
    AND (
      public.can_manage_roles(org_id, 'roles.assign')
      OR public.scholar_can(org_id, 'audit.view')
    )
  );
CREATE POLICY role_access_review_audit_read ON public.role_access_review_audit_events
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.get_my_school_id())
    AND (
      public.can_manage_roles(org_id, 'roles.assign')
      OR public.scholar_can(org_id, 'audit.view')
    )
  );

CREATE OR REPLACE FUNCTION public.workspace_access_review_campaign_create(
  p_org uuid,
  p_title text,
  p_due_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_campaign_id uuid;
  v_created_at timestamptz := clock_timestamp();
  v_item_count bigint;
BEGIN
  IF p_org IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'tenant and authenticated actor are required'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_roles(p_org, 'roles.assign')
     OR NOT EXISTS (
       SELECT 1
         FROM public.organization_memberships m
         JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id = auth.uid()
          AND m.school_id = p_org
          AND m.is_active
          AND u.is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'active tenant membership and roles.assign are required'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.workspace_role_engine_tenant_lock(p_org);
  IF NOT public.can_manage_roles(p_org, 'roles.assign')
     OR NOT EXISTS (
       SELECT 1
         FROM public.organization_memberships m
         JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id = auth.uid()
          AND m.school_id = p_org
          AND m.is_active
          AND u.is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'active tenant membership and roles.assign are required'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'campaign title must contain 2 to 160 characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_due_at IS NULL OR p_due_at <= v_created_at THEN
    RAISE EXCEPTION 'campaign due_at must be in the future'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.role_access_review_campaigns (org_id, title, created_by, created_at, due_at)
  VALUES (p_org, btrim(p_title), auth.uid(), v_created_at, p_due_at)
  RETURNING id INTO v_campaign_id;

  INSERT INTO public.role_access_review_items (
    org_id, campaign_id, assignment_id, user_id, role_code, scope_type, scope_ref,
    assignment_started_at, assignment_valid_until
  )
  SELECT a.org_id, v_campaign_id, a.id, a.user_id, a.role_code, a.scope_type, a.scope_ref,
         a.started_at, a.valid_until
    FROM public.user_role_assignments a
    JOIN public.organization_memberships m
      ON m.school_id = a.org_id AND m.user_id = a.user_id AND m.is_active
    JOIN public.users u ON u.id = a.user_id AND u.is_active IS TRUE
   WHERE a.org_id = p_org
     AND a.status = 'active'
     AND a.started_at <= v_created_at
     AND (a.valid_until IS NULL OR a.valid_until > v_created_at);
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  INSERT INTO public.role_access_review_audit_events (
    org_id, campaign_id, actor_user_id, action, details
  ) VALUES (
    p_org, v_campaign_id, auth.uid(), 'campaign_created',
    jsonb_build_object('assignment_count', v_item_count, 'due_at', p_due_at)
  );

  IF v_item_count = 0 THEN
    UPDATE public.role_access_review_campaigns
       SET status = 'completed', completed_at = clock_timestamp()
     WHERE id = v_campaign_id;
    INSERT INTO public.role_access_review_audit_events (
      org_id, campaign_id, actor_user_id, action
    ) VALUES (p_org, v_campaign_id, auth.uid(), 'campaign_completed');
  END IF;
  RETURN v_campaign_id;
END
$$;

CREATE OR REPLACE FUNCTION public.workspace_access_review_decide(
  p_item_id uuid,
  p_decision text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.role_access_review_items%ROWTYPE;
  v_campaign_status text;
  v_assignment_status text;
  v_assignment_valid_until timestamptz;
  v_assignment_found boolean;
  v_result text;
  v_action text;
  v_org uuid;
BEGIN
  SELECT i.* INTO v_item
    FROM public.role_access_review_items i
    JOIN public.role_access_review_campaigns c
      ON c.id = i.campaign_id AND c.org_id = i.org_id
   WHERE i.id = p_item_id
   FOR UPDATE OF i, c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access-review item not found' USING ERRCODE = '42501';
  END IF;
  v_org := v_item.org_id;
  SELECT c.status INTO v_campaign_status
    FROM public.role_access_review_campaigns c
   WHERE c.id = v_item.campaign_id;

  IF auth.uid() IS NULL
     OR auth.uid() = v_item.user_id
     OR NOT public.can_manage_roles(v_org, 'roles.assign')
     OR NOT EXISTS (
       SELECT 1
         FROM public.organization_memberships m
         JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id = auth.uid()
          AND m.school_id = v_org
          AND m.is_active
          AND u.is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'active tenant reviewer with roles.assign is required'
      USING ERRCODE = '42501';
  END IF;
  IF v_campaign_status <> 'open' OR v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'access-review item is not pending'
      USING ERRCODE = '55000';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('retain','revoke') THEN
    RAISE EXCEPTION 'decision must be retain or revoke'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.status, a.valid_until
    INTO v_assignment_status, v_assignment_valid_until
    FROM public.user_role_assignments a
   WHERE a.id = v_item.assignment_id
     AND a.org_id = v_org
     AND a.user_id = v_item.user_id
   FOR UPDATE;
  v_assignment_found := FOUND;
  PERFORM public.workspace_role_engine_tenant_lock(v_org);
  IF auth.uid() IS NULL
     OR auth.uid() = v_item.user_id
     OR NOT public.can_manage_roles(v_org, 'roles.assign')
     OR NOT EXISTS (
       SELECT 1
         FROM public.organization_memberships m
         JOIN public.users u ON u.id = m.user_id
        WHERE m.user_id = auth.uid()
          AND m.school_id = v_org
          AND m.is_active
          AND u.is_active IS TRUE
     ) THEN
    RAISE EXCEPTION 'active tenant reviewer with roles.assign is required'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_assignment_found
     OR v_assignment_status <> 'active'
     OR (v_assignment_valid_until IS NOT NULL AND v_assignment_valid_until <= clock_timestamp()) THEN
    v_result := 'already_ended';
    v_action := 'assignment_already_ended';
  ELSIF p_decision = 'retain' THEN
    v_result := 'retained';
    v_action := 'assignment_retained';
  ELSE
    UPDATE public.user_role_assignments
       SET status = 'ended',
           ended_at = clock_timestamp(),
           ended_by = auth.uid()
     WHERE id = v_item.assignment_id
       AND org_id = v_org
       AND user_id = v_item.user_id
       AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'assignment changed during access review'
        USING ERRCODE = '40001';
    END IF;
    v_result := 'revoked';
    v_action := 'assignment_revoked';
  END IF;

  UPDATE public.role_access_review_items
     SET status = v_result, decided_by = auth.uid(), decided_at = clock_timestamp()
   WHERE id = v_item.id;
  INSERT INTO public.role_access_review_audit_events (
    org_id, campaign_id, item_id, assignment_id, target_user_id, actor_user_id, action, details
  ) VALUES (
    v_org, v_item.campaign_id, v_item.id, v_item.assignment_id, v_item.user_id,
    auth.uid(), v_action, jsonb_build_object('decision', p_decision)
  );

  UPDATE public.role_access_review_campaigns c
     SET status = 'completed', completed_at = clock_timestamp()
   WHERE c.id = v_item.campaign_id
     AND c.status = 'open'
     AND NOT EXISTS (
       SELECT 1 FROM public.role_access_review_items i
        WHERE i.campaign_id = c.id AND i.org_id = c.org_id AND i.status = 'pending'
     );
  IF FOUND THEN
    INSERT INTO public.role_access_review_audit_events (
      org_id, campaign_id, actor_user_id, action
    ) VALUES (v_org, v_item.campaign_id, auth.uid(), 'campaign_completed');
  END IF;
  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.workspace_access_review_audit_immutable(),
  public.workspace_access_review_campaign_create(uuid,text,timestamptz),
  public.workspace_access_review_decide(uuid,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_access_review_campaign_create(uuid,text,timestamptz),
  public.workspace_access_review_decide(uuid,text) TO authenticated;

COMMIT;
