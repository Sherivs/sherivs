/**
 * CoreGrid — Phase 05 Core Application Runtime: self-report.
 *
 * The runtime owns the execution fabric and nothing else (document section
 * "HC. FINAL SCOPE LOCK": it executes capabilities, it does not own them). This
 * module is the runtime's knowledge of itself: which execution subsystems exist,
 * what each can be in, and a deterministic self-check that EXERCISES the shipped
 * state machines rather than describing them.
 *
 * Everything is derived from the runtime contracts themselves — the rate limiter,
 * circuit breaker, timeout policy, event compatibility rule and command validation
 * are the real implementations called with real inputs. A failing check is
 * reported as failing; nothing here can pass by assertion.
 */
import {
  createCircuitBreaker,
  createRateLimiter,
  resolveTimeout,
  type TimeoutPolicy,
} from "@/lib/runtime-resilience";
import {
  APPLICATION_EVENT_TYPES,
  createApplicationEvent,
  isEventCompatible,
} from "@/lib/runtime-events";
import { JOB_STATUSES } from "@/lib/runtime-jobs";
import { MAX_PAGE_SIZE, createCommand, validateCommand } from "@/lib/runtime-command-query";
import { CAPABILITY_STATUSES } from "@/lib/runtime-capabilities";
import type { ApprovalStatus } from "@/lib/runtime-approval";

/** Mirrors the `ApprovalStatus` union — typed so it cannot drift from the contract. */
const APPROVAL_STATES: readonly ApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
] as const;

export interface RuntimeSubsystem {
  id: string;
  owns: string;
  /** The states this subsystem's objects can be in, from its own contract. */
  states: readonly string[];
}

/** The execution fabric, as the runtime knows it. */
export function runtimeSubsystems(): readonly RuntimeSubsystem[] {
  return [
    { id: "capabilities", owns: "capability registration and health", states: CAPABILITY_STATUSES },
    { id: "jobs", owns: "background work and retries", states: JOB_STATUSES },
    {
      id: "events",
      owns: "application events and version compatibility",
      states: APPLICATION_EVENT_TYPES,
    },
    { id: "approvals", owns: "approval-gated operations", states: APPROVAL_STATES },
    {
      id: "command-query",
      owns: "command validation and paged queries",
      states: [`max_page_size=${MAX_PAGE_SIZE}`],
    },
    {
      id: "resilience",
      owns: "circuit breaking, rate limiting, timeouts",
      states: ["closed", "open", "half_open"],
    },
  ];
}

export interface RuntimeCheck {
  id: string;
  /** What the check proves about the shipped contract. */
  proves: string;
  ok: boolean;
  detail: string;
}

/**
 * Exercise the shipped state machines with real inputs. Deterministic: the same
 * runtime always yields the same result, so a failure means behaviour changed.
 */
export function runRuntimeSelfCheck(): readonly RuntimeCheck[] {
  const checks: RuntimeCheck[] = [];

  // Rate limiting: a window allows its limit, denies beyond it, then resets.
  const limiter = createRateLimiter();
  const rule = { scope: "tenant" as const, scopeId: "self-check", limit: 2, windowMs: 60_000 };
  const first = limiter.check(rule, "2026-09-14T10:00:00.000Z");
  const second = limiter.check(rule, "2026-09-14T10:00:01.000Z");
  const third = limiter.check(rule, "2026-09-14T10:00:02.000Z");
  const afterWindow = limiter.check(rule, "2026-09-14T10:01:01.000Z");
  checks.push({
    id: "rate-limit-window",
    proves: "a tenant window allows its limit, denies beyond it, and resets afterwards",
    ok:
      first.allowed &&
      second.allowed &&
      !third.allowed &&
      afterWindow.allowed &&
      third.retryAfterMs !== null,
    detail: `allowed=${first.allowed},${second.allowed} denied=${!third.allowed} reset=${afterWindow.allowed}`,
  });

  // Circuit breaker: opens on the failure threshold, blocks, then permits a probe.
  const breaker = createCircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 1_000,
    successThreshold: 1,
  });
  breaker.recordFailure("2026-09-14T10:00:00.000Z");
  breaker.recordFailure("2026-09-14T10:00:01.000Z");
  const openState = breaker.state;
  // Inside the reset window the circuit must refuse; after it, one probe is allowed.
  const blockedWhileOpen = breaker.allowCall("2026-09-14T10:00:01.500Z");
  const probeAllowed = breaker.allowCall("2026-09-14T10:00:03.000Z");
  checks.push({
    id: "circuit-breaker",
    proves: "repeated failure opens the circuit, blocks calls, then permits a half-open probe",
    ok: openState === "open" && !blockedWhileOpen && probeAllowed,
    detail: `state=${openState} blocked=${!blockedWhileOpen} probe=${probeAllowed}`,
  });

  // Timeout policy: overrides beat the default; unrelated operations keep it.
  const policy: TimeoutPolicy = {
    defaultTimeoutMs: 5_000,
    overrides: { "reports.export": 30_000 },
    maxTimeoutMs: 60_000,
  };
  const override = resolveTimeout(policy, "reports.export");
  const fallback = resolveTimeout(policy, "unenumerated.operation");
  checks.push({
    id: "timeout-policy",
    proves: "per-operation overrides apply without disturbing other operations",
    ok: override === 30_000 && fallback === 5_000,
    detail: `override=${override} default=${fallback}`,
  });

  // Event compatibility: a declared version is accepted; an undeclared one is not.
  const event = createApplicationEvent({
    name: "SelfCheckEvent",
    payload: {},
    producer: "runtime-self-report",
    tenantId: null,
    occurredAt: "2026-09-14T10:00:00.000Z",
  });
  const accepted = isEventCompatible(event, [event.version], false);
  const rejected = isEventCompatible(event, [event.version + 5], false);
  checks.push({
    id: "event-compatibility",
    proves: "a consumer accepts only event versions it declares as supported",
    ok: accepted && !rejected,
    detail: `accepted=${accepted} undeclaredAccepted=${rejected}`,
  });

  // Command validation: a required idempotency key that is missing must deny.
  const withoutKey = validateCommand(createCommand("SelfCheckCommand", 1, {}), {
    requireIdempotencyKey: true,
  });
  const withKey = validateCommand(createCommand("SelfCheckCommand", 1, {}, "self-check-1"), {
    requireIdempotencyKey: true,
  });
  checks.push({
    id: "command-idempotency",
    proves: "a retryable command without its idempotency key is rejected, never executed",
    ok: withoutKey.valid === false && withKey.valid === true,
    detail: `withoutKey=${withoutKey.valid} withKey=${withKey.valid}`,
  });

  return checks;
}

export interface RuntimeSelfReport {
  subsystems: readonly RuntimeSubsystem[];
  checks: readonly RuntimeCheck[];
  passed: number;
  failed: number;
  /** True only when every check passed; failures are named, never absorbed. */
  healthy: boolean;
  failingChecks: readonly string[];
}

export function runtimeSelfReport(): RuntimeSelfReport {
  const checks = runRuntimeSelfCheck();
  const failing = checks.filter((check) => !check.ok).map((check) => check.id);
  return {
    subsystems: runtimeSubsystems(),
    checks,
    passed: checks.length - failing.length,
    failed: failing.length,
    healthy: failing.length === 0,
    failingChecks: failing,
  };
}
