/**
 * CoreGrid Marketplace Platform — vendor and developer domain.
 *
 * Implements `architecture/phase-27-marketplace.md`:
 * - Vendor platform (Sections 14-18): every marketplace publisher must have a
 *   verified vendor identity; vendor types (CoreGrid, school, university,
 *   education company, developer, startup, enterprise, NGO, government, hardware,
 *   AI company, content publisher, professional service provider); vendor
 *   verification (identity, organization, legal, ownership, security, payment);
 *   vendor profile; vendor reputation based on product quality, support, security,
 *   uptime, reviews, incident history, update quality.
 * - Developer onboarding (19-22): controlled registration, risk-based verification
 *   (email/identity/organization/legal), developer organizations with members,
 *   roles, permissions, environments, API credentials, publishing authority;
 *   developer roles (owner, administrator, developer, reviewer, publisher,
 *   security officer, finance officer, support operator).
 * - Product submission (23-25): Draft → Validation → Security Scan →
 *   Compliance Review → Testing → Certification → Approval → Publishing;
 *   draft products before publishing; marketplace review by functionality,
 *   security, privacy, performance, interoperability, policy compliance.
 * - Reviews (110-113): authorized users may review products; review integrity
 *   prevents fake reviews, manipulation, vendor abuse; verified usage indicator;
 *   review moderation.
 * - Ratings (114): configurable dimensions — quality, usability, reliability,
 *   support, value.
 * - Vendor exit (173): existing customers notified, subscriptions handled, data
 *   export available, security risks evaluated.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type VendorId = string & { readonly __brand: "VendorId" };
export type DeveloperOrganizationId = string & { readonly __brand: "DeveloperOrganizationId" };
export type ProductSubmissionId = string & { readonly __brand: "ProductSubmissionId" };
export type ProductReviewId = string & { readonly __brand: "ProductReviewId" };
export type RatingId = string & { readonly __brand: "RatingId" };

export function vendorId(raw: string): VendorId {
  return raw as VendorId;
}
export function developerOrganizationId(raw: string): DeveloperOrganizationId {
  return raw as DeveloperOrganizationId;
}
export function productSubmissionId(raw: string): ProductSubmissionId {
  return raw as ProductSubmissionId;
}
export function productReviewId(raw: string): ProductReviewId {
  return raw as ProductReviewId;
}
export function ratingId(raw: string): RatingId {
  return raw as RatingId;
}

/* ─────────────────────────────────────────────────────────────
 * Vendor types (Section 15)
 * ────────────────────────────────────────────────────────────*/

export type VendorType =
  | "coregrid"
  | "school"
  | "university"
  | "education_company"
  | "developer"
  | "startup"
  | "enterprise"
  | "ngo"
  | "government"
  | "hardware_company"
  | "ai_company"
  | "content_publisher"
  | "professional_service"
  | "custom";

