/**
 * CoreGrid — per-agent credential broker & emergency lockdown
 * (J-007 / J-010, V1CAP-017 / V1CAP-019, MISSION-R-82, wave 2).
 *
 * G-033 / G-034 blast-radius containment for a platform with autonomous
 * workers. The law of this module:
 *
 * - NO universal master credential may ever exist. Secrets live in a vault
 *   (DB-backed later; `InMemoryCredentialVault` is the in-process V1
 *   reference, same interface, same semantics). Nothing in this module —
 *   lease, handle, audit event, decision result — ever carries raw secret
 *   material.
 * - Agents/workers NEVER receive raw credentials. They receive scoped LEASES
 *   on NAMED credentials: agent identity + credential ref + purpose + TTL +
 *   usage budget. A lease handle is an opaque, branded, redacted object; the
 *   only way to obtain the secret is `resolveLease` through the broker, which
 *   re-checks identity, purpose, TTL, budget, revocation and rotation state
 *   on EVERY use (fail closed).
 * - Authority is an intersection, checked at grant time against the worker's
 *   declared capability set + authority bounds (the persistent definition is
 *   owned by `workforce/worker-definition.ts`). The broker consumes a LOCAL
 *   structural view of that authority (see `CredentialSubjectAuthority`) —
 *   deliberately not an import of the workforce module: the workforce layer
 *   consumes the broker, so importing it here would invert the dependency
 *   direction. Wiring: a `WorkerRuntimeClaim` maps 1:1 onto the view
 *   (identityRef, tenantRef, effectiveCapabilities, effectiveResourceScopes,
 *   effectiveMaxRiskClass) and `isUsable` is the identity-lifecycle usable
 *   predicate (`isIdentityUsable`) applied to the definition lifecycle.
 * - Rotation: rotating a credential invalidates ALL outstanding leases on the
 *   old version immediately — no lease survives past the version it was
 *   granted against.
 * - Emergency lockdown (J-010 / G-034): a BOUNDED kill-switch. It requires an
 *   explicitly authorized revoker identity, cannot be invoked by the agent it
 *   locks out, revokes ALL outstanding leases for the target agent/tenant,
 *   blocks further grants while active, and records itself as evidence-bearing
 *   audit material. Every lockdown invocation — granted or denied — is
 *   audited: there is no unlogged lockdown.
 * - Every grant, use, revocation, rotation and lockdown flows through an
 *   append-only audit sink (in-memory here; DB-backed later).
 *
 * Pure in-process implementation: time is supplied by the caller, nothing
 * runs implicitly, nothing is persisted, no I/O. All checks FAIL CLOSED.
 */

import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "../agent-core";

/* ─────────────────────────────────────────────────────────────
 * Branded secret / handle types (non-observability by construction)
 * ────────────────────────────────────────────────────────────*/

const RAW_SECRET_BRAND: unique symbol = Symbol("coregrid-raw-secret");

/**
 * A raw secret value. Branded so it cannot flow into any handle, audit event
 * or redacted view by construction: no structural type that lacks the brand
 * accepts it, and this module never places it in an exported object.
 */
export type RawSecretValue = string & { readonly [RAW_SECRET_BRAND]: "coregrid-raw-secret" };

/** Explicit opt-in constructor for vault implementations. */
export function rawSecret(value: string): RawSecretValue {
  return value as RawSecretValue;
}

const LEASE_HANDLE_BRAND: unique symbol = Symbol("coregrid-credential-lease");

/**
 * The ONLY credential-shaped object an agent/worker ever receives. It carries
 * the lease reference and its bounds — never secret material. The brand makes
 * the type non-constructible from unshaped literals; the runtime guard
 * (`guardLeaseHandleSerialization`) proves serialization stays redacted.
 */
