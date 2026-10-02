/**
 * CoreGrid — reliability lease & quota contract over shared resources and
 * agents (J-031 / V1CAP-055; E-058 RUNTIME leases; G-022 bounded scarce
 * computation).
 *
 * J-031: "Resource quotas and lease/concurrency control over shared
 * resources and worker execution." `command/leases.ts` owns the single-
 * resource lease PRIMITIVE (fencing tokens, no-resurrection). This module is
 * the admission CONTROL PLANE around that vocabulary: it adds the tenancy
 * dimension (every lease binds a tenant and optionally an agent), quota
 * ceilings enforced fail-closed BEFORE any lease is minted, and a FIFO
 * waiter/fairness vocabulary so a busy resource cannot be silently jumped.
 *
 * Law of this module:
 * - Every lease binds ONE principal (tenant + optional agent) to ONE target
 *   (a shared resource or an agent execution slot) for a BOUNDED TTL. There
 *   is no infinite lease: a TTL above `maxTtlMs` is rejected, and renewal is
 *   bounded by the same ceiling.
 * - Single-holder enforcement: one active lease per target. A second
 *   acquire is denied `target_held` with the current holder named.
 * - Fail-closed quota admission: a principal whose tenant or agent ceiling
 *   is not DECLARED is admitted nowhere (`quota_principal_undeclared`); a
 *   principal at its ceiling is denied `quota_exhausted` with a structured
 *   detail (scope, principal, limit, active count). Denials are audited,
 *   never silent (over-quota is a typed deny, not a slowdown).
 * - Expiry is lazy (caller-supplied time), observed exactly once, and fails
 *   CLOSED: an expired lease cannot be renewed, released, or fenced by its
 *   former holder — the expired holder cannot steal the resource back; the
 *   only path forward is a fresh acquire, which mints a new fencing token.
 * - FIFO fairness: a target with waiters cannot be acquired out of queue
 *   order (`queue_ahead`). Waiters are explicit tickets; granting to the
 *   head of the queue is an explicit call, and the grant re-runs the FULL
 *   admission path (quota included) at grant time.
 * - Clock injection follows the repo's AdapterClock pattern
 *   (`adapters/failure-policy.ts`): all time flows from the injected clock,
 *   nothing runs implicitly, no timers are set.
 *
 * Pure in-process contract: no I/O, no persistence, no vendors. The audit
 * trail is an append-only in-memory record; a DB-backed sink is injectable
 * through the event hook (same shape as AdapterPolicyEvent composition).
 */

import { systemClock, type AdapterClock } from "../adapters/failure-policy";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** What kind of shared thing is being leased. */
export type LeaseTargetKind = "resource" | "agent";

export interface LeaseTarget {
  readonly kind: LeaseTargetKind;
  readonly ref: string;
}

/**
 * WHO holds the lease. Tenancy is mandatory (multi-tenancy law: every
 * request must have tenant context); the agent dimension is optional
 * because humans and governed processes hold leases too.
 */
export interface LeasePrincipal {
  readonly tenantRef: string;
  /** The agent holding the lease; null = non-agent (human/governed) principal. */
  readonly agentRef: string | null;
}

export interface LeaseGrant {
  readonly leaseId: string;
  readonly target: LeaseTarget;
  readonly targetKey: string;
  readonly principal: LeasePrincipal;
  /** Monotonic per-target token; strictly increases across acquires. */
  readonly fencingToken: number;
  readonly ttlMs: number;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
}

/** Per-principal ceilings. A missing entry admits nothing (fail closed). */
export interface QuotaCeiling {
  /** Maximum simultaneously-active leases for this principal. */
  readonly maxActiveLeases: number;
  /** Maximum queued waiter tickets for this principal. */
  readonly maxWaiters: number;
}

export interface LeaseQuotaCeilings {
  readonly tenants: Readonly<Record<string, QuotaCeiling>>;
  readonly agents: Readonly<Record<string, QuotaCeiling>>;
}

export type LeaseQuotaDenialReason =
  | "invalid_input"
  | "ttl_exceeds_bound"
  | "target_held"
  | "queue_ahead"
  | "quota_exhausted"
  | "quota_principal_undeclared"
  | "holder_mismatch"
  | "lease_expired"
  | "unknown_lease"
  | "unknown_target"
  | "stale_fencing_token"
  | "waiter_queue_empty"
  | "waiter_not_found";

