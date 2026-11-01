import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NG_PERMISSIONS } from "../../frontend/src/lib/scholar/roles/ng-role-catalog.generated";
import {
  CATEGORY_DATA_SCOPES,
  INSTITUTION_AUTHORITY_RELATIONSHIPS,
  RESPONSIBILITY_CATALOG,
  ROLE_TEMPLATE_CATALOG,
  ROLE_TEMPLATE_CATALOG_SCHEMA,
  SOD_RULES,
  composeCustomRole,
  renderRoleCatalogMarkdown,
  validateRoleTemplateCatalog,
} from "../../frontend/src/lib/scholar/roles/role-template-catalog";

describe("role template catalog", () => {
  it("validates the versioned schema and all referenced permissions", () => {
    const schemaResult = ROLE_TEMPLATE_CATALOG_SCHEMA.safeParse(ROLE_TEMPLATE_CATALOG);
    expect(
      schemaResult.success,
      JSON.stringify(schemaResult.success ? [] : schemaResult.error.issues),
    ).toBe(true);
    expect(validateRoleTemplateCatalog()).toEqual([]);
    for (const responsibility of Object.values(RESPONSIBILITY_CATALOG)) {
      expect(NG_PERMISSIONS[responsibility.permissionId]).toBeDefined();
    }
  });

  it("gives every role exactly three daily responsibilities from its own responsibility set", () => {
    for (const template of ROLE_TEMPLATE_CATALOG.templates) {
      const responsibilities = new Set([
        ...template.coreResponsibilities,
        ...template.optionalAddOnResponsibilities,
      ]);
      expect(template.primaryDailyResponsibilities, template.id).toHaveLength(3);
      for (const dailyResponsibility of template.primaryDailyResponsibilities) {
        expect(
          responsibilities.has(dailyResponsibility),
          `${template.id}: ${dailyResponsibility}`,
        ).toBe(true);
      }
    }
  });

  it("keeps all templates within their category scope and prevents core SoD conflicts", () => {
    for (const template of ROLE_TEMPLATE_CATALOG.templates) {
      expect(CATEGORY_DATA_SCOPES[template.category]).toContain(template.dataAccessScope);
      for (const [ruleId, [left, right]] of Object.entries(SOD_RULES)) {
        expect(
          template.coreResponsibilities.includes(left) &&
            template.coreResponsibilities.includes(right),
          `${template.id} violates ${ruleId}`,
        ).toBe(false);
      }
    }
  });

  it("enables only the approved V1 institution roles", () => {
    expect(
      ROLE_TEMPLATE_CATALOG.templates.filter((template) => template.enabled).map(({ id }) => id),
    ).toEqual([
      "proprietor_group_director",
      "principal_head_teacher",
      "vice_principal",
      "campus_head",
      "class_teacher",
      "subject_teacher",
      "exams_officer",
      "bursar",
      "admin_hr",
    ]);

    for (const template of ROLE_TEMPLATE_CATALOG.templates) {
      if (template.mandate_status === "unverified") {
        expect(template.assignable, template.id).toBe(false);
        expect(template.enabled, template.id).toBe(false);
        expect(template.sourceNotes, template.id).toBeTruthy();
      }
    }
  });

  it("keeps all candidate institution-authority relationships unverified and effective-dated", () => {
    expect(INSTITUTION_AUTHORITY_RELATIONSHIPS.length).toBeGreaterThan(0);
    for (const relationship of INSTITUTION_AUTHORITY_RELATIONSHIPS) {
      expect(relationship.verification_status).toBe("unverified");
      expect(relationship.source).toBeTruthy();
      expect(relationship.evidence_url).toMatch(/^https:\/\//);
      expect(relationship.notes).toMatch(/unverified/i);
      expect(relationship.effectiveFrom).toBeNull();
      expect(relationship.effectiveTo).toBeNull();
    }
    const missingStatus = {
      ...INSTITUTION_AUTHORITY_RELATIONSHIPS[0],
      verification_status: undefined,
    };
    expect(
      ROLE_TEMPLATE_CATALOG_SCHEMA.safeParse({
        ...ROLE_TEMPLATE_CATALOG,
        relationships: [missingStatus],
      }).success,
    ).toBe(false);
  });

  it("composes custom roles from existing responsibilities and rejects permission invention or SoD", () => {
    expect(composeCustomRole(["view_own_records"]).permissionIds).toEqual(["self.view_own"]);
    expect(() => composeCustomRole(["invented_permission"])).toThrow(
      /Unknown catalog responsibilities/,
    );
    expect(() => composeCustomRole(["record_cash_payments", "approve_refunds"])).toThrow(
      /SoD rule/,
    );
  });

  it("keeps the role catalog documentation synchronized with the data", () => {
    const normalizeMarkdown = (markdown: string) =>
      markdown
        .trim()
        .split("\n")
        .map((line) =>
          line.includes("|")
            ? line
                .split("|")
                .map((cell) => {
                  const trimmed = cell.trim();
                  return /^-+$/.test(trimmed) ? "---" : trimmed;
                })
                .join("|")
            : line.trim(),
        )
        .join("\n");
    expect(normalizeMarkdown(readFileSync("docs/workspaces/role-catalog.md", "utf8"))).toBe(
      normalizeMarkdown(renderRoleCatalogMarkdown()),
    );
  });
});
