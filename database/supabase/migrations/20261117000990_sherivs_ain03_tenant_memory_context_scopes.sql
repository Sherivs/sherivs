-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- AIN-03: tenant memory and context scopes, audited writes, retention (ADR-127).
-- Origin: Claude Code agent, mission AIN-03 (issue #476).
-- Stacked on AIN-02 (#475) -> AIN-01 (#473) -> WF-12 (#471) -> WF-08 (#469) -> WF-07 (#467) -> WF-06 (#455).
--
-- Version note: 20261117000990 sorts directly after AIN-02 (20261117000980) and before the M2a role catalogue
-- (20261117001000, PR #448). It is free on every open branch checked on 2026-11-20.
--
-- What this adds (all names neutral):
--   wf_memory_scope_kind      reviewed data: the four context scopes (organization, workflow, agent, run), each with its
--                             lifetime bounds, item cap and whether an agent may propose into it
--   wf_memory_item            one live row per (organization, scope, reference, key); value is a flat object of codes
--                             ('reference') or short text ('note'); every row expires
--   wf_memory_change          append-only ledger of every write, proposal, acceptance, rejection, retirement and purge
--                             (metadata and a hash, never content); each entry is also written to audit_chain
--   wf_memory_value_ok, wf_memory_org_item_cap, wf_memory_agent_daily_proposals   the value shape and the two cross-scope caps
--   wf_memory_item_guard      BEFORE INSERT OR UPDATE: the caps and every rule below, restated where no code path skips them
--   wf_memory_item_delete_guard, wf_memory_item_audit   deletion only by the purge; the ledger and audit entry for every change
--   wf_memory_put             service role: a person with workflows.manage writes (creates or replaces) a memory item
--   wf_memory_agent_propose   service role: an agent run PROPOSES an item into its own agent or run scope (always a note)
--   wf_memory_decide          service role: a person accepts or rejects a proposal
--   wf_memory_retire          service role: a person retires an item; its content is wiped
--   wf_memory_agent_read      service role: what an agent may read; refused while the AI route is closed (decision 3)
--   wf_memory_purge_expired   service role: the scheduled retention pass (skips organizations under legal hold)
--
-- What this does NOT do: no model call, no tenant data to any AI (wf_ai_route_approved() stays false and the agent read
-- path is closed behind it), no send, no change to any other tenant data, no UI. The service role has NO privilege on
-- wf_memory_item at all: the only paths to a stored value are the signed-in member's own RLS read and the functions.
-- An agent can never accept its own proposal and a proposal's content never changes after it is made.
--
-- Authority model (same as WF-07, WF-08, WF-12, AIN-01, AIN-02): SECURITY DEFINER, empty search_path, EXECUTE only to
-- service_role for the six entry points; the server passes the verified person (or the run of an agent), SQL binds it
-- (wf_act_as) and derives the organization from it.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_agent') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_definition') IS NULL
     OR to_regclass('public.wf_retention_run') IS NULL
     OR to_regclass('public.wf_autonomy_change') IS NULL
     OR to_regprocedure('public.wf_ai_route_approved()') IS NULL
     OR to_regprocedure('public.wf_agent_state_code(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.wf_retention_legal_hold(uuid)') IS NULL
     OR to_regprocedure('public.wf_append_only()') IS NULL
     OR to_regprocedure('public.wf_act_as(uuid)') IS NULL
     OR to_regprocedure('public.wf_act_restore(jsonb)') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL THEN
    RAISE EXCEPTION 'AIN-03: AIN-02, AIN-01 or WF-12 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_memory_item') IS NOT NULL
     OR to_regclass('public.wf_memory_change') IS NOT NULL
     OR to_regprocedure('public.wf_memory_put(uuid,text,text,text,text,jsonb,integer,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'AIN-03: tenant memory objects already exist';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Caps and the value shape (one place each)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_memory_org_item_cap()
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$ SELECT 2000 $$;

-- Proposals that are still waiting (not decided, not expired) are capped per organization on their own, and the
-- organization item cap counts only active items, so agents can never use up the room a person needs.
CREATE FUNCTION public.wf_memory_org_proposal_cap()
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$ SELECT 200 $$;

CREATE FUNCTION public.wf_memory_agent_daily_proposals()
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$ SELECT 50 $$;

-- A value is a flat object of 1 to 20 entries, at most 4096 bytes. Keys are lower-case words. A value is a boolean, a
-- number or a string; nothing nested, no list. In class 'reference' a string is an id or a code only (letters, digits and
-- _ . : / -, no spaces and no @), so a name, an address or a sentence cannot be stored there. In class 'note' a string is
-- short free text (1 to 300 characters) and is never readable by an agent.
CREATE FUNCTION public.wf_memory_value_ok(p_class text, p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT coalesce(
    p_class IN ('reference', 'note')
    AND jsonb_typeof(p_value) = 'object'
    AND octet_length(p_value::text) <= 4096
    AND (SELECT count(*) FROM jsonb_each(p_value)) BETWEEN 1 AND 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_value) e
       WHERE NOT (
         e.key ~ '^[a-z][a-z0-9_]{0,47}$'
         AND CASE jsonb_typeof(e.value)
               WHEN 'boolean' THEN true
               WHEN 'number' THEN true
               WHEN 'string' THEN
                 CASE p_class
                   WHEN 'reference' THEN (e.value #>> '{}') ~ '^[A-Za-z0-9_.:/-]{1,200}$'
                   ELSE length(e.value #>> '{}') BETWEEN 1 AND 300
                 END
               ELSE false
             END)),
    false)
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
-- The context scopes. 'organization' is shared by the whole organization, 'workflow' by one workflow (its key), 'agent' is
-- one agent's own notebook inside the organization, 'run' belongs to one run. Agents may propose only into 'agent' and
-- 'run' (a CHECK, so editing the data cannot widen it). Reviewed data; the lifetimes are engineering defaults for the
-- founder to ratify.
CREATE TABLE public.wf_memory_scope_kind (
  kind              text PRIMARY KEY CHECK (kind IN ('organization', 'workflow', 'agent', 'run')),
  default_ttl_days  integer NOT NULL CHECK (default_ttl_days BETWEEN 1 AND 1095),
  max_ttl_days      integer NOT NULL CHECK (max_ttl_days BETWEEN 1 AND 1095),
  max_items         integer NOT NULL CHECK (max_items BETWEEN 1 AND 1000),
  agent_may_propose boolean NOT NULL,
  label             text NOT NULL CHECK (length(btrim(label)) BETWEEN 3 AND 80),
  CONSTRAINT wf_memory_scope_kind_ttl_order CHECK (default_ttl_days <= max_ttl_days),
  CONSTRAINT wf_memory_scope_kind_agent_scopes CHECK (agent_may_propose = (kind IN ('agent', 'run')))
);

CREATE TABLE public.wf_memory_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.wf_org_settings (org_id) ON DELETE RESTRICT,
  scope_kind    text NOT NULL REFERENCES public.wf_memory_scope_kind (kind) ON DELETE RESTRICT,
  scope_ref     text NOT NULL DEFAULT '',
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  data_class    text NOT NULL CHECK (data_class IN ('reference', 'note')),
  value         jsonb NOT NULL,
  status        text NOT NULL CHECK (status IN ('proposed', 'active', 'retired')),
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  source_kind   text NOT NULL CHECK (source_kind IN ('person', 'agent')),
  source_person uuid,
  source_agent  text REFERENCES public.wf_agent (agent_ref) ON DELETE RESTRICT,
  -- No foreign key on the run: run retention (WF-12) deletes runs, and memory has its own, separate lifetime.
  source_run    uuid,
  decided_by    uuid,
  ai_readable   boolean NOT NULL DEFAULT false,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  retired_at    timestamptz,
  -- Per-item salt for the ledger hash of a note (set by the guard, gone when the row is retired or purged). A reference
  -- value never gets a hash at all.
  hash_salt     text,
  CONSTRAINT wf_memory_item_salt_shape CHECK (
    (data_class = 'note' AND status <> 'retired') = (hash_salt IS NOT NULL)),
  CONSTRAINT wf_memory_item_scope_ref CHECK (
    (scope_kind = 'organization' AND scope_ref = '')
    OR (scope_kind <> 'organization' AND scope_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$')),
  CONSTRAINT wf_memory_item_source CHECK (
    (source_kind = 'person' AND source_person IS NOT NULL AND source_agent IS NULL AND source_run IS NULL)
    OR (source_kind = 'agent' AND source_person IS NULL AND source_agent IS NOT NULL AND source_run IS NOT NULL)),
  -- A proposal is always the agent's; an accepted agent item always has the person who accepted it.
  CONSTRAINT wf_memory_item_status_shape CHECK (
    (status = 'proposed' AND source_kind = 'agent' AND decided_by IS NULL AND retired_at IS NULL)
    OR (status = 'active' AND retired_at IS NULL AND (source_kind = 'person' OR decided_by IS NOT NULL))
    OR (status = 'retired' AND retired_at IS NOT NULL)),
  -- A retired row keeps no content. Anything else must pass the value shape for its class.
  CONSTRAINT wf_memory_item_value_shape CHECK (
    (status = 'retired' AND value = '{}'::jsonb) OR (status <> 'retired' AND public.wf_memory_value_ok(data_class, value))),
  -- What an agent writes is a short note and is never readable by an agent; only a person's reference data can be.
  CONSTRAINT wf_memory_item_agent_notes CHECK (source_kind <> 'agent' OR (data_class = 'note' AND NOT ai_readable)),
  CONSTRAINT wf_memory_item_ai_readable CHECK (
    NOT ai_readable OR (data_class = 'reference' AND source_kind = 'person' AND status = 'active')),
  CONSTRAINT wf_memory_item_lifetime CHECK (expires_at > created_at)
);
-- One live row per key (a retired key can be written again).
CREATE UNIQUE INDEX wf_memory_item_live_key ON public.wf_memory_item (org_id, scope_kind, scope_ref, key)
  WHERE status <> 'retired';
CREATE INDEX wf_memory_item_scope_idx ON public.wf_memory_item (org_id, scope_kind, scope_ref) WHERE status <> 'retired';
CREATE INDEX wf_memory_item_expiry_idx ON public.wf_memory_item (expires_at);

CREATE TABLE public.wf_memory_change (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.wf_org_settings (org_id) ON DELETE RESTRICT,
  item_id      uuid NOT NULL,
  scope_kind   text NOT NULL,
  scope_ref    text NOT NULL,
  key          text NOT NULL,
  op           text NOT NULL CHECK (op IN ('write', 'update', 'propose', 'accept', 'reject', 'retire', 'purge')),
  actor_kind   text NOT NULL CHECK (actor_kind IN ('person', 'agent', 'system')),
  actor_person uuid,
  actor_agent  text,
  data_class   text NOT NULL,
  version      integer NOT NULL,
  value_sha256 text CHECK (value_sha256 IS NULL OR value_sha256 ~ '^[0-9a-f]{64}$'),
  txid         bigint NOT NULL DEFAULT txid_current(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_memory_change_actor CHECK (
    (actor_kind = 'person' AND actor_person IS NOT NULL AND actor_agent IS NULL)
    OR (actor_kind = 'agent' AND actor_agent IS NOT NULL AND actor_person IS NULL)
    OR (actor_kind = 'system' AND actor_person IS NULL AND actor_agent IS NULL)),
  -- A proposal is always the agent's; an acceptance, rejection or retirement is never an agent's.
  CONSTRAINT wf_memory_change_op_actor CHECK (
    (op = 'propose' AND actor_kind = 'agent')
    OR (op IN ('write', 'update', 'accept', 'reject') AND actor_kind = 'person')
    OR (op IN ('retire', 'purge') AND actor_kind IN ('person', 'system')))
);
CREATE INDEX wf_memory_change_org_idx ON public.wf_memory_change (org_id, created_at DESC);
CREATE INDEX wf_memory_change_item_idx ON public.wf_memory_change (org_id, item_id, created_at);
CREATE INDEX wf_memory_change_proposals_idx ON public.wf_memory_change (org_id, actor_agent, created_at DESC)
  WHERE op = 'propose';

-- -----------------------------------------------------------------------------
-- 3. Reviewed data
-- -----------------------------------------------------------------------------
-- BEGIN AIN03 SEED (kept in step with frontend/src/lib/workflow/tenant-memory.ts by tests/unit/ain03-tenant-memory.test.ts)
INSERT INTO public.wf_memory_scope_kind (kind, default_ttl_days, max_ttl_days, max_items, agent_may_propose, label) VALUES
  ('organization', 365, 1095, 300, false, 'Shared by the whole organization'),
  ('workflow', 180, 730, 200, false, 'Shared by one workflow'),
  ('agent', 90, 365, 200, true, 'One agent''s own notebook'),
  ('run', 7, 30, 50, true, 'One run only');
-- END AIN03 SEED

-- -----------------------------------------------------------------------------
-- 4. The write window (internal)
-- -----------------------------------------------------------------------------
-- The entry points open a transaction-local window that names who is writing; the guards refuse a write outside it and
-- the audit trigger reads the name from it. Both helpers are executable by nobody but the entry points' owner.
CREATE FUNCTION public.wf_memory_open(p_actor text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^(person:[0-9a-f-]{36}|agent:[a-z][a-z0-9_.:-]{1,127}|system)$' THEN
    RAISE EXCEPTION 'ain03:actor_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('ain03.writer', 'tx:' || txid_current()::text, true);
  PERFORM set_config('ain03.actor', p_actor, true);
END
$$;

CREATE FUNCTION public.wf_memory_close()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('ain03.writer', '', true);
  PERFORM set_config('ain03.actor', '', true);
  PERFORM set_config('ain03.purge', '', true);
END
$$;

-- -----------------------------------------------------------------------------
-- 5. Guards (INSERT, UPDATE and therefore every upsert; DELETE; TRUNCATE)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_memory_item_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_kind public.wf_memory_scope_kind%ROWTYPE;
  v_n integer;
BEGIN
  IF coalesce(current_setting('ain03.writer', true), '') <> 'tx:' || txid_current()::text THEN
    RAISE EXCEPTION 'ain03:write_only_through_the_memory_functions' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_kind FROM public.wf_memory_scope_kind k WHERE k.kind = NEW.scope_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ain03:scope_kind_unknown' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || NEW.org_id::text, 7127));
    NEW.hash_salt := CASE WHEN NEW.data_class = 'note' THEN gen_random_uuid()::text END;
    IF NEW.version <> 1 OR NEW.status = 'retired' THEN
      RAISE EXCEPTION 'ain03:a_new_item_starts_live_at_version_1' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = NEW.org_id AND s.workflows_enabled) THEN
      RAISE EXCEPTION 'ain03:workflows_disabled' USING ERRCODE = '42501';
    END IF;
    IF NEW.expires_at <= now() OR NEW.expires_at > now() + make_interval(days => v_kind.max_ttl_days) THEN
      RAISE EXCEPTION 'ain03:lifetime_out_of_bounds' USING ERRCODE = '23514';
    END IF;
    -- The scope must name something real in this organization.
    IF NEW.scope_kind = 'workflow' AND NOT EXISTS (
         SELECT 1 FROM public.wf_definition d WHERE d.org_id = NEW.org_id AND d.key = NEW.scope_ref) THEN
      RAISE EXCEPTION 'ain03:scope_reference_unknown' USING ERRCODE = '23503';
    ELSIF NEW.scope_kind = 'agent' AND NOT EXISTS (
         SELECT 1 FROM public.wf_agent a WHERE a.agent_ref = NEW.scope_ref) THEN
      RAISE EXCEPTION 'ain03:scope_reference_unknown' USING ERRCODE = '23503';
    ELSIF NEW.scope_kind = 'run' AND NOT EXISTS (
         SELECT 1 FROM public.wf_run r WHERE r.org_id = NEW.org_id AND r.id::text = NEW.scope_ref) THEN
      RAISE EXCEPTION 'ain03:scope_reference_unknown' USING ERRCODE = '23503';
    END IF;

    -- The writer named in the window must be the source the row claims (a person cannot be written as an agent or the reverse).
    IF coalesce(current_setting('ain03.actor', true), '') IS DISTINCT FROM
       (CASE NEW.source_kind WHEN 'person' THEN 'person:' || NEW.source_person::text ELSE 'agent:' || NEW.source_agent END) THEN
      RAISE EXCEPTION 'ain03:writer_is_not_the_source' USING ERRCODE = '42501';
    END IF;
    IF NEW.source_kind = 'agent' THEN
      IF NOT v_kind.agent_may_propose THEN
        RAISE EXCEPTION 'ain03:agent_cannot_write_this_scope' USING ERRCODE = '42501';
      END IF;
      IF NEW.status <> 'proposed' THEN
        RAISE EXCEPTION 'ain03:an_agent_only_proposes' USING ERRCODE = '42501';
      END IF;
      IF (NEW.scope_kind = 'agent' AND NEW.scope_ref IS DISTINCT FROM NEW.source_agent)
         OR (NEW.scope_kind = 'run' AND NEW.scope_ref IS DISTINCT FROM NEW.source_run::text) THEN
        RAISE EXCEPTION 'ain03:agent_writes_own_scope_only' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.wf_run r
                      WHERE r.org_id = NEW.org_id AND r.id = NEW.source_run AND r.agent_ref = NEW.source_agent
                        AND r.status IN ('queued', 'running', 'waiting')) THEN
        RAISE EXCEPTION 'ain03:run_not_active_for_agent' USING ERRCODE = '42501';
      END IF;
      IF public.wf_agent_state_code(NEW.org_id, NEW.source_agent) <> 'ok' THEN
        RAISE EXCEPTION 'ain03:agent_not_usable_here' USING ERRCODE = '42501';
      END IF;
      SELECT count(*) INTO v_n FROM public.wf_memory_change c
       WHERE c.org_id = NEW.org_id AND c.actor_agent = NEW.source_agent AND c.op = 'propose'
         AND c.created_at > now() - interval '24 hours';
      IF v_n >= public.wf_memory_agent_daily_proposals() THEN
        RAISE EXCEPTION 'ain03:agent_daily_proposals_exceeded' USING ERRCODE = '53400';
      END IF;
      SELECT count(*) INTO v_n FROM public.wf_memory_item i
       WHERE i.org_id = NEW.org_id AND i.status = 'proposed' AND i.expires_at > now();
      IF v_n >= public.wf_memory_org_proposal_cap() THEN
        RAISE EXCEPTION 'ain03:organization_proposals_full' USING ERRCODE = '53400';
      END IF;
    ELSIF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'ain03:a_person_writes_live_memory' USING ERRCODE = '23514';
    END IF;

    -- Only active items count against the scope and the organization (a waiting proposal has its own cap above), and
    -- a proposal is held to the scope cap too so an agent cannot pile up more than the scope can ever hold.
    SELECT count(*) INTO v_n FROM public.wf_memory_item i
     WHERE i.org_id = NEW.org_id AND i.scope_kind = NEW.scope_kind AND i.scope_ref = NEW.scope_ref
       AND i.expires_at > now()
       AND (i.status = 'active' OR (NEW.source_kind = 'agent' AND i.status = 'proposed'));
    IF v_n >= v_kind.max_items THEN
      RAISE EXCEPTION 'ain03:scope_is_full' USING ERRCODE = '53400';
    END IF;
    IF NEW.status = 'active' THEN
      SELECT count(*) INTO v_n FROM public.wf_memory_item i
       WHERE i.org_id = NEW.org_id AND i.status = 'active' AND i.expires_at > now();
      IF v_n >= public.wf_memory_org_item_cap() THEN
        RAISE EXCEPTION 'ain03:organization_is_full' USING ERRCODE = '53400';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE, including the update half of INSERT ... ON CONFLICT DO UPDATE.
  PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || NEW.org_id::text, 7127));
  IF (NEW.id, NEW.org_id, NEW.scope_kind, NEW.scope_ref, NEW.key, NEW.source_kind, NEW.source_person,
      NEW.source_agent, NEW.source_run, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.scope_kind, OLD.scope_ref, OLD.key, OLD.source_kind, OLD.source_person,
      OLD.source_agent, OLD.source_run, OLD.created_at) THEN
    RAISE EXCEPTION 'ain03:identity_is_immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'ain03:retired_is_terminal' USING ERRCODE = '42501';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'proposed' AND NEW.status IN ('active', 'retired'))
          OR (OLD.status = 'active' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'ain03:status_transition_refused' USING ERRCODE = '42501';
  END IF;
  -- Whatever changes, the version moves by exactly one; if nothing changes it stays.
  IF (NEW.status, NEW.value, NEW.data_class, NEW.ai_readable, NEW.expires_at, NEW.decided_by, NEW.retired_at)
     IS DISTINCT FROM
     (OLD.status, OLD.value, OLD.data_class, OLD.ai_readable, OLD.expires_at, OLD.decided_by, OLD.retired_at) THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'ain03:version_must_advance_by_one' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'ain03:version_moves_only_with_a_change' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  -- A legal hold (M12) freezes content: nothing is overwritten or wiped while it is active, by anyone, on any path.
  IF (NEW.value IS DISTINCT FROM OLD.value OR NEW.data_class IS DISTINCT FROM OLD.data_class OR NEW.status = 'retired')
     AND OLD.status <> 'retired' AND public.wf_retention_legal_hold(NEW.org_id) THEN
    RAISE EXCEPTION 'ain03:legal_hold_freezes_memory' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'retired' THEN
    -- Retiring wipes the content (the row's CHECK requires an empty value) and switches the AI flag off; the salt goes too.
    NEW.hash_salt := NULL;
    RETURN NEW;
  END IF;
  IF NEW.data_class = 'note' AND (NEW.value IS DISTINCT FROM OLD.value OR NEW.data_class IS DISTINCT FROM OLD.data_class) THEN
    NEW.hash_salt := gen_random_uuid()::text;
  ELSIF NEW.data_class <> 'note' THEN
    NEW.hash_salt := NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = NEW.org_id AND s.workflows_enabled) THEN
    RAISE EXCEPTION 'ain03:workflows_disabled' USING ERRCODE = '42501';
  END IF;
  IF OLD.expires_at <= now() THEN
    RAISE EXCEPTION 'ain03:expired_items_can_only_be_retired' USING ERRCODE = '42501';
  END IF;
  IF NEW.expires_at <= now() OR NEW.expires_at > now() + make_interval(days => v_kind.max_ttl_days) THEN
    RAISE EXCEPTION 'ain03:lifetime_out_of_bounds' USING ERRCODE = '23514';
  END IF;
  -- What an agent proposed is exactly what a person accepts or rejects: its content never changes.
  IF OLD.source_kind = 'agent' AND (NEW.value IS DISTINCT FROM OLD.value OR NEW.data_class IS DISTINCT FROM OLD.data_class
                                    OR NEW.ai_readable) THEN
    RAISE EXCEPTION 'ain03:agent_memory_content_is_fixed' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'proposed' AND NEW.status = 'active'
     AND (NEW.decided_by IS NULL OR coalesce(current_setting('ain03.actor', true), '') <> 'person:' || NEW.decided_by::text) THEN
    RAISE EXCEPTION 'ain03:acceptance_needs_a_person' USING ERRCODE = '42501';
  END IF;
  -- Accepting a proposal makes it active, so the active caps apply to it now.
  IF OLD.status = 'proposed' AND NEW.status = 'active' THEN
    SELECT count(*) INTO v_n FROM public.wf_memory_item i
     WHERE i.org_id = NEW.org_id AND i.scope_kind = NEW.scope_kind AND i.scope_ref = NEW.scope_ref
       AND i.status = 'active' AND i.expires_at > now();
    IF v_n >= v_kind.max_items THEN
      RAISE EXCEPTION 'ain03:scope_is_full' USING ERRCODE = '53400';
    END IF;
    SELECT count(*) INTO v_n FROM public.wf_memory_item i
     WHERE i.org_id = NEW.org_id AND i.status = 'active' AND i.expires_at > now();
    IF v_n >= public.wf_memory_org_item_cap() THEN
      RAISE EXCEPTION 'ain03:organization_is_full' USING ERRCODE = '53400';
    END IF;
  END IF;
  IF OLD.status = 'active' AND NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
    RAISE EXCEPTION 'ain03:decision_is_fixed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_memory_item_10_guard BEFORE INSERT OR UPDATE ON public.wf_memory_item
  FOR EACH ROW EXECUTE FUNCTION public.wf_memory_item_guard();

-- Deletion is the retention pass only: an expired row, or a row retired more than 30 days ago, inside the purge's own
-- transaction-local marker for that organization. TRUNCATE is refused.
CREATE FUNCTION public.wf_memory_item_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ain03:memory_is_never_truncated' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('ain03.purge', true), '') = 'org:' || OLD.org_id::text || ':' || txid_current()::text
     AND (OLD.expires_at <= now() OR (OLD.status = 'retired' AND OLD.retired_at < now() - interval '30 days'))
     AND NOT public.wf_retention_legal_hold(OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ain03:deletion_is_the_retention_pass_only' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER wf_memory_item_20_delete_guard BEFORE DELETE ON public.wf_memory_item
  FOR EACH ROW EXECUTE FUNCTION public.wf_memory_item_delete_guard();
CREATE TRIGGER wf_memory_item_20_no_truncate BEFORE TRUNCATE ON public.wf_memory_item
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_memory_item_delete_guard();

-- The ledger and the audit chain entry for every change, whatever path made it. Content never goes in: a hash only.
CREATE FUNCTION public.wf_memory_item_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := coalesce(current_setting('ain03.actor', true), '');
  v_row public.wf_memory_item%ROWTYPE;
  v_op text;
  v_kind text;
  v_person uuid;
  v_agent text;
  v_hash text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_op := 'purge';
    v_actor := 'system';
  ELSE
    v_row := NEW;
    IF TG_OP = 'INSERT' THEN
      v_op := CASE WHEN NEW.source_kind = 'person' THEN 'write' ELSE 'propose' END;
    ELSE
      IF (NEW.status, NEW.value, NEW.data_class, NEW.ai_readable, NEW.expires_at, NEW.decided_by)
         IS NOT DISTINCT FROM (OLD.status, OLD.value, OLD.data_class, OLD.ai_readable, OLD.expires_at, OLD.decided_by)
         AND NEW.retired_at IS NOT DISTINCT FROM OLD.retired_at THEN
        RETURN NULL;
      END IF;
      v_op := CASE
        WHEN NEW.status = 'retired' AND OLD.status = 'proposed' AND v_actor LIKE 'person:%' THEN 'reject'
        WHEN NEW.status = 'retired' THEN 'retire'
        WHEN OLD.status = 'proposed' AND NEW.status = 'active' THEN 'accept'
        ELSE 'update' END;
    END IF;
  END IF;
  IF v_actor LIKE 'person:%' THEN
    v_kind := 'person'; v_person := substr(v_actor, 8)::uuid;
  ELSIF v_actor LIKE 'agent:%' THEN
    v_kind := 'agent'; v_agent := substr(v_actor, 7);
  ELSIF v_actor = 'system' THEN
    v_kind := 'system';
  ELSE
    RAISE EXCEPTION 'ain03:no_actor_for_this_change' USING ERRCODE = '42501';
  END IF;
  -- A reference value (ids, codes, phone and national numbers) gets no hash: a hash of a short number can be recomputed.
  -- A note's hash is salted with the item's own salt, which is wiped on retirement and deleted with the row on purge.
  v_hash := CASE WHEN TG_OP = 'DELETE' OR v_row.status = 'retired' OR v_row.hash_salt IS NULL THEN NULL
                 ELSE encode(sha256(convert_to(v_row.hash_salt || ':' || v_row.value::text, 'UTF8')), 'hex') END;
  INSERT INTO public.wf_memory_change (org_id, item_id, scope_kind, scope_ref, key, op, actor_kind, actor_person,
                                       actor_agent, data_class, version, value_sha256)
  VALUES (v_row.org_id, v_row.id, v_row.scope_kind, v_row.scope_ref, v_row.key, v_op, v_kind, v_person, v_agent,
          v_row.data_class, v_row.version, v_hash);
  PERFORM public.wf_audit_append(v_row.org_id, 'workflow.memory.' || v_op, 'wf_memory_item', v_row.id::text, NULL,
    jsonb_build_object('scope', v_row.scope_kind, 'ref', v_row.scope_ref, 'key', v_row.key, 'class', v_row.data_class,
                       'version', v_row.version, 'value_sha256', v_hash, 'actor', v_actor));
  RETURN NULL;
END
$$;
CREATE TRIGGER wf_memory_item_90_audit AFTER INSERT OR UPDATE OR DELETE ON public.wf_memory_item
  FOR EACH ROW EXECUTE FUNCTION public.wf_memory_item_audit();

CREATE TRIGGER wf_memory_change_no_mutation BEFORE UPDATE OR DELETE ON public.wf_memory_change
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE TRIGGER wf_memory_change_no_truncate BEFORE TRUNCATE ON public.wf_memory_change
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_append_only();

-- -----------------------------------------------------------------------------
-- 6. A person writes, accepts, rejects and retires
-- -----------------------------------------------------------------------------
-- Create or replace one item. Needs workflows.manage in the person's own organization. A key held by an agent's proposal
-- is not overwritten by a person (retire it first), so a person never silently rewrites what an agent said.
CREATE FUNCTION public.wf_memory_put(
  p_actor uuid, p_scope_kind text, p_scope_ref text, p_key text, p_class text, p_value jsonb,
  p_ttl_days integer DEFAULT NULL, p_ai_readable boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_kind public.wf_memory_scope_kind%ROWTYPE;
  v_row public.wf_memory_item%ROWTYPE;
  v_ref text := coalesce(p_scope_ref, '');
  v_ttl integer;
  v_id uuid;
  v_version integer;
  v_exp timestamptz;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.manage') THEN
    RAISE EXCEPTION 'ain03:not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_class IS NULL OR p_class NOT IN ('reference', 'note') OR p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_.-]{1,95}$'
     OR p_value IS NULL OR NOT public.wf_memory_value_ok(p_class, p_value) OR p_ai_readable IS NULL THEN
    RAISE EXCEPTION 'ain03:invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_ai_readable AND p_class <> 'reference' THEN
    RAISE EXCEPTION 'ain03:only_reference_memory_can_be_ai_readable' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_kind FROM public.wf_memory_scope_kind k WHERE k.kind = p_scope_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ain03:invalid_request' USING ERRCODE = '22023';
  END IF;
  v_ttl := coalesce(p_ttl_days, v_kind.default_ttl_days);
  IF v_ttl NOT BETWEEN 1 AND v_kind.max_ttl_days THEN
    RAISE EXCEPTION 'ain03:lifetime_out_of_bounds' USING ERRCODE = '22023';
  END IF;
  v_exp := now() + make_interval(days => v_ttl);

  PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || v_org::text, 7127));
  PERFORM public.wf_memory_open('person:' || p_actor::text);
  SELECT * INTO v_row FROM public.wf_memory_item i
   WHERE i.org_id = v_org AND i.scope_kind = p_scope_kind AND i.scope_ref = v_ref AND i.key = p_key
     AND i.status <> 'retired' FOR UPDATE;
  IF FOUND THEN
    IF v_row.expires_at <= now() THEN
      -- An expired row only waits for the purge. A person's own is retired as that person; an agent's is retired by the
      -- system (as wf_memory_agent_propose does) so an expired proposal never blocks a person.
      IF v_row.source_kind <> 'person' THEN
        PERFORM public.wf_memory_close();
        PERFORM public.wf_memory_open('system');
      END IF;
      UPDATE public.wf_memory_item SET status = 'retired', value = '{}'::jsonb, ai_readable = false,
             retired_at = now(), version = v_row.version + 1 WHERE id = v_row.id;
      v_row.id := NULL;
      IF v_row.source_kind <> 'person' THEN
        PERFORM public.wf_memory_close();
        PERFORM public.wf_memory_open('person:' || p_actor::text);
      END IF;
    ELSIF v_row.source_kind <> 'person' THEN
      RAISE EXCEPTION 'ain03:key_held_by_agent_memory' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_row.id IS NOT NULL THEN
    UPDATE public.wf_memory_item
       SET data_class = p_class, value = p_value, ai_readable = p_ai_readable, expires_at = v_exp,
           version = v_row.version + 1
     WHERE id = v_row.id
    RETURNING id, version INTO v_id, v_version;
  ELSE
    INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind,
                                       source_person, ai_readable, expires_at)
    VALUES (v_org, p_scope_kind, v_ref, p_key, p_class, p_value, 'active', 'person', p_actor, p_ai_readable, v_exp)
    RETURNING id, version INTO v_id, v_version;
  END IF;
  PERFORM public.wf_memory_close();
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('id', v_id, 'version', v_version, 'status', 'active', 'expires_at', v_exp);
END
$$;

-- An agent run proposes one note into its own agent notebook or its own run scope. Only the run's own agent, only while
-- the run is active and the agent is usable here, never above the daily cap, never over a key that already exists. The
-- server passes the run the engine is executing; SQL takes the organization and the agent from that run, and the guard
-- checks the same facts again. A proposal does nothing until a person accepts it.
CREATE FUNCTION public.wf_memory_agent_propose(
  p_run uuid, p_scope_kind text, p_scope_ref text, p_key text, p_value jsonb, p_ttl_days integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run public.wf_run%ROWTYPE;
  v_kind public.wf_memory_scope_kind%ROWTYPE;
  v_row public.wf_memory_item%ROWTYPE;
  v_ref text;
  v_ttl integer;
  v_id uuid;
  v_exp timestamptz;
BEGIN
  IF p_run IS NULL OR p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_.-]{1,95}$'
     OR p_value IS NULL OR NOT public.wf_memory_value_ok('note', p_value) THEN
    RAISE EXCEPTION 'ain03:invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.wf_run r WHERE r.id = p_run;
  IF NOT FOUND OR v_run.agent_ref IS NULL THEN
    RAISE EXCEPTION 'ain03:run_not_active_for_agent' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_kind FROM public.wf_memory_scope_kind k WHERE k.kind = p_scope_kind;
  IF NOT FOUND OR NOT v_kind.agent_may_propose THEN
    RAISE EXCEPTION 'ain03:agent_cannot_write_this_scope' USING ERRCODE = '42501';
  END IF;
  v_ref := CASE p_scope_kind WHEN 'agent' THEN v_run.agent_ref ELSE p_run::text END;
  IF p_scope_ref IS NOT NULL AND p_scope_ref <> v_ref THEN
    RAISE EXCEPTION 'ain03:agent_writes_own_scope_only' USING ERRCODE = '42501';
  END IF;
  v_ttl := coalesce(p_ttl_days, v_kind.default_ttl_days);
  IF v_ttl NOT BETWEEN 1 AND v_kind.max_ttl_days THEN
    RAISE EXCEPTION 'ain03:lifetime_out_of_bounds' USING ERRCODE = '22023';
  END IF;
  v_exp := now() + make_interval(days => v_ttl);

  PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || v_run.org_id::text, 7127));
  PERFORM public.wf_memory_open('agent:' || v_run.agent_ref);
  SELECT * INTO v_row FROM public.wf_memory_item i
   WHERE i.org_id = v_run.org_id AND i.scope_kind = p_scope_kind AND i.scope_ref = v_ref AND i.key = p_key
     AND i.status <> 'retired' FOR UPDATE;
  IF FOUND THEN
    IF v_row.expires_at > now() THEN
      RAISE EXCEPTION 'ain03:key_exists' USING ERRCODE = '23505';
    END IF;
    -- An expired row only waits for the purge; it is retired here (by the system) so the key is free.
    PERFORM public.wf_memory_close();
    PERFORM public.wf_memory_open('system');
    UPDATE public.wf_memory_item SET status = 'retired', value = '{}'::jsonb, ai_readable = false,
           retired_at = now(), version = v_row.version + 1 WHERE id = v_row.id;
    PERFORM public.wf_memory_close();
    PERFORM public.wf_memory_open('agent:' || v_run.agent_ref);
  END IF;
  INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind,
                                     source_agent, source_run, ai_readable, expires_at)
  VALUES (v_run.org_id, p_scope_kind, v_ref, p_key, 'note', p_value, 'proposed', 'agent',
          v_run.agent_ref, p_run, false, v_exp)
  RETURNING id INTO v_id;
  PERFORM public.wf_memory_close();
  RETURN jsonb_build_object('id', v_id, 'status', 'proposed', 'expires_at', v_exp);
