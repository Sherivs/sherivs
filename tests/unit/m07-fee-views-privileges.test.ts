import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261104015000_sv1_m07_fee_views_revoke_anon.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261104015000_sv1_m07_fee_views_revoke_anon.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m07-fee-views-privileges.local.sql", "utf8");
const views = "public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status";

describe("M07 fee views privileges", () => {
  it("revokes everything from PUBLIC, anon and authenticated, then grants SELECT only", () => {
    expect(migration).toContain(`REVOKE ALL ON ${views} FROM PUBLIC, anon, authenticated;`);
    expect(migration).toContain(`GRANT SELECT ON ${views} TO authenticated, service_role;`);
    expect(migration).not.toMatch(/GRANT[^;]*\banon\b/i);
    expect(migration.match(/^GRANT /gm)).toHaveLength(1);
  });

  it("keeps security_invoker on both views", () => {
    expect(migration).toContain("cg_fee_invoice_balances SET (security_invoker = true)");
    expect(migration).toContain("cg_fee_receipt_sequence_status SET (security_invoker = true)");
  });

  it("rolls back to the prior ACL without TRUNCATE", () => {
    expect(rollback).toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON ${views} TO anon, authenticated;`,
    );
    expect(rollback).not.toMatch(/GRANT[^;]*TRUNCATE/i);
    expect(rollback).not.toMatch(/GRANT ALL/i);
  });

  it("ships a real-Postgres harness asserting anon has no privileges", () => {
    expect(harness).toContain("has_table_privilege('anon'");
    expect(harness).toContain("'MAINTAIN'");
    expect(harness).toContain("has_table_privilege('authenticated'");
  });
});
