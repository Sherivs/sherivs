/**
 * CoreGrid — lease / concurrency control over shared resources and worker
 * execution (J-031 / V1CAP-055).
 *
 * E-058 (RUNTIME leases) and G-022 (bounded scarce computation): multi-worker
 * execution without leases corrupts state. This module is the in-process V1
 * reference for the lease primitive the runtime will scale to a DB-backed
 * store later (same interface, same semantics).
 *
 * Law of this module:
 * - A lease binds one holder to one resource for a bounded TTL.
 * - TTLs are bounded: an acquire above the manager's maximum is rejected.
 * - Fencing tokens are monotonic per resource. Every fresh acquire mints a
 *   strictly greater token; an operation carrying a stale token is rejected.
 * - An expired lease fails CLOSED: it cannot be renewed, cannot be released
 *   by its former holder, and its holder cannot pass fence checks. Expired
 *   leases are dead immediately (lazy expiry via caller-supplied time).
 * - No resurrection: an expired lease cannot be reclaimed by the same
 *   holder "picking up where it left off". Continuing work requires a fresh
 *   acquire, which mints a new fencing token and yields to current holders.
 * - Deadlock prevention is TTL expiry itself: a dead holder's lease expires
 *   and the resource becomes acquirable by others without any heartbeat.
 *
 * Pure in-process implementation: time is supplied by the caller, nothing
 * runs implicitly, nothing is persisted, no I/O.
 */

/* ─────────────────────────────────────────────────────────────
 * Lease shape
 * ────────────────────────────────────────────────────────────*/

export interface Lease {
  resourceRef: string;
  holderId: string;
  leaseId: string;
  /** Monotonic per-resource token; strictly increases across acquires. */
  fencingToken: number;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export interface LeaseManagerConfig {
  /** Upper bound on any lease TTL in ms (deadlock bound). */
  maxTtlMs: number;
}

/* ─────────────────────────────────────────────────────────────
 * Results
 * ────────────────────────────────────────────────────────────*/

export type AcquireResult =
  | { ok: true; lease: Lease }
  | {
      ok: false;
      reason: "resource_held" | "ttl_exceeds_bound" | "invalid_input";
      heldBy: string | null;
    };

export type RenewResult =
  | { ok: true; lease: Lease }
  | { ok: false; reason: "lease_expired" | "unknown_lease" | "holder_mismatch" | "invalid_input" };

export type ReleaseResult =
  | { ok: true; released: true }
  | { ok: false; reason: "lease_expired" | "unknown_lease" | "holder_mismatch" | "invalid_input" };

export type FenceResult =
  | { ok: true }
  | {
      ok: false;
      reason: "stale_fencing_token" | "lease_expired" | "unknown_resource" | "holder_mismatch";
    };

/* ─────────────────────────────────────────────────────────────
 * Manager
 * ────────────────────────────────────────────────────────────*/

interface ResourceState {
  current: Lease | null;
  lastFencingToken: number;
}

export class LeaseManager {
  private readonly resources = new Map<string, ResourceState>();
  private readonly config: LeaseManagerConfig;

  constructor(config: LeaseManagerConfig) {
    if (!Number.isFinite(config.maxTtlMs) || config.maxTtlMs <= 0) {
      throw new Error("lease_manager_invalid_max_ttl");
    }
    this.config = config;
  }

  private state(resourceRef: string): ResourceState {
    const existing = this.resources.get(resourceRef);
    if (existing !== undefined) return existing;
    const created: ResourceState = { current: null, lastFencingToken: 0 };
    this.resources.set(resourceRef, created);
    return created;
  }

  /**
   * Acquire the resource for the holder. Serialization: if the resource is
   * currently held by an unexpired lease, the acquire is rejected with
   * `resource_held` — there is no queue and no preemption. An expired lease
   * (deadlock prevention) does not block: the resource is free.
   */
  acquire(
    input: { resourceRef: string; holderId: string; ttlMs: number },
    nowMs: number,
  ): AcquireResult {
    if (!input.resourceRef.trim() || !input.holderId.trim()) {
      return { ok: false, reason: "invalid_input", heldBy: null };
    }
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
      return { ok: false, reason: "invalid_input", heldBy: null };
    }
    if (input.ttlMs > this.config.maxTtlMs) {
      return { ok: false, reason: "ttl_exceeds_bound", heldBy: null };
    }