/** Structured over-quota detail carried on every quota denial. */
export interface QuotaDenialDetail {
  readonly scope: "tenant" | "agent";
  readonly principalRef: string;
  readonly limit: number;
  readonly active: number;
}

export interface LeaseAcquireRequest {
  readonly target: LeaseTarget;
  readonly principal: LeasePrincipal;
  readonly ttlMs: number;
  /** Waiter ticket this request fulfils; required when the queue is non-empty. */
  readonly waiterId?: string;
}

export interface LeaseHandleRef {
  readonly target: LeaseTarget;
  readonly leaseId: string;
  readonly fencingToken: number;
  readonly principal: LeasePrincipal;
}

export type AcquireResult =
  | { ok: true; lease: LeaseGrant }
  | {
      ok: false;
      reason: LeaseQuotaDenialReason;
      detail: string;
      heldBy: string | null;
      quota: QuotaDenialDetail | null;
    };

export type RenewResult =
  | { ok: true; lease: LeaseGrant }
  | { ok: false; reason: LeaseQuotaDenialReason; detail: string; quota: QuotaDenialDetail | null };

export type ReleaseResult =
  | { ok: true; released: true }
  | { ok: false; reason: LeaseQuotaDenialReason; detail: string; quota: QuotaDenialDetail | null };

export type FenceResult =
  | { ok: true }
  | { ok: false; reason: LeaseQuotaDenialReason; detail: string };

export interface WaiterTicket {
  readonly waiterId: string;
  readonly targetKey: string;
  readonly target: LeaseTarget;
  readonly principal: LeasePrincipal;
  readonly ttlMs: number;
  readonly enqueuedAtMs: number;
  readonly sequence: number;
}

export type EnqueueWaiterResult =
  | { ok: true; ticket: WaiterTicket }
  | { ok: false; reason: LeaseQuotaDenialReason; detail: string; quota: QuotaDenialDetail | null };

export type CancelWaiterResult =
  | { ok: true; cancelled: true }
  | { ok: false; reason: LeaseQuotaDenialReason; detail: string };

export type GrantNextWaiterResult =
  | { ok: true; lease: LeaseGrant; waiterId: string }
  | { ok: false; reason: LeaseQuotaDenialReason; detail: string; quota: QuotaDenialDetail | null };

/* ─────────────────────────────────────────────────────────────
 * Audit events (denials are never silent)
 * ────────────────────────────────────────────────────────────*/

export type LeaseQuotaAuditEvent =
  | {
      kind: "lease_granted";
      targetKey: string;
      leaseId: string;
      tenantRef: string;
      agentRef: string | null;
      fencingToken: number;
      atMs: number;
    }
  | {
      kind: "lease_denied";
      targetKey: string;
      tenantRef: string;
      agentRef: string | null;
      reason: LeaseQuotaDenialReason;
      detail: string;
      atMs: number;
    }
  | {
      kind: "lease_renewed";
      targetKey: string;
      leaseId: string;
      newExpiresAtMs: number;
      atMs: number;
    }
  | {
      kind: "lease_renewal_denied";
      targetKey: string;
      leaseId: string | null;
      tenantRef: string;
      reason: LeaseQuotaDenialReason;
      detail: string;
      atMs: number;
    }
  | {
      kind: "lease_released";
      targetKey: string;
      leaseId: string;
      atMs: number;
    }
  | {
      kind: "lease_release_denied";
      targetKey: string;
      leaseId: string | null;
      reason: LeaseQuotaDenialReason;
      detail: string;
      atMs: number;
    }
  | {
      kind: "lease_expired_observed";
      targetKey: string;
      leaseId: string;
      expiredAtMs: number;
      observedAtMs: number;
    }
  | {
      kind: "quota_denied";
      targetKey: string;
      scope: QuotaDenialDetail["scope"];
      principalRef: string;
      limit: number;
      active: number;
      detail: string;
      atMs: number;
    }
  | {
      kind: "waiter_enqueued";
      targetKey: string;
      waiterId: string;
      tenantRef: string;
      agentRef: string | null;
      queueDepth: number;
      atMs: number;
    }
  | {
      kind: "waiter_cancelled";
      targetKey: string;
      waiterId: string;
      atMs: number;
    }
  | {
      kind: "waiter_granted";
      targetKey: string;
      waiterId: string;
      leaseId: string;
      atMs: number;
    }
  | {
      kind: "waiter_denied";
      targetKey: string;
      waiterId: string;
      reason: LeaseQuotaDenialReason;
      detail: string;
      atMs: number;
    };

