-- SCRATCH-DATABASE CHECK. NEVER RUN ON A REAL PROJECT.
-- Behavioural check for ENGINE-20_org_agent_addons_events_reports.sql. It stubs the Supabase pieces the
-- proposal depends on (auth.uid, auth.role, is_super_admin, scholar_can, get_my_school_id, schools,
-- users, three roles), so it runs on a throwaway local Postgres 16:
--   1. psql -d scratch -f this file's stub section (everything before "-- ---- checks ----")
--   2. psql -d scratch -f database/proposals/ENGINE-20_org_agent_addons_events_reports.sql
--   3. psql -d scratch -f this file's checks section
-- Every row printed at the end must say PASS.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.sheriff', true), 'off') = 'on' $$;
CREATE FUNCTION public.get_my_school_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.school', true), '')::uuid $$;
CREATE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.is_super_admin() OR (coalesce(current_setting('test.manage', true), 'off') = 'on' AND public.get_my_school_id() = p_org) $$;
CREATE TABLE public.schools (id uuid PRIMARY KEY, subscription_tier text, subscription_status text);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid, is_active boolean DEFAULT true);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), public.is_super_admin(), public.get_my_school_id(), public.scholar_can(uuid, text) TO anon, authenticated, service_role;
GRANT SELECT ON public.schools, public.users TO authenticated, service_role;
-- ---- checks ----
INSERT INTO public.schools VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','growth','active'),
  ('aaaaaaaa-0000-0000-0000-000000000002','starter','active'),
  ('aaaaaaaa-0000-0000-0000-000000000003','enterprise','suspended'),
  ('aaaaaaaa-0000-0000-0000-000000000004','mystery','active'),
  ('aaaaaaaa-0000-0000-0000-000000000005','enterprise','active');
INSERT INTO public.users VALUES
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',true),
  ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001',true),
  ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001',false),
  ('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-000000000002',true);
