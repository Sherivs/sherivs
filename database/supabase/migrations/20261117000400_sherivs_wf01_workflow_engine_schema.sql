-- =============================================================================
-- WF-01: workflow engine schema (Postgres-native engine, ADR-103)
-- =============================================================================
-- Status: applied to staging; production apply approved by the founder in writing on 2026-11-17
-- (14:04 WAT), applied from merged master after a fresh backup.
-- Rollback: database/supabase/rollbacks/20261117000400_sherivs_wf01_workflow_engine_schema.sql
-- Tests:    tests/integration/wf01-workflow-schema.local.sql
--
-- What this creates (all names neutral; nothing here names a vertical):
--   wf_definition       one row per workflow in an organization
--   wf_version          versioned graph; drafts are editable, published versions are immutable
--   wf_trigger_binding  what starts a workflow (event, schedule, webhook, manual)
--   wf_event            inbound event outbox, de-duplicated per organization
--   wf_run              one execution of a published version
--   wf_step_run         step history: attempts, idempotency key, retry time, lease for SKIP LOCKED
--   wf_run_event        append-only run timeline
--   wf_approval         organization-scoped human approvals (a person in the console only)
--   wf_can()            neutral permission wrapper over the existing permission catalog
--   wf_claim_due_steps() SKIP LOCKED claim, service role only (the runtime driver calls it)
--
-- Tenant key: org_id uuid, the canonical organization root id (ADR-102 option A, chosen by the
-- founder on 2026-11-17), the same key as audit_chain, usage_counters and the newer org-scoped
-- tables. Text kernel refs are resolved to org_id by the runtime through the existing 1:1 map;
-- they are never stored as the key here. Every child table carries org_id and reaches its parent
-- through a composite (org_id, id) foreign key, so a row can never point into another
-- organization. There is no foreign key to the organization table itself in this neutral file,
-- matching audit_chain; see ADR-103 for why and for the residual risk.
--
-- Access model:
--   anon            nothing.
--   authenticated   SELECT through RLS: members with workflows.view (or the existing org
--                   administrator rule), platform staff with platform.tenants.read (read only).
--                   INSERT/UPDATE only on definitions, draft versions and trigger bindings, for
--                   members with workflows.manage in that organization. No DELETE anywhere.
--                   Members cannot publish, start runs, write steps or decide approvals here.
--   service_role    the runtime; it binds org_id from stored rows, never from a payload.
-- Every table: RLS enabled and FORCED, explicit grants (ADR-101 private by default).
-- Audit: definition, version, trigger, run start/finish and approval changes append to
-- audit_chain with the same lock, hash and link rules as the existing writers.
-- =============================================================================