END
$$;

-- Accept or reject one proposal. Needs workflows.manage in the person's own organization; an item of another
-- organization is simply not found. An agent has no way to call this.
CREATE FUNCTION public.wf_memory_decide(p_actor uuid, p_item uuid, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_row public.wf_memory_item%ROWTYPE;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'ain03:invalid_request' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.manage') THEN
    RAISE EXCEPTION 'ain03:not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || v_org::text, 7127));
  SELECT * INTO v_row FROM public.wf_memory_item i WHERE i.org_id = v_org AND i.id = p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ain03:not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'proposed' THEN
    RAISE EXCEPTION 'ain03:not_a_pending_proposal' USING ERRCODE = '42501';
  END IF;
  IF v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'ain03:expired' USING ERRCODE = '42501';
  END IF;
  PERFORM public.wf_memory_open('person:' || p_actor::text);
  IF p_decision = 'accept' THEN
    UPDATE public.wf_memory_item SET status = 'active', decided_by = p_actor, version = v_row.version + 1
     WHERE id = v_row.id;
  ELSE
    UPDATE public.wf_memory_item SET status = 'retired', value = '{}'::jsonb, ai_readable = false, retired_at = now(),
           decided_by = p_actor, version = v_row.version + 1
     WHERE id = v_row.id;
  END IF;
  PERFORM public.wf_memory_close();
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('id', p_item, 'decision', p_decision);
END
$$;

CREATE FUNCTION public.wf_memory_retire(p_actor uuid, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_row public.wf_memory_item%ROWTYPE;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.manage') THEN
    RAISE EXCEPTION 'ain03:not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || v_org::text, 7127));
  SELECT * INTO v_row FROM public.wf_memory_item i WHERE i.org_id = v_org AND i.id = p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ain03:not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = 'retired' THEN
    RAISE EXCEPTION 'ain03:already_retired' USING ERRCODE = '42501';
  END IF;
  PERFORM public.wf_memory_open('person:' || p_actor::text);
  UPDATE public.wf_memory_item SET status = 'retired', value = '{}'::jsonb, ai_readable = false, retired_at = now(),
         version = v_row.version + 1
   WHERE id = v_row.id;
  PERFORM public.wf_memory_close();
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('id', p_item, 'status', 'retired');
END
$$;

-- -----------------------------------------------------------------------------
-- 7. What an agent may read (closed until founder decision 3)
-- -----------------------------------------------------------------------------
-- Memory is tenant data. Until the AI route is decided (wf_ai_route_approved(), AIN-01) no agent reads any of it: the
-- function refuses first. When a later reviewed migration opens the route, it still returns only a person's active,
-- unexpired, explicitly ai_readable REFERENCE items from the scopes this run belongs to: the organization, its own agent
-- notebook, the run's workflow and the run itself. Never a note, a proposal, another agent's notebook or another
-- organization's row.
CREATE FUNCTION public.wf_memory_agent_read(p_run uuid, p_scope_kind text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run public.wf_run%ROWTYPE;
  v_key text;
  v_out jsonb;
BEGIN
  IF NOT public.wf_ai_route_approved() THEN
    RAISE EXCEPTION 'ain03:ai_route_closed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_run FROM public.wf_run r
   WHERE r.id = p_run AND r.agent_ref IS NOT NULL AND r.status IN ('queued', 'running', 'waiting');
  IF NOT FOUND OR public.wf_agent_state_code(v_run.org_id, v_run.agent_ref) <> 'ok' THEN
    RAISE EXCEPTION 'ain03:run_not_active_for_agent' USING ERRCODE = '42501';
  END IF;
  SELECT d.key INTO v_key FROM public.wf_definition d WHERE d.org_id = v_run.org_id AND d.id = v_run.definition_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'scope_kind', x.scope_kind, 'scope_ref', x.scope_ref,
                                               'key', x.key, 'value', x.value, 'version', x.version)
                            ORDER BY x.scope_kind, x.key), '[]'::jsonb)
    INTO v_out
    FROM (SELECT i.* FROM public.wf_memory_item i
           WHERE i.org_id = v_run.org_id AND i.status = 'active' AND i.expires_at > now()
             AND i.ai_readable AND i.data_class = 'reference' AND i.source_kind = 'person'
             AND (p_scope_kind IS NULL OR i.scope_kind = p_scope_kind)
             AND ((i.scope_kind = 'organization')
               OR (i.scope_kind = 'agent' AND i.scope_ref = v_run.agent_ref)
               OR (i.scope_kind = 'workflow' AND i.scope_ref = v_key)
               OR (i.scope_kind = 'run' AND i.scope_ref = p_run::text))
           ORDER BY i.scope_kind, i.key
           LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  RETURN v_out;
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Retention
-- -----------------------------------------------------------------------------
-- Every item expires. An expired row is already invisible (the member policy and every function check expires_at); this
-- pass deletes it, and a row retired more than 30 days ago, a bounded batch per call. An organization under a legal hold
-- (M12) is skipped. The ledger and audit_chain are never touched. One organization failing does not stop the others.
CREATE FUNCTION public.wf_memory_purge_expired(p_max_rows integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_left integer := least(greatest(coalesce(p_max_rows, 500), 1), 1000);
  v_org uuid;
  v_n integer;
  v_total integer := 0;
  v_held integer := 0;
  v_failed integer := 0;
BEGIN
  -- Organizations under a legal hold are filtered out before the window is cut, so they can never fill it; the others are
  -- taken oldest-expiry first, so nobody waits behind a busy neighbour for ever.
  SELECT count(*) INTO v_held FROM (
    SELECT i.org_id FROM public.wf_memory_item i
     WHERE i.expires_at <= now() OR (i.status = 'retired' AND i.retired_at < now() - interval '30 days')
     GROUP BY i.org_id) h
   WHERE public.wf_retention_legal_hold(h.org_id);
  FOR v_org IN
    SELECT c.org_id FROM (
      SELECT i.org_id, min(i.expires_at) AS oldest FROM public.wf_memory_item i
       WHERE i.expires_at <= now() OR (i.status = 'retired' AND i.retired_at < now() - interval '30 days')
       GROUP BY i.org_id) c
     WHERE NOT public.wf_retention_legal_hold(c.org_id)
     ORDER BY c.oldest, c.org_id LIMIT 20
  LOOP
    EXIT WHEN v_left <= 0;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('ain03:' || v_org::text, 7127));
      PERFORM set_config('ain03.actor', 'system', true);
      PERFORM set_config('ain03.purge', 'org:' || v_org::text || ':' || txid_current()::text, true);
      WITH gone AS (
        DELETE FROM public.wf_memory_item
         WHERE id IN (SELECT i.id FROM public.wf_memory_item i
                       WHERE i.org_id = v_org
                         AND (i.expires_at <= now() OR (i.status = 'retired' AND i.retired_at < now() - interval '30 days'))
                       ORDER BY i.expires_at LIMIT v_left FOR UPDATE SKIP LOCKED)
        RETURNING 1)
      SELECT count(*) INTO v_n FROM gone;
      v_total := v_total + v_n;
      v_left := v_left - v_n;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
    PERFORM public.wf_memory_close();
  END LOOP;
  PERFORM public.wf_memory_close();
  RETURN jsonb_build_object('purged', v_total, 'skipped_legal_hold', v_held, 'failed', v_failed);
END
$$;

-- -----------------------------------------------------------------------------
-- 9. Row level security and privileges
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_memory_scope_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_memory_scope_kind FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_memory_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_memory_item FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_memory_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_memory_change FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.wf_memory_scope_kind, public.wf_memory_item, public.wf_memory_change
  FROM PUBLIC, anon, authenticated, service_role;
-- Nobody writes these tables at run time except through the definer functions. A member reads the live items of their own
-- organization through RLS and the ledger of it. The service role reads the reference data and the ledger, and has NO
-- privilege on wf_memory_item: the engine cannot read a stored value except through wf_memory_agent_read.
GRANT SELECT ON public.wf_memory_item, public.wf_memory_change TO authenticated;
GRANT SELECT ON public.wf_memory_scope_kind, public.wf_memory_change TO service_role;

CREATE POLICY wf_memory_scope_kind_service_read ON public.wf_memory_scope_kind FOR SELECT TO service_role USING (true);
CREATE POLICY wf_memory_item_member_read ON public.wf_memory_item FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') AND status <> 'retired' AND expires_at > now());
CREATE POLICY wf_memory_change_member_read ON public.wf_memory_change FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_memory_change_service_read ON public.wf_memory_change FOR SELECT TO service_role USING (true);

REVOKE ALL ON FUNCTION
  public.wf_memory_org_item_cap(), public.wf_memory_org_proposal_cap(), public.wf_memory_agent_daily_proposals(),
  public.wf_memory_value_ok(text, jsonb),
  public.wf_memory_open(text), public.wf_memory_close(), public.wf_memory_item_guard(),
  public.wf_memory_item_delete_guard(), public.wf_memory_item_audit(),
  public.wf_memory_put(uuid, text, text, text, text, jsonb, integer, boolean),
  public.wf_memory_agent_propose(uuid, text, text, text, jsonb, integer),
  public.wf_memory_decide(uuid, uuid, text), public.wf_memory_retire(uuid, uuid),
  public.wf_memory_agent_read(uuid, text, integer), public.wf_memory_purge_expired(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.wf_memory_put(uuid, text, text, text, text, jsonb, integer, boolean),
  public.wf_memory_agent_propose(uuid, text, text, text, jsonb, integer),
  public.wf_memory_decide(uuid, uuid, text), public.wf_memory_retire(uuid, uuid),
  public.wf_memory_agent_read(uuid, text, integer), public.wf_memory_purge_expired(integer)
  TO service_role;

COMMENT ON TABLE public.wf_memory_scope_kind IS
  'AIN-03 / ADR-127: the four context scopes with lifetime bounds, item cap and whether an agent may propose. Agents never propose into organization or workflow (CHECK). Engineering defaults for the founder to ratify.';
COMMENT ON TABLE public.wf_memory_item IS
  'AIN-03 / ADR-127: tenant memory. Written only through the wf_memory_* functions; every row expires; the service role has no privilege here. Reference class holds ids and codes only; note class is never readable by an agent.';
COMMENT ON TABLE public.wf_memory_change IS
  'AIN-03 / ADR-127: append-only ledger of every memory write, proposal, decision, retirement and purge (metadata and a hash, never content); mirrored in audit_chain.';
COMMENT ON FUNCTION public.wf_memory_agent_read(uuid, text, integer) IS
  'AIN-03 / ADR-127: the only agent read path for tenant memory. Refused while wf_ai_route_approved() is false (founder decision 3).';
COMMENT ON FUNCTION public.wf_memory_agent_propose(uuid, text, text, text, jsonb, integer) IS
  'AIN-03 / ADR-127: an agent run proposes a note into its own agent or run scope; nothing happens until a person accepts it.';

COMMIT;
