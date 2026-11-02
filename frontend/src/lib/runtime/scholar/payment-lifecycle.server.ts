type RpcError = { message: string };
type RpcResult<T> = PromiseLike<{ data: T | null; error: RpcError | null }>;

export interface FinancialLifecycleDb {
  rpc<T = unknown>(name: string, args: Record<string, unknown>): RpcResult<T>;
}

export type FinancialRoute = {
  tenant_id: string;
  org_ref: string;
  subaccount_code: string;
};

export type FinancialIntent = {
  reference: string;
  tenant_id: string;
  org_ref: string;
  amount_minor: number;
  currency: string;
  expires_at: string;
};

export type FinancialReconciliation = {
  verdict: "matched" | "mismatch" | "unknown_reference" | "expired";
  expected_minor?: number;
  currency?: string;
  subject_ref?: string;
  scope_ref?: string;
};

function throwOnError(error: RpcError | null, operation: string): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export async function resolveFinancialRoute(
  db: FinancialLifecycleDb,
  scopeRef: string,
): Promise<FinancialRoute | null> {
  const { data, error } = await db.rpc<FinancialRoute[]>("cg_financial_route_for_scope", {
    p_scope_ref: scopeRef,
  });
  throwOnError(error, "financial route lookup");
  return data?.[0] ?? null;
}

export async function createFinancialIntent(
  db: FinancialLifecycleDb,
  input: {
    reference: string;
    scopeRef: string;
    subjectRef: string;
    principalRef: string;
    amountMinor: number;
    currency: string;
    planPartId?: string;
  },
): Promise<FinancialIntent> {
  const { data, error } = await db.rpc<FinancialIntent>("cg_financial_create_intent", {
    p_reference: input.reference,
    p_scope_ref: input.scopeRef,
    p_subject_ref: input.subjectRef,
    p_principal_ref: input.principalRef,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
    p_plan_part_id: input.planPartId ?? null,
  });
  throwOnError(error, "financial intent creation");
  if (!data) throw new Error("financial intent creation returned no record");
  return data;
}

export async function failFinancialIntent(
  db: FinancialLifecycleDb,
  reference: string,
): Promise<void> {
  const { error } = await db.rpc("cg_financial_fail_intent", {
    p_reference: reference,
  });
  throwOnError(error, "financial intent failure");
}

export async function reconcileFinancialPayment(
  db: FinancialLifecycleDb,
  input: {
    reference: string;
    providerEventRef: string;
    amountMinor: number;
    currency: string;
    paidAt: string | null;
  },
): Promise<FinancialReconciliation> {
  const { data, error } = await db.rpc<FinancialReconciliation>(
    "cg_financial_record_reconciliation",
    {
      p_reference: input.reference,
      p_provider_event_ref: input.providerEventRef,
      p_observed_minor: input.amountMinor,
      p_observed_currency: input.currency,
      p_paid_at: input.paidAt,
    },
  );
  throwOnError(error, "financial reconciliation");
  if (!data) throw new Error("financial reconciliation returned no verdict");
  return data;
}

export async function recordFinancialSettlement(
  db: FinancialLifecycleDb,
  input: {
    reference: string;
    providerEventRef: string;
    amountMinor: number;
    currency: string;
    paidAt: string | null;
  },
): Promise<{
  outcome:
    | "settled"
    | "duplicate"
    | "unknown_reference"
    | "expired"
    | "not_pending"
    | "amount_or_currency_mismatch";
}> {
  const { data, error } = await db.rpc<{
    outcome:
      | "settled"
      | "duplicate"
      | "unknown_reference"
      | "expired"
      | "not_pending"
      | "amount_or_currency_mismatch";
  }>("cg_financial_record_settlement", {
    p_reference: input.reference,
    p_provider_event_ref: input.providerEventRef,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
    p_paid_at: input.paidAt,
  });
  throwOnError(error, "financial settlement record");
  if (!data) throw new Error("financial settlement record returned no outcome");
  return data;
}

export async function createFinancialPlan(
  db: FinancialLifecycleDb,
  input: {
    scopeRef: string;
    subjectRef: string;
    principalRef: string;
    totalMinor: number;
    currency: string;
    parts: Array<{ amount_minor: number; due_at: string }>;
  },
): Promise<string> {
  const { data, error } = await db.rpc<string>("cg_financial_create_plan", {
    p_scope_ref: input.scopeRef,
    p_subject_ref: input.subjectRef,
    p_principal_ref: input.principalRef,
    p_total_minor: input.totalMinor,
    p_currency: input.currency,
    p_parts: input.parts,
  });
  throwOnError(error, "financial plan creation");
  if (!data) throw new Error("financial plan creation returned no id");
  return data;
}

export async function requestFinancialReversal(
  db: FinancialLifecycleDb,
  input: {
    entryId: string;
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
    requestedBy: string;
  },
): Promise<{ id: string; state: string; reference?: string; duplicate?: boolean }> {
  const { data, error } = await db.rpc<{
    id: string;
    state: string;
    reference?: string;
    duplicate?: boolean;
  }>("cg_financial_request_reversal", {
    p_entry_id: input.entryId,
    p_amount_minor: input.amountMinor,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_requested_by: input.requestedBy,
  });
  throwOnError(error, "financial reversal request");
  if (!data) throw new Error("financial reversal request returned no record");
  return data;
}

export async function finishFinancialReversal(
  db: FinancialLifecycleDb,
  input: {
    id: string;
    state: "processing" | "processed" | "failed" | "cancelled";
    providerRef?: string;
  },
): Promise<void> {
  const { error } = await db.rpc("cg_financial_finish_reversal", {
    p_id: input.id,
    p_state: input.state,
    p_provider_ref: input.providerRef ?? null,
  });
  throwOnError(error, "financial reversal update");
}

export async function recordFinancialRefund(
  db: FinancialLifecycleDb,
  input: {
    providerReference: string;
    reference: string;
    amountMinor: number;
    currency: string;
  },
): Promise<{
  outcome:
    | "processed"
    | "duplicate"
    | "unknown_reference"
    | "amount_or_currency_mismatch"
    | "not_processing";
}> {
  const { data, error } = await db.rpc<{
    outcome:
      | "processed"
      | "duplicate"
      | "unknown_reference"
      | "amount_or_currency_mismatch"
      | "not_processing";
  }>("cg_financial_record_refund", {
    p_provider_ref: input.providerReference,
    p_reference: input.reference,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
  });
  throwOnError(error, "financial refund reconciliation");
  if (!data) throw new Error("financial refund reconciliation returned no outcome");
  return data;
}
