-- Disposable proof for 20261117003400_sherivs_m22_comms_completion.sql (M22, ADR-151).
-- A small production-shaped fixture (only the columns and functions the migration touches or calls), then positive,
-- negative and cross-organization cases, a second run, and the rollback. It is a fixture, not a replay of production.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m22_test -v ON_ERROR_STOP=1 -f tests/sql/m22-comms-completion.sql
\set ON_ERROR_STOP on
SET client_min_messages = notice;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.role', true), '') $$;

-- ---- production-shaped fixture -------------------------------------------------------------------------------------
CREATE TABLE public.schools (id uuid PRIMARY KEY, name text);
CREATE TABLE public.users (id uuid PRIMARY KEY, school_id uuid, role text, phone text, full_name text);
CREATE TABLE public.students (id uuid PRIMARY KEY, school_id uuid NOT NULL, admission_number text, parent_id uuid, user_id uuid);
CREATE TABLE public.parent_student_map (parent_id uuid, student_id uuid, school_id uuid);
CREATE TABLE public.fees (student_id uuid, amount numeric, paid_amount numeric, status text);
CREATE TABLE public.attendance (student_id uuid, status text, date date);
CREATE TABLE public.grades (student_id uuid, subject text, ca_score numeric, exam_score numeric, total_score numeric,
  grade text, term text, academic_year text, is_published boolean);
CREATE TABLE public.result_pins (serial text PRIMARY KEY, batch_id uuid, school_id uuid NOT NULL, pin_hash text NOT NULL,
  student_id uuid, uses int NOT NULL DEFAULT 0, max_uses int NOT NULL, academic_year text NOT NULL, term text NOT NULL,
  first_used_at timestamptz, last_used_at timestamptz);
CREATE TABLE public.ussd_sessions (session_id text PRIMARY KEY, phone text NOT NULL, state text NOT NULL DEFAULT 'menu',
  chosen_student uuid, hits int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.rate_limit_events (bucket text, subject text, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, school_id uuid, user_id uuid, action text, table_name text,
  record_id uuid, old_value jsonb, new_value jsonb);
CREATE TABLE public.feature_flags (key text, org_id uuid, enabled boolean);
CREATE TABLE public.comms_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, org_id uuid, code text NOT NULL,
  channel text NOT NULL, language text NOT NULL DEFAULT 'en', category text NOT NULL, body text NOT NULL,
  wa_template_name text, status text NOT NULL DEFAULT 'approved');
CREATE TABLE public.outbound_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, org_id uuid NOT NULL,
  channel text NOT NULL, status text NOT NULL, provider text NOT NULL DEFAULT 'stub', provider_ref text, reference text NOT NULL,
  template_code text, language text, template_parameters text[] NOT NULL DEFAULT '{}', error text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.cg_delivery_evidence (id text PRIMARY KEY, tenant_id text NOT NULL,
  channel text NOT NULL CONSTRAINT cg_delivery_evidence_channel_check CHECK (channel IN ('email','voice')),
  adapter text NOT NULL, recipient_redacted text NOT NULL, outcome text NOT NULL, outcome_code text NOT NULL,
  reason text NOT NULL, triggered_by text NOT NULL, trigger_source text NOT NULL, provider_message_id text);
CREATE TABLE public.refunds_seen (org uuid, reference text, reason text);

CREATE FUNCTION public._norm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN d ~ '^0\d{10}$' THEN '234' || substr(d, 2) WHEN d ~ '^234\d{10}$' THEN d ELSE d END FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x $$;
CREATE FUNCTION public.rate_limit_take(p_bucket text, p_subject text, p_max integer, p_window interval) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.rate_limit_events WHERE bucket = p_bucket AND subject = p_subject AND at > now() - p_window;
  IF n >= p_max THEN RETURN false; END IF;
  INSERT INTO public.rate_limit_events (bucket, subject) VALUES (p_bucket, p_subject);
  RETURN true;