/* ─────────────────────────────────────────────────────────────
 * Configuration (fail fast on misconfiguration at construction)
 * ────────────────────────────────────────────────────────────*/

export interface LeaseQuotaGovernorConfig {
  /** Upper bound on any lease TTL in ms — the no-infinite-lease ceiling. */
  readonly maxTtlMs: number;
  /** Per-tenant and per-agent ceilings; an undeclared principal admits nowhere. */
  readonly quotas: LeaseQuotaCeilings;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: AdapterClock;
  /** Observability sink for grants, denials, expiries and queue transitions. */
  readonly onEvent?: (event: LeaseQuotaAuditEvent) => void;
}

function requireNonEmptyString(name: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`LeaseQuotaGovernor.${name} must be a non-empty string`);
  }
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(
      `LeaseQuotaGovernor.${name} must be a non-negative integer (received ${String(value)})`,
    );
  }
}

function validateCeiling(ownerKind: "tenant" | "agent", ref: string, ceiling: QuotaCeiling): void {
  requireNonEmptyString(`quotas.${ownerKind}s key`, ref);
  requireNonNegativeInteger(`quotas.${ownerKind}s[${ref}].maxActiveLeases`, ceiling.maxActiveLeases);
  requireNonNegativeInteger(`quotas.${ownerKind}s[${ref}].maxWaiters`, ceiling.maxWaiters);
}

function validateConfig(config: LeaseQuotaGovernorConfig): void {
  if (!Number.isFinite(config.maxTtlMs) || config.maxTtlMs <= 0) {
    throw new TypeError(
      `LeaseQuotaGovernor.maxTtlMs must be a finite positive number (received ${String(config.maxTtlMs)})`,
    );
  }
  for (const [ref, ceiling] of Object.entries(config.quotas.tenants)) {
    validateCeiling("tenant", ref, ceiling);
  }
  for (const [ref, ceiling] of Object.entries(config.quotas.agents)) {
    validateCeiling("agent", ref, ceiling);
  }
}

/* ─────────────────────────────────────────────────────────────
 * Governor
 * ────────────────────────────────────────────────────────────*/

interface TargetState {
  current: LeaseGrant | null;
  expiryObserved: boolean;
  lastFencingToken: number;
  waiters: WaiterTicket[];
  grantedTotal: number;
}

/** Human-readable holder label for `heldBy` denials. */
function holderLabel(principal: LeasePrincipal): string {
  return principal.agentRef === null ? principal.tenantRef : principal.agentRef;
}

function samePrincipal(a: LeasePrincipal, b: LeasePrincipal): boolean {
  return a.tenantRef === b.tenantRef && a.agentRef === b.agentRef;
}

export class LeaseQuotaGovernor {
  private readonly cfg: LeaseQuotaGovernorConfig;
  private readonly clock: AdapterClock;
  private readonly targets = new Map<string, TargetState>();
  private readonly auditLog: LeaseQuotaAuditEvent[] = [];
  private waiterSequence = 0;
  private deniedTotal = 0;

  constructor(config: LeaseQuotaGovernorConfig) {
    validateConfig(config);
    this.cfg = config;
    this.clock = config.clock ?? systemClock;
  }

  /* ── Admission: acquire (single holder + fairness + quota, in order) ── */

