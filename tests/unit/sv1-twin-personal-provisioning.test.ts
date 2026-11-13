import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261103154000_sv1_twin_personal_provisioning.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261103154000_sv1_twin_personal_provisioning.sql",
  "utf8",
);
const serverFunction = readFileSync(
  "frontend/src/lib/runtime/scholar/personal-twin.functions.ts",
  "utf8",
);
const harness = readFileSync("tests/integration/sv1-twin-personal.local.sql", "utf8");
const adr = readFileSync("architecture/adr/ADR-029_SV1_TWIN_PERSONAL_PROVISIONING.md", "utf8");

describe("SV1-TWIN-01 personal twin provisioning", () => {
  it("enforces one identity-bound tenant twin and links only to existing memory scope", () => {
    expect(migration).toMatch(
      /CONSTRAINT cg_personal_twin_identity_tenant_unique UNIQUE \(identity_id, school_id\)/,
    );
    expect(migration).toContain("FOREIGN KEY (memory_scope_id, tenant_ref)");
    expect(migration).toContain("REFERENCES public.cg_memory_scope (id, tenant_id)");
    expect(migration).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)? public\.cg_memory_/i);
    expect(migration).not.toMatch(/digital_twin_(?:config|calls)/i);
  });

  it("forces active-tenant, self-only reads and keeps direct writes unavailable", () => {
    expect(migration).toContain("ALTER TABLE public.cg_personal_twin ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.cg_personal_twin FORCE ROW LEVEL SECURITY");
    expect(migration).toMatch(/identity_id = \(SELECT auth\.uid\(\)\)/);
    expect(migration).toMatch(/school_id = \(SELECT public\.get_my_school_id\(\)\)/);
    expect(migration).toMatch(/GRANT SELECT ON TABLE public\.cg_personal_twin TO authenticated/);
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.cg_personal_twin FROM PUBLIC, anon, authenticated/,
    );
  });

  it("limits audited, idempotent provisioning to the service role", () => {
    expect(migration).toContain("public.cg_personal_twin_provision");
    expect(migration).toMatch(/ON CONFLICT|UNIQUE \(identity_id, school_id\)/);
    expect(migration).toContain("organization_memberships");
    expect(migration).toContain("'twin.personal.provision'");
    expect(migration).toContain("'outcome', 'denied'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.cg_personal_twin_provision\(uuid, uuid\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cg_personal_twin_provision\(uuid, uuid\) TO service_role/,
    );
    expect(serverFunction).toContain(".middleware([requireSupabaseAuth])");
    expect(serverFunction).toContain('context.supabase.rpc("get_my_school_id")');
    expect(serverFunction).toContain("context.userId");
    expect(serverFunction).toContain("supabaseAdmin");
    expect(serverFunction).toContain("cg_personal_twin_provision");
    expect(serverFunction).toContain('result.outcome === "denied"');
  });

  it("ships a matching rollback and disposable tenant/user isolation harness", () => {
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.cg_personal_twin_provision");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.cg_personal_twin");
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS public\.cg_memory_/i);
    expect(harness).toContain("coregrid_twin_test");
    expect(harness).toContain("coregrid.test_disposable_database");
    expect(harness).toContain("identity cannot read their twin in another tenant");
    expect(harness).toContain("identity cannot read another user twin in the same tenant");
    expect(harness).toContain("duplicate identity/tenant twin was inserted");
    expect(harness).toContain("every provision attempt must be audited");
    expect(harness).toContain("denied provision attempt must be audited");
    expect(harness).toContain("ROLLBACK;");
    expect(adr).toContain("ADR-029");
    expect(adr).toContain("ACTIVE-V1 TWIN-01");
  });
});
