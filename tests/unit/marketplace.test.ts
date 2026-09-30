// ─── Phase 27 — Marketplace ───────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  createMarketplaceProduct,
  createProductVersion,
  createProductListing,
  keywordDiscover,
  isProductVisibleToTenant,
  evaluateProductHealth,
  hasSecurityConcern,
  marketplaceProductId,
  productVersionId,
  productListingId,
  type MarketplaceProduct,
  type ProductListing,
} from "@/lib/marketplace-core";
import {
  createVendor,
  promoteVendorVerification,
  createDeveloperOrganization,
  canGrantPublishingAuthority,
  createDraftSubmission,
  canAdvanceSubmission,
  createProductReview,
  canReviewProduct,
  averageRating,
  isVendorExitPermitted,
  vendorId,
  productSubmissionId,
  productReviewId,
} from "@/lib/marketplace-vendor";
import {
  createPackageManifest,
  evaluateSecurityScan,
  isPackageSignatureValid,
  hasExcessiveDataAccess,
  evaluateCompatibility,
  detectPermissionConflicts,
  createInstallationDryRun,
  packageManifestId,
  securityScanId,
  installationDryRunId,
  type PackageManifest,
} from "@/lib/marketplace-package";
import {
  createMarketOffer,
  effectivePrice,
  createEntitlement,
  isEntitlementActive,
  suspendEntitlement,
  createInstallation,
  canTransitionInstallation,
  validateProductConfiguration,
  createProcurementRequest,
  isWithinProcurementBudget,
  createUninstallPlan,
  marketOfferId,
  entitlementId,
  marketplaceInstallationId,
  procurementRequestId,
  productConfigurationId,
} from "@/lib/marketplace-entitlement";
import {
  transitionProductLifecycle,
  isEmergencyRemovalRequired,
  evaluatePolicyCompatibility,
  computeMarketplaceMetrics,
  recommendationRequiresApproval,
  reportMarketplaceIncident,
  canAdvanceIncidentStage,
  recordMarketplaceAuditEvent,
  registerVendorWebhook,
  isWebhookDeliveryAuthorized,
  createPrivateMarketplace,
  isProductAllowlisted,
  createOfflinePackage,
  isOfflinePackageValid,
  publishMarketplaceEvent,
  invalidateCatalogCache,
  marketplaceSecurityIncidentId,
  marketplaceAuditEventId,
  marketplaceEventId,
} from "@/lib/marketplace-governance";
import type { TenantId } from "@/lib/tenant-core";

const TENANT = "tenant-a" as TenantId;
const OTHER = "tenant-b" as TenantId;
const PRODUCT = marketplaceProductId("prod-1");