    const state = this.state(input.resourceRef);
    const current = state.current;
    if (current !== null && current.expiresAtMs > nowMs) {
      return { ok: false, reason: "resource_held", heldBy: current.holderId };
    }

    // Fresh acquire (including after expiry): mint the next fencing token.
    // The expired lease is dead; there is no resurrection path.
    const token = state.lastFencingToken + 1;
    const lease: Lease = {
      resourceRef: input.resourceRef,
      holderId: input.holderId,
      leaseId: `lease:${input.resourceRef}:${token}`,
      fencingToken: token,
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + input.ttlMs,
    };
    state.current = lease;
    state.lastFencingToken = token;
    return { ok: true, lease };
  }

  /**
   * Extend the holder's unexpired lease. Renewal after expiry FAILS CLOSED:
   * an expired lease cannot be resurrected by renewal; the holder must
   * acquire fresh (and compete with current holders).
   */
  renew(
    input: { resourceRef: string; holderId: string; fencingToken: number },
    nowMs: number,
    ttlMs: number,
  ): RenewResult {
    if (!input.resourceRef.trim() || !input.holderId.trim()) {
      return { ok: false, reason: "invalid_input" };
    }
    const state = this.resources.get(input.resourceRef);
    const current = state?.current ?? null;
    if (state === undefined || current === null) {
      return { ok: false, reason: "unknown_lease" };
    }
    if (current.holderId !== input.holderId) {
      return { ok: false, reason: "holder_mismatch" };
    }
    if (current.fencingToken !== input.fencingToken) {
      // A stale token here means the holder already lost the lease.
      return { ok: false, reason: "unknown_lease" };
    }
    if (current.expiresAtMs <= nowMs) {
      return { ok: false, reason: "lease_expired" };
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > this.config.maxTtlMs) {
      return { ok: false, reason: "invalid_input" };
    }
    const renewed: Lease = { ...current, expiresAtMs: nowMs + ttlMs };
    state.current = renewed;
    return { ok: true, lease: renewed };
  }

  /**
   * Release the resource. Only the current unexpired holder can release.
   * Releasing with an expired lease fails closed — the lease is already
   * dead and the fence token stale.
   */
  release(
    input: { resourceRef: string; holderId: string; fencingToken: number },
    nowMs: number,
  ): ReleaseResult {
    if (!input.resourceRef.trim() || !input.holderId.trim()) {
      return { ok: false, reason: "invalid_input" };
    }
    const state = this.resources.get(input.resourceRef);
    const current = state?.current ?? null;
    if (state === undefined || current === null) {
      return { ok: false, reason: "unknown_lease" };
    }
    if (current.holderId !== input.holderId) {
      return { ok: false, reason: "holder_mismatch" };
    }
    if (current.fencingToken !== input.fencingToken) {
      return { ok: false, reason: "unknown_lease" };
    }
    if (current.expiresAtMs <= nowMs) {
      return { ok: false, reason: "lease_expired" };
    }
    state.current = null;
    return { ok: true, released: true };
  }

  /**
   * Fencing check for any state-mutating operation on the leased resource.
   * The caller passes the token it observed; the manager rejects stale
   * tokens, wrong holders, unknown resources, and expired leases. This is
   * the gate a shared-resource writer must pass before every write.
   *
   * The token is the authority: a token below the current one is stale no
   * matter who presents it; an equal token presented by the wrong holder is
   * a holder mismatch; only the current holder with the current token and
   * an unexpired lease passes.
   */
  assertFencingToken(
    input: { resourceRef: string; holderId: string; fencingToken: number },
    nowMs: number,
  ): FenceResult {
    const state = this.resources.get(input.resourceRef);
    const current = state?.current ?? null;
    if (state === undefined || current === null) {
      return { ok: false, reason: "unknown_resource" };
    }
    if (input.fencingToken < current.fencingToken) {
      return { ok: false, reason: "stale_fencing_token" };
    }
    if (input.fencingToken > current.fencingToken) {
      return { ok: false, reason: "unknown_resource" };
    }
    if (current.holderId !== input.holderId) {
      return { ok: false, reason: "holder_mismatch" };
    }
    if (current.expiresAtMs <= nowMs) {
      return { ok: false, reason: "lease_expired" };
    }
    return { ok: true };
  }

  /** True when the resource is held by an unexpired lease. */
  isHeld(resourceRef: string, nowMs: number): boolean {
    const current = this.resources.get(resourceRef)?.current ?? null;
    return current !== null && current.expiresAtMs > nowMs;
  }
}
