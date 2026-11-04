-- SV1-SCHED S1: neutral, tenant-scoped scheduling inputs and versioned plans.
-- Status: authored, NOT APPLIED. No production database changes are made here.
-- Rollback: database/supabase/rollbacks/20261104016000_sv1_sched_data_model.sql

DO $guard$
BEGIN
  IF to_regclass('public.cg_org_unit') IS NULL
     OR to_regprocedure('public.get_my_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'SV1-SCHED requires the neutral organization model and tenant helper'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

CREATE TABLE public.cg_schedule_bell_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  effective_from date NOT NULL,
  effective_until date,
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (tenant_id, org_unit_id, name, effective_from),
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT,
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE TABLE public.cg_schedule_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  bell_schedule_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 32),
  period_kind text NOT NULL CHECK (period_kind IN ('activity', 'break')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  UNIQUE (id, tenant_id, org_unit_id, bell_schedule_id),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (bell_schedule_id, day_of_week, period_number),
  FOREIGN KEY (bell_schedule_id, tenant_id, org_unit_id)
    REFERENCES public.cg_schedule_bell_schedule (id, tenant_id, org_unit_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT,
  CHECK (ends_at > starts_at)
);

CREATE TABLE public.cg_schedule_room (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  room_ref text NOT NULL CHECK (length(btrim(room_ref)) BETWEEN 1 AND 160),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  room_type text NOT NULL CHECK (length(btrim(room_type)) BETWEEN 1 AND 64),
  capacity integer NOT NULL CHECK (capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (tenant_id, org_unit_id, room_ref),
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE public.cg_schedule_teaching_load (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  schedule_ref text NOT NULL CHECK (length(btrim(schedule_ref)) BETWEEN 1 AND 160),
  class_arm_ref text NOT NULL CHECK (length(btrim(class_arm_ref)) BETWEEN 1 AND 160),
  subject_ref text NOT NULL CHECK (length(btrim(subject_ref)) BETWEEN 1 AND 160),
  periods_per_week smallint NOT NULL CHECK (periods_per_week BETWEEN 1 AND 64),
  required_capacity integer NOT NULL CHECK (required_capacity > 0),
  required_room_type text CHECK (
    required_room_type IS NULL OR length(btrim(required_room_type)) BETWEEN 1 AND 64
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (tenant_id, org_unit_id, schedule_ref, class_arm_ref, subject_ref),
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE public.cg_schedule_participant_qualification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  participant_ref text NOT NULL CHECK (length(btrim(participant_ref)) BETWEEN 1 AND 160),
  subject_ref text NOT NULL CHECK (length(btrim(subject_ref)) BETWEEN 1 AND 160),
  qualification_ref text NOT NULL CHECK (length(btrim(qualification_ref)) BETWEEN 1 AND 160),
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (tenant_id, org_unit_id, participant_ref, subject_ref),
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE public.cg_schedule_participant_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  participant_ref text NOT NULL CHECK (length(btrim(participant_ref)) BETWEEN 1 AND 160),
  period_id uuid NOT NULL,
  availability_state text NOT NULL CHECK (
    availability_state IN ('preferred', 'allowed', 'unavailable', 'mandatory')
  ),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (tenant_id, org_unit_id, participant_ref, period_id),
  FOREIGN KEY (period_id, tenant_id, org_unit_id)
    REFERENCES public.cg_schedule_period (id, tenant_id, org_unit_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE public.cg_schedule_constraint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  constraint_ref text NOT NULL CHECK (length(btrim(constraint_ref)) BETWEEN 1 AND 160),
  constraint_kind text NOT NULL CHECK (constraint_kind IN ('hard', 'soft')),
  constraint_type text NOT NULL CHECK (length(btrim(constraint_type)) BETWEEN 1 AND 80),
  scope_kind text NOT NULL CHECK (
    scope_kind IN ('organization', 'class_arm', 'subject', 'participant', 'room')
  ),
  scope_ref text,
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 100),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (tenant_id, org_unit_id, constraint_ref),
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT,
  CHECK (scope_ref IS NULL OR length(btrim(scope_ref)) BETWEEN 1 AND 160)
);

CREATE TABLE public.cg_schedule_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  schedule_ref text NOT NULL CHECK (length(btrim(schedule_ref)) BETWEEN 1 AND 160),
  version_number integer NOT NULL CHECK (version_number > 0),
  parent_version_id uuid,
  bell_schedule_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by text,
  published_at timestamptz,
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (id, tenant_id, org_unit_id, bell_schedule_id),
  UNIQUE (id, tenant_id, org_unit_id, schedule_ref),
  UNIQUE (tenant_id, org_unit_id, schedule_ref, version_number),
  FOREIGN KEY (bell_schedule_id, tenant_id, org_unit_id)
    REFERENCES public.cg_schedule_bell_schedule (id, tenant_id, org_unit_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_version_id, tenant_id, org_unit_id, schedule_ref)
    REFERENCES public.cg_schedule_version
      (id, tenant_id, org_unit_id, schedule_ref) ON DELETE RESTRICT,
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT,
  CHECK (parent_version_id IS NULL OR parent_version_id <> id),
  CHECK (
    (status = 'draft' AND published_by IS NULL AND published_at IS NULL)
    OR (
      status = 'published'
      AND published_by IS NOT NULL
      AND length(btrim(published_by)) BETWEEN 1 AND 160
      AND published_at IS NOT NULL
    )
  )
);

CREATE TABLE public.cg_schedule_placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  org_unit_id text NOT NULL,
  schedule_version_id uuid NOT NULL,
  schedule_ref text NOT NULL CHECK (length(btrim(schedule_ref)) BETWEEN 1 AND 160),
  bell_schedule_id uuid NOT NULL,
  period_id uuid NOT NULL,
  class_arm_ref text NOT NULL CHECK (length(btrim(class_arm_ref)) BETWEEN 1 AND 160),
  subject_ref text NOT NULL CHECK (length(btrim(subject_ref)) BETWEEN 1 AND 160),
  participant_ref text NOT NULL CHECK (length(btrim(participant_ref)) BETWEEN 1 AND 160),
  room_id uuid NOT NULL,
  explanation jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(explanation) = 'array'),
  soft_score numeric(5, 2) NOT NULL DEFAULT 0 CHECK (soft_score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, org_unit_id),
  UNIQUE (schedule_version_id, class_arm_ref, period_id),
  UNIQUE (schedule_version_id, participant_ref, period_id),
  UNIQUE (schedule_version_id, room_id, period_id),
  FOREIGN KEY (schedule_version_id, tenant_id, org_unit_id, bell_schedule_id)
    REFERENCES public.cg_schedule_version
      (id, tenant_id, org_unit_id, bell_schedule_id) ON DELETE RESTRICT,
  FOREIGN KEY (schedule_version_id, tenant_id, org_unit_id, schedule_ref)
    REFERENCES public.cg_schedule_version
      (id, tenant_id, org_unit_id, schedule_ref) ON DELETE RESTRICT,
  FOREIGN KEY (period_id, tenant_id, org_unit_id, bell_schedule_id)
    REFERENCES public.cg_schedule_period
      (id, tenant_id, org_unit_id, bell_schedule_id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id, tenant_id, org_unit_id)
    REFERENCES public.cg_schedule_room (id, tenant_id, org_unit_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, org_unit_id, schedule_ref, class_arm_ref, subject_ref)
    REFERENCES public.cg_schedule_teaching_load
      (tenant_id, org_unit_id, schedule_ref, class_arm_ref, subject_ref) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, org_unit_id, participant_ref, subject_ref)
    REFERENCES public.cg_schedule_participant_qualification
      (tenant_id, org_unit_id, participant_ref, subject_ref) ON DELETE RESTRICT,
  FOREIGN KEY (org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.cg_schedule_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published schedule versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cg_schedule_version_immutable
  BEFORE UPDATE OR DELETE ON public.cg_schedule_version
  FOR EACH ROW EXECUTE FUNCTION public.cg_schedule_version_immutable();

CREATE OR REPLACE FUNCTION public.cg_schedule_publication_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_has_load boolean;
BEGIN
  IF NEW.status = 'published' AND OLD.status = 'draft' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.cg_schedule_teaching_load
       WHERE tenant_id = NEW.tenant_id
         AND org_unit_id = NEW.org_unit_id
         AND schedule_ref = NEW.schedule_ref
    ) INTO v_has_load;
    IF NOT v_has_load OR EXISTS (
      SELECT 1
        FROM public.cg_schedule_teaching_load l
        LEFT JOIN public.cg_schedule_placement p
          ON p.schedule_version_id = NEW.id
         AND p.tenant_id = l.tenant_id
         AND p.org_unit_id = l.org_unit_id
         AND p.schedule_ref = l.schedule_ref
         AND p.class_arm_ref = l.class_arm_ref
         AND p.subject_ref = l.subject_ref
       WHERE l.tenant_id = NEW.tenant_id
         AND l.org_unit_id = NEW.org_unit_id
         AND l.schedule_ref = NEW.schedule_ref
       GROUP BY l.id, l.periods_per_week
      HAVING count(p.id) <> l.periods_per_week
    ) THEN
      RAISE EXCEPTION 'schedule cannot publish until every required activity is placed'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cg_schedule_publication_guard
  BEFORE UPDATE OF status ON public.cg_schedule_version
  FOR EACH ROW EXECUTE FUNCTION public.cg_schedule_publication_guard();

CREATE OR REPLACE FUNCTION public.cg_schedule_placement_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_period_kind text;
  v_required_capacity integer;
  v_required_room_type text;
  v_room_type text;
  v_room_capacity integer;
  v_version_id uuid;
  v_old_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO v_old_status
      FROM public.cg_schedule_version
     WHERE id = OLD.schedule_version_id
     FOR UPDATE;
    IF v_old_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'published schedule placements are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  v_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.schedule_version_id ELSE NEW.schedule_version_id END;
  SELECT status INTO v_status
    FROM public.cg_schedule_version
   WHERE id = v_version_id
   FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'placements may only be changed on a draft schedule version'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT period_kind INTO v_period_kind
    FROM public.cg_schedule_period
   WHERE id = NEW.period_id
     AND tenant_id = NEW.tenant_id
     AND org_unit_id = NEW.org_unit_id
     AND bell_schedule_id = NEW.bell_schedule_id;
  IF v_period_kind IS DISTINCT FROM 'activity' THEN
    RAISE EXCEPTION 'placements require an instructional period' USING ERRCODE = '23514';
  END IF;

  SELECT required_capacity, required_room_type
    INTO v_required_capacity, v_required_room_type
    FROM public.cg_schedule_teaching_load
   WHERE tenant_id = NEW.tenant_id
     AND org_unit_id = NEW.org_unit_id
     AND schedule_ref = NEW.schedule_ref
     AND class_arm_ref = NEW.class_arm_ref
     AND subject_ref = NEW.subject_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'placement has no matching teaching load'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.cg_schedule_participant_qualification
     WHERE tenant_id = NEW.tenant_id
       AND org_unit_id = NEW.org_unit_id
       AND participant_ref = NEW.participant_ref
       AND subject_ref = NEW.subject_ref
       AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'participant qualification is missing or expired'
      USING ERRCODE = '23514';
  END IF;

  SELECT room_type, capacity
    INTO v_room_type, v_room_capacity
    FROM public.cg_schedule_room
   WHERE id = NEW.room_id
     AND tenant_id = NEW.tenant_id
     AND org_unit_id = NEW.org_unit_id;
  IF v_room_capacity IS NULL
     OR v_room_capacity < v_required_capacity
     OR (v_required_room_type IS NOT NULL AND v_room_type <> v_required_room_type) THEN
    RAISE EXCEPTION 'room does not meet the teaching load capacity and type'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cg_schedule_participant_availability
     WHERE tenant_id = NEW.tenant_id
       AND org_unit_id = NEW.org_unit_id
       AND participant_ref = NEW.participant_ref
       AND period_id = NEW.period_id
       AND availability_state = 'unavailable'
  ) THEN
    RAISE EXCEPTION 'participant is unavailable during the selected period'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cg_schedule_placement_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cg_schedule_placement
  FOR EACH ROW EXECUTE FUNCTION public.cg_schedule_placement_guard();