DO $prereq$
BEGIN
  IF to_regprocedure('public.has_permission(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.can_administer_org(uuid)') IS NULL
     OR to_regprocedure('public.has_platform_capability(text)') IS NULL
     OR to_regclass('public.audit_chain') IS NULL
     OR to_regprocedure('public.audit_chain_canonical_hash(text,bigint,timestamp with time zone,uuid,text,text,text,text,text,inet,text,text,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'WF-01: prerequisite permission, platform or audit objects are missing';
  END IF;
  IF to_regclass('public.wf_definition') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-01: already applied';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Neutral permission wrapper
-- -----------------------------------------------------------------------------
-- True only for a signed-in person who is an administrator of the organization under the
-- existing rule, or holds the named workflow permission there through the permission catalog.
-- The workflow permissions are added to the catalog by WF-02; until then only administrators
-- pass. Unknown permission names are refused. SECURITY INVOKER: it only calls existing helpers
-- that are already executable by authenticated.
CREATE FUNCTION public.wf_can(p_org uuid, p_perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT coalesce(
    p_org IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_perm IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve')
    AND (public.can_administer_org(p_org) OR public.has_permission(p_org, p_perm)),
    false);
$$;
COMMENT ON FUNCTION public.wf_can(uuid, text) IS
  'WF-01 / ADR-103: neutral workflow permission check (existing org administrator rule or the permission catalog). Signed-in people only.';

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE public.wf_definition (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  key                 text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description         text CHECK (description IS NULL OR length(description) <= 2000),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  current_version_id  uuid,
  max_concurrent_runs integer NOT NULL DEFAULT 10 CHECK (max_concurrent_runs BETWEEN 1 AND 100),
  max_runs_per_hour   integer NOT NULL DEFAULT 600 CHECK (max_runs_per_hour BETWEEN 1 AND 10000),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_definition_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_definition_org_key_uniq UNIQUE (org_id, key)
);

CREATE TABLE public.wf_version (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  definition_id         uuid NOT NULL,
  version               integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  state                 text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
  graph                 jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(graph) = 'object' AND pg_column_size(graph) <= 262144),
  graph_digest          text CHECK (graph_digest IS NULL OR graph_digest ~ '^[0-9a-f]{64}$'),
  max_steps_per_run     integer NOT NULL DEFAULT 200 CHECK (max_steps_per_run BETWEEN 1 AND 1000),
  max_run_depth         integer NOT NULL DEFAULT 5 CHECK (max_run_depth BETWEEN 0 AND 16),
  max_loop_iterations   integer NOT NULL DEFAULT 50 CHECK (max_loop_iterations BETWEEN 1 AND 1000),
  default_max_attempts  integer NOT NULL DEFAULT 5 CHECK (default_max_attempts BETWEEN 1 AND 25),
  run_timeout_seconds   integer NOT NULL DEFAULT 86400 CHECK (run_timeout_seconds BETWEEN 60 AND 2592000),
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  published_at          timestamptz,
  published_by          uuid,
  retired_at            timestamptz,
  CONSTRAINT wf_version_definition_fk FOREIGN KEY (org_id, definition_id)
    REFERENCES public.wf_definition (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_version_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_version_org_def_id_uniq UNIQUE (org_id, definition_id, id),
  CONSTRAINT wf_version_number_uniq UNIQUE (definition_id, version),
  CONSTRAINT wf_version_state_fields CHECK (
    (state = 'draft' AND published_at IS NULL AND retired_at IS NULL AND graph_digest IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL AND retired_at IS NULL AND graph_digest IS NOT NULL)
    OR (state = 'retired' AND published_at IS NOT NULL AND retired_at IS NOT NULL AND graph_digest IS NOT NULL))
);
-- At most one published version per workflow.
CREATE UNIQUE INDEX wf_version_one_published ON public.wf_version (definition_id) WHERE state = 'published';

ALTER TABLE public.wf_definition
  ADD CONSTRAINT wf_definition_current_version_fk FOREIGN KEY (org_id, id, current_version_id)
  REFERENCES public.wf_version (org_id, definition_id, id) ON DELETE RESTRICT;

CREATE TABLE public.wf_trigger_binding (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  definition_id          uuid NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('event', 'schedule', 'webhook', 'manual')),
  event_type             text CHECK (event_type IS NULL OR event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$'),
  schedule_cron          text CHECK (schedule_cron IS NULL OR schedule_cron ~ '^\S+( \S+){4}$'),
  schedule_timezone      text NOT NULL DEFAULT 'Africa/Lagos' CHECK (length(schedule_timezone) BETWEEN 1 AND 64),
  filter                 jsonb NOT NULL DEFAULT '{}'::jsonb
                         CHECK (jsonb_typeof(filter) = 'object' AND pg_column_size(filter) <= 16384),
  enabled                boolean NOT NULL DEFAULT false,
  dedupe_window_seconds  integer NOT NULL DEFAULT 300 CHECK (dedupe_window_seconds BETWEEN 0 AND 86400),
  max_fires_per_hour     integer NOT NULL DEFAULT 60 CHECK (max_fires_per_hour BETWEEN 1 AND 3600),
  next_fire_at           timestamptz,
  last_fired_at          timestamptz,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_trigger_binding_definition_fk FOREIGN KEY (org_id, definition_id)
    REFERENCES public.wf_definition (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_trigger_binding_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_trigger_binding_kind_fields CHECK (
    (kind = 'event' AND event_type IS NOT NULL AND schedule_cron IS NULL)
    OR (kind = 'schedule' AND schedule_cron IS NOT NULL AND event_type IS NULL)
    OR (kind IN ('webhook', 'manual') AND event_type IS NULL AND schedule_cron IS NULL))
);

CREATE TABLE public.wf_run (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  definition_id       uuid NOT NULL,
  version_id          uuid NOT NULL,
  trigger_binding_id  uuid,
  event_id            uuid,
  parent_run_id       uuid,
  idempotency_key     text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  depth               integer NOT NULL DEFAULT 0 CHECK (depth >= 0),
  max_depth           integer NOT NULL CHECK (max_depth BETWEEN 0 AND 16),
  step_count          integer NOT NULL DEFAULT 0 CHECK (step_count >= 0),
  max_steps           integer NOT NULL CHECK (max_steps BETWEEN 1 AND 1000),
  started_by          uuid,
  deadline_at         timestamptz NOT NULL,
  started_at          timestamptz,
  finished_at         timestamptz,
  error_code          text CHECK (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{1,63}$'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_run_version_fk FOREIGN KEY (org_id, definition_id, version_id)
    REFERENCES public.wf_version (org_id, definition_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_run_trigger_fk FOREIGN KEY (org_id, trigger_binding_id)
    REFERENCES public.wf_trigger_binding (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_run_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_run_parent_fk FOREIGN KEY (org_id, parent_run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_run_idempotency_uniq UNIQUE (org_id, idempotency_key),
  CONSTRAINT wf_run_depth_limit CHECK (depth <= max_depth),
  CONSTRAINT wf_run_step_limit CHECK (step_count <= max_steps),
  CONSTRAINT wf_run_not_own_parent CHECK (parent_run_id IS NULL OR parent_run_id <> id),
  CONSTRAINT wf_run_terminal_fields CHECK (
    (status IN ('succeeded', 'failed', 'cancelled', 'timed_out')) = (finished_at IS NOT NULL))
);

CREATE TABLE public.wf_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  event_type        text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$'),
  source            text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  dedupe_key        text NOT NULL CHECK (length(dedupe_key) BETWEEN 8 AND 200),
  subject_ref       text CHECK (subject_ref IS NULL OR length(subject_ref) <= 200),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 8192),
  causation_run_id  uuid,
  depth             integer NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 16),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'dispatched', 'ignored', 'dead')),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 25),
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  lease_owner       text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  lease_expires_at  timestamptz,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_event_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_event_dedupe_uniq UNIQUE (org_id, dedupe_key),
  CONSTRAINT wf_event_causation_fk FOREIGN KEY (org_id, causation_run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_event_lease_fields CHECK (
    (status = 'claimed') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

ALTER TABLE public.wf_run
  ADD CONSTRAINT wf_run_event_fk FOREIGN KEY (org_id, event_id)
  REFERENCES public.wf_event (org_id, id) ON DELETE RESTRICT;

CREATE TABLE public.wf_step_run (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  run_id            uuid NOT NULL,
  step_key          text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  iteration         integer NOT NULL DEFAULT 0 CHECK (iteration BETWEEN 0 AND 1000),
  kind              text NOT NULL CHECK (kind IN ('action', 'condition', 'wait', 'approval', 'ai', 'notify', 'subflow')),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'running', 'waiting', 'succeeded', 'failed', 'dead', 'skipped', 'cancelled')),
  attempt           integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts      integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  idempotency_key   text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  resume_at         timestamptz,
  timeout_seconds   integer NOT NULL DEFAULT 60 CHECK (timeout_seconds BETWEEN 1 AND 900),
  lease_owner       text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  lease_expires_at  timestamptz,
  input_ref         jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(input_ref) = 'object' AND pg_column_size(input_ref) <= 8192),
  output_ref        jsonb CHECK (output_ref IS NULL OR (jsonb_typeof(output_ref) = 'object' AND pg_column_size(output_ref) <= 8192)),
  error_code        text CHECK (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{1,63}$'),
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_step_run_run_fk FOREIGN KEY (org_id, run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_step_run_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_step_run_position_uniq UNIQUE (run_id, step_key, iteration),
  CONSTRAINT wf_step_run_idempotency_uniq UNIQUE (org_id, idempotency_key),
  CONSTRAINT wf_step_run_attempt_limit CHECK (attempt <= max_attempts),
  CONSTRAINT wf_step_run_lease_fields CHECK (
    (status IN ('claimed', 'running')) = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT wf_step_run_wait_fields CHECK (status <> 'waiting' OR resume_at IS NOT NULL OR kind = 'approval'),
  CONSTRAINT wf_step_run_terminal_fields CHECK (
    (status IN ('succeeded', 'failed', 'dead', 'skipped', 'cancelled')) = (finished_at IS NOT NULL))
);

CREATE TABLE public.wf_run_event (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       uuid NOT NULL,
  run_id       uuid NOT NULL,
  step_run_id  uuid,
  kind         text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]{1,63}$'),
  actor_kind   text NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  actor_ref    text NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 128),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
               CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 8192),
  at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_run_event_run_fk FOREIGN KEY (org_id, run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_run_event_step_fk FOREIGN KEY (org_id, step_run_id)
    REFERENCES public.wf_step_run (org_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.wf_approval (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  run_id               uuid NOT NULL,
  step_run_id          uuid NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  required_permission  text NOT NULL DEFAULT 'workflows.approve'
                       CHECK (required_permission IN ('workflows.approve', 'workflows.manage')),
  risk                 text NOT NULL DEFAULT 'normal' CHECK (risk IN ('normal', 'high')),
  summary              text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 500),
  requested_by_kind    text NOT NULL CHECK (requested_by_kind IN ('user', 'agent', 'system')),
  requested_by_ref     text NOT NULL CHECK (length(requested_by_ref) BETWEEN 1 AND 128),
  requested_at         timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  decided_by           uuid,
  decided_at           timestamptz,
  decision_channel     text CHECK (decision_channel IS NULL OR decision_channel = 'console'),
  decision_note        text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_approval_run_fk FOREIGN KEY (org_id, run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_approval_step_fk FOREIGN KEY (org_id, step_run_id)
    REFERENCES public.wf_step_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_approval_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_approval_expiry_window CHECK (
    expires_at > requested_at AND expires_at <= requested_at + interval '30 days'),
  -- Only a person, in the console, decides. Phone, WhatsApp, SMS, email and agents never do.
  CONSTRAINT wf_approval_decision_fields CHECK (
    (status IN ('approved', 'rejected'))
      = (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_channel = 'console')),
  -- Separation of duties: a person cannot approve their own request.
  CONSTRAINT wf_approval_not_self CHECK (
    decided_by IS NULL OR requested_by_kind <> 'user' OR requested_by_ref <> decided_by::text)
);
CREATE UNIQUE INDEX wf_approval_one_pending_per_step ON public.wf_approval (step_run_id) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 3. Indexes (claiming, tenant reads, foreign keys)
-- -----------------------------------------------------------------------------
CREATE INDEX wf_definition_org_status_idx   ON public.wf_definition (org_id, status);
CREATE INDEX wf_version_org_def_idx          ON public.wf_version (org_id, definition_id, version DESC);
CREATE INDEX wf_trigger_binding_def_idx      ON public.wf_trigger_binding (org_id, definition_id);
CREATE INDEX wf_trigger_binding_event_idx    ON public.wf_trigger_binding (org_id, event_type) WHERE enabled AND kind = 'event';
CREATE INDEX wf_trigger_binding_due_idx      ON public.wf_trigger_binding (next_fire_at) WHERE enabled AND kind = 'schedule';
CREATE INDEX wf_event_claim_idx              ON public.wf_event (next_attempt_at) WHERE status = 'pending';
CREATE INDEX wf_event_lease_idx              ON public.wf_event (lease_expires_at) WHERE status = 'claimed';
CREATE INDEX wf_event_org_type_idx           ON public.wf_event (org_id, event_type, occurred_at DESC);
CREATE INDEX wf_event_causation_idx          ON public.wf_event (org_id, causation_run_id) WHERE causation_run_id IS NOT NULL;
CREATE INDEX wf_run_org_status_idx           ON public.wf_run (org_id, status, created_at DESC);
CREATE INDEX wf_run_def_idx                  ON public.wf_run (org_id, definition_id, created_at DESC);
CREATE INDEX wf_run_version_idx              ON public.wf_run (org_id, definition_id, version_id);
CREATE INDEX wf_run_trigger_idx              ON public.wf_run (org_id, trigger_binding_id) WHERE trigger_binding_id IS NOT NULL;
CREATE INDEX wf_run_event_ref_idx            ON public.wf_run (org_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX wf_run_parent_idx               ON public.wf_run (org_id, parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX wf_run_deadline_idx             ON public.wf_run (deadline_at) WHERE status IN ('queued', 'running', 'waiting');
CREATE INDEX wf_step_run_claim_idx           ON public.wf_step_run (next_attempt_at) WHERE status = 'pending';
CREATE INDEX wf_step_run_lease_idx           ON public.wf_step_run (lease_expires_at) WHERE status IN ('claimed', 'running');
CREATE INDEX wf_step_run_resume_idx          ON public.wf_step_run (resume_at) WHERE status = 'waiting';
CREATE INDEX wf_step_run_run_idx             ON public.wf_step_run (org_id, run_id, created_at);
CREATE INDEX wf_run_event_run_idx            ON public.wf_run_event (org_id, run_id, id);
CREATE INDEX wf_run_event_step_idx           ON public.wf_run_event (org_id, step_run_id) WHERE step_run_id IS NOT NULL;
CREATE INDEX wf_approval_org_status_idx      ON public.wf_approval (org_id, status, expires_at);
CREATE INDEX wf_approval_run_idx             ON public.wf_approval (org_id, run_id);
CREATE INDEX wf_approval_step_idx            ON public.wf_approval (org_id, step_run_id);
CREATE INDEX wf_approval_expiry_idx          ON public.wf_approval (expires_at) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 4. Guards
-- -----------------------------------------------------------------------------
-- Common: ids and org_id never change; updated_at is the server's; the creating person is
-- stamped from the session, never taken from the client.
CREATE FUNCTION public.wf_guard_row()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION '%: id and org_id are immutable', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_definition_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL AND NEW.current_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'wf_definition: a person cannot set the current version' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'wf_definition: key and creation fields are immutable' USING ERRCODE = '42501';
    END IF;
    -- Activating a version is a publish decision: only the service (the publish path) may do it.
    IF auth.uid() IS NOT NULL AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
      RAISE EXCEPTION 'wf_definition: a person cannot change the current version' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.current_version_id IS NOT NULL THEN
    SELECT state INTO v_state FROM public.wf_version WHERE id = NEW.current_version_id;
    IF v_state IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'wf_definition: the current version must be published' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Drafts are editable; published versions are immutable except published -> retired.
-- Publishing (draft -> published) is the service's job and stamps the digest and time.
CREATE FUNCTION public.wf_version_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION 'wf_version: published versions are never deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'wf_version: a version starts as a draft' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.definition_id IS DISTINCT FROM OLD.definition_id OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'wf_version: identity fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.state = 'draft' THEN
    IF NEW.state = 'draft' THEN
      NEW.published_at := NULL; NEW.published_by := NULL; NEW.graph_digest := NULL; NEW.retired_at := NULL;
      RETURN NEW;
    ELSIF NEW.state = 'published' THEN
      IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'wf_version: publishing goes through the service publish path' USING ERRCODE = '42501';
      END IF;
      NEW.published_at := now();
      NEW.graph_digest := encode(sha256(convert_to(NEW.graph::text, 'UTF8')), 'hex');
      NEW.retired_at := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'wf_version: a draft can only be published' USING ERRCODE = '42501';
  END IF;
  -- OLD.state is published or retired: nothing may change except published -> retired.
  IF OLD.state = 'published' AND NEW.state = 'retired' AND auth.uid() IS NULL
     AND (NEW.graph, NEW.graph_digest, NEW.max_steps_per_run, NEW.max_run_depth, NEW.max_loop_iterations,
          NEW.default_max_attempts, NEW.run_timeout_seconds, NEW.published_at, NEW.published_by)
         IS NOT DISTINCT FROM
         (OLD.graph, OLD.graph_digest, OLD.max_steps_per_run, OLD.max_run_depth, OLD.max_loop_iterations,
          OLD.default_max_attempts, OLD.run_timeout_seconds, OLD.published_at, OLD.published_by) THEN
    NEW.retired_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wf_version: published versions are immutable' USING ERRCODE = '42501';
END
$$;

CREATE FUNCTION public.wf_trigger_binding_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSIF NEW.definition_id IS DISTINCT FROM OLD.definition_id OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'wf_trigger_binding: definition, kind and creation fields are immutable' USING ERRCODE = '42501';
  END IF;
  -- Fire bookkeeping belongs to the runtime.
  IF auth.uid() IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.last_fired_at IS DISTINCT FROM OLD.last_fired_at) THEN
    NEW.last_fired_at := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.last_fired_at END;
  END IF;
  RETURN NEW;
END
$$;

-- A run executes a published version, inherits the version's limits, and cannot outgrow them.
CREATE FUNCTION public.wf_run_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v public.wf_version%ROWTYPE; v_parent public.wf_run%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v FROM public.wf_version WHERE id = NEW.version_id;
    IF v.state IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'wf_run: only a published version can run' USING ERRCODE = '23514';
    END IF;
    NEW.max_depth := least(coalesce(NEW.max_depth, v.max_run_depth), v.max_run_depth);
    NEW.max_steps := least(coalesce(NEW.max_steps, v.max_steps_per_run), v.max_steps_per_run);
    NEW.deadline_at := least(coalesce(NEW.deadline_at, now() + make_interval(secs => v.run_timeout_seconds)),
                             now() + make_interval(secs => v.run_timeout_seconds));
    IF NEW.parent_run_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.wf_run WHERE id = NEW.parent_run_id;
      NEW.depth := v_parent.depth + 1;
      NEW.max_depth := least(NEW.max_depth, v_parent.max_depth);
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.definition_id, NEW.version_id, NEW.trigger_binding_id, NEW.event_id, NEW.parent_run_id,
      NEW.idempotency_key, NEW.depth, NEW.max_depth, NEW.max_steps, NEW.started_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.definition_id, OLD.version_id, OLD.trigger_binding_id, OLD.event_id, OLD.parent_run_id,
      OLD.idempotency_key, OLD.depth, OLD.max_depth, OLD.max_steps, OLD.started_by, OLD.created_at) THEN
    RAISE EXCEPTION 'wf_run: identity and limit fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'wf_run: a finished run cannot change status' USING ERRCODE = '42501';
  END IF;
  IF NEW.step_count < OLD.step_count THEN
    RAISE EXCEPTION 'wf_run: step_count only grows' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_step_run_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.run_id, NEW.step_key, NEW.iteration, NEW.kind, NEW.idempotency_key, NEW.max_attempts, NEW.created_at)
     IS DISTINCT FROM
     (OLD.run_id, OLD.step_key, OLD.iteration, OLD.kind, OLD.idempotency_key, OLD.max_attempts, OLD.created_at) THEN
    RAISE EXCEPTION 'wf_step_run: identity fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.attempt < OLD.attempt THEN
    RAISE EXCEPTION 'wf_step_run: attempt only grows' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('succeeded', 'dead', 'skipped', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'wf_step_run: a finished step cannot change status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'wf_approval: an approval starts pending' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wf_step_run s
                    WHERE s.id = NEW.step_run_id AND s.run_id = NEW.run_id AND s.kind = 'approval') THEN
      RAISE EXCEPTION 'wf_approval: the step must be an approval step of the same run' USING ERRCODE = '23514';
    END IF;
    NEW.requested_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.run_id, NEW.step_run_id, NEW.required_permission, NEW.risk, NEW.summary, NEW.requested_by_kind,
      NEW.requested_by_ref, NEW.requested_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.run_id, OLD.step_run_id, OLD.required_permission, OLD.risk, OLD.summary, OLD.requested_by_kind,
      OLD.requested_by_ref, OLD.requested_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'wf_approval: request fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'wf_approval: a decided approval is final' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('approved', 'rejected') AND now() >= OLD.expires_at THEN
    RAISE EXCEPTION 'wf_approval: the approval has expired' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER wf_definition_00_row BEFORE UPDATE ON public.wf_definition FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_definition_10_guard BEFORE INSERT OR UPDATE ON public.wf_definition FOR EACH ROW EXECUTE FUNCTION public.wf_definition_guard();
CREATE TRIGGER wf_version_00_row BEFORE UPDATE ON public.wf_version FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_version_10_guard BEFORE INSERT OR UPDATE OR DELETE ON public.wf_version FOR EACH ROW EXECUTE FUNCTION public.wf_version_guard();
CREATE TRIGGER wf_trigger_binding_00_row BEFORE UPDATE ON public.wf_trigger_binding FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_trigger_binding_10_guard BEFORE INSERT OR UPDATE ON public.wf_trigger_binding FOR EACH ROW EXECUTE FUNCTION public.wf_trigger_binding_guard();
CREATE TRIGGER wf_event_00_row BEFORE UPDATE ON public.wf_event FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_run_00_row BEFORE UPDATE ON public.wf_run FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_run_10_guard BEFORE INSERT OR UPDATE ON public.wf_run FOR EACH ROW EXECUTE FUNCTION public.wf_run_guard();
CREATE TRIGGER wf_step_run_00_row BEFORE UPDATE ON public.wf_step_run FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_step_run_10_guard BEFORE INSERT OR UPDATE ON public.wf_step_run FOR EACH ROW EXECUTE FUNCTION public.wf_step_run_guard();
CREATE TRIGGER wf_approval_00_row BEFORE UPDATE ON public.wf_approval FOR EACH ROW EXECUTE FUNCTION public.wf_guard_row();
CREATE TRIGGER wf_approval_10_guard BEFORE INSERT OR UPDATE ON public.wf_approval FOR EACH ROW EXECUTE FUNCTION public.wf_approval_guard();
CREATE TRIGGER wf_run_event_no_mutation BEFORE UPDATE OR DELETE ON public.wf_run_event FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE TRIGGER wf_run_event_no_truncate BEFORE TRUNCATE ON public.wf_run_event FOR EACH STATEMENT EXECUTE FUNCTION public.wf_append_only();

-- -----------------------------------------------------------------------------
-- 5. Audit: append to audit_chain (same lock 7013, link and hash as the existing writers)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_audit_append(
  p_org uuid, p_action text, p_target_type text, p_target_id text, p_before jsonb, p_after jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_seq bigint;
  v_prev text;
  v_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_kind text := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END;
  v_actor text := coalesce(auth.uid()::text, 'service');
  v_before text := CASE WHEN p_before IS NULL THEN NULL ELSE encode(sha256(convert_to(p_before::text, 'UTF8')), 'hex') END;
  v_after text := CASE WHEN p_after IS NULL THEN NULL ELSE encode(sha256(convert_to(p_after::text, 'UTF8')), 'hex') END;
BEGIN
  IF p_org IS NULL OR p_action IS NULL THEN
    RAISE EXCEPTION 'wf_audit_append: org and action are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 7013));
  SELECT seq, entry_hash INTO v_seq, v_prev
    FROM public.audit_chain WHERE org_id = p_org ORDER BY seq DESC LIMIT 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  INSERT INTO public.audit_chain (
    org_id, seq, at, actor_kind, actor_id, action, target_type, target_id, ip, device,
    before_hash, after_hash, prev_hash, entry_hash
  ) VALUES (
    p_org, v_seq, v_at, v_kind, v_actor, p_action, p_target_type, p_target_id, NULL, NULL,
    v_before, v_after, v_prev,
    public.audit_chain_canonical_hash(
      v_prev, v_seq, v_at, p_org, v_kind, v_actor, p_action, p_target_type, p_target_id,
      NULL, NULL, v_before, v_after)
  );
END
$$;

-- Definer so the row trigger can reach the audit writer, which no client role may execute.
CREATE FUNCTION public.wf_audit_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_action text; v_new jsonb := to_jsonb(NEW); v_old jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  v_action := CASE TG_TABLE_NAME
    WHEN 'wf_definition' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'workflow.definition.created'
           WHEN v_new->>'current_version_id' IS DISTINCT FROM v_old->>'current_version_id' THEN 'workflow.definition.activated'
           ELSE 'workflow.definition.updated' END
    WHEN 'wf_version' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'workflow.version.created'
           WHEN v_new->>'state' IS DISTINCT FROM v_old->>'state' THEN 'workflow.version.' || (v_new->>'state')
           ELSE 'workflow.version.draft_updated' END
    WHEN 'wf_trigger_binding' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'workflow.trigger.created'
           WHEN v_new->>'enabled' IS DISTINCT FROM v_old->>'enabled' THEN
             CASE WHEN (v_new->>'enabled')::boolean THEN 'workflow.trigger.enabled' ELSE 'workflow.trigger.disabled' END
           WHEN v_new->>'last_fired_at' IS DISTINCT FROM v_old->>'last_fired_at'
                AND (v_new - 'last_fired_at' - 'next_fire_at' - 'updated_at')
                    = (v_old - 'last_fired_at' - 'next_fire_at' - 'updated_at') THEN NULL
           ELSE 'workflow.trigger.updated' END
    WHEN 'wf_run' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'workflow.run.created'
           WHEN v_new->>'status' IS DISTINCT FROM v_old->>'status'
                AND v_new->>'status' IN ('running', 'succeeded', 'failed', 'cancelled', 'timed_out')
                AND NOT (v_old->>'status' = 'waiting' AND v_new->>'status' = 'running')
             THEN 'workflow.run.' || (v_new->>'status')
           ELSE NULL END
    WHEN 'wf_approval' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'workflow.approval.requested'
           WHEN v_new->>'status' IS DISTINCT FROM v_old->>'status' THEN 'workflow.approval.' || (v_new->>'status')
           ELSE NULL END
  END;
  IF v_action IS NOT NULL THEN
    PERFORM public.wf_audit_append(NEW.org_id, v_action, TG_TABLE_NAME, NEW.id::text, v_old, v_new);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER wf_definition_90_audit AFTER INSERT OR UPDATE ON public.wf_definition FOR EACH ROW EXECUTE FUNCTION public.wf_audit_row();
CREATE TRIGGER wf_version_90_audit AFTER INSERT OR UPDATE ON public.wf_version FOR EACH ROW EXECUTE FUNCTION public.wf_audit_row();
CREATE TRIGGER wf_trigger_binding_90_audit AFTER INSERT OR UPDATE ON public.wf_trigger_binding FOR EACH ROW EXECUTE FUNCTION public.wf_audit_row();
CREATE TRIGGER wf_run_90_audit AFTER INSERT OR UPDATE ON public.wf_run FOR EACH ROW EXECUTE FUNCTION public.wf_audit_row();
CREATE TRIGGER wf_approval_90_audit AFTER INSERT OR UPDATE ON public.wf_approval FOR EACH ROW EXECUTE FUNCTION public.wf_audit_row();

-- -----------------------------------------------------------------------------
-- 6. SKIP LOCKED claim (service role only). The org of each claimed step is the stored one.
-- -----------------------------------------------------------------------------
-- Claims due pending steps and steps whose lease expired. A step that has used all its attempts
-- is marked dead instead of being claimed again. Several workers can call it at once.
CREATE FUNCTION public.wf_claim_due_steps(p_worker text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60)
RETURNS SETOF public.wf_step_run
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
        v_lease integer := least(greatest(coalesce(p_lease_seconds, 60), 5), 900);
BEGIN
  IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'wf_claim_due_steps: worker id is required' USING ERRCODE = '22023';
  END IF;

  -- Expired leases with no attempts left: dead, never re-run.
  UPDATE public.wf_step_run s
     SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, finished_at = now(),
         error_code = coalesce(s.error_code, 'lease.expired')
   WHERE s.id IN (SELECT x.id FROM public.wf_step_run x
                   WHERE x.status IN ('claimed', 'running') AND x.lease_expires_at <= now()
                     AND x.attempt >= x.max_attempts
                   ORDER BY x.lease_expires_at
                   LIMIT v_limit
                   FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  WITH due_pending AS (
    SELECT x.id FROM public.wf_step_run x
     WHERE x.status = 'pending' AND x.next_attempt_at <= now() AND x.attempt < x.max_attempts
     ORDER BY x.next_attempt_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), due_expired AS (
    SELECT x.id FROM public.wf_step_run x
     WHERE x.status IN ('claimed', 'running') AND x.lease_expires_at <= now() AND x.attempt < x.max_attempts
     ORDER BY x.lease_expires_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), picked AS (
    SELECT id FROM (SELECT id FROM due_pending UNION SELECT id FROM due_expired) u LIMIT v_limit
  )
  UPDATE public.wf_step_run s
     SET status = 'claimed', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease),
         attempt = s.attempt + 1,
         started_at = coalesce(s.started_at, now())
    FROM picked
   WHERE s.id = picked.id
  RETURNING s.*;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Row-level security
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_definition      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_definition      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_version         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_version         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_trigger_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_trigger_binding FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_event           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_event           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_run             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_run             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_step_run        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_step_run        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_run_event       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_run_event       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval        FORCE ROW LEVEL SECURITY;

-- Reads: members of that organization with workflows.view; platform team read-only.
CREATE POLICY wf_definition_read ON public.wf_definition FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_version_read ON public.wf_version FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_trigger_binding_read ON public.wf_trigger_binding FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_event_read ON public.wf_event FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_run_read ON public.wf_run FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_step_run_read ON public.wf_step_run FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_run_event_read ON public.wf_run_event FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_approval_read ON public.wf_approval FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.wf_can(org_id, 'workflows.approve')
         OR public.has_platform_capability('platform.tenants.read'));

-- Writes by people: definitions, draft versions and trigger bindings, in their own organization,
-- with workflows.manage. The platform capability grants no write.
CREATE POLICY wf_definition_insert ON public.wf_definition FOR INSERT TO authenticated
  WITH CHECK (public.wf_can(org_id, 'workflows.manage'));
CREATE POLICY wf_definition_update ON public.wf_definition FOR UPDATE TO authenticated
  USING (public.wf_can(org_id, 'workflows.manage'))
  WITH CHECK (public.wf_can(org_id, 'workflows.manage'));
CREATE POLICY wf_version_insert ON public.wf_version FOR INSERT TO authenticated
  WITH CHECK (state = 'draft' AND public.wf_can(org_id, 'workflows.manage'));
CREATE POLICY wf_version_update ON public.wf_version FOR UPDATE TO authenticated
  USING (state = 'draft' AND public.wf_can(org_id, 'workflows.manage'))
  WITH CHECK (state = 'draft' AND public.wf_can(org_id, 'workflows.manage'));
CREATE POLICY wf_trigger_binding_insert ON public.wf_trigger_binding FOR INSERT TO authenticated
  WITH CHECK (public.wf_can(org_id, 'workflows.manage'));
CREATE POLICY wf_trigger_binding_update ON public.wf_trigger_binding FOR UPDATE TO authenticated
  USING (public.wf_can(org_id, 'workflows.manage'))
  WITH CHECK (public.wf_can(org_id, 'workflows.manage'));

-- -----------------------------------------------------------------------------
-- 8. Grants (private by default, ADR-101)
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.wf_definition, public.wf_version, public.wf_trigger_binding, public.wf_event,
  public.wf_run, public.wf_step_run, public.wf_run_event, public.wf_approval
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wf_definition, public.wf_version, public.wf_trigger_binding, public.wf_event,
  public.wf_run, public.wf_step_run, public.wf_run_event, public.wf_approval TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.wf_definition, public.wf_version, public.wf_trigger_binding TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wf_definition, public.wf_version, public.wf_trigger_binding,
  public.wf_event, public.wf_run, public.wf_step_run, public.wf_approval TO service_role;
GRANT DELETE ON TABLE public.wf_version TO service_role;
GRANT SELECT, INSERT ON TABLE public.wf_run_event TO service_role;

REVOKE ALL ON FUNCTION public.wf_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_can(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.wf_claim_due_steps(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_claim_due_steps(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.wf_audit_append(uuid, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wf_guard_row(), public.wf_definition_guard(), public.wf_version_guard(),
  public.wf_trigger_binding_guard(), public.wf_run_guard(), public.wf_step_run_guard(), public.wf_approval_guard(),
  public.wf_append_only(), public.wf_audit_row() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.wf_definition IS 'WF-01 / ADR-103: a workflow in one organization. Archive, never delete.';
COMMENT ON TABLE public.wf_version IS 'WF-01 / ADR-103: versioned workflow graph. Drafts are editable by managers; published versions are immutable (retire only).';
COMMENT ON TABLE public.wf_trigger_binding IS 'WF-01 / ADR-103: what starts a workflow. Disabled by default.';
COMMENT ON TABLE public.wf_event IS 'WF-01 / ADR-103: inbound event outbox, one row per (org, dedupe_key). Payload holds references, not personal data copies.';
COMMENT ON TABLE public.wf_run IS 'WF-01 / ADR-103: one execution of a published version, with depth and step limits.';
COMMENT ON TABLE public.wf_step_run IS 'WF-01 / ADR-103: step history with attempts, idempotency key, retry time and SKIP LOCKED lease.';
COMMENT ON TABLE public.wf_run_event IS 'WF-01 / ADR-103: append-only run timeline.';
COMMENT ON TABLE public.wf_approval IS 'WF-01 / ADR-103: organization-scoped approvals. Decided only by a person in the console; never by the requester or an agent.';
COMMENT ON FUNCTION public.wf_claim_due_steps(text, integer, integer) IS 'WF-01 / ADR-103: SKIP LOCKED claim of due steps, service role only.';
