/**
 * CoreGrid — marketplace surface view-model (WAVE-R41).
 *
 * Discovery and installation, derived — never hand-written. The catalog is
 * PUBLISHED from the organization's reality (one listing per installed feature
 * code), search reuses the marketplace's own keyword discovery, and installation
 * is decided by the R38 install gate (tenant + known code + not installed +
 * ACTIVE entitlement). Without an entitlement the decision is DENY, and the
 * surface says exactly that instead of showing a button that would fail.
 */

import {
  keywordDiscover,
  isKnownMarketplaceProductType,
  PRODUCT_TRUST_RANK,
  type MarketplaceProduct,
  type ProductListing,
  type ProductTrustLevel,
} from "@/lib/marketplace-core";
import type { Entitlement } from "@/lib/marketplace-entitlement";
import { featureCodesForReality } from "@/lib/scholar/capability-codes";
import { realityForOrgType } from "@/lib/scholar/experience/experience-presets";
import { decideInstall, type InstallDecision } from "@/lib/scholar/marketplace/install-gate";
import {
  publishRealityListings,
  publishedFeatureCodes,
} from "@/lib/scholar/marketplace/listing-publisher";
import { organizationClassLabel } from "./generated-site-view";

export interface MarketplaceListingView {
  featureCode: string;
  label: string;
  workspace: string;
  productId: string;
  productType: string;
  trustLevel: ProductTrustLevel;
  vendorRef: string;
  versionRef: string;
  supportLevel: string;
  /** Institution feature keys the product requires (reality vocabulary). */
  requirements: readonly string[];
  /** Capability codes the product asks for (grant vocabulary). */
  permissions: readonly string[];
  /** Already installed for the previewed tenant. */
  installed: boolean;
  /** Install decision for THIS tenant, from the R38 gate. */
  install: InstallDecision;
}

export interface MarketplaceViewInput {
  orgType: string;
  tenantId: string | null;
  entitlements?: readonly Entitlement[];
  /** Feature codes already installed for the tenant. */
  installedCodes?: readonly string[];
  vendorRef?: string;
  bundleVersion?: string;
}

export interface MarketplaceView {
  orgType: string;
  label: string;
  tenantId: string | null;
  listings: readonly MarketplaceListingView[];
  /** Publication issues (never silently dropped). */
  issues: readonly string[];
  /** Codes the published catalog covers — must equal the reality's feature set. */
  publishedCodes: readonly string[];
  /** True when every installed feature code has a listing. */
  complete: boolean;
  /** Listings whose product is still a draft (trust unverified, not activated). */
  draftCount: number;
  /** True only when every listed product is active in the marketplace. */
  discoverable: boolean;
  /** Why tenant discovery may return less than this surface shows. */
  reviewNote: string;
  /** Reasons installation is unavailable on this surface (entitlement/tenant). */
  installBlockers: readonly string[];
}

/** A verified vendor publishes the runtime's catalog (no anonymous publishing). */
export const DEFAULT_RUNTIME_VENDOR = "sherivs-verified";

export function buildMarketplaceView(input: MarketplaceViewInput): MarketplaceView {
  const reality = realityForOrgType(input.orgType);
  const installed = new Set(input.installedCodes ?? []);
  const vendorRef = input.vendorRef ?? DEFAULT_RUNTIME_VENDOR;

  const published = publishRealityListings({
    reality,
    vendorRef,
    bundleVersion: input.bundleVersion ?? "1.0.0",
  });

  const listings: MarketplaceListingView[] = published.listings.map((entry) => ({
    featureCode: entry.featureCode,
    label: entry.label,
    workspace: entry.workspace,
    productId: String(entry.product.id),
    productType: entry.product.productType,
    trustLevel: entry.product.trustLevel,
    vendorRef: entry.listing.vendorRef,
    versionRef: String(entry.listing.versionRef),
    supportLevel: entry.listing.supportLevel,
    requirements: entry.listing.requirements,
    permissions: entry.listing.permissions,
    installed: installed.has(entry.featureCode),
    install: decideInstall({
      tenantId: input.tenantId,
      featureCode: entry.featureCode,
      installedCodes: [...installed],
      entitlements: input.entitlements ?? [],
    }),
  }));

  const expected = featureCodesForReality(reality).map((entry) => entry.code);
  const publishedCodes = publishedFeatureCodes(published.listings);
  const draftCount = published.listings.filter((entry) => !entry.product.isActive).length;
  const issues = [...published.issues];
  for (const entry of listings) {
    if (!isKnownMarketplaceProductType(entry.productType)) {
      issues.push(`${entry.featureCode}: unknown product type "${entry.productType}"`);
    }
  }

  const installBlockers: string[] = [];
  if (!input.tenantId) installBlockers.push("no tenant context — installation is tenant-scoped");
  if ((input.entitlements ?? []).length === 0) {
    installBlockers.push("no active entitlement covers this installation");
  }

  return {
    orgType: input.orgType,
    label: organizationClassLabel(input.orgType),
    tenantId: input.tenantId,
    listings,
    issues,
    publishedCodes,
    complete: publishedCodes.length === expected.length,
    draftCount,
    discoverable: draftCount === 0,
    reviewNote:
      draftCount === 0
        ? "Every listed product is active and discoverable by tenants."
        : `${draftCount} of ${published.listings.length} listing(s) are drafts: trust is unverified until a review activates the product, and tenant discovery (keywordDiscover) ignores inactive products by design.`,
    installBlockers,
  };
}

/**
 * Search the PUBLISHED catalog this surface shows (label, code, workspace,
 * requirements, vendor). Deterministic: token match, catalogue order preserved.
 */
export function searchMarketplace(
  view: MarketplaceView,
  query: string,
  maxResults = 20,
): readonly MarketplaceListingView[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return view.listings.slice(0, maxResults);
  return view.listings
    .filter((listing) => {
      const haystack = [
        listing.label,
        listing.featureCode,
        listing.workspace,
        listing.vendorRef,
        ...listing.requirements,
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, maxResults);
}

/**
 * Tenant-facing discovery through the marketplace's OWN contract
 * (`keywordDiscover`). Draft products are inactive, so discovery returns nothing
 * until a review activates them — this function exists to make that law
 * observable instead of pretending the catalog is already live.
 */
export function discoverThroughMarketplace(
  view: MarketplaceView,
  query: string,
  maxResults = 20,
): readonly MarketplaceListingView[] {
  const published = publishRealityListings({
    reality: realityForOrgType(view.orgType),
    vendorRef: view.listings[0]?.vendorRef ?? DEFAULT_RUNTIME_VENDOR,
  });
  const products: MarketplaceProduct[] = published.listings.map((entry) => entry.product);
  const rawListings: ProductListing[] = published.listings.map((entry) => entry.listing);
  const results = keywordDiscover({ query }, rawListings, products, maxResults);
  const relevance = new Map(results.map((result) => [String(result.productId), result.relevance]));
  return view.listings
    .filter((listing) => relevance.has(listing.productId))
    .sort(
      (left, right) =>
        (relevance.get(right.productId) ?? 0) - (relevance.get(left.productId) ?? 0) ||
        left.featureCode.localeCompare(right.featureCode),
    );
}

/** Most trusted listings first (verification rank is marketplace data). */
export function sortByTrust(
  listings: readonly MarketplaceListingView[],
): readonly MarketplaceListingView[] {
  return [...listings].sort(
    (left, right) =>
      PRODUCT_TRUST_RANK[right.trustLevel] - PRODUCT_TRUST_RANK[left.trustLevel] ||
      left.featureCode.localeCompare(right.featureCode),
  );
}
