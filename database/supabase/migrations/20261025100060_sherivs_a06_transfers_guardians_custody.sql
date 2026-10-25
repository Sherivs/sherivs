-- SHERIVS-A06: student moves and transfers, guardian rights, custody orders and safe pickup.
--   * moving a student between classes keeps a history; transfers out issue a one-time code another school claims
--     (only with recorded parent consent, and only a summary is shared); guardians get custody/pickup flags;
--     court orders block named people from collecting a child; every pickup check is logged (append-only).
BEGIN;
ALTER TABLE public.parent_student_map ADD COLUMN IF NOT EXISTS has_custody boolean NOT NULL DEFAULT true;
ALTER TABLE public.parent_student_map ADD COLUMN IF NOT EXISTS can_pickup boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.student_class_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  from_class uuid, to_class uuid, reason text NOT NULL, moved_by uuid, moved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.student_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  to_school_name text NOT NULL, reason text NOT NULL, parent_consent boolean NOT NULL,
  code text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','claimed','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  prev_status text, prev_class uuid,
  claimed_by_school uuid REFERENCES public.schools(id), claimed_by uuid, claimed_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS student_transfers_one_open ON public.student_transfers (student_id) WHERE status = 'issued';
CREATE TABLE IF NOT EXISTS public.custody_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  restricted_name text NOT NULL, restricted_phone text, restricted_user uuid REFERENCES public.users(id),
  kind text NOT NULL DEFAULT 'no_pickup' CHECK (kind IN ('no_pickup','no_contact')),
  reference text NOT NULL, valid_from date NOT NULL DEFAULT current_date, valid_until date,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, revoked_by uuid);
CREATE TABLE IF NOT EXISTS public.pickup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  collector_name text, collector_phone text, collector_user uuid,
  allowed boolean NOT NULL, reason text NOT NULL, checked_by uuid, checked_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['student_class_history','student_transfers','custody_orders','pickup_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t); EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
DROP TRIGGER IF EXISTS trg_pickup_events_append_only ON public.pickup_events;
CREATE TRIGGER trg_pickup_events_append_only BEFORE UPDATE OR DELETE ON public.pickup_events FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

DROP POLICY IF EXISTS student_class_history_read ON public.student_class_history;
CREATE POLICY student_class_history_read ON public.student_class_history FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'students.view') OR coalesce(public.is_super_admin(), false));
DROP POLICY IF EXISTS student_transfers_read ON public.student_transfers;
CREATE POLICY student_transfers_read ON public.student_transfers FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'students.transfer') OR coalesce(public.is_super_admin(), false));
-- Custody orders are sensitive: only people who handle transfers/safeguarding read them; never parents.
DROP POLICY IF EXISTS custody_orders_read ON public.custody_orders;
CREATE POLICY custody_orders_read ON public.custody_orders FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'students.transfer') OR coalesce(public.is_super_admin(), false));
DROP POLICY IF EXISTS pickup_events_read ON public.pickup_events;
CREATE POLICY pickup_events_read ON public.pickup_events FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'students.view') OR coalesce(public.is_super_admin(), false));

CREATE OR REPLACE FUNCTION public._a06_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$ SELECT nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '') $$;

