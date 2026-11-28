-- M2b override kinds (ADR-159): the resolver now also honours disable/enable, scope_narrow and add_responsibility,
-- and two new functions apply approval_limit and rename. Builds on the M2b resolver (20261127000400): apply that first.
--   disable / enable   a template is off in an organization from the latest approved, in-force disable until a later approved enable;
--                      on a tie the disable wins. A disabled template's roles yield no permission rows.
--   scope_narrow       an assignment held at a broader scope than the override's scope yields no rows (fail closed) until the
--                      holder is assigned again at the narrower scope. The assignment's own scope is never rewritten. An assignment
--                      with scope sets keeps only the sets that name a campus or class narrow enough; with none, it yields no rows.
--   add_responsibility the pack responsibility's permissions are granted to roles of the template; protected permissions never.
--   approval_limit     workspace_effective_approval_limit(): the template ceiling, lowered by the lowest in-force approved
--                      override; school_expenses_sod_guard uses it.
--   rename             workspace_role_display_name(): the approved, in-force name, else the catalog name. Display only.
-- NOT APPLIED. Founder approval and a backup are required first. Changes who can do what; Tumi's review is required.

DO $$
BEGIN
  IF pg_get_functiondef('public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz)'::regprocedure)
       NOT LIKE '%tenant_role_overrides%'
     OR to_regprocedure('public.role_pack_scope_rank(text)') IS NULL
     OR to_regclass('public.tenant_role_pack_installations') IS NULL THEN
    RAISE EXCEPTION 'M2b override kinds need the M2b resolver and the role pack engine' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.workspace_template_disabled(uuid,text,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'M2b override kinds already applied' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE FUNCTION public.workspace_template_disabled(p_org uuid, p_template text, p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH ov AS (
    SELECT o.override_kind, o.effective_from FROM public.tenant_role_overrides o
     WHERE o.org_id = p_org AND o.template_code = p_template AND o.override_kind IN ('enable', 'disable')
       AND o.approved_by IS NOT NULL AND o.effective_from <= p_at AND (o.effective_to IS NULL OR o.effective_to > p_at)
  )
  SELECT coalesce(
    (SELECT max(effective_from) FROM ov WHERE override_kind = 'disable')
      >= coalesce((SELECT max(effective_from) FROM ov WHERE override_kind = 'enable'), '-infinity'::timestamptz),
    false)
$$;

CREATE FUNCTION public.workspace_scope_dim_rank(p_dim text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Only the dimensions that sit on the scope hierarchy can satisfy a narrowing; the others
  -- (shift, section, gender, level, subject, house, hostel) say nothing about how narrow the holder is.
  SELECT CASE p_dim WHEN 'campus' THEN 1 WHEN 'class' THEN 4 END
$$;

CREATE FUNCTION public.workspace_template_min_scope_rank(p_org uuid, p_template text, p_at timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(max(public.role_pack_scope_rank(o.payload->>'scope')), 0)
    FROM public.tenant_role_overrides o
   WHERE o.org_id = p_org AND o.template_code = p_template AND o.override_kind = 'scope_narrow'
     AND o.approved_by IS NOT NULL AND o.effective_from <= p_at AND (o.effective_to IS NULL OR o.effective_to > p_at)
$$;

CREATE FUNCTION public.workspace_effective_approval_limit(p_org uuid, p_user uuid, p_at timestamptz DEFAULT now())
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT max(CASE WHEN t.approval_limit_ngn IS NULL THEN NULL ELSE least(t.approval_limit_ngn, coalesce((
           SELECT min((o.payload->>'limit_ngn')::numeric) FROM public.tenant_role_overrides o
            WHERE o.org_id = p_org AND o.template_code = t.code AND o.override_kind = 'approval_limit'
              AND o.approved_by IS NOT NULL AND o.effective_from <= p_at
              AND (o.effective_to IS NULL OR o.effective_to > p_at)), t.approval_limit_ngn)) END)
    FROM public.workspace_effective_assignments_at(p_org, p_user, p_at) e
    JOIN public.role_catalog r ON r.code = e.role_code
    JOIN public.role_templates t ON t.code = r.template_code
   WHERE NOT public.workspace_template_disabled(p_org, t.code, p_at)
$$;

CREATE FUNCTION public.workspace_role_display_name(p_org uuid, p_role_code text, p_at timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NOT NULL AND public.role_pack_user_in_org(auth.uid(), p_org))) THEN
    RETURN NULL;
  END IF;
  RETURN coalesce((
    SELECT o.payload->>'name' FROM public.role_catalog r
      JOIN public.tenant_role_overrides o ON o.org_id = p_org AND o.template_code = r.template_code AND o.override_kind = 'rename'
     WHERE r.code = p_role_code AND o.approved_by IS NOT NULL AND o.effective_from <= p_at
       AND (o.effective_to IS NULL OR o.effective_to > p_at)
     ORDER BY o.effective_from DESC, o.created_at DESC LIMIT 1),
    (SELECT r.name FROM public.role_catalog r WHERE r.code = p_role_code));
END $$;

REVOKE ALL ON FUNCTION public.workspace_scope_dim_rank(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.workspace_template_disabled(uuid, text, timestamptz),
  public.workspace_template_min_scope_rank(uuid, text, timestamptz),
  public.workspace_effective_approval_limit(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.workspace_role_display_name(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_role_display_name(uuid, text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workspace_effective_permission_rows_at(p_org uuid, p_user uuid, p_at timestamp with time zone)
 RETURNS TABLE(permission_code text, kind text, role_code text, assignment_id uuid, scope_type text, scope_ref text, scope_values jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH assigned AS (
    SELECT e.*
      FROM public.workspace_effective_assignments_at(p_org, p_user, p_at) e
      JOIN public.user_role_assignments a ON a.id = e.assignment_id
      JOIN public.role_catalog role ON role.code = e.role_code
     WHERE (NOT role.requires_verified_authority_link
         OR public.workspace_authority_link_evidence_is_verified(
           p_org, a.evidence, p_at, a.assigned_by, a.user_id
         ))
       AND NOT public.workspace_template_disabled(p_org, role.template_code, p_at)
       AND (coalesce(public.role_pack_scope_rank(e.scope_type), 0)
              >= public.workspace_template_min_scope_rank(p_org, role.template_code, p_at)
            OR EXISTS (
              SELECT 1 FROM public.role_assignment_scope_sets ss
                JOIN public.role_assignment_scopes sx ON sx.set_id = ss.id
               WHERE ss.assignment_id = e.assignment_id
                 AND public.workspace_scope_dim_rank(sx.dim)
                     >= public.workspace_template_min_scope_rank(p_org, role.template_code, p_at)))
  ), grants AS (
    SELECT tp.permission_code, tp.kind, a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s
        ON s.org_id = p_org AND s.role_code = a.role_code AND s.permission_code = tp.permission_code
     WHERE (tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on))
       AND (tp.kind = 'mandatory' OR NOT EXISTS (
         SELECT 1 FROM public.tenant_role_overrides o
          WHERE o.org_id = p_org AND o.template_code = tp.template_code
            AND o.override_kind = 'remove_optional_permission' AND o.payload->>'permission' = tp.permission_code
            AND o.approved_by IS NOT NULL AND o.effective_from <= p_at AND (o.effective_to IS NULL OR o.effective_to > p_at)))
    UNION ALL
    SELECT o.payload->>'permission', 'optional', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.tenant_role_overrides o
        ON o.org_id = p_org AND o.template_code = r.template_code AND o.override_kind = 'add_optional_permission'
     WHERE o.approved_by IS NOT NULL AND o.effective_from <= p_at AND (o.effective_to IS NULL OR o.effective_to > p_at)
    UNION ALL
    SELECT x.perm, 'responsibility', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.tenant_role_overrides o
        ON o.org_id = p_org AND o.template_code = r.template_code AND o.override_kind = 'add_responsibility'
      JOIN public.tenant_role_pack_installations i ON i.org_id = p_org AND i.status = 'active'
      JOIN public.role_pack_items it
        ON it.pack_code = i.pack_code AND it.pack_version = i.pack_version
       AND it.item_kind = 'responsibility' AND it.item_ref = o.payload->>'responsibility'
      CROSS JOIN LATERAL unnest(public.role_pack_text_array(it.payload->'permissions')) AS x(perm)
      LEFT JOIN public.permission_catalog c ON c.code = x.perm
     WHERE o.approved_by IS NOT NULL AND o.effective_from <= p_at AND (o.effective_to IS NULL OR o.effective_to > p_at)
       AND NOT coalesce(c.protected, false)
    UNION ALL
    SELECT rp.permission_code, r.kind, a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.workspace_role_responsibilities rr
        ON rr.org_id = p_org AND rr.role_code = a.role_code
      JOIN public.workspace_responsibility_catalog r ON r.id = rr.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = r.id
     WHERE r.kind IN ('core','custom') AND (r.org_id IS NULL OR r.org_id = p_org)
    UNION ALL
    SELECT coalesce(cg.permission_code, cg.custom_key), 'custom', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.org_role_custom_grants cg ON cg.org_id = p_org AND cg.role_code = a.role_code
    UNION ALL
    SELECT rp.permission_code, 'responsibility', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_assignment_responsibility_grants g ON g.assignment_id = a.assignment_id
      JOIN public.workspace_role_responsibilities rr
        ON rr.org_id = p_org AND rr.role_code = a.role_code AND rr.responsibility_id = g.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = g.responsibility_id
     WHERE g.org_id = p_org AND g.valid_from <= p_at
       AND (g.valid_until IS NULL OR g.valid_until > p_at)
       AND (g.revoked_at IS NULL OR g.revoked_at > p_at)
  )
  SELECT g.permission_code, min(g.kind), g.role_code, g.assignment_id, g.scope_type, g.scope_ref,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.role_assignment_scope_sets s WHERE s.assignment_id = g.assignment_id
         ) THEN coalesce((
           SELECT jsonb_agg(DISTINCT jsonb_build_object('type', x.dim, 'ref', x.ref))
             FROM public.role_assignment_scope_sets s
             JOIN public.role_assignment_scopes x ON x.set_id = s.id
            WHERE s.assignment_id = g.assignment_id
              AND (coalesce(public.role_pack_scope_rank(g.scope_type), 0) >= public.workspace_template_min_scope_rank(
                     p_org, (SELECT rc.template_code FROM public.role_catalog rc WHERE rc.code = g.role_code), p_at)
                   OR EXISTS (
                     SELECT 1 FROM public.role_assignment_scopes y
                      WHERE y.set_id = s.id AND public.workspace_scope_dim_rank(y.dim) >= public.workspace_template_min_scope_rank(
                        p_org, (SELECT rc.template_code FROM public.role_catalog rc WHERE rc.code = g.role_code), p_at)))
         ), '[]'::jsonb)
         ELSE jsonb_build_array(jsonb_build_object(
           'type', CASE WHEN g.scope_type = 'org' THEN 'institution' ELSE g.scope_type END,
           'ref', g.scope_ref
         )) END
    FROM grants g
   GROUP BY g.permission_code, g.role_code, g.assignment_id, g.scope_type, g.scope_ref
$function$;

CREATE OR REPLACE FUNCTION public.school_expenses_sod_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_limit numeric; v_has_roles boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NOT NULL THEN NEW.created_by := v_actor; END IF;           -- the raiser is the caller, never client-sent
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  IF NEW.approved_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by OR OLD.amount IS DISTINCT FROM NEW.amount) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'no_self_expense_approval: an approved expense needs a recorded raiser' USING ERRCODE = '42501'; END IF;
    IF NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'no_self_expense_approval: you cannot approve an expense you raised' USING ERRCODE = '42501'; END IF;
    SELECT bool_or(true), public.workspace_effective_approval_limit(NEW.school_id, NEW.approved_by) INTO v_has_roles, v_limit
      FROM public.user_role_assignments a JOIN public.role_catalog r ON r.code = a.role_code
     WHERE a.org_id = NEW.school_id AND a.user_id = NEW.approved_by AND a.status = 'active'
       AND EXISTS (SELECT 1 FROM public.effective_permissions(NEW.school_id, NEW.approved_by) e WHERE e.permission_code = 'expenses.approve');
    IF coalesce(v_has_roles, false) AND NEW.amount > coalesce(v_limit, 0) THEN
      RAISE EXCEPTION 'approval limit exceeded: % > %', NEW.amount, coalesce(v_limit, 0) USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