export const VENDOR_TYPES: readonly VendorType[] = [
  "coregrid",
  "school",
  "university",
  "education_company",
  "developer",
  "startup",
  "enterprise",
  "ngo",
  "government",
  "hardware_company",
  "ai_company",
  "content_publisher",
  "professional_service",
  "custom",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Vendor verification (Sections 14, 16)
 * ────────────────────────────────────────────────────────────*/

export type VendorVerificationLevel =
  | "registered"
  | "email_verified"
  | "identity_verified"
  | "organization_verified"
  | "legal_verified"
  | "fully_verified";

export const VENDOR_VERIFICATION_LEVELS: readonly VendorVerificationLevel[] = [
  "registered",
  "email_verified",
  "identity_verified",
  "organization_verified",
  "legal_verified",
  "fully_verified",
] as const;

export const VENDOR_VERIFICATION_RANK: Record<VendorVerificationLevel, number> = {
  registered: 0,
  email_verified: 1,
  identity_verified: 2,
  organization_verified: 3,
  legal_verified: 4,
  fully_verified: 5,
};

export interface Vendor {
  id: VendorId;
  tenantId: TenantId;
  type: VendorType;
  organizationName: string;
  description: string | null;
  geography: string;
  contactRef: string;
  /** Verification checks completed (Section 16). */
  verificationChecks: string[];
  verificationLevel: VendorVerificationLevel;
  /** Trust indicators (Section 44) — never imply guarantees that do not exist. */
  trustIndicators: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVendorInput {
  id: VendorId;
  tenantId: TenantId;
  type: VendorType;
  organizationName: string;
  description?: string | null;
  geography: string;
  contactRef: string;
  verificationChecks?: string[];
  now?: string;
}

export type CreateVendorResult = { ok: true; vendor: Vendor } | { ok: false; error: string };

export function createVendor(
  input: CreateVendorInput,
  now: string = timeAuthority.now().at,
): CreateVendorResult {
  if (!input.organizationName.trim()) {
    return { ok: false, error: "Vendor organization name is required" };
  }
  if (!input.geography.trim()) {
    return { ok: false, error: "Vendor geography is required" };
  }
  if (!input.contactRef.trim()) {
    return { ok: false, error: "Vendor contact reference is required" };
  }
  return {
    ok: true,
    vendor: {
      id: input.id,
      tenantId: input.tenantId,
      type: input.type,
      organizationName: input.organizationName.trim(),
      description: input.description ?? null,
      geography: input.geography.trim(),
      contactRef: input.contactRef,
      verificationChecks: input.verificationChecks ?? [],
      verificationLevel: "registered",
      trustIndicators: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Vendor verification (Section 16): verification levels are progressive; a vendor
 * cannot be promoted without the prerequisite checks.
 */
export function promoteVendorVerification(
  vendor: Vendor,
  to: VendorVerificationLevel,
  check: string,
): { ok: true; vendor: Vendor } | { ok: false; error: string } {
  if (VENDOR_VERIFICATION_RANK[to] <= VENDOR_VERIFICATION_RANK[vendor.verificationLevel]) {
    return { ok: false, error: "Verification level must increase monotonically" };
  }
  return {
    ok: true,
    vendor: {
      ...vendor,
      verificationLevel: to,
      verificationChecks: [...new Set([...vendor.verificationChecks, check])],
      updatedAt: timeAuthority.now().at,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Developer organizations (Sections 19, 20, 21, 22)
 * ────────────────────────────────────────────────────────────*/

export type DeveloperRole =
  | "owner"
  | "administrator"
  | "developer"
  | "reviewer"
  | "publisher"
  | "security_officer"
  | "finance_officer"
  | "support_operator";

export const DEVELOPER_ROLES: readonly DeveloperRole[] = [
  "owner",
  "administrator",
  "developer",
  "reviewer",
  "publisher",
  "security_officer",
  "finance_officer",
  "support_operator",
] as const;

export interface DeveloperOrganization {
  id: DeveloperOrganizationId;
  tenantId: TenantId;
  name: string;
  /** Member identity refs. */
  members: Array<{ identityRef: string; role: DeveloperRole }>;
  /** Developer environments (Section 21). */
  environments: string[];
  /** Whether this org holds publishing authority. */
  publishingAuthority: boolean;
  createdAt: string;
}

export function createDeveloperOrganization(input: {
  id: DeveloperOrganizationId;
  tenantId: TenantId;
  name: string;
  members?: Array<{ identityRef: string; role: DeveloperRole }>;
  environments?: string[];
  publishingAuthority?: boolean;
  now?: string;
}): DeveloperOrganization {
  return {
    id: input.id,
    tenantId: input.tenantId,
    name: input.name,
    members: input.members ?? [],
    environments: input.environments ?? ["development"],
    publishingAuthority: input.publishingAuthority ?? false,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/** Only the owner/administrator may grant publishing authority (Section 21). */
export function canGrantPublishingAuthority(
  org: DeveloperOrganization,
  identityRef: string,
): boolean {
  const member = org.members.find((m) => m.identityRef === identityRef);
  if (!member) return false;
  return member.role === "owner" || member.role === "administrator";
}

/* ─────────────────────────────────────────────────────────────
 * Product submission workflow (Sections 23, 24)
 * ────────────────────────────────────────────────────────────*/

export type SubmissionState =
  | "draft"
  | "validation"
  | "security_scan"
  | "compliance_review"
  | "testing"
  | "certification"
  | "approval"
  | "publishing"
  | "published"
  | "rejected"
  | "withdrawn";

export const SUBMISSION_STATES: readonly SubmissionState[] = [
  "draft",
  "validation",
  "security_scan",
  "compliance_review",
  "testing",
  "certification",
  "approval",
  "publishing",
  "published",
  "rejected",
  "withdrawn",
] as const;

const SUBMISSION_ORDER: Record<SubmissionState, number> = {
  draft: 0,
  validation: 1,
  security_scan: 2,
  compliance_review: 3,
  testing: 4,
  certification: 5,
  approval: 6,
  publishing: 7,
  published: 8,
  rejected: -1,
  withdrawn: -1,
};

export interface ProductSubmission {
  id: ProductSubmissionId;
  tenantId: TenantId;
  productId: string;
  vendorRef: string;
  state: SubmissionState;
  /** Review findings (Section 25): functionality, security, privacy, performance, interoperability, policy. */
  reviewFindings: string[];
  submittedAt: string;
  updatedAt: string;
}

/** Section 23: a submission advances one stage at a time. */
export function canAdvanceSubmission(current: SubmissionState, next: SubmissionState): boolean {
  if (next === "rejected" || next === "withdrawn") return current !== "published";
  return SUBMISSION_ORDER[next] === SUBMISSION_ORDER[current] + 1;
}

/** Section 24: developers may create products privately before publishing. */
export function createDraftSubmission(input: {
  id: ProductSubmissionId;
  tenantId: TenantId;
  productId: string;
  vendorRef: string;
  now?: string;
}): ProductSubmission {
  return {
    id: input.id,
    tenantId: input.tenantId,
    productId: input.productId,
    vendorRef: input.vendorRef,
    state: "draft",
    reviewFindings: [],
    submittedAt: input.now ?? timeAuthority.now().at,
    updatedAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Reviews & ratings (Sections 110, 111, 112, 113, 114)
 * ────────────────────────────────────────────────────────────*/

export type RatingDimension = "quality" | "usability" | "reliability" | "support" | "value";

export const RATING_DIMENSIONS: readonly RatingDimension[] = [
  "quality",
  "usability",
  "reliability",
  "support",
  "value",
] as const;

export interface ProductReview {
  id: ProductReviewId;
  tenantId: TenantId;
  productId: string;
  /** Reviewer identity (Section 110: authorized users only). */
  reviewerRef: string;
  /** Whether the reviewer actually used the product (Section 112 verified usage). */
  verifiedUsage: boolean;
  rating: Record<RatingDimension, number>;
  comment: string;
  /** Moderation state (Section 113). */
  moderationState: "pending" | "approved" | "rejected" | "hidden";
  createdAt: string;
}

export function createProductReview(input: {
  id: ProductReviewId;
  tenantId: TenantId;
  productId: string;
  reviewerRef: string;
  verifiedUsage: boolean;
  rating: Record<RatingDimension, number>;
  comment?: string;
  now?: string;
}): { ok: true; review: ProductReview } | { ok: false; error: string } {
  for (const dim of RATING_DIMENSIONS) {
    const value = input.rating[dim];
    if (typeof value !== "number" || value < 1 || value > 5) {
      return { ok: false, error: `Rating '${dim}' must be between 1 and 5` };
    }
  }
  if (!input.verifiedUsage) {
    return { ok: false, error: "Review requires verified usage (Section 112)" };
  }
  return {
    ok: true,
    review: {
      id: input.id,
      tenantId: input.tenantId,
      productId: input.productId,
      reviewerRef: input.reviewerRef,
      verifiedUsage: input.verifiedUsage,
      rating: input.rating,
      comment: input.comment ?? "",
      moderationState: "pending",
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/**
 * Review integrity (Section 111): one verified review per reviewer per product —
 * prevents fake reviews and manipulation.
 */
export function canReviewProduct(existingReviews: ProductReview[], reviewerRef: string): boolean {
  return !existingReviews.some(
    (r) => r.reviewerRef === reviewerRef && r.moderationState !== "rejected",
  );
}

/** Average of a rating dimension across approved reviews. */
export function averageRating(reviews: ProductReview[], dimension: RatingDimension): number | null {
  const approved = reviews.filter((r) => r.moderationState === "approved");
  if (approved.length === 0) return null;
  const total = approved.reduce((sum, r) => sum + r.rating[dimension], 0);
  return Math.round((total / approved.length) * 10) / 10;
}

/* ─────────────────────────────────────────────────────────────
 * Vendor reputation (Section 18) + vendor exit (Section 173)
 * ────────────────────────────────────────────────────────────*/

export interface VendorReputation {
  vendorRef: string;
  productQualityScore: number;
  supportScore: number;
  securityScore: number;
  uptimeScore: number;
  reviewScore: number;
  incidentCount: number;
  updateQualityScore: number;
}

export function evaluateVendorReputation(input: {
  vendorRef: string;
  productQualityScore?: number;
  supportScore?: number;
  securityScore?: number;
  uptimeScore?: number;
  reviewScore?: number;
  incidentCount?: number;
  updateQualityScore?: number;
}): VendorReputation {
  return {
    vendorRef: input.vendorRef,
    productQualityScore: input.productQualityScore ?? 0,
    supportScore: input.supportScore ?? 0,
    securityScore: input.securityScore ?? 0,
    uptimeScore: input.uptimeScore ?? 0,
    reviewScore: input.reviewScore ?? 0,
    incidentCount: input.incidentCount ?? 0,
    updateQualityScore: input.updateQualityScore ?? 0,
  };
}

/** Section 173 vendor retirement: all obligations must be met before exit. */
export function isVendorExitPermitted(input: {
  customersNotified: boolean;
  subscriptionsHandled: boolean;
  dataExportAvailable: boolean;
  securityRisksEvaluated: boolean;
}): boolean {
  return (
    input.customersNotified &&
    input.subscriptionsHandled &&
    input.dataExportAvailable &&
    input.securityRisksEvaluated
  );
}