CREATE OR REPLACE FUNCTION public._a06_student(p_student uuid, p_perm text) RETURNS public.students
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF s.id IS NULL OR s.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(s.school_id, p_perm) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.student_move_class(p_student uuid, p_class uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; v uuid;
BEGIN
  s := public._a06_student(p_student, 'students.transfer');
  IF NOT s.is_active THEN RAISE EXCEPTION 'student is not active'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class AND school_id = s.school_id) THEN RAISE EXCEPTION 'class is not in this school'; END IF;
  IF s.class_id = p_class THEN RAISE EXCEPTION 'student is already in that class'; END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'give a reason (at least 5 characters)'; END IF;
  UPDATE public.students SET class_id = p_class WHERE id = s.id;
  INSERT INTO public.student_class_history (school_id, student_id, from_class, to_class, reason, moved_by)
  VALUES (s.school_id, s.id, s.class_id, p_class, btrim(p_reason), auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_out_issue(p_student uuid, p_to_school text, p_reason text, p_parent_consent boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; c text; t public.student_transfers;
BEGIN
  s := public._a06_student(p_student, 'students.transfer');
  IF NOT coalesce(p_parent_consent, false) THEN RAISE EXCEPTION 'parent consent must be recorded before a transfer'; END IF;
  IF coalesce(length(btrim(p_to_school)), 0) < 3 OR coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'destination school and reason are required'; END IF;
  IF EXISTS (SELECT 1 FROM public.student_transfers WHERE student_id = s.id AND status = 'issued') THEN RAISE EXCEPTION 'a transfer is already open for this student'; END IF;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.student_transfers (school_id, student_id, to_school_name, reason, parent_consent, code, prev_status, prev_class, created_by)
  VALUES (s.school_id, s.id, btrim(p_to_school), btrim(p_reason), true, c, s.status, s.class_id, auth.uid()) RETURNING * INTO t;
  UPDATE public.students SET status = 'transferred', is_active = false, status_changed_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('id', t.id, 'code', t.code, 'expires_at', t.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.transfer_cancel(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.student_transfers;
BEGIN
  SELECT * INTO t FROM public.student_transfers WHERE id = p_id FOR UPDATE;
  IF t.id IS NULL OR t.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(t.school_id, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'issued' THEN RAISE EXCEPTION 'transfer is already %', t.status; END IF;
  UPDATE public.student_transfers SET status = 'cancelled' WHERE id = t.id;
  UPDATE public.students SET status = coalesce(t.prev_status, 'active'), is_active = true, class_id = t.prev_class, status_changed_at = now() WHERE id = t.student_id;
END $$;

-- The receiving school claims with the code and gets a summary only (no medical, address or guardian details).
CREATE OR REPLACE FUNCTION public.transfer_in_claim(p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.student_transfers; s public.students; me uuid := public.get_my_school_id(); u public.users; r jsonb;
BEGIN
  IF me IS NULL OR NOT public.scholar_can(me, 'students.transfer') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.student_transfers WHERE code = upper(btrim(p_code)) FOR UPDATE;
  IF t.id IS NULL OR t.status <> 'issued' OR t.expires_at < now() THEN RAISE EXCEPTION 'transfer code is not valid'; END IF;
  IF t.school_id = me THEN RAISE EXCEPTION 'a school cannot claim its own transfer'; END IF;
  SELECT * INTO s FROM public.students WHERE id = t.student_id;
  SELECT * INTO u FROM public.users WHERE id = s.user_id;
  SELECT jsonb_build_object('subjects_graded', count(DISTINCT g.subject), 'results', count(*)) INTO r
    FROM public.grades g WHERE g.student_id = s.id AND g.school_id = t.school_id AND g.is_published;
  UPDATE public.student_transfers SET status = 'claimed', claimed_by_school = me, claimed_by = auth.uid(), claimed_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('name', u.full_name,
    'date_of_birth', s.date_of_birth, 'gender', s.gender, 'admission_number', s.admission_number,
    'from_school', (SELECT name FROM public.schools WHERE id = t.school_id),
    'last_class', (SELECT name FROM public.classes WHERE id = t.prev_class), 'current_level', s.current_level, 'academic', r);
END $$;

CREATE OR REPLACE FUNCTION public.guardian_rights_set(p_student uuid, p_parent uuid, p_has_custody boolean, p_can_pickup boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students;
BEGIN
  s := public._a06_student(p_student, 'students.transfer');
  UPDATE public.parent_student_map SET has_custody = p_has_custody, can_pickup = p_can_pickup WHERE student_id = s.id AND parent_id = p_parent;
  IF NOT FOUND THEN RAISE EXCEPTION 'that guardian is not linked to this student'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.custody_order_add(p_student uuid, p_name text, p_phone text, p_user uuid, p_kind text, p_reference text, p_until date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; v uuid;
BEGIN
  s := public._a06_student(p_student, 'students.transfer');
  IF coalesce(length(btrim(p_name)), 0) < 2 OR coalesce(length(btrim(p_reference)), 0) < 3 THEN RAISE EXCEPTION 'name and order reference are required'; END IF;
  INSERT INTO public.custody_orders (school_id, student_id, restricted_name, restricted_phone, restricted_user, kind, reference, valid_until, created_by)
  VALUES (s.school_id, s.id, btrim(p_name), public._a06_phone(p_phone), p_user, coalesce(p_kind, 'no_pickup'), btrim(p_reference), p_until, auth.uid()) RETURNING id INTO v;
  -- a restricted guardian loses pickup immediately
  IF p_user IS NOT NULL THEN UPDATE public.parent_student_map SET can_pickup = false WHERE student_id = s.id AND parent_id = p_user; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.custody_order_revoke(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.custody_orders;
BEGIN
  SELECT * INTO o FROM public.custody_orders WHERE id = p_id;
  IF o.id IS NULL OR o.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(o.school_id, 'students.transfer') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.custody_orders SET revoked_at = now(), revoked_by = auth.uid() WHERE id = o.id AND revoked_at IS NULL;
END $$;

-- Gate staff check who is collecting a child. Court orders always win; then guardians with pickup rights.
-- The decision is logged; the reason never reveals the order's details.
CREATE OR REPLACE FUNCTION public.pickup_verify(p_student uuid, p_name text, p_phone text DEFAULT NULL, p_user uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students; ph text := public._a06_phone(p_phone); ok boolean := false; why text := 'not_on_pickup_list'; uid uuid := p_user;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student;
  IF s.id IS NULL OR s.school_id IS DISTINCT FROM public.get_my_school_id()
     OR NOT (public.scholar_can(s.school_id, 'attendance.take') OR public.scholar_can(s.school_id, 'students.view')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF uid IS NULL AND ph IS NOT NULL THEN
    SELECT u.id INTO uid FROM public.parent_student_map m JOIN public.users u ON u.id = m.parent_id
     WHERE m.student_id = s.id AND public._a06_phone(u.phone) = ph LIMIT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM public.custody_orders o WHERE o.student_id = s.id AND o.revoked_at IS NULL
              AND o.valid_from <= current_date AND (o.valid_until IS NULL OR o.valid_until >= current_date)
              AND ((uid IS NOT NULL AND o.restricted_user = uid) OR (ph IS NOT NULL AND o.restricted_phone = ph)
                   OR lower(btrim(o.restricted_name)) = lower(btrim(coalesce(p_name, ''))))) THEN
    why := 'restricted_by_order';
  ELSIF uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.parent_student_map m WHERE m.student_id = s.id AND m.parent_id = uid AND m.can_pickup) THEN
    ok := true; why := 'guardian';
  ELSIF uid IS NOT NULL AND uid = s.parent_id AND NOT EXISTS (SELECT 1 FROM public.parent_student_map m WHERE m.student_id = s.id AND m.parent_id = uid) THEN
    ok := true; why := 'guardian';
  ELSIF uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.parent_student_map m WHERE m.student_id = s.id AND m.parent_id = uid) THEN
    why := 'guardian_without_pickup_rights';
  END IF;
  INSERT INTO public.pickup_events (school_id, student_id, collector_name, collector_phone, collector_user, allowed, reason, checked_by)
  VALUES (s.school_id, s.id, nullif(btrim(coalesce(p_name, '')), ''), ph, uid, ok, why, auth.uid());
  RETURN jsonb_build_object('allowed', ok, 'reason', why);
END $$;

REVOKE ALL ON FUNCTION public._a06_phone(text), public._a06_student(uuid, text), public.student_move_class(uuid, uuid, text),
  public.transfer_out_issue(uuid, text, text, boolean), public.transfer_cancel(uuid), public.transfer_in_claim(text),
  public.guardian_rights_set(uuid, uuid, boolean, boolean), public.custody_order_add(uuid, text, text, uuid, text, text, date),
  public.custody_order_revoke(uuid), public.pickup_verify(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_move_class(uuid, uuid, text),
  public.transfer_out_issue(uuid, text, text, boolean), public.transfer_cancel(uuid), public.transfer_in_claim(text),
  public.guardian_rights_set(uuid, uuid, boolean, boolean), public.custody_order_add(uuid, text, text, uuid, text, text, date),
  public.custody_order_revoke(uuid), public.pickup_verify(uuid, text, text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._a06_student(uuid, text) FROM authenticated;

COMMIT;
