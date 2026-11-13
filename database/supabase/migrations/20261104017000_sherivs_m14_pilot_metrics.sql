-- M14: aggregate-only pilot metrics. No personal identifiers anywhere in this schema.
-- Forward-only. Tenant-owned, RLS ENABLED and FORCED. Authenticated users get SELECT only;
-- writes go through SECURITY DEFINER functions. Never applied to a live database by this file.

DO $guard$
BEGIN
  IF to_regclass('public.schools') IS NULL OR to_regclass('public.attendance') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regprocedure('public.can_manage_roles(uuid,text)') IS NULL
     OR to_regprocedure('public.scholar_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M14 requires the tenant substrate, attendance, and the role engine' USING ERRCODE = '55000';
  END IF;
END
$guard$;

-- Reference data: the four pilot metrics and how each baseline is captured. No tenant data.
CREATE TABLE public.pilot_metric_definitions (
  metric_key text PRIMARY KEY CHECK (metric_key IN
    ('attendance_capture_rate','result_turnaround','fee_reconciliation_time','asc_export_completeness')),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('rate','duration')),
  unit text NOT NULL CHECK (unit IN ('ratio','seconds')),
  capture_method text NOT NULL CHECK (length(btrim(capture_method)) >= 20)
);

INSERT INTO public.pilot_metric_definitions (metric_key, title, kind, unit, capture_method) VALUES
  ('attendance_capture_rate', 'Attendance capture rate', 'rate', 'ratio',
   'Derived in the database: attendance rows recorded in the period divided by (students in the tenant x days in the period on which any attendance was captured). Counts only.'),
  ('result_turnaround', 'Result turnaround', 'duration', 'seconds',
   'Recorded by the results workflow as aggregates: total seconds from assessment close to result publication, and the number of results published, per period.'),
  ('fee_reconciliation_time', 'Fee reconciliation time', 'duration', 'seconds',
   'Recorded by the fees workflow as aggregates: total seconds from payment recording to ledger posting, and the number of payments reconciled, per period.'),
  ('asc_export_completeness', 'ASC export completeness', 'rate', 'ratio',
   'Recorded by the ASC export as aggregates: required fields present across exported records, and the number of required fields expected, per export period.');

CREATE TABLE public.pilot_metric_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  metric_key text NOT NULL REFERENCES public.pilot_metric_definitions(metric_key) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  numerator bigint NOT NULL CHECK (numerator >= 0),
  denominator bigint NOT NULL CHECK (denominator >= 0),
  source text NOT NULL CHECK (source IN ('derived','recorded')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (period_end >= period_start),
  UNIQUE (org_id, metric_key, period_start, period_end)
);
CREATE INDEX pilot_metric_samples_org_metric_idx ON public.pilot_metric_samples (org_id, metric_key, period_start);

-- Append-only history of every captured value (counters only, no actor).
CREATE TABLE public.pilot_metric_sample_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  sample_id uuid NOT NULL REFERENCES public.pilot_metric_samples(id) ON DELETE RESTRICT,
  metric_key text NOT NULL,
  numerator bigint NOT NULL,
  denominator bigint NOT NULL,
  source text NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.pilot_metric_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER pilot_metric_log_immutable
  BEFORE UPDATE OR DELETE ON public.pilot_metric_sample_log
  FOR EACH ROW EXECUTE FUNCTION public.pilot_metric_append_only_guard();
CREATE TRIGGER pilot_metric_log_no_truncate
  BEFORE TRUNCATE ON public.pilot_metric_sample_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.pilot_metric_append_only_guard();
CREATE TRIGGER pilot_metric_definitions_immutable
  BEFORE UPDATE OR DELETE ON public.pilot_metric_definitions
  FOR EACH ROW EXECUTE FUNCTION public.pilot_metric_append_only_guard();

CREATE OR REPLACE FUNCTION public.pilot_metric_sample_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pilot metric samples cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.metric_key IS DISTINCT FROM OLD.metric_key
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end THEN
    RAISE EXCEPTION 'pilot metric sample identity is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pilot_metric_sample_guard
  BEFORE UPDATE OR DELETE ON public.pilot_metric_samples
  FOR EACH ROW EXECUTE FUNCTION public.pilot_metric_sample_guard();
CREATE TRIGGER pilot_metric_sample_no_truncate
  BEFORE TRUNCATE ON public.pilot_metric_samples
  FOR EACH STATEMENT EXECUTE FUNCTION public.pilot_metric_append_only_guard();

CREATE OR REPLACE FUNCTION public.pilot_metric_sample_log_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.pilot_metric_sample_log (org_id, sample_id, metric_key, numerator, denominator, source)
  VALUES (NEW.org_id, NEW.id, NEW.metric_key, NEW.numerator, NEW.denominator, NEW.source);
  RETURN NEW;
END
$$;
CREATE TRIGGER pilot_metric_sample_log_write
  AFTER INSERT OR UPDATE ON public.pilot_metric_samples
  FOR EACH ROW EXECUTE FUNCTION public.pilot_metric_sample_log_write();

