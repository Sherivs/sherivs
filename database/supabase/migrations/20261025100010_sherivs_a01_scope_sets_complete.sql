-- SHERIVS-A01 (Track A, day 1): complete multi-place role scope sets.
--  * every scope-set change is written to an append-only audit (role_scope_audit)
--  * removing a set can no longer WIDEN an assignment past the remover's own area (last-set removal -> org-wide was a hole)
--  * the subject dimension now matches real data (timetable subjects of the class)
--  * caller helpers: my_operating_area(org), scope_class_ids(org) for list filtering; admin listing role_scope_sets_list(org)
-- Additive: no column drops, signatures unchanged; live checks stay authoritative.
BEGIN;

CREATE TABLE IF NOT EXISTS public.role_scope_audit (
  id bigserial PRIMARY KEY, org_id uuid NOT NULL, actor uuid, action text NOT NULL CHECK (action IN ('set_add','set_remove')),
  assignment_id uuid, set_id uuid, dims jsonb, label text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS role_scope_audit_org_at ON public.role_scope_audit (org_id, at DESC);
ALTER TABLE public.role_scope_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_scope_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.role_scope_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.role_scope_audit TO authenticated;
REVOKE ALL ON SEQUENCE public.role_scope_audit_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS role_scope_audit_read ON public.role_scope_audit;
CREATE POLICY role_scope_audit_read ON public.role_scope_audit FOR SELECT TO authenticated
  USING (public.can_manage_roles(org_id, 'roles.assign') OR public.can_administer_org(org_id));
DROP TRIGGER IF EXISTS trg_role_scope_audit_append_only ON public.role_scope_audit;
CREATE TRIGGER trg_role_scope_audit_append_only BEFORE UPDATE OR DELETE ON public.role_scope_audit FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

CREATE OR REPLACE FUNCTION public.role_scope_set_add(p_assignment uuid, p_dims jsonb, p_label text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.user_role_assignments; v_set uuid; d text; r text; lim jsonb; n int := 0;
BEGIN
  SELECT * INTO a FROM public.user_role_assignments WHERE id = p_assignment AND status = 'active';
  IF a.id IS NULL OR NOT public.can_manage_roles(a.org_id, 'roles.assign') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.user_id = auth.uid() THEN RAISE EXCEPTION 'no_self_role_grant: you cannot widen your own operating area' USING ERRCODE = '42501'; END IF;
  IF p_dims IS NULL OR jsonb_typeof(p_dims) <> 'object' OR p_dims = '{}'::jsonb THEN RAISE EXCEPTION 'scope set needs at least one dimension'; END IF;
  lim := CASE WHEN coalesce(public.is_super_admin(), false) OR public.can_administer_org(a.org_id) THEN '{}'::jsonb ELSE public._assigner_limits(a.org_id, auth.uid()) END;
  FOR d IN SELECT jsonb_object_keys(p_dims) LOOP
    IF jsonb_typeof(p_dims->d) <> 'array' OR jsonb_array_length(p_dims->d) = 0 THEN RAISE EXCEPTION 'dimension % needs a non-empty list', d; END IF;
    FOR r IN SELECT jsonb_array_elements_text(p_dims->d) LOOP
      IF NOT public._scope_ref_ok(a.org_id, d, r) THEN RAISE EXCEPTION 'scope % % is not in this organisation', d, r; END IF;
      IF lim ? d AND NOT (lim->d) ? r THEN RAISE EXCEPTION 'scope_wider_than_assigner: % % is outside your own operating area', d, r USING ERRCODE = '42501'; END IF;
    END LOOP;
  END LOOP;
  -- an assigner restricted on a dimension cannot leave it open for the assignee
  FOR d IN SELECT jsonb_object_keys(lim) LOOP
    IF NOT p_dims ? d THEN RAISE EXCEPTION 'scope_wider_than_assigner: you must restrict % like your own scope', d USING ERRCODE = '42501'; END IF;
  END LOOP;
  INSERT INTO public.role_assignment_scope_sets (assignment_id, org_id, label, created_by) VALUES (a.id, a.org_id, p_label, auth.uid()) RETURNING id INTO v_set;
  INSERT INTO public.role_assignment_scopes (set_id, org_id, dim, ref)
  SELECT v_set, a.org_id, k, e FROM jsonb_object_keys(p_dims) k, jsonb_array_elements_text(p_dims->k) e;
  INSERT INTO public.role_scope_audit (org_id, actor, action, assignment_id, set_id, dims, label)
  VALUES (a.org_id, auth.uid(), 'set_add', a.id, v_set, p_dims, p_label);
  RETURN v_set;
END $$;

CREATE OR REPLACE FUNCTION public.role_scope_set_remove(p_set uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ss public.role_assignment_scope_sets; a public.user_role_assignments; lim jsonb; v_dims jsonb;
BEGIN
  SELECT * INTO ss FROM public.role_assignment_scope_sets WHERE id = p_set;
  IF ss.id IS NULL OR NOT public.can_manage_roles(ss.org_id, 'roles.assign') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.user_role_assignments WHERE id = ss.assignment_id;
  IF a.user_id = auth.uid() THEN RAISE EXCEPTION 'no_self_role_grant: you cannot change your own operating area' USING ERRCODE = '42501'; END IF;
  lim := CASE WHEN coalesce(public.is_super_admin(), false) OR public.can_administer_org(ss.org_id) THEN '{}'::jsonb ELSE public._assigner_limits(ss.org_id, auth.uid()) END;
  SELECT coalesce(jsonb_object_agg(dim, refs), '{}'::jsonb) INTO v_dims
    FROM (SELECT dim, jsonb_agg(ref ORDER BY ref) refs FROM public.role_assignment_scopes WHERE set_id = p_set GROUP BY dim) d;
  IF lim <> '{}'::jsonb THEN
    -- a restricted assigner may only remove sets that lie inside their own area, and never the last one (that would make it org-wide)
    IF EXISTS (SELECT 1 FROM public.role_assignment_scopes x WHERE x.set_id = p_set AND lim ? x.dim AND NOT (lim->x.dim) ? x.ref)
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(lim) k WHERE NOT v_dims ? k) THEN
      RAISE EXCEPTION 'scope_wider_than_assigner: this set is outside your own operating area' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.role_assignment_scope_sets WHERE assignment_id = ss.assignment_id AND id <> p_set) THEN
      RAISE EXCEPTION 'scope_wider_than_assigner: removing the last set would make this role org-wide; ask an administrator' USING ERRCODE = '42501'; END IF;
  END IF;
  DELETE FROM public.role_assignment_scope_sets WHERE id = p_set;
  INSERT INTO public.role_scope_audit (org_id, actor, action, assignment_id, set_id, dims, label)
  VALUES (ss.org_id, auth.uid(), 'set_remove', ss.assignment_id, p_set, v_dims, ss.label);
END $$;

CREATE OR REPLACE FUNCTION public.resource_dims(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.classes; s public.students; out jsonb := '{}'::jsonb; sec public.school_sections; v_class uuid;
BEGIN
  IF p_kind = 'student' THEN SELECT * INTO s FROM public.students WHERE id = p_id; v_class := s.class_id;
    out := jsonb_build_object('org', s.school_id, 'student', s.id,
      'house', coalesce((SELECT jsonb_agg(group_id::text) FROM public.student_group_members WHERE student_id = s.id), '[]'::jsonb),
      'hostel', coalesce((SELECT jsonb_agg(DISTINCT x) FROM public.hostel_allocations ha JOIN public.hostel_rooms hr ON hr.id = ha.room_id,
                           LATERAL (VALUES (hr.id::text), (hr.block)) v(x) WHERE ha.student_id = s.id AND ha.is_active AND x IS NOT NULL), '[]'::jsonb));
  ELSIF p_kind = 'class' THEN v_class := p_id;
  ELSE RETURN jsonb_build_object('kind', p_kind); END IF;
  SELECT * INTO c FROM public.classes WHERE id = v_class;
  IF c.id IS NOT NULL THEN
    SELECT * INTO sec FROM public.school_sections WHERE id = c.section_id;
    out := out || jsonb_build_object('org', c.school_id, 'class', jsonb_build_array(c.id::text),
      'campus', CASE WHEN c.campus_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.campus_id::text) END,
      'shift', CASE WHEN c.shift_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.shift_id::text) END,
      'section', CASE WHEN c.section_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.section_id::text) END,
      'gender', CASE WHEN sec.gender IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(sec.gender) END,
      'level', CASE WHEN c.level_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.level_id::text) END,
      'subject', coalesce((SELECT jsonb_agg(DISTINCT ts.subject) FROM public.timetable_slots ts JOIN public.timetables tt ON tt.id = ts.timetable_id
                            WHERE tt.class_id = c.id AND ts.subject IS NOT NULL AND NOT coalesce(ts.is_break, false)), '[]'::jsonb));
  END IF;
  RETURN out;
