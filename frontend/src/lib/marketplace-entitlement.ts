/**
 * CoreGrid Marketplace Platform — commercial and entitlement domain.
 *
 * Implements `architecture/phase-27-marketplace.md`:
 * - Pricing models (52-57): free, one-time purchase, subscription, usage-based,
 *   seat-based, institution-based, transaction-based, tiered, freemium,
 *   negotiated enterprise pricing; multiple currencies (53), regional pricing
 *   (54), educational pricing (55) (school/student/teacher/nonprofit/government/
 *   institutional plans), free trials (56), discounts (57) (coupons, promotional,
 *   institutional, volume, educational).
 * - Financial boundary (58-62): Phase 27 does NOT become the financial ledger;
 *   Phase 13 remains authoritative for financial transactions. Marketplace creates
 *   commercial orders and entitlements; settlement flows through Phase 13.
 *   Configurable revenue-sharing (60), vendor settlement (61), tax exposed to the
 *   financial subsystem (62).
 * - Entitlement (63-67): determines whether a tenant or user may use a marketplace
 *   capability; sources (purchase, subscription, grant, institution plan,
 *   government program, CoreGrid license, free allocation); scope (tenant, campus,
 *   department, workspace, role, user, device); expiration (66); suspension without
 *   deleting the product (67).
 * - Installation lifecycle (68): Requested → Authorized → Validated →
 *   Dependencies Checked → Installed → …; configuration (166-168) with schema,
 *   validation before activation, versioning.
 * - Uninstallation (171): data retention, data deletion, dependencies, remaining
 *   configuration, entitlement state. Data exit (172).
 * - Institutional procurement (140-143): Discover → Evaluate → Request → Approve →
 *   Purchase → Install → Configure → Monitor; approval policies, department
 *   procurement, budget controls.
 */

import type { TenantId } from "./tenant-core";
import type { MarketplaceProductId } from "./marketplace-core";

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type MarketOfferId = string & { readonly __brand: "MarketOfferId" };
export type EntitlementId = string & { readonly __brand: "EntitlementId" };
export type MarketplaceInstallationId = string & { readonly __brand: "MarketplaceInstallationId" };
export type ProcurementRequestId = string & { readonly __brand: "ProcurementRequestId" };
export type ProductConfigurationId = string & { readonly __brand: "ProductConfigurationId" };

export function marketOfferId(raw: string): MarketOfferId {
  return raw as MarketOfferId;
}
export function entitlementId(raw: string): EntitlementId {
  return raw as EntitlementId;
}
export function marketplaceInstallationId(raw: string): MarketplaceInstallationId {
  return raw as MarketplaceInstallationId;
}
export function procurementRequestId(raw: string): ProcurementRequestId {
  return raw as ProcurementRequestId;
}
export function productConfigurationId(raw: string): ProductConfigurationId {
  return raw as ProductConfigurationId;
}

/* ─────────────────────────────────────────────────────────────
 * Pricing models (Section 52)
 * ────────────────────────────────────────────────────────────*/

export type PricingModel =
  | "free"
  | "one_time"
  | "subscription"
  | "usage_based"
  | "seat_based"
  | "institution_based"
  | "transaction_based"
  | "tiered"
  | "freemium"
  | "negotiated_enterprise";

export const PRICING_MODELS: readonly PricingModel[] = [
  "free",
  "one_time",
  "subscription",
  "usage_based",
  "seat_based",
  "institution_based",
  "transaction_based",
  "tiered",
  "freemium",
  "negotiated_enterprise",
] as const;

export interface MarketOffer {
  id: MarketOfferId;
  productId: MarketplaceProductId;
  pricingModel: PricingModel;
  /** ISO-4217 currency code. */
  currency: string;
  /** Price in minor units (e.g. kobo/cent). */
  priceMinorUnits: number;
  /** Recurrence for subscription models. */
  recurrence: "one_time" | "monthly" | "annual" | null;
  /** Educational pricing tiers (Section 55). */
  educationalPricing: Partial<
    Record<"school" | "student" | "teacher" | "nonprofit" | "government" | "institutional", number>
  >;
  /** Regional pricing (Section 54) — ISO region code → minor units. */
  regionalPricing: Record<string, number>;
  /** Trial period in days (Section 56). */
  trialDays: number;
  /** Whether a discount is currently applicable (Section 57). */
  discountPercent: number;
  isActive: boolean;
  createdAt: string;
}

