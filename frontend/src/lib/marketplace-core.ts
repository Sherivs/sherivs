/**
 * CoreGrid Marketplace Platform — marketplace core domain (entities, product
 * model, listings, discovery, trust).
 *
 * Implements `architecture/phase-27-marketplace.md`:
 * - Subsystem identity (A): the controlled ecosystem through which authorized
 *   parties discover, evaluate, acquire, install, configure, activate, use,
 *   monitor, update, suspend, and remove CoreGrid-compatible capabilities.
 * - Marketplace is not the application runtime, developer platform, AI layer,
 *   agent OS, automation engine, payment ledger, identity system, educational
 *   runtime, analytics engine, or cloud fabric (Section 4).
 * - Core marketplace entities (Section 10): Marketplace, Vendor, Developer,
 *   Organization, Product, Package, Application, Extension, Plugin, Agent,
 *   AI Capability, Automation Package, Integration, Connector, Content Package,
 *   Educational Resource, Hardware Adapter, Service, Subscription, Offer, Plan,
 *   Entitlement, License, Installation, Deployment, Configuration, Review,
 *   Rating, Certification, Policy, Version, Release.
 * - Product model (11-13): a product represents a marketplace-distributed
 *   capability; product types are configurable; a product may contain metadata,
 *   package, permissions, dependencies, configuration, policies, APIs, assets,
 *   version, commercial offer.
 * - Product trust levels (43-44): Unverified → Verified → Reviewed → Certified →
 *   CoreGrid Trusted → Enterprise Certified → Critical Infrastructure.
 * - Discovery (45-48): keyword/semantic search, filters, categories, vendor and
 *   capability search; institutional discovery adapts to tenant type, geography,
 *   language, policies, installed capabilities, user permissions.
 * - Product listings (49-51): structured listing with name, description,
 *   capabilities, screenshots, documentation, requirements, pricing, permissions,
 *   data access, vendor, version, support, certifications — with transparency.
 * - Support (115-117): community/standard/premium/enterprise support levels.
 * - Product health (118-119): installation failures, crashes, API failures,
 *   security incidents, uptime, update failures; internal operational health score.
 *
 * Phase 27 consumes Phase 13 financial payments by reference (settlement boundary,
 * Section 58) and Phase 26 AI (semantic discovery, Section 46); it never duplicates
 * them (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type MarketplaceId = string & { readonly __brand: "MarketplaceId" };
export type MarketplaceProductId = string & { readonly __brand: "MarketplaceProductId" };
export type ProductVersionId = string & { readonly __brand: "ProductVersionId" };
export type ProductListingId = string & { readonly __brand: "ProductListingId" };
export type ProductCertificationId = string & { readonly __brand: "ProductCertificationId" };

export function marketplaceId(raw: string): MarketplaceId {
  return raw as MarketplaceId;
}
export function marketplaceProductId(raw: string): MarketplaceProductId {
  return raw as MarketplaceProductId;
}
export function productVersionId(raw: string): ProductVersionId {
  return raw as ProductVersionId;
}
export function productListingId(raw: string): ProductListingId {
  return raw as ProductListingId;
}
export function productCertificationId(raw: string): ProductCertificationId {
  return raw as ProductCertificationId;
}

/* ─────────────────────────────────────────────────────────────
 * Product types (Section 12) — configurable, not hard-coded
 * ────────────────────────────────────────────────────────────*/

export type MarketplaceProductType =
  | "application"
  | "web_application"
  | "mobile_application"
  | "desktop_application"
  | "plugin"
  | "extension"
  | "agent"
  | "ai_skill"
  | "ai_model"
  | "ai_workflow"
  | "automation_package"
  | "integration"
  | "connector"
  | "educational_content"
  | "curriculum_package"
  | "assessment_package"
  | "hardware_adapter"
  | "reporting_package"
  | "dashboard"
  | "institutional_service"
  | "developer_tool"
  | "custom";

export const MARKETPLACE_PRODUCT_TYPES: readonly MarketplaceProductType[] = [
  "application",
  "web_application",
  "mobile_application",
  "desktop_application",
  "plugin",
  "extension",
  "agent",
  "ai_skill",
  "ai_model",
  "ai_workflow",
  "automation_package",
  "integration",
  "connector",
  "educational_content",
  "curriculum_package",
  "assessment_package",
  "hardware_adapter",
  "reporting_package",
  "dashboard",
  "institutional_service",
  "developer_tool",
  "custom",
] as const;

/** Is the product type a known system type? Custom types are always allowed. */
export function isKnownMarketplaceProductType(type: string): boolean {
  return (MARKETPLACE_PRODUCT_TYPES as readonly string[]).includes(type);
}

/* ─────────────────────────────────────────────────────────────
 * Categories (Section 47)
 * ────────────────────────────────────────────────────────────*/

export type MarketplaceCategory =
  | "education"
  | "administration"
  | "finance"
  | "hr"
  | "communication"
  | "analytics"
  | "ai"
  | "automation"
  | "hardware"
  | "security"
  | "government"
  | "infrastructure"
  | "productivity"
  | "localization"
  | "custom";

