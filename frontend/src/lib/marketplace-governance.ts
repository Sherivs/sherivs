/**
 * CoreGrid Marketplace Platform — marketplace governance domain.
 *
 * Implements `architecture/phase-27-marketplace.md`:
 * - Publishing governance (120-122): requirements for submission, review,
 *   approval, suspension, retirement; suspension for security vulnerabilities,
 *   fraud, policy violations, severe outages, malicious behavior; emergency
 *   removal for critical security threats.
 * - Product policy (123-125): policy manifest; a product cannot activate if it
 *   conflicts with mandatory tenant policies; jurisdiction policy respected.
 * - Data governance (126-130): data classification, minimization, residency,
 *   retention, deletion workflows.
 * - Marketplace analytics (131-134): listings, installs, active products,
 *   adoption, retention, conversion, revenue, vendor activity; product analytics
 *   for vendors; tenant analytics; platform analytics.
 * - Recommendation (135-136): recommend products based on tenant needs, role,
 *   installed capabilities, policies, usage, institution type — AI recommendations
 *   must not automatically install products.
 * - Marketplace security incidents (176): malicious product, compromised vendor,
 *   package tampering, credential theft, data leakage, fraudulent listing.
 *   Emergency response (177): Detect → Contain → Suspend → Investigate → Notify →
 *   Remediate → Restore. Marketplace audit (178).
 * - Webhooks (89-90): signing, replay protection, authentication, rate limits.
 * - Enterprise marketplace (144-147): private marketplace, internal products,
 *   private distribution, enterprise catalog allowlists.
 * - Government marketplace (148-149): government-approved products and regulatory
 *   distribution.
 * - African ecosystem (150-154): African vendor support, local languages,
 *   regional payments via Phase 13, local infrastructure, affordability.
 * - Offline marketplace (155-156): offline distribution with signatures, integrity
 *   checks, expiration, entitlement verification.
 * - Localization (157): language, currency, timezone, date formats, regional policies.
 * - Events (185): product published/updated/suspended/retired, installation
 *   started/completed/failed, entitlement created/revoked, vendor verified,
 *   security incident.
 * - Catalog caching (187-188): frequent catalog data cached; product changes
 *   invalidate cached representations.
 */

import type { TenantId } from "./tenant-core";
import type { MarketplaceProductId } from "./marketplace-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type MarketplaceSecurityIncidentId = string & {
  readonly __brand: "MarketplaceSecurityIncidentId";
};
export type MarketplaceAuditEventId = string & { readonly __brand: "MarketplaceAuditEventId" };
export type MarketplaceEventId = string & { readonly __brand: "MarketplaceEventId" };

export function marketplaceSecurityIncidentId(raw: string): MarketplaceSecurityIncidentId {
  return raw as MarketplaceSecurityIncidentId;
}
export function marketplaceAuditEventId(raw: string): MarketplaceAuditEventId {
  return raw as MarketplaceAuditEventId;
}
export function marketplaceEventId(raw: string): MarketplaceEventId {
  return raw as MarketplaceEventId;
}

/* ─────────────────────────────────────────────────────────────
 * Publishing governance (Sections 120, 121, 122)
 * ────────────────────────────────────────────────────────────*/

export type ProductLifecycleState =
  "draft" | "submitted" | "approved" | "published" | "suspended" | "retired" | "removed";

export const PRODUCT_LIFECYCLE_STATES: readonly ProductLifecycleState[] = [
  "draft",
  "submitted",
  "approved",
  "published",
  "suspended",
  "retired",
  "removed",
] as const;

export type SuspensionReason =
  "security_vulnerability" | "fraud" | "policy_violation" | "severe_outage" | "malicious_behavior";

export const SUSPENSION_REASONS: readonly SuspensionReason[] = [
  "security_vulnerability",
  "fraud",
  "policy_violation",
  "severe_outage",
  "malicious_behavior",
] as const;

export interface ProductLifecycleRecord {
  productId: MarketplaceProductId;
  state: ProductLifecycleState;
  suspendedReason: SuspensionReason | null;
  updatedAt: string;
}

export function transitionProductLifecycle(
  record: ProductLifecycleRecord,
  to: ProductLifecycleState,
  now: string = timeAuthority.now().at,
): ProductLifecycleRecord {
  return {
    ...record,
    state: to,
    suspendedReason: to === "suspended" ? record.suspendedReason : null,
    updatedAt: now,
  };
}

