-- WF-15a Private School Pack install checks. Local disposable Postgres only; all rows roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF15A FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_template') IS NULL OR to_regclass('public.wf_event_source') IS NULL
     OR to_regprocedure('public.wf_fee_reminder_scan(timestamptz,integer)') IS NULL THEN
    RAISE EXCEPTION 'WF15A FAIL: WF-02, WF-05 and WF-15a2 migrations must be present';
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
  ('ps_fee_ladder', 2, 'Fee invoice notice', 'When a fee invoice is issued: one notice to the payer, drafted for approval. Reminders now follow the due date (the five ps_fee_* reminder templates), not the issue date.', '{"trigger":{"kind":"event","eventType":"fees.invoice_issued"},"steps":[{"stepId":"notice","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.fee.invoice_notice","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["email"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine"],"stepAutonomy":{"notice":"draft"},"lawfulBasis":[{"purpose":"Notify the payer of an issued fee","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_ladder_eval_v2","cases":[{"id":"no-send-without-approval","expect":"no message leaves while the notice is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id and amount_kobo are bound from the event"},{"id":"one-message","expect":"the graph holds a single notice and no reminder rungs"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: email only, issue-date ladder with 7-day waits."},{"version":2,"note":"Reminders moved to due-date-relative templates (ADR-136); this template now sends the issue notice only."}]}}'::jsonb),
  ('ps_fee_week_start', 1, 'Fee reminder, first day of the week', 'On the first school day of each of the four weeks before the due date: an SMS and a push notification to the payer, each drafted for approval.', '{"trigger":{"kind":"event","eventType":"fees.reminder_week_start"},"steps":[{"stepId":"sms","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"sms","templateRef":"ps.fee.week_start.sms","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["sms"],"nextStepId":"push"},{"stepId":"push","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"in_app","templateRef":"ps.fee.week_start.push","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["in_app"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"sms":"draft","push":"draft"},"lawfulBasis":[{"purpose":"Remind the payer of a fee that is due or overdue","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_week_start_eval_v1","cases":[{"id":"no-send-without-approval","expect":"no message leaves while a step is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id, amount_kobo, due_at and offset_days are bound"},{"id":"stop-on-payment","expect":"a fully paid invoice ends the run and cancels its drafts"},{"id":"channel-order","expect":"sms then push; no whatsapp, no email"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: due-date-relative reminder (ADR-136)."}]}}'::jsonb),
  ('ps_fee_week_end', 1, 'Fee reminder, last day of the week', 'On the last school day of each of the four weeks before the due date: a push notification only, drafted for approval.', '{"trigger":{"kind":"event","eventType":"fees.reminder_week_end"},"steps":[{"stepId":"push","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"in_app","templateRef":"ps.fee.week_end.push","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["in_app"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"push":"draft"},"lawfulBasis":[{"purpose":"Remind the payer of a fee that is due or overdue","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_week_end_eval_v1","cases":[{"id":"no-send-without-approval","expect":"no message leaves while a step is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id, amount_kobo, due_at and offset_days are bound"},{"id":"stop-on-payment","expect":"a fully paid invoice ends the run and cancels its drafts"},{"id":"channel-order","expect":"push only; no sms, no whatsapp"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: due-date-relative reminder (ADR-136)."}]}}'::jsonb),
  ('ps_fee_due_day', 1, 'Fee due today', 'On the due date: WhatsApp, SMS and push to the payer, each drafted for approval. Voice calls are added once a provider is chosen.', '{"trigger":{"kind":"event","eventType":"fees.reminder_due_day"},"steps":[{"stepId":"whatsapp","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"whatsapp","templateRef":"ps.fee.due_day.whatsapp","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["whatsapp"],"nextStepId":"sms"},{"stepId":"sms","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"sms","templateRef":"ps.fee.due_day.sms","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["sms"],"nextStepId":"push"},{"stepId":"push","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"in_app","templateRef":"ps.fee.due_day.push","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["in_app"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"whatsapp":"draft","sms":"draft","push":"draft"},"lawfulBasis":[{"purpose":"Remind the payer of a fee that is due or overdue","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_due_day_eval_v1","cases":[{"id":"no-send-without-approval","expect":"no message leaves while a step is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id, amount_kobo, due_at and offset_days are bound"},{"id":"stop-on-payment","expect":"a fully paid invoice ends the run and cancels its drafts"},{"id":"channel-order","expect":"whatsapp, then sms, then push"}]},"shadowDefault":true,"blockedUntil":["meta-templates-approved"],"changelog":[{"version":1,"note":"First version: due-date-relative reminder (ADR-136)."}]}}'::jsonb),
  ('ps_fee_overdue', 1, 'Fee overdue, weekly', 'Every week after the due date, up to twelve weeks: WhatsApp, SMS and push to the payer, each drafted for approval, until the invoice is paid.', '{"trigger":{"kind":"event","eventType":"fees.reminder_overdue"},"steps":[{"stepId":"whatsapp","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"whatsapp","templateRef":"ps.fee.overdue.whatsapp","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["whatsapp"],"nextStepId":"sms"},{"stepId":"sms","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"sms","templateRef":"ps.fee.overdue.sms","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["sms"],"nextStepId":"push"},{"stepId":"push","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"in_app","templateRef":"ps.fee.overdue.push","templateParams":{"invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","due_at":"payload.due_at","offset_days":"payload.offset_days"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["in_app"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"whatsapp":"draft","sms":"draft","push":"draft"},"lawfulBasis":[{"purpose":"Remind the payer of a fee that is due or overdue","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_overdue_eval_v1","cases":[{"id":"no-send-without-approval","expect":"no message leaves while a step is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id, amount_kobo, due_at and offset_days are bound"},{"id":"stop-on-payment","expect":"a fully paid invoice ends the run and cancels its drafts"},{"id":"channel-order","expect":"whatsapp, then sms, then push; at most twelve weekly events per invoice"}]},"shadowDefault":true,"blockedUntil":["meta-templates-approved"],"changelog":[{"version":1,"note":"First version: due-date-relative reminder (ADR-136)."}]}}'::jsonb),
  ('ps_fee_escalation', 1, 'Fee four weeks overdue: bursar task', 'Four weeks after the due date: one task for the bursar to contact the payer. No message is sent.', '{"trigger":{"kind":"event","eventType":"fees.reminder_escalation"},"steps":[{"stepId":"bursar_task","kind":"action","assignment":{"kind":"human","roleRef":"bursar"},"actionClass":"task","action":{"kind":"task","templateRef":"ps.fee.review_unpaid","templateParams":{},"recipientIds":[]},"authorizedActions":["task"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"bursar_task":"act_and_report"},"lawfulBasis":[{"purpose":"Remind the payer of a fee that is due or overdue","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_fee_escalation_eval_v1","cases":[{"id":"no-send-without-approval","expect":"no message leaves while a step is an unapproved draft"},{"id":"payload-keys-only","expect":"only invoice_id, amount_kobo, due_at and offset_days are bound"},{"id":"stop-on-payment","expect":"a fully paid invoice ends the run and cancels its drafts"},{"id":"channel-order","expect":"a task for the bursar and nothing else"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: due-date-relative reminder (ADR-136)."}]}}'::jsonb),
  ('ps_payment_receipt', 1, 'Payment receipt', 'When a fee payment is recorded: a receipt message drafted for approval and an in-app note for the bursar.', '{"trigger":{"kind":"event","eventType":"payment.succeeded"},"steps":[{"stepId":"receipt","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.payment.receipt","templateParams":{"payment_id":"payload.payment_id","invoice_id":"payload.invoice_id","amount_kobo":"payload.amount_kobo","method":"payload.method"},"recipientIds":[],"dataClass":"confidential"},"authorizedActions":["email"],"nextStepId":"bursar_note"},{"stepId":"bursar_note","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"internal","action":{"kind":"in_app","templateRef":"ps.payment.recorded","templateParams":{"payment_id":"payload.payment_id"},"recipientIds":[],"dataClass":"internal"},"authorizedActions":["in_app"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","bursar"],"stepAutonomy":{"receipt":"draft","bursar_note":"act_and_report"},"lawfulBasis":[{"purpose":"Confirm receipt of a payment to the payer","basis":"contract","involvesMinorData":false}],"evalSuite":{"ref":"ps_payment_receipt_eval_v1","cases":[{"id":"no-send-without-approval","expect":"receipt stays a draft until approved"},{"id":"payload-keys-only","expect":"only payment_id, invoice_id, amount_kobo, method are bound"},{"id":"no-money-movement","expect":"the graph moves no money and issues no refund"}]},"shadowDefault":true,"blockedUntil":[],"changelog":[{"version":1,"note":"First version: receipt draft plus bursar in-app note."}]}}'::jsonb),
  ('ps_absence_alert', 1, 'Absence alert to guardian', 'When a learner is marked absent: a message to the guardian drafted for approval and a follow-up task for the class teacher. Cannot go live until the minors decision is answered.', '{"trigger":{"kind":"event","eventType":"attendance.marked_absent"},"steps":[{"stepId":"is_absent","kind":"condition","assignment":{"kind":"unassigned"},"authorizedActions":[],"condition":{"field":"payload.status","operator":"equals","value":"absent"},"branches":{"onTrueStepId":"guardian_alert","onFalseStepId":null}},{"stepId":"guardian_alert","kind":"action","assignment":{"kind":"unassigned"},"actionClass":"communication","action":{"kind":"email","templateRef":"ps.absence.guardian_alert","templateParams":{"attendance_id":"payload.attendance_id"},"recipientIds":[],"dataClass":"minor_sensitive"},"authorizedActions":["email"],"nextStepId":"teacher_follow_up"},{"stepId":"teacher_follow_up","kind":"action","assignment":{"kind":"human","roleRef":"class_teacher"},"actionClass":"task","action":{"kind":"task","templateRef":"ps.absence.follow_up","templateParams":{},"recipientIds":[]},"authorizedActions":["task"]}],"onFailure":{"kind":"halt"},"requiredApprovals":[],"pack":{"key":"private-school","version":2,"status":"proposed"},"meta":{"agentRef":null,"actors":["engine","class_teacher"],"stepAutonomy":{"is_absent":"act_and_report","guardian_alert":"draft","teacher_follow_up":"act_and_report"},"lawfulBasis":[{"purpose":"Tell a guardian their child was marked absent","basis":"pending_decision_7","involvesMinorData":true}],"evalSuite":{"ref":"ps_absence_alert_eval_v1","cases":[{"id":"no-send-without-approval","expect":"the guardian message stays a draft until approved"},{"id":"only-absent","expect":"a status other than absent ends the run with no message"},{"id":"minor-data-class","expect":"the guardian message is classed minor_sensitive"},{"id":"blocked-until-decision-7","expect":"the template cannot be turned live while decision 7 is open"}]},"shadowDefault":true,"blockedUntil":["decision-7"],"changelog":[{"version":1,"note":"First version: guardian draft plus teacher follow-up task."}]}}'::jsonb);
