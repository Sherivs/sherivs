-- NOT APPLIED. Rollback for 20261117000900 (WF-07 approval inbox, ADR-122).
-- Restores the WF-06 draft and outbox constraints and the WF-06 outbox guard, then drops everything
-- WF-07 added. The evidence tables (wf_approval_decision, wf_approval_step_up, wf_approval_policy) are
-- dropped with their rows; the audit_chain entries that WF-07 wrote stay (the chain is append-only).
-- It refuses to run if approved capped drafts or their outbox records exist, because the restored WF-06
-- constraints forbid them: export and remove those rows first. Cancelled drafts become expired.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_approval_decision') IS NULL
     OR to_regclass('public.wf_approval_step_up') IS NULL
     OR to_regclass('public.wf_approval_policy') IS NULL
     OR to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WF-07 rollback: one or more WF-07 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_draft
              WHERE status = 'approved'
                AND category IN ('money_movement', 'safeguarding', 'credential_change', 'public_publish',
                                 'mass_message', 'external_authority_share', 'unregistered_webhook')) THEN
    RAISE EXCEPTION 'WF-07 rollback: approved capped drafts exist; export and remove them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox
              WHERE draft_id IS NOT NULL
                AND (category IN ('money_movement', 'safeguarding', 'credential_change', 'public_publish',
                                  'mass_message', 'external_authority_share', 'unregistered_webhook')
                     OR cardinality(recipient_ids) > 25 OR audience_selector IS NOT NULL
                     OR data_class NOT IN ('public', 'internal'))) THEN
    RAISE EXCEPTION 'WF-07 rollback: sandbox outbox records of approved capped drafts exist; export and remove them first';
  END IF;
END
$prereq$;

-- Triggers first.
DROP TRIGGER wf_run_80_close_approvals ON public.wf_run;
DROP TRIGGER wf_approval_30_decision_gate ON public.wf_approval;
DROP TRIGGER wf_approval_05_risk_floor ON public.wf_approval;
DROP TRIGGER wf_action_sandbox_outbox_10_draft_guard ON public.wf_action_sandbox_outbox;
DROP TRIGGER wf_action_draft_20_approval_guard ON public.wf_action_draft;
DROP TRIGGER wf_action_draft_10_freeze ON public.wf_action_draft;

-- Outbox: restore the WF-06 constraints and guard, then drop the draft link.
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_webhook_target_check;
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_cap_check;
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_mass_check;
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_data_class_check;
DROP INDEX public.wf_action_sandbox_one_per_draft;
ALTER TABLE public.wf_action_sandbox_outbox DROP CONSTRAINT wf_action_sandbox_draft_fk;
ALTER TABLE public.wf_action_sandbox_outbox DROP COLUMN draft_id;
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_cap_check CHECK (
  category NOT IN (
    'money_movement', 'safeguarding', 'credential_change', 'public_publish',
    'mass_message', 'external_authority_share', 'unregistered_webhook'
  )
);
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_mass_check CHECK (
  cardinality(recipient_ids) <= 25 AND audience_selector IS NULL
);
ALTER TABLE public.wf_action_sandbox_outbox ADD CONSTRAINT wf_action_sandbox_data_class_check CHECK (
  data_class IN ('public', 'internal')
);
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
       AND l.idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: broker decision does not clear this action'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
GRANT EXECUTE ON FUNCTION public.wf_action_sandbox_outbox_guard() TO service_role;

-- Drafts: restore the WF-06 status set and cap constraint, then drop the approval link.
UPDATE public.wf_action_draft SET status = 'expired' WHERE status = 'cancelled';
ALTER TABLE public.wf_action_draft DROP CONSTRAINT wf_action_draft_cap_check;
ALTER TABLE public.wf_action_draft DROP CONSTRAINT wf_action_draft_status_check;
DROP INDEX public.wf_action_draft_one_per_approval;
ALTER TABLE public.wf_action_draft DROP CONSTRAINT wf_action_draft_approval_fk;
ALTER TABLE public.wf_action_draft DROP COLUMN approval_id;
ALTER TABLE public.wf_action_draft ADD CONSTRAINT wf_action_draft_status_check
  CHECK (status IN ('draft', 'approved', 'rejected', 'expired'));
ALTER TABLE public.wf_action_draft ADD CONSTRAINT wf_action_draft_cap_check CHECK (
  category NOT IN (
    'money_movement', 'safeguarding', 'credential_change', 'public_publish',
    'mass_message', 'external_authority_share', 'unregistered_webhook'
  ) OR status <> 'approved'
);

-- WF-07 evidence tables and functions.
DROP TABLE public.wf_approval_decision;
DROP TABLE public.wf_approval_step_up;
DROP TABLE public.wf_approval_policy;

DROP FUNCTION public.wf_decide_approval(uuid, uuid, text, text, text, uuid);
DROP FUNCTION public.wf_record_step_up(uuid, uuid, text);
DROP FUNCTION public.wf_approval_view(uuid, uuid);
DROP FUNCTION public.wf_inbox_list(uuid, text, integer);
DROP FUNCTION public.wf_audit_step_up_failed(uuid, uuid, text);
DROP FUNCTION public.wf_request_draft_approval(uuid, uuid);
DROP FUNCTION public.wf_request_missing_draft_approvals(integer);
DROP FUNCTION public.wf_expire_approvals(integer);
DROP FUNCTION public.wf_approved_drafts_ready(integer);
DROP FUNCTION public.wf_resume_after_dispatch(uuid, uuid);
DROP FUNCTION public.wf_approver_candidates(uuid, integer);
DROP FUNCTION public.wf_decision_blockers(uuid, uuid, uuid);
DROP FUNCTION public.wf_act_restore(jsonb);
DROP FUNCTION public.wf_act_as(uuid);
DROP FUNCTION public.wf_end_run_for_approval(uuid, uuid, text);
DROP FUNCTION public.wf_run_close_approvals();
DROP FUNCTION public.wf_approval_decision_gate();
DROP FUNCTION public.wf_approval_risk_floor();
DROP FUNCTION public.wf_action_sandbox_outbox_draft_guard();
DROP FUNCTION public.wf_action_draft_approval_guard();
DROP FUNCTION public.wf_action_draft_freeze();
DROP FUNCTION public.wf_draft_approval_gap(uuid, uuid);
DROP FUNCTION public.wf_approval_content_digest(uuid, uuid);
DROP FUNCTION public.wf_draft_template_sha(uuid, text, text);
DROP FUNCTION public.wf_approval_category(uuid, uuid);
DROP FUNCTION public.wf_approval_step_up_guard();
DROP FUNCTION public.wf_approval_decision_guard();
DROP FUNCTION public.wf_approval_policy_guard();
DROP FUNCTION public.wf_approval_required_count(uuid, text, text);
DROP FUNCTION public.wf_is_capped_category(text);

COMMIT;