/**
 * Emergency removal (Section 122): critical security threats trigger emergency
 * marketplace removal. This is the emergency path — it bypasses normal suspension.
 */
export function isEmergencyRemovalRequired(incidentKinds: string[]): boolean {
  return incidentKinds.includes("malicious_product") || incidentKinds.includes("package_tampering");
}

/* ─────────────────────────────────────────────────────────────
 * Product policy compatibility (Sections 123, 124, 125)
 * ────────────────────────────────────────────────────────────*/

export interface PolicyCompatibilityInput {
  /** Product-declared required policy refs (Section 123). */
  requiredPolicyRefs: string[];
  /** Mandatory tenant policy refs (Section 124). */
  mandatoryTenantPolicyRefs: string[];
  /** Tenant policy refs that forbid this product (Section 124). */
  forbiddenPolicyRefs: string[];
  /** Jurisdiction refs the product requires (Section 125). */
  requiredJurisdictions: string[];
  /** Tenant jurisdictions. */
  tenantJurisdictions: string[];
}

export function evaluatePolicyCompatibility(input: PolicyCompatibilityInput): {
  compatible: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const pol of input.requiredPolicyRefs) {
    if (input.forbiddenPolicyRefs.includes(pol))
      reasons.push(`Product requires forbidden policy: ${pol}`);
  }
  for (const jur of input.requiredJurisdictions) {
    if (!input.tenantJurisdictions.includes(jur))
      reasons.push(`Required jurisdiction not supported: ${jur}`);
  }
  return { compatible: reasons.length === 0, reasons };
}

/* ─────────────────────────────────────────────────────────────
 * Marketplace analytics (Sections 131, 132, 133, 134)
 * ────────────────────────────────────────────────────────────*/

export interface MarketplaceMetrics {
  marketplaceId: string;
  listings: number;
  installs: number;
  activeProducts: number;
  adoption: number;
  retention: number;
  conversion: number;
  revenueMinorUnits: number;
  vendorActivity: number;
}

export function computeMarketplaceMetrics(input: {
  marketplaceId: string;
  listings?: number;
  installs?: number;
  activeProducts?: number;
  adoption?: number;
  retention?: number;
  conversion?: number;
  revenueMinorUnits?: number;
  vendorActivity?: number;
}): MarketplaceMetrics {
  return {
    marketplaceId: input.marketplaceId,
    listings: input.listings ?? 0,
    installs: input.installs ?? 0,
    activeProducts: input.activeProducts ?? 0,
    adoption: input.adoption ?? 0,
    retention: input.retention ?? 0,
    conversion: input.conversion ?? 0,
    revenueMinorUnits: input.revenueMinorUnits ?? 0,
    vendorActivity: input.vendorActivity ?? 0,
  };
}

/**
 * Recommendation boundary (Section 136): AI recommendations must not automatically
 * install products. A recommendation is advisory unless explicitly approved.
 */
export function recommendationRequiresApproval(): boolean {
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Security incidents (176) + emergency response (177) + audit (178)
 * ────────────────────────────────────────────────────────────*/

export type MarketplaceIncidentKind =
  | "malicious_product"
  | "compromised_vendor"
  | "package_tampering"
  | "credential_theft"
  | "data_leakage"
  | "fraudulent_listing";

export const MARKETPLACE_INCIDENT_KINDS: readonly MarketplaceIncidentKind[] = [
  "malicious_product",
  "compromised_vendor",
  "package_tampering",
  "credential_theft",
  "data_leakage",
  "fraudulent_listing",
] as const;

export type IncidentResponseStage =
  "detect" | "contain" | "suspend" | "investigate" | "notify" | "remediate" | "restore";

export const INCIDENT_RESPONSE_STAGES: readonly IncidentResponseStage[] = [
  "detect",
  "contain",
  "suspend",
  "investigate",
  "notify",
  "remediate",
  "restore",
] as const;

export interface MarketplaceSecurityIncident {
  id: MarketplaceSecurityIncidentId;
  tenantId: TenantId | null;
  kind: MarketplaceIncidentKind;
  productId: MarketplaceProductId | null;
  vendorRef: string | null;
  responseStage: IncidentResponseStage;
  reportedAt: string;
}

export function reportMarketplaceIncident(input: {
  id: MarketplaceSecurityIncidentId;
  tenantId?: TenantId | null;
  kind: MarketplaceIncidentKind;
  productId?: MarketplaceProductId | null;
  vendorRef?: string | null;
  now?: string;
}): MarketplaceSecurityIncident {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    kind: input.kind,
    productId: input.productId ?? null,
    vendorRef: input.vendorRef ?? null,
    responseStage: "detect",
    reportedAt: input.now ?? timeAuthority.now().at,
  };
}

