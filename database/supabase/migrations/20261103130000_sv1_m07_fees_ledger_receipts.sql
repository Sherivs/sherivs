-- M07 V1 fee schedules, invoices, payments, receipts, and append-only ledger.
-- Status: authored, NOT APPLIED. Never apply to a live database without explicit approval.
-- Rollback: database/supabase/rollbacks/20261103130000_sv1_m07_fees_ledger_receipts.sql
DO $guard$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.cg_financial_scope_binding') IS NULL THEN
    missing := array_append(missing, 'public.cg_financial_scope_binding');
  END IF;
  IF to_regclass('public.schools') IS NULL OR to_regclass('public.campuses') IS NULL THEN
    missing := array_append(missing, 'public.schools/public.campuses');
  END IF;
  IF to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.role_catalog') IS NULL
     OR to_regclass('public.role_template_permissions') IS NULL THEN
    missing := array_append(missing, 'M009-A1 role catalog');
  END IF;
  IF to_regprocedure('public.get_my_school_id()') IS NULL
     OR to_regprocedure('public.has_permission(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.workspace_effective_permission_rows(uuid,uuid)') IS NULL
     OR to_regprocedure('public.workspace_role_sod_assert(uuid,uuid)') IS NULL THEN
    missing := array_append(missing, 'tenant, role, SoD, or immutable-ledger helper');
  END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M07 requires M009-A1, M04, and cg financial scope; missing: %',
      array_to_string(missing, ', ')
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_template_permissions
     WHERE template_code = 'bursar'
       AND permission_code = 'payments.record_cash'
       AND kind = 'optional'
  ) THEN
    RAISE EXCEPTION 'M07 requires the optional bursar cash-recording permission'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

-- A bursar reconciles payments; the cashier role alone records cash.
UPDATE public.role_template_permissions
   SET default_on = false
 WHERE template_code = 'bursar'
   AND permission_code = 'payments.record_cash'
   AND kind = 'optional'
   AND default_on IS DISTINCT FROM false;

CREATE TABLE public.cg_fee_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 160),
  academic_year text NOT NULL CHECK (length(btrim(academic_year)) BETWEEN 4 AND 32),
  term text NOT NULL CHECK (length(btrim(term)) BETWEEN 1 AND 48),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  effective_from date NOT NULL,
  effective_until date,
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, scope_ref, tenant_id, org_ref, amount_kobo),
  UNIQUE (scope_ref, code, academic_year, term),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE public.cg_fee_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  schedule_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  subject_ref text NOT NULL CHECK (length(btrim(subject_ref)) BETWEEN 1 AND 160),
  principal_ref text NOT NULL CHECK (length(btrim(principal_ref)) BETWEEN 1 AND 160),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  due_at timestamptz NOT NULL,
  issued_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, campus_id, subject_ref, principal_ref),
  UNIQUE (schedule_id, subject_ref, principal_ref),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (schedule_id, scope_ref, tenant_id, org_ref, amount_kobo)
    REFERENCES public.cg_fee_schedule (id, scope_ref, tenant_id, org_ref, amount_kobo) ON DELETE RESTRICT,
  FOREIGN KEY (campus_id, school_id)
    REFERENCES public.campuses (id, school_id) ON DELETE RESTRICT
);
CREATE INDEX cg_fee_invoice_tenant_recent
  ON public.cg_fee_invoice (tenant_id, campus_id, issued_at DESC);