  acquire(request: LeaseAcquireRequest): AcquireResult {
    const now = this.clock.nowMs();
    const key = this.targetKey(request.target);
    const invalid = this.validateAcquireRequest(request);
    if (invalid !== null) return this.denyAcquire(request.target, request.principal, invalid.reason, invalid.detail);
    if (request.ttlMs > this.cfg.maxTtlMs) {
      return this.denyAcquire(
        request.target,
        request.principal,
        "ttl_exceeds_bound",
        `ttl ${request.ttlMs}ms exceeds the bounded maximum ${this.cfg.maxTtlMs}ms (no infinite leases)`,
      );
    }

    const state = this.state(request.target);
    this.observeExpiry(state, key, now);

    const quota = this.admitQuota(request.principal, "lease");
    if (!quota.ok) {
      return this.denyAcquire(request.target, request.principal, quota.reason, quota.detail, quota.quotaDetail);
    }

    const head = state.waiters[0] ?? null;
    if (head !== null) {
      if (request.waiterId === undefined || request.waiterId !== head.waiterId) {
        return this.denyAcquire(
          request.target,
          request.principal,
          "queue_ahead",
          "the target has waiters ahead of this request (FIFO fairness; queue a waiter and grant in order)",
        );
      }
      if (!samePrincipal(head.principal, request.principal)) {
        return this.denyAcquire(
          request.target,
          request.principal,
          "holder_mismatch",
          "the presented waiter ticket belongs to a different principal",
        );
      }
    }

    const current = state.current;
    if (current !== null && current.expiresAtMs > now) {
      return this.denyAcquire(
        request.target,
        request.principal,
        "target_held",
        `single-holder enforcement: target is held by ${holderLabel(current.principal)} until ${current.expiresAtMs}`,
        null,
        holderLabel(current.principal),
      );
    }

    // Fresh acquire (including after expiry): mint the next fencing token.
    const token = state.lastFencingToken + 1;
    const lease: LeaseGrant = {
      leaseId: `lease:${key}:${token}`,
      target: request.target,
      targetKey: key,
      principal: request.principal,
      fencingToken: token,
      ttlMs: request.ttlMs,
      acquiredAtMs: now,
      expiresAtMs: now + request.ttlMs,
    };
    state.current = lease;
    state.lastFencingToken = token;
    state.expiryObserved = false;
    state.grantedTotal += 1;
    if (head !== null && head.waiterId === request.waiterId) {
      state.waiters = state.waiters.slice(1);
    }
    this.emit({
      kind: "lease_granted",
      targetKey: key,
      leaseId: lease.leaseId,
      tenantRef: lease.principal.tenantRef,
      agentRef: lease.principal.agentRef,
      fencingToken: token,
      atMs: now,
    });
    return { ok: true, lease };
  }

  /* ── Renewal (bounded, holder-only, fail-closed after expiry) ── */

  renew(request: LeaseHandleRef & { ttlMs: number }): RenewResult {
    const now = this.clock.nowMs();
    const key = this.targetKey(request.target);
    const denial = (reason: LeaseQuotaDenialReason, detail: string): RenewResult => {
      this.deniedTotal += 1;
      this.emit({
        kind: "lease_renewal_denied",
        targetKey: key,
        leaseId: request.leaseId,
        tenantRef: request.principal.tenantRef,
        reason,
        detail,
        atMs: now,
      });
      return { ok: false, reason, detail, quota: null };
    };
    if (!Number.isFinite(request.ttlMs) || request.ttlMs <= 0) {
      return denial("invalid_input", "ttlMs must be a finite positive number");
    }
    if (request.ttlMs > this.cfg.maxTtlMs) {
      return denial(
        "ttl_exceeds_bound",
        `renewal ttl ${request.ttlMs}ms exceeds the bounded maximum ${this.cfg.maxTtlMs}ms (no infinite leases)`,
      );
    }
    const state = this.targets.get(key);
    const current = state?.current ?? null;
    if (state === undefined || current === null || current.leaseId !== request.leaseId) {
      return denial("unknown_lease", "no active lease matches this handle on the target");
    }
    if (current.fencingToken !== request.fencingToken) {
      return denial("stale_fencing_token", "the presented fencing token is not the current one");
    }
    if (!samePrincipal(current.principal, request.principal)) {
      return denial("holder_mismatch", "renewal is holder-only; this handle names a different principal");
    }
    if (current.expiresAtMs <= now) {
      return denial(
        "lease_expired",
        "the lease has expired and fails closed: renewal cannot resurrect it; acquire fresh",
      );
    }
    const renewed: LeaseGrant = { ...current, expiresAtMs: now + request.ttlMs, ttlMs: request.ttlMs };
    state.current = renewed;
    this.emit({
      kind: "lease_renewed",
      targetKey: key,
      leaseId: renewed.leaseId,
      newExpiresAtMs: renewed.expiresAtMs,
      atMs: now,
    });
    return { ok: true, lease: renewed };
  }