function makeProduct(overrides: Partial<MarketplaceProduct> = {}): MarketplaceProduct {
  return {
    id: PRODUCT,
    vendorRef: "vendor-1",
    name: "Transport Manager",
    description: "Manage school transport",
    productType: "application",
    categories: ["education"],
    capabilities: ["transport.manage"],
    trustLevel: "unverified",
    distributionScope: ["public"],
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("marketplace-core — Product Model (11, 12, 13, 49, 50)", () => {
  it("creates product with unverified trust", () => {
    const r = createMarketplaceProduct({
      id: PRODUCT,
      vendorRef: "vendor-1",
      name: "Transport Manager",
      productType: "application",
      capabilities: ["transport.manage"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.product.trustLevel).toBe("unverified");
  });
  it("rejects product without name", () => {
    const r = createMarketplaceProduct({
      id: marketplaceProductId("p2"),
      vendorRef: "vendor-1",
      name: "",
      productType: "application",
    });
    expect(r.ok).toBe(false);
  });
  it("rejects product without vendor", () => {
    const r = createMarketplaceProduct({
      id: marketplaceProductId("p3"),
      vendorRef: "",
      name: "X",
      productType: "application",
    });
    expect(r.ok).toBe(false);
  });
  it("creates version and listing", () => {
    const v = createProductVersion({
      id: productVersionId("v1"),
      productId: PRODUCT,
      version: "1.0.0",
      packageRef: "pkg-1",
    });
    const l = createProductListing({
      id: productListingId("l1"),
      productId: PRODUCT,
      name: "Transport Manager",
      description: "d",
      vendorRef: "vendor-1",
      versionRef: v.id,
      permissions: ["transport.read"],
    });
    expect(l.publishedAt).toBeNull();
    expect(l.permissions).toContain("transport.read");
  });
});

describe("marketplace-core — Discovery (45, 46, 48)", () => {
  it("keyword discovery finds matching product", () => {
    const p = makeProduct();
    const l: ProductListing = {
      id: productListingId("l1"),
      productId: p.id,
      locale: "en",
      name: "Transport Manager",
      description: "Manage school transport",
      capabilities: ["transport.manage"],
      screenshotsRefs: [],
      documentationRefs: [],
      requirements: [],
      permissions: [],
      dataAccess: [],
      vendorRef: "vendor-1",
      versionRef: productVersionId("v1"),
      supportLevel: "standard",
      certificationRefs: [],
      publishedAt: "2026-01-01",
    };
    const r = keywordDiscover({ query: "transport" }, [l], [p]);
    expect(r).toHaveLength(1);
    expect(r[0].listingName).toBe("Transport Manager");
  });
  it("excludes inactive products", () => {
    const p = makeProduct({ isActive: false });
    const l: ProductListing = {
      id: productListingId("l1"),
      productId: p.id,
      locale: "en",
      name: "X",
      description: "d",
      capabilities: [],
      screenshotsRefs: [],
      documentationRefs: [],
      requirements: [],
      permissions: [],
      dataAccess: [],
      vendorRef: "vendor-1",
      versionRef: productVersionId("v1"),
      supportLevel: "standard",
      certificationRefs: [],
      publishedAt: null,
    };
    expect(keywordDiscover({ query: "x" }, [l], [p])).toHaveLength(0);
  });
  it("respects private distribution", () => {
    const pub = makeProduct();
    const priv = makeProduct({ id: marketplaceProductId("p9"), distributionScope: [TENANT] });
    expect(isProductVisibleToTenant(pub, OTHER)).toBe(true);
    expect(isProductVisibleToTenant(priv, OTHER)).toBe(false);
    expect(isProductVisibleToTenant(priv, TENANT)).toBe(true);
  });
});

describe("marketplace-core — Product Health (118, 119)", () => {
  it("computes health score", () => {
    const h = evaluateProductHealth({ productId: PRODUCT, uptime: 0.99, securityIncidents: 0 });
    expect(h.healthScore).toBeGreaterThan(0);
  });
  it("flags security concern", () => {
    const h = evaluateProductHealth({ productId: PRODUCT, uptime: 0.99, securityIncidents: 1 });
    expect(hasSecurityConcern(h)).toBe(true);
  });
});

describe("marketplace-vendor — Vendor (14, 15, 16, 18)", () => {
  it("creates vendor", () => {
    const r = createVendor({
      id: vendorId("v1"),
      tenantId: TENANT,
      type: "education_company",
      organizationName: "EduSoft",
      geography: "NG",
      contactRef: "id-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vendor.verificationLevel).toBe("registered");
  });
  it("rejects vendor without geography", () => {
    expect(
      createVendor({
        id: vendorId("v2"),
        tenantId: TENANT,
        type: "developer",
        organizationName: "X",
        geography: "",
        contactRef: "id-1",
      }).ok,
    ).toBe(false);
  });
  it("promotes verification monotonically", () => {
    const r = createVendor({
      id: vendorId("v3"),
      tenantId: TENANT,
      type: "developer",
      organizationName: "X",
      geography: "GH",
      contactRef: "id-1",
    });
    if (!r.ok) throw new Error("expected ok");
    const promoted = promoteVendorVerification(r.vendor, "email_verified", "email-verification");
    expect(promoted.ok).toBe(true);
    if (promoted.ok)
      expect(promoteVendorVerification(promoted.vendor, "registered", "x").ok).toBe(false);
  });
});

describe("marketplace-vendor — Developer Orgs & Submission (19, 21, 22, 23, 24)", () => {
  it("creates developer organization", () => {
    const org = createDeveloperOrganization({
      id: "do-1" as never,
      tenantId: TENANT,
      name: "DevCo",
      members: [{ identityRef: "id-1", role: "owner" }],
    });
    expect(org.publishingAuthority).toBe(false);
  });
  it("owner can grant publishing authority", () => {
    const org = createDeveloperOrganization({
      id: "do-2" as never,
      tenantId: TENANT,
      name: "DevCo",
      members: [
        { identityRef: "id-1", role: "owner" },
        { identityRef: "id-2", role: "developer" },
      ],
    });
    expect(canGrantPublishingAuthority(org, "id-1")).toBe(true);
    expect(canGrantPublishingAuthority(org, "id-2")).toBe(false);
  });
  it("submission advances one stage at a time", () => {
    const s = createDraftSubmission({
      id: productSubmissionId("s1"),
      tenantId: TENANT,
      productId: PRODUCT,
      vendorRef: "vendor-1",
    });
    expect(s.state).toBe("draft");
    expect(canAdvanceSubmission("draft", "validation")).toBe(true);
    expect(canAdvanceSubmission("draft", "published")).toBe(false);
  });
});

describe("marketplace-vendor — Reviews & Ratings (110, 111, 112, 113, 114)", () => {
  it("creates review with verified usage", () => {
    const r = createProductReview({
      id: productReviewId("r1"),
      tenantId: TENANT,
      productId: PRODUCT,
      reviewerRef: "id-1",
      verifiedUsage: true,
      rating: { quality: 4, usability: 5, reliability: 4, support: 3, value: 4 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.review.moderationState).toBe("pending");
  });
  it("rejects review without verified usage", () => {
    const r = createProductReview({
      id: productReviewId("r2"),
      tenantId: TENANT,
      productId: PRODUCT,
      reviewerRef: "id-1",
      verifiedUsage: false,
      rating: { quality: 4, usability: 5, reliability: 4, support: 3, value: 4 },
    });
    expect(r.ok).toBe(false);
  });
  it("rejects out-of-range rating", () => {
    const r = createProductReview({
      id: productReviewId("r3"),
      tenantId: TENANT,
      productId: PRODUCT,
      reviewerRef: "id-1",
      verifiedUsage: true,
      rating: { quality: 6, usability: 5, reliability: 4, support: 3, value: 4 },
    });
    expect(r.ok).toBe(false);
  });
  it("one review per reviewer per product", () => {
    const a = createProductReview({
      id: productReviewId("a1"),
      tenantId: TENANT,
      productId: PRODUCT,
      reviewerRef: "id-1",
      verifiedUsage: true,
      rating: { quality: 4, usability: 5, reliability: 4, support: 3, value: 4 },
    });
    if (!a.ok) throw new Error("expected ok");
    expect(canReviewProduct([{ ...a.review, moderationState: "approved" }], "id-1")).toBe(false);
    expect(canReviewProduct([], "id-2")).toBe(true);
  });
  it("averages approved ratings", () => {
    const base = {
      tenantId: TENANT,
      productId: PRODUCT,
      reviewerRef: "id-1",
      verifiedUsage: true,
      comment: "",
      createdAt: "2026-01-01",
    };
    const reviews = [
      {
        ...base,
        id: productReviewId("q1"),
        rating: { quality: 4, usability: 5, reliability: 4, support: 3, value: 4 },
        moderationState: "approved" as const,
      },
      {
        ...base,
        id: productReviewId("q2"),
        reviewerRef: "id-2",
        rating: { quality: 2, usability: 5, reliability: 4, support: 3, value: 4 },
        moderationState: "pending" as const,
      },
    ];
    expect(averageRating(reviews, "quality")).toBe(4);
  });
});

describe("marketplace-vendor — Vendor Exit (173)", () => {
  it("exit permitted only when all obligations met", () => {
    expect(
      isVendorExitPermitted({
        customersNotified: true,
        subscriptionsHandled: true,
        dataExportAvailable: true,
        securityRisksEvaluated: true,
      }),
    ).toBe(true);
    expect(
      isVendorExitPermitted({
        customersNotified: true,
        subscriptionsHandled: false,
        dataExportAvailable: true,
        securityRisksEvaluated: true,
      }),
    ).toBe(false);
  });
});

describe("marketplace-package — Manifests & Security (26, 27, 28, 29, 30, 31-42)", () => {
  it("creates package manifest", () => {
    const r = createPackageManifest({
      id: packageManifestId("pm-1"),
      productId: PRODUCT,
      version: "1.0.0",
      permissions: ["transport.read"],
      dataAccessCategories: ["transport"],
      signed: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.permissions).toContain("transport.read");
  });
  it("rejects manifest without product", () => {
    expect(
      createPackageManifest({ id: packageManifestId("pm-2"), productId: "", version: "1" }).ok,
    ).toBe(false);
  });
  it("security scan blocks malware", () => {
    const r = evaluateSecurityScan({
      id: securityScanId("s1"),
      manifestId: packageManifestId("pm-1"),
      findings: ["malware"],
    });
    expect(r.passed).toBe(false);
    const ok = evaluateSecurityScan({
      id: securityScanId("s2"),
      manifestId: packageManifestId("pm-1"),
      findings: ["vulnerability"],
    });
    expect(ok.passed).toBe(true);
  });
  it("signature verification required for signed packages", () => {
    const m: PackageManifest = {
      id: packageManifestId("pm-3"),
      productId: PRODUCT,
      version: "1",
      apis: [],
      dependencies: [],
      permissions: [],
      dataAccessCategories: [],
      configurationSchemaRef: null,
      resources: {},
      installationRequirements: [],
      signed: true,
    };
    expect(
      isPackageSignatureValid({ manifest: m, signaturePresent: true, signatureValid: true }),
    ).toBe(true);
    expect(
      isPackageSignatureValid({ manifest: m, signaturePresent: true, signatureValid: false }),
    ).toBe(false);
  });
  it("flags excessive data access", () => {
    const m: PackageManifest = {
      id: packageManifestId("pm-4"),
      productId: PRODUCT,
      version: "1",
      apis: [],
      dependencies: [],
      permissions: [],
      dataAccessCategories: ["a", "b", "c", "d", "e"],
      configurationSchemaRef: null,
      resources: {},
      installationRequirements: [],
      signed: false,
    };
    expect(hasExcessiveDataAccess(m)).toBe(true);
  });
});

describe("marketplace-package — Compatibility & Conflict (162, 163, 164, 165)", () => {
  it("compatibility passes with matching version and APIs", () => {
    const r = evaluateCompatibility({
      requiredCoreGridVersion: "2.0.0",
      currentCoreGridVersion: "2.5.0",
      requiredApis: ["transport"],
      availableApis: ["transport", "finance"],
      requiredPolicies: ["allowed.transport"],
      requiredPermissions: [],
      installedProducts: [],
      conflictingProducts: [],
    });
    expect(r.compatible).toBe(true);
  });
  it("compatibility fails on missing API", () => {
    const r = evaluateCompatibility({
      requiredCoreGridVersion: "2.0.0",
      currentCoreGridVersion: "2.5.0",
      requiredApis: ["transport"],
      availableApis: ["finance"],
      requiredPolicies: [],
      requiredPermissions: [],
      installedProducts: [],
      conflictingProducts: [],
    });
    expect(r.compatible).toBe(false);
  });
  it("detects installed product conflicts", () => {
    const r = evaluateCompatibility({
      requiredCoreGridVersion: "2.0.0",
      currentCoreGridVersion: "2.5.0",
      requiredApis: [],
      availableApis: [],
      requiredPolicies: [],
      requiredPermissions: [],
      installedProducts: ["prod-9"],
      conflictingProducts: ["prod-9"],
    });
    expect(r.compatible).toBe(false);
  });
  it("detects permission conflicts", () => {
    expect(detectPermissionConflicts(["transport.write"], ["transport.write"])).toEqual([
      "transport.write",
    ]);
    expect(detectPermissionConflicts(["transport.write"], ["finance.read"])).toEqual([]);
  });
  it("dry run previews change impact", () => {
    const d = createInstallationDryRun({
      id: installationDryRunId("d1"),
      tenantId: TENANT,
      productId: PRODUCT,
      version: "1.0.0",
      permissionsRequested: ["transport.read"],
      estimatedCostMinorUnits: 5000,
      affectedUsers: 120,
      checksPassed: true,
    });
    expect(d.passed).toBe(true);
    expect(d.affectedUsers).toBe(120);
  });
});

describe("marketplace-entitlement — Pricing (52, 54, 55, 57)", () => {
  it("creates offer with pricing model", () => {
    const r = createMarketOffer({
      id: marketOfferId("o1"),
      productId: PRODUCT,
      pricingModel: "subscription",
      currency: "NGN",
      priceMinorUnits: 50000,
      recurrence: "monthly",
      trialDays: 14,
    });
    expect(r.ok).toBe(true);
  });
  it("rejects negative price", () => {
    expect(
      createMarketOffer({
        id: marketOfferId("o2"),
        productId: PRODUCT,
        pricingModel: "one_time",
        priceMinorUnits: -5,
      }).ok,
    ).toBe(false);
  });
  it("applies regional pricing", () => {
    const r = createMarketOffer({
      id: marketOfferId("o3"),
      productId: PRODUCT,
      pricingModel: "one_time",
      priceMinorUnits: 10000,
      discountPercent: 20,
      regionalPricing: { GH: 8000 },
    });
    if (!r.ok) throw new Error("expected ok");
    expect(effectivePrice(r.offer, "GH")).toBe(8000);
    expect(effectivePrice(r.offer, "NG")).toBe(8000);
  });
});

describe("marketplace-entitlement — Entitlements (63, 64, 65, 66, 67)", () => {
  it("creates active entitlement", () => {
    const r = createEntitlement({
      id: entitlementId("e1"),
      tenantId: TENANT,
      productId: PRODUCT,
      source: "purchase",
      scopeKind: "tenant",
      scopeRef: TENANT,
    });
    expect(r.ok).toBe(true);
  });
  it("rejects past expiry", () => {
    const r = createEntitlement({
      id: entitlementId("e2"),
      tenantId: TENANT,
      productId: PRODUCT,
      source: "grant",
      scopeKind: "tenant",
      scopeRef: TENANT,
      expiresAt: "2020-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(false);
  });
  it("entitlement expires and suspends", () => {
    const r = createEntitlement({
      id: entitlementId("e3"),
      tenantId: TENANT,
      productId: PRODUCT,
      source: "subscription",
      scopeKind: "tenant",
      scopeRef: TENANT,
      expiresAt: "2026-06-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(isEntitlementActive(r.entitlement, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(isEntitlementActive(r.entitlement, "2026-07-01T00:00:00.000Z")).toBe(false);
    expect(
      isEntitlementActive(
        suspendEntitlement(r.entitlement, "2026-02-01T00:00:00.000Z"),
        "2026-02-02T00:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("marketplace-entitlement — Installation & Configuration (68, 166, 167)", () => {
  it("installation advances one stage at a time", () => {
    const inst = createInstallation({
      id: marketplaceInstallationId("i1"),
      tenantId: TENANT,
      productId: PRODUCT,
    });
    expect(inst.state).toBe("requested");
    expect(canTransitionInstallation("requested", "authorized")).toBe(true);
    expect(canTransitionInstallation("requested", "active")).toBe(false);
  });
  it("validates configuration before activation", () => {
    const ok = validateProductConfiguration({
      id: productConfigurationId("c1"),
      tenantId: TENANT,
      installationId: marketplaceInstallationId("i1"),
      values: { apiKey: "x", endpoint: "y" },
      requiredKeys: ["apiKey", "endpoint"],
    });
    expect(ok.ok).toBe(true);
    const bad = validateProductConfiguration({
      id: productConfigurationId("c2"),
      tenantId: TENANT,
      installationId: marketplaceInstallationId("i1"),
      values: { apiKey: "x" },
      requiredKeys: ["apiKey", "endpoint"],
    });
    expect(bad.ok).toBe(false);
  });
});

describe("marketplace-entitlement — Procurement (140, 141, 143) & Uninstall (171)", () => {
  it("creates procurement request with budget control", () => {
    const req = createProcurementRequest({
      id: procurementRequestId("p1"),
      tenantId: TENANT,
      productId: PRODUCT,
      requiresApproval: true,
      estimatedCostMinorUnits: 5000,
    });
    expect(req.requiresApproval).toBe(true);
    expect(isWithinProcurementBudget(req, 10000)).toBe(true);
    expect(isWithinProcurementBudget(req, 1000)).toBe(false);
  });
  it("uninstall plan defines data exit", () => {
    const u = createUninstallPlan({
      installationId: marketplaceInstallationId("i1"),
      tenantId: TENANT,
      dataRetentionDays: 30,
      dataDeletionRequired: true,
    });
    expect(u.entitlementStateAfter).toBe("revoked");
    expect(u.dataRetentionDays).toBe(30);
  });
});

describe("marketplace-governance — Lifecycle, Policy, Emergency (120-125)", () => {
  it("transitions product lifecycle", () => {
    const r = {
      productId: PRODUCT,
      state: "published" as const,
      suspendedReason: null,
      updatedAt: "2026-01-01",
    };
    const s = transitionProductLifecycle(r, "suspended", "2026-01-02T00:00:00.000Z");
    expect(s.state).toBe("suspended");
  });
  it("emergency removal for malicious product", () => {
    expect(isEmergencyRemovalRequired(["malicious_product"])).toBe(true);
    expect(isEmergencyRemovalRequired(["fraudulent_listing"])).toBe(false);
  });
  it("evaluates policy compatibility", () => {
    const ok = evaluatePolicyCompatibility({
      requiredPolicyRefs: ["allowed.transport"],
      mandatoryTenantPolicyRefs: ["tenant.aup"],
      forbiddenPolicyRefs: [],
      requiredJurisdictions: ["NG"],
      tenantJurisdictions: ["NG", "GH"],
    });
    expect(ok.compatible).toBe(true);
    const bad = evaluatePolicyCompatibility({
      requiredPolicyRefs: ["forbidden.transport"],
      mandatoryTenantPolicyRefs: [],
      forbiddenPolicyRefs: ["forbidden.transport"],
      requiredJurisdictions: ["NG"],
      tenantJurisdictions: ["GH"],
    });
    expect(bad.compatible).toBe(false);
  });
  it("recommendations never auto-install", () => {
    expect(recommendationRequiresApproval()).toBe(true);
  });
});

describe("marketplace-governance — Incidents, Audit, Webhooks (89, 90, 176, 177, 178)", () => {
  it("reports incident and advances response stages", () => {
    const inc = reportMarketplaceIncident({
      id: marketplaceSecurityIncidentId("i1"),
      tenantId: TENANT,
      kind: "data_leakage",
      productId: PRODUCT,
    });
    expect(inc.responseStage).toBe("detect");
    expect(canAdvanceIncidentStage("detect", "contain")).toBe(true);
    expect(canAdvanceIncidentStage("detect", "restore")).toBe(false);
  });
  it("records audit event", () => {
    const e = recordMarketplaceAuditEvent({
      id: marketplaceAuditEventId("a1"),
      tenantId: TENANT,
      type: "product_approved",
      actorRef: "id-admin-1",
      productId: PRODUCT,
    });
    expect(e.type).toBe("product_approved");
  });
  it("webhook delivery requires signature + replay + rate checks", () => {
    const w = registerVendorWebhook({
      id: "wh-1",
      vendorRef: "vendor-1",
      eventTypes: ["product_published"],
      endpoint: "https://vendor.example/hook",
      secretFingerprint: "fp",
    });
    expect(
      isWebhookDeliveryAuthorized({
        webhook: w,
        signatureValid: true,
        eventAgeMinutes: 1,
        requestsThisMinute: 1,
      }).allowed,
    ).toBe(true);
    expect(
      isWebhookDeliveryAuthorized({
        webhook: w,
        signatureValid: false,
        eventAgeMinutes: 1,
        requestsThisMinute: 1,
      }).allowed,
    ).toBe(false);
    expect(
      isWebhookDeliveryAuthorized({
        webhook: w,
        signatureValid: true,
        eventAgeMinutes: 30,
        requestsThisMinute: 1,
      }).allowed,
    ).toBe(false);
  });
});

describe("marketplace-governance — Private, Offline, Events, Caching (144-147, 155-156, 185, 187-188)", () => {
  it("private marketplace allowlist", () => {
    const m = createPrivateMarketplace({ id: "pm-1", tenantId: TENANT, allowlist: [PRODUCT] });
    expect(isProductAllowlisted(m, PRODUCT)).toBe(true);
    expect(isProductAllowlisted(m, marketplaceProductId("other"))).toBe(false);
  });
  it("offline package validity", () => {
    const ok = createOfflinePackage({
      id: "op-1",
      productId: PRODUCT,
      version: "1",
      signed: true,
      checksumRef: "abc123",
    });
    expect(isOfflinePackageValid(ok)).toBe(true);
    const expired = createOfflinePackage({
      id: "op-2",
      productId: PRODUCT,
      version: "1",
      signed: true,
      checksumRef: "abc",
      expiresAt: "2025-01-01T00:00:00.000Z",
    });
    expect(isOfflinePackageValid(expired, "2026-01-01T00:00:00.000Z")).toBe(false);
  });
  it("publishes marketplace events", () => {
    const e = publishMarketplaceEvent({
      id: marketplaceEventId("ev-1"),
      tenantId: TENANT,
      type: "installation_completed",
      productId: PRODUCT,
    });
    expect(e.type).toBe("installation_completed");
  });
  it("invalidates catalog cache on product change", () => {
    const entries = [
      { key: "c1", productId: PRODUCT, version: "1", invalidated: false, cachedAt: "2026-01-01" },
      {
        key: "c2",
        productId: marketplaceProductId("other"),
        version: "1",
        invalidated: false,
        cachedAt: "2026-01-01",
      },
    ];
    const inv = invalidateCatalogCache(entries, PRODUCT);
    expect(inv[0].invalidated).toBe(true);
    expect(inv[1].invalidated).toBe(false);
  });
});