CREATE TEMP TABLE results(name text, ok boolean);
GRANT ALL ON results TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.try(p_name text, p_sql text, p_expect text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text := 'ok';
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  INSERT INTO results VALUES (p_name || ' => ' || msg, msg = p_expect);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_actor(p_uid text, p_school text, p_manage boolean, p_sheriff boolean, p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.uid', p_uid, false);
  PERFORM set_config('test.school', p_school, false);
  PERFORM set_config('test.manage', CASE WHEN p_manage THEN 'on' ELSE 'off' END, false);
  PERFORM set_config('test.sheriff', CASE WHEN p_sheriff THEN 'on' ELSE 'off' END, false);
  PERFORM set_config('test.role', p_role, false);
END $$;

-- catalog: 17 agents, the seeded plan placement
INSERT INTO results SELECT 'catalog has 17 agents', (SELECT count(*) FROM public.org_agent_catalog) = 17;
INSERT INTO results SELECT 'tier rank unknown counts as trial', public.org_tier_rank('mystery') = 1 AND public.org_tier_rank(NULL) = 1 AND public.org_tier_rank(' Growth ') = 3;

-- organization administrator on a growth plan (org 1)
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001', true, false, 'authenticated');
SELECT pg_temp.try('enable included agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''enable'')', 'ok');
SELECT pg_temp.try('enable twice', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''enable'')', 'already_enabled');
SELECT pg_temp.try('enable agent above the plan', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-compliance'',''enable'')', 'plan_excludes_agent');
SELECT pg_temp.try('enable last growth agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''enable'')', 'ok');
SELECT pg_temp.try('unknown agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-nobody'',''enable'')', 'unknown_agent');
SELECT pg_temp.try('unknown action', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''delete'')', 'unknown_action');
SELECT pg_temp.try('unknown organization', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-0000000000ff'',''org-fees'',''enable'')', 'unknown_organization');
SELECT pg_temp.try('pause needs a reason', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''pause'',''short'')', 'reason_too_short');
SELECT pg_temp.try('pause enabled agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''pause'',''Reviewing fee reminders this week'')', 'ok');
SELECT pg_temp.try('pause twice', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''pause'',''Reviewing fee reminders this week'')', 'already_paused');
SELECT pg_temp.try('pause agent that is off', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-timetable'',''pause'',''Not switched on, so nothing to pause'')', 'not_enabled');
SELECT pg_temp.try('resume own pause', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''resume'',''Review finished, carry on'')', 'ok');
SELECT pg_temp.try('resume when running', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''resume'',''Review finished, carry on'')', 'not_paused');
SELECT pg_temp.try('disable', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''disable'')', 'ok');
SELECT pg_temp.try('disable when off', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''disable'')', 'not_enabled');
SELECT pg_temp.try('administrator cannot platform pause', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''platform_pause'',''Trying to use the platform switch'')', 'platform_action_needs_sheriff');
INSERT INTO results SELECT 'state: fees on and running', (SELECT enabled AND NOT paused AND NOT platform_paused FROM public.org_agent_state('aaaaaaaa-0000-0000-0000-000000000001','org-fees'));
INSERT INTO results SELECT 'state: records off', (SELECT NOT enabled FROM public.org_agent_state('aaaaaaaa-0000-0000-0000-000000000001','org-records'));

-- someone without settings.manage, another organization's administrator, an anonymous caller
SELECT pg_temp.as_actor('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001', false, false, 'authenticated');
SELECT pg_temp.try('member without permission', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-support'',''enable'')', 'not_allowed');
SELECT pg_temp.as_actor('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-000000000002', true, false, 'authenticated');
SELECT pg_temp.try('other organization administrator', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-support'',''enable'')', 'not_allowed');
SELECT pg_temp.try('starter plan: starter agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000002'',''org-attendance'',''enable'')', 'ok');
SELECT pg_temp.try('starter plan: growth agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000002'',''org-exams'',''enable'')', 'plan_excludes_agent');
SELECT pg_temp.as_actor('', '', false, false, 'authenticated');
SELECT pg_temp.try('anonymous', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-support'',''enable'')', 'not_authenticated');
INSERT INTO results SELECT 'state hidden from outsiders', (SELECT count(*) FROM public.org_agent_state('aaaaaaaa-0000-0000-0000-000000000001','org-fees')) = 0;

-- organization on an unknown plan counts as the trial; suspended organization cannot switch anything on
SELECT pg_temp.as_actor('', '', false, true, 'authenticated');
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000004', true, false, 'authenticated');
SELECT pg_temp.try('unknown plan, trial agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000004'',''org-support'',''enable'')', 'ok');
SELECT pg_temp.try('unknown plan, starter agent', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000004'',''org-fees'',''enable'')', 'plan_excludes_agent');
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000003', true, false, 'authenticated');
SELECT pg_temp.try('suspended organization', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000003'',''org-support'',''enable'')', 'organization_inactive');

-- platform pause (sheriff) and who can lift it
SELECT pg_temp.as_actor('99999999-9999-9999-9999-999999999999','', false, true, 'authenticated');
SELECT pg_temp.try('sheriff platform pause', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''platform_pause'',''Investigating a wrong reminder batch'')', 'ok');
SELECT pg_temp.try('sheriff pause twice', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''platform_pause'',''Investigating a wrong reminder batch'')', 'already_paused');
INSERT INTO results SELECT 'state: platform paused', (SELECT paused AND platform_paused FROM public.org_agent_state('aaaaaaaa-0000-0000-0000-000000000001','org-fees'));
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001', true, false, 'authenticated');
SELECT pg_temp.try('organization cannot lift platform pause', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''resume'',''Please let this agent run again'')', 'paused_by_platform');
SELECT pg_temp.try('organization cannot lift via platform_resume', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''platform_resume'',''Please let this agent run again'')', 'platform_action_needs_sheriff');
SELECT pg_temp.try('organization may still disable', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''enable'')', 'ok');
SELECT pg_temp.as_actor('99999999-9999-9999-9999-999999999999','', false, true, 'authenticated');
SELECT pg_temp.try('platform resume needs a platform pause', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''platform_resume'',''Nothing to lift here today'')', 'not_paused_by_platform');
SELECT pg_temp.try('sheriff lifts platform pause', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''platform_resume'',''Cause found and fixed, resuming'')', 'ok');
INSERT INTO results SELECT 'state: running again', (SELECT enabled AND NOT paused FROM public.org_agent_state('aaaaaaaa-0000-0000-0000-000000000001','org-fees'));

-- add-on log is append-only
SELECT pg_temp.try('addon log update blocked', 'UPDATE public.org_agent_addon_events SET reason = ''tampered tampered''', 'org_agent_addon_events is append-only');
SELECT pg_temp.try('addon log delete blocked', 'DELETE FROM public.org_agent_addon_events', 'org_agent_addon_events is append-only');

-- events: only the service role raises them, and only for a running agent
SELECT pg_temp.as_actor('', '', false, false, 'authenticated');
SELECT pg_temp.try('authenticated cannot raise', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''money'',''attention'',''x'',NULL,100,NULL)', 'service_role_only');
SELECT pg_temp.as_actor('', '', false, false, 'service_role');
SELECT pg_temp.try('raise money event', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''money'',''attention'',''Fee collection fell behind'',NULL,250000,''fees-week-46'')', 'ok');
INSERT INTO results SELECT 'duplicate within the hour returns the same event', public.raise_org_agent_event('aaaaaaaa-0000-0000-0000-000000000001','org-fees','money','attention','Fee collection fell behind again',NULL,250000,'fees-week-46') = (SELECT id FROM public.org_agent_events WHERE dedupe_key='fees-week-46');
INSERT INTO results SELECT 'only one row for the duplicate', (SELECT count(*) FROM public.org_agent_events WHERE dedupe_key='fees-week-46') = 1;
SELECT pg_temp.try('money event needs an amount', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''money'',''info'',''No amount'',NULL,NULL,NULL)', 'new row for relation "org_agent_events" violates check constraint "org_agent_events_money_has_amount"');
SELECT pg_temp.try('negative amount refused', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''money'',''info'',''Negative'',NULL,-5,NULL)', 'new row for relation "org_agent_events" violates check constraint "org_agent_events_amount_minor_check"');
SELECT pg_temp.try('agent that is off cannot raise', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-timetable'',''operations'',''info'',''Clash'',NULL,NULL,NULL)', 'agent_not_running');
SELECT pg_temp.try('safeguarding with text refused', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''safeguarding'',''critical'',''A child said something'',''case-1'',NULL,NULL)', 'new row for relation "org_agent_events" violates check constraint "org_agent_events_safeguarding_no_text"');
SELECT pg_temp.try('safeguarding pointer only', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-records'',''safeguarding'',''critical'',NULL,''case-1'',NULL,NULL)', 'ok');
SELECT pg_temp.as_actor('99999999-9999-9999-9999-999999999999','', false, true, 'service_role');
SELECT pg_temp.try('platform pause for next check', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''platform_pause'',''Pausing again to test events'')', 'ok');
SELECT pg_temp.as_actor('', '', false, false, 'service_role');
SELECT pg_temp.try('paused agent cannot raise', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''money'',''info'',''Paused'',NULL,10,NULL)', 'agent_not_running');

-- acknowledgement: once, by someone with settings.manage in that organization
SELECT pg_temp.as_actor('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001', false, false, 'authenticated');
SELECT pg_temp.try('ack without permission', 'SELECT public.ack_org_agent_event((SELECT id FROM public.org_agent_events WHERE dedupe_key=''fees-week-46''))', 'not_allowed');
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001', true, false, 'authenticated');
SELECT pg_temp.try('ack', 'SELECT public.ack_org_agent_event((SELECT id FROM public.org_agent_events WHERE dedupe_key=''fees-week-46''))', 'ok');
INSERT INTO results SELECT 'ack recorded with who', (SELECT acked_at IS NOT NULL AND acked_by = '11111111-1111-1111-1111-111111111111' FROM public.org_agent_events WHERE dedupe_key='fees-week-46');
SELECT pg_temp.as_actor('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-000000000002', true, false, 'authenticated');
SELECT pg_temp.try('ack from another organization', 'SELECT public.ack_org_agent_event((SELECT id FROM public.org_agent_events WHERE kind=''safeguarding''))', 'not_allowed');
SELECT pg_temp.try('events cannot be edited', 'UPDATE public.org_agent_events SET severity = ''info''', 'org_agent_events only allows a single acknowledgement');
SELECT pg_temp.try('events cannot be deleted', 'DELETE FROM public.org_agent_events', 'org_agent_events is append-only');
SELECT pg_temp.try('an acknowledged event is frozen', 'UPDATE public.org_agent_events SET acked_by = gen_random_uuid() WHERE dedupe_key=''fees-week-46''', 'org_agent_events only allows a single acknowledgement');

-- notifications: service role only, recipient in the organization, safeguarding redacted, one per recipient and channel
SELECT pg_temp.as_actor('', '', false, false, 'authenticated');
SELECT pg_temp.try('authenticated cannot enqueue', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',NULL,''11111111-1111-1111-1111-111111111111'',''push'')', 'service_role_only');
SELECT pg_temp.as_actor('', '', false, false, 'service_role');
SELECT pg_temp.try('enqueue push', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',(SELECT id FROM public.org_agent_events WHERE dedupe_key=''fees-week-46''),''11111111-1111-1111-1111-111111111111'',''push'')', 'ok');
INSERT INTO results SELECT 'second identical enqueue is ignored', public.enqueue_org_notification('aaaaaaaa-0000-0000-0000-000000000001',(SELECT id FROM public.org_agent_events WHERE dedupe_key='fees-week-46'),'11111111-1111-1111-1111-111111111111','push') IS NULL
  AND (SELECT count(*) FROM public.org_notification_outbox) = 1;
SELECT pg_temp.try('recipient from another organization', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',NULL,''44444444-4444-4444-4444-444444444444'',''push'')', 'recipient_not_in_organization');
SELECT pg_temp.try('inactive recipient', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',NULL,''33333333-3333-3333-3333-333333333333'',''push'')', 'recipient_not_in_organization');
SELECT pg_temp.try('safeguarding must be redacted', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',(SELECT id FROM public.org_agent_events WHERE kind=''safeguarding''),''11111111-1111-1111-1111-111111111111'',''push'')', 'safeguarding_must_be_redacted');
SELECT pg_temp.try('redacted payload carries no summary', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',(SELECT id FROM public.org_agent_events WHERE kind=''safeguarding''),''11111111-1111-1111-1111-111111111111'',''whatsapp'',now(),true,''{"summary":"leak"}''::jsonb)', 'new row for relation "org_notification_outbox" violates check constraint "org_notification_redacted_has_no_summary"');
SELECT pg_temp.try('redacted notification', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',(SELECT id FROM public.org_agent_events WHERE kind=''safeguarding''),''11111111-1111-1111-1111-111111111111'',''whatsapp'',now(),true,''{"text":"Urgent item needs you"}''::jsonb)', 'ok');
SELECT pg_temp.try('event from another organization', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000002'',(SELECT id FROM public.org_agent_events WHERE dedupe_key=''fees-week-46''),''44444444-4444-4444-4444-444444444444'',''push'')', 'event_not_in_organization');
SELECT pg_temp.try('unknown channel', 'SELECT public.enqueue_org_notification(''aaaaaaaa-0000-0000-0000-000000000001'',NULL,''11111111-1111-1111-1111-111111111111'',''sms'')', 'new row for relation "org_notification_outbox" violates check constraint "org_notification_outbox_channel_check"');
SELECT public.enqueue_org_notification('aaaaaaaa-0000-0000-0000-000000000001',NULL,'22222222-2222-2222-2222-222222222222','email',now() + interval '2 hours');

-- claiming and completing
INSERT INTO results SELECT 'claim takes only due rows', (SELECT count(*) FROM public.claim_org_notifications(50)) = 2;
INSERT INTO results SELECT 'claimed rows are now sending', (SELECT count(*) FROM public.org_notification_outbox WHERE status='sending') = 2;
INSERT INTO results SELECT 'a second claim finds nothing', (SELECT count(*) FROM public.claim_org_notifications(50)) = 0;
SELECT public.complete_org_notification((SELECT id FROM public.org_notification_outbox WHERE channel='push'), true);
INSERT INTO results SELECT 'success marks sent', (SELECT status='sent' AND sent_at IS NOT NULL FROM public.org_notification_outbox WHERE channel='push');
SELECT public.complete_org_notification((SELECT id FROM public.org_notification_outbox WHERE channel='whatsapp'), false);
INSERT INTO results SELECT 'failure requeues with a delay', (SELECT status='queued' AND send_after > now() FROM public.org_notification_outbox WHERE channel='whatsapp');
UPDATE public.org_notification_outbox SET status='sending', attempts=5 WHERE channel='whatsapp';
SELECT public.complete_org_notification((SELECT id FROM public.org_notification_outbox WHERE channel='whatsapp'), false);
INSERT INTO results SELECT 'fifth failure is final', (SELECT status='failed' FROM public.org_notification_outbox WHERE channel='whatsapp');
SELECT public.complete_org_notification((SELECT id FROM public.org_notification_outbox WHERE channel='push'), false);
INSERT INTO results SELECT 'a sent row is not touched again', (SELECT status='sent' FROM public.org_notification_outbox WHERE channel='push');
SELECT pg_temp.as_actor('', '', false, false, 'authenticated');
SELECT pg_temp.try('authenticated cannot claim', 'SELECT * FROM public.claim_org_notifications(5)', 'service_role_only');

-- weekly reports: one per organization per window, only organizations with a running agent, active only
SELECT pg_temp.as_actor('', '', false, false, 'service_role');
INSERT INTO results SELECT 'request creates one per running active organization', public.request_org_weekly_reports('2026-11-16 06:00+00') = 3;
INSERT INTO results SELECT 'same window again creates none', public.request_org_weekly_reports('2026-11-16 06:00+00') = 0;
INSERT INTO results SELECT 'next week creates again', public.request_org_weekly_reports('2026-11-23 06:00+00') = 3;
INSERT INTO results SELECT 'suspended organization excluded', NOT EXISTS (SELECT 1 FROM public.org_weekly_reports WHERE org_id='aaaaaaaa-0000-0000-0000-000000000003');
SELECT pg_temp.try('store a report', 'SELECT public.store_org_weekly_report((SELECT id FROM public.org_weekly_reports WHERE org_id=''aaaaaaaa-0000-0000-0000-000000000001'' AND window_end=''2026-11-16 06:00+00''),''whatsapp'',''{"money":250000}''::jsonb,ARRAY[''One item needed you''])', 'ok');
SELECT pg_temp.try('store twice', 'SELECT public.store_org_weekly_report((SELECT id FROM public.org_weekly_reports WHERE org_id=''aaaaaaaa-0000-0000-0000-000000000001'' AND window_end=''2026-11-16 06:00+00''),''whatsapp'',''{}''::jsonb,ARRAY[''x''])', 'report_not_requested');
SELECT pg_temp.try('long line refused', 'SELECT public.store_org_weekly_report((SELECT id FROM public.org_weekly_reports WHERE org_id=''aaaaaaaa-0000-0000-0000-000000000001'' AND window_end=''2026-11-23 06:00+00''),''email'',''{}''::jsonb,ARRAY[repeat(''x'',201)])', 'report_line_too_long');
SELECT pg_temp.as_actor('', '', false, false, 'authenticated');
SELECT pg_temp.try('authenticated cannot request', 'SELECT public.request_org_weekly_reports()', 'service_role_only');

-- grants and row-level security
SELECT pg_temp.as_actor('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001', false, false, 'authenticated');
SET ROLE authenticated;
INSERT INTO pg_temp.results SELECT 'member without permission sees no events', (SELECT count(*) FROM public.org_agent_events) = 0;
INSERT INTO pg_temp.results SELECT 'member without permission sees no addon log', (SELECT count(*) FROM public.org_agent_addon_events) = 0;
INSERT INTO pg_temp.results SELECT 'member without permission sees no reports', (SELECT count(*) FROM public.org_weekly_reports) = 0;
INSERT INTO pg_temp.results SELECT 'member sees the catalog', (SELECT count(*) FROM public.org_agent_catalog) = 17;
INSERT INTO pg_temp.results SELECT 'recipient sees only their own notifications', (SELECT count(*) FROM public.org_notification_outbox) = 1;
RESET ROLE;
SELECT pg_temp.as_actor('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001', true, false, 'authenticated');
SET ROLE authenticated;
INSERT INTO pg_temp.results SELECT 'administrator sees own organization events', (SELECT count(*) FROM public.org_agent_events) = 2;
INSERT INTO pg_temp.results SELECT 'administrator sees own organization reports', (SELECT count(*) FROM public.org_weekly_reports) = 2;
INSERT INTO pg_temp.results SELECT 'administrator sees own organization add-on log', (SELECT count(*) FROM public.org_agent_addon_events) > 0 AND NOT EXISTS (SELECT 1 FROM public.org_agent_addon_events WHERE org_id <> 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT pg_temp.try('authenticated cannot insert events', 'INSERT INTO public.org_agent_events(org_id,agent_code,kind,severity) VALUES (''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''info'',''info'')', 'permission denied for table org_agent_events');
SELECT pg_temp.try('authenticated cannot insert add-on log', 'INSERT INTO public.org_agent_addon_events(org_id,agent_code,action,actor_id) VALUES (''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''enable'',gen_random_uuid())', 'permission denied for table org_agent_addon_events');
SELECT pg_temp.try('authenticated cannot change the catalog', 'UPDATE public.org_agent_catalog SET min_tier = ''trial''', 'permission denied for table org_agent_catalog');
SELECT pg_temp.try('authenticated cannot write notifications', 'INSERT INTO public.org_notification_outbox(org_id,recipient_id,channel) VALUES (''aaaaaaaa-0000-0000-0000-000000000001'',gen_random_uuid(),''push'')', 'permission denied for table org_notification_outbox');
SELECT pg_temp.try('authenticated cannot call raise', 'SELECT public.raise_org_agent_event(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''info'',''info'')', 'permission denied for function raise_org_agent_event');
SELECT pg_temp.try('authenticated cannot call claim', 'SELECT * FROM public.claim_org_notifications(1)', 'permission denied for function claim_org_notifications');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.try('anonymous cannot call change', 'SELECT public.change_org_agent(''aaaaaaaa-0000-0000-0000-000000000001'',''org-fees'',''pause'',''Anonymous attempt to pause'')', 'permission denied for function change_org_agent');
SELECT pg_temp.try('anonymous cannot read events', 'SELECT count(*) FROM public.org_agent_events', 'permission denied for table org_agent_events');
RESET ROLE;

-- every table has row-level security forced
INSERT INTO results SELECT 'rls forced on all five tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('org_agent_catalog','org_agent_addon_events','org_agent_events','org_notification_outbox','org_weekly_reports') AND c.relrowsecurity AND c.relforcerowsecurity) = 5;
INSERT INTO results SELECT 'every function pins search_path', NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('org_tier_rank','org_agent_state','change_org_agent','raise_org_agent_event','ack_org_agent_event','enqueue_org_notification','claim_org_notifications','complete_org_notification','request_org_weekly_reports','store_org_weekly_report','org_append_only','org_agent_events_guard') AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')));
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS r FROM results ORDER BY 2, 1;