  /* ── Release (holder-only; frees quota and unblocks the queue head) ── */

  release(request: LeaseHandleRef): ReleaseResult {
    const now = this.clock.nowMs();
    const key = this.targetKey(request.target);
    const denial = (reason: LeaseQuotaDenialReason, detail: string): ReleaseResult => {
      this.deniedTotal += 1;
      this.emit({
        kind: "lease_release_denied",
        targetKey: key,
        leaseId: request.leaseId,
        reason,
        detail,
        atMs: now,
      });
      return { ok: false, reason, detail, quota: null };
    };
    const state = this.targets.get(key);
    const current = state?.current ?? null;
    if (state === undefined || current === null || current.leaseId !== request.leaseId) {
      return denial("unknown_lease", "no active lease matches this handle on the target");
    }
    if (current.fencingToken !== request.fencingToken) {
      return denial("stale_fencing_token", "the presented fencing token is not the current one");
    }
    if (!samePrincipal(current.principal, request.principal)) {
      return denial("holder_mismatch", "release is holder-only; this handle names a different principal");
    }
    if (current.expiresAtMs <= now) {
      return denial(
        "lease_expired",
        "the lease has expired and fails closed: it cannot be released by its former holder",
      );
    }
    state.current = null;
    this.emit({ kind: "lease_released", targetKey: key, leaseId: current.leaseId, atMs: now });
    return { ok: true, released: true };
  }

  /* ── Fencing (the gate a shared-resource writer must pass) ── */

  assertFencingToken(request: LeaseHandleRef): FenceResult {
    const now = this.clock.nowMs();
    const key = this.targetKey(request.target);
    const state = this.targets.get(key);
    const current = state?.current ?? null;
    if (state === undefined || current === null) {
      return { ok: false, reason: "unknown_lease", detail: "no active lease on the target" };
    }
    // The token is the authority: below the current token is stale no matter
    // who presents it; above it names no lease at all.
    if (request.fencingToken < current.fencingToken) {
      return {
        ok: false,
        reason: "stale_fencing_token",
        detail: `token ${request.fencingToken} is below the current token ${current.fencingToken}`,
      };
    }
    if (request.fencingToken > current.fencingToken) {
      return { ok: false, reason: "unknown_lease", detail: "no lease exists for the presented token" };
    }
    if (!samePrincipal(current.principal, request.principal)) {
      return { ok: false, reason: "holder_mismatch", detail: "the token belongs to a different principal" };
    }
    if (current.expiresAtMs <= now) {
      return {
        ok: false,
        reason: "lease_expired",
        detail: "the lease has expired: fence checks fail closed for the former holder",
      };
    }
    return { ok: true };
  }

  /* ── Waiters (FIFO fairness vocabulary) ── */

  enqueueWaiter(request: {
    target: LeaseTarget;
    principal: LeasePrincipal;
    ttlMs: number;
  }): EnqueueWaiterResult {
    const now = this.clock.nowMs();
    const key = this.targetKey(request.target);
    const invalid = this.validateAcquireRequest(request);
    if (invalid !== null) {
      this.deniedTotal += 1;
      return { ok: false, reason: invalid.reason, detail: invalid.detail, quota: null };
    }
    if (request.ttlMs > this.cfg.maxTtlMs) {
      this.deniedTotal += 1;
      return {
        ok: false,
        reason: "ttl_exceeds_bound",
        detail: `waiter ttl ${request.ttlMs}ms exceeds the bounded maximum ${this.cfg.maxTtlMs}ms`,
        quota: null,
      };
    }
    const quota = this.admitQuota(request.principal, "waiter");
    if (!quota.ok) {
      this.deniedTotal += 1;
      return { ok: false, reason: quota.reason, detail: quota.detail, quota: quota.quotaDetail };
    }
    this.waiterSequence += 1;
    const ticket: WaiterTicket = {
      waiterId: `waiter:${key}:${this.waiterSequence}`,
      targetKey: key,
      target: request.target,
      principal: request.principal,
      ttlMs: request.ttlMs,
      enqueuedAtMs: now,
      sequence: this.waiterSequence,
    };
    const state = this.state(request.target);
    state.waiters = [...state.waiters, ticket];
    this.emit({
      kind: "waiter_enqueued",
      targetKey: key,
      waiterId: ticket.waiterId,
      tenantRef: ticket.principal.tenantRef,
      agentRef: ticket.principal.agentRef,
      queueDepth: state.waiters.length,
      atMs: now,
    });
    return { ok: true, ticket };
  }

