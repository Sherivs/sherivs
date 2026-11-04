-- M12 V1 retention: tenant-scoped dry runs and explicitly approved tombstones.
-- Tombstones are append-only markers; source rows and immutable audit records are
-- never updated or deleted. Durations mirror provisional RP-* schedule defaults.
DO $guard$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.messages') IS NULL
     OR to_regclass('public.attendance') IS NULL
     OR to_regclass('public.fees') IS NULL
     OR to_regclass('public.student_platform_fee_ledger') IS NULL
     OR to_regclass('public.staff_payroll') IS NULL
     OR to_regprocedure('public.get_my_school_id()') IS NULL
     OR to_regprocedure('public.can_manage_roles(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M12 requires the existing Scholar tenant, role, and retention source tables'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

CREATE TABLE public.retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  policy_ref text NOT NULL CHECK (policy_ref IN ('RP-ATTND-EDU','RP-COMMS-EDU','RP-FINAN-EDU')),
  category text NOT NULL CHECK (category IN ('attendance-activity','communication','financial')),
  target_table text NOT NULL CHECK (target_table IN (
    'attendance','messages','fees','student_platform_fee_ledger','staff_payroll'
  )),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, target_table),
  CHECK (
    (target_table = 'attendance' AND policy_ref = 'RP-ATTND-EDU' AND category = 'attendance-activity')
    OR (target_table = 'messages' AND policy_ref = 'RP-COMMS-EDU' AND category = 'communication')
    OR (target_table IN ('fees','student_platform_fee_ledger','staff_payroll')
        AND policy_ref = 'RP-FINAN-EDU' AND category = 'financial')
  )
);
CREATE INDEX retention_policies_tenant_idx ON public.retention_policies (org_id, category);

CREATE TABLE public.retention_policy_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES public.retention_policies(id) ON DELETE RESTRICT,
  policy_ref text NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('default_seeded','updated')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX retention_policy_audit_tenant_idx
  ON public.retention_policy_audit_events (org_id, occurred_at DESC);

CREATE TABLE public.retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by_kind text NOT NULL CHECK (requested_by_kind IN ('human','scheduler')),
  status text NOT NULL DEFAULT 'dry_run'
    CHECK (status IN ('dry_run','approved','executed')),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  held_count integer NOT NULL DEFAULT 0 CHECK (held_count >= 0),
  tombstoned_count integer NOT NULL DEFAULT 0 CHECK (tombstoned_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  executed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  executed_at timestamptz,
  CHECK ((requested_by_kind = 'human') = (requested_by IS NOT NULL)),
  CHECK ((status = 'executed') = (executed_at IS NOT NULL AND executed_by IS NOT NULL))
);
CREATE INDEX retention_runs_tenant_recent_idx ON public.retention_runs (org_id, created_at DESC);

CREATE TABLE public.retention_run_candidates (
  run_id uuid NOT NULL REFERENCES public.retention_runs(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES public.retention_policies(id) ON DELETE RESTRICT,
  policy_ref text NOT NULL,
  category text NOT NULL CHECK (category IN ('attendance-activity','communication','financial')),
  target_table text NOT NULL CHECK (target_table IN (
    'attendance','messages','fees','student_platform_fee_ledger','staff_payroll'
  )),
  target_record_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  subject_refs uuid[] NOT NULL DEFAULT '{}',
  candidate_state text NOT NULL DEFAULT 'eligible'
    CHECK (candidate_state IN ('eligible','held','stale','tombstoned','already_tombstoned')),
  PRIMARY KEY (run_id, target_table, target_record_id),
  UNIQUE (run_id, org_id, target_table, target_record_id)
);
CREATE INDEX retention_run_candidates_tenant_idx
  ON public.retention_run_candidates (org_id, run_id, candidate_state);

CREATE TABLE public.retention_run_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES public.retention_runs(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  requester_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (requester_id IS DISTINCT FROM approver_id)
);
CREATE INDEX retention_run_approvals_tenant_idx
  ON public.retention_run_approvals (org_id, approved_at DESC);

CREATE TABLE public.retention_legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  hold_scope text NOT NULL CHECK (hold_scope IN ('tenant','category','subject','record')),
  category text CHECK (category IN ('attendance-activity','communication','financial')),
  subject_ref uuid,
  target_table text CHECK (target_table IN (
    'attendance','messages','fees','student_platform_fee_ledger','staff_payroll'
  )),
  target_record_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  released_at timestamptz,
  release_reason text,
  CHECK (
    (hold_scope = 'tenant' AND category IS NULL AND subject_ref IS NULL
      AND target_table IS NULL AND target_record_id IS NULL)
    OR (hold_scope = 'category' AND category IS NOT NULL AND subject_ref IS NULL
      AND target_table IS NULL AND target_record_id IS NULL)
    OR (hold_scope = 'subject' AND subject_ref IS NOT NULL
      AND target_table IS NULL AND target_record_id IS NULL)
    OR (hold_scope = 'record' AND target_table IS NOT NULL AND target_record_id IS NOT NULL
      AND subject_ref IS NULL)
  ),
  CHECK ((active AND released_by IS NULL AND released_at IS NULL AND release_reason IS NULL)
    OR (NOT active AND released_by IS NOT NULL AND released_at IS NOT NULL
      AND length(btrim(coalesce(release_reason, ''))) >= 3))
);
CREATE INDEX retention_legal_holds_active_tenant_idx
  ON public.retention_legal_holds (org_id, category) WHERE active;
