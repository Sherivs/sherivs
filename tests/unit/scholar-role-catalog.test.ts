/**
 * Sherivs Scholar — Educational Reality role catalog: completeness and boundary.
 *
 * The catalog is the directive's reality (government, regulatory, institutional,
 * academic, teaching, vocational, technical, agricultural, religious,
 * traditional, community, residential, examination, quality, platform) expressed
 * as data. These tests assert it is COMPLETE (every category, every group),
 * SOUND (audit clean, no duplicate definitions) and SAFE (a catalog role grants
 * nothing by default; every staffed role links to the P25 workforce catalog
 * instead of redefining the post).
 */

import { describe, expect, it } from "vitest";
import { SCHOLAR_WORKFORCE_CODE_SET } from "@/lib/runtime/scholar-workforce";
import { ROLE_CATEGORIES } from "@/lib/scholar/roles/role-categories";
import { ALL_ROLE_GROUPS } from "@/lib/scholar/roles/role-catalog-groups";
import { auditEducationRealityRoles } from "@/lib/scholar/roles/role-catalog-audit";
import {
  EDUCATION_REALITY_ROLES,
  MULTI_REALITY_ROLE_IDS,
  ROLE_GROUP_MEMBERSHIPS,
  ROLE_PENDING_WORKFORCE_POSTS,
  roleById,
  rolesByCategory,
  staffedRoles,
} from "@/lib/scholar/roles/role-registry";

const audit = auditEducationRealityRoles();