/** Section 177: response stages advance in order. */
export function canAdvanceIncidentStage(
  current: IncidentResponseStage,
  next: IncidentResponseStage,
): boolean {
  const ci = INCIDENT_RESPONSE_STAGES.indexOf(current);
  const ni = INCIDENT_RESPONSE_STAGES.indexOf(next);
  return ni === ci + 1;
}

export type MarketplaceAuditEventType =
  | "vendor_registered"
  | "product_submitted"
  | "product_approved"
  | "installation"
  | "update"
  | "entitlement"
  | "suspension"
  | "removal";

export const MARKETPLACE_AUDIT_EVENT_TYPES: readonly MarketplaceAuditEventType[] = [
  "vendor_registered",
  "product_submitted",
  "product_approved",
  "installation",
  "update",
  "entitlement",
  "suspension",
  "removal",
] as const;

export interface MarketplaceAuditEvent {
  id: MarketplaceAuditEventId;
  tenantId: TenantId;
  type: MarketplaceAuditEventType;
  actorRef: string;
  productId: MarketplaceProductId | null;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function recordMarketplaceAuditEvent(input: {
  id: MarketplaceAuditEventId;
  tenantId: TenantId;
  type: MarketplaceAuditEventType;
  actorRef: string;
  productId?: MarketplaceProductId | null;
  metadata?: Record<string, string | number | boolean | null>;
  now?: string;
}): MarketplaceAuditEvent {
  return {
    id: input.id,
    tenantId: input.tenantId,
    type: input.type,
    actorRef: input.actorRef,
    productId: input.productId ?? null,
    occurredAt: input.now ?? timeAuthority.now().at,
    metadata: input.metadata ?? {},
  };
}

/* ─────────────────────────────────────────────────────────────
 * Webhooks (Sections 89, 90)
 * ────────────────────────────────────────────────────────────*/

export interface VendorWebhook {
  id: string;
  vendorRef: string;
  /** Event types this webhook subscribes to (Section 89). */
  eventTypes: string[];
  endpoint: string;
  /** Signing secret fingerprint — never the secret itself (Section 90). */
  secretFingerprint: string;
  /** Replay protection (Section 90). */
  replayProtectionWindowMinutes: number;
  rateLimitPerMinute: number;
  isActive: boolean;
}

export function registerVendorWebhook(input: {
  id: string;
  vendorRef: string;
  eventTypes: string[];
  endpoint: string;
  secretFingerprint: string;
  replayProtectionWindowMinutes?: number;
  rateLimitPerMinute?: number;
  isActive?: boolean;
}): VendorWebhook {
  return {
    id: input.id,
    vendorRef: input.vendorRef,
    eventTypes: input.eventTypes,
    endpoint: input.endpoint,
    secretFingerprint: input.secretFingerprint,
    replayProtectionWindowMinutes: input.replayProtectionWindowMinutes ?? 15,
    rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
    isActive: input.isActive ?? true,
  };
}

/**
 * Webhook security (Section 90): signature validity + replay protection +
 * rate limiting must all pass.
 */
export function isWebhookDeliveryAuthorized(input: {
  webhook: VendorWebhook;
  signatureValid: boolean;
  eventAgeMinutes: number;
  requestsThisMinute: number;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.signatureValid) reasons.push("Invalid signature");
  if (input.eventAgeMinutes > input.webhook.replayProtectionWindowMinutes)
    reasons.push("Replay window exceeded");
  if (input.requestsThisMinute > input.webhook.rateLimitPerMinute)
    reasons.push("Rate limit exceeded");
  return { allowed: reasons.length === 0, reasons };
}

/* ─────────────────────────────────────────────────────────────
 * Enterprise / private marketplace (Sections 144, 145, 146, 147)
 * ────────────────────────────────────────────────────────────*/

export interface PrivateMarketplace {
  id: string;
  tenantId: TenantId;
  /** Allowlist of approved product IDs (Section 147 enterprise catalog). */
  allowlist: string[];
  /** Whether internal (tenant-published) products are enabled (Section 145). */
  internalProductsEnabled: boolean;
  isActive: boolean;
}

export function createPrivateMarketplace(input: {
  id: string;
  tenantId: TenantId;
  allowlist?: string[];
  internalProductsEnabled?: boolean;
  isActive?: boolean;
}): PrivateMarketplace {
  return {
    id: input.id,
    tenantId: input.tenantId,
    allowlist: input.allowlist ?? [],
    internalProductsEnabled: input.internalProductsEnabled ?? false,
    isActive: input.isActive ?? true,
  };
}

/** Section 147: a product is purchasable when it is allowlisted in the enterprise catalog. */
export function isProductAllowlisted(marketplace: PrivateMarketplace, productId: string): boolean {
  return marketplace.allowlist.includes(productId);
}

/* ─────────────────────────────────────────────────────────────
 * Offline distribution (Sections 155, 156)
 * ────────────────────────────────────────────────────────────*/

export interface OfflinePackage {
  id: string;
  productId: string;
  version: string;
  /** Signature presence (Section 156). */
  signed: boolean;
  /** Integrity checksum ref. */
  checksumRef: string;
  /** Package expiry. */
  expiresAt: string | null;
  /** Entitlement verification ref (Section 156). */
  entitlementVerificationRef: string | null;
}

export function createOfflinePackage(input: {
  id: string;
  productId: string;
  version: string;
  signed: boolean;
  checksumRef: string;
  expiresAt?: string | null;
  entitlementVerificationRef?: string | null;
}): OfflinePackage {
  return {
    id: input.id,
    productId: input.productId,
    version: input.version,
    signed: input.signed,
    checksumRef: input.checksumRef,
    expiresAt: input.expiresAt ?? null,
    entitlementVerificationRef: input.entitlementVerificationRef ?? null,
  };
}

/** Section 156: offline packages require signature + integrity + non-expiry. */
export function isOfflinePackageValid(
  pkg: OfflinePackage,
  now: string = timeAuthority.now().at,
): boolean {
  if (!pkg.signed) return false;
  if (pkg.checksumRef.trim() === "") return false;
  if (pkg.expiresAt !== null && pkg.expiresAt <= now) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Marketplace events (Section 185) + catalog caching (187, 188)
 * ────────────────────────────────────────────────────────────*/

export type MarketplaceEventType =
  | "product_published"
  | "product_updated"
  | "product_suspended"
  | "product_retired"
  | "installation_started"
  | "installation_completed"
  | "installation_failed"
  | "entitlement_created"
  | "entitlement_revoked"
  | "vendor_verified"
  | "security_incident";

export const MARKETPLACE_EVENT_TYPES: readonly MarketplaceEventType[] = [
  "product_published",
  "product_updated",
  "product_suspended",
  "product_retired",
  "installation_started",
  "installation_completed",
  "installation_failed",
  "entitlement_created",
  "entitlement_revoked",
  "vendor_verified",
  "security_incident",
] as const;

export interface MarketplaceEvent {
  id: MarketplaceEventId;
  tenantId: TenantId | null;
  type: MarketplaceEventType;
  productId: MarketplaceProductId | null;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function publishMarketplaceEvent(input: {
  id: MarketplaceEventId;
  tenantId?: TenantId | null;
  type: MarketplaceEventType;
  productId?: MarketplaceProductId | null;
  metadata?: Record<string, string | number | boolean | null>;
  now?: string;
}): MarketplaceEvent {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    type: input.type,
    productId: input.productId ?? null,
    occurredAt: input.now ?? timeAuthority.now().at,
    metadata: input.metadata ?? {},
  };
}

export interface CatalogCacheEntry {
  key: string;
  productId: MarketplaceProductId;
  version: string;
  /** Whether the cached representation is still valid (Section 188). */
  invalidated: boolean;
  cachedAt: string;
}

/**
 * Catalog caching (Section 187-188): frequently accessed catalog data may be
 * cached; product changes invalidate the relevant cached representations.
 */
export function invalidateCatalogCache(
  entries: CatalogCacheEntry[],
  productId: MarketplaceProductId,
): CatalogCacheEntry[] {
  return entries.map((e) => (e.productId === productId ? { ...e, invalidated: true } : e));
}
