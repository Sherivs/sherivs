/**
 * Sherivs brand layer tests (V1).
 *
 * Laws under test:
 * - the canonical brand resolves to Sherivs on every customer-facing surface;
 * - technical identifiers are never classified as migratable;
 * - unknown families are denied migration (closed world, no blind replace).
 */
import { describe, expect, it } from "vitest";
import {
  SHERIVS_AI_WORKFORCE_NAME,
  SHERIVS_CATEGORY,
  SHERIVS_DOMAIN,
  SHERIVS_JARVIS_NAME,
  SHERIVS_NAME,
  SHERIVS_PAGE_DESCRIPTION,
  SHERIVS_PAGE_TITLE,
  SHERIVS_SCHOLAR_NAME,
  resolveCustomerBrandName,
  sherivsLockup,
} from "@/lib/brand/sherivs";
import {
  BRAND_REFERENCE_FAMILIES,
  isMigrationAuthorized,
  isTechnicalIdentifier,
} from "@/lib/brand/brand-classification";

describe("Sherivs canonical brand", () => {
  it("declares the canonical brand, domain and category", () => {
    expect(SHERIVS_NAME).toBe("Sherivs");
    expect(SHERIVS_DOMAIN).toBe("sherivs.com");
    expect(SHERIVS_CATEGORY).toBe("Institutional Intelligence Infrastructure");
  });

  it("names the product portfolio without touching the kernel identity", () => {
    expect(SHERIVS_SCHOLAR_NAME).toBe("Sherivs Scholar");
    expect(SHERIVS_JARVIS_NAME).toBe("Jarvis");
    expect(SHERIVS_AI_WORKFORCE_NAME).toBe("Sherivs AI Workforce");
    expect(SHERIVS_PAGE_TITLE).toContain("Sherivs");
    expect(SHERIVS_PAGE_DESCRIPTION).toContain("Sherivs");
  });

  it("resolves Sherivs for every customer-facing context", () => {
    for (const context of [
      "public-site",
      "auth",
      "app-shell",
      "organization-site",
      "document-head",
      "notifications",
      "support",
    ] as const) {
      expect(resolveCustomerBrandName(context)).toBe("Sherivs");
    }
  });

  it("builds a customer-facing lockup, never a technical identifier", () => {
    expect(sherivsLockup()).toContain("Sherivs");
    expect(sherivsLockup()).toContain("Institutional Intelligence Infrastructure");
    expect(isTechnicalIdentifier(sherivsLockup())).toBe(false);
  });
});

describe("Brand reference classification", () => {
  it("classifies every family exactly once with a rationale", () => {
    const ids = BRAND_REFERENCE_FAMILIES.map((family) => family.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const family of BRAND_REFERENCE_FAMILIES) {
      expect(family.rationale.length).toBeGreaterThan(0);
      expect(["CUSTOMER_FACING", "TECHNICAL"]).toContain(family.class);
    }
  });

  it("authorizes migration only for customer-facing families", () => {
    for (const family of BRAND_REFERENCE_FAMILIES) {
      expect(isMigrationAuthorized(family.id)).toBe(family.class === "CUSTOMER_FACING");
    }
  });

  it("denies migration for unknown families (closed world)", () => {
    expect(isMigrationAuthorized("public-site-copy-typo")).toBe(false);
    expect(isMigrationAuthorized("")).toBe(false);
  });

  it("recognizes technical identifiers that must never be rewritten", () => {
    for (const value of [
      "cg_org_membership",
      "@coregrid/contracts",
      "coregrid-scholar",
      "types/coregrid-scholar.ts",
      "database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql",
    ]) {
      expect(isTechnicalIdentifier(value), value).toBe(true);
    }
    expect(isTechnicalIdentifier("Sherivs public site")).toBe(false);
    expect(isTechnicalIdentifier("/platform")).toBe(false);
  });
});
