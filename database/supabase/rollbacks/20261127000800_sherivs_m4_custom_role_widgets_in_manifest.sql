-- Rollback: restores workspace_manifest to the body before custom role widgets were included.
CREATE OR REPLACE FUNCTION public.workspace_manifest(p_org uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_org uuid := coalesce(p_org, public.get_my_school_id());
  v_uid uuid := auth.uid();
  v_perms text[]; v_feat text[]; v_templates text[]; v_fams jsonb; v_prefs jsonb; v_hidden text[]; v_order text[];
  v_widgets text[]; v_actions text[]; v_out jsonb; v_legacy text; v_famarr text[]; v_pol text[]; v_scopes jsonb; v_dims text[];
  v_personal boolean;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_role_assignments WHERE org_id = v_org AND user_id = v_uid AND status = 'active')
     AND public.get_my_school_id() IS DISTINCT FROM v_org AND NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'not a member of this organisation' USING ERRCODE = '42501';
  END IF;
  v_perms := public.workspace_permission_codes(v_org);
  v_feat := public.workspace_features(v_org);
  v_pol := public.workspace_policies(v_org);
  v_scopes := public.workspace_scope_options(v_org);
  v_dims := array(SELECT jsonb_object_keys(v_scopes));
  v_personal := 'workspace.personalise' = ANY (v_pol) OR 'settings.manage' = ANY (v_perms);
  SELECT array_agg(DISTINCT r.template_code) INTO v_templates
    FROM public.user_role_assignments a JOIN public.role_catalog r ON r.code = a.role_code
   WHERE a.org_id = v_org AND a.user_id = v_uid AND a.status = 'active';
  IF v_templates IS NULL THEN
    v_legacy := public.get_my_role();
    v_templates := ARRAY[CASE v_legacy WHEN 'admin' THEN 'head_of_institution' WHEN 'principal' THEN 'head_of_institution'
      WHEN 'bursar' THEN 'bursar' WHEN 'teacher' THEN 'teacher' WHEN 'parent' THEN 'parent' WHEN 'student' THEN 'student' ELSE 'support_staff' END];
  END IF;
  SELECT coalesce(jsonb_agg(f.family ORDER BY f.priority), '["staff"]') INTO v_fams
    FROM public.workspace_family_layouts f WHERE f.template_codes && v_templates;
  IF jsonb_array_length(v_fams) = 0 THEN v_fams := '["staff"]'; END IF;
  v_famarr := array(SELECT jsonb_array_elements_text(v_fams));
  SELECT prefs INTO v_prefs FROM public.user_workspace_prefs WHERE user_id = v_uid AND org_id = v_org;
  -- When the school turns personalisation off, stored prefs are ignored (except language/density).
  v_prefs := CASE WHEN v_personal THEN coalesce(v_prefs, '{}') ELSE jsonb_strip_nulls(jsonb_build_object('locale', v_prefs->'locale', 'density', v_prefs->'density')) END;
  v_hidden := array(SELECT jsonb_array_elements_text(coalesce(v_prefs->'hidden', '[]')));
  v_order := array(SELECT jsonb_array_elements_text(coalesce(v_prefs->'order', '[]')));

  WITH ok AS (SELECT i.* FROM public.workspace_item_catalog i WHERE public._workspace_item_ok2(i, v_perms, v_feat, v_famarr, v_pol, v_dims)),
  fam AS (SELECT f.*, ord FROM public.workspace_family_layouts f
            JOIN jsonb_array_elements_text(v_fams) WITH ORDINALITY x(fam, ord) ON x.fam = f.family),
  cand AS (
    SELECT k, min(base) base FROM (
      SELECT i.key k, 1001.5 + i.sort / 100000.0 base FROM ok i WHERE i.kind = 'widget' AND cardinality(i.scope_dims) > 0  -- scope cards right after the lead card
      UNION ALL SELECT w, ord * 1000 + pos FROM fam, unnest(fam.widgets) WITH ORDINALITY u(w, pos)
      UNION ALL SELECT e, 999000 + pos FROM jsonb_array_elements_text(coalesce(v_prefs->'added', '[]')) WITH ORDINALITY u(e, pos)) z
    GROUP BY k)
  SELECT array_agg(c.k ORDER BY coalesce(array_position(v_order, c.k), 100000000 + c.base)) INTO v_widgets
    FROM cand c JOIN ok ON ok.key = c.k AND ok.kind = 'widget' WHERE NOT (c.k = ANY (v_hidden));

  WITH ok AS (SELECT i.* FROM public.workspace_item_catalog i WHERE public._workspace_item_ok2(i, v_perms, v_feat, v_famarr, v_pol, v_dims) AND i.kind = 'action'),
  pref AS (SELECT e k, pos FROM jsonb_array_elements_text(coalesce(v_prefs->'actions', '[]')) WITH ORDINALITY u(e, pos)),
  dflt AS (SELECT a k, min(x.ord * 1000 + pos) pos FROM public.workspace_family_layouts f
             JOIN jsonb_array_elements_text(v_fams) WITH ORDINALITY x(fam, ord) ON x.fam = f.family,
             unnest(f.actions) WITH ORDINALITY u(a, pos) GROUP BY a),
  src AS (SELECT * FROM pref UNION ALL SELECT * FROM dflt WHERE NOT EXISTS (SELECT 1 FROM pref))
  SELECT (array_agg(src.k ORDER BY src.pos))[1:6] INTO v_actions FROM src JOIN ok ON ok.key = src.k;

  SELECT jsonb_build_object(
    'version', 2, 'org_id', v_org, 'families', v_fams, 'primary_family', v_fams->>0, 'features', to_jsonb(v_feat),
    'policies', to_jsonb(v_pol), 'can_personalise', v_personal, 'scope_options', v_scopes,
    'locale', coalesce(v_prefs->>'locale', 'en'), 'density', coalesce(v_prefs->>'density', 'comfortable'),
    'scopes', coalesce((SELECT jsonb_agg(jsonb_build_object('role', a.role_code, 'type', a.scope_type, 'ref', a.scope_ref,
                 'sets', (SELECT coalesce(jsonb_agg(d.dims), '[]') FROM (SELECT (SELECT jsonb_object_agg(dim, refs) FROM (
                     SELECT dim, jsonb_agg(ref ORDER BY ref) refs FROM public.role_assignment_scopes WHERE set_id = ss.id GROUP BY dim) q) dims
                   FROM public.role_assignment_scope_sets ss WHERE ss.assignment_id = a.id) d)))
               FROM public.user_role_assignments a WHERE a.org_id = v_org AND a.user_id = v_uid AND a.status = 'active'), '[]'),
    'nav', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'to', route, 'label', label_en) ORDER BY sort)
                 FROM public.workspace_item_catalog i WHERE kind = 'nav' AND public._workspace_item_ok2(i, v_perms, v_feat, v_famarr, v_pol, v_dims)), '[]'),
    'widgets', coalesce((SELECT jsonb_agg(jsonb_build_object('key', i.key, 'to', i.route, 'size', i.size, 'label', i.label_en,
                   'scope', (SELECT coalesce(jsonb_object_agg(d, v_scopes->d), '{}') FROM unnest(i.scope_dims) d WHERE v_scopes ? d)) ORDER BY u.pos)
                 FROM unnest(v_widgets) WITH ORDINALITY u(k, pos) JOIN public.workspace_item_catalog i ON i.key = u.k), '[]'),
    'available', coalesce((SELECT jsonb_agg(i.key ORDER BY i.sort) FROM public.workspace_item_catalog i
                 WHERE i.kind = 'widget' AND public._workspace_item_ok2(i, v_perms, v_feat, v_famarr, v_pol, v_dims) AND NOT (i.key = ANY (coalesce(v_widgets, '{}')))), '[]'),
    'actions', coalesce((SELECT jsonb_agg(jsonb_build_object('key', i.key, 'to', i.route, 'label', i.label_en) ORDER BY u.pos)
                 FROM unnest(v_actions) WITH ORDINALITY u(k, pos) JOIN public.workspace_item_catalog i ON i.key = u.k), '[]'),
    'inbox', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'to', route, 'label', label_en) ORDER BY sort)
                 FROM public.workspace_item_catalog i WHERE kind = 'inbox' AND public._workspace_item_ok2(i, v_perms, v_feat, v_famarr, v_pol, v_dims)), '[]'),
    'hidden_by_policy', (SELECT count(*) FROM public.workspace_item_catalog i WHERE NOT public._workspace_item_ok2(i, v_perms, v_feat, v_famarr, v_pol, v_dims))
  ) INTO v_out;
  RETURN v_out;
END $function$;
