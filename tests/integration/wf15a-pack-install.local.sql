-- WF-15a Private School Pack install checks. Local disposable Postgres only; all rows roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF15A FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_template') IS NULL OR to_regclass('public.wf_event_source') IS NULL THEN
    RAISE EXCEPTION 'WF15A FAIL: WF-02 and WF-05 migrations must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf15atest;
CREATE TABLE wf15atest.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT USAGE ON SCHEMA wf15atest TO authenticated;
GRANT SELECT, INSERT ON wf15atest.passed TO authenticated;
GRANT USAGE ON SEQUENCE wf15atest.passed_n_seq TO authenticated;
CREATE FUNCTION wf15atest.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF15A FAIL [%]', p_label; END IF;
  INSERT INTO wf15atest.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF15A PASS %', p_label;
END $$;

SELECT wf15atest.ok('stubs: the three WF-02 generic templates exist before install',
  (SELECT count(*) FROM public.wf_template WHERE template_key IN ('payment_due_reminder_ladder','paystack_payment_receipt','member_absence_alert') AND version = 1) = 3);
CREATE TEMP TABLE before_ids AS SELECT id FROM public.wf_template;

-- BEGIN GENERATED (from packInsertSql(); a unit test fails if this block drifts)
INSERT INTO public.wf_template (template_key, version, name, description, graph) VALUES
  ('ps_fee_ladder', 1, 'Fee reminder ladder', 'When a fee invoice is issued: a notice, a reminder after 7 days and a final notice after 14 days, then a task for the bursar. Each message is a draft a person approves; the approver can skip a rung once the invoice is paid.', '{"trigger":{"kind":"event","eventType":"fees.invoice_issued"},"steps":[{"stepId":"notice","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.fee.invoice_notice","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["email"],"nextStepId":"wait_1"},{"stepId":"wait_1","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"wait","action":{"kind":"wait","templateParams":{"duration_seconds":604800},"recipientIds":[]},"authorizedActions":["wait"],"nextStepId":"reminder"},{"stepId":"reminder","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.fee.reminder","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["email"],"nextStepId":"wait_2"},{"stepId":"wait_2","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"wait","action":{"kind":"wait","templateParams":{"duration_seconds":604800},"recipientIds":[]},"authorizedActions":["wait"],"nextStepId":"final_notice"},{"stepId":"final_notice","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.fee.final_notice","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["email"],"nextStepId":"bursar_task"},{"stepId":"bursar_task","kind":"action","assignment":{"kind":"human","roleRef":"bursar"},"actionClass":"task","action":{"kind":"task","templateRef":"ps.fee.review_unpaid","templateParams":{},"recipientIds":[]},"authorizedActions":["task"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":1,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"notice":"draft","reminder":"draft","final_notice":"draft","bursar_task":"act_and_report","wait_1":"act_and_report","wait_2":"act_and_report"},"lawfulBasis":[{"purpose":"Notify the payer of an issued fee and its follow-up","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_ladder_eval_v1","cases":[{"id":"no-send-without-approval","expect":"no message leaves while any rung is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id and amount_kobo are bound from the event"},{"id":"no-sms-whatsapp","expect":"the graph contains no sms, whatsapp or webhook step"},{"id":"ladder-order","expect":"notice precedes reminder precedes final notice with 7-day waits"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: email only, every rung approved, bursar task at the end."}]}}'::jsonb),
  ('ps_payment_receipt', 1, 'Payment receipt', 'When a fee payment is recorded: a receipt message drafted for approval and an in-app note for the bursar.', '{"trigger":{"kind":"event","eventType":"payment.succeeded"},"steps":[{"stepId":"receipt","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.payment.receipt","templateParams":{"payment_id":"payload.payment_id","invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","method":"payload.method"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["email"],"nextStepId":"bursar_note"},{"stepId":"bursar_note","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"internal","action":{"kind":"in_app","templateRef":"ps.payment.recorded","templateParams":{"payment_id":"payload.payment_id"},"recipientIds":[],"dataClass":"internal"},"authorizedActions":["in_app"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":1,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"receipt":"draft","bursar_note":"act_and_report"},"lawfulBasis":[{"purpose":"Confirm receipt of a payment to the payer","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_payment_receipt_eval_v1","cases":[{"id":"no-send-without-approval","expect":"receipt stays a draft until approved"},{"id":"payload-keys-only","expect":"only payment_id, invoice_id, amount_kobo, method are bound"},{"id":"no-money-movement","expect":"the graph moves no money and issues no refund"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: receipt draft plus bursar in-app note."}]}}'::jsonb),
  ('ps_absence_alert', 1, 'Absence alert to guardian', 'When a learner is marked absent: a message to the guardian drafted for approval and a follow-up task for the class teacher. Cannot go live until the minors decision is answered.', '{"trigger":{"kind":"event","eventType":"attendance.marked_absent"},"steps":[{"stepId":"is_absent","kind":"condition","assignment":{"kind":"unassigned"},"authorizedActions":[],"condition":{"field":"payload.status","operator":"equals","value":"absent"},"branches":{"onTrueStepId":"guardian_alert","onFalseStepId":null}},{"stepId":"guardian_alert","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.absence.guardian_alert","templateParams":{"attendance_id":"payload.attendance_id"},"recipientIds":[],"dataClass":"minor_sensitive"},"authorizedActions":["email"],"nextStepId":"teacher_follow_up"},{"stepId":"teacher_follow_up","kind":"action","assignment":{"kind":"human","roleRef":"class_teacher"},"actionClass":"task","action":{"kind":"task","templateRef":"ps.absence.follow_up","templateParams":{},"recipientIds":[]},"authorizedActions":["task"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":1,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","class_teacher"],"stepAutonomy":{"is_absent":"act_and_report","guardian_alert":"draft","teacher_follow_up":"act_and_report"},"lawfulBasis":[{"purpose":"Tell a guardian their child was marked absent","basis":"pending_decision_7","involvesMinorData":true}],"evalSuite":{"ref":"ps_absence_alert_eval_v1","cases":[{"id":"no-send-without-approval","expect":"the guardian message stays a draft until approved"},{"id":"only-absent","expect":"a status other than absent ends the run with no message"},{"id":"minor-data-class","expect":"the guardian message is classed minor_sensitive"},{"id":"blocked-until-decision-7","expect":"the template cannot be turned live while decision 7 is open"}]},"shadowDefault":true,"blockedUntil":["decision-7"],"changelog":[{"version":1,"note":"First version: guardian draft plus teacher follow-up task."}]}}'::jsonb);
