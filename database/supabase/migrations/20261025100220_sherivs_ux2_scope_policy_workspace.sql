-- SHERIVS-UX2: scope-aware and policy-aware workspaces (continues SHERIVS-UX1).
-- Adds two more inputs to the server-computed workspace:
--   1. Assigned scope dimensions. Catalog items may declare scope_dims (campus, shift, section, level, class,
--      house, hostel...). Such an item appears only for a person whose active role assignment carries a scope
--      set on one of those dimensions, and it is placed right after their primary family's lead card. So a campus head and a whole-school
--      principal with the same role template get different homes, and so do two shift supervisors.
--   2. School workspace policies (workspace_policy_catalog + org_workspace_policies). A policy can only hide
--      items (never grant). workspace.personalise=off makes the home read-only for everyone but admins.
-- The manifest also returns scope_options (every dimension -> refs the caller holds) and policies (on keys),
-- so the UI can offer a scope switcher. Hidden != secure: RLS / scholar_can / authz_check still enforce.
-- Not applied to production. Rollback: database/supabase/rollbacks/20261025100220_sherivs_ux2_scope_policy_workspace.sql
BEGIN;

ALTER TABLE public.workspace_item_catalog ADD COLUMN IF NOT EXISTS scope_dims text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.workspace_item_catalog ADD COLUMN IF NOT EXISTS policy text;

CREATE TABLE IF NOT EXISTS public.workspace_policy_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,32}\.[a-z_]{2,32}$'),
  default_on boolean NOT NULL,
  label_en text NOT NULL,
  sort int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.org_workspace_policies (
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  policy text NOT NULL REFERENCES public.workspace_policy_catalog(key) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, policy));
ALTER TABLE public.workspace_policy_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_workspace_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_policy_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_workspace_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_policy_catalog_read ON public.workspace_policy_catalog;
CREATE POLICY workspace_policy_catalog_read ON public.workspace_policy_catalog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS org_workspace_policies_read ON public.org_workspace_policies;
CREATE POLICY org_workspace_policies_read ON public.org_workspace_policies FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id()) OR (SELECT public.can_administer_org(org_id)));
REVOKE INSERT, UPDATE, DELETE ON public.workspace_policy_catalog, public.org_workspace_policies FROM anon, authenticated;
GRANT SELECT ON public.workspace_policy_catalog, public.org_workspace_policies TO authenticated;

-- >>> generated ux2 by tools/workspace/catalog_src.py (do not hand-edit) >>>
UPDATE public.workspace_item_catalog c SET scope_dims = '{}', policy = NULL WHERE cardinality(c.scope_dims) > 0 OR c.policy IS NOT NULL;
UPDATE public.workspace_item_catalog c SET scope_dims = v.d, policy = v.p FROM (VALUES
  ('nav.my_results',ARRAY[]::text[],'students.results_online'),
  ('nav.ai_tutor',ARRAY[]::text[],'students.ai_tutor'),
  ('w.child_fees',ARRAY[]::text[],'parents.fees_online'),
  ('w.child_bus',ARRAY[]::text[],'parents.bus_tracking'),
  ('w.my_results',ARRAY[]::text[],'students.results_online'),
  ('w.ai_tutor',ARRAY[]::text[],'students.ai_tutor'),
  ('w.ai_lesson_helper',ARRAY[]::text[],'staff.ai_helper'),
  ('w.campus_overview',ARRAY['campus']::text[],NULL),
  ('w.shift_overview',ARRAY['shift']::text[],NULL),
  ('w.section_overview',ARRAY['section']::text[],NULL),
  ('w.level_overview',ARRAY['level','class','subject']::text[],NULL),
  ('w.house_overview',ARRAY['house','hostel']::text[],NULL),
  ('a.message_parents',ARRAY[]::text[],'staff.message_parents'),
  ('a.pay_fees',ARRAY[]::text[],'parents.fees_online'),
  ('a.ask_tutor',ARRAY[]::text[],'students.ai_tutor')
) v(k, d, p) WHERE c.key = v.k;
INSERT INTO public.workspace_policy_catalog (key, default_on, label_en, sort) VALUES
  ('workspace.personalise',true,'Staff, parents and students can personalise their home screen',0),
  ('students.ai_tutor',true,'Students can use the AI tutor',1),
  ('students.results_online',true,'Students see their results in the app once published',2),
  ('staff.ai_helper',true,'Teachers can use the AI lesson helper',3),
  ('staff.message_parents',true,'Teachers can message parents of their classes',4),
  ('parents.fees_online',true,'Parents see fees due and can pay in the app',5),
  ('parents.bus_tracking',true,'Parents can see live school bus location',6)
ON CONFLICT (key) DO UPDATE SET default_on=EXCLUDED.default_on, label_en=EXCLUDED.label_en, sort=EXCLUDED.sort;
-- <<< generated ux2 <<<

-- Policies switched on for a school (catalog default unless the school overrode it) ----------------
CREATE OR REPLACE FUNCTION public.workspace_policies(p_org uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(c.key ORDER BY c.sort), '{}') FROM public.workspace_policy_catalog c
    LEFT JOIN public.org_workspace_policies o ON o.org_id = p_org AND o.policy = c.key
   WHERE coalesce(o.enabled, c.default_on);
$$;

