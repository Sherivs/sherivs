-- SHERIVS-A07: offline attendance v2 — per-item idempotency, device clock-skew checks, and an admin conflict queue.
--   * each queued mark carries a client item id; replays in any later batch are skipped, never double-applied
--   * the device sends its clock; batches from a device more than 24h off are refused, captured times are skew-corrected
--   * conflicts (someone else already marked differently) go to a queue an admin resolves: keep server, accept device, or dismiss
BEGIN;
CREATE TABLE IF NOT EXISTS public.attendance_sync_items (
  user_id uuid NOT NULL, client_item_id text NOT NULL, school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  batch text NOT NULL, outcome text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_item_id));
CREATE TABLE IF NOT EXISTS public.attendance_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, batch text NOT NULL, client_item_id text NOT NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE, date date NOT NULL,
  yours text NOT NULL, server text, server_marked_by uuid, captured_at timestamptz, skew_seconds int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted_device','kept_server','dismissed')),
  resolved_by uuid, resolved_at timestamptz, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS attendance_sync_conflicts_open ON public.attendance_sync_conflicts (school_id, status, date);
ALTER TABLE public.offline_sync_batches ADD COLUMN IF NOT EXISTS skew_seconds int;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_sync_items','attendance_sync_conflicts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t); EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
DROP POLICY IF EXISTS attendance_sync_items_read ON public.attendance_sync_items;
CREATE POLICY attendance_sync_items_read ON public.attendance_sync_items FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS attendance_sync_conflicts_read ON public.attendance_sync_conflicts;
CREATE POLICY attendance_sync_conflicts_read ON public.attendance_sync_conflicts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (school_id = public.get_my_school_id() AND public.scholar_can(school_id, 'attendance.edit_past')) OR coalesce(public.is_super_admin(), false));

CREATE OR REPLACE FUNCTION public.offline_attendance_sync_v2(p_batch text, p_items jsonb, p_client_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b public.offline_sync_batches; my uuid := public.get_my_school_id(); it jsonb; applied int := 0; dup int := 0; conf jsonb := '[]'::jsonb;
  ex public.attendance; d date; cls uuid; sid uuid; can_past boolean; skew int; cap timestamptz; iid text; why text; outcome text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.scholar_can(my, 'attendance.take') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_client_now IS NULL THEN RAISE EXCEPTION 'device time is required'; END IF;
  IF coalesce(length(p_batch), 0) NOT BETWEEN 4 AND 80 THEN RAISE EXCEPTION 'batch id must be 4–80 characters'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'items must be an array of at most 500'; END IF;
  skew := round(extract(epoch FROM (p_client_now - now())))::int;
  IF abs(skew) > 86400 THEN RAISE EXCEPTION 'clock_skew: device clock is % hours off; fix the date and time and sync again', round(skew / 3600.0) USING ERRCODE = '22007'; END IF;
  SELECT * INTO b FROM public.offline_sync_batches WHERE user_id = auth.uid() AND client_batch_id = p_batch;
  IF b.id IS NOT NULL THEN RETURN jsonb_build_object('replay', true, 'applied', b.applied, 'conflicts', b.conflicts); END IF;
  can_past := public.scholar_can(my, 'attendance.edit_past');
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    iid := nullif(btrim(coalesce(it->>'id', '')), ''); why := NULL; outcome := 'applied';
    IF iid IS NULL THEN conf := conf || jsonb_build_object('student_id', it->>'student_id', 'why', 'missing_item_id'); CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.attendance_sync_items WHERE user_id = auth.uid() AND client_item_id = iid) THEN dup := dup + 1; CONTINUE; END IF;
    BEGIN sid := (it->>'student_id')::uuid; d := (it->>'date')::date; cap := (it->>'captured_at')::timestamptz - make_interval(secs => skew);
    EXCEPTION WHEN others THEN why := 'bad_item'; END;
    IF why IS NULL THEN
      cls := (SELECT class_id FROM public.students WHERE id = sid AND school_id = my);
      IF cls IS NULL THEN why := 'unknown_student';
      ELSIF public.get_my_role() = 'teacher' AND NOT EXISTS (SELECT 1 FROM public.classes WHERE id = cls AND teacher_id = auth.uid())
         AND NOT EXISTS (SELECT 1 FROM public.timetable_slots ts JOIN public.timetables tt ON tt.id = ts.timetable_id WHERE tt.class_id = cls AND ts.teacher_id = auth.uid()) THEN why := 'not_your_class';
      ELSIF d > current_date OR (d < current_date - 7 AND NOT can_past) THEN why := 'date_out_of_range';
      ELSIF cap IS NOT NULL AND cap > now() + interval '5 minutes' THEN why := 'captured_in_future';
      ELSIF cap IS NOT NULL AND cap::date <> d THEN why := 'captured_on_other_day';
      ELSIF coalesce(it->>'status', '') NOT IN ('present','absent','late','excused') THEN why := 'bad_status';
      END IF;
    END IF;
    IF why IS NOT NULL THEN
      conf := conf || jsonb_build_object('id', iid, 'student_id', it->>'student_id', 'why', why); outcome := why;
    ELSE
      SELECT * INTO ex FROM public.attendance WHERE student_id = sid AND date = d;
      IF ex.id IS NULL THEN
        INSERT INTO public.attendance (school_id, student_id, class_id, date, status, marked_by, note) VALUES (my, sid, cls, d, it->>'status', auth.uid(), 'offline:' || p_batch);
        applied := applied + 1;
      ELSIF ex.status = it->>'status' THEN applied := applied + 1;
      ELSIF ex.marked_by = auth.uid() THEN UPDATE public.attendance SET status = it->>'status', note = 'offline:' || p_batch WHERE id = ex.id; applied := applied + 1;
      ELSE
        INSERT INTO public.attendance_sync_conflicts (school_id, user_id, batch, client_item_id, student_id, date, yours, server, server_marked_by, captured_at, skew_seconds)
        VALUES (my, auth.uid(), p_batch, iid, sid, d, it->>'status', ex.status, ex.marked_by, cap, skew);
        conf := conf || jsonb_build_object('id', iid, 'student_id', sid, 'why', 'server_has_other_mark', 'server', ex.status, 'yours', it->>'status', 'queued', true);
        outcome := 'queued';
      END IF;
    END IF;
    INSERT INTO public.attendance_sync_items (user_id, client_item_id, school_id, batch, outcome) VALUES (auth.uid(), iid, my, p_batch, outcome);
  END LOOP;
  INSERT INTO public.offline_sync_batches (school_id, user_id, client_batch_id, kind, items, applied, conflicts, skew_seconds)
  VALUES (my, auth.uid(), p_batch, 'attendance_v2', jsonb_array_length(p_items), applied, conf, skew);
  RETURN jsonb_build_object('applied', applied, 'duplicates', dup, 'conflicts', conf, 'skew_seconds', skew);