CREATE OR REPLACE FUNCTION public.pilot_metric_can_manage(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_org IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND public.get_my_school_id() = p_org
     AND public.can_manage_roles(p_org, 'roles.configure');
$$;

-- Shared upsert. Callers validate authority first.
CREATE OR REPLACE FUNCTION public.pilot_metric_upsert(
  p_org uuid, p_key text, p_start date, p_end date, p_num bigint, p_den bigint, p_source text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_id uuid;
BEGIN
  SELECT kind INTO v_kind FROM public.pilot_metric_definitions WHERE metric_key = p_key;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'unknown pilot metric' USING ERRCODE = '22023';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  IF p_num IS NULL OR p_den IS NULL OR p_num < 0 OR p_den < 0
     OR (v_kind = 'rate' AND p_num > p_den) THEN
    RAISE EXCEPTION 'invalid counters for this metric' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pilot_metric_samples (org_id, metric_key, period_start, period_end, numerator, denominator, source)
  VALUES (p_org, p_key, p_start, p_end, p_num, p_den, p_source)
  ON CONFLICT (org_id, metric_key, period_start, period_end)
  DO UPDATE SET numerator = EXCLUDED.numerator, denominator = EXCLUDED.denominator,
                source = EXCLUDED.source, recorded_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Aggregates recorded by the results, fees and ASC export workflows. Counters only.
CREATE OR REPLACE FUNCTION public.pilot_metric_record(
  p_org uuid, p_key text, p_start date, p_end date, p_num bigint, p_den bigint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (current_setting('role', true) = 'service_role' OR public.pilot_metric_can_manage(p_org)) THEN
    RAISE EXCEPTION 'tenant pilot metric management permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_org) THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = '42501';
  END IF;
  IF p_key = 'attendance_capture_rate' THEN
    RAISE EXCEPTION 'attendance capture is derived in the database, not recorded' USING ERRCODE = '22023';
  END IF;
  RETURN public.pilot_metric_upsert(p_org, p_key, p_start, p_end, p_num, p_den, 'recorded');
END
$$;

-- Attendance capture rate, derived from counts only.
CREATE OR REPLACE FUNCTION public.pilot_metric_capture_attendance(p_org uuid, p_start date, p_end date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows bigint;
  v_days bigint;
  v_students bigint;
BEGIN
  IF NOT (current_setting('role', true) = 'service_role' OR public.pilot_metric_can_manage(p_org)) THEN
    RAISE EXCEPTION 'tenant pilot metric management permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_org) THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), count(DISTINCT a.date) INTO v_rows, v_days
    FROM public.attendance a
   WHERE a.school_id = p_org AND a.date BETWEEN p_start AND p_end;
  SELECT count(*) INTO v_students FROM public.students s WHERE s.school_id = p_org;
  RETURN public.pilot_metric_upsert(p_org, 'attendance_capture_rate', p_start, p_end,
    least(v_rows, v_students * v_days), v_students * v_days, 'derived');
END
$$;

-- Report. Values built from fewer than 5 observations are suppressed so a tiny cohort cannot
-- be read back as one person's record.
CREATE OR REPLACE FUNCTION public.pilot_metrics_report(p_org uuid, p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (public.pilot_metric_can_manage(p_org)
          OR (auth.uid() IS NOT NULL AND public.get_my_school_id() = p_org
              AND public.scholar_can(p_org, 'audit.view'))) THEN
    RAISE EXCEPTION 'tenant pilot metric read permission is required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'periodStart', p_start, 'periodEnd', p_end, 'minObservations', 5,
    'metrics', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'metricKey', d.metric_key, 'title', d.title, 'kind', d.kind, 'unit', d.unit,
        'captureMethod', d.capture_method,
        'samples', coalesce(t.samples, 0),
        'numerator', t.num, 'denominator', t.den,
        'suppressed', coalesce(t.den, 0) < 5,
        'value', CASE WHEN coalesce(t.den, 0) < 5 THEN NULL
                      ELSE round(t.num::numeric / t.den::numeric, 4) END
      ) ORDER BY d.metric_key)
        FROM public.pilot_metric_definitions d
        LEFT JOIN (
          SELECT s.metric_key, count(*) AS samples, sum(s.numerator) AS num, sum(s.denominator) AS den
            FROM public.pilot_metric_samples s
           WHERE s.org_id = p_org AND s.period_start >= p_start AND s.period_end <= p_end
           GROUP BY s.metric_key
        ) t ON t.metric_key = d.metric_key
    ), '[]'::jsonb));
END
$$;

ALTER TABLE public.pilot_metric_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_metric_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_metric_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_metric_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_metric_sample_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_metric_sample_log FORCE ROW LEVEL SECURITY;

CREATE POLICY pilot_metric_definitions_read ON public.pilot_metric_definitions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY pilot_metric_samples_read ON public.pilot_metric_samples
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY pilot_metric_sample_log_read ON public.pilot_metric_sample_log
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));

REVOKE ALL ON public.pilot_metric_definitions, public.pilot_metric_samples, public.pilot_metric_sample_log
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pilot_metric_definitions, public.pilot_metric_samples, public.pilot_metric_sample_log
  TO authenticated;

REVOKE ALL ON FUNCTION
  public.pilot_metric_append_only_guard(), public.pilot_metric_sample_guard(),
  public.pilot_metric_sample_log_write(), public.pilot_metric_can_manage(uuid),
  public.pilot_metric_upsert(uuid,text,date,date,bigint,bigint,text),
  public.pilot_metric_record(uuid,text,date,date,bigint,bigint),
  public.pilot_metric_capture_attendance(uuid,date,date),
  public.pilot_metrics_report(uuid,date,date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.pilot_metric_record(uuid,text,date,date,bigint,bigint),
  public.pilot_metric_capture_attendance(uuid,date,date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pilot_metrics_report(uuid,date,date) TO authenticated;
