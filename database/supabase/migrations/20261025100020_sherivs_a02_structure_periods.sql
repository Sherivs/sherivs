-- SHERIVS-A02 (Track A, day 2): shifts, gender/residency sections, levels and academic periods, manageable end to end.
--  * shift_upsert / shift_delete, level_upsert / level_delete, section_set_profile, class_set_structure
--  * academic_periods (terms, semesters or trimesters per session) with one current period per school
--  * every change is audited in audit_logs (append-only); deletes are refused while classes or scope sets still use the item
-- Additive only; writes go through SECURITY DEFINER RPCs gated on settings.manage.
BEGIN;

CREATE TABLE IF NOT EXISTS public.academic_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  session text NOT NULL CHECK (session ~ '^[0-9]{4}/[0-9]{4}$'),
  kind text NOT NULL CHECK (kind IN ('term','semester','trimester')),
  ordinal int NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  name text NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on),
  CHECK (kind <> 'semester' OR ordinal <= 2),
  UNIQUE (school_id, session, ordinal));
CREATE UNIQUE INDEX IF NOT EXISTS academic_periods_one_current ON public.academic_periods (school_id) WHERE is_current;
ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_periods FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.academic_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.academic_periods TO authenticated;
DROP POLICY IF EXISTS academic_periods_read ON public.academic_periods;
CREATE POLICY academic_periods_read ON public.academic_periods FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));

CREATE OR REPLACE FUNCTION public._structure_audit(p_org uuid, p_action text, p_table text, p_id uuid, p_new jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value) VALUES (p_org, auth.uid(), p_action, p_table, p_id, p_new);
$$;

-- ===== Shifts =====
CREATE OR REPLACE FUNCTION public.shift_upsert(p_org uuid, p_campus uuid, p_name text, p_kind text, p_starts time DEFAULT NULL, p_ends time DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(p_name)), 0) < 2 THEN RAISE EXCEPTION 'shift name is required'; END IF;
  IF p_campus IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campuses WHERE id = p_campus AND school_id = p_org) THEN RAISE EXCEPTION 'campus is not in this organisation'; END IF;
  IF p_starts IS NOT NULL AND p_ends IS NOT NULL AND p_ends <= p_starts THEN RAISE EXCEPTION 'shift must end after it starts'; END IF;
  SELECT id INTO v FROM public.school_shifts WHERE school_id = p_org AND campus_id IS NOT DISTINCT FROM p_campus AND lower(name) = lower(btrim(p_name));
  IF v IS NULL THEN
    INSERT INTO public.school_shifts (school_id, campus_id, name, kind, starts_at, ends_at) VALUES (p_org, p_campus, btrim(p_name), p_kind, p_starts, p_ends) RETURNING id INTO v;
  ELSE
    UPDATE public.school_shifts SET kind = p_kind, starts_at = p_starts, ends_at = p_ends WHERE id = v;
  END IF;
  PERFORM public._structure_audit(p_org, 'shift_upsert', 'school_shifts', v, jsonb_build_object('name', p_name, 'kind', p_kind, 'campus', p_campus));
  RETURN v;
END $$;

