-- =============================================================================
-- SHERIVS-013 — Split-payment binding, tamper-evident audit chain,
--               per-organization entitlements and usage metering.
--
-- NOT APPLIED. Review only (draft PR). Depends on SHERIVS-012 (vault).
-- All tables: RLS forced; writes are service_role only. Tenant admins may
-- READ their own organization's rows where noted. Bank account numbers are
-- stored ONLY as vault ciphertext (envelope encryption, see sherivs_012);
-- the last 4 digits are kept for display.
-- Rollback: database/supabase/rollbacks/20261022000200_sherivs_013_payments_audit_entitlements.sql
-- =============================================================================
BEGIN;

-- 1. Paystack subaccount per organization ------------------------------------
CREATE TABLE IF NOT EXISTS public.org_payment_subaccounts (
  org_id                 uuid PRIMARY KEY,
  subaccount_code        text NOT NULL UNIQUE CHECK (subaccount_code ~ '^ACCT_[A-Za-z0-9]+$'),
  settlement_bank_code   text NOT NULL,
  account_last4          text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  account_ciphertext     text NOT NULL,   -- vault envelope ciphertext of the NUBAN
  account_wrapped_dek    text NOT NULL,
  key_version            text NOT NULL,
  platform_charge_kobo   integer NOT NULL CHECK (platform_charge_kobo >= 0),
  active                 boolean NOT NULL DEFAULT false,
  verified_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_payment_subaccounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_payment_subaccounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.org_payment_subaccounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.org_payment_subaccounts TO service_role;

CREATE TABLE IF NOT EXISTS public.payment_intents (
  reference              text PRIMARY KEY CHECK (length(reference) BETWEEN 6 AND 100),
  org_id                 uuid NOT NULL,
  beneficiary_id         uuid NOT NULL,
  payer_id               uuid NOT NULL,
  subaccount_code        text NOT NULL,
  amount_kobo            bigint NOT NULL CHECK (amount_kobo >= 100),
  platform_charge_kobo   bigint NOT NULL CHECK (platform_charge_kobo >= 0 AND platform_charge_kobo < amount_kobo),
  currency               text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  purpose                text NOT NULL,
  signature              text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','quarantined')),
  quarantine_reason      text,
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  settled_at             timestamptz
);
CREATE INDEX IF NOT EXISTS payment_intents_org_idx ON public.payment_intents (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_intents_quarantine_idx ON public.payment_intents (status) WHERE status = 'quarantined';

-- Binding guard: an intent's subaccount must be the org's registered subaccount.
CREATE OR REPLACE FUNCTION public.payment_intent_binding_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_payment_subaccounts s
                  WHERE s.org_id = NEW.org_id AND s.subaccount_code = NEW.subaccount_code AND s.active) THEN
    RAISE EXCEPTION 'payment intent subaccount is not the active subaccount of its organization';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id, NEW.subaccount_code, NEW.amount_kobo, NEW.beneficiary_id, NEW.signature)
       IS DISTINCT FROM (OLD.org_id, OLD.subaccount_code, OLD.amount_kobo, OLD.beneficiary_id, OLD.signature) THEN
    RAISE EXCEPTION 'payment intent binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_intents_binding_guard ON public.payment_intents;
CREATE TRIGGER payment_intents_binding_guard BEFORE INSERT OR UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.payment_intent_binding_guard();

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_intents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_intents TO service_role;
DROP POLICY IF EXISTS payment_intents_tenant_read ON public.payment_intents;
CREATE POLICY payment_intents_tenant_read ON public.payment_intents FOR SELECT TO authenticated
  USING (payer_id = auth.uid() OR public.is_tenant_admin(org_id::text));

-- 2. Tamper-evident audit chain ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_chain (
  org_id       uuid NOT NULL,
  seq          bigint NOT NULL CHECK (seq >= 1),
  at           timestamptz NOT NULL,
  actor_kind   text NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_id     text NOT NULL,
  action       text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.:-]{1,99}$'),
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  ip           inet,
  device       text CHECK (device IS NULL OR length(device) <= 300),
  before_hash  text CHECK (before_hash IS NULL OR before_hash ~ '^[0-9a-f]{64}$'),
  after_hash   text CHECK (after_hash IS NULL OR after_hash ~ '^[0-9a-f]{64}$'),
  prev_hash    text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash   text NOT NULL UNIQUE CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (org_id, seq)
);

-- Insert guard: seq must be head+1 and prev_hash must equal the head's entry_hash.
CREATE OR REPLACE FUNCTION public.audit_chain_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_head public.audit_chain%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text, 7013));
  SELECT * INTO v_head FROM public.audit_chain WHERE org_id = NEW.org_id ORDER BY seq DESC LIMIT 1;
  IF v_head.seq IS NULL THEN
    IF NEW.seq <> 1 OR NEW.prev_hash <> repeat('0', 64) THEN RAISE EXCEPTION 'audit_chain: bad genesis link'; END IF;
  ELSIF NEW.seq <> v_head.seq + 1 OR NEW.prev_hash <> v_head.entry_hash THEN
    RAISE EXCEPTION 'audit_chain: broken link';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.audit_chain_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'audit_chain is append-only'; END;
