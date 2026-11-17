BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_action_type') IS NULL
     OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.wf_webhook_target') IS NULL THEN
    RAISE EXCEPTION 'WF-06 rollback: one or more WF-06 objects are missing';
  END IF;
END
$prereq$;

DROP TABLE public.wf_action_sandbox_outbox;
DROP TABLE public.wf_action_draft;
DROP TABLE public.wf_webhook_target;
DROP TABLE public.wf_action_type;

UPDATE public.cg_tool_registry
   SET enabled = false
 WHERE tool_id IN (
   'workflow.action.email', 'workflow.action.whatsapp', 'workflow.action.sms',
   'workflow.action.in_app', 'workflow.action.webhook'
 );

COMMIT;
