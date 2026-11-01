-- CoreGrid V1 financial continuity layer.
-- Status: authored, NOT APPLIED. Scope bindings are provisioned by an
-- operator through the server-only function; no caller supplies org_ref.
-- Rollback: database/supabase/rollbacks/20261101000060_cg_financial_scope.sql
BEGIN;

CREATE TABLE public.cg_financial_scope_binding (
  scope_ref text PRIMARY KEY CHECK (length(scope_ref) BETWEEN 1 AND 160),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  provisioned_by text NOT NULL CHECK (length(provisioned_by) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_ref, tenant_id, org_ref),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);
ALTER TABLE public.cg_financial_scope_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_financial_scope_binding FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_financial_scope_binding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cg_financial_scope_binding TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_bind_scope(
  p_scope_ref text,
  p_tenant_id text,
  p_org_ref text,
  p_provisioned_by text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_binding public.cg_financial_scope_binding%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_scope_ref IS NULL OR length(btrim(p_scope_ref)) NOT BETWEEN 1 AND 160
     OR p_tenant_id IS NULL OR length(btrim(p_tenant_id)) NOT BETWEEN 1 AND 128
     OR p_org_ref IS NULL OR length(btrim(p_org_ref)) NOT BETWEEN 1 AND 160
     OR p_provisioned_by IS NULL OR length(btrim(p_provisioned_by)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid binding';
  END IF;
  INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES (btrim(p_scope_ref), btrim(p_tenant_id), btrim(p_org_ref), btrim(p_provisioned_by))
  ON CONFLICT (scope_ref) DO NOTHING;
  SELECT * INTO v_binding FROM public.cg_financial_scope_binding WHERE scope_ref = btrim(p_scope_ref);
  IF (v_binding.tenant_id, v_binding.org_ref)
       IS DISTINCT FROM (btrim(p_tenant_id), btrim(p_org_ref)) THEN
    RAISE EXCEPTION 'binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('scope_ref', v_binding.scope_ref, 'tenant_id', v_binding.tenant_id, 'org_ref', v_binding.org_ref);
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_bind_scope(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_bind_scope(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_resolve_scope(p_scope_ref text)
RETURNS TABLE (tenant_id text, org_ref text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT b.tenant_id, b.org_ref FROM public.cg_financial_scope_binding b
    WHERE b.scope_ref = p_scope_ref;
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_resolve_scope(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_resolve_scope(text) TO service_role;

CREATE TABLE public.cg_financial_provider_route (
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subaccount_code text NOT NULL CHECK (subaccount_code ~ '^ACCT_[A-Za-z0-9]+$'),
  active boolean NOT NULL DEFAULT false,
  provisioned_by text NOT NULL CHECK (length(provisioned_by) BETWEEN 1 AND 160),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_ref),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE RESTRICT
);
ALTER TABLE public.cg_financial_provider_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_financial_provider_route FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_financial_provider_route FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cg_financial_provider_route TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_set_route(
  p_scope_ref text,
  p_subaccount_code text,
  p_active boolean,
  p_provisioned_by text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_binding public.cg_financial_scope_binding%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_subaccount_code IS NULL OR p_subaccount_code !~ '^ACCT_[A-Za-z0-9]+$'
     OR p_provisioned_by IS NULL OR length(btrim(p_provisioned_by)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid route';
  END IF;
  SELECT * INTO v_binding FROM public.cg_financial_scope_binding WHERE scope_ref = p_scope_ref;
  IF v_binding.scope_ref IS NULL THEN RAISE EXCEPTION 'scope is not provisioned' USING ERRCODE = '23503'; END IF;
  INSERT INTO public.cg_financial_provider_route (
    tenant_id, org_ref, subaccount_code, active, provisioned_by, updated_at
  ) VALUES (
    v_binding.tenant_id, v_binding.org_ref, p_subaccount_code, coalesce(p_active, false),
    btrim(p_provisioned_by), now()
  ) ON CONFLICT (tenant_id, org_ref) DO UPDATE SET
    subaccount_code = EXCLUDED.subaccount_code,
    active = EXCLUDED.active,
    provisioned_by = EXCLUDED.provisioned_by,
    updated_at = now();
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_set_route(text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_set_route(text, text, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_route_for_scope(p_scope_ref text)
RETURNS TABLE (tenant_id text, org_ref text, subaccount_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT b.tenant_id, b.org_ref, r.subaccount_code
      FROM public.cg_financial_scope_binding b
      JOIN public.cg_financial_provider_route r
        ON r.tenant_id = b.tenant_id AND r.org_ref = b.org_ref AND r.active
     WHERE b.scope_ref = p_scope_ref;
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_route_for_scope(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_route_for_scope(text) TO service_role;

CREATE TABLE public.cg_financial_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL CHECK (length(subject_ref) BETWEEN 1 AND 160),
  principal_ref text NOT NULL CHECK (length(principal_ref) BETWEEN 1 AND 160),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT
);

CREATE TABLE public.cg_financial_plan_part (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no BETWEEN 1 AND 24),
  due_minor bigint NOT NULL CHECK (due_minor > 0),
  applied_minor bigint NOT NULL DEFAULT 0 CHECK (applied_minor >= 0 AND applied_minor <= due_minor),
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'partial', 'settled', 'cancelled')),
  UNIQUE (id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref),
  UNIQUE (plan_id, sequence_no),
  FOREIGN KEY (plan_id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref)
    REFERENCES public.cg_financial_plan (id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref) ON DELETE RESTRICT,
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT
);

CREATE TABLE public.cg_financial_intent (
  reference text PRIMARY KEY CHECK (length(reference) BETWEEN 6 AND 200),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL CHECK (length(subject_ref) BETWEEN 1 AND 160),
  principal_ref text NOT NULL CHECK (length(principal_ref) BETWEEN 1 AND 160),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  plan_part_id uuid,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'settled', 'failed', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (plan_part_id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref)
    REFERENCES public.cg_financial_plan_part (id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref) ON DELETE RESTRICT,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE INDEX cg_financial_intent_tenant_recent
  ON public.cg_financial_intent (tenant_id, org_ref, created_at DESC);
CREATE UNIQUE INDEX cg_financial_intent_one_pending_subject
  ON public.cg_financial_intent (scope_ref, subject_ref)
  WHERE state = 'pending';
CREATE UNIQUE INDEX cg_financial_plan_active_subject
  ON public.cg_financial_plan (scope_ref, subject_ref, principal_ref)
  WHERE state = 'active';

CREATE TABLE public.cg_financial_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_event_ref text NOT NULL UNIQUE CHECK (length(provider_event_ref) BETWEEN 1 AND 200),
  settled_at timestamptz NOT NULL,
  UNIQUE (id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref),
  FOREIGN KEY (reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref)
    REFERENCES public.cg_financial_intent (reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref) ON DELETE RESTRICT
);

CREATE TABLE public.cg_financial_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  reference text NOT NULL UNIQUE,
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, scope_ref, tenant_id, org_ref, principal_ref),
  FOREIGN KEY (entry_id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref)
    REFERENCES public.cg_financial_entry (id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref) ON DELETE RESTRICT
);

CREATE TABLE public.cg_financial_reversal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  reference text NOT NULL,
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  requested_by text NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  provider_ref text UNIQUE,
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'processing', 'processed', 'failed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  FOREIGN KEY (entry_id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref)
    REFERENCES public.cg_financial_entry (id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref) ON DELETE RESTRICT
);
CREATE INDEX cg_financial_reversal_entry_state
  ON public.cg_financial_reversal (entry_id, state);

CREATE TABLE public.cg_financial_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  provider_event_ref text NOT NULL,
  expected_minor bigint NOT NULL CHECK (expected_minor > 0),
  observed_minor bigint NOT NULL CHECK (observed_minor >= 0),
  expected_currency text NOT NULL CHECK (expected_currency ~ '^[A-Z]{3}$'),
  observed_currency text,
  verdict text NOT NULL CHECK (verdict IN ('matched', 'mismatch', 'unknown_reference', 'expired')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref)
    REFERENCES public.cg_financial_intent (reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref) ON DELETE RESTRICT
);
CREATE INDEX cg_financial_reconciliation_event_recent
  ON public.cg_financial_reconciliation (provider_event_ref, checked_at DESC);

CREATE OR REPLACE FUNCTION public.cg_financial_create_intent(
  p_reference text,
  p_scope_ref text,
  p_subject_ref text,
  p_principal_ref text,
  p_amount_minor bigint,
  p_currency text,
  p_plan_part_id uuid DEFAULT NULL,
  p_expires_at timestamptz DEFAULT now() + interval '24 hours'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_binding public.cg_financial_scope_binding%ROWTYPE;
  v_part public.cg_financial_plan_part%ROWTYPE;
  v_row public.cg_financial_intent%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 6 AND 200
     OR p_subject_ref IS NULL OR length(btrim(p_subject_ref)) NOT BETWEEN 1 AND 160
     OR p_principal_ref IS NULL OR length(btrim(p_principal_ref)) NOT BETWEEN 1 AND 160
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
     OR p_expires_at <= now() OR p_expires_at > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'invalid intent';
  END IF;
  SELECT * INTO v_binding FROM public.cg_financial_scope_binding WHERE scope_ref = p_scope_ref;
  IF v_binding.scope_ref IS NULL THEN RAISE EXCEPTION 'scope is not provisioned' USING ERRCODE = '23503'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_binding.scope_ref || ':' || btrim(p_subject_ref), 867201)
  );
  UPDATE public.cg_financial_intent SET state = 'expired'
   WHERE scope_ref = v_binding.scope_ref AND subject_ref = btrim(p_subject_ref)
     AND state = 'pending' AND expires_at <= now();
  IF EXISTS (
    SELECT 1 FROM public.cg_financial_intent
     WHERE scope_ref = v_binding.scope_ref AND subject_ref = btrim(p_subject_ref)
       AND state = 'pending'
  ) THEN
    RAISE EXCEPTION 'an active intent already exists for this subject' USING ERRCODE = '23505';
  END IF;
  IF p_plan_part_id IS NOT NULL THEN
    SELECT part.* INTO v_part
      FROM public.cg_financial_plan_part part
      JOIN public.cg_financial_plan plan ON plan.id = part.plan_id
     WHERE part.id = p_plan_part_id AND part.scope_ref = v_binding.scope_ref
       AND part.tenant_id = v_binding.tenant_id AND part.org_ref = v_binding.org_ref
       AND part.subject_ref = p_subject_ref AND part.principal_ref = p_principal_ref
       AND part.state IN ('pending', 'partial') AND part.due_at <= now()
       AND plan.state = 'active' AND plan.currency = p_currency
     FOR UPDATE;
    IF v_part.id IS NULL OR p_amount_minor <> v_part.due_minor - v_part.applied_minor THEN
      RAISE EXCEPTION 'amount does not match the outstanding scheduled part' USING ERRCODE = '23514';
    END IF;
  END IF;
  INSERT INTO public.cg_financial_intent (
    reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref,
    amount_minor, currency, plan_part_id, expires_at
  ) VALUES (
    btrim(p_reference), v_binding.scope_ref, v_binding.tenant_id, v_binding.org_ref,
    btrim(p_subject_ref), btrim(p_principal_ref), p_amount_minor, p_currency,
    p_plan_part_id, p_expires_at
  ) RETURNING * INTO v_row;
  RETURN jsonb_build_object(
    'reference', v_row.reference, 'tenant_id', v_row.tenant_id, 'org_ref', v_row.org_ref,
    'amount_minor', v_row.amount_minor, 'currency', v_row.currency, 'expires_at', v_row.expires_at
  );
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_create_intent(text, text, text, text, bigint, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_create_intent(text, text, text, text, bigint, text, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_fail_intent(p_reference text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_state text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT state INTO v_state FROM public.cg_financial_intent
   WHERE reference = p_reference FOR UPDATE;
  IF v_state IS NULL THEN RAISE EXCEPTION 'intent not found'; END IF;
  IF v_state = 'failed' THEN RETURN; END IF;
  IF v_state <> 'pending' THEN RAISE EXCEPTION 'intent is not pending'; END IF;
  UPDATE public.cg_financial_intent SET state = 'failed' WHERE reference = p_reference;
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_fail_intent(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_fail_intent(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_record_settlement(
  p_reference text,
  p_provider_event_ref text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_intent public.cg_financial_intent%ROWTYPE;
  v_entry public.cg_financial_entry%ROWTYPE;
  v_part public.cg_financial_plan_part%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent FROM public.cg_financial_intent
   WHERE reference = p_reference FOR UPDATE;
  IF v_intent.reference IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unknown_reference');
  END IF;
  IF p_amount_minor IS DISTINCT FROM v_intent.amount_minor
     OR upper(coalesce(p_currency, '')) IS DISTINCT FROM v_intent.currency THEN
    RETURN jsonb_build_object('outcome', 'amount_or_currency_mismatch');
  END IF;
  IF coalesce(p_paid_at, v_now) < v_intent.created_at
     OR coalesce(p_paid_at, v_now) > v_now + interval '5 minutes'
     OR (v_now >= v_intent.expires_at AND coalesce(p_paid_at, v_now) >= v_intent.expires_at) THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  IF v_intent.state = 'settled' THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  IF v_intent.state NOT IN ('pending', 'expired') THEN
    RETURN jsonb_build_object('outcome', 'not_pending');
  END IF;
  IF v_intent.state = 'expired'
     AND (p_paid_at IS NULL OR p_paid_at >= v_intent.expires_at) THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  INSERT INTO public.cg_financial_entry (
    reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref,
    amount_minor, currency, provider_event_ref, settled_at
  ) VALUES (
    v_intent.reference, v_intent.scope_ref, v_intent.tenant_id, v_intent.org_ref,
    v_intent.subject_ref, v_intent.principal_ref, v_intent.amount_minor,
    v_intent.currency, p_provider_event_ref, coalesce(p_paid_at, v_now)
  ) RETURNING * INTO v_entry;
  INSERT INTO public.cg_financial_evidence (
    entry_id, reference, scope_ref, tenant_id, org_ref, subject_ref,
    principal_ref, amount_minor, currency
  ) VALUES (
    v_entry.id, v_entry.reference, v_entry.scope_ref, v_entry.tenant_id,
    v_entry.org_ref, v_entry.subject_ref, v_entry.principal_ref,
    v_entry.amount_minor, v_entry.currency
  );
  UPDATE public.cg_financial_intent SET state = 'settled', settled_at = coalesce(p_paid_at, v_now)
   WHERE reference = v_intent.reference;
  IF v_intent.plan_part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM public.cg_financial_plan_part
     WHERE id = v_intent.plan_part_id FOR UPDATE;
    UPDATE public.cg_financial_plan_part
       SET applied_minor = applied_minor + v_intent.amount_minor,
           state = CASE WHEN applied_minor + v_intent.amount_minor = due_minor THEN 'settled' ELSE 'partial' END
     WHERE id = v_part.id;
    IF NOT EXISTS (
      SELECT 1 FROM public.cg_financial_plan_part
       WHERE plan_id = v_part.plan_id AND state NOT IN ('settled', 'cancelled')
    ) THEN
      UPDATE public.cg_financial_plan SET state = 'completed' WHERE id = v_part.plan_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('outcome', 'settled', 'entry_id', v_entry.id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('outcome', 'duplicate');
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_record_settlement(text, text, bigint, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_record_settlement(text, text, bigint, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_create_plan(
  p_scope_ref text,
  p_subject_ref text,
  p_principal_ref text,
  p_total_minor bigint,
  p_currency text,
  p_parts jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_binding public.cg_financial_scope_binding%ROWTYPE;
  v_plan uuid;
  v_part jsonb;
  v_count integer;
  v_sum bigint := 0;
  v_seq integer := 0;
  v_due bigint;
  v_due_at timestamptz;
  v_previous_due_at timestamptz;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_total_minor IS NULL OR p_total_minor <= 0
     OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
     OR jsonb_typeof(p_parts) <> 'array' THEN
    RAISE EXCEPTION 'invalid plan';
  END IF;
  v_count := jsonb_array_length(p_parts);
  IF v_count NOT BETWEEN 2 AND 24 THEN RAISE EXCEPTION 'plan requires 2 to 24 parts'; END IF;
  SELECT * INTO v_binding FROM public.cg_financial_scope_binding WHERE scope_ref = p_scope_ref;
  IF v_binding.scope_ref IS NULL THEN RAISE EXCEPTION 'scope is not provisioned' USING ERRCODE = '23503'; END IF;
  FOR v_part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    v_due := (v_part->>'amount_minor')::bigint;
    v_due_at := (v_part->>'due_at')::timestamptz;
    IF v_due <= 0 OR v_due_at IS NULL OR v_due_at <= now()
       OR (v_previous_due_at IS NOT NULL AND v_due_at <= v_previous_due_at) THEN
      RAISE EXCEPTION 'invalid plan part';
    END IF;
    v_sum := v_sum + v_due;
    v_previous_due_at := v_due_at;
  END LOOP;
  IF v_sum <> p_total_minor THEN RAISE EXCEPTION 'plan parts must equal the server amount'; END IF;
  INSERT INTO public.cg_financial_plan (
    scope_ref, tenant_id, org_ref, subject_ref, principal_ref, total_minor, currency
  ) VALUES (
    v_binding.scope_ref, v_binding.tenant_id, v_binding.org_ref,
    p_subject_ref, p_principal_ref, p_total_minor, p_currency
  ) RETURNING id INTO v_plan;
  FOR v_part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.cg_financial_plan_part (
      plan_id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref,
      sequence_no, due_minor, due_at
    ) VALUES (
      v_plan, v_binding.scope_ref, v_binding.tenant_id, v_binding.org_ref,
      p_subject_ref, p_principal_ref, v_seq,
      (v_part->>'amount_minor')::bigint, (v_part->>'due_at')::timestamptz
    );
  END LOOP;
  RETURN v_plan;
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_create_plan(text, text, text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_create_plan(text, text, text, bigint, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_request_reversal(
  p_entry_id uuid,
  p_amount_minor bigint,
  p_reason text,
  p_idempotency_key text,
  p_requested_by text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_entry public.cg_financial_entry%ROWTYPE;
  v_existing public.cg_financial_reversal%ROWTYPE;
  v_reserved bigint;
  v_row public.cg_financial_reversal%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.cg_financial_reversal WHERE idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.entry_id IS DISTINCT FROM p_entry_id
       OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
       OR v_existing.reason IS DISTINCT FROM btrim(p_reason)
       OR v_existing.requested_by IS DISTINCT FROM btrim(p_requested_by) THEN
      RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'state', v_existing.state, 'duplicate', true);
  END IF;
  SELECT * INTO v_entry FROM public.cg_financial_entry WHERE id = p_entry_id FOR UPDATE;
  IF v_entry.id IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
     OR p_requested_by IS NULL OR length(btrim(p_requested_by)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid reversal request';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO v_reserved FROM public.cg_financial_reversal
   WHERE entry_id = p_entry_id AND state NOT IN ('failed', 'cancelled');
  IF v_reserved + p_amount_minor > v_entry.amount_minor THEN
    RAISE EXCEPTION 'reversal exceeds remaining settled amount' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.cg_financial_reversal (
    entry_id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref,
    amount_minor, currency, reason, requested_by, idempotency_key
  ) VALUES (
    v_entry.id, v_entry.reference, v_entry.scope_ref, v_entry.tenant_id, v_entry.org_ref,
    v_entry.subject_ref, v_entry.principal_ref, p_amount_minor, v_entry.currency,
    btrim(p_reason), btrim(p_requested_by), btrim(p_idempotency_key)
  ) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'state', v_row.state, 'reference', v_row.reference);
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_request_reversal(uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_request_reversal(uuid, bigint, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_finish_reversal(
  p_id uuid,
  p_state text,
  p_provider_ref text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('processing', 'processed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid reversal state';
  END IF;
  SELECT state INTO v_current FROM public.cg_financial_reversal WHERE id = p_id FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'reversal not found'; END IF;
  IF v_current IN ('processed', 'cancelled') THEN
    IF v_current <> p_state THEN RAISE EXCEPTION 'terminal reversal state'; END IF;
    RETURN;
  END IF;
  UPDATE public.cg_financial_reversal
     SET state = p_state,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         processed_at = CASE WHEN p_state = 'processed' THEN now() ELSE processed_at END
   WHERE id = p_id;
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_finish_reversal(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_finish_reversal(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_record_reconciliation(
  p_reference text,
  p_provider_event_ref text,
  p_observed_minor bigint,
  p_observed_currency text,
  p_paid_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_intent public.cg_financial_intent%ROWTYPE;
  v_verdict text;
  v_row public.cg_financial_reconciliation%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent FROM public.cg_financial_intent WHERE reference = p_reference;
  IF v_intent.reference IS NULL THEN RETURN jsonb_build_object('verdict', 'unknown_reference'); END IF;
  IF p_observed_minor = v_intent.amount_minor
     AND upper(coalesce(p_observed_currency, '')) = v_intent.currency
     AND coalesce(p_paid_at, now()) >= v_intent.created_at
     AND coalesce(p_paid_at, now()) <= now() + interval '5 minutes'
     AND (coalesce(p_paid_at, now()) < v_intent.expires_at OR now() < v_intent.expires_at) THEN
    v_verdict := 'matched';
  ELSIF coalesce(p_paid_at, now()) >= v_intent.expires_at THEN
    v_verdict := 'expired';
  ELSE
    v_verdict := 'mismatch';
  END IF;
  INSERT INTO public.cg_financial_reconciliation (
    reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref,
    provider_event_ref, expected_minor, observed_minor, expected_currency,
    observed_currency, verdict, checked_at
  ) VALUES (
    v_intent.reference, v_intent.scope_ref, v_intent.tenant_id, v_intent.org_ref,
    v_intent.subject_ref, v_intent.principal_ref, p_provider_event_ref,
    v_intent.amount_minor, greatest(coalesce(p_observed_minor, 0), 0),
    v_intent.currency, p_observed_currency, v_verdict, now()
  ) RETURNING * INTO v_row;
  RETURN jsonb_build_object(
    'verdict', v_row.verdict,
    'id', v_row.id,
    'expected_minor', v_intent.amount_minor,
    'currency', v_intent.currency,
    'subject_ref', v_intent.subject_ref,
    'scope_ref', v_intent.scope_ref,
    'tenant_id', v_intent.tenant_id,
    'org_ref', v_intent.org_ref
  );
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_record_reconciliation(text, text, bigint, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_financial_record_reconciliation(text, text, bigint, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_financial_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'record is immutable' USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION public.cg_financial_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER cg_financial_binding_immutable
  BEFORE UPDATE OR DELETE ON public.cg_financial_scope_binding
  FOR EACH ROW EXECUTE FUNCTION public.cg_financial_immutable();
CREATE TRIGGER cg_financial_entry_immutable
  BEFORE UPDATE OR DELETE ON public.cg_financial_entry
  FOR EACH ROW EXECUTE FUNCTION public.cg_financial_immutable();
CREATE TRIGGER cg_financial_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.cg_financial_evidence
  FOR EACH ROW EXECUTE FUNCTION public.cg_financial_immutable();
CREATE TRIGGER cg_financial_reconciliation_immutable
  BEFORE UPDATE OR DELETE ON public.cg_financial_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.cg_financial_immutable();

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cg_financial_plan',
    'cg_financial_plan_part',
    'cg_financial_intent',
    'cg_financial_entry',
    'cg_financial_evidence',
    'cg_financial_reversal',
    'cg_financial_reconciliation'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() AND (principal_ref = auth.uid()::text OR public.is_tenant_admin(tenant_id)))',
      v_table || '_tenant_read', v_table
    );
  END LOOP;
END
$$;
REVOKE INSERT, UPDATE, DELETE ON public.cg_financial_plan, public.cg_financial_plan_part,
  public.cg_financial_intent, public.cg_financial_entry, public.cg_financial_evidence,
  public.cg_financial_reversal, public.cg_financial_reconciliation FROM authenticated;

COMMIT;