export interface CredentialLeaseHandle {
  readonly [LEASE_HANDLE_BRAND]: "coregrid-credential-lease";
  readonly leaseId: string;
  readonly credentialRef: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

/* ─────────────────────────────────────────────────────────────
 * Vault interface (DB-backed later; in-memory reference below)
 * ────────────────────────────────────────────────────────────*/

export interface CredentialVault {
  /** Fail-closed existence check: is there a vault entry for this ref? */
  hasEntry(credentialRef: string): boolean;
  /** Current version of the entry, or null when absent. */
  currentVersion(credentialRef: string): number | null;
  /** Versioned read; null when the version does not (yet) exist. */
  read(credentialRef: string, version: number): RawSecretValue | null;
  /** Append a new version; returns the new version number. */
  rotate(credentialRef: string, nextSecret: RawSecretValue): number;
  /**
   * Non-observability probe for the runtime guard: does the given serialized
   * text contain live secret material? The vault answers WITHOUT exposing
   * its values.
   */
  exposesSecret(serialized: string): boolean;
}

/**
 * In-process reference vault (V1). Secrets are held only inside this object;
 * no accessor returns them. A DB-backed vault implements the same interface.
 */
export class InMemoryCredentialVault implements CredentialVault {
  private readonly entries = new Map<string, RawSecretValue[]>();

  constructor(entries?: Readonly<Record<string, RawSecretValue>>) {
    if (entries !== undefined) {
      for (const [credentialRef, secret] of Object.entries(entries)) {
        if (credentialRef.trim().length === 0 || secret.length === 0) {
          throw new Error("credential_vault_invalid_entry");
        }
        this.entries.set(credentialRef, [secret]);
      }
    }
  }

  hasEntry(credentialRef: string): boolean {
    return this.entries.has(credentialRef);
  }

  currentVersion(credentialRef: string): number | null {
    const versions = this.entries.get(credentialRef);
    if (versions === undefined || versions.length === 0) return null;
    return versions.length;
  }

  read(credentialRef: string, version: number): RawSecretValue | null {
    const versions = this.entries.get(credentialRef);
    if (versions === undefined) return null;
    if (!Number.isInteger(version) || version < 1 || version > versions.length) return null;
    return versions[version - 1] ?? null;
  }

  rotate(credentialRef: string, nextSecret: RawSecretValue): number {
    if (nextSecret.length === 0) throw new Error("credential_vault_empty_secret");
    const versions = this.entries.get(credentialRef);
    if (versions === undefined) {
      this.entries.set(credentialRef, [nextSecret]);
      return 1;
    }
    versions.push(nextSecret);
    return versions.length;
  }