END $$;
CREATE FUNCTION public.flag_on(p_key text, p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(bool_or(enabled), false) FROM public.feature_flags WHERE key = p_key AND (org_id = p_org OR org_id IS NULL) $$;
-- COMMS-03's refund primitive, modelled: the real one is proven by PR #351's SQL test.
CREATE FUNCTION public._comms_refund_charge(p_org uuid, p_message_reference text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.refunds_seen VALUES (p_org, p_message_reference, p_reason);
  RETURN jsonb_build_object('refunded', true);
END $$;
REVOKE ALL ON FUNCTION public._comms_refund_charge(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
-- check_result exactly as in production (SEC-01).
\i database/supabase/migrations/20261103140000_sherivs_sec01_check_result_uniform.sql
REVOKE ALL ON FUNCTION public.check_result(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_result(text, text, text) TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT INSERT ON public.cg_delivery_evidence TO service_role;

-- The pre-M22 state of the objects the migration replaces (the rollback file holds those exact definitions).
\i database/supabase/rollbacks/20261117003400_sherivs_m22_comms_completion.sql

-- Organizations A and B, one parent each, A's parent has two linked children.
INSERT INTO public.schools VALUES ('11111111-1111-1111-1111-111111111111', 'Org A'), ('22222222-2222-2222-2222-222222222222', 'Org B');
INSERT INTO public.users VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'parent', '08031234567', 'Parent A'),
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'parent', '08027654321', 'Parent B');
INSERT INTO public.students VALUES
  ('00000000-0000-0000-0000-00000000a001', '11111111-1111-1111-1111-111111111111', 'A-001', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-00000000a002', '11111111-1111-1111-1111-111111111111', 'A-002', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-00000000b001', '22222222-2222-2222-2222-222222222222', 'B-001', '00000000-0000-0000-0000-0000000000b1', NULL);
INSERT INTO public.fees VALUES ('00000000-0000-0000-0000-00000000a001', 50000, 20000, 'partial');
INSERT INTO public.grades VALUES
  ('00000000-0000-0000-0000-00000000a001', 'Mathematics', 30, 50, 80, 'A', 'First', '2026/2027', true),
  ('00000000-0000-0000-0000-00000000a001', 'English', 25, 40, 65, 'B', 'First', '2026/2027', true),
  ('00000000-0000-0000-0000-00000000a001', 'Draft', 1, 1, 2, 'F', 'First', '2026/2027', false);
INSERT INTO public.result_pins (serial, school_id, pin_hash, max_uses, academic_year, term) VALUES
  ('SRVA1', '11111111-1111-1111-1111-111111111111', extensions.crypt('111122223333', extensions.gen_salt('bf', 4)), 5, '2026/2027', 'First'),
  ('SRVB1', '22222222-2222-2222-2222-222222222222', extensions.crypt('444455556666', extensions.gen_salt('bf', 4)), 5, '2026/2027', 'First');
INSERT INTO public.comms_templates (school_id, org_id, code, channel, language, category, body, wa_template_name) VALUES
  (NULL, NULL, 'fee_reminder', 'whatsapp', 'en', 'utility', 'Dear parent, {{student}} owes {{amount}} at {{school}}. Pay: {{link}}', 'fee_reminder_v1'),
  (NULL, NULL, 'fee_reminder', 'sms', 'en', 'utility', 'Dear parent, {{student}} owes {{amount}}.', NULL);

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Evaluates a scalar query as a role ('service_role' sets auth.role() too); returns the value or err:SQLSTATE.
CREATE FUNCTION pg_temp.val(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('sim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN others THEN RESET ROLE; PERFORM set_config('sim.role', '', true); RETURN 'err:' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('sim.role', '', true);
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN 'err:' || SQLSTATE; END $$;

-- ---- before the migration ------------------------------------------------------------------------------------------
SELECT pg_temp.expect('before: sms evidence is refused by the old channel vocabulary',
  pg_temp.try($$INSERT INTO public.cg_delivery_evidence VALUES ('e0','11111111-1111-1111-1111-111111111111','sms','x','+23***67','failed','c','r','t','s',NULL)$$), 'err:23514');
SELECT pg_temp.expect('before: the USSD menu has no results option',
  (pg_temp.val('service_role', $$SELECT public.ussd_handle('s0', '+2348031234567', '')$$) LIKE '%4. Results%')::text, 'false');

-- ---- apply (twice: idempotent) -------------------------------------------------------------------------------------
\i database/supabase/migrations/20261117003400_sherivs_m22_comms_completion.sql
\i database/supabase/migrations/20261117003400_sherivs_m22_comms_completion.sql
DELETE FROM public.rate_limit_events;

-- 1. Delivery evidence ---------------------------------------------------------------------------------------------------
SELECT pg_temp.expect('evidence: sms row accepted',
  pg_temp.val('service_role', $$INSERT INTO public.cg_delivery_evidence VALUES ('e1','11111111-1111-1111-1111-111111111111','sms','bulksmsnigeria','+23***67','delivered','delivered','ok','t','s','p1') RETURNING 'ok'$$), 'ok');
SELECT pg_temp.expect('evidence: whatsapp row accepted',
  pg_temp.val('service_role', $$INSERT INTO public.cg_delivery_evidence VALUES ('e2','platform','whatsapp','meta_cloud','+23***99','failed','template_not_registered','r','t','s',NULL) RETURNING 'ok'$$), 'ok');
SELECT pg_temp.expect('evidence: unknown channel still refused',
  pg_temp.try($$INSERT INTO public.cg_delivery_evidence VALUES ('e3','x','fax','x','+23***67','failed','c','r','t','s',NULL)$$), 'err:23514');
SELECT pg_temp.expect('evidence: authenticated cannot write',
  pg_temp.val('authenticated', $$INSERT INTO public.cg_delivery_evidence VALUES ('e4','x','sms','x','+23***67','failed','c','r','t','s',NULL) RETURNING 'ok'$$), 'err:42501');
SELECT pg_temp.expect('evidence: anon cannot read',
  pg_temp.val('anon', $$SELECT count(*)::text FROM public.cg_delivery_evidence$$), 'err:42501');

-- 2. WhatsApp template registry ------------------------------------------------------------------------------------------
SELECT pg_temp.expect('registry: existing approved WhatsApp template backfilled with its placeholder count',
  (SELECT wa_param_count::text FROM public.comms_templates WHERE code = 'fee_reminder' AND channel = 'whatsapp'), '4');
SELECT pg_temp.expect('registry: SMS templates carry no WhatsApp parameter count',
  (SELECT coalesce(wa_param_count::text, 'null') FROM public.comms_templates WHERE code = 'fee_reminder' AND channel = 'sms'), 'null');
SELECT pg_temp.expect('registry: approved WhatsApp template without a template name refused',
  pg_temp.try($$INSERT INTO public.comms_templates (code, channel, category, body, wa_param_count) VALUES ('x1','whatsapp','utility','Hi {{school}}',1)$$), 'err:23514');
SELECT pg_temp.expect('registry: approved WhatsApp template with a wrong parameter count refused',
  pg_temp.try($$INSERT INTO public.comms_templates (code, channel, category, body, wa_template_name, wa_param_count) VALUES ('x2','whatsapp','utility','Hi {{school}} {{date}}','x2_v1',1)$$), 'err:23514');
SELECT pg_temp.expect('registry: approved WhatsApp template without a parameter count refused',
  pg_temp.try($$INSERT INTO public.comms_templates (code, channel, category, body, wa_template_name) VALUES ('x3','whatsapp','utility','Hi {{school}}','x3_v1')$$), 'err:23514');
SELECT pg_temp.expect('registry: a draft may be incomplete',
  pg_temp.try($$INSERT INTO public.comms_templates (code, channel, category, body, status) VALUES ('x4','whatsapp','utility','Hi {{school}}','draft')$$), 'ok');
SELECT pg_temp.expect('registry: a complete approved template is accepted',
  pg_temp.try($$INSERT INTO public.comms_templates (code, channel, category, body, wa_template_name, wa_param_count) VALUES ('x5','whatsapp','utility','Hi {{school}} {{date}}','x5_v1',2)$$), 'ok');
SELECT pg_temp.expect('registry: approving the incomplete draft is refused',
  pg_temp.try($$UPDATE public.comms_templates SET status = 'approved' WHERE code = 'x4'$$), 'err:23514');

-- 3. WhatsApp dispatcher write path ------------------------------------------------------------------------------------
INSERT INTO public.outbound_messages (id, school_id, org_id, channel, status, provider, reference, template_code, language, template_parameters) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'whatsapp', 'queued', 'meta_cloud', 'ref-1', 'fee_reminder', 'en', ARRAY['Ada','NGN 30,000','Org A','https://pay']),
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'whatsapp', 'queued', 'meta_cloud', 'ref-2', 'fee_reminder', 'en', ARRAY['Ada']),
  ('00000000-0000-0000-0000-0000000000f3', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'whatsapp', 'queued', 'meta_cloud', 'ref-3', 'no_such_template', 'en', ARRAY['x']),
  ('00000000-0000-0000-0000-0000000000f4', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'whatsapp', 'queued', 'meta_cloud', 'ref-4', 'fee_reminder', 'en', ARRAY['Ada','NGN 1','Org A','https://pay']),
  ('00000000-0000-0000-0000-0000000000f5', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'whatsapp', 'queued', 'meta_cloud', 'ref-5', 'fee_reminder', 'en', ARRAY['Ada','NGN 1','Org A','https://pay']),
  ('00000000-0000-0000-0000-0000000000f6', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'sms', 'queued', 'bulksmsnigeria', 'ref-sms', 'fee_reminder', 'en', ARRAY['Ada','NGN 1','Org A','https://pay']);
\set CLAIM1 '''claim:00000000-0000-4000-8000-000000000001'''
\set CLAIM2 '''claim:00000000-0000-4000-8000-000000000002'''

SELECT pg_temp.expect('wa: authenticated cannot claim',
  pg_temp.val('authenticated', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001')::text$$), 'err:42501');
SELECT pg_temp.expect('wa: whatsapp_live off -> not claimable (provider never called)',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001')::text$$), 'false');
INSERT INTO public.feature_flags VALUES ('whatsapp_live', '11111111-1111-1111-1111-111111111111', true);
SELECT pg_temp.expect('wa: cross-organization claim refused',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f1','22222222-2222-2222-2222-222222222222','claim:00000000-0000-4000-8000-000000000001')::text$$), 'false');
SELECT pg_temp.expect('wa: parameter count mismatch -> not claimable',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f2','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000002')::text$$), 'false');
SELECT pg_temp.expect('wa: unregistered template -> not claimable',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f3','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000002')::text$$), 'false');
SELECT pg_temp.expect('wa: registered approved template -> claimed',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001')::text$$), 'true');
SELECT pg_temp.expect('wa: second claim of the same row refused (no double send)',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000002')::text$$), 'false');
SELECT pg_temp.expect('wa: settle by a worker that does not hold the claim refused',
  pg_temp.val('service_role', $$SELECT public.comms_wa_settle('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000002','sent','wamid.1',NULL)::text$$), 'false');
SELECT pg_temp.expect('wa: sent without a provider id refused',
  pg_temp.val('service_role', $$SELECT public.comms_wa_settle('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001','sent',NULL,NULL)::text$$), 'err:P0001');
SELECT pg_temp.expect('wa: claim holder settles sent',
  pg_temp.val('service_role', $$SELECT public.comms_wa_settle('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001','sent','wamid.1',NULL)::text$$), 'true');
SELECT pg_temp.expect('wa: a sent row cannot be claimed again',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001')::text$$), 'false');
SELECT pg_temp.expect('wa: pre-claim rejection closes and refunds once',
  pg_temp.val('service_role', $$SELECT public.comms_wa_settle('00000000-0000-0000-0000-0000000000f2','11111111-1111-1111-1111-111111111111',NULL,'failed',NULL,'opted_out','rejected_before_submission')::text$$), 'true');
SELECT pg_temp.expect('wa: replayed rejection changes nothing and does not refund twice',
  pg_temp.val('service_role', $$SELECT public.comms_wa_settle('00000000-0000-0000-0000-0000000000f2','11111111-1111-1111-1111-111111111111',NULL,'failed',NULL,'opted_out','rejected_before_submission')::text$$), 'false');
SELECT pg_temp.expect('wa: exactly one refund recorded', (SELECT count(*)::text FROM public.refunds_seen WHERE reference = 'ref-2'), '1');
SELECT pg_temp.expect('wa: a refund reason on a sent close is refused',
  pg_temp.val('service_role', $$SELECT public.comms_wa_settle('00000000-0000-0000-0000-0000000000f4','11111111-1111-1111-1111-111111111111',NULL,'sent','wamid.4',NULL,'provider_rejected')::text$$), 'err:P0001');
SELECT pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f4','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000002')::text$$);
SELECT pg_temp.expect('wa: ambiguous outcome is held (claim kept)',
  pg_temp.val('service_role', $$SELECT public.comms_wa_hold('00000000-0000-0000-0000-0000000000f4','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000002','provider_error')::text$$), 'true');
SELECT pg_temp.expect('wa: held row stays claimed, queued, unrefunded',
  (SELECT status || '|' || provider_ref || '|' || error FROM public.outbound_messages WHERE id = '00000000-0000-0000-0000-0000000000f4'),
  'queued|claim:00000000-0000-4000-8000-000000000002|held:provider_error');
SELECT pg_temp.expect('wa: held row cannot be claimed by another worker',
  pg_temp.val('service_role', $$SELECT public.comms_wa_claim('00000000-0000-0000-0000-0000000000f4','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001')::text$$), 'false');
SELECT pg_temp.expect('wa: hold is audited', (SELECT count(*)::text FROM public.audit_logs WHERE action = 'whatsapp.hold'), '1');
SELECT pg_temp.expect('wa: release puts a claimed row back to queued without refund',
  pg_temp.val('service_role', $$SELECT (public.comms_wa_claim('00000000-0000-0000-0000-0000000000f5','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001')
    AND public.comms_wa_settle('00000000-0000-0000-0000-0000000000f5','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000001','queued',NULL,'provider_not_configured'))::text$$), 'true');
SELECT pg_temp.expect('wa: released row is claimable again, refunds unchanged',
  (SELECT (provider_ref IS NULL)::text || '|' || (SELECT count(*) FROM public.refunds_seen)::text FROM public.outbound_messages WHERE id = '00000000-0000-0000-0000-0000000000f5'), 'true|1');
SELECT pg_temp.expect('wa: WhatsApp functions cannot touch an SMS row (channel bound)',
  pg_temp.val('service_role', $$SELECT (public.comms_wa_claim('00000000-0000-0000-0000-0000000000f6','11111111-1111-1111-1111-111111111111','claim:00000000-0000-4000-8000-000000000003')
    OR public.comms_wa_settle('00000000-0000-0000-0000-0000000000f6','11111111-1111-1111-1111-111111111111',NULL,'failed',NULL,'x',NULL))::text$$), 'false');

-- 4. USSD result check ---------------------------------------------------------------------------------------------------
SELECT pg_temp.expect('ussd: menu offers results',
  (pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '')$$) LIKE '%4. Results%')::text, 'true');
SELECT pg_temp.expect('ussd: fee balance unchanged',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '1*1')$$), 'END Outstanding fees: NGN 30,000. Pay at the bursary or online.');
SELECT pg_temp.expect('ussd: results asks for the card serial after the child',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1')$$), 'CON Enter the serial number on the result card');
SELECT pg_temp.expect('ussd: then for the PIN',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1*SRVA1')$$), 'CON Enter the result card PIN');
SELECT pg_temp.expect('ussd: wrong PIN reveals nothing',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1*SRVA1*000000000000')$$), 'END Invalid serial or PIN.');
SELECT pg_temp.expect('ussd: another organization''s card reveals nothing',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1*SRVB1*444455556666')$$), 'END Invalid serial or PIN.');
SELECT pg_temp.expect('ussd: correct card for the chosen linked child shows published grades only',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1*srva1*1111-2222-3333')$$), 'END First 2026/2027: English B, Mathematics A');
SELECT pg_temp.expect('ussd: the card is now bound to that child; the sibling cannot use it',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*2*SRVA1*111122223333')$$), 'END Invalid serial or PIN.');
SELECT pg_temp.expect('ussd: a fifth attempt in the hour is still answered',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1*SRVA1*000000000000')$$), 'END Invalid serial or PIN.');
SELECT pg_temp.expect('ussd: the sixth result attempt in an hour is refused before any PIN check',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s1', '+2348031234567', '4*1*SRVA1*111122223333')$$), 'END Too many attempts. Try again later.');
SELECT pg_temp.expect('ussd: an unregistered number sees nothing',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s2', '+2348000000000', '4*1*SRVA1*111122223333')$$), 'END This number is not registered with a school. Ask the school office to add it.');
SELECT pg_temp.expect('ussd: a child index outside the caller''s linked children is refused',
  pg_temp.val('service_role', $$SELECT public.ussd_handle('s3', '+2348027654321', '4*2')$$), 'END Invalid choice.');
SELECT pg_temp.expect('ussd: authenticated can no longer execute the handler',
  pg_temp.val('authenticated', $$SELECT public.ussd_handle('s4', '+2348031234567', '')$$), 'err:42501');
SELECT pg_temp.expect('ussd: anon cannot execute the handler',
  pg_temp.val('anon', $$SELECT public.ussd_handle('s4', '+2348031234567', '')$$), 'err:42501');
SELECT pg_temp.expect('ussd: the PIN is never stored in the session table',
  (SELECT count(*)::text FROM public.ussd_sessions WHERE row_to_json(ussd_sessions)::text LIKE '%1111%'), '0');

-- ---- rollback ----------------------------------------------------------------------------------------------------------
\i database/supabase/rollbacks/20261117003400_sherivs_m22_comms_completion.sql
SELECT pg_temp.expect('rollback: WhatsApp functions removed', (to_regprocedure('public.comms_wa_claim(uuid,uuid,text)') IS NULL)::text, 'true');
SELECT pg_temp.expect('rollback: parameter-count column removed',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_name = 'comms_templates' AND column_name = 'wa_param_count'), '0');
SELECT pg_temp.expect('rollback: evidence rows already written are kept', (SELECT count(*)::text FROM public.cg_delivery_evidence), '2');
SELECT pg_temp.expect('rollback: new sms evidence refused again',
  pg_temp.try($$INSERT INTO public.cg_delivery_evidence VALUES ('e9','x','sms','x','+23***67','failed','c','r','t','s',NULL)$$), 'err:23514');
SELECT pg_temp.expect('rollback: USSD menu back to three options',
  (pg_temp.val('service_role', $$SELECT public.ussd_handle('s9', '+2348027654321', '')$$) LIKE '%4. Results%')::text, 'false');
\i database/supabase/migrations/20261117003400_sherivs_m22_comms_completion.sql
SELECT pg_temp.expect('re-apply after rollback works', (to_regprocedure('public.comms_wa_claim(uuid,uuid,text)') IS NOT NULL)::text, 'true');
\echo M22 SQL TEST PASSED
