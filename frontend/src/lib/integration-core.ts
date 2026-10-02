/**
 * CoreGrid Integration Fabric — integration, connector, connection, and
 * credential domain.
 *
 * Implements `architecture/phase-29-coregrid-integration.md`:
 * - Subsystem identity (1): the interoperability layer connecting CoreGrid with
 *   external software, institutional/government/education/financial systems,
 *   communication/identity/cloud providers, hardware ecosystems, databases,
 *   APIs, partner and legacy systems — without allowing those systems to become
 *   architectural authorities over CoreGrid.
 * - Integration model (F): External System → Connection → Connector →
 *   Protocol Adapter → Transformation → Validation → CoreGrid Contract.
 * - Integration types (G): API/REST/GraphQL/SOAP/RPC, event, webhook,
 *   message-queue, database, file/SFTP, email/SMS, hardware, cloud, identity,
 *   payment, government, education-system integration.
 * - Connector model (H): a connector is a reusable integration implementation
 *   with identity, version, provider, capabilities, authentication requirements,
 *   schemas, endpoints, events, transformations, rate limits, retry behavior,
 *   compatibility, security requirements.
 * - Connector lifecycle (I): Draft → Development → Testing → Certification →
 *   Approved → Published → Active → Deprecated → Retired.
 * - Integration instance (J): a connector definition is not an integration
 *   instance; each instance maintains isolated credentials and configuration.
 * - Connection management (K): creation, validation, testing, rotation,
 *   suspension, deletion, recovery.
 * - Authentication (L): OAuth 2.0, OIDC, API keys, mutual TLS, certificates,
 *   service accounts, signed requests, SSH keys, username/password where
 *   unavoidable — secrets never stored as ordinary application configuration.
 * - Credential rotation (M): scheduled, emergency, automatic expiry, revocation,
 *   validation. Authorization (N): read/write/execute/subscribe/publish.
 * - Least privilege (O), tenant isolation (P), multi-campus (Q), multi-account (R).
 *
 * Phase 29 consumes the Phase 05 runtime integration adapter registry by
 * reference; it never duplicates it (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ConnectorId = string & { readonly __brand: "ConnectorId" };
export type IntegrationId = string & { readonly __brand: "IntegrationId" };
export type ConnectionId = string & { readonly __brand: "ConnectionId" };
export type CredentialReferenceId = string & { readonly __brand: "CredentialReferenceId" };

export function connectorId(raw: string): ConnectorId {
  return raw as ConnectorId;
}
export function integrationId(raw: string): IntegrationId {
  return raw as IntegrationId;
}
export function connectionId(raw: string): ConnectionId {
  return raw as ConnectionId;
}
export function credentialReferenceId(raw: string): CredentialReferenceId {
  return raw as CredentialReferenceId;
}

/* ─────────────────────────────────────────────────────────────
 * Integration types (Section G)
 * ────────────────────────────────────────────────────────────*/

export type IntegrationType =
  | "api"
  | "rest"
  | "graphql"
  | "soap"
  | "rpc"
  | "event"
  | "webhook"
  | "message_queue"
  | "database"
  | "file"
  | "sftp"
  | "email"
  | "sms"
  | "hardware"
  | "cloud"
  | "identity"
  | "payment"
  | "government"
  | "education_system";

