import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const migration = read(
  "database/supabase/migrations/20261104000100_sherivs_whatsapp_n8n_ambiguity_fix.sql",
);
const rollback = read(
  "database/supabase/rollbacks/20261104000100_sherivs_whatsapp_n8n_ambiguity_fix.sql",
);
const harness = read("tests/integration/whatsapp-n8n-ambiguity-fix.local.sql");

describe("WhatsApp n8n RPC 42702 ambiguity fix posture", () => {
  it("resolves OUT-parameter conflicts in favour of columns in both RPCs", () => {
    expect(migration.match(/#variable_conflict use_column/g)).toHaveLength(2);
    expect(migration).toContain("public.cg_whatsapp_claim_n8n_outbox(p_limit integer DEFAULT 20)");
    expect(migration).toContain("public.cg_whatsapp_prepare_n8n_reply(");
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path TO ''/g)).toHaveLength(2);
  });

  it("changes nothing but the two function bodies", () => {
    expect(migration).not.toMatch(/\b(GRANT|REVOKE|DROP|DELETE|TRUNCATE)\b|^(BEGIN|COMMIT);/m);
    expect(migration).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY|ALTER TABLE/i);
  });

  it("rollback is the migration minus the directive", () => {
    expect(rollback).not.toContain("#variable_conflict");
    const strip = (s: string) => s.slice(s.indexOf("\nCREATE OR REPLACE FUNCTION"));
    expect(strip(rollback)).toBe(
      strip(migration).replaceAll("#variable_conflict use_column\n", ""),
    );
  });

  it("ships a loopback-guarded real-Postgres harness covering claim, dead letter, and denial", () => {
    expect(harness).toContain("inet_server_addr()");
    expect(harness).toContain("rolsuper");
    expect(harness).toMatch(/ROLLBACK;\s*$/);
    expect(harness).toContain("cg_whatsapp_claim_n8n_outbox(20)");
    expect(harness).toContain("retry_exhausted");
    expect(harness).toContain("ambiguous_column");
    expect(harness).toContain("insufficient_privilege");
  });
});
