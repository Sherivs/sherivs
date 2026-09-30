// ─── Phase 20 — Government Education Cloud: government-data ───────────
import { describe, it, expect } from "vitest";
import {
  createReportDefinition,
  createDataSharingAgreement,
  approveAgreement,
  createCatalogEntry,
  registerExternalSystem,
  createLocationPolicy,
  computeDeIdentifiedValue,
} from "@/lib/government-data";

describe("government-data — Report Definition", () => {
  it("creates versioned report definition", () => {
    const r = createReportDefinition({
      id: "RPT-001" as any,
      name: "Annual Education Statistics",
      jurisdiction: "ng-fed",
      frequency: "annual",
      schema: { schoolCount: "number", enrollment: "number" },
      regulatory: true,
    });
    expect(r.version).toBe(1);
    expect(r.regulatory).toBe(true);
    expect(r.frequency).toBe("annual");
  });
});

describe("government-data — Data Sharing Agreement", () => {
  it("creates pending agreement", () => {
    const a = createDataSharingAgreement({
      id: "DSA-001" as any,
      sourceOrganisation: "org-moe",
      targetOrganisation: "org-stats-bureau",
      classification: "confidential",
      purpose: "Education statistics reporting",
      fields: ["schoolCount", "enrollment"],
    });
    expect(a.status).toBe("pending");
    expect(a.purpose).toBeTruthy();
  });

  it("rejects agreement without purpose", () => {
    expect(() =>
      createDataSharingAgreement({
        id: "DSA-002" as any,
        sourceOrganisation: "a",
        targetOrganisation: "b",
        classification: "public",
        purpose: "",
        fields: ["x"],
      }),
    ).toThrow();
  });

  it("approves agreement", () => {
    const a = createDataSharingAgreement({
      id: "DSA-003" as any,
      sourceOrganisation: "a",
      targetOrganisation: "b",
      classification: "internal",
      purpose: "Reporting",
      fields: ["x"],
    });
    const approved = approveAgreement(a);
    expect(approved.status).toBe("active");
  });

  it("rejects approving already approved agreement", () => {
    const a = createDataSharingAgreement({
      id: "DSA-004" as any,
      sourceOrganisation: "a",
      targetOrganisation: "b",
      classification: "internal",
      purpose: "Testing",
      fields: ["x"],
    });
    const approved = approveAgreement(a);
    expect(() => approveAgreement(approved)).toThrow();
  });
});

describe("government-data — Catalog Entry", () => {
  it("creates catalog entry with stewards", () => {
    const e = createCatalogEntry({
      id: "CAT-001",
      name: "School Census Data",
      jurisdiction: "ng-fed",
      ownerOrganisation: "org-moe",
      classification: "confidential",
      description: "Annual school census dataset",
      schema: { schoolId: "string", name: "string" },
      stewards: ["user-1", "user-2"],
    });
    expect(e.stewards).toHaveLength(2);
  });
});

describe("government-data — External System", () => {
  it("registers external system", () => {
    const s = registerExternalSystem({
      id: "SYS-001",
      name: "National ID System",
      systemType: "identity_provider",
      jurisdiction: "ng-fed",
      apiEndpoint: "https://nins.gov.ng/api",
      integrationType: "api",
      authMethod: "oauth",
    });
    expect(s.status).toBe("active");
    expect(s.apiEndpoint).toBe("https://nins.gov.ng/api");
  });
});

describe("government-data — Data Residency", () => {
  it("creates location policy", () => {
    const p = createLocationPolicy({
      jurisdiction: "ng-fed",
      allowedRegions: ["ng-lagos", "ng-abuja"],
      sovereignOnly: true,
    });
    expect(p.sovereignOnly).toBe(true);
    expect(p.airGapped).toBe(false);
  });
});

describe("government-data — De-identification", () => {
  it("suppresses value", () => {
    expect(
      computeDeIdentifiedValue("confidential", {
        field: "name",
        method: "suppress",
        parameters: {},
      }),
    ).toBe("***");
  });

  it("anonymizes value", () => {
    expect(
      computeDeIdentifiedValue("user123", { field: "id", method: "anonymize", parameters: {} }),
    ).toBe("anon_7");
  });

  it("pseudonymizes value", () => {
    const val = computeDeIdentifiedValue("student@school.edu", {
      field: "email",
      method: "pseudonymize",
      parameters: {},
    });
    expect(val).toContain("pseudo_");
    expect(val).toContain("***");
  });

  it("aggregates value", () => {
    expect(
      computeDeIdentifiedValue("10", { field: "score", method: "aggregate", parameters: {} }),
    ).toBe("[aggregated]");
  });
});
