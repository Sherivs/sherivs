-- Rollback of CS-01: restore the four functions as they were and drop the resource-level check.
BEGIN;
CREATE OR REPLACE FUNCTION public.course_reg_decide(p_registration uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.course_registrations;
BEGIN
  SELECT * INTO r FROM public.course_registrations WHERE id = p_registration FOR UPDATE;
  IF r.id IS NULL OR NOT public.scholar_can(r.school_id, 'course_reg.approve') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = r.student_id AND user_id = auth.uid()) THEN RAISE EXCEPTION 'sod: you cannot approve your own registration' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'registration is %', r.status; END IF;
  UPDATE public.course_registrations SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(), note = p_note WHERE id = r.id;
END $function$;

CREATE OR REPLACE FUNCTION public.malpractice_decide(p_case uuid, p_outcome text, p_sanction text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.malpractice_cases;
BEGIN
  SELECT * INTO c FROM public.malpractice_cases WHERE id = p_case FOR UPDATE;
  IF c.id IS NULL OR NOT public.scholar_can(c.school_id, 'malpractice.decide') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF c.reported_by = auth.uid() THEN RAISE EXCEPTION 'sod: the reporting invigilator cannot decide the case' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'case already decided'; END IF;
  IF p_outcome NOT IN ('dismissed','upheld') THEN RAISE EXCEPTION 'outcome must be dismissed or upheld'; END IF;
  UPDATE public.malpractice_cases SET status = p_outcome, sanction = p_sanction, decided_by = auth.uid(), decided_at = now() WHERE id = p_case;
END $function$;

CREATE OR REPLACE FUNCTION public.role_scope_set_add(p_assignment uuid, p_dims jsonb, p_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.role_scope_set_remove(p_set uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

DROP FUNCTION IF EXISTS public.scholar_can_on(uuid, text, text, uuid);
COMMIT;