-- Refuse while used: deleting would silently orphan classes or scope sets (and could change who sees what).
CREATE OR REPLACE FUNCTION public._structure_in_use(p_dim text, p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_dim = 'shift' AND EXISTS (SELECT 1 FROM public.classes WHERE shift_id = p_id) THEN 'classes still use this shift'
    WHEN p_dim = 'level' AND EXISTS (SELECT 1 FROM public.classes WHERE level_id = p_id) THEN 'classes still use this level'
    WHEN EXISTS (SELECT 1 FROM public.role_assignment_scopes WHERE dim = p_dim AND ref = p_id::text) THEN 'a role operating area still uses this ' || p_dim
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.shift_delete(p_shift uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid; why text;
BEGIN
  SELECT school_id INTO o FROM public.school_shifts WHERE id = p_shift;
  IF o IS NULL OR NOT public.scholar_can(o, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  why := public._structure_in_use('shift', p_shift);
  IF why IS NOT NULL THEN RAISE EXCEPTION 'in_use: %', why; END IF;
  DELETE FROM public.school_shifts WHERE id = p_shift;
  PERFORM public._structure_audit(o, 'shift_delete', 'school_shifts', p_shift, NULL);
END $$;

-- ===== Levels =====
CREATE OR REPLACE FUNCTION public.level_upsert(p_org uuid, p_name text, p_band text, p_ordinal int) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(p_name)), 0) < 2 THEN RAISE EXCEPTION 'level name is required'; END IF;
  IF p_ordinal IS NULL OR p_ordinal NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'order must be between 0 and 99'; END IF;
  INSERT INTO public.school_levels (school_id, name, band, ordinal) VALUES (p_org, btrim(p_name), p_band, p_ordinal)
  ON CONFLICT (school_id, name) DO UPDATE SET band = EXCLUDED.band, ordinal = EXCLUDED.ordinal RETURNING id INTO v;
  PERFORM public._structure_audit(p_org, 'level_upsert', 'school_levels', v, jsonb_build_object('name', p_name, 'band', p_band, 'ordinal', p_ordinal));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.level_delete(p_level uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid; why text;
BEGIN
  SELECT school_id INTO o FROM public.school_levels WHERE id = p_level;
  IF o IS NULL OR NOT public.scholar_can(o, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  why := public._structure_in_use('level', p_level);
  IF why IS NOT NULL THEN RAISE EXCEPTION 'in_use: %', why; END IF;
  DELETE FROM public.school_levels WHERE id = p_level;
  PERFORM public._structure_audit(o, 'level_delete', 'school_levels', p_level, NULL);
END $$;

-- ===== Sections (gender / residency) and class placement =====
CREATE OR REPLACE FUNCTION public.section_set_profile(p_section uuid, p_gender text, p_residency text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  SELECT school_id INTO o FROM public.school_sections WHERE id = p_section;
  IF o IS NULL OR NOT public.scholar_can(o, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.school_sections SET gender = p_gender, residency = p_residency WHERE id = p_section;
  PERFORM public._structure_audit(o, 'section_profile', 'school_sections', p_section, jsonb_build_object('gender', p_gender, 'residency', p_residency));
END $$;

CREATE OR REPLACE FUNCTION public.class_set_structure(p_class uuid, p_shift uuid, p_level uuid, p_section uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  SELECT school_id INTO o FROM public.classes WHERE id = p_class;
  IF o IS NULL OR NOT public.scholar_can(o, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_shift IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.school_shifts WHERE id = p_shift AND school_id = o) THEN RAISE EXCEPTION 'shift is not in this organisation'; END IF;
  IF p_level IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.school_levels WHERE id = p_level AND school_id = o) THEN RAISE EXCEPTION 'level is not in this organisation'; END IF;
  IF p_section IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.school_sections WHERE id = p_section AND school_id = o) THEN RAISE EXCEPTION 'section is not in this organisation'; END IF;
  UPDATE public.classes SET shift_id = p_shift, level_id = p_level, section_id = coalesce(p_section, section_id) WHERE id = p_class;
  PERFORM public._structure_audit(o, 'class_structure', 'classes', p_class, jsonb_build_object('shift', p_shift, 'level', p_level, 'section', p_section));
END $$;

-- ===== Academic periods =====
CREATE OR REPLACE FUNCTION public.academic_period_upsert(p_org uuid, p_session text, p_kind text, p_ordinal int, p_name text, p_starts date, p_ends date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; k text;
BEGIN
  IF NOT public.scholar_can(p_org, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_session !~ '^[0-9]{4}/[0-9]{4}$' OR split_part(p_session, '/', 2)::int <> split_part(p_session, '/', 1)::int + 1 THEN RAISE EXCEPTION 'session must look like 2026/2027'; END IF;
  SELECT kind INTO k FROM public.academic_periods WHERE school_id = p_org AND session = p_session AND ordinal <> p_ordinal LIMIT 1;
  IF k IS NOT NULL AND k <> p_kind THEN RAISE EXCEPTION 'this session already uses %s', k; END IF;
  IF EXISTS (SELECT 1 FROM public.academic_periods WHERE school_id = p_org AND NOT (session = p_session AND ordinal = p_ordinal)
               AND daterange(starts_on, ends_on, '[]') && daterange(p_starts, p_ends, '[]')) THEN RAISE EXCEPTION 'dates overlap another period'; END IF;
  IF EXISTS (SELECT 1 FROM public.academic_periods WHERE school_id = p_org AND session = p_session AND ordinal = p_ordinal AND closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'period is closed'; END IF;
  INSERT INTO public.academic_periods (school_id, session, kind, ordinal, name, starts_on, ends_on) VALUES (p_org, p_session, p_kind, p_ordinal, btrim(p_name), p_starts, p_ends)
  ON CONFLICT (school_id, session, ordinal) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on RETURNING id INTO v;
  PERFORM public._structure_audit(p_org, 'period_upsert', 'academic_periods', v, jsonb_build_object('session', p_session, 'kind', p_kind, 'ordinal', p_ordinal, 'from', p_starts, 'to', p_ends));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.academic_period_set_current(p_period uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.academic_periods;
BEGIN
  SELECT * INTO p FROM public.academic_periods WHERE id = p_period;
  IF p.id IS NULL OR NOT public.scholar_can(p.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p.closed_at IS NOT NULL THEN RAISE EXCEPTION 'period is closed'; END IF;
  UPDATE public.academic_periods SET is_current = false WHERE school_id = p.school_id AND is_current AND id <> p.id;
  UPDATE public.academic_periods SET is_current = true WHERE id = p.id;
  PERFORM public._structure_audit(p.school_id, 'period_current', 'academic_periods', p.id, jsonb_build_object('session', p.session, 'ordinal', p.ordinal));
END $$;

CREATE OR REPLACE FUNCTION public.academic_period_close(p_period uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.academic_periods;
BEGIN
  SELECT * INTO p FROM public.academic_periods WHERE id = p_period;
  IF p.id IS NULL OR NOT public.scholar_can(p.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p.closed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.academic_periods SET closed_at = now(), is_current = false WHERE id = p.id;
  PERFORM public._structure_audit(p.school_id, 'period_close', 'academic_periods', p.id, jsonb_build_object('session', p.session, 'ordinal', p.ordinal));
END $$;

CREATE OR REPLACE FUNCTION public.current_academic_period(p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_org = public.get_my_school_id() OR coalesce(public.is_super_admin(), false) THEN
    (SELECT to_jsonb(x) FROM (SELECT id, session, kind, ordinal, name, starts_on, ends_on FROM public.academic_periods WHERE school_id = p_org AND is_current) x)
  END;
$$;

REVOKE ALL ON FUNCTION public._structure_audit(uuid, text, text, uuid, jsonb), public._structure_in_use(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_upsert(uuid, uuid, text, text, time, time), public.shift_delete(uuid), public.level_upsert(uuid, text, text, int), public.level_delete(uuid),
  public.section_set_profile(uuid, text, text), public.class_set_structure(uuid, uuid, uuid, uuid),
  public.academic_period_upsert(uuid, text, text, int, text, date, date), public.academic_period_set_current(uuid), public.academic_period_close(uuid),
  public.current_academic_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_upsert(uuid, uuid, text, text, time, time), public.shift_delete(uuid), public.level_upsert(uuid, text, text, int), public.level_delete(uuid),
  public.section_set_profile(uuid, text, text), public.class_set_structure(uuid, uuid, uuid, uuid),
  public.academic_period_upsert(uuid, text, text, int, text, date, date), public.academic_period_set_current(uuid), public.academic_period_close(uuid),
  public.current_academic_period(uuid) TO authenticated;

COMMIT;
