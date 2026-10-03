/**
 * CoreGrid — V1-008: the neutral organization-provisioning contract.
 *
 * The platform-level onboarding engine provisions, as ONE transactional unit:
 * an organization record, its workspaces, its people's memberships, the
 * neutral core roles (from `rbac/neutral-roles.ts`) and domain-configured role
 * contributions (resolved against `rbac/domain-contribution.ts`'s combined
 * grant table). The engine is runtime-agnostic: WHAT an "organization record",
 * a "workspace" or a "membership row" physically is on the substrate is
 * declared per domain by a DomainProvisioningContribution
 * (`domain-provisioning.ts`), never hardcoded here.
 *
 * Boundary: Zod-validated input contracts + structural client contracts. No
 * vendor import, no domain vocabulary, no persistence.
 */
import { z } from "zod";
import {
  emailField,
  nonEmptyText,
  optionalEmail,
  optionalText,
  phoneField,
  subscriptionTier,
} from "@/lib/validation";

/* ─────────────────────────────────────────────────────────────
 * Request contracts (Zod — onboarding input is untrusted)
 * ────────────────────────────────────────────────────────────*/

export const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const LOCAL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** WHO is being onboarded — the organization's own identity facts. */
export const organizationIdentitySchema = z.object({
  name: nonEmptyText("Organization name", 120),
  contactEmail: optionalEmail,
  phone: phoneField,
  address: optionalText(300),
});

/** HOW the tenant is shaped — neutral structure facts plus domain-owned data. */
export const organizationStructureSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(SLUG_PATTERN, "Slug must be 2–48 characters of a-z, 0-9 and hyphen")
    .optional(),
  subscriptionTier: subscriptionTier.optional(),
  monthlyFee: z.number().min(0).max(1_000_000).optional(),
  /** Domain-declared structure payload. Opaque to the engine; validated by the domain's builders. */
  domainData: z.record(z.string(), z.unknown()).optional(),
});

/** WHO gets membership — a provisioned person and the role they carry. */
export const provisioningPersonSchema = z.object({
  fullName: nonEmptyText("Member full name", 120),
  email: emailField,
  /** Domain-local role name (resolved through the domain's provisioning role vocabulary). */
  role: z.string().regex(LOCAL_NAME_PATTERN, "Role must be a lowercase local name"),
  /** Whether the engine must provision an identity (auth account) for this person. */
  createAuthAccount: z.boolean().default(true),
});

/** THE onboarding request: identity + type (registered domain) + structure + people. */
export const organizationProvisioningRequestSchema = z
  .object({
    domainId: z
      .string()
      .regex(DOMAIN_ID_PATTERN, "domainId must be a registered domain id (/^[a-z][a-z0-9_]*$/)"),
    identity: organizationIdentitySchema,
    structure: organizationStructureSchema.default({}),
    people: z.array(provisioningPersonSchema).min(1).max(50),
  })
  .strict();

export type OrganizationIdentity = z.infer<typeof organizationIdentitySchema>;
export type OrganizationStructure = z.infer<typeof organizationStructureSchema>;
export type ProvisioningPerson = z.infer<typeof provisioningPersonSchema>;
export type OrganizationProvisioningRequest = z.infer<typeof organizationProvisioningRequestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Structural substrate contracts (the engine is vendor-agnostic; the
 * sanctioned Supabase admin client is narrowed onto these at the server
 * boundary — same proven pattern as `lib/server/write-audit.ts`)
 * ────────────────────────────────────────────────────────────*/

export type ProvisioningRecordRow = Record<string, unknown>;

/** Postgrest-shaped write surface the engine drives (insert with id read-back, delete by id). */
export interface ProvisioningSubstrateClient {
  from(table: string): {
    insert(payload: Record<string, unknown>): {
      select(columns: string): PromiseLike<{
        data: ProvisioningRecordRow[] | null;
        error: { message: string } | null;
      }>;
    };
    delete(): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/** Auth-admin-shaped identity surface for provisioned accounts. */
export interface ProvisioningIdentityAdminClient {
  createUser(input: {
    email: string;
    password: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
  }): PromiseLike<{
    data: { user: { id: string } | null } | null;
    error: { message: string } | null;
  }>;
  deleteUser(id: string): PromiseLike<{ error: { message: string } | null }>;
}