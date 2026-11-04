import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261104016000_sv1_sched_data_model.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261104016000_sv1_sched_data_model.sql"),
  "utf8",
);
const ISOLATION_TEST = readFileSync(
  join(ROOT, "tests/integration/scheduling-rls.local.sql"),
  "utf8",
);

const TABLES = [
  "cg_schedule_bell_schedule",
  "cg_schedule_period",
  "cg_schedule_room",
  "cg_schedule_teaching_load",
  "cg_schedule_participant_qualification",
  "cg_schedule_participant_availability",
  "cg_schedule_constraint",
  "cg_schedule_version",
  "cg_schedule_placement",
];

describe("SV1-SCHED tenant-neutral data model", () => {
  it("uses the existing neutral tenant and organization scope", () => {
    expect(MIGRATION).toContain("tenant_id text NOT NULL");
    expect(MIGRATION).toContain("REFERENCES public.cg_org_unit (id, tenant_id)");
    expect(MIGRATION).toContain("public.get_my_tenant_id()");
    expect(MIGRATION).not.toMatch(/\bschool_id\b/i);
  });

  it("forces tenant RLS and keeps client privileges read-only", () => {
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("FORCE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated");
    expect(MIGRATION).toContain("GRANT SELECT ON TABLE public.%I TO authenticated");
    expect(MIGRATION).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role",
    );
    expect(MIGRATION).toContain("tenant_id = (SELECT public.get_my_tenant_id())");
    expect(ISOLATION_TEST).toContain("tenant A cannot read tenant B room");
    expect(ISOLATION_TEST).toContain("tenant A cannot write tenant B room");
    expect(ISOLATION_TEST).toContain("tenant B cannot read tenant A room");
    expect(ISOLATION_TEST).toContain("tenant B cannot write tenant A room");
  });

  it("models weekly teaching loads, qualified teachers, room limits, and immutable versions", () => {
    expect(MIGRATION).toContain("periods_per_week smallint NOT NULL");
    expect(MIGRATION).toContain("required_capacity integer NOT NULL");
    expect(MIGRATION).toContain("required_room_type text");
    expect(MIGRATION).toContain(
      "availability_state IN ('preferred', 'allowed', 'unavailable', 'mandatory')",
    );
    expect(MIGRATION).toContain("constraint_kind IN ('hard', 'soft')");
    expect(MIGRATION).toContain("status IN ('draft', 'published')");
    expect(MIGRATION).toContain("published schedule versions are immutable");
    expect(MIGRATION).toContain("every required activity is placed");
  });

  it("applies RLS and removes each owned table in the rollback", () => {
    for (const table of TABLES) {
      expect(MIGRATION).toContain(`'${table}'`);
      expect(ROLLBACK).toContain(`DROP TABLE IF EXISTS public.${table};`);
    }
    expect(ROLLBACK).toContain("BEGIN;");
    expect(ROLLBACK).toContain("COMMIT;");
  });
});