export function createMarketOffer(input: {
  id: MarketOfferId;
  productId: MarketplaceProductId;
  pricingModel: PricingModel;
  currency?: string;
  priceMinorUnits?: number;
  recurrence?: MarketOffer["recurrence"];
  educationalPricing?: MarketOffer["educationalPricing"];
  regionalPricing?: Record<string, number>;
  trialDays?: number;
  discountPercent?: number;
  isActive?: boolean;
  now?: string;
}): { ok: true; offer: MarketOffer } | { ok: false; error: string } {
  if (input.priceMinorUnits !== undefined && input.priceMinorUnits < 0) {
    return { ok: false, error: "Price cannot be negative" };
  }
  if (
    input.discountPercent !== undefined &&
    (input.discountPercent < 0 || input.discountPercent > 100)
  ) {
    return { ok: false, error: "Discount must be between 0 and 100" };
  }
  if (input.trialDays !== undefined && input.trialDays < 0) {
    return { ok: false, error: "Trial period cannot be negative" };
  }
  return {
    ok: true,
    offer: {
      id: input.id,
      productId: input.productId,
      pricingModel: input.pricingModel,
      currency: input.currency ?? "NGN",
      priceMinorUnits: input.priceMinorUnits ?? 0,
      recurrence: input.recurrence ?? null,
      educationalPricing: input.educationalPricing ?? {},
      regionalPricing: input.regionalPricing ?? {},
      trialDays: input.trialDays ?? 0,
      discountPercent: input.discountPercent ?? 0,
      isActive: input.isActive ?? false,
      createdAt: input.now ?? new Date().toISOString(),
    },
  };
}

/** Effective price for a region, falling back to base price. */
export function effectivePrice(offer: MarketOffer, region: string): number {
  if (offer.regionalPricing[region] !== undefined) return offer.regionalPricing[region];
  const discounted = Math.round(offer.priceMinorUnits * (1 - offer.discountPercent / 100));
  return discounted;
}

/* ─────────────────────────────────────────────────────────────
 * Entitlement (Sections 63, 64, 65, 66, 67)
 * ────────────────────────────────────────────────────────────*/

export type EntitlementSource =
  | "purchase"
  | "subscription"
  | "grant"
  | "institution_plan"
  | "government_program"
  | "coregrid_license"
  | "free_allocation";

export const ENTITLEMENT_SOURCES: readonly EntitlementSource[] = [
  "purchase",
  "subscription",
  "grant",
  "institution_plan",
  "government_program",
  "coregrid_license",
  "free_allocation",
] as const;

export type EntitlementScopeKind =
  "tenant" | "campus" | "department" | "workspace" | "role" | "user" | "device";

export const ENTITLEMENT_SCOPE_KINDS: readonly EntitlementScopeKind[] = [
  "tenant",
  "campus",
  "department",
  "workspace",
  "role",
  "user",
  "device",
] as const;

export type EntitlementState = "active" | "suspended" | "expired" | "revoked";

export const ENTITLEMENT_STATES: readonly EntitlementState[] = [
  "active",
  "suspended",
  "expired",
  "revoked",
] as const;

