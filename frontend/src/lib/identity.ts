/**
 * CoreGrid Identity Platform — TypeScript domain model.
 *
 * Mirrors `architecture/phase-02-identity.md`:
 * - Universal identity is not modelled as an account.
 * - Every CoreGrid actor (human, AI agent, service, device) has an attributable identity.
 * - Identity lifecycle transitions are policy-controlled.
 * - Credential metadata only; raw secrets live outside ordinary tables.
 * - Identity does not own domain business data.
 */

/* ─────────────────────────────────────────────────────────────
 * Identity kinds
 * ────────────────────────────────────────────────────────────*/

export type IdentityKind =
  | "human"
  | "institution"
  | "organization"
  | "ai_agent"
  | "service"
  | "device"
  | "digital_twin"
  | "external";

export const IDENTITY_KINDS: readonly IdentityKind[] = [
  "human",
  "institution",
  "organization",
  "ai_agent",
  "service",
  "device",
  "digital_twin",
  "external",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Lifecycle states (per G5 Identity Lifecycle Engine)
 * ────────────────────────────────────────────────────────────*/

export type IdentityLifecycleState =
  "proposed" | "review" | "provisioned" | "active" | "suspended" | "deleted" | "archived";

export const IDENTITY_LIFECYCLE_STATES: readonly IdentityLifecycleState[] = [
  "proposed",
  "review",
  "provisioned",
  "active",
  "suspended",
  "deleted",
  "archived",
] as const;

/** Allowed lifecycle transitions. Identity lifecycle transitions are policy-controlled. */
export const IDENTITY_LIFECYCLE_TRANSITIONS: Readonly<
  Record<IdentityLifecycleState, readonly IdentityLifecycleState[]>
> = {
  proposed: ["review"],
  review: ["provisioned", "deleted"],
  provisioned: ["active", "suspended", "deleted"],
  active: ["suspended", "archived", "deleted"],
  suspended: ["active", "deleted"],
  deleted: ["archived"],
  archived: [],
} as const;

export function canTransitionIdentity(
  from: IdentityLifecycleState,
  to: IdentityLifecycleState,
): boolean {
  return IDENTITY_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Verification states (per G6 Identity Verification Engine)
 * ────────────────────────────────────────────────────────────*/

export type VerificationLevel =
  "unverified" | "self_asserted" | "institutional" | "government" | "biometric";

export const VERIFICATION_LEVELS: readonly VerificationLevel[] = [
  "unverified",
  "self_asserted",
  "institutional",
  "government",
  "biometric",
] as const;

/** Verification level must never automatically imply authorization. */
export function verificationRank(level: VerificationLevel): number {
  switch (level) {
    case "unverified":
      return 0;
    case "self_asserted":
      return 1;
    case "institutional":
      return 2;
    case "government":
      return 3;
    case "biometric":
      return 4;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Canonical Identity Entity (per H2)
 * ────────────────────────────────────────────────────────────*/

export interface CoreGridIdentity {
  /** Stable UUID v7 reference (branded for type safety). */
  id: IdentityId;
  /** Which kind of entity this identity represents. */
  kind: IdentityKind;
  lifecycle: IdentityLifecycleState;
  verification: VerificationLevel;
  /** Canonical authoritative identifier within CoreGrid. */
  canonicalIdentifier: string;
  /** Institution/tenant this identity belongs to (null for platform-level identities). */
  tenantId: string | null;
  /** Display name / human-friendly label. */
  displayName: string | null;
  /** A single verified email address when present. */
  verifiedEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IdentityId = string & { readonly __brand: "IdentityId" };

export function identityId(raw: string): IdentityId {
  return raw as IdentityId;
}

/* ─────────────────────────────────────────────────────────────
 * Credential metadata (per H9 + J3)
 * — never stores raw secrets, only metadata.
 * ────────────────────────────────────────────────────────────*/

export type CredentialKind =
  | "password"
  | "api_key"
  | "certificate"
  | "token"
  | "crypto_key"
  | "device_credential"
  | "federated";

export type CredentialStatus = "active" | "expired" | "revoked" | "pending";

export interface CredentialMetadata {
  id: string;
  identityId: IdentityId;
  kind: CredentialKind;
  status: CredentialStatus;
  /** RFC 3339 timestamp. */
  issuedAt: string;
  /** RFC 3339 timestamp (nullable when no expiry). */
  expiresAt: string | null;
  lastUsedAt: string | null;
  /** Hash algorithm + fingerprint — never the secret itself. */
  fingerprint: string;
}

export const CREDENTIAL_STATUS_TRANSITIONS: Readonly<
  Record<CredentialStatus, readonly CredentialStatus[]>
> = {
  pending: ["active", "revoked"],
  active: ["expired", "revoked"],
  expired: ["active", "revoked"],
  revoked: [],
} as const;

export function canTransitionCredential(from: CredentialStatus, to: CredentialStatus): boolean {
  return CREDENTIAL_STATUS_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Session model (per G14 Session Engine)
 * ────────────────────────────────────────────────────────────*/

export type SessionStatus = "active" | "expired" | "revoked" | "terminated";

export interface IdentitySession {
  id: string;
  identityId: IdentityId;
  status: SessionStatus;
  /** RFC 3339. */
  createdAt: string;
  /** RFC 3339 — null for long-lived sessions. */
  expiresAt: string | null;
  revokeReason: string | null;
  /** Device/Session fingerprint (not the raw user-agent). */
  deviceFingerprint: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Relationship model (per F7 + G10)
 * — relationships are first-class objects.
 * ────────────────────────────────────────────────────────────*/

/**
 * The CORE relationship vocabulary — domain-neutral, closed at the platform
 * layer. Domain-specific relationship types (a runtime's own ontology) are
 * never declared here: a domain contributes them at runtime through
 * `registerDomainRelationshipTypes` (the DomainDefinition registration
 * pattern — see `domain-config/`), and they resolve through the same
 * `RELATIONSHIP_TYPES` registry once registered.
 */
export type CoreRelationshipType =
  | "member_of" // participant -> tenant / organizational unit
  | "employed_by" // workforce member -> tenant
  | "owns" // owner -> resource
  | "manages" // administrator -> resource
  | "agent_for" // AI agent -> owner
  | "linked_to" // external identity linking
  | "assigned_to" // device -> location / person
  | "delegated_to"; // delegation (party A -> delegate B)

export const CORE_RELATIONSHIP_TYPES: readonly CoreRelationshipType[] = [
  "member_of",
  "employed_by",
  "owns",
  "manages",
  "agent_for",
  "linked_to",
  "assigned_to",
  "delegated_to",
] as const;

/**
 * Domain-contributed relationship types. The core union above is closed and
 * neutral; a domain's own types enter the vocabulary ONLY through
 * `registerDomainRelationshipTypes`, which validates fail-closed (shape,
 * core-shadowing and duplicate checks) before the type resolves anywhere.
 * Direction follows RULING-4: domains contribute vocabulary; the core never
 * learns a domain term by declaration.
 */
export type DomainRelationshipType = string;

export type RelationshipType = CoreRelationshipType | DomainRelationshipType;

/**
 * Live relationship-type registry: the core types plus every type registered
 * by a domain contribution. Typed `readonly` for consumers; the registration
 * function below is the only writer.
 */
const RELATIONSHIP_TYPE_REGISTRY: RelationshipType[] = [...CORE_RELATIONSHIP_TYPES];
export const RELATIONSHIP_TYPES: readonly RelationshipType[] = RELATIONSHIP_TYPE_REGISTRY;

const RELATIONSHIP_TYPE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export type RelationshipTypeRegistrationResult =
  { ok: true; added: readonly string[] } | { ok: false; errors: readonly string[] };

/**
 * Register domain-contributed relationship types (fail-closed, atomic):
 * every name must be a well-formed domain-local name, must not shadow a core
 * type, must not duplicate an already-registered type (core or contributed),
 * and must not duplicate within the batch. Nothing is appended unless every
 * name validates.
 */
export function registerDomainRelationshipTypes(
  types: readonly string[],
): RelationshipTypeRegistrationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const type of types) {
    if (typeof type !== "string" || !RELATIONSHIP_TYPE_NAME_PATTERN.test(type)) {
      errors.push(
        `relationship type ${JSON.stringify(type)} is not a valid domain-local name (/^[a-z][a-z0-9_]*$/)`,
      );
      continue;
    }
    if ((CORE_RELATIONSHIP_TYPES as readonly string[]).includes(type)) {
      errors.push(`relationship type "${type}" shadows a core relationship type`);
      continue;
    }
    if (seen.has(type) || RELATIONSHIP_TYPE_REGISTRY.includes(type)) {
      errors.push(`relationship type "${type}" is already registered`);
      continue;
    }
    seen.add(type);
  }
  if (errors.length > 0) return { ok: false, errors };
  const added = [...seen];
  RELATIONSHIP_TYPE_REGISTRY.push(...added);
  return { ok: true, added };
}

export interface IdentityRelationship {
  id: string;
  /** Who the relationship is from. */
  subjectId: IdentityId;
  type: RelationshipType;
  /** What the subject relates to. */
  targetId: string;
  /** Optional resource scope (classId, campusId, deviceId…). */
  scope: string | null;
  /** RFC 3339. */
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Concurrency guard (per H20 optimistic concurrency). */
  version: number;
}

/* ─────────────────────────────────────────────────────────────
 * Permission model (per F6 + J4–J8)
 * — combines RBAC + ABAC + ReBAC + policy.
 * ────────────────────────────────────────────────────────────*/

/**
 * The CORE permission-resource vocabulary — domain-neutral, closed at the
 * platform layer. A domain's own resources are never declared here: domain
 * roles carry grants over domain resources through the domain contribution
 * registry (`rbac/domain-contribution.ts`), constructed with
 * `domainPermissionResource`.
 */
export type CorePermissionResource =
  | "tenant"
  | "identity"
  | "user"
  | "session"
  | "credential"
  | "device"
  | "ai_agent"
  | "service"
  | "payments"
  | "billing"
  | "analytics"
  | "audit_log"
  | "settings"
  | "communication"
  | "notification";

export const CORE_PERMISSION_RESOURCES: readonly CorePermissionResource[] = [
  "tenant",
  "identity",
  "user",
  "session",
  "credential",
  "device",
  "ai_agent",
  "service",
  "payments",
  "billing",
  "analytics",
  "audit_log",
  "settings",
  "communication",
  "notification",
] as const;

/** A domain-contributed permission resource (validated at registration, never typed into the core union). */
export type DomainPermissionResource = string & { readonly __brand: "DomainPermissionResource" };

/** Mark a string as a domain-owned permission resource at the domain boundary. */
export function domainPermissionResource(value: string): DomainPermissionResource {
  return value as DomainPermissionResource;
}

export type PermissionResource = CorePermissionResource | DomainPermissionResource;

export type PermissionAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "manage"
  | "approve"
  | "invite"
  | "suspend"
  | "restore"
  | "verify"
  | "rotate"
  | "execute"
  | "review";

export interface Permission {
  /** e.g. "tenant:identity:manage" */
  resource: PermissionResource;
  action: PermissionAction;
  /** Optional tenant scope. */
  scope: string | null;
}

export function permissionKey(p: Permission): string {
  const scope = p.scope ? `:${p.scope}` : "";
  return `${p.resource}:${p.action}${scope}`;
}

/* ─────────────────────────────────────────────────────────────
 * Authorization decision (per F5)
 * ────────────────────────────────────────────────────────────*/

export type AuthorizationDecision = "ALLOW" | "DENY" | "REDACT" | "ESCALATE" | "REQUIRE_APPROVAL";

export interface AuthorizationRequest {
  identity: Pick<CoreGridIdentity, "id" | "kind" | "lifecycle" | "tenantId">;
  permission: Permission;
  /** Relationship context used by ReBAC when needed. */
  relationships: IdentityRelationship[];
  /** ABAC attributes. */
  attributes: Record<string, string | number | boolean | null>;
}

export interface AuthorizationResult {
  decision: AuthorizationDecision;
  reason: string;
  /** When REDACT, the fields that may be returned. */
  allowedFields?: string[];
}

/* ─────────────────────────────────────────────────────────────
 * Agent identity (per F9 + G17)
 * ────────────────────────────────────────────────────────────*/

export type AgentLifecycleState =
  | "proposed"
  | "review"
  | "approved"
  | "deployed"
  | "monitored"
  | "suspended"
  | "reviewed"
  | "retired";

export const AGENT_LIFECYCLE_STATES: readonly AgentLifecycleState[] = [
  "proposed",
  "review",
  "approved",
  "deployed",
  "monitored",
  "suspended",
  "reviewed",
  "retired",
] as const;

export const AGENT_LIFECYCLE_TRANSITIONS: Readonly<
  Record<AgentLifecycleState, readonly AgentLifecycleState[]>
> = {
  proposed: ["review"],
  review: ["approved", "suspended", "retired"],
  approved: ["deployed", "suspended"],
  deployed: ["monitored", "suspended", "reviewed"],
  monitored: ["suspended", "reviewed", "retired"],
  suspended: ["reviewed", "retired"],
  reviewed: ["deployed", "retired"],
  retired: [],
} as const;

export function canTransitionAgent(from: AgentLifecycleState, to: AgentLifecycleState): boolean {
  return AGENT_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export interface AgentIdentity {
  id: IdentityId;
  /** Human/team identity that owns this agent. */
  ownerId: IdentityId;
  agentName: string;
  purpose: string;
  lifecycle: AgentLifecycleState;
  /** Capability-scoped — never unrestricted. */
  permissions: Permission[];
  /** Tenant scope (null = platform-level only). */
  tenantScope: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Service + Device identity (per F10 + F11)
 * ────────────────────────────────────────────────────────────*/

export interface ServiceIdentity {
  id: IdentityId;
  serviceName: string;
  ownerId: IdentityId;
  /** Comma-separated list of environments this service runs in. */
  environment: string[];
  permissions: Permission[];
  /** Prefer short-lived tokens over static credentials. */
  credentialPolicy: "short_lived" | "rotated" | "static_restricted";
  createdAt: string;
}

export interface DeviceIdentity {
  id: IdentityId;
  deviceName: string;
  deviceType: string;
  /** hardware ID / serial / MAC (store a fingerprint). */
  deviceFingerprint: string;
  ownerId: IdentityId | null;
  lifecycle: IdentityLifecycleState;
  lastSeenAt: string | null;
  trustScore: number; // 0..1
  createdAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Consent + Delegation (per G18 + G24)
 * ────────────────────────────────────────────────────────────*/

export interface ConsentRecord {
  id: string;
  identityId: IdentityId;
  purpose: string;
  /** Versioned consent text. */
  consentVersion: string;
  grantedAt: string;
  revokedAt: string | null;
}

export interface DelegationRecord {
  id: string;
  principalId: IdentityId;
  delegateId: IdentityId;
  permissions: Permission[];
  purpose: string;
  /** RFC 3339 — delegation must have an expiry. */
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Identity events (per F13 + G30)
 * ────────────────────────────────────────────────────────────*/

export type IdentityEventType =
  | "identity.created"
  | "identity.verified"
  | "identity.suspended"
  | "identity.restored"
  | "identity.deleted"
  | "credential.created"
  | "credential.changed"
  | "credential.revoked"
  | "permission.changed"
  | "relationship.created"
  | "relationship.revoked"
  | "session.created"
  | "session.revoked"
  | "agent.provisioned"
  | "agent.suspended"
  | "consent.granted"
  | "consent.revoked";

export interface IdentityEvent {
  id: string;
  type: IdentityEventType;
  actorId: IdentityId;
  subjectId: IdentityId;
  /** tenant context for downstream authorization-aware consumers. */
  tenantId: string | null;
  /** RFC 3339. */
  occurredAt: string;
  result: "success" | "failure" | "partial";
  correlationId: string | null;
  metadata: Record<string, unknown>;
}

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────*/

/** Invariant 02: No authorization decision may rely solely on a username or role. */
export function isIdentityUsable(id: Pick<CoreGridIdentity, "lifecycle">): boolean {
  return id.lifecycle === "active" || id.lifecycle === "provisioned";
}

/** Invariant 03: AI agents are identities and therefore must be governed. */
export function isAgentGoverned(agent: Pick<AgentIdentity, "lifecycle" | "permissions">): boolean {
  return (
    (agent.lifecycle === "deployed" || agent.lifecycle === "monitored") &&
    agent.permissions.length > 0
  );
}