CREATE OR REPLACE FUNCTION public.cg_schedule_period_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.bell_schedule_id::text || ':' || NEW.day_of_week::text, 16000)
  );
  IF EXISTS (
    SELECT 1
      FROM public.cg_schedule_period p
     WHERE p.bell_schedule_id = NEW.bell_schedule_id
       AND p.tenant_id = NEW.tenant_id
       AND p.org_unit_id = NEW.org_unit_id
       AND p.day_of_week = NEW.day_of_week
       AND p.id IS DISTINCT FROM NEW.id
       AND p.starts_at < NEW.ends_at
       AND NEW.starts_at < p.ends_at
  ) THEN
    RAISE EXCEPTION 'bell schedule periods may not overlap' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cg_schedule_period_overlap_guard
  BEFORE INSERT OR UPDATE ON public.cg_schedule_period
  FOR EACH ROW EXECUTE FUNCTION public.cg_schedule_period_overlap_guard();

DO $security$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'cg_schedule_bell_schedule',
    'cg_schedule_period',
    'cg_schedule_room',
    'cg_schedule_teaching_load',
    'cg_schedule_participant_qualification',
    'cg_schedule_participant_availability',
    'cg_schedule_constraint',
    'cg_schedule_version',
    'cg_schedule_placement'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = (SELECT public.get_my_tenant_id()))',
      v_table || '_tenant_read',
      v_table
    );
    EXECUTE format(
      'CREATE INDEX %I ON public.%I (tenant_id, org_unit_id)',
      v_table || '_tenant_org_idx',
      v_table
    );
  END LOOP;
END
$security$;

REVOKE ALL ON FUNCTION public.cg_schedule_version_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cg_schedule_publication_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cg_schedule_placement_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cg_schedule_period_overlap_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_schedule_version_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.cg_schedule_publication_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.cg_schedule_placement_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.cg_schedule_period_overlap_guard() TO service_role;
