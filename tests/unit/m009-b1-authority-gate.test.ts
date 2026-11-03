import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceManifest } from "../../frontend/src/lib/workspaces/manifest-resolver";
import type { RoleTemplate } from "../../frontend/src/lib/workspaces/contract";

const MIGRATION = readFileSync(
  "database/supabase/migrations/20261103145000_sherivs_m009_b1_verified_executive_authority.sql",
  "utf8",
);
const ROLLBACK = readFileSync(
  "database/supabase/rollbacks/20261103145000_sherivs_m009_b1_verified_executive_authority.sql",
  "utf8",
);
const AUTHORITY_ROLE_CODES = [
  ...new Set(Array.from(MIGRATION.matchAll(/'(ng\.[a-z0-9_]+)'/g), (match) => match[1])),
];
const EXECUTIVE_TEMPLATE_CODES = [...AUTHORITY_ROLE_CODES, "m009_tertiary_executive_read_only"];
const NOW = "2026-11-03T12:00:00.000Z";
const TENANT = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const LINK = "30000000-0000-4000-8000-000000000001";

describe("M009 B-1 verified authority gate", () => {
  it("only enables authority-dependent roles when one linked relationship is verified and effective", () => {
    expect(MIGRATION).toContain("requires_verified_authority_link = true");
    expect(MIGRATION).toContain("count(*) = 1");
    expect(MIGRATION).toContain("l.verification_status = 'verified'");
    expect(MIGRATION).toContain("l.school_id = p_org");
    expect(MIGRATION).toContain("l.effective_from <= p_at");
    expect(MIGRATION).toContain("l.effective_until > p_at");
    expect(MIGRATION).toContain("l.verified_by <> p_assigner");
    expect(MIGRATION).toContain("l.verified_by <> p_assignee");
    expect(MIGRATION).toContain("NEW.assigned_by IS DISTINCT FROM auth.uid()");
    expect(MIGRATION).toContain("p_org, a.evidence, p_at, a.assigned_by, a.user_id");
  });

  it.each(EXECUTIVE_TEMPLATE_CODES)(
    "resolves exactly three assigned primary sections for authority template %s",
    (code) => {
      const responsibilities = [1, 2, 3].map((priority) => ({
        id: `${code}-responsibility-${priority}`,
        code: `${code}-responsibility-${priority}`,
        label: `Synthetic responsibility ${priority}`,
        kind: "core" as const,
        permissionCodes: ["analytics.institution"],
        dailyPriority: priority,
        primaryNav: {
          id: `${code}-nav-${priority}`,
          label: `Synthetic section ${priority}`,
        },
      }));
      const template: RoleTemplate = {
        id: code,
        code,
        label: code,
        category: "institutional_executive",
        responsibilities,
        permissions: [],
        approvalAuthorities: [],
        reportingRelationships: [],
        requiresVerifiedAuthorityLink: true,
      };
      const resolved = resolveWorkspaceManifest(
        { id: USER },
        { id: TENANT, category: "institutional_executive" },
        {
          assignments: [
            {
              id: `${code}-assignment`,
              tenantId: TENANT,
              userId: USER,
              roleTemplateId: code,
              scopeType: "org",
              scopeRef: null,
              validFrom: NOW,
              temporary: false,
              evidence: [`authority_link:${LINK}`],
              restrictions: [],
              status: "active",
            },
          ],
          roleTemplates: [template],
          authorityLinks: [
            {
              id: LINK,
              tenantId: TENANT,
              verificationStatus: "verified",
              effectiveFrom: NOW,
            },
          ],
        },
        NOW,
      );

      expect(resolved?.primaryNav).toHaveLength(3);
      expect(resolved?.primaryNav.map(({ responsibilityId }) => responsibilityId)).toEqual(
        responsibilities.map(({ id }) => id),
      );
    },
  );

  it("provides a guarded disposable database harness for assignment and live permission checks", () => {
    const harness = readFileSync("tests/integration/m009-b1-authority.local.sql", "utf8");
    expect(harness).toContain("current_database() <> 'm009_b1_authority_test'");
    expect(harness).toContain("m009b1.test_disposable_database");
    expect(harness).toContain("inet_server_addr()");
    expect(harness).toContain("public.workspace_role_assignment_create(");
    expect(harness).toContain("public.workspace_effective_permission_rows_at(");
    for (const reason of [
      "unverified",
      "expired",
      "not-yet-effective",
      "wrong-tenant",
      "zero evidence",
      "ambiguous evidence",
      "malformed evidence",
      "verifier is assignment actor",
      "verifier is assignee",
      "service-role null actor",
      "link expires after assignment",
      "link reverts to unverified",
    ]) {
      expect(harness).toContain(reason);
    }
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
