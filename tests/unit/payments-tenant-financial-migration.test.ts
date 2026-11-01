import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "database/supabase/migrations/20261101000060_cg_financial_scope.sql";
const rollbackPath = "database/supabase/rollbacks/20261101000060_cg_financial_scope.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");

describe("tenant-scoped financial continuity migration", () => {
  it("is additive, unapplied, timestamped after the existing payment migration, and reversible", () => {
    expect(migration).toMatch(/authored, NOT APPLIED/i);
    expect(migration).toContain("20261101000060_cg_financial_scope.sql");
    expect(rollback).toContain("NOT APPLIED");
    expect(rollback).toContain("cg_financial_scope_binding");
    expect(rollback).toContain("cg_financial_provider_route");
    expect(migration).not.toMatch(/\b(?:school_id|school|student_id|fees?)\b/i);
  });

  it("binds opaque legacy scopes to a same-tenant organization and is server-only", () => {
    expect(migration).toMatch(
      /FOREIGN KEY \(org_ref, tenant_id\) REFERENCES public\.cg_org_unit \(id, tenant_id\)/,
    );
    expect(migration).toMatch(
      /FUNCTION public\.cg_financial_bind_scope[\s\S]*?auth\.role\(\)[\s\S]*?'service_role'/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cg_financial_bind_scope\(text, text, text, text\) TO service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.cg_financial_bind_scope\(text, text, text, text\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(/binding is immutable/);
  });

  it("resolves provider routing only from the server-provisioned scope binding", () => {
    expect(migration).toMatch(
      /CREATE TABLE public\.cg_financial_provider_route[\s\S]*?PRIMARY KEY \(tenant_id, org_ref\)[\s\S]*?FOREIGN KEY \(org_ref, tenant_id\) REFERENCES public\.cg_org_unit \(id, tenant_id\)/,
    );
    expect(migration).toMatch(
      /FUNCTION public\.cg_financial_route_for_scope\(p_scope_ref text\)[\s\S]*?JOIN public\.cg_financial_provider_route r[\s\S]*?r\.tenant_id = b\.tenant_id AND r\.org_ref = b\.org_ref AND r\.active/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cg_financial_route_for_scope\(text\) TO service_role/,
    );
  });

  it("forces RLS and limits reads to the authenticated principal or tenant administrator", () => {
    for (const table of [
      "cg_financial_plan",
      "cg_financial_plan_part",
      "cg_financial_intent",
      "cg_financial_entry",
      "cg_financial_evidence",
      "cg_financial_reversal",
      "cg_financial_reconciliation",
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toMatch(/ALTER TABLE public\.%I FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(
      /tenant_id = public\.get_my_tenant_id\(\) AND \(principal_ref = auth\.uid\(\)::text OR public\.is_tenant_admin\(tenant_id\)\)/,
    );
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.cg_financial_plan/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX cg_financial_intent_one_pending_subject[\s\S]*?ON public\.cg_financial_intent \(scope_ref, subject_ref\)[\s\S]*?WHERE state = 'pending'/,
    );
    expect(migration).toMatch(/tenant_id = public\.get_my_tenant_id\(\)/);
  });

  it("denies authenticated cross-tenant reads and keeps org routing unavailable to clients", () => {
    expect(migration).toMatch(
      /FOR SELECT TO authenticated USING \(tenant_id = public\.get_my_tenant_id\(\) AND \(principal_ref = auth\.uid\(\)::text OR public\.is_tenant_admin\(tenant_id\)\)\)/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.cg_financial_scope_binding FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cg_financial_route_for_scope\(text\) TO service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.cg_financial_route_for_scope\(text\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it("checks plan totals, scheduled amount, settlement amount/currency, and expiration on the server", () => {
    expect(migration).toMatch(/v_count NOT BETWEEN 2 AND 24/);
    expect(migration).toMatch(/v_sum <> p_total_minor/);
    expect(migration).toMatch(/p_amount_minor <> v_part\.due_minor - v_part\.applied_minor/);
    expect(migration).toMatch(/p_amount_minor IS DISTINCT FROM v_intent\.amount_minor/);
    expect(migration).toMatch(
      /upper\(coalesce\(p_currency, ''\)\) IS DISTINCT FROM v_intent\.currency/,
    );
    expect(migration).toMatch(/v_now >= v_intent\.expires_at/);
    expect(migration).toMatch(
      /v_intent\.state NOT IN \('pending', 'expired'\)[\s\S]*?v_intent\.state = 'expired'[\s\S]*?p_paid_at IS NULL OR p_paid_at >= v_intent\.expires_at/,
    );
    expect(migration).toMatch(
      /cg_financial_plan_part\s+SET applied_minor = applied_minor \+ v_intent\.amount_minor/,
    );
    expect(migration).toMatch(/'subject_ref', v_intent\.subject_ref/);
    expect(migration).toMatch(/'scope_ref', v_intent\.scope_ref/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(
      /FUNCTION public\.cg_financial_fail_intent\(p_reference text\)[\s\S]*?auth\.role\(\)[\s\S]*?'service_role'[\s\S]*?SET state = 'failed'/,
    );
    expect(rollback).toContain("cg_financial_fail_intent(text)");
  });

  it("creates immutable settlement evidence and reconciliation records and caps cumulative reversals", () => {
    expect(migration).toMatch(/CREATE TABLE public\.cg_financial_evidence/);
    expect(migration).toMatch(/CREATE TRIGGER cg_financial_entry_immutable/);
    expect(migration).toMatch(/provider_event_ref text NOT NULL UNIQUE/);
    expect(migration).toMatch(
      /CREATE INDEX cg_financial_reconciliation_event_recent[\s\S]*?ON public\.cg_financial_reconciliation \(provider_event_ref, checked_at DESC\)/,
    );
    expect(migration).not.toMatch(
      /CREATE TABLE public\.cg_financial_reconciliation[\s\S]*?provider_event_ref text NOT NULL UNIQUE/,
    );
    expect(migration).not.toContain("ON CONFLICT (provider_event_ref)");
    expect(migration).toMatch(/v_reserved \+ p_amount_minor > v_entry\.amount_minor/);
    expect(migration).toMatch(/CREATE TABLE public\.cg_financial_reconciliation/);
    expect(migration).toMatch(/expected_minor, observed_minor, expected_currency/);
  });
});