CREATE TABLE public.cg_fee_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'pos')),
  external_reference text CHECK (external_reference IS NULL OR length(btrim(external_reference)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id, tenant_id, campus_id, subject_ref, principal_ref)
    REFERENCES public.cg_fee_invoice (id, tenant_id, campus_id, subject_ref, principal_ref) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX cg_fee_payment_external_reference_unique
  ON public.cg_fee_payment (tenant_id, method, external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX cg_fee_payment_invoice_recent
  ON public.cg_fee_payment (invoice_id, recorded_at DESC);

CREATE TABLE public.cg_fee_refund_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (payment_id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref)
    REFERENCES public.cg_fee_payment (id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref) ON DELETE RESTRICT
);
CREATE INDEX cg_fee_refund_request_payment
  ON public.cg_fee_refund_request (payment_id, requested_at DESC);

CREATE TABLE public.cg_fee_refund_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  principal_ref text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  decided_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id),
  UNIQUE (id, tenant_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (request_id, tenant_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo)
    REFERENCES public.cg_fee_refund_request (id, tenant_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo) ON DELETE RESTRICT,
  CHECK (decided_by <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE public.cg_fee_ledger_posting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  payment_id uuid,
  refund_decision_id uuid,
  reversal_reason text CHECK (reversal_reason IS NULL OR length(btrim(reversal_reason)) BETWEEN 1 AND 500),
  campus_id uuid NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('invoice', 'payment', 'reversal', 'invoice_reversal')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reverses_posting_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (id, tenant_id, campus_id, principal_ref),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id, tenant_id, campus_id, subject_ref, principal_ref)
    REFERENCES public.cg_fee_invoice (id, tenant_id, campus_id, subject_ref, principal_ref) ON DELETE RESTRICT,
  FOREIGN KEY (payment_id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref)
    REFERENCES public.cg_fee_payment (id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref) ON DELETE RESTRICT,
  UNIQUE (id, tenant_id, invoice_id),
  FOREIGN KEY (refund_decision_id, tenant_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo)
    REFERENCES public.cg_fee_refund_decision (id, tenant_id, invoice_id, payment_id, campus_id, principal_ref, amount_kobo) ON DELETE RESTRICT,
  FOREIGN KEY (reverses_posting_id, tenant_id, invoice_id)
    REFERENCES public.cg_fee_ledger_posting (id, tenant_id, invoice_id) ON DELETE RESTRICT,
  CHECK (
    (event_type = 'invoice' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL)
    OR (event_type = 'payment' AND payment_id IS NOT NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NULL AND reversal_reason IS NULL)
    OR (event_type = 'reversal' AND payment_id IS NOT NULL AND refund_decision_id IS NOT NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NULL)
    OR (event_type = 'invoice_reversal' AND payment_id IS NULL AND refund_decision_id IS NULL AND reverses_posting_id IS NOT NULL AND reversal_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX cg_fee_invoice_posting_once
  ON public.cg_fee_ledger_posting (invoice_id) WHERE event_type = 'invoice';
CREATE UNIQUE INDEX cg_fee_payment_posting_once
  ON public.cg_fee_ledger_posting (payment_id) WHERE event_type = 'payment';
CREATE UNIQUE INDEX cg_fee_refund_posting_once
  ON public.cg_fee_ledger_posting (refund_decision_id) WHERE event_type = 'reversal';
CREATE UNIQUE INDEX cg_fee_invoice_reversal_once
  ON public.cg_fee_ledger_posting (reverses_posting_id) WHERE event_type = 'invoice_reversal';
CREATE INDEX cg_fee_ledger_posting_invoice_time
  ON public.cg_fee_ledger_posting (invoice_id, occurred_at, id);

CREATE TABLE public.cg_fee_ledger_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id uuid NOT NULL,
  tenant_id text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  campus_id uuid NOT NULL,
  principal_ref text NOT NULL,
  account_code text NOT NULL CHECK (account_code IN ('accounts_receivable', 'fee_revenue', 'cash')),
  debit_kobo bigint NOT NULL DEFAULT 0 CHECK (debit_kobo >= 0),
  credit_kobo bigint NOT NULL DEFAULT 0 CHECK (credit_kobo >= 0),
  UNIQUE (posting_id, account_code),
  FOREIGN KEY (posting_id, tenant_id, campus_id, principal_ref)
    REFERENCES public.cg_fee_ledger_posting (id, tenant_id, campus_id, principal_ref) ON DELETE RESTRICT,
  CHECK ((debit_kobo > 0) <> (credit_kobo > 0))
);

CREATE TABLE public.cg_fee_receipt_counter (
  tenant_id text PRIMARY KEY CHECK (length(tenant_id) BETWEEN 1 AND 128),
  last_number bigint NOT NULL CHECK (last_number >= 0)
);

CREATE TABLE public.cg_fee_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_ref text NOT NULL,
  tenant_id text NOT NULL,
  org_ref text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  subject_ref text NOT NULL,
  principal_ref text NOT NULL,
  receipt_number bigint NOT NULL CHECK (receipt_number > 0),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  issued_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (payment_id),
  FOREIGN KEY (scope_ref, tenant_id, org_ref)
    REFERENCES public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref) ON DELETE RESTRICT,
  FOREIGN KEY (payment_id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref)
    REFERENCES public.cg_fee_payment (id, tenant_id, invoice_id, campus_id, subject_ref, principal_ref) ON DELETE RESTRICT
);
CREATE INDEX cg_fee_receipt_tenant_number
  ON public.cg_fee_receipt (tenant_id, receipt_number);

