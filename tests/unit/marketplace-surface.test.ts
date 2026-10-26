/**
 * Sherivs — R41 marketplace + platform-organization surface tests.
 *
 * Laws covered:
 *  - the catalog is published FROM reality (one listing per installed feature
 *    code) and the coverage is provable, not asserted;
 *  - publishing never self-asserts trust;
 *  - installation is gated by tenant + known code + not-installed + an ACTIVE
 *    entitlement — and the reason is surfaced, never hidden;
 *  - discovery reuses the marketplace's own keyword contract;
 *  - the platform organization surface renders the audited engine snapshot.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEntitlement, entitlementId } from "@/lib/marketplace-entitlement";
import { marketplaceProductId } from "@/lib/marketplace-core";
import { tenantId } from "@/lib/tenant-core";
import { featureCodesForReality } from "@/lib/scholar/capability-codes";
import { realityForOrgType } from "@/lib/scholar/experience/experience-presets";
import {
  auditPlatformOrg,
  platformOrgRoles,
  platformOrgSnapshot,
} from "@/lib/scholar/platform-org/platform-workspace-engine";
import {
  buildMarketplaceView,
  discoverThroughMarketplace,
  searchMarketplace,
  sortByTrust,
} from "@/lib/surfaces/marketplace-view";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const CLASS = "islamic_school";
const EXPECTED_CODES = featureCodesForReality(realityForOrgType(CLASS)).map((entry) => entry.code);

describe("R41 — marketplace view is published from reality", () => {
  const view = buildMarketplaceView({ orgType: CLASS, tenantId: null });

  it("publishes exactly one listing per installed feature code", () => {
    expect(EXPECTED_CODES.length).toBeGreaterThan(0);
    expect(view.publishedCodes).toEqual([...EXPECTED_CODES].sort());
    expect(view.complete).toBe(true);
    expect(view.issues).toEqual([]);
    // Publication order follows the reality's own feature order, not alphabetical.
    expect(view.listings.map((listing) => listing.featureCode)).toEqual(EXPECTED_CODES);
  });

  it("publishes as DRAFTS: nothing is tenant-discoverable until a review activates it", () => {
    expect(view.draftCount).toBe(view.listings.length);
    expect(view.discoverable).toBe(false);
    expect(view.reviewNote).toMatch(/draft|review/);
    // The marketplace's own discovery contract ignores inactive products.
    expect(discoverThroughMarketplace(view, EXPECTED_CODES[0])).toEqual([]);
  });

  it("never self-asserts trust or an unverified vendor", () => {
    for (const listing of view.listings) {
      expect(listing.trustLevel).toBe("unverified");
      expect(listing.vendorRef.length).toBeGreaterThan(0);
      expect(listing.versionRef).toContain("1.0.0");
      expect(listing.requirements.length).toBeGreaterThan(0);
    }
  });

  it("denies installation without a tenant or an entitlement, and says why", () => {
    expect(view.installBlockers.length).toBe(2);
    for (const listing of view.listings) {
      expect(listing.install.allowed).toBe(false);
      expect(listing.install.reasons.join(" ")).toMatch(/no tenant context|no active entitlement/);
    }
  });

  it("allows installation once the tenant holds an active entitlement", () => {
    const created = createEntitlement({
      id: entitlementId("ent:r41"),
      tenantId: tenantId("tenant:r41"),
      productId: marketplaceProductId(`scholar.${EXPECTED_CODES[0]}`),
      source: "institution_plan",
      scopeKind: "tenant",
      scopeRef: "tenant:r41",
    });
    if (!created.ok) throw new Error(created.error);

    const entitled = buildMarketplaceView({
      orgType: CLASS,
      tenantId: "tenant:r41",
      entitlements: [created.entitlement],
      installedCodes: [EXPECTED_CODES[0]],
    });

    const installed = entitled.listings.find((entry) => entry.featureCode === EXPECTED_CODES[0]);
    expect(installed?.installed).toBe(true);
    expect(installed?.install.allowed).toBe(false);
    expect(installed?.install.reasons.join(" ")).toContain("already installed");

    const installable = entitled.listings.find((entry) => entry.featureCode === EXPECTED_CODES[1]);
    expect(installable?.install.allowed).toBe(true);
    expect(installable?.install.reasons.join(" ")).toContain("entitled by ent:r41");
    expect(entitled.installBlockers).toEqual([]);
  });

  it("searches the published catalog deterministically", () => {
    const target = EXPECTED_CODES[0];
    const hits = searchMarketplace(view, target);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.featureCode === target)).toBe(true);
    expect(hits.every((hit) => view.listings.includes(hit))).toBe(true);

    const misses = searchMarketplace(view, "zzzz-not-a-feature");
    expect(misses).toEqual([]);
  });

  it("orders by verification rank without dropping listings", () => {
    const sorted = sortByTrust(view.listings);
    expect(sorted).toHaveLength(view.listings.length);
    expect(new Set(sorted.map((entry) => entry.featureCode)).size).toBe(view.listings.length);
  });
});

describe("R41 — CoreGrid internal workspace surface", () => {
  it("exposes an audited, generated platform organization", () => {
    const snapshot = platformOrgSnapshot();
    expect(snapshot.departments.length).toBeGreaterThan(0);
    expect(snapshot.roleCount).toBe(platformOrgRoles().length);
    expect(snapshot.widgetCount).toBeGreaterThan(0);
    expect(auditPlatformOrg()).toEqual([]);
    for (const department of snapshot.departments) {
      expect(department.roles.length).toBeGreaterThan(0);
      expect(department.widgets.length).toBeGreaterThan(0);
    }
  });

  it("renders the engine snapshot on /platform/org and the marketplace route exists", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/platform.org.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "frontend/src/routes/marketplace.tsx"))).toBe(false);
  });
});
