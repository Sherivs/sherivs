/**
 * CoreGrid Developer Platform — developer environment domain.
 *
 * Implements `architecture/phase-28-developer-platform.md`:
 * - Developer environments (V): Local, Development, Test, Integration, Staging,
 *   Preview, Production. Production access requires stronger controls.
 * - Environment configuration (W): each environment has configuration,
 *   credentials, endpoints, secrets, feature flags, quotas, policies — isolated
 *   from other environments.
 * - Secrets (34-35): developers may create development secrets; production
 *   secrets remain controlled by secure infrastructure. Tooling detects
 *   accidentally committed API keys, tokens, passwords, certificates, private keys.
 * - Configuration management (Y): environment variables, configuration schemas,
 *   secret references, feature flags, configuration versioning.
 * - Local development (29-30): local runtime + simulator of CoreGrid contracts
 *   without production access. Sandbox (31-33): controlled sandbox environments,
 *   isolation from production, synthetic/anonymized datasets.
 * - Permission development (36-37): permission manifests; test under full,
 *   restricted, denied, expired permissions. Policy development (AA): declare
 *   policy dependencies and test policy behavior.
 * - Identity simulation (AB): development identities for administrator, teacher,
 *   student, parent, finance, HR, IT, government, custom roles.
 * - Multi-tenancy testing (38-39): simulate multiple tenants; automated tests
 *   verify tenant A cannot access tenant B.
 * - Dynamic workspace development (AD): test workspace composition from
 *   role/permissions/policy/context/entitlement/device/tenant.
 * - Event development (40, AF): event catalog; generate synthetic events in
 *   sandbox. Webhook development (AG-AH): registration, testing, signing, replay,
 *   inspection; signatures, timestamps, replay protection, retries, idempotency.
 * - Data access simulation (AK): permitted, denied, partial, filtered access.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type DevEnvironmentId = string & { readonly __brand: "DevEnvironmentId" };
export type DevSecretId = string & { readonly __brand: "DevSecretId" };
export type SandboxId = string & { readonly __brand: "SandboxId" };
export type SyntheticIdentityId = string & { readonly __brand: "SyntheticIdentityId" };
export type DevWebhookId = string & { readonly __brand: "DevWebhookId" };

export function devEnvironmentId(raw: string): DevEnvironmentId {
  return raw as DevEnvironmentId;
}
export function devSecretId(raw: string): DevSecretId {
  return raw as DevSecretId;
}
export function sandboxId(raw: string): SandboxId {
  return raw as SandboxId;
}
export function syntheticIdentityId(raw: string): SyntheticIdentityId {
  return raw as SyntheticIdentityId;
}
export function devWebhookId(raw: string): DevWebhookId {
  return raw as DevWebhookId;
}

/* ─────────────────────────────────────────────────────────────
 * Developer environments (Sections V, W)
 * ────────────────────────────────────────────────────────────*/

export type DevEnvironmentKind =
  "local" | "development" | "test" | "integration" | "staging" | "preview" | "production";

export const DEV_ENVIRONMENT_KINDS: readonly DevEnvironmentKind[] = [
  "local",
  "development",
  "test",
  "integration",
  "staging",
  "preview",
  "production",
] as const;

export const DEV_ENVIRONMENT_RANK: Record<DevEnvironmentKind, number> = {
  local: 0,
  development: 1,
  test: 2,
  integration: 3,
  staging: 4,
  preview: 5,
  production: 6,
};

export interface DevEnvironment {
  id: DevEnvironmentId;
  projectRef: string;
  kind: DevEnvironmentKind;
  /** Environment-isolated config (Section W). */
  configRefs: string[];
  endpoints: string[];
  featureFlags: string[];
  quotas: Partial<
    Record<"api_calls" | "storage" | "compute" | "ai_inference" | "event_volume", number>
  >;
  policyRefs: string[];
  createdAt: string;
}