  cancelWaiter(request: { target: LeaseTarget; waiterId: string; principal: LeasePrincipal }): CancelWaiterResult {
    const key = this.targetKey(request.target);
    const state = this.targets.get(key);
    const ticket = state?.waiters.find((w) => w.waiterId === request.waiterId) ?? null;
    if (state === undefined || ticket === null) {
      return { ok: false, reason: "waiter_not_found", detail: "no waiter ticket matches this id" };
    }
    if (!samePrincipal(ticket.principal, request.principal)) {
      return { ok: false, reason: "holder_mismatch", detail: "the waiter ticket belongs to a different principal" };
    }
    state.waiters = state.waiters.filter((w) => w.waiterId !== request.waiterId);
    this.emit({ kind: "waiter_cancelled", targetKey: key, waiterId: ticket.waiterId, atMs: this.clock.nowMs() });
    return { ok: true, cancelled: true };
  }

  /** FIFO order for a target: the head waiter is the only one who may acquire next. */
  headWaiter(target: LeaseTarget): WaiterTicket | null {
    return this.targets.get(this.targetKey(target))?.waiters[0] ?? null;
  }

  waiters(target: LeaseTarget): readonly WaiterTicket[] {
    return [...(this.targets.get(this.targetKey(target))?.waiters ?? [])];
  }

  /**
   * Grant the lease to the head-of-queue waiter when the target is free.
   * The grant re-runs the FULL admission path (quota included) at grant
   * time; on failure the waiter is dequeued and the denial is audited —
   * the queue never holds a stale head hostage.
   */
  grantNextWaiter(target: LeaseTarget): GrantNextWaiterResult {
    const now = this.clock.nowMs();
    const key = this.targetKey(target);
    const state = this.targets.get(key);
    const head = state?.waiters[0] ?? null;
    if (state === undefined || head === null) {
      this.deniedTotal += 1;
      return { ok: false, reason: "waiter_queue_empty", detail: "no waiters are queued for this target", quota: null };
    }
    // The head stays queued through acquire so the FIFO fairness check sees
    // it as the head of line; acquire dequeues it on success.
    const granted = this.acquire({ target, principal: head.principal, ttlMs: head.ttlMs, waiterId: head.waiterId });
    if (granted.ok) {
      this.emit({
        kind: "waiter_granted",
        targetKey: key,
        waiterId: head.waiterId,
        leaseId: granted.lease.leaseId,
        atMs: now,
      });
      return { ok: true, lease: granted.lease, waiterId: head.waiterId };
    }
    // A failed grant never leaves the queue holding a stale head hostage.
    state.waiters = state.waiters.slice(1);
    this.deniedTotal += 1;
    this.emit({
      kind: "waiter_denied",
      targetKey: key,
      waiterId: head.waiterId,
      reason: granted.reason,
      detail: granted.detail,
      atMs: now,
    });
    return { ok: false, reason: granted.reason, detail: granted.detail, quota: granted.quota };
  }

  /* ── Expiry observation (lazy, once per lease) ── */

  /**
   * Observe every lease whose expiry has passed and has not yet been
   * observed. Returns the newly expired lease ids; each observation is
   * audited exactly once. Expiry itself frees quota and unblocks the
   * target (deadlock prevention) without any heartbeat.
   */
  sweepExpired(): readonly string[] {
    const now = this.clock.nowMs();
    const expired: string[] = [];
    for (const [key, state] of this.targets) {
      if (state.current !== null && state.current.expiresAtMs <= now && !state.expiryObserved) {
        expired.push(state.current.leaseId);
        this.observeExpiry(state, key, now);
      }
    }
    return expired;
  }