-- END GENERATED

SELECT wf15atest.ok('install: three new templates are present', (SELECT count(*) FROM public.wf_template WHERE template_key LIKE 'ps\_%') = 3);
SELECT wf15atest.ok('install: existing templates are untouched',
  (SELECT count(*) FROM public.wf_template w JOIN before_ids b USING (id)) = (SELECT count(*) FROM before_ids));
SELECT wf15atest.ok('install: all three are active version 1',
  (SELECT count(*) FROM public.wf_template WHERE template_key LIKE 'ps\_%' AND version = 1 AND status = 'active') = 3);
SELECT wf15atest.ok('graph: every template starts in shadow mode',
  (SELECT bool_and((graph #>> '{meta,shadowDefault}')::boolean) FROM public.wf_template WHERE template_key LIKE 'ps\_%'));
SELECT wf15atest.ok('graph: every template declares a lawful basis and an eval suite',
  (SELECT bool_and(jsonb_array_length(graph #> '{meta,lawfulBasis}') > 0 AND jsonb_array_length(graph #> '{meta,evalSuite,cases}') >= 3)
     FROM public.wf_template WHERE template_key LIKE 'ps\_%'));
SELECT wf15atest.ok('graph: no sms, whatsapp or webhook step anywhere',
  NOT EXISTS (SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
               WHERE t.template_key LIKE 'ps\_%' AND s #>> '{action,kind}' IN ('sms','whatsapp','webhook')));
SELECT wf15atest.ok('graph: every customer-visible step declares a data class and is draft',
  NOT EXISTS (SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
               WHERE t.template_key LIKE 'ps\_%' AND s #>> '{action,kind}' IN ('email','in_app')
                 AND (s #>> '{action,dataClass}' IS NULL
                      OR (s #>> '{action,dataClass}' <> 'internal' AND t.graph #>> ARRAY['meta','stepAutonomy', s->>'stepId'] <> 'draft'))));
SELECT wf15atest.ok('trigger: each trigger event is a registered WF-05 source',
  NOT EXISTS (SELECT 1 FROM public.wf_template t WHERE t.template_key LIKE 'ps\_%'
               AND NOT EXISTS (SELECT 1 FROM public.wf_event_source e WHERE e.event_type = t.graph #>> '{trigger,eventType}')));
SELECT wf15atest.ok('trigger: every bound payload key exists on the trigger event source',
  NOT EXISTS (
    SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s,
                  jsonb_each_text(coalesce(s #> '{action,templateParams}', '{}'::jsonb)) p
     WHERE t.template_key LIKE 'ps\_%' AND p.value LIKE 'payload.%'
       AND NOT EXISTS (SELECT 1 FROM public.wf_event_source e
                        WHERE e.event_type = t.graph #>> '{trigger,eventType}'
                          AND substr(p.value, 9) = ANY (e.payload_keys))));
SELECT wf15atest.ok('minors: the absence alert is blocked until decision 7',
  (SELECT graph #> '{meta,blockedUntil}' ? 'decision-7' FROM public.wf_template WHERE template_key = 'ps_absence_alert'));
SELECT wf15atest.ok('minors: only the absence alert carries minor data',
  (SELECT array_agg(template_key ORDER BY template_key) FROM public.wf_template
     WHERE template_key LIKE 'ps\_%' AND graph::text LIKE '%minor_sensitive%') = ARRAY['ps_absence_alert']);

-- constraints and privileges
DO $c$
BEGIN
  BEGIN
    INSERT INTO public.wf_template (template_key, version, name, description, graph)
    SELECT template_key, version, name, description, graph FROM public.wf_template WHERE template_key = 'ps_fee_ladder';
    RAISE EXCEPTION 'WF15A FAIL [duplicate key/version accepted]';
  EXCEPTION WHEN unique_violation THEN
    PERFORM wf15atest.ok('constraint: a duplicate key and version is rejected', true);
  END;
END $c$;
SET LOCAL ROLE authenticated;
SELECT wf15atest.ok('privilege: authenticated can read the pack', (SELECT count(*) FROM public.wf_template WHERE template_key LIKE 'ps\_%') = 3);
DO $p$
BEGIN
  BEGIN
    INSERT INTO public.wf_template (template_key, version, name, description, graph) VALUES ('ps_evil', 1, 'x', 'x', '{}'::jsonb);
    RAISE EXCEPTION 'WF15A FAIL [authenticated could write the catalogue]';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM wf15atest.ok('privilege: authenticated cannot write the catalogue', true);
  END;
END $p$;
RESET ROLE;

-- rollback shape: removing the pack leaves the generic templates
DELETE FROM public.wf_template WHERE template_key LIKE 'ps\_%';
SELECT wf15atest.ok('rollback: deleting the pack leaves the original templates',
  (SELECT count(*) FROM public.wf_template) = (SELECT count(*) FROM before_ids));

DO $summary$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM wf15atest.passed;
  IF v_count < 16 THEN RAISE EXCEPTION 'WF15A FAIL: expected at least 16 checks, got %', v_count; END IF;
  RAISE NOTICE 'WF15A ALL PASS: % checks', v_count;
END $summary$;
ROLLBACK;
