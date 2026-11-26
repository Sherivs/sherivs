-- WF-12: the service role may execute exactly these non-trigger wf_* functions, and no others.
--
-- Run it on a database whose migrator has Supabase's default privileges in force (ALTER DEFAULT PRIVILEGES ... GRANT ALL
-- ... TO anon, authenticated, service_role), after WF-08 and WF-12 were re-applied under them (see verify.yml, "privileges
-- under Supabase default privileges"). Under those defaults a function a migration forgets to revoke is executable by
-- service_role; this file turns that into a failure, for WF-03, WF-05, WF-06, WF-07, WF-08, WF-12, AIN-01, AIN-02 and AIN-03 alike.
-- The list is the set the server legitimately calls; adding a server-called function means adding it here on purpose.
CREATE TEMP TABLE wf12_priv_allowed (sig text PRIMARY KEY);
INSERT INTO wf12_priv_allowed VALUES
  ('wf_agent_registry_get(p_actor uuid)'),
  ('wf_ai_route_approved()'),
  ('wf_approval_view(p_actor uuid, p_approval uuid)'),
  ('wf_approved_drafts_ready(p_limit integer)'),
  ('wf_approver_candidates(p_approval uuid, p_limit integer)'),
  ('wf_audit_step_up_failed(p_actor uuid, p_approval uuid, p_reason text)'),
  ('wf_autonomy_demote(p_actor uuid, p_org uuid, p_agent text, p_to_level text, p_reason text)'),
  ('wf_autonomy_promote(p_actor uuid, p_org uuid, p_agent text, p_to_level text, p_evidence uuid, p_reason text)'),
  ('wf_autonomy_record_evidence(p_agent text, p_suite text, p_graded integer, p_passed integer, p_critical_failures integer, p_ungraded integer, p_evaluated_at timestamp with time zone, p_content_sha256 text)'),
  ('wf_block_draft_dispatch(p_org uuid, p_draft uuid, p_code text)'),
  ('wf_can(p_org uuid, p_perm text)'),
  ('wf_claim_due_events(p_worker text, p_limit integer, p_lease_seconds integer)'),
  ('wf_claim_due_steps(p_worker text, p_limit integer, p_lease_seconds integer)'),
  ('wf_create_event_run(p_run uuid, p_event uuid, p_lease_owner text, p_binding uuid, p_template uuid, p_agent_ref text, p_started_at timestamp with time zone, p_deadline_at timestamp with time zone, p_max_depth integer, p_max_steps integer, p_step_key text, p_step_kind text, p_action_class text, p_budget_units integer, p_max_attempts integer, p_timeout_seconds integer, p_input jsonb, p_run_state jsonb)'),
  ('wf_decide_approval(p_actor uuid, p_approval uuid, p_decision text, p_note text, p_digest text, p_step_up uuid)'),
  ('wf_emit_event(p_org uuid, p_type text, p_source text, p_dedupe text, p_subject text, p_payload jsonb)'),
  ('wf_expire_approvals(p_limit integer)'),
  ('wf_inbox_list(p_actor uuid, p_status text, p_limit integer)'),
  ('wf_limits_get(p_actor uuid)'),
  ('wf_limits_update(p_actor uuid, p_patch jsonb)'),
  ('wf_memory_agent_propose(p_run uuid, p_scope_kind text, p_scope_ref text, p_key text, p_value jsonb, p_ttl_days integer)'),
  ('wf_memory_agent_read(p_run uuid, p_scope_kind text, p_limit integer)'),
  ('wf_memory_decide(p_actor uuid, p_item uuid, p_decision text)'),
  ('wf_memory_purge_expired(p_max_rows integer)'),
  ('wf_memory_put(p_actor uuid, p_scope_kind text, p_scope_ref text, p_key text, p_class text, p_value jsonb, p_ttl_days integer, p_ai_readable boolean)'),
  ('wf_memory_retire(p_actor uuid, p_item uuid)'),
  ('wf_note_draft_dispatch_failure(p_org uuid, p_draft uuid)'),
  ('wf_persist_step_transition(p_step uuid, p_lease_owner text, p_attempt integer, p_step_status text, p_retry_at timestamp with time zone, p_error_code text, p_run_status text, p_run_finished_at timestamp with time zone, p_run_state jsonb, p_next_step_key text, p_next_iteration integer, p_next_kind text, p_next_action_class text, p_next_budget_units integer, p_next_idempotency_key text, p_next_max_attempts integer, p_next_timeout_seconds integer)'),
  ('wf_quota_check_action(p_org uuid, p_kind text, p_recipients integer, p_mode text, p_run uuid)'),
  ('wf_quota_note_denial(p_org uuid, p_limit text, p_kind text)'),
  ('wf_quota_runs_exceeded(p_org uuid)'),
  ('wf_record_step_up(p_actor uuid, p_approval uuid, p_digest text)'),
  ('wf_request_draft_approval(p_org uuid, p_draft uuid)'),
  ('wf_request_missing_draft_approvals(p_limit integer)'),
  ('wf_resume_after_dispatch(p_org uuid, p_draft uuid)'),
  ('wf_retention_run_manual(p_actor uuid, p_dry_run boolean, p_dry_run_id uuid)'),
  ('wf_retention_run_scheduled(p_max_orgs integer)'),
  ('wf_run_cancel(p_actor uuid, p_run uuid, p_reason text)'),
  ('wf_run_history_detail(p_actor uuid, p_run uuid)'),
  ('wf_run_history_list(p_actor uuid, p_status text, p_workflow text, p_before timestamp with time zone, p_limit integer, p_before_id uuid)'),
  ('wf_run_retry(p_actor uuid, p_step uuid, p_reason text)');
DO $$
DECLARE v_extra text; v_missing text;
BEGIN
  SELECT string_agg(sig, ', ' ORDER BY sig) INTO v_extra FROM (
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'wf\_%' AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('service_role', p.oid, 'EXECUTE')) x
   WHERE sig NOT IN (SELECT sig FROM wf12_priv_allowed);
  SELECT string_agg(a.sig, ', ' ORDER BY a.sig) INTO v_missing FROM wf12_priv_allowed a
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = a.sig
                       AND has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF v_extra IS NOT NULL THEN RAISE EXCEPTION 'WF12-PRIV FAIL: executable by service_role but not on the list: %', v_extra; END IF;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'WF12-PRIV FAIL: on the list but not executable by service_role: %', v_missing; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'wf\_%'
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) AND p.prorettype <> 'trigger'::regtype
               AND p.proname NOT IN ('wf_can')) THEN
    RAISE EXCEPTION 'WF12-PRIV FAIL: a wf_* function is executable by a client role';
  END IF;
  RAISE NOTICE 'WF12-PRIV ALL PASS: % functions checked', (SELECT count(*) FROM wf12_priv_allowed);
END $$;
