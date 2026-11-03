import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  "database/supabase/migrations/20261103145000_sherivs_m009_b1_verified_executive_authority.sql",
  "utf8",
);
const ROLLBACK = readFileSync(
  "database/supabase/rollbacks/20261103145000_sherivs_m009_b1_verified_executive_authority.sql",
  "utf8",
);

describe("M009 B-1 verified authority gate", () => {
  it("only enables authority-dependent roles when one linked relationship is verified and effective", () => {
    expect(MIGRATION).toContain("requires_verified_authority_link = true");
    expect(MIGRATION).toContain("count(*) = 1");
    expect(MIGRATION).toContain("l.verification_status = 'verified'");
    expect(MIGRATION).toContain("l.school_id = p_org");
    expect(MIGRATION).toContain("l.effective_from <= p_at");
    expect(MIGRATION).toContain("l.effective_until > p_at");
    expect(MIGRATION).toContain(
      "workspace_authority_link_evidence_is_verified(p_org, a.evidence, p_at)",
    );
  });

  it("keeps the tertiary template read-only and does not create authority evidence", () => {
    expect(MIGRATION).toContain("'m009_tertiary_executive_read_only'");
    expect(MIGRATION).toContain("'reports.academic','mandatory',true");
    expect(MIGRATION).toContain("'reports.financial','mandatory',true");
    expect(MIGRATION).not.toContain("'expenses.approve'");
    expect(MIGRATION).not.toContain("'payroll.approve'");
    expect(MIGRATION).not.toMatch(/INSERT\s+INTO\s+public\.institution_authority_links/i);
    expect(MIGRATION).not.toMatch(/INSERT\s+INTO\s+public\.institution_authority_link_audit/i);
  });

  it("maps tertiary executives to the principal workspace without replacing existing template data", () => {
    expect(MIGRATION).toContain(
      "UPDATE public.workspace_family_layouts\n   SET template_codes = array_append(template_codes, 'm009_tertiary_executive_read_only')",
    );
    expect(MIGRATION).toContain("M009-B1 tertiary executive template already exists");
    expect(MIGRATION).not.toContain("ON CONFLICT (code) DO UPDATE");
    expect(MIGRATION).not.toContain("ON CONFLICT (template_code, permission_code) DO UPDATE");
    expect(ROLLBACK).toContain(
      "SET template_codes = array_remove(template_codes, 'm009_tertiary_executive_read_only')",
    );
  });

  it("restores the original tertiary template mappings and permission resolver on rollback", () => {
    expect(ROLLBACK).toContain(
      "DROP FUNCTION IF EXISTS public.workspace_authority_link_evidence_is_verified",
    );
    expect(ROLLBACK).toContain("DROP COLUMN IF EXISTS requires_verified_authority_link");
    expect(ROLLBACK).toContain("WHEN 'ng.vice_chancellor' THEN 'head_of_institution'");
    expect(ROLLBACK).toContain("workspace_effective_assignments_at(p_org, p_user, p_at)");
    expect(ROLLBACK).not.toContain(
      "OR public.workspace_authority_link_evidence_is_verified(p_org, a.evidence, p_at)",
    );
  });
});