-- Scope dimensions -> refs the caller holds in this org (from active assignments' scope sets) ---------
CREATE OR REPLACE FUNCTION public.workspace_scope_options(p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(dim, refs), '{}') FROM (
    SELECT s.dim, jsonb_agg(DISTINCT s.ref) refs
      FROM public.user_role_assignments a
      JOIN public.role_assignment_scope_sets ss ON ss.assignment_id = a.id
      JOIN public.role_assignment_scopes s ON s.set_id = ss.id
     WHERE a.org_id = p_org AND a.user_id = auth.uid() AND a.status = 'active'
     GROUP BY s.dim) q;
$$;

CREATE OR REPLACE FUNCTION public._workspace_item_ok2(i public.workspace_item_catalog, p_perms text[], p_features text[], p_families text[],
                                                      p_policies text[], p_dims text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT public._workspace_item_ok(i, p_perms, p_features, p_families)
     AND (i.policy IS NULL OR i.policy = ANY (p_policies))
     AND (cardinality(i.scope_dims) = 0 OR i.scope_dims && p_dims);
$$;

CREATE OR REPLACE FUNCTION public.workspace_item_allowed(p_org uuid, p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT public._workspace_item_ok2(i, public.workspace_permission_codes(p_org), public.workspace_features(p_org), NULL,
                            public.workspace_policies(p_org), array(SELECT jsonb_object_keys(public.workspace_scope_options(p_org))))
                     FROM public.workspace_item_catalog i WHERE i.key = p_key), false);
$$;

-- The manifest (v2: same shape as v1 plus scope_options, policies, can_personalise, per-widget scope) --------
CREATE OR REPLACE FUNCTION public.workspace_manifest(p_org uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

-- Personalisation: only allowed items, and only when the school allows personalisation ---------------
CREATE OR REPLACE FUNCTION public.workspace_prefs_save(p_org uuid, p_prefs jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_perms text[]; v_feat text[]; v_pol text[]; v_dims text[]; v_clean jsonb; v_keys text[]; v_personal boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  PERFORM public.workspace_manifest(p_org);  -- membership check
  v_perms := public.workspace_permission_codes(p_org); v_feat := public.workspace_features(p_org);
  v_pol := public.workspace_policies(p_org); v_dims := array(SELECT jsonb_object_keys(public.workspace_scope_options(p_org)));
  v_personal := 'workspace.personalise' = ANY (v_pol) OR 'settings.manage' = ANY (v_perms);
  SELECT array_agg(key) INTO v_keys FROM public.workspace_item_catalog i WHERE public._workspace_item_ok2(i, v_perms, v_feat, NULL, v_pol, v_dims);
  v_keys := CASE WHEN v_personal THEN coalesce(v_keys, '{}') ELSE '{}' END;
  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'order', (SELECT jsonb_agg(e) FROM jsonb_array_elements_text(coalesce(p_prefs->'order', '[]')) e WHERE e = ANY (v_keys) AND e LIKE 'w.%'),
    'hidden', (SELECT jsonb_agg(e) FROM jsonb_array_elements_text(coalesce(p_prefs->'hidden', '[]')) e WHERE e = ANY (v_keys) AND e LIKE 'w.%'),
    'added', (SELECT jsonb_agg(e) FROM jsonb_array_elements_text(coalesce(p_prefs->'added', '[]')) e WHERE e = ANY (v_keys) AND e LIKE 'w.%'),
    'actions', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements_text(coalesce(p_prefs->'actions', '[]')) e WHERE e = ANY (v_keys) AND e LIKE 'a.%' LIMIT 6) q),
    'locale', CASE WHEN p_prefs->>'locale' IN ('en','ha','yo','ig','pcm') THEN p_prefs->'locale' END,
    'density', CASE WHEN p_prefs->>'density' IN ('comfortable','compact') THEN p_prefs->'density' END));
  INSERT INTO public.user_workspace_prefs (user_id, org_id, prefs) VALUES (auth.uid(), p_org, v_clean)
  ON CONFLICT (user_id, org_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now();
  RETURN v_clean;
END $$;

-- Admin: list and set the school's workspace policies and modules --------------------------------
CREATE OR REPLACE FUNCTION public.workspace_policy_list(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'settings.manage required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label_en, 'default', c.default_on,
                   'enabled', coalesce(o.enabled, c.default_on)) ORDER BY c.sort), '[]')
                 FROM public.workspace_policy_catalog c LEFT JOIN public.org_workspace_policies o ON o.org_id = p_org AND o.policy = c.key),
    'modules', (SELECT jsonb_agg(jsonb_build_object('key', m, 'enabled', coalesce(o.enabled, true)) ORDER BY m)
                 FROM unnest(ARRAY['cbt','wallet','payroll','library','hostel','health','transport']) m
                 LEFT JOIN public.org_workspace_features o ON o.org_id = p_org AND o.feature = m));
END $$;

CREATE OR REPLACE FUNCTION public.workspace_policy_set(p_org uuid, p_policy text, p_enabled boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'settings.manage required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_policy_catalog WHERE key = p_policy) THEN
    RAISE EXCEPTION 'unknown policy %', p_policy USING ERRCODE = '22023'; END IF;
  INSERT INTO public.org_workspace_policies (org_id, policy, enabled, updated_by) VALUES (p_org, p_policy, p_enabled, auth.uid())
  ON CONFLICT (org_id, policy) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.workspace_policies(uuid), public.workspace_scope_options(uuid),
  public._workspace_item_ok2(public.workspace_item_catalog, text[], text[], text[], text[], text[]),
  public.workspace_policy_list(uuid), public.workspace_policy_set(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_policies(uuid), public.workspace_policy_list(uuid), public.workspace_policy_set(uuid, text, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_scope_options(uuid), public._workspace_item_ok2(public.workspace_item_catalog, text[], text[], text[], text[], text[])
  TO service_role;
COMMIT;