$$;
DROP TRIGGER IF EXISTS audit_chain_link ON public.audit_chain;
CREATE TRIGGER audit_chain_link BEFORE INSERT ON public.audit_chain FOR EACH ROW EXECUTE FUNCTION public.audit_chain_link_guard();
DROP TRIGGER IF EXISTS audit_chain_no_mutation ON public.audit_chain;
CREATE TRIGGER audit_chain_no_mutation BEFORE UPDATE OR DELETE ON public.audit_chain FOR EACH ROW EXECUTE FUNCTION public.audit_chain_append_only();
DROP TRIGGER IF EXISTS audit_chain_no_truncate ON public.audit_chain;
CREATE TRIGGER audit_chain_no_truncate BEFORE TRUNCATE ON public.audit_chain FOR EACH STATEMENT EXECUTE FUNCTION public.audit_chain_append_only();

ALTER TABLE public.audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_chain FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_chain FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_chain TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_chain TO service_role;
DROP POLICY IF EXISTS audit_chain_tenant_read ON public.audit_chain;
CREATE POLICY audit_chain_tenant_read ON public.audit_chain FOR SELECT TO authenticated
  USING (public.is_tenant_admin(org_id::text) OR public.has_platform_capability('platform.audit.read'));

-- External anchors of chain heads (copied daily to write-once storage).
CREATE TABLE IF NOT EXISTS public.audit_chain_anchors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL,
  seq        bigint NOT NULL,
  head_hash  text NOT NULL CHECK (head_hash ~ '^[0-9a-f]{64}$'),
  anchored_at timestamptz NOT NULL DEFAULT now(),
  location   text NOT NULL
);
ALTER TABLE public.audit_chain_anchors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_chain_anchors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_chain_anchors TO service_role;

-- 3. Entitlements and usage metering ---------------------------------------
CREATE TABLE IF NOT EXISTS public.entitlement_plans (
  id        text PRIMARY KEY,
  features  text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS public.entitlement_plan_quotas (
  plan_id   text NOT NULL REFERENCES public.entitlement_plans(id) ON DELETE CASCADE,
  meter     text NOT NULL CHECK (meter IN ('ai_requests_per_member_day','code_generations','sms','whatsapp','voice_minutes','storage_mb')),
  quota     bigint NOT NULL CHECK (quota >= 0),
  period    text NOT NULL CHECK (period IN ('day','month','none')),
  PRIMARY KEY (plan_id, meter)
);
CREATE TABLE IF NOT EXISTS public.org_entitlements (
  org_id     uuid PRIMARY KEY,
  plan_id    text NOT NULL REFERENCES public.entitlement_plans(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.usage_counters (
  org_id      uuid NOT NULL,
  meter       text NOT NULL,
  period_key  text NOT NULL,
  subject_id  text NOT NULL DEFAULT '',  -- '' = organization total; member id for per-member meters
  used        bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (org_id, meter, period_key, subject_id)
);
CREATE TABLE IF NOT EXISTS public.usage_alerts (
  org_id      uuid NOT NULL,
  meter       text NOT NULL,
  period_key  text NOT NULL,
  level       smallint NOT NULL CHECK (level IN (80, 100)),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, meter, period_key, level)
);
CREATE TABLE IF NOT EXISTS public.entitlement_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  meter       text NOT NULL,
  extra       bigint NOT NULL CHECK (extra > 0),
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT entitlement_overrides_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '31 days')
);

-- Atomic metered increment: returns false (no change) when it would exceed the limit.
CREATE OR REPLACE FUNCTION public.meter_consume(p_org uuid, p_meter text, p_period_key text, p_subject text, p_qty bigint, p_limit bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_used bigint;
BEGIN
  IF p_qty <= 0 THEN RETURN false; END IF;
  INSERT INTO public.usage_counters (org_id, meter, period_key, subject_id, used)
  VALUES (p_org, p_meter, p_period_key, coalesce(p_subject, ''), 0)
  ON CONFLICT DO NOTHING;
  UPDATE public.usage_counters SET used = used + p_qty
   WHERE org_id = p_org AND meter = p_meter AND period_key = p_period_key AND subject_id = coalesce(p_subject, '')
     AND used + p_qty <= p_limit
  RETURNING used INTO v_used;
  RETURN v_used IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.meter_consume(uuid, text, text, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meter_consume(uuid, text, text, text, bigint, bigint) TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entitlement_plans','entitlement_plan_quotas','org_entitlements','usage_counters','usage_alerts','entitlement_overrides'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT SELECT ON TABLE public.org_entitlements, public.usage_counters, public.usage_alerts, public.entitlement_overrides TO authenticated;
CREATE POLICY org_entitlements_tenant_read ON public.org_entitlements FOR SELECT TO authenticated USING (public.is_tenant_admin(org_id::text));
CREATE POLICY usage_counters_tenant_read ON public.usage_counters FOR SELECT TO authenticated USING (public.is_tenant_admin(org_id::text));
CREATE POLICY usage_alerts_tenant_read ON public.usage_alerts FOR SELECT TO authenticated USING (public.is_tenant_admin(org_id::text));
CREATE POLICY entitlement_overrides_tenant_read ON public.entitlement_overrides FOR SELECT TO authenticated USING (public.is_tenant_admin(org_id::text));

COMMIT;
