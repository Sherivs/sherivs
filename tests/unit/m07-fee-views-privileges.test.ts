import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261104010000_sv1_m07_fee_views_revoke_anon.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261104010000_sv1_m07_fee_views_revoke_anon.sql",
  "utf8",
);
const views = "public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status";

describe("M07 fee views privileges", () => {
  it("revokes all anon/PUBLIC privileges and non-SELECT authenticated privileges", () => {
    expect(migration).toContain(`REVOKE ALL ON ${views} FROM PUBLIC, anon;`);
    expect(migration).toContain(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ${views} FROM authenticated;`,
    );
    expect(migration).toContain(`GRANT SELECT ON ${views} TO authenticated, service_role;`);
    expect(migration).not.toMatch(/GRANT[^;]*\banon\b/i);
  });

  it("keeps security_invoker on both views", () => {
    expect(migration).toContain("cg_fee_invoice_balances SET (security_invoker = true)");
    expect(migration).toContain("cg_fee_receipt_sequence_status SET (security_invoker = true)");
  });

  it("has a rollback", () => {
    expect(rollback).toContain("cg_fee_invoice_balances");
  });
});