export interface Entitlement {
  id: EntitlementId;
  tenantId: TenantId;
  productId: MarketplaceProductId;
  source: EntitlementSource;
  scopeKind: EntitlementScopeKind;
  scopeRef: string;
  state: EntitlementState;
  expiresAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export function createEntitlement(input: {
  id: EntitlementId;
  tenantId: TenantId;
  productId: MarketplaceProductId;
  source: EntitlementSource;
  scopeKind: EntitlementScopeKind;
  scopeRef: string;
  expiresAt?: string | null;
  now?: string;
}): { ok: true; entitlement: Entitlement } | { ok: false; error: string } {
  const now = input.now ?? new Date().toISOString();
  if (input.expiresAt && input.expiresAt <= now) {
    return { ok: false, error: "Entitlement expiry must be in the future (Section 66)" };
  }
  return {
    ok: true,
    entitlement: {
      id: input.id,
      tenantId: input.tenantId,
      productId: input.productId,
      source: input.source,
      scopeKind: input.scopeKind,
      scopeRef: input.scopeRef,
      state: "active",
      expiresAt: input.expiresAt ?? null,
      suspendedAt: null,
      createdAt: now,
    },
  };
}

/** Section 66: entitlement expiration. */
export function isEntitlementActive(
  ent: Entitlement,
  now: string = new Date().toISOString(),
): boolean {
  if (ent.state === "suspended" || ent.state === "revoked") return false;
  if (ent.state === "expired") return false;
  if (ent.expiresAt !== null && ent.expiresAt <= now) return false;
  return true;
}

/** Section 67: suspension without deleting the product. */
export function suspendEntitlement(
  ent: Entitlement,
  now: string = new Date().toISOString(),
): Entitlement {
  return { ...ent, state: "suspended", suspendedAt: now };
}

export function revokeEntitlement(ent: Entitlement): Entitlement {
  return { ...ent, state: "revoked" };
}

/* ─────────────────────────────────────────────────────────────
 * Installation lifecycle (Section 68) + configuration (166-168)
 * ────────────────────────────────────────────────────────────*/

export type InstallationState =
  | "requested"
  | "authorized"
  | "validated"
  | "dependencies_checked"
  | "installed"
  | "configured"
  | "active"
  | "updating"
  | "suspended"
  | "uninstalled"
  | "failed";

export const INSTALLATION_STATES: readonly InstallationState[] = [
  "requested",
  "authorized",
  "validated",
  "dependencies_checked",
  "installed",
  "configured",
  "active",
  "updating",
  "suspended",
  "uninstalled",
  "failed",
] as const;

const INSTALLATION_ORDER: Record<InstallationState, number> = {
  requested: 0,
  authorized: 1,
  validated: 2,
  dependencies_checked: 3,
  installed: 4,
  configured: 5,
  active: 6,
  updating: 7,
  suspended: 8,
  uninstalled: 9,
  failed: -1,
};

export interface MarketplaceInstallation {
  id: MarketplaceInstallationId;
  tenantId: TenantId;
  productId: MarketplaceProductId;
  state: InstallationState;
  installedVersion: string | null;
  configurationRef: ProductConfigurationId | null;
  createdAt: string;
  updatedAt: string;
}

export function createInstallation(input: {
  id: MarketplaceInstallationId;
  tenantId: TenantId;
  productId: MarketplaceProductId;
  now?: string;
}): MarketplaceInstallation {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    tenantId: input.tenantId,
    productId: input.productId,
    state: "requested",
    installedVersion: null,
    configurationRef: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Installation advances one stage at a time (Section 68). */
export function canTransitionInstallation(
  current: InstallationState,
  next: InstallationState,
): boolean {
  if (next === "failed") return current !== "uninstalled";
  return INSTALLATION_ORDER[next] === INSTALLATION_ORDER[current] + 1;
}

export interface ProductConfiguration {
  id: ProductConfigurationId;
  tenantId: TenantId;
  installationId: MarketplaceInstallationId;
  version: number;
  values: Record<string, string | number | boolean | null>;
  /** Validation status — configuration must validate before activation (Section 167). */
  validated: boolean;
  createdAt: string;
}

/** Section 167: configuration must validate before activation. */
export function validateProductConfiguration(input: {
  id: ProductConfigurationId;
  tenantId: TenantId;
  installationId: MarketplaceInstallationId;
  version?: number;
  values: Record<string, string | number | boolean | null>;
  requiredKeys: string[];
  now?: string;
}): { ok: true; config: ProductConfiguration } | { ok: false; error: string } {
  for (const key of input.requiredKeys) {
    if (input.values[key] === undefined || input.values[key] === null || input.values[key] === "") {
      return { ok: false, error: `Configuration key '${key}' is required (Section 167)` };
    }
  }
  return {
    ok: true,
    config: {
      id: input.id,
      tenantId: input.tenantId,
      installationId: input.installationId,
      version: input.version ?? 1,
      values: input.values,
      validated: true,
      createdAt: input.now ?? new Date().toISOString(),
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Procurement workflow (Sections 140, 141, 142, 143)
 * ────────────────────────────────────────────────────────────*/

export type ProcurementState =
  | "discovered"
  | "evaluated"
  | "requested"
  | "approved"
  | "purchased"
  | "installed"
  | "configured"
  | "monitoring"
  | "rejected";

export const PROCUREMENT_STATES: readonly ProcurementState[] = [
  "discovered",
  "evaluated",
  "requested",
  "approved",
  "purchased",
  "installed",
  "configured",
  "monitoring",
  "rejected",
] as const;

export interface ProcurementRequest {
  id: ProcurementRequestId;
  tenantId: TenantId;
  productId: MarketplaceProductId;
  state: ProcurementState;
  /** Whether administrator approval is required (Section 141). */
  requiresApproval: boolean;
  approvedByRef: string | null;
  /** Budget control (Section 143): the request is checked against approved budget. */
  budgetRef: string | null;
  estimatedCostMinorUnits: number;
  createdAt: string;
}

export function createProcurementRequest(input: {
  id: ProcurementRequestId;
  tenantId: TenantId;
  productId: MarketplaceProductId;
  requiresApproval?: boolean;
  budgetRef?: string | null;
  estimatedCostMinorUnits?: number;
  now?: string;
}): ProcurementRequest {
  return {
    id: input.id,
    tenantId: input.tenantId,
    productId: input.productId,
    state: "discovered",
    requiresApproval: input.requiresApproval ?? false,
    approvedByRef: null,
    budgetRef: input.budgetRef ?? null,
    estimatedCostMinorUnits: input.estimatedCostMinorUnits ?? 0,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

/**
 * Budget controls (Section 143): a procurement request may be checked against an
 * approved budget. When a budget ref exists, the request must be within it.
 */
export function isWithinProcurementBudget(
  request: ProcurementRequest,
  approvedBudgetMinorUnits: number,
): boolean {
  return request.estimatedCostMinorUnits <= approvedBudgetMinorUnits;
}

/* ─────────────────────────────────────────────────────────────
 * Uninstallation + data exit (Sections 171, 172)
 * ────────────────────────────────────────────────────────────*/

export interface UninstallPlan {
  installationId: MarketplaceInstallationId;
  tenantId: TenantId;
  dataRetentionDays: number;
  dataDeletionRequired: boolean;
  dependenciesToRelease: string[];
  remainingConfigurationRefs: string[];
  /** Entitlement state after uninstall (Section 171). */
  entitlementStateAfter: "revoked" | "suspended" | "unchanged";
}

export function createUninstallPlan(input: {
  installationId: MarketplaceInstallationId;
  tenantId: TenantId;
  dataRetentionDays?: number;
  dataDeletionRequired?: boolean;
  dependenciesToRelease?: string[];
  remainingConfigurationRefs?: string[];
  entitlementStateAfter?: UninstallPlan["entitlementStateAfter"];
}): UninstallPlan {
  return {
    installationId: input.installationId,
    tenantId: input.tenantId,
    dataRetentionDays: input.dataRetentionDays ?? 0,
    dataDeletionRequired: input.dataDeletionRequired ?? true,
    dependenciesToRelease: input.dependenciesToRelease ?? [],
    remainingConfigurationRefs: input.remainingConfigurationRefs ?? [],
    entitlementStateAfter: input.entitlementStateAfter ?? "revoked",
  };
}