  exposesSecret(serialized: string): boolean {
    for (const versions of this.entries.values()) {
      for (const secret of versions) {
        if (secret.length > 0 && serialized.includes(secret)) return true;
      }
    }
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Authority view (local contract; wired from workforce definitions)
 * ────────────────────────────────────────────────────────────*/

/**
 * Local structural view of a governed worker's authority, mirroring
 * `WorkerDefinition` / `WorkerAuthorityBounds` (workforce/worker-definition.ts)
 * and the bounded authority a `WorkerRuntimeClaim` computes from them.
 * Defined locally on purpose — see the module header wiring note.
 */
export interface CredentialSubjectAuthority {
  /** The worker's cg_identity reference — the worker IS an identity. */
  readonly identityRef: string;
  /** Tenant scope of the worker (multi-tenancy law: never null). */
  readonly tenantScope: string;
  /** Declared capability ids (delegated ∩ owned set, per the claim contract). */
  readonly declaredCapabilities: readonly string[];
  /** Resource scopes inside the definition's authority bounds. */
  readonly resourceScopes: readonly string[];
  /** Risk ceiling of the worker (delegated, ≤ definition ceiling). */
  readonly maxRiskClass: AgentRiskClassification;
  /**
   * Lifecycle usability of the worker, resolved by the caller through the
   * shared identity-lifecycle predicate (`isIdentityUsable`). A suspended,
   * archived or deleted worker can never hold a lease.
   */
  readonly isUsable: boolean;
}

/** One brokered, named credential: what it opens and what it costs in authority. */
export interface BrokeredCredentialPolicy {
  credentialRef: string;
  /** Tenant the credential belongs to; cross-tenant leasing is denied. */
  tenantRef: string;
  /** The single resource scope the credential grants access to. */
  resourceScope: string;
  /** Capability ids an agent must hold (⊆ its declared set) to be granted. */
  requiredCapabilities: readonly string[];
  /** Risk class of using the credential; must be ≤ the subject's ceiling. */
  riskClass: AgentRiskClassification;
  /** Optional per-credential TTL cap tighter than the broker bound. */
  maxLeaseTtlMs: number | null;
}

export type BrokeredCredentialPolicyResult =
  | { ok: true }
  | { ok: false; errors: readonly string[] };

/* ─────────────────────────────────────────────────────────────
 * Audit events (append-only; never carry secret material)
 * ────────────────────────────────────────────────────────────*/

/** `identity:<ref>` or `tenant:<ref>` — a redacted lockdown target descriptor. */
export type LockdownTargetDescriptor = string;

export type CredentialAuditEvent =
  | {
      kind: "LEASE_GRANTED";
      atMs: number;
      leaseId: string;
      credentialRef: string;
      identityRef: string;
      tenantRef: string;
      purpose: string;
      expiresAtMs: number;
      maxUses: number;
      credentialVersion: number;
    }
  | {
      kind: "LEASE_DENIED";
      atMs: number;
      credentialRef: string;
      identityRef: string;
      tenantRef: string;
      purpose: string;
      reason: string;
    }
  | {
      kind: "LEASE_USED";
      atMs: number;
      leaseId: string;
      credentialRef: string;
      identityRef: string;
      usesUsed: number;
      usesRemaining: number;
    }
  | {
      kind: "USE_DENIED";
      atMs: number;
      leaseId: string;
      credentialRef: string;
      identityRef: string;
      reason: string;
    }
  | {
      kind: "LEASE_REVOKED";
      atMs: number;
      leaseId: string;
      credentialRef: string;
      identityRef: string;
      revokedReason: string;
    }
  | {
      kind: "CREDENTIAL_ROTATED";
      atMs: number;
      credentialRef: string;
      newVersion: number;
      leasesInvalidated: number;
    }
  | {
      kind: "LOCKDOWN_DENIED";
      atMs: number;
      revokerIdentityRef: string;
      target: LockdownTargetDescriptor | null;
      reason: string;
      denyReason: string;
    }
  | {
      kind: "LOCKDOWN_EXECUTED";
      atMs: number;
      revokerIdentityRef: string;
      target: LockdownTargetDescriptor;
      reason: string;
      evidenceRef: string;
      leasesRevoked: number;
    }
  | {
      kind: "LOCKDOWN_LIFT_DENIED";
      atMs: number;
      revokerIdentityRef: string;
      target: LockdownTargetDescriptor | null;
      reason: string;
      denyReason: string;
    }
  | {
      kind: "LOCKDOWN_LIFTED";
      atMs: number;
      revokerIdentityRef: string;
      target: LockdownTargetDescriptor;
      reason: string;
    };

export interface CredentialAuditSink {
  append(event: CredentialAuditEvent): void;
}

/** In-memory append-only audit sink (V1 reference; DB-backed later). */
export class InMemoryCredentialAuditSink implements CredentialAuditSink {
  private readonly events: CredentialAuditEvent[] = [];

  append(event: CredentialAuditEvent): void {
    this.events.push(event);
  }

  /** Read-only view; no mutation or deletion path exists. */
  list(): readonly CredentialAuditEvent[] {
    return this.events;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Broker
 * ────────────────────────────────────────────────────────────*/

export interface CredentialBrokerConfig {
  /** Upper bound on any lease TTL in ms. */
  maxLeaseTtlMs: number;
  /**
   * Identity refs authorized to invoke emergency lockdown / lift. Agents are
   * never on this list — authorization is an explicit, declared allowlist,
   * not a role the caller can claim.
   */
  authorizedRevokers: readonly string[];
  vault: CredentialVault;
  /** Defaults to an in-memory sink; DB-backed sink injectable. */
  auditSink?: CredentialAuditSink;
}

export interface CredentialLeaseRequest {
  subject: CredentialSubjectAuthority;
  credentialRef: string;
  /** Declared purpose; every later use must present exactly this purpose. */
  purpose: string;
  ttlMs: number;
  /** Usage budget: number of resolveLease uses the lease permits. */
  maxUses: number;
  nowMs: number;
}

export type CredentialGrantResult =
  | { ok: true; handle: CredentialLeaseHandle }
  | { ok: false; reason: string };

export interface CredentialResolveInput {
  handle: CredentialLeaseHandle;
  /** The presenting agent's identity — stolen handles fail here. */
  identityRef: string;
  purpose: string;
  nowMs: number;
}

export type CredentialResolveResult =
  | { ok: true; secret: RawSecretValue }
  | { ok: false; reason: string };

export interface CredentialRevokeInput {
  handle: CredentialLeaseHandle;
  reason: string;
  nowMs: number;
}

export type CredentialRevokeResult = { ok: true } | { ok: false; reason: string };

export interface CredentialRotateInput {
  credentialRef: string;
  nextSecret: RawSecretValue;
  nowMs: number;
}

export type CredentialRotateResult =
  | { ok: true; version: number; leasesInvalidated: number }
  | { ok: false; reason: string };

export interface EmergencyLockdownInput {
  /** The authorized revoker identity (must be in `authorizedRevokers`). */
  revokerIdentityRef: string;
  /** At least one of identityRef / tenantRef. */
  target: { identityRef?: string; tenantRef?: string };
  /** Evidence-bearing reason; required and audited verbatim. */
  reason: string;
  nowMs: number;
}

export type EmergencyLockdownResult =
  | { ok: true; evidenceRef: string; leasesRevoked: number }
  | { ok: false; reason: string };

export type LockdownLiftResult = { ok: true } | { ok: false; reason: string };

export interface CredentialLeaseView {
  leaseId: string;
  credentialRef: string;
  purpose: string;
  identityRef: string;
  issuedAtMs: number;
  expiresAtMs: number;
  usesUsed: number;
  maxUses: number;
  revoked: boolean;
  revokedReason: string | null;
  status: "active" | "expired" | "revoked" | "exhausted";
}

/** Risk-class ordering for bound enforcement (low is weakest). */
const RISK_CLASS_RANK: Readonly<Record<AgentRiskClassification, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const AGENT_RISK_CLASSIFICATION_SET: ReadonlySet<string> = new Set<string>(
  AGENT_RISK_CLASSIFICATIONS,
);

function isNonEmptyTrimmed(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

interface LeaseRecord {
  leaseId: string;
  credentialRef: string;
  identityRef: string;
  tenantRef: string;
  purpose: string;
  credentialVersion: number;
  issuedAtMs: number;
  expiresAtMs: number;
  maxUses: number;
  usesUsed: number;
  revoked: boolean;
  revokedReason: string | null;
}

function lockdownTargetDescriptor(target: { identityRef?: string; tenantRef?: string }): string {
  if (target.identityRef !== undefined) return `identity:${target.identityRef}`;
  return `tenant:${target.tenantRef ?? ""}`;
}

export class CredentialBroker {
  private readonly config: CredentialBrokerConfig;
  private readonly vault: CredentialVault;
  private readonly audit: CredentialAuditSink;
  private readonly policies = new Map<string, BrokeredCredentialPolicy>();
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly lockedDownIdentities = new Set<string>();
  private readonly lockedDownTenants = new Set<string>();
  private leaseSequence = 0;

  constructor(config: CredentialBrokerConfig) {
    if (!Number.isFinite(config.maxLeaseTtlMs) || config.maxLeaseTtlMs <= 0) {
      throw new Error("credential_broker_invalid_max_lease_ttl");
    }
    if (!Array.isArray(config.authorizedRevokers)) {
      throw new Error("credential_broker_invalid_authorized_revokers");
    }
    this.config = config;
    this.vault = config.vault;
    this.audit = config.auditSink ?? new InMemoryCredentialAuditSink();
  }

  /** Read-only audit access for operators/verifiers (no secret material). */
  auditLog(): readonly CredentialAuditEvent[] {
    if (this.audit instanceof InMemoryCredentialAuditSink) {
      return this.audit.list();
    }
    throw new Error("credential_broker_audit_sink_not_inspectable");
  }

  /**
   * Declare a brokered credential policy. Fail-closed validation: an invalid
   * policy is rejected, never partially registered.
   */
  registerCredentialPolicy(policy: BrokeredCredentialPolicy): BrokeredCredentialPolicyResult {
    const errors: string[] = [];
    if (!isNonEmptyTrimmed(policy.credentialRef, 200)) {
      errors.push("credentialRef must be 1–200 characters");
    }
    if (!isNonEmptyTrimmed(policy.tenantRef, 128)) {
      errors.push("tenantRef must be 1–128 characters");
    }
    if (!isNonEmptyTrimmed(policy.resourceScope, 200)) {
      errors.push("resourceScope must be 1–200 characters");
    }
    if (
      !Array.isArray(policy.requiredCapabilities) ||
      policy.requiredCapabilities.some((c) => !isNonEmptyTrimmed(c, 160))
    ) {
      errors.push("requiredCapabilities must be an array of non-empty strings");
    }
    if (!(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(policy.riskClass)) {
      errors.push("riskClass must be in the agent risk vocabulary");
    }
    if (
      policy.maxLeaseTtlMs !== null &&
      (!Number.isFinite(policy.maxLeaseTtlMs) || policy.maxLeaseTtlMs <= 0)
    ) {
      errors.push("maxLeaseTtlMs must be null or a positive finite number");
    }
    if (errors.length > 0) return { ok: false, errors };
    this.policies.set(policy.credentialRef.trim(), policy);
    return { ok: true };
  }

  /**
   * Grant a scoped lease. Authorization is an intersection, fail closed:
   * usable lifecycle ∧ brokered credential ∧ present vault entry ∧ not
   * locked down ∧ same tenant ∧ capabilities ⊆ declared ∧ risk ≤ ceiling ∧
   * resource scope ∈ bounds ∧ TTL within bounds.
   */
  grant(request: CredentialLeaseRequest): CredentialGrantResult {
    const subject = request.subject;
    const base = {
      atMs: request.nowMs,
      credentialRef: request.credentialRef,
      identityRef: subject.identityRef,
      tenantRef: subject.tenantScope,
      purpose: request.purpose,
    };
    const deny = (reason: string): CredentialGrantResult => {
      this.audit.append({ kind: "LEASE_DENIED", ...base, reason });
      return { ok: false, reason };
    };

    if (
      !isNonEmptyTrimmed(subject.identityRef, 200) ||
      !isNonEmptyTrimmed(subject.tenantScope, 128)
    ) {
      return deny("invalid_subject_identity");
    }
    if (!isNonEmptyTrimmed(request.purpose, 300)) {
      return deny("invalid_purpose");
    }
    if (!Number.isFinite(request.nowMs)) {
      return deny("invalid_now");
    }
    if (!Number.isFinite(request.ttlMs) || request.ttlMs <= 0) {
      return deny("invalid_ttl");
    }
    if (request.ttlMs > this.config.maxLeaseTtlMs) {
      return deny("ttl_exceeds_broker_bound");
    }
    if (!isPositiveInt(request.maxUses)) {
      return deny("invalid_usage_budget");
    }
    if (subject.isUsable !== true) {
      return deny("subject_lifecycle_unusable");
    }

    const policy = this.policies.get(request.credentialRef.trim());
    if (policy === undefined) {
      return deny("credential_not_brokered");
    }

    // Fail closed on missing vault entries: a policy without a provisioned
    // vault entry grants NOTHING, even for a fully authorized subject.
    if (!this.vault.hasEntry(policy.credentialRef)) {
      return deny("vault_entry_missing");
    }

    if (this.lockedDownIdentities.has(subject.identityRef)) {
      return deny("identity_locked_down");
    }
    if (this.lockedDownTenants.has(subject.tenantScope)) {
      return deny("tenant_locked_down");
    }

    if (policy.tenantRef !== subject.tenantScope) {
      return deny("cross_tenant_credential_denied");
    }
    const declared = new Set<string>(subject.declaredCapabilities);
    for (const capabilityId of policy.requiredCapabilities) {
      if (!declared.has(capabilityId)) {
        return deny(`capability_escalation_denied:${capabilityId}_not_declared`);
      }
    }
    if (
      RISK_CLASS_RANK[policy.riskClass] >
      RISK_CLASS_RANK[subject.maxRiskClass]
    ) {
      return deny(
        `risk_class_escalation_denied:${policy.riskClass}_above_${subject.maxRiskClass}`,
      );
    }
    if (!(subject.resourceScopes as readonly string[]).includes(policy.resourceScope)) {
      return deny(`resource_scope_escalation_denied:${policy.resourceScope}_outside_bounds`);
    }
    if (policy.maxLeaseTtlMs !== null && request.ttlMs > policy.maxLeaseTtlMs) {
      return deny("ttl_exceeds_credential_bound");
    }

    const version = this.vault.currentVersion(policy.credentialRef);
    if (version === null) {
      // Defense in depth: re-check after the entry probe (rotation races).
      return deny("vault_entry_missing");
    }

    this.leaseSequence += 1;
    const leaseId = `lease:${policy.credentialRef}:${this.leaseSequence}`;
    const record: LeaseRecord = {
      leaseId,
      credentialRef: policy.credentialRef,
      identityRef: subject.identityRef,
      tenantRef: subject.tenantScope,
      purpose: request.purpose,
      credentialVersion: version,
      issuedAtMs: request.nowMs,
      expiresAtMs: request.nowMs + request.ttlMs,
      maxUses: request.maxUses,
      usesUsed: 0,
      revoked: false,
      revokedReason: null,
    };
    this.leases.set(leaseId, record);

    const handle: CredentialLeaseHandle = {
      [LEASE_HANDLE_BRAND]: "coregrid-credential-lease",
      leaseId,
      credentialRef: policy.credentialRef,
      issuedAtMs: record.issuedAtMs,
      expiresAtMs: record.expiresAtMs,
    };

    this.audit.append({
      kind: "LEASE_GRANTED",
      atMs: request.nowMs,
      leaseId,
      credentialRef: policy.credentialRef,
      identityRef: subject.identityRef,
      tenantRef: subject.tenantScope,
      purpose: request.purpose,
      expiresAtMs: record.expiresAtMs,
      maxUses: record.maxUses,
      credentialVersion: version,
    });

    return { ok: true, handle };
  }

  /**
   * Use a lease: the ONLY path from a handle to a secret. Re-verifies
   * identity, purpose, revocation, TTL, usage budget and rotation state on
   * every single use, then consumes one unit of the usage budget.
   */
  resolveLease(input: CredentialResolveInput): CredentialResolveResult {
    const deny = (reason: string): CredentialResolveResult => {
      this.audit.append({
        kind: "USE_DENIED",
        atMs: input.nowMs,
        leaseId: input.handle.leaseId,
        credentialRef: input.handle.credentialRef,
        identityRef: input.identityRef,
        reason,
      });
      return { ok: false, reason };
    };

    if (!isNonEmptyTrimmed(input.identityRef, 200)) {
      return deny("invalid_identity");
    }
    if (!isNonEmptyTrimmed(input.purpose, 300)) {
      return deny("invalid_purpose");
    }
    if (!Number.isFinite(input.nowMs)) {
      return deny("invalid_now");
    }

    const record = this.leases.get(input.handle.leaseId);
    if (record === undefined || record.credentialRef !== input.handle.credentialRef) {
      return deny("unknown_lease");
    }
    if (record.identityRef !== input.identityRef) {
      return deny("identity_mismatch");
    }
    if (record.purpose !== input.purpose) {
      return deny("purpose_mismatch");
    }
    if (record.revoked) {
      return deny(`lease_revoked:${record.revokedReason ?? "revoked"}`);
    }
    if (record.expiresAtMs <= input.nowMs) {
      return deny("lease_expired");
    }
    if (record.usesUsed >= record.maxUses) {
      return deny("usage_budget_exhausted");
    }

    const currentVersion = this.vault.currentVersion(record.credentialRef);
    if (currentVersion === null || currentVersion !== record.credentialVersion) {
      return deny("lease_invalidated_by_rotation");
    }
    const secret = this.vault.read(record.credentialRef, record.credentialVersion);
    if (secret === null) {
      // Fail closed: the vault entry vanished between checks.
      return deny("vault_entry_missing");
    }

    record.usesUsed += 1;
    this.audit.append({
      kind: "LEASE_USED",
      atMs: input.nowMs,
      leaseId: record.leaseId,
      credentialRef: record.credentialRef,
      identityRef: record.identityRef,
      usesUsed: record.usesUsed,
      usesRemaining: record.maxUses - record.usesUsed,
    });
    return { ok: true, secret };
  }

  /** Revoke a single lease (operator path). Audited. */
  revokeLease(input: CredentialRevokeInput): CredentialRevokeResult {
    const record = this.leases.get(input.handle.leaseId);
    if (record === undefined) return { ok: false, reason: "unknown_lease" };
    if (record.revoked) return { ok: false, reason: "lease_already_revoked" };
    if (!isNonEmptyTrimmed(input.reason, 300)) return { ok: false, reason: "invalid_reason" };

    record.revoked = true;
    record.revokedReason = input.reason;
    this.audit.append({
      kind: "LEASE_REVOKED",
      atMs: input.nowMs,
      leaseId: record.leaseId,
      credentialRef: record.credentialRef,
      identityRef: record.identityRef,
      revokedReason: input.reason,
    });
    return { ok: true };
  }

  /**
   * Rotate a credential. EVERY outstanding lease granted against an older
   * version is invalidated immediately — rotation is a blast-radius reset,
   * not a background update.
   */
  rotateCredential(input: CredentialRotateInput): CredentialRotateResult {
    if (!Number.isFinite(input.nowMs)) return { ok: false, reason: "invalid_now" };
    if (input.nextSecret.length === 0) return { ok: false, reason: "invalid_secret" };
    if (!this.vault.hasEntry(input.credentialRef)) {
      return { ok: false, reason: "vault_entry_missing" };
    }
    if (!this.policies.has(input.credentialRef)) {
      return { ok: false, reason: "credential_not_brokered" };
    }

    const version = this.vault.rotate(input.credentialRef, input.nextSecret);
    let invalidated = 0;
    for (const record of this.leases.values()) {
      if (record.credentialRef === input.credentialRef && !record.revoked) {
        record.revoked = true;
        record.revokedReason = "invalidated_by_rotation";
        invalidated += 1;
      }
    }
    this.audit.append({
      kind: "CREDENTIAL_ROTATED",
      atMs: input.nowMs,
      credentialRef: input.credentialRef,
      newVersion: version,
      leasesInvalidated: invalidated,
    });
    return { ok: true, version, leasesInvalidated: invalidated };
  }

  /* ─────────────────────────────────────────────────────────
   * Emergency lockdown (J-010 / G-034) — the bounded kill-switch
   * ────────────────────────────────────────────────────────*/

  /**
   * Revoke ALL outstanding leases for the target agent (or every agent in the
   * target tenant) and block further grants while the lockdown is active.
   *
   * Abuse prevention, fail closed:
   * - the revoker must be an explicitly authorized revoker identity;
   * - the revoker CANNOT be the agent being locked out;
   * - a non-empty evidence-bearing reason is mandatory;
   * - every invocation — granted OR denied — is appended to the audit sink:
   *   there is no unlogged lockdown.
   */
  emergencyLockdown(input: EmergencyLockdownInput): EmergencyLockdownResult {
    const deny = (denyReason: string): EmergencyLockdownResult => {
      this.audit.append({
        kind: "LOCKDOWN_DENIED",
        atMs: input.nowMs,
        revokerIdentityRef: input.revokerIdentityRef,
        target:
          input.target.identityRef !== undefined || input.target.tenantRef !== undefined
            ? lockdownTargetDescriptor(input.target)
            : null,
        reason: input.reason,
        denyReason,
      });
      return { ok: false, reason: denyReason };
    };

    if (!isNonEmptyTrimmed(input.revokerIdentityRef, 200)) {
      return deny("invalid_revoker");
    }
    if (!isNonEmptyTrimmed(input.reason, 500)) {
      return deny("lockdown_reason_required");
    }
    const targetIdentity = input.target.identityRef;
    const targetTenant = input.target.tenantRef;
    const hasTarget =
      (targetIdentity !== undefined && isNonEmptyTrimmed(targetIdentity, 200)) ||
      (targetTenant !== undefined && isNonEmptyTrimmed(targetTenant, 128));
    if (!hasTarget) {
      return deny("lockdown_target_required");
    }
    if (!(this.config.authorizedRevokers as readonly string[]).includes(input.revokerIdentityRef)) {
      return deny("revoker_not_authorized");
    }
    // Self-lockdown is denied: the agent being locked out can never be the
    // invoking revoker (a locked-out agent also fails the allowlist above).
    if (targetIdentity !== undefined && targetIdentity === input.revokerIdentityRef) {
      return deny("self_lockdown_denied");
    }

    let revoked = 0;
    for (const record of this.leases.values()) {
      if (record.revoked) continue;
      const matches =
        (targetIdentity !== undefined && record.identityRef === targetIdentity) ||
        (targetTenant !== undefined && record.tenantRef === targetTenant);
      if (matches) {
        record.revoked = true;
        record.revokedReason = "emergency_lockdown";
        revoked += 1;
      }
    }
    if (targetIdentity !== undefined) this.lockedDownIdentities.add(targetIdentity);
    if (targetTenant !== undefined) this.lockedDownTenants.add(targetTenant);

    this.leaseSequence += 1;
    const evidenceRef = `evidence:lockdown:${input.nowMs}:${this.leaseSequence}`;
    this.audit.append({
      kind: "LOCKDOWN_EXECUTED",
      atMs: input.nowMs,
      revokerIdentityRef: input.revokerIdentityRef,
      target: lockdownTargetDescriptor(input.target),
      reason: input.reason,
      evidenceRef,
      leasesRevoked: revoked,
    });
    return { ok: true, evidenceRef, leasesRevoked: revoked };
  }

  /**
   * Lift an active lockdown (the kill-switch is itself revocable). Same
   * authorization discipline; audited granted or denied.
   */
  liftLockdown(input: EmergencyLockdownInput): LockdownLiftResult {
    const deny = (denyReason: string): LockdownLiftResult => {
      this.audit.append({
        kind: "LOCKDOWN_LIFT_DENIED",
        atMs: input.nowMs,
        revokerIdentityRef: input.revokerIdentityRef,
        target:
          input.target.identityRef !== undefined || input.target.tenantRef !== undefined
            ? lockdownTargetDescriptor(input.target)
            : null,
        reason: input.reason,
        denyReason,
      });
      return { ok: false, reason: denyReason };
    };

    if (!isNonEmptyTrimmed(input.revokerIdentityRef, 200)) {
      return deny("invalid_revoker");
    }
    if (!isNonEmptyTrimmed(input.reason, 500)) {
      return deny("lockdown_reason_required");
    }
    if (!(this.config.authorizedRevokers as readonly string[]).includes(input.revokerIdentityRef)) {
      return deny("revoker_not_authorized");
    }
    const targetIdentity = input.target.identityRef;
    const targetTenant = input.target.tenantRef;
    const identityActive = targetIdentity !== undefined && this.lockedDownIdentities.has(targetIdentity);
    const tenantActive = targetTenant !== undefined && this.lockedDownTenants.has(targetTenant);
    if (!identityActive && !tenantActive) {
      return deny("lockdown_not_active");
    }
    if (identityActive && targetIdentity !== undefined) {
      this.lockedDownIdentities.delete(targetIdentity);
    }
    if (tenantActive && targetTenant !== undefined) {
      this.lockedDownTenants.delete(targetTenant);
    }
    this.audit.append({
      kind: "LOCKDOWN_LIFTED",
      atMs: input.nowMs,
      revokerIdentityRef: input.revokerIdentityRef,
      target: lockdownTargetDescriptor(input.target),
      reason: input.reason,
    });
    return { ok: true };
  }

  /** Is the given identity (or its tenant) currently under lockdown? */
  isLockedDown(identityRef: string, tenantRef: string): boolean {
    return this.lockedDownIdentities.has(identityRef) || this.lockedDownTenants.has(tenantRef);
  }

  /**
   * Redacted operator view of a lease. Carries no secret material by
   * construction — only bounds and status.
   */
  inspectLease(handle: CredentialLeaseHandle, nowMs: number): CredentialLeaseView | null {
    const record = this.leases.get(handle.leaseId);
    if (record === undefined) return null;
    const status: CredentialLeaseView["status"] = record.revoked
      ? "revoked"
      : record.expiresAtMs <= nowMs
        ? "expired"
        : record.usesUsed >= record.maxUses
          ? "exhausted"
          : "active";
    return {
      leaseId: record.leaseId,
      credentialRef: record.credentialRef,
      purpose: record.purpose,
      identityRef: record.identityRef,
      issuedAtMs: record.issuedAtMs,
      expiresAtMs: record.expiresAtMs,
      usesUsed: record.usesUsed,
      maxUses: record.maxUses,
      revoked: record.revoked,
      revokedReason: record.revokedReason,
      status,
    };
  }

  /**
   * Runtime guard for non-observability: serializes the handle and asks the
   * vault whether any live secret material leaked into that serialization.
   * This is the check verifiers run on every exported lease artifact.
   */
  guardLeaseHandleSerialization(handle: CredentialLeaseHandle): { ok: true } | { ok: false; reason: string } {
    let serialized: string;
    try {
      serialized = JSON.stringify(handle) ?? "";
    } catch {
      return { ok: false, reason: "handle_not_serializable" };
    }
    if (this.vault.exposesSecret(serialized)) {
      return { ok: false, reason: "handle_serialization_contains_secret_material" };
    }
    return { ok: true };
  }
}