CREATE INDEX retention_legal_holds_active_subject_idx
  ON public.retention_legal_holds (org_id, subject_ref) WHERE active AND subject_ref IS NOT NULL;
CREATE INDEX retention_legal_holds_active_record_idx
  ON public.retention_legal_holds (org_id, target_table, target_record_id)
  WHERE active AND target_record_id IS NOT NULL;

CREATE TABLE public.retention_legal_hold_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  hold_id uuid NOT NULL REFERENCES public.retention_legal_holds(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','released')),
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX retention_legal_hold_audit_tenant_idx
  ON public.retention_legal_hold_audit_events (org_id, occurred_at DESC);

CREATE TABLE public.retention_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES public.retention_runs(id) ON DELETE RESTRICT,
  policy_ref text NOT NULL CHECK (policy_ref IN ('RP-ATTND-EDU','RP-COMMS-EDU','RP-FINAN-EDU')),
  category text NOT NULL CHECK (category IN ('attendance-activity','communication','financial')),
  target_table text NOT NULL CHECK (target_table IN (
    'attendance','messages','fees','student_platform_fee_ledger','staff_payroll'
  )),
  target_record_id uuid NOT NULL,
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, target_table, target_record_id)
);
CREATE INDEX retention_deletion_audit_tenant_idx
  ON public.retention_deletion_audit (org_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.retention_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER retention_policy_audit_immutable
  BEFORE UPDATE OR DELETE ON public.retention_policy_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_policy_audit_no_truncate
  BEFORE TRUNCATE ON public.retention_policy_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_hold_audit_immutable
  BEFORE UPDATE OR DELETE ON public.retention_legal_hold_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_hold_audit_no_truncate
  BEFORE TRUNCATE ON public.retention_legal_hold_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_deletion_audit_immutable
  BEFORE UPDATE OR DELETE ON public.retention_deletion_audit
  FOR EACH ROW EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_deletion_audit_no_truncate
  BEFORE TRUNCATE ON public.retention_deletion_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_approval_immutable
  BEFORE UPDATE OR DELETE ON public.retention_run_approvals
  FOR EACH ROW EXECUTE FUNCTION public.retention_append_only_guard();
CREATE TRIGGER retention_approval_no_truncate
  BEFORE TRUNCATE ON public.retention_run_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_append_only_guard();

CREATE OR REPLACE FUNCTION public.retention_policy_audit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb := jsonb_build_object(
    'policy_ref', NEW.policy_ref,
    'category', NEW.category,
    'target_table', NEW.target_table,
    'retention_days', NEW.retention_days,
    'enabled', NEW.enabled
  );
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_before := jsonb_build_object(
      'policy_ref', OLD.policy_ref,
      'category', OLD.category,
      'target_table', OLD.target_table,
      'retention_days', OLD.retention_days,
      'enabled', OLD.enabled
    );
  END IF;
  INSERT INTO public.retention_policy_audit_events (
    org_id, policy_id, policy_ref, actor_id, action, before_state, after_state
  ) VALUES (
    NEW.org_id, NEW.id, NEW.policy_ref, auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'default_seeded' ELSE 'updated' END,
    v_before, v_after
  );
  RETURN NEW;
END
$$;
CREATE TRIGGER retention_policy_audit
  AFTER INSERT OR UPDATE ON public.retention_policies
  FOR EACH ROW EXECUTE FUNCTION public.retention_policy_audit_write();

CREATE OR REPLACE FUNCTION public.retention_legal_hold_audit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.retention_legal_hold_audit_events (org_id, hold_id, actor_id, action, details)
  VALUES (
    NEW.org_id, NEW.id, auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'released' END,
    jsonb_build_object(
      'scope', NEW.hold_scope,
      'category', NEW.category,
      'subject_ref', NEW.subject_ref,
      'target_table', NEW.target_table,
      'target_record_id', NEW.target_record_id,
      'reason', CASE WHEN TG_OP = 'INSERT' THEN NEW.reason ELSE NEW.release_reason END
    )
  );
  RETURN NEW;
END
$$;
CREATE TRIGGER retention_legal_hold_audit
  AFTER INSERT OR UPDATE ON public.retention_legal_holds
  FOR EACH ROW EXECUTE FUNCTION public.retention_legal_hold_audit_write();

CREATE OR REPLACE FUNCTION public.retention_legal_hold_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legal holds cannot be deleted; release the hold with an audit event'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.hold_scope IS DISTINCT FROM OLD.hold_scope
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.subject_ref IS DISTINCT FROM OLD.subject_ref
     OR NEW.target_table IS DISTINCT FROM OLD.target_table
     OR NEW.target_record_id IS DISTINCT FROM OLD.target_record_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.active IS FALSE OR NEW.active IS TRUE THEN
    RAISE EXCEPTION 'legal hold identity is immutable and release is one-way'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER retention_legal_hold_guard
  BEFORE UPDATE OR DELETE ON public.retention_legal_holds
  FOR EACH ROW EXECUTE FUNCTION public.retention_legal_hold_guard();

CREATE OR REPLACE FUNCTION public.retention_seed_school_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.retention_policies (org_id, policy_ref, category, target_table, retention_days)
  VALUES
    (NEW.id,'RP-ATTND-EDU','attendance-activity','attendance',730),
    (NEW.id,'RP-COMMS-EDU','communication','messages',365),
    (NEW.id,'RP-FINAN-EDU','financial','fees',2555),
    (NEW.id,'RP-FINAN-EDU','financial','student_platform_fee_ledger',2555),
    (NEW.id,'RP-FINAN-EDU','financial','staff_payroll',2555)
  ON CONFLICT (org_id, target_table) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER retention_seed_school_defaults
  AFTER INSERT ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.retention_seed_school_defaults();

INSERT INTO public.retention_policies (org_id, policy_ref, category, target_table, retention_days)
SELECT s.id, d.policy_ref, d.category, d.target_table, d.retention_days
  FROM public.schools s
 CROSS JOIN (VALUES
   ('RP-ATTND-EDU','attendance-activity','attendance',730),
   ('RP-COMMS-EDU','communication','messages',365),
   ('RP-FINAN-EDU','financial','fees',2555),
   ('RP-FINAN-EDU','financial','student_platform_fee_ledger',2555),
   ('RP-FINAN-EDU','financial','staff_payroll',2555)
 ) AS d(policy_ref, category, target_table, retention_days)
ON CONFLICT (org_id, target_table) DO NOTHING;

CREATE OR REPLACE FUNCTION public.retention_can_manage(p_org uuid)
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

CREATE OR REPLACE FUNCTION public.retention_policy_configure(
  p_org uuid,
  p_target_table text,
  p_retention_days integer,
  p_enabled boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy public.retention_policies%ROWTYPE;
BEGIN
  IF NOT public.retention_can_manage(p_org) THEN
    RAISE EXCEPTION 'tenant retention management permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_retention_days NOT BETWEEN 1 AND 36500 OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid retention policy settings' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_policy FROM public.retention_policies
   WHERE org_id = p_org AND target_table = p_target_table FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention policy target is not configured' USING ERRCODE = '22023';
  END IF;
  UPDATE public.retention_policies
     SET retention_days = p_retention_days,
         enabled = p_enabled,
         updated_by = auth.uid(),
         updated_at = clock_timestamp()
   WHERE id = v_policy.id;
  RETURN v_policy.id;
END
$$;

CREATE OR REPLACE FUNCTION public.retention_legal_hold_create(
  p_org uuid,
  p_scope text,
  p_category text,
  p_subject_ref uuid,
  p_target_table text,
  p_target_record_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.retention_can_manage(p_org) THEN
    RAISE EXCEPTION 'tenant retention management permission is required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 4812));
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'legal hold reason is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.retention_legal_holds (
    org_id, hold_scope, category, subject_ref, target_table, target_record_id, reason, created_by
  ) VALUES (
    p_org, p_scope, p_category, p_subject_ref, p_target_table, p_target_record_id,
    btrim(p_reason), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.retention_legal_hold_release(p_hold_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_hold public.retention_legal_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_hold FROM public.retention_legal_holds
   WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND OR NOT public.retention_can_manage(v_hold.org_id) THEN
    RAISE EXCEPTION 'legal hold not found' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_hold.org_id::text, 4812));
  IF NOT v_hold.active OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'active legal hold and release reason are required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.retention_legal_holds
     SET active = false, released_by = auth.uid(), released_at = clock_timestamp(),
         release_reason = btrim(p_reason)
   WHERE id = p_hold_id;
END
$$;

CREATE OR REPLACE FUNCTION public.retention_run_dry(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run_id uuid;
  v_scheduler boolean := current_setting('role', true) = 'service_role';
  v_candidate_count integer;
  v_eligible_count integer;
  v_held_count integer;
  v_policies jsonb;
BEGIN
  IF NOT v_scheduler AND NOT public.retention_can_manage(p_org) THEN
    RAISE EXCEPTION 'tenant retention management permission is required' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_org) THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.retention_runs (org_id, requested_by, requested_by_kind)
  VALUES (p_org, CASE WHEN v_scheduler THEN NULL ELSE auth.uid() END,
          CASE WHEN v_scheduler THEN 'scheduler' ELSE 'human' END)
  RETURNING id INTO v_run_id;

  WITH eligible_records AS (
    SELECT p.id policy_id, p.policy_ref, p.category, p.target_table, p.org_id,
           a.id target_record_id, a.date::timestamp AT TIME ZONE 'UTC' observed_at,
           ARRAY[a.student_id]::uuid[] subject_refs, p.retention_days
      FROM public.retention_policies p
      JOIN public.attendance a ON a.school_id = p.org_id
     WHERE p.org_id = p_org AND p.enabled AND p.target_table = 'attendance'
       AND a.date < current_date - p.retention_days
       AND NOT EXISTS (SELECT 1 FROM public.retention_deletion_audit d
                        WHERE d.org_id = p.org_id AND d.target_table = p.target_table
                          AND d.target_record_id = a.id)
    UNION ALL
    SELECT p.id, p.policy_ref, p.category, p.target_table, p.org_id,
           m.id, m.created_at,
           array_remove(ARRAY[m.sender_id,m.recipient_id]::uuid[], NULL::uuid), p.retention_days
      FROM public.retention_policies p
      JOIN public.messages m ON m.school_id = p.org_id
     WHERE p.org_id = p_org AND p.enabled AND p.target_table = 'messages'
       AND m.created_at < clock_timestamp() - make_interval(days => p.retention_days)
       AND NOT EXISTS (SELECT 1 FROM public.retention_deletion_audit d
                        WHERE d.org_id = p.org_id AND d.target_table = p.target_table
                          AND d.target_record_id = m.id)
    UNION ALL
    SELECT p.id, p.policy_ref, p.category, p.target_table, p.org_id,
           f.id, f.created_at, ARRAY[f.student_id]::uuid[], p.retention_days
      FROM public.retention_policies p
      JOIN public.fees f ON f.school_id = p.org_id
     WHERE p.org_id = p_org AND p.enabled AND p.target_table = 'fees'
       AND f.created_at < clock_timestamp() - make_interval(days => p.retention_days)
       AND NOT EXISTS (SELECT 1 FROM public.retention_deletion_audit d
                        WHERE d.org_id = p.org_id AND d.target_table = p.target_table
                          AND d.target_record_id = f.id)
    UNION ALL
    SELECT p.id, p.policy_ref, p.category, p.target_table, p.org_id,
           l.id, l.created_at, array_remove(ARRAY[l.student_id]::uuid[], NULL::uuid), p.retention_days
      FROM public.retention_policies p
      JOIN public.student_platform_fee_ledger l ON l.school_id = p.org_id
     WHERE p.org_id = p_org AND p.enabled AND p.target_table = 'student_platform_fee_ledger'
       AND l.created_at < clock_timestamp() - make_interval(days => p.retention_days)
       AND NOT EXISTS (SELECT 1 FROM public.retention_deletion_audit d
                        WHERE d.org_id = p_org AND d.target_table = p.target_table
                          AND d.target_record_id = l.id)
    UNION ALL
    SELECT p.id, p.policy_ref, p.category, p.target_table, p.org_id,
           w.id, w.created_at, array_remove(ARRAY[w.user_id]::uuid[], NULL::uuid), p.retention_days
      FROM public.retention_policies p
      JOIN public.staff_payroll w ON w.school_id = p.org_id
     WHERE p.org_id = p_org AND p.enabled AND p.target_table = 'staff_payroll'
       AND w.created_at < clock_timestamp() - make_interval(days => p.retention_days)
       AND NOT EXISTS (SELECT 1 FROM public.retention_deletion_audit d
                        WHERE d.org_id = p_org AND d.target_table = p.target_table
                          AND d.target_record_id = w.id)
  )
  INSERT INTO public.retention_run_candidates (
    run_id, org_id, policy_id, policy_ref, category, target_table, target_record_id,
    observed_at, retention_days, subject_refs, candidate_state
  )
  SELECT v_run_id, r.org_id, r.policy_id, r.policy_ref, r.category, r.target_table,
         r.target_record_id, r.observed_at, r.retention_days, r.subject_refs,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.retention_legal_holds h
            WHERE h.org_id = r.org_id AND h.active
              AND (h.category IS NULL OR h.category = r.category)
              AND (
                h.hold_scope = 'tenant'
                OR h.hold_scope = 'category'
                OR (h.hold_scope = 'subject' AND h.subject_ref = ANY(r.subject_refs))
                OR (h.hold_scope = 'record' AND h.target_table = r.target_table
                    AND h.target_record_id = r.target_record_id)
              )
         ) THEN 'held' ELSE 'eligible' END
    FROM eligible_records r;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE candidate_state = 'eligible')::integer,
         count(*) FILTER (WHERE candidate_state = 'held')::integer
    INTO v_candidate_count, v_eligible_count, v_held_count
    FROM public.retention_run_candidates WHERE run_id = v_run_id;
  UPDATE public.retention_runs
     SET candidate_count = v_candidate_count,
         eligible_count = v_eligible_count,
         held_count = v_held_count
   WHERE id = v_run_id;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'policyRef', p.policy_ref,
      'category', p.category,
      'targetTable', p.target_table,
      'candidateCount', x.candidate_count,
      'eligibleCount', x.eligible_count,
      'heldCount', x.held_count,
      'candidateIds', x.candidate_ids,
      'heldIds', x.held_ids
    ) ORDER BY p.policy_ref, p.target_table
  ), '[]'::jsonb)
    INTO v_policies
    FROM public.retention_policies p
    CROSS JOIN LATERAL (
      SELECT count(c.target_record_id)::integer candidate_count,
             count(c.target_record_id) FILTER (WHERE c.candidate_state = 'eligible')::integer eligible_count,
             count(c.target_record_id) FILTER (WHERE c.candidate_state = 'held')::integer held_count,
             coalesce(jsonb_agg(c.target_record_id ORDER BY c.target_record_id)
               FILTER (WHERE c.target_record_id IS NOT NULL), '[]'::jsonb) candidate_ids,
             coalesce(jsonb_agg(c.target_record_id ORDER BY c.target_record_id)
               FILTER (WHERE c.candidate_state = 'held'), '[]'::jsonb) held_ids
        FROM public.retention_run_candidates c
       WHERE c.run_id = v_run_id AND c.policy_id = p.id
    ) x
   WHERE p.org_id = p_org AND p.enabled;

  RETURN jsonb_build_object(
    'runId', v_run_id, 'mode', 'dry-run', 'candidateCount', v_candidate_count,
    'eligibleCount', v_eligible_count, 'heldCount', v_held_count, 'policies', v_policies
  );