END $$;

CREATE OR REPLACE FUNCTION public.attendance_conflicts_list(p_org uuid, p_status text DEFAULT 'open') RETURNS SETOF public.attendance_sync_conflicts
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_org IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(p_org, 'attendance.edit_past') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.attendance_sync_conflicts WHERE school_id = p_org AND (p_status IS NULL OR status = p_status) ORDER BY date DESC, created_at LIMIT 500;
END $$;

CREATE OR REPLACE FUNCTION public.attendance_conflict_resolve(p_id uuid, p_action text, p_note text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.attendance_sync_conflicts; st text;
BEGIN
  SELECT * INTO c FROM public.attendance_sync_conflicts WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL OR c.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(c.school_id, 'attendance.edit_past') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'conflict already %', c.status; END IF;
  IF p_action NOT IN ('accept_device','keep_server','dismiss') THEN RAISE EXCEPTION 'action must be accept_device, keep_server or dismiss'; END IF;
  IF p_action = 'accept_device' THEN
    UPDATE public.attendance SET status = c.yours, marked_by = c.user_id, note = 'offline-resolved:' || c.batch WHERE student_id = c.student_id AND date = c.date;
    IF NOT FOUND THEN
      INSERT INTO public.attendance (school_id, student_id, class_id, date, status, marked_by, note)
      SELECT c.school_id, c.student_id, s.class_id, c.date, c.yours, c.user_id, 'offline-resolved:' || c.batch FROM public.students s WHERE s.id = c.student_id;
    END IF;
  END IF;
  st := CASE p_action WHEN 'accept_device' THEN 'accepted_device' WHEN 'keep_server' THEN 'kept_server' ELSE 'dismissed' END;
  UPDATE public.attendance_sync_conflicts SET status = st, resolved_by = auth.uid(), resolved_at = now(), note = nullif(btrim(coalesce(p_note, '')), '') WHERE id = c.id;
  RETURN st;
END $$;

REVOKE ALL ON FUNCTION public.offline_attendance_sync_v2(text, jsonb, timestamptz), public.attendance_conflicts_list(uuid, text), public.attendance_conflict_resolve(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offline_attendance_sync_v2(text, jsonb, timestamptz), public.attendance_conflicts_list(uuid, text), public.attendance_conflict_resolve(uuid, text, text) TO authenticated;

COMMIT;