export const INTEGRATION_TYPES: readonly IntegrationType[] = [
  "api",
  "rest",
  "graphql",
  "soap",
  "rpc",
  "event",
  "webhook",
  "message_queue",
  "database",
  "file",
  "sftp",
  "email",
  "sms",
  "hardware",
  "cloud",
  "identity",
  "payment",
  "government",
  "education_system",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Connector model (Section H) + lifecycle (I)
 * ────────────────────────────────────────────────────────────*/

export type ConnectorLifecycleState =
  | "draft"
  | "development"
  | "testing"
  | "certification"
  | "approved"
  | "published"
  | "active"
  | "deprecated"
  | "retired";

export const CONNECTOR_LIFECYCLE_STATES: readonly ConnectorLifecycleState[] = [
  "draft",
  "development",
  "testing",
  "certification",
  "approved",
  "published",
  "active",
  "deprecated",
  "retired",
] as const;

const CONNECTOR_ORDER: Record<ConnectorLifecycleState, number> = {
  draft: 0,
  development: 1,
  testing: 2,
  certification: 3,
  approved: 4,
  published: 5,
  active: 6,
  deprecated: 7,
  retired: 8,
};

export type AuthMethod =
  | "oauth2"
  | "oidc"
  | "api_key"
  | "mutual_tls"
  | "certificate"
  | "service_account"
  | "signed_request"
  | "ssh_key"
  | "username_password";

export const AUTH_METHODS: readonly AuthMethod[] = [
  "oauth2",
  "oidc",
  "api_key",
  "mutual_tls",
  "certificate",
  "service_account",
  "signed_request",
  "ssh_key",
  "username_password",
] as const;

export interface Connector {
  id: ConnectorId;
  name: string;
  version: string;
  provider: string;
  integrationTypes: IntegrationType[];
  capabilities: string[];
  /** Authentication methods supported (Section L). */
  authMethods: AuthMethod[];
  schemas: string[];
  endpoints: string[];
  events: string[];
  transformations: string[];
  /** Default rate limit per minute (Section AI). */
  rateLimitPerMinute: number;
  retryBehavior: string;
  /** Minimum CoreGrid version compatibility. */
  compatibleCoreGridVersion: string;
  lifecycleState: ConnectorLifecycleState;
  createdAt: string;
}

export function createConnector(input: {
  id: ConnectorId;
  name: string;
  version: string;
  provider: string;
  integrationTypes?: IntegrationType[];
  capabilities?: string[];
  authMethods?: AuthMethod[];
  schemas?: string[];
  endpoints?: string[];
  events?: string[];
  transformations?: string[];
  rateLimitPerMinute?: number;
  retryBehavior?: string;
  compatibleCoreGridVersion?: string;
  lifecycleState?: ConnectorLifecycleState;
  now?: string;
}): { ok: true; connector: Connector } | { ok: false; error: string } {
  if (!input.name.trim()) {
    return { ok: false, error: "Connector name is required" };
  }
  if (!input.version.trim()) {
    return { ok: false, error: "Connector version is required" };
  }
  if (!input.provider.trim()) {
    return { ok: false, error: "Connector provider is required" };
  }
  return {
    ok: true,
    connector: {
      id: input.id,
      name: input.name,
      version: input.version,
      provider: input.provider,
      integrationTypes: input.integrationTypes ?? ["rest"],
      capabilities: input.capabilities ?? [],
      authMethods: input.authMethods ?? [],
      schemas: input.schemas ?? [],
      endpoints: input.endpoints ?? [],
      events: input.events ?? [],
      transformations: input.transformations ?? [],
      rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
      retryBehavior: input.retryBehavior ?? "exponential_backoff",
      compatibleCoreGridVersion: input.compatibleCoreGridVersion ?? "",
      lifecycleState: input.lifecycleState ?? "draft",
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/** Section I: connector lifecycle advances one stage at a time. */
export function canTransitionConnector(
  current: ConnectorLifecycleState,
  next: ConnectorLifecycleState,
): boolean {
  return CONNECTOR_ORDER[next] === CONNECTOR_ORDER[current] + 1;
}

/* ─────────────────────────────────────────────────────────────
 * Integration instance (Section J) + connection (K)
 * ────────────────────────────────────────────────────────────*/

export type ConnectionState =
  "provisioning" | "connected" | "validating" | "suspended" | "failed" | "deleted";

export const CONNECTION_STATES: readonly ConnectionState[] = [
  "provisioning",
  "connected",
  "validating",
  "suspended",
  "failed",
  "deleted",
] as const;

export interface Integration {
  id: IntegrationId;
  tenantId: TenantId;
  connectorRef: ConnectorId;
  name: string;
  /** Campus/school/branch/department scope (Section Q). Empty = tenant-wide. */
  scopeRefs: string[];
  /** Connection ref (each instance isolates credentials and config, Section J). */
  connectionRef: ConnectionId | null;
  /** Explicit authorization capabilities (Section N): read/write/execute/subscribe/publish. */
  permissions: Array<"read" | "write" | "execute" | "subscribe" | "publish">;
  /** Owner identity ref (Section CU). */
  ownerRef: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function createIntegration(input: {
  id: IntegrationId;
  tenantId: TenantId;
  connectorRef: ConnectorId;
  name: string;
  scopeRefs?: string[];
  permissions?: Integration["permissions"];
  ownerRef: string;
  now?: string;
}): { ok: true; integration: Integration } | { ok: false; error: string } {
  if (!input.name.trim()) {
    return { ok: false, error: "Integration name is required" };
  }
  if (!input.ownerRef.trim()) {
    return { ok: false, error: "Integration requires an owner (Section CU)" };
  }
  return {
    ok: true,
    integration: {
      id: input.id,
      tenantId: input.tenantId,
      connectorRef: input.connectorRef,
      name: input.name.trim(),
      scopeRefs: input.scopeRefs ?? [],
      connectionRef: null,
      permissions: input.permissions ?? ["read"],
      ownerRef: input.ownerRef,
      isActive: false,
      createdAt: input.now ?? timeAuthority.now().at,
      updatedAt: input.now ?? timeAuthority.now().at,
    },
  };
}

export interface Connection {
  id: ConnectionId;
  tenantId: TenantId;
  integrationRef: IntegrationId;
  /** Provider account label (Section R multi-account). */
  accountLabel: string;
  state: ConnectionState;
  /** Credential reference — never the secret (Section L). */
  credentialRef: CredentialReferenceId | null;
  lastValidatedAt: string | null;
  createdAt: string;
}

export function createConnection(input: {
  id: ConnectionId;
  tenantId: TenantId;
  integrationRef: IntegrationId;
  accountLabel: string;
  now?: string;
}): Connection {
  return {
    id: input.id,
    tenantId: input.tenantId,
    integrationRef: input.integrationRef,
    accountLabel: input.accountLabel,
    state: "provisioning",
    credentialRef: null,
    lastValidatedAt: null,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Credential reference + rotation (Sections L, M)
 * ────────────────────────────────────────────────────────────*/

export interface CredentialReference {
  id: CredentialReferenceId;
  tenantId: TenantId;
  connectionRef: ConnectionId;
  authMethod: AuthMethod;
  /** Secret reference only — never the secret (Section L). */
  secretRef: string;
  /** Expiry for rotation (Section M). */
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function createCredentialReference(input: {
  id: CredentialReferenceId;
  tenantId: TenantId;
  connectionRef: ConnectionId;
  authMethod: AuthMethod;
  secretRef: string;
  expiresAt?: string | null;
  now?: string;
}): { ok: true; credential: CredentialReference } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (!input.secretRef.trim()) {
    return { ok: false, error: "Credential reference requires a secret reference (Section L)" };
  }
  if (input.expiresAt && input.expiresAt <= now) {
    return { ok: false, error: "Credential expiry must be in the future" };
  }
  return {
    ok: true,
    credential: {
      id: input.id,
      tenantId: input.tenantId,
      connectionRef: input.connectionRef,
      authMethod: input.authMethod,
      secretRef: input.secretRef,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      createdAt: now,
    },
  };
}

/** Section M: credential rotation — a credential is due when expired or revoked. */
export function isCredentialValid(
  credential: CredentialReference,
  now: string = timeAuthority.now().at,
): boolean {
  if (credential.revokedAt !== null) return false;
  if (credential.expiresAt !== null && credential.expiresAt <= now) return false;
  return true;
}

/**
 * Section P tenant isolation: integration credentials must never accidentally
 * cross tenants.
 */
export function isCredentialTenantIsolated(
  credential: CredentialReference,
  tenantId: TenantId,
): boolean {
  return credential.tenantId === tenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Authorization (N) + least privilege (O)
 * ────────────────────────────────────────────────────────────*/

export type IntegrationPermission = "read" | "write" | "execute" | "subscribe" | "publish";

export const INTEGRATION_PERMISSIONS: readonly IntegrationPermission[] = [
  "read",
  "write",
  "execute",
  "subscribe",
  "publish",
] as const;

/**
 * Least privilege (Section O): an integration must receive only the external
 * permissions required for its declared functionality.
 */
export function isLeastPrivilegeSatisfied(
  requested: IntegrationPermission[],
  declaredNeeds: IntegrationPermission[],
): boolean {
  return requested.every((p) => declaredNeeds.includes(p));
}
