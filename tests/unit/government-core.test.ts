// ─── Phase 20 — Government Education Cloud: government-core ──────────
import { describe, it, expect } from "vitest";
import {
  createGovernmentTenant,
  createJurisdiction,
  createFederation,
  assignGovernmentRole,
  createEducationNetwork,
  createGovernmentMasterRecord,
  supersedeMasterRecord,
  createGovernmentCalendar,
  validateOrganisationHierarchy,
  type GovernmentLevel,
} from "@/lib/government-core";

describe("government-core — Government Tenant", () => {
  it("creates active tenant with provided fields", () => {
    const t = createGovernmentTenant({
      id: "gov-ng-1" as any,
      name: "Nigeria Ministry of Education",
      level: "ministry",
      jurisdiction: "ng-fed" as any,
      parentId: null,
      tenantRef: "TENANT-NG-MOE",
      autonomous: true,
    });
    expect(t.id).toBe("gov-ng-1");
    expect(t.name).toBe("Nigeria Ministry of Education");
    expect(t.level).toBe("ministry");
    expect(t.status).toBe("active");
    expect(t.autonomous).toBe(true);
  });

  it("throws on missing id or name", () => {
    expect(() =>
      createGovernmentTenant({
        id: "" as any,
        name: "X",
        level: "national",
        jurisdiction: "ng-fed" as any,
        parentId: null,
        tenantRef: "X",
        autonomous: true,
      }),
    ).toThrow();
    expect(() =>
      createGovernmentTenant({
        id: "x" as any,
        name: "",
        level: "national",
        jurisdiction: "ng-fed" as any,
        parentId: null,
        tenantRef: "X",
        autonomous: true,
      }),
    ).toThrow();
  });
});

describe("government-core — Jurisdiction", () => {
  it("creates jurisdiction with configurable hierarchy", () => {
    const j = createJurisdiction({
      id: "ng-fed" as any,
      name: "Nigeria Federal",
      code: "NG",
      country: "Nigeria",
      region: "West Africa",
      allowedLevels: ["national", "state_province", "local_authority", "institution"],
    });
    expect(j.code).toBe("NG");
    expect(j.configurableHierarchy).toBe(true);
  });

  it("fails without id, name or code", () => {
    expect(() =>
      createJurisdiction({
        id: "" as any,
        name: "X",
        code: "XX",
        country: "C",
        region: "R",
        allowedLevels: ["national"],
      }),
    ).toThrow();
  });
});

describe("government-core — Federation", () => {
  it("creates active federation with scope", () => {
    const f = createFederation({
      sourceOrganisation: "org-ng-moe" as any,
      targetOrganisation: "org-ng-lagos-edu" as any,
      scope: ["oversight", "funding", "reporting"],
      expiresAt: "2028-12-31T00:00:00Z",
    });
    expect(f.status).toBe("active");
    expect(f.scope).toContain("oversight");
  });

  it("rejects empty scope", () => {
    expect(() =>
      createFederation({
        sourceOrganisation: "a" as any,
        targetOrganisation: "b" as any,
        scope: [],
        expiresAt: null,
      }),
    ).toThrow();
  });

  it("rejects past expiry", () => {
    expect(() =>
      createFederation({
        sourceOrganisation: "a" as any,
        targetOrganisation: "b" as any,
        scope: ["funding"],
        expiresAt: "2020-01-01T00:00:00Z",
      }),
    ).toThrow();
  });
});
describe("government-core — Government Role", () => {
  it("assigns role with privileges", () => {
    const r = assignGovernmentRole({
      role: "inspector",
      scope: "org-ng-lagos-edu" as any,
      privileges: ["view_school_data", "submit_reports"],
      grantedBy: "admin-1",
      expiresAt: null,
    });
    expect(r.role).toBe("inspector");
    expect(r.privileges).toHaveLength(2);
    expect(r.grantedAt).toBeTruthy();
  });

  it("rejects empty privileges", () => {
    expect(() =>
      assignGovernmentRole({
        role: "viewer",
        scope: "all",
        privileges: [],
        grantedBy: "admin",
        expiresAt: null,
      }),
    ).toThrow();
  });
});

describe("government-core — Education Network", () => {
  it("creates network with member institutions", () => {
    const n = createEducationNetwork({
      id: "net-lagos-1" as any,
      name: "Lagos Public Schools Network",
      organisationId: "org-ng-lagos-edu" as any,
      memberInstitutions: ["inst-001", "inst-002"] as any,
      networkType: "public",
    });
    expect(n.memberInstitutions).toHaveLength(2);
    expect(n.status).toBe("active");
  });
});

describe("government-core — Master Data", () => {
  it("creates version 1 record", () => {
    const r = createGovernmentMasterRecord({
      id: "curr-nigeria-2024",
      domain: "curriculum",
      value: "Nigerian Basic Education Curriculum 2024",
      effectiveFrom: "2024-09-01",
    });
    expect(r.version).toBe(1);
    expect(r.status).toBe("current");
  });

  it("supersedes record", () => {
    const r = createGovernmentMasterRecord({
      id: "old",
      domain: "code",
      value: "OLD",
      effectiveFrom: "2020-01-01",
    });
    const s = supersedeMasterRecord(r, "new");
    expect(s.status).toBe("superseded");
    expect(s.supersededBy).toBe("new");
  });
});

describe("government-core — Calendar", () => {
  it("creates calendar with at least one term", () => {
    const c = createGovernmentCalendar({
      jurisdiction: "ng-fed" as any,
      academicYear: "2024-2025",
      termDates: [{ term: "Term 1", start: "2024-09-09", end: "2024-12-20" }],
      holidays: [],
      examinationPeriods: [],
    });
    expect(c.academicYear).toBe("2024-2025");
  });

  it("rejects calendar with no terms", () => {
    expect(() =>
      createGovernmentCalendar({
        jurisdiction: "x" as any,
        academicYear: "2024",
        termDates: [],
        holidays: [],
        examinationPeriods: [],
      }),
    ).toThrow();
  });
});

describe("government-core — Hierarchy Validation", () => {
  it("detects invalid hierarchy levels", () => {
    const allOrgs = [
      {
        id: "parent" as any,
        name: "Ministry",
        jurisdiction: "ng" as any,
        level: "ministry" as GovernmentLevel,
        parentOrganisation: null,
        children: [],
        status: "active" as const,
        autonomous: true,
        serviceTag: "",
      },
      {
        id: "child" as any,
        name: "School",
        jurisdiction: "ng" as any,
        level: "national" as GovernmentLevel,
        parentOrganisation: "parent" as any,
        children: [],
        status: "active" as const,
        autonomous: true,
        serviceTag: "",
      },
    ];
    const result = validateOrganisationHierarchy(allOrgs[1], allOrgs);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("validates correct hierarchy", () => {
    const allOrgs = [
      {
        id: "ministry" as any,
        name: "Ministry",
        jurisdiction: "ng" as any,
        level: "ministry" as GovernmentLevel,
        parentOrganisation: null,
        children: [],
        status: "active" as const,
        autonomous: true,
        serviceTag: "",
      },
      {
        id: "district" as any,
        name: "District",
        jurisdiction: "ng" as any,
        level: "district" as GovernmentLevel,
        parentOrganisation: "ministry" as any,
        children: [],
        status: "active" as const,
        autonomous: true,
        serviceTag: "",
      },
    ];
    const result = validateOrganisationHierarchy(allOrgs[1], allOrgs);
    expect(result.valid).toBe(true);
  });
});