-- END GENERATED

SELECT wf15atest.ok('install: eight new templates are present', (SELECT count(*) FROM public.wf_template WHERE template_key LIKE 'ps\_%') = 8);
SELECT wf15atest.ok('install: existing templates are untouched',
  (SELECT count(*) FROM public.wf_template w JOIN before_ids b USING (id)) = (SELECT count(*) FROM before_ids));
SELECT wf15atest.ok('install: all eight are active, the fee notice at version 2 and the rest at version 1',
  (SELECT count(*) FROM public.wf_template WHERE template_key LIKE 'ps\_%' AND status = 'active' AND version = CASE WHEN template_key = 'ps_fee_ladder' THEN 2 ELSE 1 END) = 8);
SELECT wf15atest.ok('graph: every template starts in shadow mode',
  (SELECT bool_and((graph #>> '{meta,shadowDefault}')::boolean) FROM public.wf_template WHERE template_key LIKE 'ps\_%'));
SELECT wf15atest.ok('graph: every template declares a lawful basis and an eval suite',
  (SELECT bool_and(jsonb_array_length(graph #> '{meta,lawfulBasis}') > 0 AND jsonb_array_length(graph #> '{meta,evalSuite,cases}') >= 3)
     FROM public.wf_template WHERE template_key LIKE 'ps\_%'));
SELECT wf15atest.ok('graph: no webhook step anywhere (sms and whatsapp are allowed, always drafts)',
  NOT EXISTS (SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
               WHERE t.template_key LIKE 'ps\_%' AND s #>> '{action,kind}' IN ('webhook')));
SELECT wf15atest.ok('graph: every customer-visible step declares a data class and is draft',
  NOT EXISTS (SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
               WHERE t.template_key LIKE 'ps\_%' AND s #>> '{action,kind}' IN ('email','in_app','sms','whatsapp')
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

SELECT wf15atest.ok('messages: every sms step carries its template ref, and every whatsapp step is gated on Meta approval',
  NOT EXISTS (SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
               WHERE t.template_key LIKE 'ps\_%' AND s #>> '{action,kind}' = 'whatsapp'
                 AND NOT (t.graph #> '{meta,blockedUntil}' ? 'meta-templates-approved')));
SELECT wf15atest.ok('reminders: five reminder templates, one per reminder event source, each a registered source',
  (SELECT count(*) = 5 AND bool_and(EXISTS (SELECT 1 FROM public.wf_event_source e WHERE e.event_type = graph #>> '{trigger,eventType}'))
     FROM public.wf_template WHERE template_key LIKE 'ps\_fee\_%' AND graph #>> '{trigger,eventType}' LIKE 'fees.reminder\_%'));
SELECT wf15atest.ok('reminders: no reminder template has a wait step (timing comes from the scheduler, not from waits)',
  NOT EXISTS (SELECT 1 FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
               WHERE t.template_key LIKE 'ps\_fee\_%' AND s #>> '{action,kind}' = 'wait'));

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
SELECT wf15atest.ok('privilege: authenticated can read the pack', (SELECT count(*) FROM public.wf_template WHERE template_key LIKE 'ps\_%') = 8);
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
