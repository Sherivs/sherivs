import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261103130000_sv1_m07_fees_ledger_receipts.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261103130000_sv1_m07_fees_ledger_receipts.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m07-fees-ledger.local.sql", "utf8");

describe("M07 fee ledger and receipts", () => {
  it("adds a forward-only V1 migration and a data-preserving rollback", () => {
    expect(migration).toContain("20261103130000_sv1_m07_fees_ledger_receipts.sql");
    expect(migration).toMatch(/authored, NOT APPLIED/i);
    expect(migration).toContain("M07 requires M009-A1, M04, and cg financial scope");
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
    expect(rollback).toContain("M07 rollback refused");
    expect(rollback).toContain("financial or audit data");
  });

  it("stores Naira amounts as integer kobo in tenant-bound fee records", () => {
    for (const table of [
      "cg_fee_schedule",
      "cg_fee_invoice",
      "cg_fee_payment",
      "cg_fee_refund_request",
      "cg_fee_ledger_posting",
      "cg_fee_receipt",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toMatch(
        new RegExp(`CREATE TABLE public\\.${table}[\\s\\S]*?amount_kobo bigint`),
      );
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("debit_kobo bigint NOT NULL DEFAULT 0");
    expect(migration).toContain("credit_kobo bigint NOT NULL DEFAULT 0");
    expect(
      migration.match(/currency text NOT NULL DEFAULT 'NGN' CHECK \(currency = 'NGN'\)/g),
    ).toHaveLength(5);
    expect(migration).toContain("REFERENCES public.cg_financial_scope_binding");
  });

  it("keeps every ledger record immutable and blocks table truncation", () => {
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.%I");
    expect(migration).toContain("BEFORE TRUNCATE ON public.%I");
    expect(migration).toContain("cg_fee_append_only()");
    expect(migration).toContain(
      "REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    for (const table of [
      "schedule",
      "invoice",
      "payment",
      "refund request",
      "refund decision",
      "ledger posting",
      "ledger line",
      "receipt",
      "audit event",
    ]) {
      expect(harness).toContain(`'${table} rejects UPDATE'`);
      expect(harness).toContain(`'${table} rejects DELETE'`);
    }
  });

  it("reconciles balances from two-sided, balanced journal entries", () => {
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("exactly two balanced integer-kobo lines");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.cg_fee_reverse_invoice");
    expect(migration).toContain("invoice_reversal");
    expect(migration).toContain("cg_fee_invoice_balances");
    expect(migration).toContain("account_code = 'accounts_receivable'");
    expect(harness).toContain("invoice balance is reconstructed from ledger lines");
    expect(harness).toContain("view balance equals the sum of ledger lines");
    expect(harness).toContain("invoice corrections use a balanced reversal entry");
  });

  it("allocates sequential per-tenant receipts without gaps on rollback or retries", () => {
    expect(migration).toContain("UNIQUE (tenant_id, receipt_number)");
    expect(migration).toContain("cg_fee_receipt_counter");
    expect(migration).toContain("SET last_number = public.cg_fee_receipt_counter.last_number + 1");
    expect(migration).toContain("cg_fee_receipt_sequence_status");
    expect(migration).toContain(
      "(min(receipt_number) = 1 AND max(receipt_number) = count(*)) AS gap_free",
    );
    expect(harness).toContain("receipt numbers are sequential, tenant-unique, and gap-free");
    expect(harness).toContain("receipt sequence gap is detected");
  });

  it("enforces cashier/bursar permissions and distinct refund request and decision actors", () => {
    expect(migration).toMatch(
      /UPDATE public\.role_template_permissions[\s\S]*?SET default_on = false[\s\S]*?template_code = 'bursar'[\s\S]*?permission_code = 'payments\.record_cash'/,
    );
    expect(rollback).toMatch(
      /M07 rollback refused while a bursar assignment depends on the cashier\/refund separation/,
    );
    expect(rollback).toMatch(/SET default_on = true/);
    expect(migration).toContain(
      "(p_permission = 'payments.record_cash' AND p_role_template = 'cashier')",
    );
    expect(migration).toContain(
      "(p_permission = 'payments.refund' AND p_role_template = 'bursar')",
    );
    expect(migration).toContain("workspace_role_sod_assert(v_school, v_actor)");
    expect(migration).toContain("v_request.requested_by = v_ctx.actor_id");
    expect(migration).toContain("public.get_my_school_id() IS DISTINCT FROM v_school");
    expect(harness).toContain("cashier cannot approve a refund");
    expect(harness).toContain("same user cannot request and approve a refund");
    expect(harness).toContain("auditor remains read-only");
    expect(harness).toContain("auditor cannot record a payment");
  });

  it("retains attributed audit events and tenant-scoped read policies", () => {
    expect(migration).toContain("cg_fee_audit_event");
    expect(migration).toContain("fee ledger audit requires an attributed actor");
    expect(migration).toContain("public.cg_fee_can_read(tenant_id, school_id");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(harness).toContain("tenant B cannot read tenant A fees");
    expect(harness).toContain("tenant A cannot read tenant B fees");
  });
});