END
$$;

CREATE OR REPLACE FUNCTION public.retention_run_approve(p_run_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_run public.retention_runs%ROWTYPE; v_approval_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.retention_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR NOT public.retention_can_manage(v_run.org_id) THEN
    RAISE EXCEPTION 'retention run not found' USING ERRCODE = '42501';
  END IF;
  IF v_run.status <> 'dry_run' OR v_run.eligible_count = 0
     OR v_run.requested_by IS NOT DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'run requires eligible candidates and an approver other than its requester'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.retention_run_approvals (run_id, org_id, requester_id, approver_id)
  VALUES (v_run.id, v_run.org_id, v_run.requested_by, auth.uid())
  RETURNING id INTO v_approval_id;
  UPDATE public.retention_runs SET status = 'approved' WHERE id = v_run.id;
  RETURN v_approval_id;
END
$$;

CREATE OR REPLACE FUNCTION public.retention_run_execute(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.retention_runs%ROWTYPE;
  v_approval public.retention_run_approvals%ROWTYPE;
  v_candidate public.retention_run_candidates%ROWTYPE;
  v_inserted integer;
  v_tombstoned integer := 0;
  v_held integer := 0;
  v_stale integer := 0;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO v_run FROM public.retention_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR NOT public.retention_can_manage(v_run.org_id) THEN
    RAISE EXCEPTION 'retention run not found' USING ERRCODE = '42501';
  END IF;
  IF v_run.status <> 'approved' OR v_actor IS NULL
     OR v_actor IS NOT DISTINCT FROM v_run.requested_by THEN
    RAISE EXCEPTION 'approved run and a different authorized executor are required'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_approval FROM public.retention_run_approvals
   WHERE run_id = v_run.id AND org_id = v_run.org_id;
  IF NOT FOUND OR v_approval.approver_id IS NOT DISTINCT FROM v_run.requested_by THEN
    RAISE EXCEPTION 'valid independent approval is required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_run.org_id::text, 4812));

  FOR v_candidate IN
    SELECT * FROM public.retention_run_candidates
     WHERE run_id = v_run.id AND org_id = v_run.org_id AND candidate_state = 'eligible'
     ORDER BY target_table, target_record_id FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.retention_legal_holds h
       WHERE h.org_id = v_candidate.org_id AND h.active
         AND (h.category IS NULL OR h.category = v_candidate.category)
         AND (
           h.hold_scope = 'tenant'
           OR h.hold_scope = 'category'
           OR (h.hold_scope = 'subject' AND h.subject_ref = ANY(v_candidate.subject_refs))
           OR (h.hold_scope = 'record' AND h.target_table = v_candidate.target_table
               AND h.target_record_id = v_candidate.target_record_id)
         )
    ) THEN
      UPDATE public.retention_run_candidates SET candidate_state = 'held'
       WHERE run_id = v_run.id AND target_table = v_candidate.target_table
         AND target_record_id = v_candidate.target_record_id;
      v_held := v_held + 1;
      CONTINUE;
    END IF;

    PERFORM 1 FROM public.retention_policies p
     WHERE p.id = v_candidate.policy_id AND p.org_id = v_run.org_id AND p.enabled
       AND p.policy_ref = v_candidate.policy_ref
       AND p.retention_days = v_candidate.retention_days
     FOR SHARE;
    IF NOT FOUND THEN
      UPDATE public.retention_run_candidates SET candidate_state = 'stale'
       WHERE run_id = v_run.id AND target_table = v_candidate.target_table
         AND target_record_id = v_candidate.target_record_id;
      v_stale := v_stale + 1;
      CONTINUE;
    END IF;

    IF v_candidate.target_table = 'attendance' THEN
      PERFORM 1 FROM public.attendance a WHERE a.id = v_candidate.target_record_id
        AND a.school_id = v_run.org_id
        AND a.date::timestamp AT TIME ZONE 'UTC' = v_candidate.observed_at
        AND a.date < current_date - v_candidate.retention_days FOR UPDATE;
    ELSIF v_candidate.target_table = 'messages' THEN
      PERFORM 1 FROM public.messages m WHERE m.id = v_candidate.target_record_id
        AND m.school_id = v_run.org_id AND m.created_at = v_candidate.observed_at
        AND m.created_at < clock_timestamp() - make_interval(days => v_candidate.retention_days)
        FOR UPDATE;
    ELSIF v_candidate.target_table = 'fees' THEN
      PERFORM 1 FROM public.fees f WHERE f.id = v_candidate.target_record_id
        AND f.school_id = v_run.org_id AND f.created_at = v_candidate.observed_at
        AND f.created_at < clock_timestamp() - make_interval(days => v_candidate.retention_days)
        FOR UPDATE;
    ELSIF v_candidate.target_table = 'student_platform_fee_ledger' THEN
      PERFORM 1 FROM public.student_platform_fee_ledger l WHERE l.id = v_candidate.target_record_id
        AND l.school_id = v_run.org_id AND l.created_at = v_candidate.observed_at
        AND l.created_at < clock_timestamp() - make_interval(days => v_candidate.retention_days)
        FOR UPDATE;
    ELSIF v_candidate.target_table = 'staff_payroll' THEN
      PERFORM 1 FROM public.staff_payroll w WHERE w.id = v_candidate.target_record_id
        AND w.school_id = v_run.org_id AND w.created_at = v_candidate.observed_at
        AND w.created_at < clock_timestamp() - make_interval(days => v_candidate.retention_days)
        FOR UPDATE;
    END IF;
    IF NOT FOUND THEN
      UPDATE public.retention_run_candidates SET candidate_state = 'stale'
       WHERE run_id = v_run.id AND target_table = v_candidate.target_table
         AND target_record_id = v_candidate.target_record_id;
      v_stale := v_stale + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.retention_deletion_audit (
      org_id, run_id, policy_ref, category, target_table, target_record_id, approved_by, actor_id
    ) VALUES (
      v_run.org_id, v_run.id, v_candidate.policy_ref, v_candidate.category,
      v_candidate.target_table, v_candidate.target_record_id, v_approval.approver_id, v_actor
    ) ON CONFLICT (org_id, target_table, target_record_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      UPDATE public.retention_run_candidates SET candidate_state = 'tombstoned'
       WHERE run_id = v_run.id AND target_table = v_candidate.target_table
         AND target_record_id = v_candidate.target_record_id;
      v_tombstoned := v_tombstoned + 1;
    ELSE
      UPDATE public.retention_run_candidates SET candidate_state = 'already_tombstoned'
       WHERE run_id = v_run.id AND target_table = v_candidate.target_table
         AND target_record_id = v_candidate.target_record_id;
    END IF;
  END LOOP;

  UPDATE public.retention_runs
     SET status = 'executed', executed_by = v_actor, executed_at = clock_timestamp(),
         tombstoned_count = v_tombstoned
   WHERE id = v_run.id;
  RETURN jsonb_build_object(
    'runId', v_run.id, 'mode', 'tombstone', 'tombstonedCount', v_tombstoned,
    'heldCount', v_held, 'staleCount', v_stale
  );
END
$$;

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policy_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policy_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_run_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_run_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_run_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_run_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_legal_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_legal_hold_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_legal_hold_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_deletion_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_deletion_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY retention_policies_tenant_read ON public.retention_policies
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_policy_audit_tenant_read ON public.retention_policy_audit_events
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_runs_tenant_read ON public.retention_runs
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_candidates_tenant_read ON public.retention_run_candidates
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_approvals_tenant_read ON public.retention_run_approvals
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_holds_tenant_read ON public.retention_legal_holds
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_hold_audit_tenant_read ON public.retention_legal_hold_audit_events
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));
CREATE POLICY retention_deletion_audit_tenant_read ON public.retention_deletion_audit
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id())
    AND (public.can_manage_roles(org_id, 'roles.configure') OR public.scholar_can(org_id, 'audit.view')));