export const MARKETPLACE_CATEGORIES: readonly MarketplaceCategory[] = [
  "education",
  "administration",
  "finance",
  "hr",
  "communication",
  "analytics",
  "ai",
  "automation",
  "hardware",
  "security",
  "government",
  "infrastructure",
  "productivity",
  "localization",
  "custom",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Product trust levels (Section 43)
 * ────────────────────────────────────────────────────────────*/

export type ProductTrustLevel =
  | "unverified"
  | "verified"
  | "reviewed"
  | "certified"
  | "coregrid_trusted"
  | "enterprise_certified"
  | "critical_infrastructure";

export const PRODUCT_TRUST_LEVELS: readonly ProductTrustLevel[] = [
  "unverified",
  "verified",
  "reviewed",
  "certified",
  "coregrid_trusted",
  "enterprise_certified",
  "critical_infrastructure",
] as const;

export const PRODUCT_TRUST_RANK: Record<ProductTrustLevel, number> = {
  unverified: 0,
  verified: 1,
  reviewed: 2,
  certified: 3,
  coregrid_trusted: 4,
  enterprise_certified: 5,
  critical_infrastructure: 6,
};

/* ─────────────────────────────────────────────────────────────
 * Product entity + composition (Sections 11, 13)
 * ────────────────────────────────────────────────────────────*/

export interface MarketplaceProduct {
  id: MarketplaceProductId;
  /** Owning vendor (Phase 27 vendor identity). */
  vendorRef: string;
  name: string;
  description: string | null;
  productType: MarketplaceProductType;
  categories: MarketplaceCategory[];
  /** Capability keys this product provides. */
  capabilities: string[];
  trustLevel: ProductTrustLevel;
  /** Authorized distribution scopes: "public" or tenant allowlist refs. */
  distributionScope: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMarketplaceProductInput {
  id: MarketplaceProductId;
  vendorRef: string;
  name: string;
  description?: string | null;
  productType: MarketplaceProductType;
  categories?: MarketplaceCategory[];
  capabilities?: string[];
  distributionScope?: string[];
  now?: string;
}

export type CreateMarketplaceProductResult =
  { ok: true; product: MarketplaceProduct } | { ok: false; error: string };

export function createMarketplaceProduct(
  input: CreateMarketplaceProductInput,
  now: string = new Date().toISOString(),
): CreateMarketplaceProductResult {
  if (!input.name.trim()) {
    return { ok: false, error: "Product name is required" };
  }
  if (!input.vendorRef.trim()) {
    return { ok: false, error: "A verified vendor is required (Section 14)" };
  }
  if (!isKnownMarketplaceProductType(input.productType)) {
    return { ok: false, error: `Unknown product type: ${input.productType}` };
  }
  return {
    ok: true,
    product: {
      id: input.id,
      vendorRef: input.vendorRef,
      name: input.name.trim(),
      description: input.description ?? null,
      productType: input.productType,
      categories: input.categories ?? [],
      capabilities: input.capabilities ?? [],
      trustLevel: "unverified",
      distributionScope: input.distributionScope ?? ["public"],
      isActive: false,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Product versions (Sections 27, 173)
 * ────────────────────────────────────────────────────────────*/

export interface ProductVersion {
  id: ProductVersionId;
  productId: MarketplaceProductId;
  version: string;
  /** Package manifest reference (Section 27). */
  packageRef: string;
  changelog: string | null;
  isActive: boolean;
  releasedAt: string;
}

export function createProductVersion(input: {
  id: ProductVersionId;
  productId: MarketplaceProductId;
  version: string;
  packageRef: string;
  changelog?: string | null;
  isActive?: boolean;
  now?: string;
}): ProductVersion {
  return {
    id: input.id,
    productId: input.productId,
    version: input.version,
    packageRef: input.packageRef,
    changelog: input.changelog ?? null,
    isActive: input.isActive ?? false,
    releasedAt: input.now ?? new Date().toISOString(),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Product listing (Sections 49, 50, 51)
 * ────────────────────────────────────────────────────────────*/

export type SupportLevel = "community" | "standard" | "premium" | "enterprise";

export const SUPPORT_LEVELS: readonly SupportLevel[] = [
  "community",
  "standard",
  "premium",
  "enterprise",
] as const;

export interface ProductListing {
  id: ProductListingId;
  productId: MarketplaceProductId;
  /** Localized listing metadata (Section 151/157). */
  locale: string;
  name: string;
  description: string;
  capabilities: string[];
  screenshotsRefs: string[];
  documentationRefs: string[];
  requirements: string[];
  /** Vendor-declared permissions (Section 51 transparency). */
  permissions: string[];
  /** Vendor-declared data access categories. */
  dataAccess: string[];
  vendorRef: string;
  versionRef: ProductVersionId;
  supportLevel: SupportLevel;
  /** Certification refs (Section 50). */
  certificationRefs: string[];
  publishedAt: string | null;
}

export function createProductListing(input: {
  id: ProductListingId;
  productId: MarketplaceProductId;
  locale?: string;
  name: string;
  description: string;
  capabilities?: string[];
  screenshotsRefs?: string[];
  documentationRefs?: string[];
  requirements?: string[];
  permissions?: string[];
  dataAccess?: string[];
  vendorRef: string;
  versionRef: ProductVersionId;
  supportLevel?: SupportLevel;
  certificationRefs?: string[];
}): ProductListing {
  return {
    id: input.id,
    productId: input.productId,
    locale: input.locale ?? "en",
    name: input.name,
    description: input.description,
    capabilities: input.capabilities ?? [],
    screenshotsRefs: input.screenshotsRefs ?? [],
    documentationRefs: input.documentationRefs ?? [],
    requirements: input.requirements ?? [],
    permissions: input.permissions ?? [],
    dataAccess: input.dataAccess ?? [],
    vendorRef: input.vendorRef,
    versionRef: input.versionRef,
    supportLevel: input.supportLevel ?? "standard",
    certificationRefs: input.certificationRefs ?? [],
    publishedAt: null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Discovery (Sections 45, 46, 48)
 * ────────────────────────────────────────────────────────────*/

export interface DiscoveryQuery {
  query: string;
  category?: MarketplaceCategory | null;
  vendorRef?: string | null;
  capability?: string | null;
  /** Institutional discovery adaptation (Section 48). */
  tenantType?: string | null;
  geography?: string | null;
  language?: string | null;
  /** Installed capability keys — used to surface complementary products. */
  installedCapabilities?: string[];
  /** Authorized user permissions. */
  permissions?: string[];
  maxResults?: number;
}

export interface DiscoveryResult {
  productId: MarketplaceProductId;
  listingName: string;
  /** Simple relevance score 0-1. */
  relevance: number;
}

/**
 * Deterministic keyword discovery (Section 45). Semantic discovery is delegated
 * to Phase 26 (Section 46); the marketplace remains authoritative for catalog data.
 */
export function keywordDiscover(
  query: DiscoveryQuery,
  listings: ProductListing[],
  products: MarketplaceProduct[],
  maxResults: number = 20,
): DiscoveryResult[] {
  const tokens = query.query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: DiscoveryResult[] = [];
  for (const listing of listings) {
    const product = products.find((p) => p.id === listing.productId);
    if (!product || !product.isActive) continue;
    if (query.category && !product.categories.includes(query.category)) continue;
    if (query.vendorRef && listing.vendorRef !== query.vendorRef) continue;
    if (query.capability && !product.capabilities.includes(query.capability)) continue;
    // Private distribution (Section 146): product must be public or allowlisted.
    const haystack =
      `${listing.name} ${listing.description} ${product.capabilities.join(" ")}`.toLowerCase();
    const relevance =
      tokens.length === 0 ? 0.5 : tokens.filter((t) => haystack.includes(t)).length / tokens.length;
    if (relevance === 0 && tokens.length > 0) continue;
    results.push({ productId: product.id, listingName: listing.name, relevance });
  }
  results.sort((a, b) => b.relevance - a.relevance);
  return results.slice(0, maxResults);
}

/** Section 48: institutional discovery excludes products not authorized for the tenant. */
export function isProductVisibleToTenant(product: MarketplaceProduct, tenantId: TenantId): boolean {
  return (
    product.distributionScope.includes("public") || product.distributionScope.includes(tenantId)
  );
}

/* ─────────────────────────────────────────────────────────────
 * Product health (Sections 118, 119)
 * ────────────────────────────────────────────────────────────*/

export interface ProductHealth {
  productId: MarketplaceProductId;
  installationFailures: number;
  crashReports: number;
  apiFailures: number;
  securityIncidents: number;
  uptime: number;
  updateFailures: number;
  /** 0-100 internal operational health score (Section 119). */
  healthScore: number;
}

export function evaluateProductHealth(input: {
  productId: MarketplaceProductId;
  installationFailures?: number;
  crashReports?: number;
  apiFailures?: number;
  securityIncidents?: number;
  uptime?: number;
  updateFailures?: number;
}): ProductHealth {
  const uptime = input.uptime ?? 1;
  const securityIncidents = input.securityIncidents ?? 0;
  const failures =
    (input.installationFailures ?? 0) +
    (input.crashReports ?? 0) +
    (input.apiFailures ?? 0) +
    (input.updateFailures ?? 0);
  const healthScore = Math.max(
    0,
    Math.min(100, uptime * 60 - failures * 5 - securityIncidents * 25),
  );
  return {
    productId: input.productId,
    installationFailures: input.installationFailures ?? 0,
    crashReports: input.crashReports ?? 0,
    apiFailures: input.apiFailures ?? 0,
    securityIncidents: securityIncidents,
    uptime,
    updateFailures: input.updateFailures ?? 0,
    healthScore,
  };
}

/** A product with any security incident is operationally unhealthy regardless of score. */
export function hasSecurityConcern(health: ProductHealth): boolean {
  return health.securityIncidents > 0;
}