  /* ── Observation ── */

  isHeld(target: LeaseTarget): boolean {
    const current = this.targets.get(this.targetKey(target))?.current ?? null;
    return current !== null && current.expiresAtMs > this.clock.nowMs();
  }

  currentLease(target: LeaseTarget): LeaseGrant | null {
    const current = this.targets.get(this.targetKey(target))?.current ?? null;
    if (current === null) return null;
    return current.expiresAtMs > this.clock.nowMs() ? current : null;
  }

  activeLeasesFor(principal: LeasePrincipal): number {
    const now = this.clock.nowMs();
    let count = 0;
    for (const state of this.targets.values()) {
      const current = state.current;
      if (current !== null && current.expiresAtMs > now && samePrincipal(current.principal, principal)) {
        count += 1;
      }
    }
    return count;
  }

  /** Declared ceilings as observed by the governor (configuration provenance). */
  declaredCeilings(): LeaseQuotaCeilings {
    return {
      tenants: { ...this.cfg.quotas.tenants },
      agents: { ...this.cfg.quotas.agents },
    };
  }

  /** Immutable audit trail: every grant, denial, expiry and queue transition. */
  auditTrail(): readonly LeaseQuotaAuditEvent[] {
    return [...this.auditLog];
  }

  totals(): { granted: number; denied: number } {
    const granted = [...this.targets.values()].reduce((sum, s) => sum + s.grantedTotal, 0);
    return { granted, denied: this.deniedTotal };
  }

  /* ── Internals ── */

  private targetKey(target: LeaseTarget): string {
    return `${target.kind}:${target.ref}`;
  }

  private state(target: LeaseTarget): TargetState {
    const key = this.targetKey(target);
    const existing = this.targets.get(key);
    if (existing !== undefined) return existing;
    const created: TargetState = {
      current: null,
      expiryObserved: false,
      lastFencingToken: 0,
      waiters: [],
      grantedTotal: 0,
    };
    this.targets.set(key, created);
    return created;
  }

  private validateAcquireRequest(request: {
    target: LeaseTarget;
    principal: LeasePrincipal;
    ttlMs: number;
  }): { reason: LeaseQuotaDenialReason; detail: string } | null {
    const { target, principal, ttlMs } = request;
    if (target === undefined || target === null || typeof target !== "object") {
      return { reason: "invalid_input", detail: "target is required" };
    }
    if (target.kind !== "resource" && target.kind !== "agent") {
      return { reason: "invalid_input", detail: "target.kind must be 'resource' or 'agent'" };
    }
    if (typeof target.ref !== "string" || target.ref.trim() === "") {
      return { reason: "invalid_input", detail: "target.ref must be a non-empty string" };
    }
    if (typeof principal?.tenantRef !== "string" || principal.tenantRef.trim() === "") {
      return { reason: "invalid_input", detail: "principal.tenantRef must be a non-empty string" };
    }
    if (principal.agentRef !== null && (typeof principal.agentRef !== "string" || principal.agentRef.trim() === "")) {
      return { reason: "invalid_input", detail: "principal.agentRef must be null or a non-empty string" };
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return { reason: "invalid_input", detail: "ttlMs must be a finite positive number" };
    }
    return null;
  }