describe("role catalog — completeness", () => {
  it("audits clean", () => {
    expect(audit.issues).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("covers every role category", () => {
    expect(audit.categoriesMissing).toEqual([]);
    expect(audit.categoriesCovered).toEqual([...ROLE_CATEGORIES].sort());
    for (const category of ROLE_CATEGORIES) {
      expect(rolesByCategory(category).length, `roles in ${category}`).toBeGreaterThan(0);
    }
  });

  it("is a substantial reality catalog, not a short hardcoded list", () => {
    expect(ALL_ROLE_GROUPS.length).toBeGreaterThanOrEqual(40);
    expect(EDUCATION_REALITY_ROLES.length).toBeGreaterThanOrEqual(400);
    expect(audit.staffedRoleCount).toBeGreaterThanOrEqual(150);
  });

  it("reports reality posts that have no workforce kind yet, without inventing one", () => {
    for (const post of ROLE_PENDING_WORKFORCE_POSTS) {
      const role = EDUCATION_REALITY_ROLES.find((candidate) => candidate.name === post);
      if (!role) continue;
      expect(role.staffing.kind, `${post} must not claim a workforce kind`).toBe("non_staff");
      expect(role.staffing.kindCode).toBeNull();
    }
    expect(audit.pendingWorkforcePostCount).toBe(ROLE_PENDING_WORKFORCE_POSTS.length);
  });

  it("records where every role came from (group provenance)", () => {
    for (const role of EDUCATION_REALITY_ROLES) {
      expect(ROLE_GROUP_MEMBERSHIPS.get(role.id) ?? [], `groups for ${role.id}`).not.toEqual([]);
    }
    const coveredGroups = new Set(
      EDUCATION_REALITY_ROLES.flatMap((role) => ROLE_GROUP_MEMBERSHIPS.get(role.id) ?? []),
    );
    for (const group of ALL_ROLE_GROUPS) {
      expect(coveredGroups.has(group.group), `group ${group.group} contributed no role`).toBe(true);
    }
  });

  it("documents multi-reality roles instead of duplicating them", () => {
    expect(MULTI_REALITY_ROLE_IDS.length).toBeGreaterThan(0);
    expect(audit.mergeCount).toBe(MULTI_REALITY_ROLE_IDS.length);
    for (const id of MULTI_REALITY_ROLE_IDS) {
      const groups = ROLE_GROUP_MEMBERSHIPS.get(id) ?? [];
      expect(groups.length, `${id} must belong to at least two realities`).toBeGreaterThanOrEqual(
        2,
      );
    }
  });
});

describe("role catalog — safety boundaries", () => {
  it("grants nothing by default (least privilege by construction)", () => {
    const withGrants = EDUCATION_REALITY_ROLES.filter((role) => role.permissions.length > 0);
    expect(withGrants.map((role) => role.id)).toEqual([]);
  });

  it("links staffed roles to the P25 workforce catalog instead of redefining posts", () => {
    const staffed = staffedRoles();
    expect(staffed.length).toBeGreaterThan(0);
    for (const role of staffed) {
      expect(role.staffing.kind).toBe("scholar_workforce");
      expect(
        SCHOLAR_WORKFORCE_CODE_SET.has(role.staffing.kindCode ?? ""),
        `${role.id} → ${role.staffing.kindCode}`,
      ).toBe(true);
    }
    // The post "Principal" IS the canonical head-of-school kind (alias match).
    expect(roleById("role:principal")?.staffing.kindCode).toBe("head_of_school");
  });

  it("keeps every role inside the tenant or jurisdiction it belongs to", () => {
    const sovereign: readonly string[] = [
      "GOVERNMENT",
      "REGULATORY",
      "EXAMINATION",
      "QUALITY_ASSURANCE",
    ];
    for (const role of EDUCATION_REALITY_ROLES) {
      if (role.category === "SHERIVS_INTERNAL") {
        expect(role.tenantScope, `${role.id} is a platform role`).toBe("platform");
      } else if (sovereign.includes(role.category)) {
        expect(role.tenantScope, `${role.id} is jurisdiction-scoped`).toBe("jurisdiction");
      } else {
        expect(role.tenantScope, `${role.id} is tenant-scoped`).toBe("tenant");
      }
    }
  });

  it("declares the authorization models each role participates in", () => {
    for (const role of EDUCATION_REALITY_ROLES) {
      expect(role.authority.rbac, `${role.id} participates in RBAC`).toBe(true);
      expect(role.authority.pbac, `${role.id} is policy-controlled`).toBe(true);
      expect(role.authority.rls, `${role.id} is RLS-scoped`).toBe(true);
    }
  });
});

describe("role catalog — directive coverage spot checks", () => {
  const expectations: ReadonlyArray<readonly [string, string]> = [
    ["Minister of Education", "GOVERNMENT"],
    ["Regional Education Commissioner", "GOVERNMENT"],
    ["Local Education Authority Director", "GOVERNMENT"],
    ["Chief Education Data Officer", "GOVERNMENT"],
    ["School Board Chairman", "INSTITUTIONAL_LEADERSHIP"],
    ["Owner", "INSTITUTIONAL_LEADERSHIP"],
    ["Principal", "INSTITUTIONAL_LEADERSHIP"],
    ["Hybrid Learning Director", "INSTITUTIONAL_LEADERSHIP"],
    ["Admissions Director", "INSTITUTIONAL_LEADERSHIP"],
    ["Curriculum Director", "ACADEMIC"],
    ["Professor", "ACADEMIC"],
    ["Timetable Coordinator", "ACADEMIC"],
    ["Kindergarten Teacher", "TEACHING"],
    ["Special Education Teacher", "TEACHING"],
    ["Quran Teacher", "RELIGIOUS"],
    ["Madrasa Coordinator", "RELIGIOUS"],
    ["Religious School Principal", "RELIGIOUS"],
    ["House Master", "BOARDING"],
    ["Boarding Coordinator", "BOARDING"],
    ["Master Trainer", "VOCATIONAL"],
    ["Apprenticeship Director", "VOCATIONAL"],
    ["Engineering Instructor", "TECHNICAL"],
    ["Agricultural Extension Officer", "AGRICULTURAL"],
    ["Master Artisan", "TRADITIONAL"],
    ["Special Needs Coordinator", "STUDENT_SUPPORT"],
    ["Student Experience Director", "STUDENT_SUPPORT"],
    ["Community Education Director", "COMMUNITY"],
    ["Adult Education Director", "COMMUNITY"],
    ["International Education Director", "COMMUNITY"],
    ["Chief Examiner", "EXAMINATION"],
    ["Examination Officer", "EXAMINATION"],
    ["Quality Assurance Director", "QUALITY_ASSURANCE"],
    ["Laboratory Director", "TECHNICAL"],
    ["School Nurse", "HEALTH"],
    ["Catering Director", "OPERATIONS"],
    ["HR Manager", "OPERATIONS"],
    ["Risk Officer", "OPERATIONS"],
    ["Transport Manager", "TRANSPORT"],
    ["Facilities Director", "FACILITIES"],
    ["ICT Director", "TECHNOLOGY"],
    ["Cybersecurity Officer", "TECHNOLOGY"],
    ["Bursar", "FINANCE"],
    ["Chief Financial Officer", "FINANCE"],
    ["Learning Scientist", "RESEARCH"],
    ["Security Director", "SAFETY"],
    ["Chief Technology Officer", "SHERIVS_INTERNAL"],
    ["AI Safety Engineer", "SHERIVS_INTERNAL"],
    ["Education Reality Architect", "SHERIVS_INTERNAL"],
    ["Customer Success Manager", "SHERIVS_INTERNAL"],
  ];

  it("contains the directive's roles in their reality categories", () => {
    for (const [name, category] of expectations) {
      const role = EDUCATION_REALITY_ROLES.find((candidate) => candidate.name === name);
      expect(role, `role "${name}" must exist`).toBeDefined();
      expect(role?.category, `category of "${name}"`).toBe(category);
    }
  });
});
