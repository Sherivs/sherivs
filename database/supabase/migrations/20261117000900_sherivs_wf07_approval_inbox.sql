-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- WF-07: tenant approval inbox, passkey step-up evidence and two-person approvals (ADR-122).
-- Origin: Claude Code agent, mission WF-07 (issue #466). Stacked on WF-06 (#455): it replaces
-- wf_action_draft_cap_check and links wf_action_draft.approval_id.
--
-- What this adds (all names neutral):
--   wf_approval_policy       per-organization approver counts and the two-person category list
--   wf_approval_step_up      single-use, 5-minute passkey step-up evidence bound to (approval, digest)
--   wf_approval_decision     one row per approver; append-only; the requester can never appear
--   wf_action_draft.approval_id (+ composite FK), freeze trigger, approval guard, new 'cancelled'
--   wf_action_sandbox_outbox.draft_id: the only way a capped draft reaches the sandbox outbox
--   wf_decide_approval()     the one decision path (service role only; the actor is verified in SQL)
--   expiry and run-cancellation handling, risk floor for capped step classes
--
-- Authority model: every function below is SECURITY DEFINER with an empty search_path, EXECUTE
-- revoked from PUBLIC, anon and authenticated, and granted to service_role only. The server passes
-- the signed-in person's id; the function binds that identity for the transaction (so has_permission,
-- wf_can and wf_audit_append see the person, not the service) and restores the previous claims
-- before it returns. A decision needs the catalogue permission named by the approval
-- (workflows.approve), not the administrator pass-through that wf_can grants for reads.
--
-- Mass communication threshold: WORKFLOW_MASS_RECIPIENT_THRESHOLD = 25 (unchanged, WF-06).
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.wf_action_template') IS NULL
     OR to_regclass('public.wf_webhook_target') IS NULL
     OR to_regclass('public.wf_approval') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_version') IS NULL
     OR to_regclass('public.wf_template') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.audit_chain') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.wf_approval_guard()') IS NULL
     OR to_regprocedure('public.wf_approval_sod_guard()') IS NULL
     OR to_regprocedure('public.wf_append_only()') IS NULL
     OR to_regprocedure('public.wf_runtime_settings_audit()') IS NULL
     OR to_regprocedure('public.wf_action_sandbox_outbox_guard()') IS NULL
     OR to_regprocedure('public.has_permission(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'WF-07: WF-01 through WF-06 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_approval_policy') IS NOT NULL
     OR to_regclass('public.wf_approval_step_up') IS NOT NULL
     OR to_regclass('public.wf_approval_decision') IS NOT NULL
     OR to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'wf_action_draft'
                   AND column_name = 'approval_id')
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'wf_action_sandbox_outbox'
                   AND column_name = 'draft_id') THEN
    RAISE EXCEPTION 'WF-07: one or more WF-07 objects already exist';
  END IF;
  -- The rollback restores WF-06's constraints byte for byte, so refuse to build on a drifted base.
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.wf_action_draft'::regclass AND conname = 'wf_action_draft_cap_check'
          AND pg_get_constraintdef(oid) LIKE '%unregistered_webhook%'
          AND pg_get_constraintdef(oid) NOT LIKE '%approval_id%')
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.wf_action_draft'::regclass AND conname = 'wf_action_draft_status_check'
          AND pg_get_constraintdef(oid) LIKE '%draft%approved%rejected%expired%'
          AND pg_get_constraintdef(oid) NOT LIKE '%cancelled%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.wf_action_sandbox_outbox'::regclass
                       AND conname IN ('wf_action_sandbox_cap_check', 'wf_action_sandbox_mass_check',
                                       'wf_action_sandbox_data_class_check')
                     HAVING count(*) = 3) THEN
    RAISE EXCEPTION 'WF-07: WF-06 draft or outbox constraints do not match the expected base';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_draft WHERE status = 'approved') THEN
    RAISE EXCEPTION 'WF-07: approved drafts exist without an approval record; resolve them first';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Category helpers (one definition of "capped", used by every guard below)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_is_capped_category(p_category text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT coalesce(p_category = ANY (ARRAY[
    'money_movement', 'safeguarding', 'credential_change', 'public_publish',
    'mass_message', 'external_authority_share'
  ]), false)
$$;

-- -----------------------------------------------------------------------------
-- 2. Per-organization approval policy (service role writes; audited)
-- -----------------------------------------------------------------------------
-- Defaults when no row exists: one approver for normal risk; two distinct approvers for money
-- movement, safeguarding and mass messages; one approver (with step-up) for the other capped
-- categories. Only the service role can change it, so an editor cannot relax their own review. An
-- organization may raise counts and add categories; money movement and safeguarding always stay on
-- the two-person list, and the two-person count never drops below 2.
CREATE TABLE public.wf_approval_policy (
  org_id                 uuid PRIMARY KEY REFERENCES public.wf_org_settings(org_id) ON DELETE RESTRICT,
  normal_required        smallint NOT NULL DEFAULT 1 CHECK (normal_required BETWEEN 1 AND 3),
  high_required          smallint NOT NULL DEFAULT 1 CHECK (high_required BETWEEN 1 AND 3),
  two_person_required    smallint NOT NULL DEFAULT 2 CHECK (two_person_required BETWEEN 2 AND 5),
  two_person_categories  text[] NOT NULL DEFAULT ARRAY['money_movement', 'safeguarding', 'mass_message']
    CHECK (
      array_position(two_person_categories, NULL) IS NULL
      AND two_person_categories <@ ARRAY[
        'money_movement', 'safeguarding', 'credential_change', 'public_publish',
        'mass_message', 'external_authority_share'
      ]::text[]
      -- Money movement and safeguarding are two-person in every organization; they cannot be removed.
      AND two_person_categories @> ARRAY['money_movement', 'safeguarding']::text[]
    ),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.wf_approval_policy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'wf_approval_policy: org_id is immutable' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_approval_policy_00_row BEFORE UPDATE ON public.wf_approval_policy
  FOR EACH ROW EXECUTE FUNCTION public.wf_approval_policy_guard();

CREATE FUNCTION public.wf_approval_required_count(p_org uuid, p_risk text, p_category text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_risk = 'high' AND coalesce(p_category = ANY (pol.two_person_categories), false)
      THEN pol.two_person_required
    WHEN p_risk = 'high' THEN pol.high_required
    ELSE pol.normal_required
  END::integer
  FROM (
    SELECT coalesce(p.normal_required, 1)::smallint AS normal_required,
           coalesce(p.high_required, 1)::smallint AS high_required,
           coalesce(p.two_person_required, 2)::smallint AS two_person_required,
           coalesce(p.two_person_categories, ARRAY['money_movement', 'safeguarding', 'mass_message'])
             AS two_person_categories
      FROM (SELECT 1) one
      LEFT JOIN public.wf_approval_policy p ON p.org_id = p_org
  ) pol
$$;

-- -----------------------------------------------------------------------------
-- 3. Step-up evidence and per-approver decisions
-- -----------------------------------------------------------------------------
-- The WebAuthn assertion itself is verified by the server (challenge bound to the approval id
-- and the content digest). This row records the verified result: single use, valid for at most
-- five minutes on the database clock.
CREATE TABLE public.wf_approval_step_up (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  approval_id     uuid NOT NULL,
  user_id         uuid NOT NULL,
  content_digest  text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  verified_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  revoked_at      timestamptz,
  CONSTRAINT wf_approval_step_up_approval_fk FOREIGN KEY (org_id, approval_id)
    REFERENCES public.wf_approval (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_approval_step_up_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_approval_step_up_window CHECK (
    expires_at > verified_at AND expires_at <= verified_at + interval '5 minutes'),
  CONSTRAINT wf_approval_step_up_one_end CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX wf_approval_step_up_one_open
  ON public.wf_approval_step_up (approval_id, user_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.wf_approval_decision (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  approval_id     uuid NOT NULL,
  approver_id     uuid NOT NULL,
  decision        text NOT NULL CHECK (decision IN ('approve', 'reject')),
  high_risk       boolean NOT NULL,
  step_up_id      uuid,
  content_digest  text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  note            text CHECK (note IS NULL OR length(note) <= 1000),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_approval_decision_approval_fk FOREIGN KEY (org_id, approval_id)
    REFERENCES public.wf_approval (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_approval_decision_step_up_fk FOREIGN KEY (org_id, step_up_id)
    REFERENCES public.wf_approval_step_up (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_approval_decision_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_approval_decision_once UNIQUE (approval_id, approver_id),
  -- Every approving vote on a high-risk item carries its own verified step-up.
  CONSTRAINT wf_approval_decision_step_up_required CHECK (
    NOT high_risk OR decision <> 'approve' OR step_up_id IS NOT NULL)
);
CREATE UNIQUE INDEX wf_approval_decision_step_up_once
  ON public.wf_approval_decision (step_up_id) WHERE step_up_id IS NOT NULL;
CREATE INDEX wf_approval_decision_approval_idx ON public.wf_approval_decision (org_id, approval_id);

-- Step-up rows only ever gain used_at or revoked_at, once.
CREATE FUNCTION public.wf_approval_step_up_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'wf_approval_step_up is append-only' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.approval_id, NEW.user_id, NEW.content_digest, NEW.verified_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.approval_id, OLD.user_id, OLD.content_digest, OLD.verified_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'wf_approval_step_up: evidence fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'wf_approval_step_up: a step-up is single use' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_approval_step_up_10_guard
  BEFORE UPDATE OR DELETE ON public.wf_approval_step_up
  FOR EACH ROW EXECUTE FUNCTION public.wf_approval_step_up_guard();
CREATE TRIGGER wf_approval_step_up_no_truncate
  BEFORE TRUNCATE ON public.wf_approval_step_up
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_approval_step_up_guard();

-- A decision row can only be written for a pending approval, by someone who is not the requester,
-- and (for an approving vote on a high-risk item) with a matching, consumed, fresh step-up.
CREATE FUNCTION public.wf_approval_decision_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_a public.wf_approval%ROWTYPE;
  v_started_by uuid;
  v_su public.wf_approval_step_up%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.wf_approval WHERE org_id = NEW.org_id AND id = NEW.approval_id;
  IF NOT FOUND OR v_a.status <> 'pending' OR now() >= v_a.expires_at THEN
    RAISE EXCEPTION 'wf_approval_decision: the approval is not open' USING ERRCODE = '42501';
  END IF;
  IF v_a.requested_by_kind = 'user' AND v_a.requested_by_ref = NEW.approver_id::text THEN
    RAISE EXCEPTION 'wf_approval_decision: the requester cannot decide' USING ERRCODE = '42501';
  END IF;
  SELECT r.started_by INTO v_started_by FROM public.wf_run r
   WHERE r.org_id = v_a.org_id AND r.id = v_a.run_id;
  IF v_started_by IS NOT NULL AND v_started_by = NEW.approver_id THEN
    RAISE EXCEPTION 'wf_approval_decision: the person who started the run cannot decide'
      USING ERRCODE = '42501';
  END IF;
  NEW.high_risk := (v_a.risk = 'high');
  NEW.decided_at := now();
  IF NEW.high_risk AND NEW.decision = 'approve' THEN
    SELECT * INTO v_su FROM public.wf_approval_step_up WHERE org_id = NEW.org_id AND id = NEW.step_up_id;
    IF NOT FOUND OR v_su.approval_id <> NEW.approval_id OR v_su.user_id <> NEW.approver_id
       OR v_su.content_digest <> NEW.content_digest OR v_su.used_at IS NULL
       OR v_su.revoked_at IS NOT NULL OR now() >= v_su.expires_at THEN
      RAISE EXCEPTION 'wf_approval_decision: the step-up is missing, stale or for other content'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_approval_decision_10_guard
  BEFORE INSERT ON public.wf_approval_decision
  FOR EACH ROW EXECUTE FUNCTION public.wf_approval_decision_guard();
CREATE TRIGGER wf_approval_decision_20_append_only
  BEFORE UPDATE OR DELETE ON public.wf_approval_decision
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE TRIGGER wf_approval_decision_no_truncate
  BEFORE TRUNCATE ON public.wf_approval_decision
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_append_only();

-- -----------------------------------------------------------------------------
-- 4. Link drafts to approvals; freeze drafts; replace the WF-06 cap constraint
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_action_draft ADD COLUMN approval_id uuid;
ALTER TABLE public.wf_action_draft
  ADD CONSTRAINT wf_action_draft_approval_fk FOREIGN KEY (org_id, approval_id)
  REFERENCES public.wf_approval (org_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX wf_action_draft_one_per_approval
  ON public.wf_action_draft (org_id, approval_id) WHERE approval_id IS NOT NULL;

ALTER TABLE public.wf_action_draft DROP CONSTRAINT wf_action_draft_status_check;
ALTER TABLE public.wf_action_draft ADD CONSTRAINT wf_action_draft_status_check
  CHECK (status IN ('draft', 'approved', 'rejected', 'expired', 'cancelled'));

-- WF-06 forbade status = 'approved' for the capped categories. WF-07 lets a draft be approved only
-- through a linked approval; the cross-table conditions live in the guard trigger below (a CHECK
-- cannot read another table), and this CHECK keeps the part a row can prove by itself.
ALTER TABLE public.wf_action_draft DROP CONSTRAINT wf_action_draft_cap_check;
ALTER TABLE public.wf_action_draft ADD CONSTRAINT wf_action_draft_cap_check CHECK (
  status <> 'approved'
  OR (approval_id IS NOT NULL AND category <> 'unregistered_webhook')
);

-- N1 (WF-06 review): only status, approval_id (set once) and updated_at may change, so a drafted
-- safeguarding message can never be relabelled and then approved.
CREATE FUNCTION public.wf_action_draft_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF (NEW.id, NEW.org_id, NEW.run_id, NEW.step_run_id, NEW.kind, NEW.category, NEW.template_ref,
      NEW.template_params, NEW.recipient_ids, NEW.audience_selector, NEW.data_class,
      NEW.webhook_target_id, NEW.idempotency_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.run_id, OLD.step_run_id, OLD.kind, OLD.category, OLD.template_ref,
      OLD.template_params, OLD.recipient_ids, OLD.audience_selector, OLD.data_class,
      OLD.webhook_target_id, OLD.idempotency_key, OLD.created_at) THEN
    RAISE EXCEPTION 'wf_action_draft: drafted content is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.approval_id IS NOT NULL AND NEW.approval_id IS DISTINCT FROM OLD.approval_id THEN
    RAISE EXCEPTION 'wf_action_draft: the approval link is set once' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'wf_action_draft: a decided draft is final' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- One place that says whether a draft's approval is complete (used by the draft and outbox guards).
-- Returns NULL when it is, otherwise a short reason code.
CREATE FUNCTION public.wf_draft_approval_gap(p_org uuid, p_draft uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_d public.wf_action_draft%ROWTYPE;
  v_a public.wf_approval%ROWTYPE;
  v_digest text;
  v_required integer;
BEGIN
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = p_org AND id = p_draft;
  IF NOT FOUND THEN RETURN 'draft_missing'; END IF;
  IF v_d.approval_id IS NULL THEN RETURN 'no_approval'; END IF;
  IF v_d.category = 'unregistered_webhook' THEN RETURN 'never_approvable'; END IF;
  SELECT * INTO v_a FROM public.wf_approval WHERE org_id = p_org AND id = v_d.approval_id;
  IF NOT FOUND OR v_a.run_id <> v_d.run_id THEN RETURN 'approval_mismatch'; END IF;
  IF v_a.status <> 'approved' OR v_a.decision_channel IS DISTINCT FROM 'console'
     OR v_a.decided_by IS NULL THEN
    RETURN 'approval_not_approved';
  END IF;
  IF public.wf_is_capped_category(v_d.category) AND v_a.risk <> 'high' THEN
    RETURN 'capped_needs_high_risk';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_approval_decision x
              WHERE x.approval_id = v_a.id AND x.decision = 'reject') THEN
    RETURN 'rejected_vote';
  END IF;
  v_required := public.wf_approval_required_count(p_org, v_a.risk, v_d.category);
  v_digest := public.wf_approval_content_digest(p_org, v_a.id);
  IF (SELECT count(DISTINCT x.approver_id) FROM public.wf_approval_decision x
       WHERE x.approval_id = v_a.id AND x.decision = 'approve'
         AND x.content_digest = v_digest
         AND (v_a.risk <> 'high' OR x.step_up_id IS NOT NULL)) < v_required THEN
    RETURN 'not_enough_approvers';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION public.wf_action_draft_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_a public.wf_approval%ROWTYPE;
  v_gap text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'wf_action_draft: a draft starts pending and unlinked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.approval_id IS NOT NULL AND NEW.approval_id IS DISTINCT FROM OLD.approval_id THEN
    SELECT * INTO v_a FROM public.wf_approval WHERE org_id = NEW.org_id AND id = NEW.approval_id;
    IF NOT FOUND OR v_a.run_id <> NEW.run_id OR v_a.status <> 'pending' THEN
      RAISE EXCEPTION 'wf_action_draft: the approval must be a pending approval of the same run'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_gap := public.wf_draft_approval_gap(NEW.org_id, NEW.id);
    IF v_gap IS NOT NULL THEN
      RAISE EXCEPTION 'wf_action_draft: cannot be approved (%)', v_gap USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_action_draft_10_freeze
  BEFORE UPDATE ON public.wf_action_draft
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_draft_freeze();
CREATE TRIGGER wf_action_draft_20_approval_guard
  BEFORE INSERT OR UPDATE ON public.wf_action_draft
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_draft_approval_guard();

-- -----------------------------------------------------------------------------
-- 5. The sandbox outbox: a capped draft reaches it only through its approved draft
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_action_sandbox_outbox ADD COLUMN draft_id uuid;
ALTER TABLE public.wf_action_sandbox_outbox
  ADD CONSTRAINT wf_action_sandbox_draft_fk FOREIGN KEY (org_id, draft_id)
  REFERENCES public.wf_action_draft (org_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX wf_action_sandbox_one_per_draft
  ON public.wf_action_sandbox_outbox (org_id, draft_id) WHERE draft_id IS NOT NULL;

ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_cap_check;
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_mass_check;
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_data_class_check;
-- Unchanged for every row that has no approved draft behind it.
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_cap_check CHECK (
  draft_id IS NOT NULL OR category NOT IN (
    'money_movement', 'safeguarding', 'credential_change', 'public_publish',
    'mass_message', 'external_authority_share', 'unregistered_webhook'
  )
);
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_mass_check CHECK (
  draft_id IS NOT NULL OR (cardinality(recipient_ids) <= 25 AND audience_selector IS NULL)
);
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_data_class_check CHECK (
  draft_id IS NOT NULL OR data_class IN ('public', 'internal')
);
-- N2 (WF-06 review): a webhook outbox row always names its registered target.
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_webhook_target_check
  CHECK (kind <> 'webhook' OR webhook_target_id IS NOT NULL);

CREATE FUNCTION public.wf_action_sandbox_outbox_draft_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_d public.wf_action_draft%ROWTYPE;
  v_gap text;
BEGIN
  IF NEW.draft_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.draft_id IS DISTINCT FROM OLD.draft_id THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: the draft link is immutable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = NEW.org_id AND id = NEW.draft_id;
  IF NOT FOUND OR v_d.status <> 'approved' THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: the draft is not approved' USING ERRCODE = '42501';
  END IF;
  v_gap := public.wf_draft_approval_gap(NEW.org_id, NEW.draft_id);
  IF v_gap IS NOT NULL THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: the draft approval is not complete (%)', v_gap
      USING ERRCODE = '42501';
  END IF;
  IF (NEW.run_id, NEW.step_run_id, NEW.kind, NEW.category, NEW.template_ref, NEW.template_params,
      NEW.recipient_ids, NEW.audience_selector, NEW.data_class, NEW.webhook_target_id,
      NEW.idempotency_key)
     IS DISTINCT FROM
     (v_d.run_id, v_d.step_run_id, v_d.kind, v_d.category, v_d.template_ref, v_d.template_params,
      v_d.recipient_ids, v_d.audience_selector, v_d.data_class, v_d.webhook_target_id,
      v_d.idempotency_key) THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: the record differs from the approved draft'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
-- WF-06's guard, extended for one case only: a row that carries an approved draft may be cleared by
-- the broker decision recorded for that approved draft (key 'wf-approved:' || draft id). Every
-- other row is checked exactly as before. EXECUTE stays revoked from every role (N8).
CREATE OR REPLACE FUNCTION public.wf_action_sandbox_outbox_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_tool_call_ledger l
     WHERE l.id = NEW.broker_decision_id
       AND l.kind = 'decision'
       AND l.verdict = 'execute'
       AND l.tenant_ref = NEW.org_id::text
       AND l.tool_id = 'workflow.action.' || NEW.kind
       AND (l.idempotency_key = NEW.idempotency_key
            OR (NEW.draft_id IS NOT NULL AND l.idempotency_key = 'wf-approved:' || NEW.draft_id::text))
  ) THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: broker decision does not clear this action'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER wf_action_sandbox_outbox_10_draft_guard
  BEFORE INSERT OR UPDATE ON public.wf_action_sandbox_outbox
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_sandbox_outbox_draft_guard();

-- -----------------------------------------------------------------------------
-- 6. Risk floor for capped step classes; high-risk approvals need recorded votes
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_approval_risk_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_class text;
BEGIN
  SELECT s.action_class INTO v_class FROM public.wf_step_run s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.step_run_id;
  IF public.wf_is_capped_category(v_class) THEN
    NEW.risk := 'high';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_approval_05_risk_floor
  BEFORE INSERT ON public.wf_approval
  FOR EACH ROW EXECUTE FUNCTION public.wf_approval_risk_floor();

-- A high-risk approval can only become approved with the required number of distinct approving
-- votes, each carrying its own step-up, and the final decider is one of them. Direct updates by
-- the service role (no decision rows) are refused. Normal-risk approvals keep the WF-01 rules.
CREATE FUNCTION public.wf_approval_decision_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_category text;
  v_required integer;
  v_digest text;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' AND OLD.risk = 'high' THEN
    v_category := public.wf_approval_category(OLD.org_id, OLD.id);
    v_required := public.wf_approval_required_count(OLD.org_id, OLD.risk, v_category);
    -- Only votes cast on the content as it is NOW count, the same rule the decide function applies. A vote on an
    -- earlier version of the content (the draft or template changed since) must not satisfy this row-level gate.
    v_digest := public.wf_approval_content_digest(OLD.org_id, OLD.id);
    IF NOT EXISTS (SELECT 1 FROM public.wf_approval_decision x
                    WHERE x.approval_id = OLD.id AND x.approver_id = NEW.decided_by
                      AND x.decision = 'approve' AND x.step_up_id IS NOT NULL
                      AND x.content_digest = v_digest)
       OR (SELECT count(DISTINCT x.approver_id) FROM public.wf_approval_decision x
            WHERE x.approval_id = OLD.id AND x.decision = 'approve'
              AND x.step_up_id IS NOT NULL AND x.content_digest = v_digest) < v_required
       OR EXISTS (SELECT 1 FROM public.wf_approval_decision x
                   WHERE x.approval_id = OLD.id AND x.decision = 'reject') THEN
      RAISE EXCEPTION 'wf_approval: a high-risk approval needs recorded step-up votes from the required approvers'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_approval_30_decision_gate
  BEFORE UPDATE ON public.wf_approval
  FOR EACH ROW EXECUTE FUNCTION public.wf_approval_decision_gate();

-- -----------------------------------------------------------------------------
-- 7. Content digest: what the approver approves, computed once, in SQL
-- -----------------------------------------------------------------------------
-- The category of an approval: its draft's category, otherwise the step's action class.
CREATE FUNCTION public.wf_approval_category(p_org uuid, p_approval uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT d.category FROM public.wf_action_draft d WHERE d.org_id = p_org AND d.approval_id = p_approval),
    (SELECT s.action_class FROM public.wf_approval a
       JOIN public.wf_step_run s ON s.org_id = a.org_id AND s.id = a.step_run_id
      WHERE a.org_id = p_org AND a.id = p_approval))
$$;

-- sha256 of the approved template text held in this workflow store (in-app templates). NULL means
-- the text is not held here. Email, SMS and WhatsApp templates live in the communications template
-- store, which this neutral layer does not read: for those kinds the digest binds the template
-- reference and parameters, and the existing WF-06 approved-template check runs again at dispatch.
CREATE FUNCTION public.wf_draft_template_sha(p_org uuid, p_kind text, p_template_ref text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(t.body_template, 'UTF8')), 'hex')
    FROM public.wf_action_template t
   WHERE p_kind = 'in_app' AND t.org_id = p_org AND t.kind = 'in_app'
     AND t.template_ref = p_template_ref AND t.status = 'approved'
$$;

CREATE FUNCTION public.wf_approval_content_digest(p_org uuid, p_approval uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_a public.wf_approval%ROWTYPE;
  v_d public.wf_action_draft%ROWTYPE;
  v_content jsonb;
BEGIN
  SELECT * INTO v_a FROM public.wf_approval WHERE org_id = p_org AND id = p_approval;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = p_org AND approval_id = p_approval;
  v_content := jsonb_build_object(
    'v', 1,
    'org', v_a.org_id, 'approval', v_a.id, 'run', v_a.run_id, 'step', v_a.step_run_id,
    'risk', v_a.risk, 'permission', v_a.required_permission,
    'target_version', v_a.target_version_id,
    'category', public.wf_approval_category(p_org, p_approval),
    'draft', CASE WHEN v_d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_d.id, 'kind', v_d.kind, 'category', v_d.category, 'template_ref', v_d.template_ref,
      'params', v_d.template_params,
      'recipients', coalesce((SELECT jsonb_agg(r ORDER BY r) FROM unnest(v_d.recipient_ids) r), '[]'::jsonb),
      'audience', v_d.audience_selector, 'data_class', v_d.data_class,
      'webhook_target', v_d.webhook_target_id,
      'template_sha', public.wf_draft_template_sha(p_org, v_d.kind, v_d.template_ref)
    ) END
  );
  RETURN encode(sha256(convert_to(v_content::text, 'UTF8')), 'hex');
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Acting as the verified person for one transaction
-- -----------------------------------------------------------------------------
-- Internal. Binds the JWT claims the existing helpers read, so has_permission(), wf_can() and
-- wf_audit_append() see the person. The previous claims are returned and restored by the caller.
CREATE FUNCTION public.wf_act_as(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_prev jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'wf07:actor_required' USING ERRCODE = '42501';
  END IF;
  v_prev := jsonb_build_object(
    'claims', coalesce(current_setting('request.jwt.claims', true), ''),
    'sub', coalesce(current_setting('request.jwt.claim.sub', true), ''),
    'role', coalesce(current_setting('request.jwt.claim.role', true), ''));
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  RETURN v_prev;
END
$$;

CREATE FUNCTION public.wf_act_restore(p_prev jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', coalesce(p_prev ->> 'claims', ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_prev ->> 'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(p_prev ->> 'role', ''), true);
END
$$;

-- -----------------------------------------------------------------------------
-- 9. Who may decide, in one place (the caller has bound the actor)
-- -----------------------------------------------------------------------------
-- Returns the ordered list of reasons the bound actor cannot decide this approval now.
CREATE FUNCTION public.wf_decision_blockers(p_org uuid, p_approval uuid, p_actor uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_a public.wf_approval%ROWTYPE;
  v_run public.wf_run%ROWTYPE;
  v_blockers text[] := '{}';
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor OR p_actor IS NULL THEN
    RETURN ARRAY['actor_unbound'];
  END IF;
  SELECT * INTO v_a FROM public.wf_approval WHERE org_id = p_org AND id = p_approval;
  IF NOT FOUND OR v_a.org_id IS DISTINCT FROM public.get_my_organization_id() THEN
    RETURN ARRAY['not_found'];
  END IF;
  SELECT * INTO v_run FROM public.wf_run WHERE org_id = v_a.org_id AND id = v_a.run_id;
  IF v_a.status <> 'pending' THEN v_blockers := array_append(v_blockers, 'not_pending'); END IF;
  IF now() >= v_a.expires_at THEN v_blockers := array_append(v_blockers, 'expired'); END IF;
  IF NOT public.has_permission(v_a.org_id, v_a.required_permission) THEN
    v_blockers := array_append(v_blockers, 'not_authorized');
  END IF;
  IF (v_a.requested_by_kind = 'user' AND v_a.requested_by_ref = p_actor::text)
     OR v_run.started_by = p_actor THEN
    v_blockers := array_append(v_blockers, 'requester');
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.wf_version v
        WHERE v.org_id = v_a.org_id
          AND (v.id = v_run.version_id OR v.id = v_a.target_version_id)
          AND (v.created_by IS NULL OR v.updated_by IS NULL
               OR p_actor = v.created_by OR p_actor = v.updated_by))
     OR EXISTS (SELECT 1 FROM public.wf_template t
                 WHERE t.id = v_run.template_id AND t.created_by = p_actor) THEN
    v_blockers := array_append(v_blockers, 'author');
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_approval_decision x
              WHERE x.approval_id = v_a.id AND x.approver_id = p_actor) THEN
    v_blockers := array_append(v_blockers, 'already_voted');
  END IF;
  RETURN v_blockers;
END
$$;

-- -----------------------------------------------------------------------------
-- 10. Drafts get an approval: a review step and an approval row (idempotent)
-- -----------------------------------------------------------------------------
-- wf_approval can only point at an approval-kind step, so a draft's review is its own step in the
-- same run. The action step stays waiting until the approved draft is dispatched.
CREATE FUNCTION public.wf_request_draft_approval(p_org uuid, p_draft uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_d public.wf_action_draft%ROWTYPE;
  v_run public.wf_run%ROWTYPE;
  v_step uuid;
  v_approval uuid;
  v_risk text;
BEGIN
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = p_org AND id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wf07:not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_d.approval_id IS NOT NULL THEN RETURN v_d.approval_id; END IF;
  IF v_d.status <> 'draft' THEN RETURN NULL; END IF;
  SELECT * INTO v_run FROM public.wf_run WHERE org_id = p_org AND id = v_d.run_id;
  IF v_run.status NOT IN ('queued', 'running', 'waiting') THEN RETURN NULL; END IF;
  v_risk := CASE WHEN public.wf_is_capped_category(v_d.category)
                   OR v_d.category = 'unregistered_webhook' THEN 'high' ELSE 'normal' END;

  INSERT INTO public.wf_step_run (
    org_id, run_id, step_key, iteration, kind, status, idempotency_key, action_class, agent_ref
  ) VALUES (
    p_org, v_d.run_id, 'draft-review-' || replace(v_d.id::text, '-', ''), 0, 'approval', 'waiting',
    'wf-draft-review:' || v_d.id::text, 'internal', v_run.agent_ref
  ) RETURNING id INTO v_step;

  INSERT INTO public.wf_approval (
    org_id, run_id, step_run_id, required_permission, risk, summary,
    requested_by_kind, requested_by_ref, expires_at
  ) VALUES (
    p_org, v_d.run_id, v_step, 'workflows.approve', v_risk,
    'Review drafted ' || v_d.kind || ' action (' || v_d.category || ')',
    CASE WHEN v_run.started_by IS NOT NULL THEN 'user'
         WHEN v_run.agent_ref IS NOT NULL THEN 'agent' ELSE 'system' END,
    CASE WHEN v_run.started_by IS NOT NULL THEN v_run.started_by::text
         ELSE coalesce(v_run.agent_ref, 'workflow-runtime') END,
    now() + interval '7 days'
  ) RETURNING id INTO v_approval;

  UPDATE public.wf_action_draft SET approval_id = v_approval WHERE org_id = p_org AND id = p_draft;
  INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail)
  VALUES (p_org, v_d.run_id, v_step, 'approval.requested', 'system', 'workflow-runtime',
          jsonb_build_object('approval_id', v_approval, 'risk', v_risk));
  RETURN v_approval;
END
$$;

CREATE FUNCTION public.wf_request_missing_draft_approvals(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row record; v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT d.org_id, d.id FROM public.wf_action_draft d
     WHERE d.status = 'draft' AND d.approval_id IS NULL
       AND d.created_at + interval '7 days' > now()
     ORDER BY d.created_at LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
  LOOP
    IF public.wf_request_draft_approval(v_row.org_id, v_row.id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END
$$;

-- -----------------------------------------------------------------------------
-- 11. Reads (inbox list and detail) and audit of high-risk views
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_inbox_list(p_actor uuid, p_status text DEFAULT 'pending', p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_out jsonb;
BEGIN
  IF p_status NOT IN ('pending', 'decided') THEN
    RAISE EXCEPTION 'wf07:invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT (public.wf_can(v_org, 'workflows.view') OR public.wf_can(v_org, 'workflows.approve')) THEN
    RAISE EXCEPTION 'wf07:not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item ->> 'requested_at') DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'approval_id', a.id,
      'kind', CASE WHEN d.id IS NULL THEN 'approval' ELSE 'draft' END,
      'action_kind', d.kind,
      'category', public.wf_approval_category(a.org_id, a.id),
      'risk', a.risk,
      'status', a.status,
      'required_permission', a.required_permission,
      'requested_at', a.requested_at,
      'expires_at', a.expires_at,
      'workflow', def.key,
      'approvals', (SELECT count(*) FROM public.wf_approval_decision x
                     WHERE x.approval_id = a.id AND x.decision = 'approve'),
      'required', public.wf_approval_required_count(a.org_id, a.risk,
                    public.wf_approval_category(a.org_id, a.id)),
      'voted_by_me', EXISTS (SELECT 1 FROM public.wf_approval_decision x
                              WHERE x.approval_id = a.id AND x.approver_id = p_actor)
    ) AS item
    FROM public.wf_approval a
    JOIN public.wf_run r ON r.org_id = a.org_id AND r.id = a.run_id
    JOIN public.wf_definition def ON def.org_id = r.org_id AND def.id = r.definition_id
    LEFT JOIN public.wf_action_draft d ON d.org_id = a.org_id AND d.approval_id = a.id
    WHERE a.org_id = v_org
      AND ((p_status = 'pending' AND a.status = 'pending' AND a.expires_at > now())
        OR (p_status = 'decided' AND a.status <> 'pending' AND a.updated_at > now() - interval '30 days'))
    ORDER BY a.requested_at DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  ) q;
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

CREATE FUNCTION public.wf_approval_view(p_actor uuid, p_approval uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_a public.wf_approval%ROWTYPE;
  v_d public.wf_action_draft%ROWTYPE;
  v_category text;
  v_blockers text[];
  v_digest text;
  v_out jsonb;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  SELECT * INTO v_a FROM public.wf_approval WHERE id = p_approval;
  IF NOT FOUND OR NOT (public.wf_can(v_a.org_id, 'workflows.view') OR public.wf_can(v_a.org_id, 'workflows.approve'))
     OR v_a.org_id IS DISTINCT FROM public.get_my_organization_id() THEN
    RAISE EXCEPTION 'wf07:not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = v_a.org_id AND approval_id = v_a.id;
  v_category := public.wf_approval_category(v_a.org_id, v_a.id);
  v_blockers := public.wf_decision_blockers(v_a.org_id, v_a.id, p_actor);
  v_digest := public.wf_approval_content_digest(v_a.org_id, v_a.id);
  IF v_a.risk = 'high' THEN
    PERFORM public.wf_audit_append(v_a.org_id, 'workflow.approval.viewed', 'wf_approval',
      v_a.id::text, NULL, jsonb_build_object('digest', v_digest));
  END IF;
  v_out := jsonb_build_object(
    'approval_id', v_a.id, 'org_id', v_a.org_id, 'status', v_a.status, 'risk', v_a.risk,
    'required_permission', v_a.required_permission, 'category', v_category,
    'requested_at', v_a.requested_at, 'expires_at', v_a.expires_at,
    'requested_by_kind', v_a.requested_by_kind,
    'summary', v_a.summary, 'digest', v_digest,
    'step_up_required', v_a.risk = 'high',
    'required', public.wf_approval_required_count(v_a.org_id, v_a.risk, v_category),
    'votes', coalesce((SELECT jsonb_agg(jsonb_build_object(
                 'approver_id', x.approver_id, 'decision', x.decision, 'decided_at', x.decided_at,
                 'current', x.content_digest = v_digest)
                 ORDER BY x.decided_at)
               FROM public.wf_approval_decision x WHERE x.approval_id = v_a.id), '[]'::jsonb),
    'can_decide', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'draft', CASE WHEN v_d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_d.id, 'kind', v_d.kind, 'category', v_d.category, 'status', v_d.status,
      'template_ref', v_d.template_ref, 'params', v_d.template_params,
      'recipient_count', cardinality(v_d.recipient_ids),
      'recipient_ids', CASE WHEN cardinality(v_d.recipient_ids) <= 5
                            THEN to_jsonb(v_d.recipient_ids) ELSE '[]'::jsonb END,
      'audience', v_d.audience_selector, 'data_class', v_d.data_class,
      'template_available', CASE WHEN v_d.kind = 'in_app'
        THEN public.wf_draft_template_sha(v_a.org_id, v_d.kind, v_d.template_ref) IS NOT NULL END,
      'template_body', (SELECT t.body_template FROM public.wf_action_template t
                         WHERE t.org_id = v_a.org_id AND t.kind = v_d.kind
                           AND t.template_ref = v_d.template_ref AND t.status = 'approved')
    ) END
  );
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

-- A failed passkey check is itself an audit event (a short reason code, never free text).
CREATE FUNCTION public.wf_audit_step_up_failed(p_actor uuid, p_approval uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_a public.wf_approval%ROWTYPE;
BEGIN
  IF p_reason NOT IN ('assertion_invalid', 'assertion_rate_limited', 'challenge_mismatch', 'no_passkey') THEN
    RAISE EXCEPTION 'wf07:invalid_reason' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  SELECT * INTO v_a FROM public.wf_approval WHERE id = p_approval;
  IF NOT FOUND OR NOT public.wf_can(v_a.org_id, 'workflows.approve') THEN
    RAISE EXCEPTION 'wf07:not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.wf_audit_append(v_a.org_id, 'workflow.approval.step_up_failed', 'wf_approval',
    v_a.id::text, NULL, jsonb_build_object('reason', p_reason));
  PERFORM public.wf_act_restore(v_prev);
END
$$;

-- -----------------------------------------------------------------------------
-- 12. Step-up evidence and the decision
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_record_step_up(p_actor uuid, p_approval uuid, p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_a public.wf_approval%ROWTYPE;
  v_blockers text[];
  v_id uuid;
  v_expires timestamptz;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  SELECT * INTO v_a FROM public.wf_approval WHERE id = p_approval FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wf07:not_found' USING ERRCODE = 'P0002'; END IF;
  v_blockers := public.wf_decision_blockers(v_a.org_id, v_a.id, p_actor);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'wf07:%', v_blockers[1] USING ERRCODE = '42501';
  END IF;
  IF v_a.risk <> 'high' THEN
    RAISE EXCEPTION 'wf07:step_up_not_required' USING ERRCODE = '22023';
  END IF;
  IF p_digest IS DISTINCT FROM public.wf_approval_content_digest(v_a.org_id, v_a.id) THEN
    RAISE EXCEPTION 'wf07:stale_content' USING ERRCODE = '42501';
  END IF;
  UPDATE public.wf_approval_step_up SET revoked_at = now()
   WHERE approval_id = v_a.id AND user_id = p_actor AND used_at IS NULL AND revoked_at IS NULL;
  v_expires := now() + interval '5 minutes';
  INSERT INTO public.wf_approval_step_up (org_id, approval_id, user_id, content_digest, verified_at, expires_at)
  VALUES (v_a.org_id, v_a.id, p_actor, p_digest, now(), v_expires)
  RETURNING id INTO v_id;
  PERFORM public.wf_audit_append(v_a.org_id, 'workflow.approval.step_up_verified', 'wf_approval',
    v_a.id::text, NULL, jsonb_build_object('step_up', v_id, 'digest', p_digest));
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('step_up_id', v_id, 'expires_at', v_expires);
END
$$;

CREATE FUNCTION public.wf_decide_approval(
  p_actor uuid, p_approval uuid, p_decision text, p_note text, p_digest text, p_step_up uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_a public.wf_approval%ROWTYPE;
  v_d public.wf_action_draft%ROWTYPE;
  v_blockers text[];
  v_digest text;
  v_category text;
  v_required integer;
  v_count integer;
  v_status text := 'pending';
  v_su public.wf_approval_step_up%ROWTYPE;
  v_vote uuid;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'wf07:invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 1000 THEN
    RAISE EXCEPTION 'wf07:note_too_long' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  SELECT * INTO v_a FROM public.wf_approval WHERE id = p_approval FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wf07:not_found' USING ERRCODE = 'P0002'; END IF;
  v_blockers := public.wf_decision_blockers(v_a.org_id, v_a.id, p_actor);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'wf07:%', v_blockers[1] USING ERRCODE = '42501';
  END IF;
  v_digest := public.wf_approval_content_digest(v_a.org_id, v_a.id);
  IF p_digest IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'wf07:stale_content' USING ERRCODE = '42501';
  END IF;
  v_category := public.wf_approval_category(v_a.org_id, v_a.id);
  SELECT * INTO v_d FROM public.wf_action_draft
   WHERE org_id = v_a.org_id AND approval_id = v_a.id FOR UPDATE;

  IF p_decision = 'approve' THEN
    IF v_d.id IS NOT NULL THEN
      IF v_d.status <> 'draft' OR v_d.category = 'unregistered_webhook' THEN
        RAISE EXCEPTION 'wf07:draft_not_approvable' USING ERRCODE = '42501';
      END IF;
      IF v_d.kind = 'in_app'
         AND public.wf_draft_template_sha(v_a.org_id, v_d.kind, v_d.template_ref) IS NULL THEN
        RAISE EXCEPTION 'wf07:template_unavailable' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF v_a.risk = 'high' THEN
      SELECT * INTO v_su FROM public.wf_approval_step_up
       WHERE id = p_step_up AND org_id = v_a.org_id AND approval_id = v_a.id AND user_id = p_actor
         AND content_digest = v_digest AND used_at IS NULL AND revoked_at IS NULL
         AND now() < expires_at
       FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'wf07:step_up_invalid' USING ERRCODE = '42501'; END IF;
      UPDATE public.wf_approval_step_up SET used_at = now() WHERE id = v_su.id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.wf_approval_decision (
      org_id, approval_id, approver_id, decision, high_risk, step_up_id, content_digest, note
    ) VALUES (
      v_a.org_id, v_a.id, p_actor, p_decision, v_a.risk = 'high',
      CASE WHEN p_decision = 'approve' AND v_a.risk = 'high' THEN v_su.id END, v_digest, p_note
    ) RETURNING id INTO v_vote;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'wf07:already_voted' USING ERRCODE = '42501';
  END;
  PERFORM public.wf_audit_append(v_a.org_id, 'workflow.approval.vote_' || p_decision, 'wf_approval',
    v_a.id::text, NULL,
    jsonb_build_object('vote', v_vote, 'digest', v_digest, 'step_up', v_su.id));
  INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_a.org_id, v_a.run_id, v_a.step_run_id, 'approval.vote', 'user', p_actor::text,
          jsonb_build_object('approval_id', v_a.id, 'decision', p_decision));

  v_required := public.wf_approval_required_count(v_a.org_id, v_a.risk, v_category);
  IF p_decision = 'reject' THEN
    UPDATE public.wf_approval
       SET status = 'rejected', decided_by = p_actor, decided_at = now(),
           decision_channel = 'console', decision_note = p_note
     WHERE id = v_a.id;
    IF v_d.id IS NOT NULL THEN
      UPDATE public.wf_action_draft SET status = 'rejected' WHERE id = v_d.id;
    END IF;
    PERFORM public.wf_end_run_for_approval(v_a.org_id, v_a.run_id, 'approval.rejected');
    v_status := 'rejected';
  ELSE
    SELECT count(DISTINCT x.approver_id) INTO v_count FROM public.wf_approval_decision x
     WHERE x.approval_id = v_a.id AND x.decision = 'approve' AND x.content_digest = v_digest;
    IF v_count >= v_required THEN
      UPDATE public.wf_approval
         SET status = 'approved', decided_by = p_actor, decided_at = now(),
             decision_channel = 'console', decision_note = p_note
       WHERE id = v_a.id;
      IF v_d.id IS NOT NULL THEN
        UPDATE public.wf_action_draft SET status = 'approved' WHERE id = v_d.id;
        UPDATE public.wf_step_run SET status = 'succeeded', finished_at = now()
         WHERE org_id = v_a.org_id AND id = v_a.step_run_id AND status = 'waiting';
      END IF;
      v_status := 'approved';
    END IF;
  END IF;
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object(
    'status', v_status, 'approvals', coalesce(v_count, 0), 'required', v_required,
    'draft_id', v_d.id, 'org_id', v_a.org_id);
END
$$;

-- -----------------------------------------------------------------------------
-- 13. Expiry, cancellation and continuation
-- -----------------------------------------------------------------------------
-- Ends the run an undecidable approval belongs to; pending siblings are closed by the trigger below.
CREATE FUNCTION public.wf_end_run_for_approval(p_org uuid, p_run uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.wf_run
     SET status = 'cancelled', finished_at = now(), error_code = p_code
   WHERE org_id = p_org AND id = p_run AND status IN ('queued', 'running', 'waiting');
END
$$;

-- When a run ends without success its open reviews cannot be decided any more.
CREATE FUNCTION public.wf_run_close_approvals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'failed', 'timed_out') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.wf_approval SET status = 'cancelled'
     WHERE org_id = NEW.org_id AND run_id = NEW.id AND status = 'pending';
    UPDATE public.wf_action_draft SET status = 'cancelled'
     WHERE org_id = NEW.org_id AND run_id = NEW.id AND status = 'draft';
    UPDATE public.wf_step_run SET status = 'cancelled', finished_at = now()
     WHERE org_id = NEW.org_id AND run_id = NEW.id AND status IN ('pending', 'waiting');
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER wf_run_80_close_approvals
  AFTER UPDATE OF status ON public.wf_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_run_close_approvals();

CREATE FUNCTION public.wf_expire_approvals(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row record;
  v_approvals integer := 0;
  v_drafts integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
BEGIN
  FOR v_row IN
    SELECT a.org_id, a.id, a.run_id FROM public.wf_approval a
     WHERE a.status = 'pending' AND a.expires_at <= now()
     ORDER BY a.expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.wf_approval SET status = 'expired' WHERE id = v_row.id;
    UPDATE public.wf_action_draft SET status = 'expired'
     WHERE org_id = v_row.org_id AND approval_id = v_row.id AND status = 'draft';
    PERFORM public.wf_end_run_for_approval(v_row.org_id, v_row.run_id, 'approval.expired');
    v_approvals := v_approvals + 1;
  END LOOP;
  -- Drafts that never got an approval row expire with the same review window.
  UPDATE public.wf_action_draft SET status = 'expired'
   WHERE status = 'draft' AND approval_id IS NULL AND created_at + interval '7 days' <= now();
  GET DIAGNOSTICS v_drafts = ROW_COUNT;
  RETURN jsonb_build_object('approvals_expired', v_approvals, 'orphan_drafts_expired', v_drafts);
END
$$;

-- Approved drafts whose dispatch has not been recorded yet (the server dispatches them).
CREATE FUNCTION public.wf_approved_drafts_ready(p_limit integer DEFAULT 50)
RETURNS TABLE (org_id uuid, draft_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.org_id, d.id
    FROM public.wf_action_draft d
   WHERE d.status = 'approved'
     AND NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o
                      WHERE o.org_id = d.org_id AND o.draft_id = d.id)
     AND EXISTS (SELECT 1 FROM public.wf_run r
                  WHERE r.org_id = d.org_id AND r.id = d.run_id
                    AND r.status IN ('waiting', 'running'))
   ORDER BY d.updated_at
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- After the approved draft's dispatch is recorded, let the action step run again: the replayed
-- step then finds the executed record and the workflow continues.
CREATE FUNCTION public.wf_resume_after_dispatch(p_org uuid, p_draft uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_d public.wf_action_draft%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.wf_action_draft WHERE org_id = p_org AND id = p_draft;
  IF NOT FOUND OR v_d.status <> 'approved'
     OR NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o
                     WHERE o.org_id = p_org AND o.draft_id = p_draft) THEN
    RETURN false;
  END IF;
  UPDATE public.wf_step_run SET status = 'pending', next_attempt_at = now(), resume_at = NULL
   WHERE org_id = p_org AND id = v_d.step_run_id AND status = 'waiting';
  UPDATE public.wf_run SET status = 'running'
   WHERE org_id = p_org AND id = v_d.run_id AND status = 'waiting';
  RETURN true;
END
$$;

-- People who could decide an approval now (for the in-app notice). Ids only.
CREATE FUNCTION public.wf_approver_candidates(p_approval uuid, p_limit integer DEFAULT 25)
RETURNS TABLE (approver_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_a public.wf_approval%ROWTYPE;
  v_u record;
  v_prev jsonb;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_a FROM public.wf_approval WHERE id = p_approval AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;
  FOR v_u IN
    SELECT DISTINCT a.user_id AS uid FROM public.user_role_assignments a
     WHERE a.org_id = v_a.org_id AND a.status = 'active'
  LOOP
    EXIT WHEN v_n >= least(greatest(coalesce(p_limit, 25), 1), 100);
    v_prev := public.wf_act_as(v_u.uid);
    IF cardinality(public.wf_decision_blockers(v_a.org_id, v_a.id, v_u.uid)) = 0 THEN
      approver_id := v_u.uid;
      v_n := v_n + 1;
      RETURN NEXT;
    END IF;
    PERFORM public.wf_act_restore(v_prev);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 14. Row-level security, grants, audit of policy changes
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_approval_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval_step_up ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval_step_up FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval_decision FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_approval_policy_member_read ON public.wf_approval_policy
  FOR SELECT TO authenticated USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_approval_policy_service ON public.wf_approval_policy
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_approval_step_up_service_read ON public.wf_approval_step_up
  FOR SELECT TO service_role USING (true);
CREATE POLICY wf_approval_decision_member_read ON public.wf_approval_decision
  FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view') OR public.wf_can(org_id, 'workflows.approve')
         OR public.has_platform_capability('platform.tenants.read'));
CREATE POLICY wf_approval_decision_service_read ON public.wf_approval_decision
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.wf_approval_policy, public.wf_approval_step_up, public.wf_approval_decision
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wf_approval_policy TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wf_approval_policy TO service_role;
-- Step-up evidence and decisions are written only by the definer functions above.
GRANT SELECT ON TABLE public.wf_approval_step_up TO service_role;
GRANT SELECT ON TABLE public.wf_approval_decision TO authenticated, service_role;

CREATE TRIGGER wf_approval_policy_90_audit AFTER INSERT OR UPDATE ON public.wf_approval_policy
  FOR EACH ROW EXECUTE FUNCTION public.wf_runtime_settings_audit();

-- Functions: service role only. Internal helpers and trigger functions get no EXECUTE at all.
REVOKE ALL ON FUNCTION
  public.wf_is_capped_category(text),
  public.wf_approval_required_count(uuid, text, text),
  public.wf_approval_step_up_guard(),
  public.wf_approval_decision_guard(),
  public.wf_approval_policy_guard(),
  public.wf_action_draft_freeze(),
  public.wf_draft_approval_gap(uuid, uuid),
  public.wf_action_draft_approval_guard(),
  public.wf_action_sandbox_outbox_draft_guard(),
  public.wf_approval_risk_floor(),
  public.wf_approval_decision_gate(),
  public.wf_approval_category(uuid, uuid),
  public.wf_draft_template_sha(uuid, text, text),
  public.wf_approval_content_digest(uuid, uuid),
  public.wf_act_as(uuid),
  public.wf_act_restore(jsonb),
  public.wf_decision_blockers(uuid, uuid, uuid),
  public.wf_end_run_for_approval(uuid, uuid, text),
  public.wf_run_close_approvals()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.wf_request_draft_approval(uuid, uuid),
  public.wf_request_missing_draft_approvals(integer),
  public.wf_inbox_list(uuid, text, integer),
  public.wf_approval_view(uuid, uuid),
  public.wf_audit_step_up_failed(uuid, uuid, text),
  public.wf_record_step_up(uuid, uuid, text),
  public.wf_decide_approval(uuid, uuid, text, text, text, uuid),
  public.wf_expire_approvals(integer),
  public.wf_approved_drafts_ready(integer),
  public.wf_resume_after_dispatch(uuid, uuid),
  public.wf_approver_candidates(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.wf_request_draft_approval(uuid, uuid),
  public.wf_request_missing_draft_approvals(integer),
  public.wf_inbox_list(uuid, text, integer),
  public.wf_approval_view(uuid, uuid),
  public.wf_audit_step_up_failed(uuid, uuid, text),
  public.wf_record_step_up(uuid, uuid, text),
  public.wf_decide_approval(uuid, uuid, text, text, text, uuid),
  public.wf_expire_approvals(integer),
  public.wf_approved_drafts_ready(integer),
  public.wf_resume_after_dispatch(uuid, uuid),
  public.wf_approver_candidates(uuid, integer)
  TO service_role;
-- N8 (WF-06 review): the WF-06 outbox guard is a trigger function, not something to call.
REVOKE ALL ON FUNCTION public.wf_action_sandbox_outbox_guard() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.wf_approval_policy IS
  'WF-07 / ADR-122: per-organization approver counts and two-person categories. Service role writes; defaults apply when absent.';
COMMENT ON TABLE public.wf_approval_step_up IS
  'WF-07 / ADR-122: verified passkey step-up, bound to (approval, content digest), single use, at most five minutes.';
COMMENT ON TABLE public.wf_approval_decision IS
  'WF-07 / ADR-122: one row per approver (append-only). The requester never appears.';
COMMENT ON FUNCTION public.wf_decide_approval(uuid, uuid, text, text, text, uuid) IS
  'WF-07 / ADR-122: the one decision path. Service role only; the signed-in actor is bound and checked in SQL.';

COMMIT;
