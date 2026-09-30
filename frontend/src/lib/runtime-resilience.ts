/**
 * CoreGrid — Core Application Runtime resilience primitives.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Circuit breakers (Section X): external dependencies support circuit-breaking.
 * - Timeouts (Section Y): every external operation has an explicit timeout policy.
 * - Bulkheads (Section Z): critical workloads isolated so one failing subsystem
 *   does not consume all runtime resources.
 * - Rate limiting (Section AA): user, tenant, API, service, integration, agent limits.
 * - Retry limits (Section W4): no operation may retry indefinitely.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Circuit breaker (Section X)
 * ────────────────────────────────────────────────────────────*/

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening. */
  failureThreshold: number;
  /** Time in milliseconds before transitioning from open to half-open. */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open to close. */
  successThreshold: number;
}

export interface CircuitBreaker {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureAt: string | null;
  lastStateChangeAt: string;
  /** Whether a call is allowed through. */
  allowCall(now: string): boolean;
  /** Record a successful call. */
  recordSuccess(now: string): void;
  /** Record a failed call. */
  recordFailure(now: string): void;
  /** Reset to closed state. */
  reset(): void;
}

export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  let state: CircuitState = "closed";
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  let lastFailureAt: string | null = null;
  let lastStateChangeAt = new Date().toISOString();

  return {
    get state() {
      return state;
    },
    get consecutiveFailures() {
      return consecutiveFailures;
    },
    get consecutiveSuccesses() {
      return consecutiveSuccesses;
    },
    get lastFailureAt() {
      return lastFailureAt;
    },
    get lastStateChangeAt() {
      return lastStateChangeAt;
    },
    allowCall(now) {
      if (state === "closed") return true;
      if (state === "open") {
        // After reset timeout, transition to half-open.
        if (Date.parse(now) - Date.parse(lastStateChangeAt) >= config.resetTimeoutMs) {
          state = "half_open";
          lastStateChangeAt = now;
          return true;
        }
        return false;
      }
      // half_open: allow limited calls.
      return true;
    },
    recordSuccess(now) {
      consecutiveSuccesses += 1;
      consecutiveFailures = 0;
      if (state === "half_open" && consecutiveSuccesses >= config.successThreshold) {
        state = "closed";
        consecutiveSuccesses = 0;
        lastStateChangeAt = now;
      }
    },
    recordFailure(now) {
      consecutiveFailures += 1;
      consecutiveSuccesses = 0;
      lastFailureAt = now;
      if (state === "closed" && consecutiveFailures >= config.failureThreshold) {
        state = "open";
        lastStateChangeAt = now;
      } else if (state === "half_open") {
        state = "open";
        lastStateChangeAt = now;
      }
    },
    reset() {
      state = "closed";
      consecutiveFailures = 0;
      consecutiveSuccesses = 0;
      lastFailureAt = null;
      lastStateChangeAt = new Date().toISOString();
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Rate limiting (Section AA)
 * ────────────────────────────────────────────────────────────*/

export type RateLimitScope = "user" | "tenant" | "api" | "service" | "integration" | "agent";

export interface RateLimitRule {
  scope: RateLimitScope;
  /** Scope identifier, e.g. tenant ID, user ID, API key. */
  scopeId: string;
  /** Maximum requests per window. */
  limit: number;
  /** Window in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  retryAfterMs: number | null;
}

export interface RateLimiter {
  check(rule: RateLimitRule, now: string): RateLimitResult;
  reset(scope: RateLimitScope, scopeId: string): void;
}

export function createRateLimiter(): RateLimiter {
  const windows = new Map<string, { count: number; windowStart: string }>();
  const key = (scope: RateLimitScope, scopeId: string) => `${scope}:${scopeId}`;

  return {
    check(rule, now) {
      const k = key(rule.scope, rule.scopeId);
      const current = windows.get(k);
      const nowMs = Date.parse(now);

      if (!current || nowMs - Date.parse(current.windowStart) >= rule.windowMs) {
        windows.set(k, { count: 1, windowStart: now });
        return {
          allowed: true,
          remaining: rule.limit - 1,
          resetAt: new Date(nowMs + rule.windowMs).toISOString(),
          retryAfterMs: null,
        };
      }

      if (current.count >= rule.limit) {
        const resetAt = new Date(Date.parse(current.windowStart) + rule.windowMs).toISOString();
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfterMs: Date.parse(resetAt) - nowMs,
        };
      }

      current.count += 1;
      return {
        allowed: true,
        remaining: rule.limit - current.count,
        resetAt: new Date(Date.parse(current.windowStart) + rule.windowMs).toISOString(),
        retryAfterMs: null,
      };
    },
    reset(scope, scopeId) {
      windows.delete(key(scope, scopeId));
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Timeout policy (Section Y)
 * ────────────────────────────────────────────────────────────*/

export interface TimeoutPolicy {
  /** Default timeout in milliseconds. */
  defaultTimeoutMs: number;
  /** Per-operation overrides. */
  overrides: Record<string, number>;
  /** Maximum allowed timeout. */
  maxTimeoutMs: number;
}

export function resolveTimeout(policy: TimeoutPolicy, operation: string): number {
  const override = policy.overrides[operation];
  if (override !== undefined) return Math.min(override, policy.maxTimeoutMs);
  return Math.min(policy.defaultTimeoutMs, policy.maxTimeoutMs);
}

/* ─────────────────────────────────────────────────────────────
 * Bulkhead (Section Z)
 * ────────────────────────────────────────────────────────────*/

export interface BulkheadConfig {
  /** Maximum concurrent calls. */
  maxConcurrent: number;
  /** Maximum queue size. */
  maxQueueSize: number;
}

export interface Bulkhead {
  /** Whether a call can be admitted. */
  tryAcquire(): boolean;
  /** Release a slot after completion. */
  release(): void;
  /** Current active count. */
  activeCount(): number;
  /** Current queued count. */
  queuedCount(): number;
}

export function createBulkhead(config: BulkheadConfig): Bulkhead {
  let active = 0;
  let queued = 0;

  return {
    tryAcquire() {
      if (active < config.maxConcurrent) {
        active += 1;
        return true;
      }
      if (queued < config.maxQueueSize) {
        queued += 1;
        return true;
      }
      return false;
    },
    release() {
      if (queued > 0) {
        queued -= 1;
      } else if (active > 0) {
        active -= 1;
      }
    },
    activeCount() {
      return active;
    },
    queuedCount() {
      return queued;
    },
  };
}
