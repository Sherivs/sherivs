import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261104014500_sherivs_m11_data_subject_requests.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261104014500_sherivs_m11_data_subject_requests.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m11-data-subject-requests.local.sql", "utf8");
const adr = readFileSync("architecture/adr/ADR-047_M11_DATA_SUBJECT_REQUESTS.md", "utf8");
const tables = ["dsr_settings", "dsr_requests", "dsr_request_events"];
const writers = [
  "dsr_settings_configure",
  "dsr_open",
  "dsr_verify_identity",
  "dsr_erasure_decide",
  "dsr_portability_export",
  "dsr_close",
  "dsr_overdue",
];

describe("M11 data-subject requests migration", () => {
  it("enables and forces RLS on every table and grants authenticated SELECT only", () => {
    for (const t of tables) {
      expect(migration).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`);
    }
    expect(migration).toContain(
      "GRANT SELECT ON public.dsr_settings, public.dsr_requests, public.dsr_request_events TO authenticated;",
    );
    expect(migration).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*\bTO\b[^;]*authenticated/i);
    expect(migration).not.toMatch(/GRANT[^;]*\banon\b/i);
  });

  it("scopes every read policy to the caller's tenant and the role-management permission", () => {
    const policies = migration.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(3);
    for (const p of policies) {
      expect(p).toContain("get_my_school_id()");
      expect(p).toContain("can_manage_roles(org_id, 'roles.configure')");
    }
  });

  it("makes every SECURITY DEFINER function pin an empty search_path", () => {
    const fns = migration.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(11);
    for (const f of fns) {
      if (/SECURITY DEFINER/.test(f)) expect(f).toContain("SET search_path = ''");
    }
  });

  it("exposes only the intended entry points to authenticated", () => {
    const grant = migration.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO authenticated;/)?.[0] ?? "";
    for (const w of writers) expect(grant).toContain(`public.${w}(`);
    expect(grant).not.toContain("dsr_event_write");
    expect(grant).not.toContain("dsr_erasure_blocking_holds");
    expect(grant).not.toContain("service_role");
  });

  it("never updates or deletes source records in erasure", () => {
    const decide = migration.match(/FUNCTION public\.dsr_erasure_decide[\s\S]*?\n\$\$;/)?.[0] ?? "";
    expect(decide).not.toMatch(/\b(DELETE FROM|UPDATE public\.(attendance|messages|fees|student_platform_fee_ledger|staff_payroll|students|users))\b/);
    expect(decide).toContain("dsr_erasure_blocking_holds");
  });

  it("checks tenant, subject, category and record holds", () => {
    for (const scope of ["'tenant'", "'subject'", "'category'", "'record'"]) {
      expect(migration).toContain(`h.hold_scope = ${scope}`);
    }
  });

  it("keeps events append-only and the request clock immutable", () => {
    expect(migration).toContain("dsr_event_immutable");
    expect(migration).toContain("dsr_event_no_truncate");
    expect(migration).toContain("NEW.due_at IS DISTINCT FROM OLD.due_at");
    expect(migration).toContain("data-subject requests cannot be deleted");
  });

  it("rolls back non-destructively", () => {
    expect(rollback).toContain("REVOKE EXECUTE ON FUNCTION");
    expect(rollback).not.toMatch(/DROP\s+(TABLE|SCHEMA)|DELETE\s+FROM|TRUNCATE/i);
  });
});

describe("M11 evidence", () => {
  it("ships a harness covering SLA, erasure under hold and subject-only export", () => {
    expect(harness).toContain("M11 ALL PASS");
    expect(harness).toContain("erasure must be blocked under a subject legal hold");
    expect(harness).toContain("export leaked another subject");
    expect(harness).toContain("dsr_overdue");
  });

  it("records ADR-047 with the migration-number and execution residual risks", () => {
    expect(adr).toContain("ADR-047");
    expect(adr).toContain("20261104014500");
    expect(adr).toContain("Erasure is not executed here");
  });
});
