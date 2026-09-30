import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFORMANCE_DECISIONS,
  EVIDENCE_LIFECYCLES,
  EXECUTION_STATUSES,
  EXTERNAL_EFFECTS,
  MISSION_LIFECYCLES,
  VERIFICATION_DECISIONS,
} from "@/lib/control-plane/foundation-mission";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20260929000000_coregrid_foundation_mission_001.sql"),
  "utf8",
);

const vocabularies = [
  MISSION_LIFECYCLES,
  EXECUTION_STATUSES,
  EXTERNAL_EFFECTS,
  EVIDENCE_LIFECYCLES,
  VERIFICATION_DECISIONS,
  CONFORMANCE_DECISIONS,
];

describe("foundation persistence schema", () => {
  it("pins every contract vocabulary value in the migration", () => {
    for (const values of vocabularies) {
      for (const value of values) {
        expect(MIGRATION).toContain(`'${value}'`);
      }
    }
  });

  it("keeps request, attempt, result, and effect as separate columns", () => {
    expect(MIGRATION).toContain("requested_at");
    expect(MIGRATION).toContain("attempt_id");
    expect(MIGRATION).toContain("external_effect");
    expect(MIGRATION).toContain("UNIQUE (tenant_id, mission_id, idempotency_key, action)");
  });

  it("refuses verified decisions without evidence and conformant decisions on contract mismatch", () => {
    expect(MIGRATION).toContain("decision <> 'verified' OR cardinality(evidence_ids) > 0");
    expect(MIGRATION).toContain(
      "declared_contract_id = observed_contract_id AND declared_version = observed_version",
    );
  });

  it("denies anon and authenticated by default and keeps history append-only", () => {
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("FROM anon, authenticated");
    expect(MIGRATION).toContain("cg_execution_history is append-only");
    expect(MIGRATION).not.toContain("CREATE POLICY");
  });

  it("rolls back by dropping dependents before mission intent", () => {
    const conformance = ROLLBACK.indexOf("cg_conformance_assessment");
    const verification = ROLLBACK.indexOf("cg_verification_result");
    const execution = ROLLBACK.indexOf("cg_execution_record");
    const mission = ROLLBACK.indexOf("cg_mission_intent");
    expect(conformance).toBeGreaterThan(-1);
    expect(conformance).toBeLessThan(verification);
    expect(verification).toBeLessThan(execution);
    expect(execution).toBeLessThan(mission);
  });
});