CREATE TABLE public.cg_fee_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  school_id uuid GENERATED ALWAYS AS (tenant_id::uuid) STORED REFERENCES public.schools(id) ON DELETE RESTRICT,
  campus_id uuid,
  principal_ref text,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'insert'),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campus_id, school_id)
    REFERENCES public.campuses (id, school_id) ON DELETE RESTRICT
);
CREATE INDEX cg_fee_audit_event_tenant_time
  ON public.cg_fee_audit_event (tenant_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.cg_fee_authorize(
  p_scope_ref text,
  p_permission text,
  p_role_template text,
  p_resource_scope_type text,
  p_resource_scope_ref text
) RETURNS TABLE (tenant_id text, org_ref text, school_id uuid, actor_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_binding public.cg_financial_scope_binding%ROWTYPE;
  v_actor uuid := auth.uid();
  v_school uuid;
BEGIN
  IF v_actor IS NULL
     OR coalesce(auth.role(), '') <> 'authenticated'
     OR NOT (
       (p_permission = 'fees.manage_plans' AND p_role_template = 'bursar')
       OR (p_permission = 'payments.record_cash' AND p_role_template = 'cashier')
       OR (p_permission = 'payments.refund' AND p_role_template = 'bursar')
     )
     OR p_resource_scope_type IS NULL
     OR p_resource_scope_type NOT IN ('institution', 'campus')
     OR p_resource_scope_ref IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT b.* INTO v_binding
    FROM public.cg_financial_scope_binding b
   WHERE b.scope_ref = p_scope_ref;
  IF v_binding.scope_ref IS NULL
     OR v_binding.tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'financial scope is unavailable' USING ERRCODE = '42501';
  END IF;
  v_school := v_binding.tenant_id::uuid;
  IF public.get_my_school_id() IS DISTINCT FROM v_school
     OR NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = v_school) THEN
    RAISE EXCEPTION 'financial tenant is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_resource_scope_type = 'institution'
     AND p_resource_scope_ref IS DISTINCT FROM v_binding.tenant_id THEN
    RAISE EXCEPTION 'institution scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_resource_scope_type = 'campus'
     AND (
       p_resource_scope_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (
         SELECT 1 FROM public.campuses c
          WHERE c.id = p_resource_scope_ref::uuid AND c.school_id = v_school
       )
     ) THEN
    RAISE EXCEPTION 'campus scope mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.workspace_effective_permission_rows(v_school, v_actor) e
      JOIN public.role_catalog r ON r.code = e.role_code
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.scope_values, '[]'::jsonb)) s(value)
     WHERE e.permission_code = p_permission
       AND r.template_code = p_role_template
       AND (
         s.value->>'type' IN ('org', 'institution')
         OR (
           s.value->>'type' = p_resource_scope_type
           AND s.value->>'ref' IS NOT DISTINCT FROM p_resource_scope_ref
         )
       )
  ) THEN
    RAISE EXCEPTION 'required financial role or permission is missing' USING ERRCODE = '42501';
  END IF;
  PERFORM public.workspace_role_sod_assert(v_school, v_actor);
  RETURN QUERY SELECT v_binding.tenant_id, v_binding.org_ref, v_school, v_actor;
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_authorize(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cg_fee_can_read(
  p_tenant_id text,
  p_school_id uuid,
  p_campus_id uuid,
  p_principal_ref text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_school_id IS NULL
     OR p_tenant_id IS DISTINCT FROM p_school_id::text
     OR public.get_my_school_id() IS DISTINCT FROM p_school_id THEN
    RETURN false;
  END IF;
  IF p_principal_ref = auth.uid()::text
     OR public.is_tenant_admin(p_tenant_id) THEN
    RETURN true;
  END IF;
  RETURN public.has_permission(p_school_id, 'fees.view', 'institution', p_tenant_id)
    OR (
      p_campus_id IS NOT NULL
      AND public.has_permission(p_school_id, 'fees.view', 'campus', p_campus_id::text)
    );
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_can_read(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cg_fee_can_read(text, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cg_fee_audit_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_actor uuid;
BEGIN
  v_actor := coalesce(
    nullif(v_row->>'created_by', '')::uuid,
    nullif(v_row->>'issued_by', '')::uuid,
    nullif(v_row->>'recorded_by', '')::uuid,
    nullif(v_row->>'requested_by', '')::uuid,
    nullif(v_row->>'decided_by', '')::uuid,
    nullif(v_row->>'actor_id', '')::uuid
  );
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fee ledger audit requires an attributed actor' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_fee_audit_event (
    tenant_id, campus_id, principal_ref, actor_id, action, object_type, object_id, after_state
  ) VALUES (
    v_row->>'tenant_id',
    nullif(v_row->>'campus_id', '')::uuid,
    v_row->>'principal_ref',
    v_actor,
    'insert',
    TG_TABLE_NAME,
    (v_row->>'id')::uuid,
    v_row
  );
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_audit_insert() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cg_fee_posting_balanced()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_debits bigint;
  v_credits bigint;
  v_amount bigint;
  v_type text;
  v_valid boolean;
BEGIN
  SELECT p.amount_kobo, p.event_type INTO v_amount, v_type
    FROM public.cg_fee_ledger_posting p WHERE p.id = NEW.id;
  SELECT count(*)::integer, coalesce(sum(l.debit_kobo), 0)::bigint,
         coalesce(sum(l.credit_kobo), 0)::bigint
    INTO v_count, v_debits, v_credits
    FROM public.cg_fee_ledger_line l WHERE l.posting_id = NEW.id;
  IF v_count <> 2 OR v_debits <> v_credits OR v_debits <> v_amount THEN
    RAISE EXCEPTION 'fee ledger posting must contain exactly two balanced integer-kobo lines'
      USING ERRCODE = '23514';
  END IF;
  SELECT CASE v_type
    WHEN 'invoice' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'fee_revenue' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'payment' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'cash' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'reversal' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'cash' AND debit_kobo = 0 AND credit_kobo = v_amount)
    WHEN 'invoice_reversal' THEN
      EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'fee_revenue' AND debit_kobo = v_amount AND credit_kobo = 0)
      AND EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE posting_id = NEW.id AND account_code = 'accounts_receivable' AND debit_kobo = 0 AND credit_kobo = v_amount)
    ELSE false
  END INTO v_valid;
  IF NOT coalesce(v_valid, false) THEN
    RAISE EXCEPTION 'fee ledger posting lines do not match the transaction type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_posting_balanced() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cg_fee_create_schedule(
  p_scope_ref text,
  p_code text,
  p_label text,
  p_academic_year text,
  p_term text,
  p_amount_kobo bigint,
  p_effective_from date,
  p_effective_until date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ctx record;
  v_id uuid;
