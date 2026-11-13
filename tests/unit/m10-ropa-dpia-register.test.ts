import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261104012000_sherivs_m10_ropa_dpia_register.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261104012000_sherivs_m10_ropa_dpia_register.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m10-ropa-dpia-register.local.sql", "utf8");
const functions = readFileSync("frontend/src/lib/compliance/privacy-register.functions.ts", "utf8");
const screen = readFileSync(
  "frontend/src/components/app-shell/privacy-register-screen.tsx",
  "utf8",
);
const sectionScreen = readFileSync("frontend/src/components/app-shell/section-screen.tsx", "utf8");
const workflow = readFileSync(".github/workflows/verify.yml", "utf8");

describe("M10 ROPA and DPIA registers", () => {
  it("adds forced-RLS tenant and platform ROPA records and reuses the existing DPIA table", () => {
    expect(migration).toContain("CREATE TABLE public.ropa_processing_activities");
    expect(migration).toContain("ALTER TABLE public.dpia_records");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS risks text[]");
    expect(migration).toContain(
      "ALTER TABLE public.ropa_processing_activities FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "ALTER TABLE public.privacy_register_audit_events FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("ropa_processing_activities_platform_key");
    expect(migration).toContain("cardinality(coalesce(p_subject_categories");
    expect(migration).toContain("cardinality(coalesce(p_categories");
    expect(migration).toContain("org_id IS NULL AND (SELECT public.is_super_admin())");
    expect(migration).toContain("'owner_review_required'");
    expect(migration).toContain("true, 'owner_review_required'");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.dpia_save");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.privacy_ropa_owner_review");
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT);\s*$/m);
    expect(migration).not.toMatch(/GRANT\s+.*\bTO\s+anon\b/is);
  });

  it("restricts DPIA sign-off to an effective DPO role and records append-only audit", () => {
    expect(migration).toContain("a.role_code = 'ng.data_protection_officer_dpo'");
    expect(migration).toContain("public.privacy_register_is_dpo(d.school_id)");
    expect(migration).toContain("'dpia.signed_off'");
    expect(migration).toContain("privacy_register_audit_immutable");
    expect(migration).toContain("FROM PUBLIC, anon, service_role");
    expect(migration).toContain("TO authenticated");
    expect(migration).toContain("risks and mitigations are required before sign-off");
  });

  it("ships authenticated UI/export, disposable isolation tests and a rollback that retains audit evidence", () => {
    expect(functions).toContain('"privacy_register_snapshot"');
    expect(functions).toContain('"privacy_register_export"');
    expect(screen).toContain("Export JSON");
    expect(screen).toContain("Sign off as DPO");
    expect(sectionScreen).toContain('"r001.org_admin.ndpa"');
    expect(harness).toContain("tenant A cannot read tenant B ROPA");
    expect(harness).toContain("tenant A cannot read platform ROPA");
    expect(harness).toContain("oversized ROPA values are rejected");
    expect(harness).toContain("oversized DPIA values are rejected");
    expect(harness).toContain("non-DPO cannot sign off");
    expect(harness).toContain("DPO sign-off is audited");
    expect(harness).toContain("legacy unaudited DPIA writer is revoked");
    expect(harness).toContain("legacy NDPA DSAR permission no longer grants DPIA register read");
    expect(harness).toContain("tenant DPO cannot review platform ROPA");
    expect(harness).toContain("tenant admin cannot review platform ROPA");
    expect(rollback).toContain("GRANT EXECUTE ON FUNCTION public.dpia_save");
    expect(workflow).toContain("tests/integration/m10-ropa-dpia-register.local.sql");
    expect(migration).toContain("'ropa.owner_reviewed'");
    expect(functions).toContain('"privacy_ropa_owner_review"');
    expect(harness).toContain("ROLLBACK;");
    expect(rollback).toContain("Immutable register audit evidence is retained");
    expect(rollback).not.toContain("DROP TABLE IF EXISTS public.privacy_register_audit_events");
  });
});
