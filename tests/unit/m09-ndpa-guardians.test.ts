import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261103110000_sherivs_m09_ndpa_guardians.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261103110000_sherivs_m09_ndpa_guardians.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m09-ndpa-guardians.local.sql", "utf8");
const adr = readFileSync("architecture/adr/ADR-017_M09_NDPA_CONSENT_GUARDIANS.md", "utf8");

describe("M09 NDPA consent and guardian model", () => {
  it("adds tenant-scoped effective-dated relationships without seeding identities", () => {
    expect(migration).toContain("CREATE TABLE public.student_guardian_relationships");
    for (const relationship of ["legal_guardian", "parent", "caregiver", "fee_payer"]) {
      expect(migration).toContain(`'${relationship}'`);
    }
    expect(migration).toContain(
      "CHECK (relationship_type <> 'fee_payer' OR records_access IS FALSE)",
    );
    expect(migration).toContain("effective_from <= current_date");
    expect(migration).toContain(
      "ALTER TABLE public.student_guardian_relationships FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("student_guardian_relationship_events_immutable_truncate");
    expect(migration.slice(0, migration.indexOf("CREATE OR REPLACE FUNCTION"))).not.toMatch(
      /INSERT\s+INTO\s+public\.student_guardian_relationships/i,
    );
  });

  it("records attributed lawful bases and blocks every purpose after withdrawal", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS lawful_basis text");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS granted_by uuid");
    expect(migration).toContain("public.consent_set_for_actor");
    expect(migration).toContain("consent_events_audit_insert");
    expect(migration).toContain("consent_events_immutable_truncate");
    expect(migration).toContain("c.status = 'granted'");
    expect(migration).toContain("c.withdrawn_at IS NULL");
    expect(migration).toContain("public.is_student_consent_guardian(student_id, school_id)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.consent_set_v1");
    expect(migration).toContain(
      "REVOKE EXECUTE ON FUNCTION public.consent_set(uuid, text, boolean, text, text)",
    );
    expect(migration).toContain("ALTER TABLE public.consent_events FORCE ROW LEVEL SECURITY");
  });

  it("ships a matching rollback and a disposable tenant/withdrawal acceptance harness", () => {
    expect(rollback).toContain("DROP TABLE IF EXISTS public.student_guardian_relationships");
    expect(rollback).toContain("DROP COLUMN IF EXISTS lawful_basis");
    expect(harness).toContain("fee payer cannot access learner records");
    expect(harness).toContain("withdrawal blocks the purpose immediately");
    expect(harness).toContain("consent history is append-only");
    expect(harness).toContain("adult learner consents for themself");
    expect(harness).toContain("ROLLBACK;");
    expect(adr).toContain("ADR-017");
    expect(adr).toContain("V1 organizational consent");
  });
});
