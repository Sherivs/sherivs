/**
 * CoreGrid — R6 delivery-evidence migration posture test (follow-up to
 * V1-009, team COMMS).
 *
 * Text-level posture verification of the delivery-evidence substrate's
 * deny-by-default signature, in the pattern of
 * tests/unit/h3-040-posture-adjudication.test.ts (read-only file assertions,
 * no database, no network):
 *   1. the migration authors the append-only table with RLS ENABLED;
 *   2. ZERO policies are authored (deny-by-default strongest form);
 *   3. all client privileges are REVOKED (anon + authenticated);
 *   4. append-only evidence law is database-enforced (mutation trigger);
 *   5. the rollback is a genuine inverse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const MIGRATION_PATH = "database/supabase/migrations/20261003000031_coregrid_delivery_evidence.sql";
const ROLLBACK_PATH = "database/supabase/rollbacks/20261003000031_coregrid_delivery_evidence.sql";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");

const TABLE = "public.cg_delivery_evidence";

describe("R6 delivery-evidence migration — deny-by-default signature", () => {
  it("creates the cg_delivery_evidence table with RLS enabled", () => {
    expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS ${TABLE} (`);
    expect(MIGRATION).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
  });

  it("authors ZERO policies (no CREATE POLICY anywhere in the migration)", () => {
    expect(MIGRATION).not.toMatch(/CREATE POLICY/);
    expect(MIGRATION).toContain("RLS ENABLED with ZERO policies");
  });

  it("revokes ALL client privileges (deny-by-default strongest form, service-role only)", () => {
    expect(MIGRATION).toContain(`REVOKE ALL ON ${TABLE} FROM anon, authenticated;`);
  });

  it("enforces the append-only evidence law at the database boundary", () => {
    expect(MIGRATION).toContain("BEFORE UPDATE OR DELETE ON public.cg_delivery_evidence");
    expect(MIGRATION).toContain("RAISE EXCEPTION");
    expect(MIGRATION).toContain("append-only");
    // No updated_at COLUMN: evidence is never mutated, only appended.
    expect(MIGRATION).not.toMatch(/^\s*updated_at\b/m);
  });

  it("records §12 provenance fields with the AI flag false by default", () => {
    expect(MIGRATION).toContain("triggered_by");
    expect(MIGRATION).toContain("trigger_source");
    expect(MIGRATION).toContain("ai_generated        boolean NOT NULL DEFAULT false");
  });

  it("keeps the recipient redaction-aware — the row shape exists for REDACTED values only", () => {
    expect(MIGRATION).toContain("recipient_redacted  text NOT NULL");
  });

  it("the rollback is a genuine inverse: drops the trigger, function and table", () => {
    expect(ROLLBACK).toContain("DROP TRIGGER IF EXISTS cg_delivery_evidence_append_only ON public.cg_delivery_evidence;");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_delivery_evidence;");
    expect(ROLLBACK).toContain("DROP FUNCTION IF EXISTS public.cg_delivery_evidence_forbid_mutation();");
  });

  it("the rollback restores the documented pre-migration privilege posture and runs in one transaction", () => {
    expect(ROLLBACK).toContain("BEGIN;");
    expect(ROLLBACK).toContain("COMMIT;");
    expect(ROLLBACK).toContain("GRANT ALL ON TABLE public.cg_delivery_evidence TO anon, authenticated;");
  });

  it("both files declare AUTHORED-NOT-APPLIED status (governance law)", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
  });
});
