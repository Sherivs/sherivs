-- M2b resolver (ADR-146 §7.3): effective permissions now honour approved, in-force tenant overrides.
-- add_optional_permission adds the permission to every role built on that template; remove_optional_permission removes an
-- optional one. Mandatory permissions can never be removed (the override guard already refuses it; the resolver ignores it too).
-- Other override kinds (rename, enable, disable, scope_narrow, approval_limit, add_responsibility) are NOT applied here.
-- NOT APPLIED. Founder approval and a backup are required first. Changes who can do what; Tumi's review is required.

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
     WHERE NOT role.requires_verified_authority_link
         OR public.workspace_authority_link_evidence_is_verified(
           p_org, a.evidence, p_at, a.assigned_by, a.user_id
         )
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
         ), '[]'::jsonb)
         ELSE jsonb_build_array(jsonb_build_object(
           'type', CASE WHEN g.scope_type = 'org' THEN 'institution' ELSE g.scope_type END,
           'ref', g.scope_ref
         )) END
    FROM grants g
   GROUP BY g.permission_code, g.role_code, g.assignment_id, g.scope_type, g.scope_ref
$function$;