  /**
   * Fail-closed quota admission. Order matters: an undeclared principal is
   * denied BEFORE any count is consulted (unknown tenants/agents admit
   * nowhere), then tenant, then agent — the first breach denies.
   */
  private admitQuota(
    principal: LeasePrincipal,
    kind: "lease" | "waiter",
  ): { ok: true } | { ok: false; reason: LeaseQuotaDenialReason; detail: string; quotaDetail: QuotaDenialDetail } {
    const tenantCeiling = this.cfg.quotas.tenants[principal.tenantRef];
    if (tenantCeiling === undefined) {
      return {
        ok: false,
        reason: "quota_principal_undeclared",
        detail: `tenant ${principal.tenantRef} has no declared ceiling; admission fails closed`,
        quotaDetail: { scope: "tenant", principalRef: principal.tenantRef, limit: 0, active: 0 },
      };
    }
    const agentCeiling = principal.agentRef === null ? undefined : this.cfg.quotas.agents[principal.agentRef];
    if (principal.agentRef !== null && agentCeiling === undefined) {
      return {
        ok: false,
        reason: "quota_principal_undeclared",
        detail: `agent ${principal.agentRef} has no declared ceiling; admission fails closed`,
        quotaDetail: { scope: "agent", principalRef: principal.agentRef, limit: 0, active: 0 },
      };
    }
    const checks: ReadonlyArray<{ ceiling: QuotaCeiling; scope: "tenant" | "agent"; ref: string }> =
      principal.agentRef === null
        ? [{ ceiling: tenantCeiling, scope: "tenant", ref: principal.tenantRef }]
        : [
            { ceiling: tenantCeiling, scope: "tenant", ref: principal.tenantRef },
            { ceiling: agentCeiling as QuotaCeiling, scope: "agent", ref: principal.agentRef },
          ];
    for (const check of checks) {
      const active = kind === "lease" ? this.activeLeaseCount(check.scope, check.ref) : this.waiterCount(check.scope, check.ref);
      const limit = kind === "lease" ? check.ceiling.maxActiveLeases : check.ceiling.maxWaiters;
      if (active >= limit) {
        return {
          ok: false,
          reason: "quota_exhausted",
          detail: `${check.scope} ${check.ref} is at its ${kind} ceiling: ${active}/${limit} active`,
          quotaDetail: { scope: check.scope, principalRef: check.ref, limit, active },
        };
      }
    }
    return { ok: true };
  }

  private activeLeaseCount(scope: "tenant" | "agent", ref: string): number {
    const now = this.clock.nowMs();
    let count = 0;
    for (const state of this.targets.values()) {
      const current = state.current;
      if (current === null || current.expiresAtMs <= now) continue;
      if (scope === "tenant" ? current.principal.tenantRef === ref : current.principal.agentRef === ref) {
        count += 1;
      }
    }
    return count;
  }

  private waiterCount(scope: "tenant" | "agent", ref: string): number {
    let count = 0;
    for (const state of this.targets.values()) {
      for (const ticket of state.waiters) {
        if (scope === "tenant" ? ticket.principal.tenantRef === ref : ticket.principal.agentRef === ref) {
          count += 1;
        }
      }
    }
    return count;
  }

  private denyAcquire(
    target: LeaseTarget,
    principal: LeasePrincipal,
    reason: LeaseQuotaDenialReason,
    detail: string,
    quota: QuotaDenialDetail | null = null,
    heldBy: string | null = null,
  ): AcquireResult {
    this.deniedTotal += 1;
    const now = this.clock.nowMs();
    if (quota !== null) {
      this.emit({
        kind: "quota_denied",
        targetKey: this.targetKey(target),
        scope: quota.scope,
        principalRef: quota.principalRef,
        limit: quota.limit,
        active: quota.active,
        detail,
        atMs: now,
      });
    }
    this.emit({
      kind: "lease_denied",
      targetKey: this.targetKey(target),
      tenantRef: principal.tenantRef,
      agentRef: principal.agentRef,
      reason,
      detail,
      atMs: now,
    });
    return { ok: false, reason, detail, heldBy, quota };
  }

  private observeExpiry(state: TargetState, key: string, now: number): void {
    const current = state.current;
    if (current === null || current.expiresAtMs > now || state.expiryObserved) return;
    state.expiryObserved = true;
    this.emit({
      kind: "lease_expired_observed",
      targetKey: key,
      leaseId: current.leaseId,
      expiredAtMs: current.expiresAtMs,
      observedAtMs: now,
    });
  }

  private emit(event: LeaseQuotaAuditEvent): void {
    this.auditLog.push(event);
    const sink = this.cfg.onEvent;
    if (!sink) return;
    try {
      sink(event);
    } catch {
      // Observability must never break containment.
    }
  }
}

export function createLeaseQuotaGovernor(config: LeaseQuotaGovernorConfig): LeaseQuotaGovernor {
  return new LeaseQuotaGovernor(config);
}