REVOKE ALL ON public.retention_policies, public.retention_policy_audit_events,
  public.retention_runs, public.retention_run_candidates, public.retention_run_approvals,
  public.retention_legal_holds, public.retention_legal_hold_audit_events,
  public.retention_deletion_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.retention_policies, public.retention_policy_audit_events,
  public.retention_runs, public.retention_run_candidates, public.retention_run_approvals,
  public.retention_legal_holds, public.retention_legal_hold_audit_events,
  public.retention_deletion_audit TO authenticated;

REVOKE ALL ON FUNCTION public.retention_append_only_guard(),
  public.retention_policy_audit_write(), public.retention_legal_hold_audit_write(),
  public.retention_legal_hold_guard(), public.retention_seed_school_defaults(),
  public.retention_can_manage(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retention_policy_configure(uuid,text,integer,boolean),
  public.retention_legal_hold_create(uuid,text,text,uuid,text,uuid,text),
  public.retention_legal_hold_release(uuid,text),
  public.retention_run_approve(uuid), public.retention_run_execute(uuid),
  public.retention_run_dry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retention_policy_configure(uuid,text,integer,boolean),
  public.retention_legal_hold_create(uuid,text,text,uuid,text,uuid,text),
  public.retention_legal_hold_release(uuid,text),
  public.retention_run_approve(uuid), public.retention_run_execute(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_run_dry(uuid) TO authenticated, service_role;