BEGIN
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    p_scope_ref, 'fees.manage_plans', 'bursar', 'institution',
    (SELECT b.tenant_id FROM public.cg_financial_scope_binding b WHERE b.scope_ref = p_scope_ref)
  );
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0
     OR p_effective_from IS NULL
     OR (p_effective_until IS NOT NULL AND p_effective_until <= p_effective_from)
     OR p_code IS NULL OR length(btrim(p_code)) NOT BETWEEN 2 AND 64
     OR p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 2 AND 160
     OR p_academic_year IS NULL OR length(btrim(p_academic_year)) NOT BETWEEN 4 AND 32
     OR p_term IS NULL OR length(btrim(p_term)) NOT BETWEEN 1 AND 48 THEN
    RAISE EXCEPTION 'invalid fee schedule' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cg_fee_schedule (
    scope_ref, tenant_id, org_ref, code, label, academic_year, term,
    amount_kobo, effective_from, effective_until, created_by
  ) VALUES (
    p_scope_ref, v_ctx.tenant_id, v_ctx.org_ref, btrim(p_code), btrim(p_label),
    btrim(p_academic_year), btrim(p_term), p_amount_kobo, p_effective_from,
    p_effective_until, v_ctx.actor_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_issue_invoice(
  p_scope_ref text,
  p_schedule_id uuid,
  p_campus_id uuid,
  p_subject_ref text,
  p_principal_ref text,
  p_due_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ctx record;
  v_schedule public.cg_fee_schedule%ROWTYPE;
  v_invoice uuid;
  v_posting uuid;
BEGIN
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    p_scope_ref, 'fees.manage_plans', 'bursar', 'campus', p_campus_id::text
  );
  IF p_subject_ref IS NULL OR length(btrim(p_subject_ref)) NOT BETWEEN 1 AND 160
     OR p_principal_ref IS NULL OR length(btrim(p_principal_ref)) NOT BETWEEN 1 AND 160
     OR p_due_at IS NULL THEN
    RAISE EXCEPTION 'invalid fee invoice' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_schedule
    FROM public.cg_fee_schedule s
   WHERE s.id = p_schedule_id AND s.scope_ref = p_scope_ref
     AND s.tenant_id = v_ctx.tenant_id AND s.org_ref = v_ctx.org_ref
     AND s.effective_from <= current_date
     AND (s.effective_until IS NULL OR s.effective_until > current_date)
   FOR SHARE;
  IF v_schedule.id IS NULL THEN
    RAISE EXCEPTION 'fee schedule is unavailable' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.cg_fee_invoice (
    scope_ref, tenant_id, org_ref, schedule_id, campus_id, subject_ref,
    principal_ref, amount_kobo, due_at, issued_by
  ) VALUES (
    v_schedule.scope_ref, v_schedule.tenant_id, v_schedule.org_ref,
    v_schedule.id, p_campus_id, btrim(p_subject_ref), btrim(p_principal_ref),
    v_schedule.amount_kobo, p_due_at, v_ctx.actor_id
  ) RETURNING id INTO v_invoice;
  INSERT INTO public.cg_fee_ledger_posting (
    scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref,
    principal_ref, event_type, amount_kobo, actor_id
  ) VALUES (
    v_schedule.scope_ref, v_schedule.tenant_id, v_schedule.org_ref,
    v_invoice, p_campus_id, btrim(p_subject_ref), btrim(p_principal_ref),
    'invoice', v_schedule.amount_kobo, v_ctx.actor_id
  ) RETURNING id INTO v_posting;
  INSERT INTO public.cg_fee_ledger_line (
    posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo
  )
  VALUES
    (v_posting, v_ctx.tenant_id, p_campus_id, btrim(p_principal_ref), 'accounts_receivable', v_schedule.amount_kobo, 0),
    (v_posting, v_ctx.tenant_id, p_campus_id, btrim(p_principal_ref), 'fee_revenue', 0, v_schedule.amount_kobo);
  RETURN v_invoice;
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_reverse_invoice(
  p_invoice_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invoice public.cg_fee_invoice%ROWTYPE;
  v_ctx record;
  v_original_posting uuid;
  v_existing public.cg_fee_ledger_posting%ROWTYPE;
  v_posting uuid;
BEGIN
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'fee invoice is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    v_invoice.scope_ref, 'fees.manage_plans', 'bursar', 'institution', v_invoice.tenant_id
  );
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id FOR UPDATE;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid invoice reversal reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.cg_fee_ledger_posting
   WHERE invoice_id = p_invoice_id AND event_type = 'invoice_reversal';
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.reversal_reason IS DISTINCT FROM btrim(p_reason)
       OR v_existing.actor_id IS DISTINCT FROM v_ctx.actor_id THEN
      RAISE EXCEPTION 'invoice already has a different reversal' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.cg_fee_payment WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'invoice with recorded payments cannot be reversed'
      USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_original_posting FROM public.cg_fee_ledger_posting
   WHERE invoice_id = p_invoice_id AND event_type = 'invoice';
  IF v_original_posting IS NULL THEN
    RAISE EXCEPTION 'invoice posting is unavailable' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.cg_fee_ledger_posting (
    scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref,
    principal_ref, event_type, amount_kobo, actor_id, reverses_posting_id, reversal_reason
  ) VALUES (
    v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id,
    v_invoice.campus_id, v_invoice.subject_ref, v_invoice.principal_ref,
    'invoice_reversal', v_invoice.amount_kobo, v_ctx.actor_id,
    v_original_posting, btrim(p_reason)
  ) RETURNING id INTO v_posting;
  INSERT INTO public.cg_fee_ledger_line (
    posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo
  )
  VALUES
    (v_posting, v_ctx.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'fee_revenue', v_invoice.amount_kobo, 0),
    (v_posting, v_ctx.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'accounts_receivable', 0, v_invoice.amount_kobo);
  RETURN v_posting;
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_record_payment(
  p_invoice_id uuid,
  p_amount_kobo bigint,
  p_method text,
  p_idempotency_key text,
  p_external_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invoice public.cg_fee_invoice%ROWTYPE;
  v_ctx record;
  v_existing public.cg_fee_payment%ROWTYPE;
  v_payment uuid;
  v_posting uuid;
  v_receipt_number bigint;
  v_balance bigint;
BEGIN
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'fee invoice is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    v_invoice.scope_ref, 'payments.record_cash', 'cashier', 'campus', v_invoice.campus_id::text
  );
  SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = p_invoice_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.cg_fee_payment
   WHERE tenant_id = v_ctx.tenant_id AND idempotency_key = btrim(p_idempotency_key);
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.invoice_id IS DISTINCT FROM p_invoice_id
       OR v_existing.amount_kobo IS DISTINCT FROM p_amount_kobo
       OR v_existing.method IS DISTINCT FROM p_method
       OR v_existing.external_reference IS DISTINCT FROM nullif(btrim(p_external_reference), '') THEN
      RAISE EXCEPTION 'payment idempotency key conflict' USING ERRCODE = '23505';
    END IF;
    SELECT r.receipt_number INTO v_receipt_number FROM public.cg_fee_receipt r WHERE r.payment_id = v_existing.id;
    RETURN jsonb_build_object('payment_id', v_existing.id, 'receipt_number', v_receipt_number, 'duplicate', true);
  END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0
     OR p_method IS NULL OR p_method NOT IN ('cash', 'bank_transfer', 'pos')
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200
     OR (p_external_reference IS NOT NULL AND length(btrim(p_external_reference)) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'invalid fee payment' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::bigint INTO v_balance
    FROM public.cg_fee_ledger_posting p
    JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
   WHERE p.invoice_id = p_invoice_id AND l.account_code = 'accounts_receivable';
  IF p_amount_kobo > v_balance THEN
    RAISE EXCEPTION 'payment exceeds outstanding invoice balance' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.cg_fee_payment (
    scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref,
    principal_ref, amount_kobo, method, external_reference, idempotency_key, recorded_by
  ) VALUES (
    v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id,
    v_invoice.campus_id, v_invoice.subject_ref, v_invoice.principal_ref,
    p_amount_kobo, p_method, nullif(btrim(p_external_reference), ''),
    btrim(p_idempotency_key), v_ctx.actor_id
  ) RETURNING id INTO v_payment;
  INSERT INTO public.cg_fee_ledger_posting (
    scope_ref, tenant_id, org_ref, invoice_id, payment_id, campus_id,
    subject_ref, principal_ref, event_type, amount_kobo, actor_id
  ) VALUES (
    v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id,
    v_payment, v_invoice.campus_id, v_invoice.subject_ref, v_invoice.principal_ref,
    'payment', p_amount_kobo, v_ctx.actor_id
  ) RETURNING id INTO v_posting;
  INSERT INTO public.cg_fee_ledger_line (
    posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo
  )
  VALUES
    (v_posting, v_ctx.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'cash', p_amount_kobo, 0),
    (v_posting, v_ctx.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'accounts_receivable', 0, p_amount_kobo);

  INSERT INTO public.cg_fee_receipt_counter (tenant_id, last_number)
  VALUES (v_ctx.tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_number = public.cg_fee_receipt_counter.last_number + 1
  RETURNING last_number INTO v_receipt_number;
  INSERT INTO public.cg_fee_receipt (
    scope_ref, tenant_id, org_ref, payment_id, invoice_id, campus_id,
    subject_ref, principal_ref, receipt_number, amount_kobo, issued_by
  ) VALUES (
    v_invoice.scope_ref, v_ctx.tenant_id, v_invoice.org_ref, v_payment,
    v_invoice.id, v_invoice.campus_id, v_invoice.subject_ref, v_invoice.principal_ref,
    v_receipt_number, p_amount_kobo, v_ctx.actor_id
  );
  RETURN jsonb_build_object('payment_id', v_payment, 'receipt_number', v_receipt_number, 'duplicate', false);
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_request_refund(
  p_payment_id uuid,
  p_amount_kobo bigint,
  p_reason text,
  p_idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_payment public.cg_fee_payment%ROWTYPE;
  v_ctx record;
  v_existing public.cg_fee_refund_request%ROWTYPE;
  v_reserved bigint;
  v_id uuid;
BEGIN
  SELECT * INTO v_payment FROM public.cg_fee_payment WHERE id = p_payment_id;
  IF v_payment.id IS NULL THEN RAISE EXCEPTION 'fee payment is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    v_payment.scope_ref, 'payments.record_cash', 'cashier', 'campus', v_payment.campus_id::text
  );
  SELECT * INTO v_payment FROM public.cg_fee_payment WHERE id = p_payment_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.cg_fee_refund_request
   WHERE tenant_id = v_ctx.tenant_id AND idempotency_key = btrim(p_idempotency_key);
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payment_id IS DISTINCT FROM p_payment_id
       OR v_existing.amount_kobo IS DISTINCT FROM p_amount_kobo
       OR v_existing.reason IS DISTINCT FROM btrim(p_reason)
       OR v_existing.requested_by IS DISTINCT FROM v_ctx.actor_id THEN
      RAISE EXCEPTION 'refund idempotency key conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid refund request' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(r.amount_kobo), 0)::bigint INTO v_reserved
    FROM public.cg_fee_refund_request r
    LEFT JOIN public.cg_fee_refund_decision d ON d.request_id = r.id
   WHERE r.payment_id = p_payment_id AND (d.id IS NULL OR d.decision = 'approved');
  IF v_reserved + p_amount_kobo > v_payment.amount_kobo THEN
    RAISE EXCEPTION 'refund exceeds unreserved payment amount' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.cg_fee_refund_request (
    scope_ref, tenant_id, org_ref, payment_id, invoice_id, campus_id,
    subject_ref, principal_ref, amount_kobo, reason, idempotency_key, requested_by
  ) VALUES (
    v_payment.scope_ref, v_ctx.tenant_id, v_payment.org_ref, v_payment.id,
    v_payment.invoice_id, v_payment.campus_id, v_payment.subject_ref,
    v_payment.principal_ref, p_amount_kobo, btrim(p_reason),
    btrim(p_idempotency_key), v_ctx.actor_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_decide_refund(
  p_request_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.cg_fee_refund_request%ROWTYPE;
  v_payment public.cg_fee_payment%ROWTYPE;
  v_ctx record;
  v_existing public.cg_fee_refund_decision%ROWTYPE;
  v_payment_posting uuid;
  v_decision uuid;
  v_posting uuid;
  v_reserved bigint;
BEGIN
  SELECT * INTO v_request FROM public.cg_fee_refund_request WHERE id = p_request_id;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'refund request is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(
    v_request.scope_ref, 'payments.refund', 'bursar', 'institution', v_request.tenant_id
  );
  SELECT * INTO v_payment FROM public.cg_fee_payment WHERE id = v_request.payment_id FOR UPDATE;
  SELECT * INTO v_request FROM public.cg_fee_refund_request WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.cg_fee_refund_decision WHERE request_id = p_request_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.decision IS DISTINCT FROM p_decision
       OR v_existing.decided_by IS DISTINCT FROM v_ctx.actor_id THEN
      RAISE EXCEPTION 'refund request already has a different decision' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('decision_id', v_existing.id, 'decision', v_existing.decision, 'duplicate', true);
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected')
     OR (p_reason IS NOT NULL AND length(btrim(p_reason)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'invalid refund decision' USING ERRCODE = '22023';
  END IF;
  IF v_request.requested_by = v_ctx.actor_id THEN
    RAISE EXCEPTION 'separation of duties: requester cannot approve or reject their own refund'
      USING ERRCODE = '42501';
  END IF;
  IF p_decision = 'approved' THEN
    SELECT coalesce(sum(r.amount_kobo), 0)::bigint INTO v_reserved
      FROM public.cg_fee_refund_request r
      JOIN public.cg_fee_refund_decision d ON d.request_id = r.id
     WHERE r.payment_id = v_request.payment_id AND d.decision = 'approved';
    IF v_reserved + v_request.amount_kobo > v_payment.amount_kobo THEN
      RAISE EXCEPTION 'approved refunds exceed payment amount' USING ERRCODE = '23514';
    END IF;
  END IF;
  INSERT INTO public.cg_fee_refund_decision (
    scope_ref, tenant_id, org_ref, request_id, invoice_id, payment_id,
    campus_id, principal_ref, amount_kobo, decision, reason, decided_by
  ) VALUES (
    v_request.scope_ref, v_ctx.tenant_id, v_request.org_ref, v_request.id,
    v_request.invoice_id, v_request.payment_id, v_request.campus_id,
    v_request.principal_ref, v_request.amount_kobo, p_decision,
    nullif(btrim(p_reason), ''), v_ctx.actor_id
  ) RETURNING id INTO v_decision;

  IF p_decision = 'approved' THEN
    SELECT p.id INTO v_payment_posting
      FROM public.cg_fee_ledger_posting p
     WHERE p.payment_id = v_request.payment_id AND p.event_type = 'payment';
    INSERT INTO public.cg_fee_ledger_posting (
      scope_ref, tenant_id, org_ref, invoice_id, payment_id, refund_decision_id,
      campus_id, subject_ref, principal_ref, event_type, amount_kobo,
      actor_id, reverses_posting_id
    ) VALUES (
      v_request.scope_ref, v_ctx.tenant_id, v_request.org_ref, v_request.invoice_id,
      v_request.payment_id, v_decision, v_request.campus_id, v_request.subject_ref,
      v_request.principal_ref, 'reversal', v_request.amount_kobo,
      v_ctx.actor_id, v_payment_posting
    ) RETURNING id INTO v_posting;
    INSERT INTO public.cg_fee_ledger_line (
      posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo
    )
    VALUES
      (v_posting, v_ctx.tenant_id, v_request.campus_id, v_request.principal_ref, 'accounts_receivable', v_request.amount_kobo, 0),
      (v_posting, v_ctx.tenant_id, v_request.campus_id, v_request.principal_ref, 'cash', 0, v_request.amount_kobo);
  END IF;
  RETURN jsonb_build_object('decision_id', v_decision, 'decision', p_decision, 'duplicate', false);
END
$$;

CREATE OR REPLACE FUNCTION public.cg_fee_append_only()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'fee schedules, invoices, payments, receipts, refund records, ledger, and audit are append-only'
    USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION public.cg_fee_append_only() FROM PUBLIC, anon, authenticated, service_role;

DO $tables$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cg_fee_schedule','cg_fee_invoice','cg_fee_payment','cg_fee_refund_request',
    'cg_fee_refund_decision','cg_fee_ledger_posting','cg_fee_ledger_line','cg_fee_receipt',
    'cg_fee_audit_event'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cg_fee_append_only()',
      v_table || '_append_only', v_table
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.cg_fee_append_only()',
      v_table || '_append_only_truncate', v_table
    );
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY[
    'cg_fee_schedule','cg_fee_invoice','cg_fee_payment','cg_fee_refund_request',
    'cg_fee_refund_decision','cg_fee_ledger_posting','cg_fee_receipt'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cg_fee_audit_insert()',
      v_table || '_audit_insert', v_table
    );
  END LOOP;
END
$tables$;

CREATE CONSTRAINT TRIGGER cg_fee_posting_balanced
  AFTER INSERT ON public.cg_fee_ledger_posting
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.cg_fee_posting_balanced();

CREATE OR REPLACE VIEW public.cg_fee_invoice_balances
WITH (security_invoker = true)
AS
SELECT i.id AS invoice_id,
       i.tenant_id,
       i.campus_id,
       i.subject_ref,
       i.principal_ref,
       i.amount_kobo AS invoiced_kobo,
       coalesce(bool_or(p.event_type = 'invoice_reversal'), false) AS is_reversed,
       coalesce(sum(l.debit_kobo - l.credit_kobo)
         FILTER (WHERE l.account_code = 'accounts_receivable'), 0)::bigint AS balance_kobo
  FROM public.cg_fee_invoice i
  LEFT JOIN public.cg_fee_ledger_posting p ON p.invoice_id = i.id
  LEFT JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
 GROUP BY i.id, i.tenant_id, i.campus_id, i.subject_ref, i.principal_ref, i.amount_kobo;

CREATE OR REPLACE VIEW public.cg_fee_receipt_sequence_status
WITH (security_invoker = true)
AS
SELECT tenant_id,
       count(*)::bigint AS issued_count,
       min(receipt_number) AS first_number,
       max(receipt_number) AS last_number,
       (min(receipt_number) = 1 AND max(receipt_number) = count(*)) AS gap_free
  FROM public.cg_fee_receipt
 GROUP BY tenant_id;

DO $policies$
DECLARE
  v_table text;
  v_campus_col text;
  v_principal_col text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cg_fee_schedule','cg_fee_invoice','cg_fee_payment','cg_fee_refund_request',
    'cg_fee_refund_decision','cg_fee_ledger_posting','cg_fee_ledger_line','cg_fee_receipt',
    'cg_fee_audit_event','cg_fee_receipt_counter'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY[
    'cg_fee_schedule','cg_fee_invoice','cg_fee_payment','cg_fee_refund_request',
    'cg_fee_refund_decision','cg_fee_ledger_posting','cg_fee_ledger_line','cg_fee_receipt',
    'cg_fee_audit_event'
  ] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    v_campus_col := CASE WHEN v_table = 'cg_fee_schedule' THEN 'NULL' ELSE 'campus_id' END;
    v_principal_col := CASE WHEN v_table = 'cg_fee_schedule' THEN 'NULL' ELSE 'principal_ref' END;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.cg_fee_can_read(tenant_id, school_id, %s, %s))',
      v_table || '_tenant_read', v_table, v_campus_col, v_principal_col
    );
  END LOOP;
END
$policies$;

REVOKE ALL ON public.cg_fee_receipt_counter FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status TO authenticated;
REVOKE ALL ON FUNCTION public.cg_fee_authorize(text, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_create_schedule(text, text, text, text, text, bigint, date, date)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_issue_invoice(text, uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_reverse_invoice(uuid, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_record_payment(uuid, bigint, text, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_request_refund(uuid, bigint, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cg_fee_decide_refund(uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cg_fee_create_schedule(text, text, text, text, text, bigint, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_issue_invoice(text, uuid, uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_reverse_invoice(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_record_payment(uuid, bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_request_refund(uuid, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_decide_refund(uuid, text, text) TO authenticated;