END $$;

-- The caller's own operating area in an organisation. unrestricted=true means org-wide (no scope sets).
CREATE OR REPLACE FUNCTION public.my_operating_area(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE lim jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(public.is_super_admin(), false) OR public.can_administer_org(p_org) THEN RETURN jsonb_build_object('unrestricted', true, 'sets', '[]'::jsonb); END IF;
  lim := public._assigner_limits(p_org, auth.uid());
  RETURN jsonb_build_object('unrestricted', lim = '{}'::jsonb AND EXISTS (SELECT 1 FROM public.user_role_assignments WHERE org_id = p_org AND user_id = auth.uid() AND status = 'active'),
    'sets', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ss.id, 'label', ss.label, 'role', a.role_code,
              'dims', (SELECT jsonb_object_agg(dim, refs) FROM (SELECT dim, jsonb_agg(ref ORDER BY ref) refs FROM public.role_assignment_scopes WHERE set_id = ss.id GROUP BY dim) d)))
        FROM public.role_assignment_scope_sets ss JOIN public.user_role_assignments a ON a.id = ss.assignment_id
       WHERE a.org_id = p_org AND a.user_id = auth.uid() AND a.status = 'active' AND (a.valid_until IS NULL OR a.valid_until > now())), '[]'::jsonb));