export function createDevEnvironment(input: {
  id: DevEnvironmentId;
  projectRef: string;
  kind: DevEnvironmentKind;
  configRefs?: string[];
  endpoints?: string[];
  featureFlags?: string[];
  quotas?: DevEnvironment["quotas"];
  policyRefs?: string[];
  now?: string;
}): DevEnvironment {
  return {
    id: input.id,
    projectRef: input.projectRef,
    kind: input.kind,
    configRefs: input.configRefs ?? [],
    endpoints: input.endpoints ?? [],
    featureFlags: input.featureFlags ?? [],
    quotas: input.quotas ?? {},
    policyRefs: input.policyRefs ?? [],
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/**
 * Production access requires stronger controls (Section V). This contract
 * requires explicit production authorization beyond normal environment creation.
 */
export function isProductionEnvironmentPermitted(input: {
  strongerAuthentication: boolean;
  explicitAuthorization: boolean;
  riskControls: boolean;
}): boolean {
  return input.strongerAuthentication && input.explicitAuthorization && input.riskControls;
}

/* ─────────────────────────────────────────────────────────────
 * Developer secrets (Sections 34, 35)
 * ────────────────────────────────────────────────────────────*/

export interface DevSecret {
  id: DevSecretId;
  projectRef: string;
  environmentKind: DevEnvironmentKind;
  /** Secret reference only — never the value (Section 34). */
  ref: string;
  /** Fingerprint of the secret value for detection. */
  fingerprint: string;
  createdAt: string;
}

export function registerDevSecret(input: {
  id: DevSecretId;
  projectRef: string;
  environmentKind: DevEnvironmentKind;
  ref: string;
  fingerprint: string;
  now?: string;
}): { ok: true; secret: DevSecret } | { ok: false; error: string } {
  if (input.environmentKind === "production") {
    return {
      ok: false,
      error: "Production secrets remain controlled by secure infrastructure (Section 34)",
    };
  }
  if (!input.fingerprint.trim()) {
    return { ok: false, error: "Secret fingerprint is required" };
  }
  return {
    ok: true,
    secret: {
      id: input.id,
      projectRef: input.projectRef,
      environmentKind: input.environmentKind,
      ref: input.ref,
      fingerprint: input.fingerprint,
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

export type SecretExposureKind = "api_key" | "token" | "password" | "certificate" | "private_key";

export const SECRET_EXPOSURE_KINDS: readonly SecretExposureKind[] = [
  "api_key",
  "token",
  "password",
  "certificate",
  "private_key",
] as const;

/**
 * Secret exposure prevention (Section 35): developer tooling must detect
 * accidentally committed API keys, tokens, passwords, certificates, private keys.
 */
export function detectSecretExposure(content: string): SecretExposureKind[] {
  const found: SecretExposureKind[] = [];
  const patterns: Array<{ kind: SecretExposureKind; re: RegExp }> = [
    { kind: "api_key", re: /(sk-[a-z0-9]{16,}|api[_-]?key[=:\s]["']?[a-z0-9]{16,})/i },
    { kind: "token", re: /(token|bearer)[=:\s]["']?[a-z0-9._-]{16,}/i },
    { kind: "password", re: /(password|passwd|pwd)[=:\s]["']?[^\s"']{6,}/i },
    { kind: "private_key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { kind: "certificate", re: /-----BEGIN CERTIFICATE-----/ },
  ];
  for (const p of patterns) {
    if (p.re.test(content)) found.push(p.kind);
  }
  return found;
}

/* ─────────────────────────────────────────────────────────────
 * Sandbox (Sections 31, 32, 33)
 * ────────────────────────────────────────────────────────────*/

export interface Sandbox {
  id: SandboxId;
  projectRef: string;
  /** Synthetic or anonymized development dataset refs (Section 33). */
  datasetRefs: string[];
  /** Sandbox data is isolated from production (Section 32). */
  productionIsolated: boolean;
  createdAt: string;
}

export function createSandbox(input: {
  id: SandboxId;
  projectRef: string;
  datasetRefs?: string[];
  productionIsolated?: boolean;
  now?: string;
}): { ok: true; sandbox: Sandbox } | { ok: false; error: string } {
  if (input.productionIsolated === false) {
    return { ok: false, error: "Sandbox data must be isolated from production (Section 32)" };
  }
  return {
    ok: true,
    sandbox: {
      id: input.id,
      projectRef: input.projectRef,
      datasetRefs: input.datasetRefs ?? [],
      productionIsolated: true,
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Permission + policy development (Sections 36, 37, AA)
 * ────────────────────────────────────────────────────────────*/

export type PermissionTestScenario = "full" | "restricted" | "denied" | "expired";

export const PERMISSION_TEST_SCENARIOS: readonly PermissionTestScenario[] = [
  "full",
  "restricted",
  "denied",
  "expired",
] as const;

export interface PermissionTestInput {
  permission: string;
  scenario: PermissionTestScenario;
  /** Whether the permission is currently valid (expired scenario). */
  valid: boolean;
}

/**
 * Permission testing (Section 37): developers test behavior under full,
 * restricted, denied, and expired permissions. A permission is granted only for
 * the full scenario; all others exercise denial paths.
 */
export function isPermissionGrantedInScenario(input: PermissionTestInput): boolean {
  if (input.scenario === "full") return input.valid;
  if (input.scenario === "expired") return false;
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Identity simulation (Section AB)
 * ────────────────────────────────────────────────────────────*/

export type SyntheticRole =
  | "administrator"
  | "teacher"
  | "student"
  | "parent"
  | "finance_user"
  | "hr_user"
  | "it_user"
  | "government_user"
  | "custom";

export const SYNTHETIC_ROLES: readonly SyntheticRole[] = [
  "administrator",
  "teacher",
  "student",
  "parent",
  "finance_user",
  "hr_user",
  "it_user",
  "government_user",
  "custom",
] as const;

export interface SyntheticIdentity {
  id: SyntheticIdentityId;
  tenantId: TenantId;
  role: SyntheticRole;
  label: string;
  createdAt: string;
}

export function createSyntheticIdentity(input: {
  id: SyntheticIdentityId;
  tenantId: TenantId;
  role: SyntheticRole;
  label: string;
  now?: string;
}): SyntheticIdentity {
  return {
    id: input.id,
    tenantId: input.tenantId,
    role: input.role,
    label: input.label,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Multi-tenancy testing (Sections 38, 39) + tenant isolation
 * ────────────────────────────────────────────────────────────*/

/**
 * Isolation testing (Section 39): automated tests must verify that tenant A
 * cannot access tenant B. This contract enforces the boundary at the domain layer.
 */
export function isTenantIsolationRespected(
  resourceTenantId: TenantId,
  requesterTenantId: TenantId,
): boolean {
  return resourceTenantId === requesterTenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Event development (Sections 40, AE, AF)
 * ────────────────────────────────────────────────────────────*/

export interface EventCatalogEntry {
  eventName: string;
  schemaRef: string;
  producerRef: string;
  consumers: string[];
  deliveryGuarantees: "at_least_once" | "at_most_once" | "exactly_once";
  ordering: "ordered" | "unordered";
  retryBehavior: string;
}

export function registerEventCatalogEntry(input: {
  eventName: string;
  schemaRef: string;
  producerRef: string;
  consumers?: string[];
  deliveryGuarantees?: EventCatalogEntry["deliveryGuarantees"];
  ordering?: EventCatalogEntry["ordering"];
  retryBehavior?: string;
}): EventCatalogEntry {
  return {
    eventName: input.eventName,
    schemaRef: input.schemaRef,
    producerRef: input.producerRef,
    consumers: input.consumers ?? [],
    deliveryGuarantees: input.deliveryGuarantees ?? "at_least_once",
    ordering: input.ordering ?? "unordered",
    retryBehavior: input.retryBehavior ?? "exponential_backoff",
  };
}

/**
 * Event simulator (Section AF): developers generate synthetic events in sandbox
 * environments — never against production.
 */
export function canGenerateSyntheticEvent(environmentKind: DevEnvironmentKind): boolean {
  return environmentKind !== "production";
}

/* ─────────────────────────────────────────────────────────────
 * Webhook development (Sections AG, AH)
 * ────────────────────────────────────────────────────────────*/

export interface DevWebhook {
  id: DevWebhookId;
  projectRef: string;
  eventTypes: string[];
  endpoint: string;
  /** Signature secret fingerprint — never the secret itself. */
  secretFingerprint: string;
  /** Replay protection window minutes (Section AH). */
  replayWindowMinutes: number;
  idempotencySupported: boolean;
  retryCount: number;
}

export function registerDevWebhook(input: {
  id: DevWebhookId;
  projectRef: string;
  eventTypes: string[];
  endpoint: string;
  secretFingerprint: string;
  replayWindowMinutes?: number;
  idempotencySupported?: boolean;
  retryCount?: number;
}): DevWebhook {
  return {
    id: input.id,
    projectRef: input.projectRef,
    eventTypes: input.eventTypes,
    endpoint: input.endpoint,
    secretFingerprint: input.secretFingerprint,
    replayWindowMinutes: input.replayWindowMinutes ?? 15,
    idempotencySupported: input.idempotencySupported ?? true,
    retryCount: input.retryCount ?? 3,
  };
}

/**
 * Webhook security (Section AH): signatures, timestamps, replay protection,
 * retries, and idempotency must all hold.
 */
export function isDevWebhookDeliveryValid(input: {
  webhook: DevWebhook;
  signatureValid: boolean;
  eventAgeMinutes: number;
  attempt: number;
  idempotentKeyPresent: boolean;
}): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.signatureValid) reasons.push("Invalid signature");
  if (input.eventAgeMinutes > input.webhook.replayWindowMinutes)
    reasons.push("Replay window exceeded");
  if (input.attempt > input.webhook.retryCount + 1) reasons.push("Retry limit exceeded");
  if (input.webhook.idempotencySupported && !input.idempotentKeyPresent)
    reasons.push("Idempotency key required");
  return { valid: reasons.length === 0, reasons };
}

/* ─────────────────────────────────────────────────────────────
 * Data access simulation (Section AK)
 * ────────────────────────────────────────────────────────────*/

export type DataAccessSimulation = "permitted" | "denied" | "partial" | "filtered";

export const DATA_ACCESS_SIMULATIONS: readonly DataAccessSimulation[] = [
  "permitted",
  "denied",
  "partial",
  "filtered",
] as const;

/** Data access simulation (Section AK): only permitted access grants full rows. */
export function simulateDataAccess(kind: DataAccessSimulation): {
  granted: boolean;
  partial: boolean;
  filtered: boolean;
} {
  switch (kind) {
    case "permitted":
      return { granted: true, partial: false, filtered: false };
    case "denied":
      return { granted: false, partial: false, filtered: false };
    case "partial":
      return { granted: true, partial: true, filtered: false };
    case "filtered":
      return { granted: true, partial: false, filtered: true };
  }
}