END $$;

-- Classes inside the caller's area (NULL = all classes). A class is inside if ANY set matches it on every class-level
-- dimension the set names (campus, shift, section, gender, level, class, subject). House/hostel are student-level and do not narrow classes.
CREATE OR REPLACE FUNCTION public.scope_class_ids(p_org uuid) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE area jsonb;
BEGIN
  area := public.my_operating_area(p_org);
  IF (area->>'unrestricted')::boolean THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT array_agg(c.id ORDER BY c.name) FROM public.classes c WHERE c.school_id = p_org AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(area->'sets') s
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_each(s->'dims') d
                        WHERE d.key IN ('campus','shift','section','gender','level','class','subject')
                          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(d.value) r
                                          WHERE (public.resource_dims('class', c.id)->d.key) ? r)))), '{}'::uuid[]);
END $$;

-- Admin listing: every scope set in the organisation, with the assignee and the dims.
CREATE OR REPLACE FUNCTION public.role_scope_sets_list(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (public.can_manage_roles(p_org, 'roles.assign') OR public.can_administer_org(p_org)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('set_id', ss.id, 'label', ss.label, 'assignment_id', a.id, 'role', a.role_code,
           'user_id', a.user_id, 'user_name', u.full_name, 'created_at', ss.created_at,
           'dims', (SELECT jsonb_object_agg(dim, refs) FROM (SELECT dim, jsonb_agg(ref ORDER BY ref) refs FROM public.role_assignment_scopes WHERE set_id = ss.id GROUP BY dim) d))
           ORDER BY u.full_name, ss.created_at)
      FROM public.role_assignment_scope_sets ss JOIN public.user_role_assignments a ON a.id = ss.assignment_id
      LEFT JOIN public.users u ON u.id = a.user_id
     WHERE ss.org_id = p_org AND a.status = 'active'), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.my_operating_area(uuid), public.scope_class_ids(uuid), public.role_scope_sets_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operating_area(uuid), public.scope_class_ids(uuid), public.role_scope_sets_list(uuid) TO authenticated;

COMMIT;
