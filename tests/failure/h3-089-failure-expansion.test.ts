/**
 * CoreGrid — H3-089 Failure Battery Expansion (Squad H, mission H-089).
 *
 * Failure-path deepening of the batch-2 quota/lease/approval-chain modules
 * (ALL read-only imports — the modules under test are never modified):
 *
 *   frontend/src/lib/reliability/quotas.ts    (B-019 / J-031 volume plane)
 *   frontend/src/lib/reliability/leases.ts    (B-019 / J-031 concurrency plane)
 *   frontend/src/lib/approval/chains.ts       (B-020 / J-032 resolution flow)
 *
 * Coverage (complementary to h3-019 / h3-020 — no case is duplicated):
 *   1. Quota accounting under partial failure — a denied consumption leaves
 *      NO partial charge on any scope ledger (two-pass admission proof).
 *   2. Lease-plane crash injection — throwing/misbehaving injected
 *      dependencies; typed outcomes or a recorded containment finding.
 *   3. Approval-chain audit containment — the execution gate ALWAYS emits
 *      its audit artifact on every failure path; forged record sets surface
 *      every defect in one typed outcome.
 *   4. Deadline races — exact boundary instants through injected clocks and
 *      fixed timestamps (no wall clock anywhere).
 *   5. Adversarial inputs — negative/NaN/infinite/oversized quantities and
 *      malformed shapes resolve to typed denials, never uncontained throws.
 *
 * LAW under test: every failure resolves to a typed outcome, never an
 * uncontained throw. The final describe block records CURRENT behavior of
 * containment gaps discovered by this battery (findings F-1..F-6, labeled
 * inline); each is detailed in progress/h3-wave/H3-089.report.md and is a
 * regression tripwire — when a gap is fixed, flip its assertion to the
 * typed-outcome law.
 *
 * Pure offline: no network, no database, no secrets, no implicit time.
 */
import { describe, expect, it } from "vitest";
import type { AdapterClock } from "../../frontend/src/lib/adapters/failure-policy";
import {
  LeaseQuotaGovernor,
  type LeaseGrant,
  type FenceResult,
  type LeaseHandleRef,
  type LeasePrincipal,
  type LeaseTarget,
  type LeaseTargetKind,
  type LeaseQuotaAuditEvent,
} from "../../frontend/src/lib/reliability/leases";
import {
  MAX_UNITS_PER_CONSUMPTION,
  ResourceQuotaAuthority,
  parseResourceQuotaRegistry,
  type ConsumptionRequest,
  type QuotaCeiling,
  type QuotaLeasePlane,
  type ResourceQuotaAuditEvent,
} from "../../frontend/src/lib/reliability/quotas";
import {
  ResolutionFlowError,
  declareApprovalChain,
  gateExecutionOnResolution,
  openResolutionFlow,
  recordResolution,
  resolveFlow,
  routeToApprovalChain,
  type ApprovalChainConfig,
  type EscalationCase,
  type ResolutionFlowInput,
  type ResolutionInput,
  type ResolutionRecord,
  type RoutingResult,
} from "../../frontend/src/lib/approval/chains";

/* ─────────────────────────────────────────────────────────────
 * Fixtures — injected clock, typed factories, no wall clock
 * ────────────────────────────────────────────────────────────*/

/** Injectable clock; `advanceMs` accepts negative deltas to probe clock regression. */
function fakeClock(startMs = 1_000_000): AdapterClock & { advanceMs(delta: number): void; now(): number } {
  let now = startMs;
  return {
    nowMs: () => now,
    delay: () => Promise.reject(new Error("fakeClock: implicit time flow is forbidden in these tests")),
    advanceMs: (delta: number) => {
      now += delta;
    },
    now: () => now,
  };
}

const PROVENANCE = {
  declaredBy: "role:h3-089-failure-battery-engineer",
  authority: "H3 wave mission H-089 / AGENTS.md §31, §42",
  declaredAt: "2026-10-03T00:00:00.000Z",
};

function ceiling(overrides: Partial<QuotaCeiling> = {}): QuotaCeiling {
  return {
    scope: "tenant",
    principalRef: "tenant_a",
    resourceClass: "compute_units",
    maxUnitsPerWindow: 100,
    windowMs: 60_000,
    provenance: PROVENANCE,
    ...overrides,
  };
}

const TENANT_A: LeasePrincipal = { tenantRef: "tenant_a", agentRef: null };
const TENANT_B: LeasePrincipal = { tenantRef: "tenant_b", agentRef: null };
const AGENT_X: LeasePrincipal = { tenantRef: "tenant_a", agentRef: "agent_x" };
const AGENT_Y: LeasePrincipal = { tenantRef: "tenant_a", agentRef: "agent_y" };

const BUF: LeaseTarget = { kind: "resource", ref: "shared_buffer" };

function parsedRegistry(...ceilings: QuotaCeiling[]) {
  const parsed = parseResourceQuotaRegistry({ ceilings });
  if (!parsed.ok) throw new Error(`test registry invalid: ${parsed.issues.join("; ")}`);
  return parsed.registry;
}

function quotaAuthority(
  ceilings: QuotaCeiling[],
  options: { clock?: AdapterClock; leasePlane?: QuotaLeasePlane; onEvent?: (e: ResourceQuotaAuditEvent) => void } = {},
): ResourceQuotaAuthority {
  return new ResourceQuotaAuthority({
    registry: parsedRegistry(...ceilings),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.leasePlane !== undefined ? { leasePlane: options.leasePlane } : {}),
    ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
  });
}

function governor(
  options: {
    clock?: AdapterClock;
    maxTtlMs?: number;
    maxActiveLeases?: number;
    onEvent?: (e: LeaseQuotaAuditEvent) => void;
  } = {},
): LeaseQuotaGovernor {
  return new LeaseQuotaGovernor({
    maxTtlMs: options.maxTtlMs ?? 60_000,
    quotas: {
      tenants: {
        tenant_a: { maxActiveLeases: options.maxActiveLeases ?? 5, maxWaiters: 5 },
        tenant_b: { maxActiveLeases: options.maxActiveLeases ?? 5, maxWaiters: 5 },
      },
      agents: {},
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
  });
}

function planeOf(governorInstance: LeaseQuotaGovernor): QuotaLeasePlane {
  return { assertFencingToken: (request) => governorInstance.assertFencingToken(request) };
}

function grantOrThrow(result: { ok: true; lease: LeaseGrant } | { ok: false; reason: string; detail: string }): LeaseGrant {
  if (!result.ok) throw new Error(`setup: lease should be granted (denied ${result.reason})`);
  return result.lease;
}

/* Approval-chain fixtures — fixed instants, offline and deterministic. */

const CASE_TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const CAP = "approval:resolve";
const REQUESTER_AI = "agent-1";
const ALICE = "human-alice";
const BOB = "human-bob";
const CAROL = "human-carol";

const REQUESTED_AT = "2026-10-01T00:00:00.000Z";
const DECIDE_1 = "2026-10-01T06:00:00.000Z";
const DECIDE_2 = "2026-10-01T08:00:00.000Z";
const DEADLINE = "2026-10-02T00:00:00.000Z";
const ONE_MS_BEFORE_DEADLINE = "2026-10-01T23:59:59.999Z";
const ONE_MS_AFTER_REQUEST = "2026-10-01T00:00:00.001Z";

function flowInput(overrides: Partial<ResolutionFlowInput> = {}): ResolutionFlowInput {
  return {
    requestId: "req-h089",
    tenantId: CASE_TENANT,
    policyId: "policy-h089",
    decision: "ESCALATE",
    riskTier: "routine",
    reason: "deferred pending human review",
    requesterRef: REQUESTER_AI,
    requesterKind: "ai",
    requestedAt: REQUESTED_AT,
    subject: { operation: "rotate", target: "h089-subject" },
    ...overrides,
  };
}

function chainConfig(refs: readonly string[], overrides: Partial<ApprovalChainConfig> = {}): ApprovalChainConfig {
  return {
    chainId: "chain-h089",
    tenantId: CASE_TENANT,
    capabilityRequired: CAP,
    resolvers: refs.map((resolverRef) => ({ resolverRef, identityKind: "human" as const, capabilities: [CAP] })),
    resolveBy: DEADLINE,
    ...overrides,
  };
}

function routedCase(
  inputOverrides: Partial<ResolutionFlowInput> = {},
  chainOverrides: Partial<Omit<ApprovalChainConfig, "resolvers">> & { resolvers?: readonly string[] } = {},
): { kase: EscalationCase; routing: RoutingResult; chain: ApprovalChainConfig } {
  const kase = openResolutionFlow(flowInput(inputOverrides));
  const { resolvers, ...chainRest } = chainOverrides;
  const refs = resolvers ?? [ALICE, BOB, CAROL];
  const cfg = chainConfig(refs, chainRest);
  const routing = routeToApprovalChain(kase, declareApprovalChain(cfg));
  return { kase, routing, chain: cfg };
}

function approveRecord(
  kase: EscalationCase,
  routing: RoutingResult,
  chain: ApprovalChainConfig,
  resolverRef: string,
  overrides: Partial<ResolutionInput> = {},
): ResolutionRecord {
  return recordResolution(kase, routing, declareApprovalChain(chain), [], {
    resolutionId: `res-${resolverRef}`,
    verdict: "approve",
    resolverRef,
    identityKind: "human",
    tenantId: kase.tenantId,
    capabilities: [CAP],
    decidedAt: DECIDE_1,
    evidence: `reviewed and approved by ${resolverRef}`,
    ...overrides,
  });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ResolutionFlowError) return error.code;
    throw error;
  }
  throw new Error("expected a ResolutionFlowError but the call succeeded");
}

/* ═════════════════════════════════════════════════════════════
 * 1. Quota accounting under partial failure — no partial charge
 * ═════════════════════════════════════════════════════════════*/

describe("quota accounting under partial failure", () => {
  it("charges nothing to any scope when the agent ceiling denies — the tenant ledger is untouched", () => {
    const clock = fakeClock();
    const quota = quotaAuthority(
      [
        ceiling({ principalRef: "tenant_a", maxUnitsPerWindow: 100 }),
        ceiling({ scope: "agent", principalRef: "agent_x", maxUnitsPerWindow: 10 }),
      ],
      { clock },
    );
    expect(quota.consume({ principal: AGENT_X, resourceClass: "compute_units", units: 10 }).ok).toBe(true);
    const denied = quota.consume({ principal: AGENT_X, resourceClass: "compute_units", units: 5 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("quota_exhausted");
      expect(denied.quota?.scope).toBe("agent");
      expect(denied.quota?.consumedInWindow).toBe(10);
    }
    // The agent's 5 denied units were NEVER billed to the tenant ledger.
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(10);
    expect(tenant?.remainingInWindow).toBe(90);
    // Canonical totals count only admitted units.
    expect(quota.totals()).toMatchObject({ consumedUnits: 10, denied: 1 });
    // The tenant's full remaining capacity is still spendable after the denial.
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 90 }).ok).toBe(true);
  });

  it("charges nothing to the tenant when an undeclared agent is denied", () => {
    const quota = quotaAuthority([ceiling({ principalRef: "tenant_a", maxUnitsPerWindow: 50 })], { clock: fakeClock() });
    const denied = quota.consume({ principal: AGENT_Y, resourceClass: "compute_units", units: 7 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("undeclared_quota");
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(0);
    expect(quota.totals().consumedUnits).toBe(0);
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 50 }).ok).toBe(true);
  });

  it("charges nothing when the lease plane denies an expired binding — admission recovers cleanly", () => {
    const clock = fakeClock();
    const leaseGov = governor({ clock });
    const grant = grantOrThrow(
      leaseGov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }),
    );
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 20 })], {
      clock,
      leasePlane: planeOf(leaseGov),
    });
    clock.advanceMs(30_001);
    const denied = quota.consume({
      principal: TENANT_A,
      resourceClass: "compute_units",
      units: 15,
      lease: grant,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("lease_not_active");
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(0);
    // A fresh lease restores the lease-backed path; nothing was sticky.
    const fresh = grantOrThrow(leaseGov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 15, lease: fresh }).ok).toBe(
      true,
    );
  });

  it("charges nothing when a lease binding is presented with no lease plane configured", () => {
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 20 })], { clock: fakeClock() });
    const denied = quota.consume({
      principal: TENANT_A,
      resourceClass: "compute_units",
      units: 15,
      lease: { target: BUF, leaseId: "lease:x:1", fencingToken: 1, principal: TENANT_A },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("lease_plane_unavailable");
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(0);
    expect(quota.totals().consumedUnits).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 2. Lease-plane denial shapes and crash injection
 * ═════════════════════════════════════════════════════════════*/

describe("lease-plane failure shapes resolve to typed quota denials", () => {
  it("converts every failing FenceResult into a typed lease_not_active denial with zero charge", () => {
    const clock = fakeClock();
    const failures: readonly FenceResult[] = [
      { ok: false, reason: "stale_fencing_token", detail: "token is below the current one" },
      { ok: false, reason: "unknown_lease", detail: "no lease exists for the presented token" },
      { ok: false, reason: "holder_mismatch", detail: "the token belongs to a different principal" },
      { ok: false, reason: "lease_expired", detail: "the lease has expired" },
    ];
    let calls = 0;
    const plane: QuotaLeasePlane = {
      assertFencingToken: (request) => {
        calls += 1;
        return failures[Math.min(calls - 1, failures.length - 1)] ?? { ok: false, reason: "unknown_lease", detail: "x" };
      },
    };
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 50 })], { clock, leasePlane: plane });
    for (let i = 0; i < failures.length; i += 1) {
      const result = quota.consume({
        principal: TENANT_A,
        resourceClass: "compute_units",
        units: 10,
        lease: { target: BUF, leaseId: "lease:x:1", fencingToken: 1, principal: TENANT_A },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("lease_not_active");
        expect(result.detail).toContain("lease binding rejected");
      }
      const [tenant] = quota.snapshot(TENANT_A, "compute_units");
      expect(tenant?.consumedInWindow).toBe(0);
    }
    expect(calls).toBe(failures.length);
    expect(quota.totals()).toMatchObject({ consumedUnits: 0, denied: failures.length });
  });

  it("the real governor as lease plane survives adversarial handle bombardment with typed denials", () => {
    const clock = fakeClock();
    const leaseGov = governor({ clock });
    const grant = grantOrThrow(leaseGov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 50 })], {
      clock,
      leasePlane: planeOf(leaseGov),
    });
    const bombardment: readonly { handle: LeaseHandleRef; expected: string }[] = [
      // Stale token: below the live token 1.
      { handle: { ...grant, fencingToken: 0 }, expected: "below the current token" },
      // Future token: names no lease at all.
      { handle: { ...grant, fencingToken: 99 }, expected: "no lease exists for the presented token" },
      // Holder mismatch on the agent dimension (same tenant — a cross-tenant
      // binding is rejected earlier by validateRequest as invalid_input).
      { handle: { ...grant, principal: { tenantRef: "tenant_a", agentRef: "agent_other" } }, expected: "different principal" },
      // A target the governor has never seen.
      {
        handle: { target: { kind: "resource", ref: "never_leased" }, leaseId: "lease:x:1", fencingToken: 1, principal: TENANT_A },
        expected: "no active lease on the target",
      },
      // A bogus target kind maps to its own (empty) target key.
      {
        handle: { target: { kind: "agent", ref: "unknown_slot" }, leaseId: "lease:x:1", fencingToken: 1, principal: TENANT_A },
        expected: "no active lease on the target",
      },
    ];
    for (const { handle, expected } of bombardment) {
      const result = quota.consume({
        principal: TENANT_A,
        resourceClass: "compute_units",
        units: 1,
        lease: handle,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("lease_not_active");
        expect(result.detail).toContain(expected);
      }
    }
    // Zero charge across the whole bombardment; the live binding still admits.
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(0);
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1, lease: grant }).ok).toBe(true);
  });
});

describe("lease-plane crash injection", () => {
  it("contains a throwing observability sink in BOTH planes — outcomes stay typed and trails stay intact", () => {
    const crash = (): never => {
      throw new Error("sink crash");
    };
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 10 })], { onEvent: crash });
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 }).ok).toBe(true);
    const denied = quota.consume({ principal: TENANT_B, resourceClass: "compute_units", units: 1 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("undeclared_quota");
    expect(quota.auditTrail()).toHaveLength(2);
    expect(quota.totals()).toMatchObject({ consumedUnits: 1, denied: 1, events: 2 });

    const gov = governor({ onEvent: crash });
    expect(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }).ok).toBe(true);
    const heldDenied = gov.acquire({ target: BUF, principal: TENANT_B, ttlMs: 30_000 });
    expect(heldDenied.ok).toBe(false);
    if (!heldDenied.ok) expect(heldDenied.reason).toBe("target_held");
    expect(gov.auditTrail()).toHaveLength(2);
    expect(gov.totals()).toMatchObject({ granted: 1, denied: 1 });
  });

  it("FINDING H3-089-F2: a contract-violating (throwing) lease plane escapes consume() uncontained", () => {
    // Recorded containment gap (see report §Known Risks): the quota module
    // contains failing FenceResults but not a lease plane that THROWS. The
    // defect propagates past the admission boundary BEFORE any ledger
    // mutation, so canonical state is not corrupted — but the mission law
    // demands a typed outcome. Asserting CURRENT behavior as a tripwire;
    // flip to a typed lease_not_active denial when the gap is closed.
    const plane: QuotaLeasePlane = {
      assertFencingToken: () => {
        throw new Error("governor crash");
      },
    };
    const quota = quotaAuthority([ceiling()], { leasePlane: plane });
    expect(() =>
      quota.consume({
        principal: TENANT_A,
        resourceClass: "compute_units",
        units: 1,
        lease: { target: BUF, leaseId: "lease:x:1", fencingToken: 1, principal: TENANT_A },
      }),
    ).toThrowError("governor crash");
    // No partial charge preceded the uncontained throw.
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 3. Deadline races — injected clocks
 * ═════════════════════════════════════════════════════════════*/

describe("deadline races — leases (injected clock)", () => {
  it("at the exact expiry instant the holder loses fence, renewal and release — and cannot steal the lease back", () => {
    const clock = fakeClock(1_000_000);
    const gov = governor({ clock });
    const grant = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 60_000 }));
    expect(grant.expiresAtMs).toBe(1_060_000);

    clock.advanceMs(59_999); // one tick BEFORE expiry
    expect(gov.isHeld(BUF)).toBe(true);
    expect(gov.assertFencingToken(grant).ok).toBe(true);
    const raced = gov.acquire({ target: BUF, principal: TENANT_B, ttlMs: 30_000 });
    expect(raced.ok).toBe(false);
    if (!raced.ok) expect(raced.reason).toBe("target_held");

    clock.advanceMs(1); // now === expiresAtMs exactly
    const fence = gov.assertFencingToken(grant);
    expect(fence.ok).toBe(false);
    if (!fence.ok) expect(fence.reason).toBe("lease_expired");
    const renewed = gov.renew({ ...grant, ttlMs: 30_000 });
    expect(renewed.ok).toBe(false);
    if (!renewed.ok) expect(renewed.reason).toBe("lease_expired");
    const released = gov.release(grant);
    expect(released.ok).toBe(false);
    if (!released.ok) expect(released.reason).toBe("lease_expired");

    // The only path forward is a fresh acquire minting the next token.
    const fresh = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    expect(fresh.fencingToken).toBe(grant.fencingToken + 1);
    // The old handle is stale the moment the token moved.
    const stale = gov.assertFencingToken(grant);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale_fencing_token");
    // Expiry was observed exactly once despite the races.
    expect(gov.sweepExpired()).toEqual([]);
    expect(gov.auditTrail().filter((e) => e.kind === "lease_expired_observed")).toHaveLength(1);
  });

  it("renewal extends exactly to now+ttl one tick before expiry; at the new exact expiry it fails closed", () => {
    const clock = fakeClock(1_000_000);
    const gov = governor({ clock });
    const grant = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 60_000 }));
    clock.advanceMs(59_999);
    const renewed = gov.renew({ ...grant, ttlMs: 60_000 });
    expect(renewed.ok).toBe(true);
    const live = renewed.ok ? renewed.lease : null;
    if (live === null) throw new Error("setup: renewal should succeed");
    expect(live.expiresAtMs).toBe(clock.nowMs() + 60_000);
    clock.advanceMs(60_000); // exactly the renewed expiry instant
    const atBoundary = gov.renew({ ...live, ttlMs: 60_000 });
    expect(atBoundary.ok).toBe(false);
    if (!atBoundary.ok) expect(atBoundary.reason).toBe("lease_expired");
  });

  it("sweepExpired observes each expired lease exactly once and frees the target for a fresh acquire", () => {
    const clock = fakeClock(1_000_000);
    const gov = governor({ clock });
    const a = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 10_000 }));
    const b = grantOrThrow(gov.acquire({ target: { kind: "resource", ref: "second" }, principal: TENANT_B, ttlMs: 10_000 }));
    clock.advanceMs(10_001);
    expect(gov.sweepExpired()).toEqual([a.leaseId, b.leaseId]);
    expect(gov.sweepExpired()).toEqual([]);
    expect(gov.auditTrail().filter((e) => e.kind === "lease_expired_observed")).toHaveLength(2);
    expect(gov.isHeld(BUF)).toBe(false);
    const fresh = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_B, ttlMs: 10_000 }));
    expect(fresh.fencingToken).toBe(a.fencingToken + 1);
  });
});

describe("deadline races — quota windows (injected clock)", () => {
  it("retryAtMs is exact: denied at the last instant, restored at the rollover instant, and a regressed clock resurrects nothing", () => {
    const clock = fakeClock(0);
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 10, windowMs: 60_000 })], { clock });
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 10 }).ok).toBe(true);

    clock.advanceMs(59_999); // last instant of window 0
    const denied = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 });
    expect(denied.ok).toBe(false);
    if (!denied.ok && denied.quota !== null) {
      expect(denied.quota.windowStartedAtMs).toBe(0);
      expect(denied.quota.windowEndsAtMs).toBe(60_000);
      expect(denied.quota.retryAtMs).toBe(60_000);
      expect(denied.quota.retryAtMs).toBe(denied.quota.windowEndsAtMs);
    }

    clock.advanceMs(1); // first instant of window 1
    const rolled = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 10 });
    expect(rolled.ok).toBe(true);
    if (rolled.ok) expect(rolled.scopeLedgers[0]?.windowEndsAtMs).toBe(120_000);

    // Clock regression: the exhausted window-0 ledger persists — capacity is
    // never resurrected by moving time backwards.
    clock.advanceMs(-60_000);
    const regressed = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 });
    expect(regressed.ok).toBe(false);
    if (!regressed.ok && regressed.quota !== null) {
      expect(regressed.quota.consumedInWindow).toBe(10);
      expect(regressed.quota.windowStartedAtMs).toBe(0);
    }
  });
});

describe("waiter re-admission and FIFO races", () => {
  it("grantNextWaiter re-runs FULL admission at grant time and never leaves a stale head hostage", () => {
    const clock = fakeClock();
    const gov = governor({ clock, maxActiveLeases: 2 });
    const first = grantOrThrow(gov.acquire({ target: { kind: "resource", ref: "buf1" }, principal: TENANT_A, ttlMs: 30_000 }));
    grantOrThrow(gov.acquire({ target: { kind: "resource", ref: "buf2" }, principal: TENANT_A, ttlMs: 30_000 }));
    // tenant_a is now at its lease ceiling; the waiter enqueues fine (separate waiter budget).
    const ticket = gov.enqueueWaiter({ target: { kind: "resource", ref: "buf3" }, principal: TENANT_A, ttlMs: 30_000 });
    if (!ticket.ok) throw new Error("setup: waiter should enqueue");

    const grant = gov.grantNextWaiter({ kind: "resource", ref: "buf3" });
    expect(grant.ok).toBe(false);
    if (!grant.ok) {
      expect(grant.reason).toBe("quota_exhausted");
      expect(grant.quota).toMatchObject({ scope: "tenant", principalRef: "tenant_a", limit: 2, active: 2 });
    }
    // The failed grant dequeues the head — the queue never holds a stale hostage.
    expect(gov.waiters({ kind: "resource", ref: "buf3" })).toHaveLength(0);
    expect(gov.headWaiter({ kind: "resource", ref: "buf3" })).toBeNull();
    expect(gov.grantNextWaiter({ kind: "resource", ref: "buf3" }).ok).toBe(false);

    // Freeing a lease makes the retry land through the same full admission path.
    gov.release(first);
    const retried = gov.enqueueWaiter({ target: { kind: "resource", ref: "buf3" }, principal: TENANT_A, ttlMs: 30_000 });
    if (!retried.ok) throw new Error("setup: retry waiter should enqueue");
    const secondGrant = gov.grantNextWaiter({ kind: "resource", ref: "buf3" });
    expect(secondGrant.ok).toBe(true);
    if (secondGrant.ok) expect(secondGrant.waiterId).toBe(retried.ticket.waiterId);
    expect(gov.activeLeasesFor(TENANT_A)).toBe(2);
  });

  it("FIFO fairness denies queue jumps and foreign tickets with typed denials, then grants strictly in order", () => {
    const clock = fakeClock();
    const gov = governor({ clock });
    const holder = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    const w1 = gov.enqueueWaiter({ target: BUF, principal: TENANT_A, ttlMs: 30_000 });
    const w2 = gov.enqueueWaiter({ target: BUF, principal: TENANT_B, ttlMs: 30_000 });
    if (!w1.ok || !w2.ok) throw new Error("setup: waiters should enqueue");

    // A fresh acquire while the queue is non-empty is a queue jump.
    const jump = gov.acquire({ target: BUF, principal: TENANT_B, ttlMs: 30_000 });
    expect(jump.ok).toBe(false);
    if (!jump.ok) expect(jump.reason).toBe("queue_ahead");
    // Presenting the SECOND ticket's id (not the head) is still out of order.
    const jumpedTicket = gov.acquire({ target: BUF, principal: TENANT_B, ttlMs: 30_000, waiterId: w2.ticket.waiterId });
    expect(jumpedTicket.ok).toBe(false);
    if (!jumpedTicket.ok) expect(jumpedTicket.reason).toBe("queue_ahead");
    // The head ticket in foreign hands is a holder mismatch, not a grant.
    const foreign = gov.acquire({ target: BUF, principal: TENANT_B, ttlMs: 30_000, waiterId: w1.ticket.waiterId });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("holder_mismatch");
    // The head still owns the queue.
    expect(gov.headWaiter(BUF)?.waiterId).toBe(w1.ticket.waiterId);

    // Ordered grants: head first, then the next — never the reverse.
    gov.release(holder);
    const g1 = gov.grantNextWaiter(BUF);
    expect(g1.ok).toBe(true);
    if (g1.ok) expect(g1.waiterId).toBe(w1.ticket.waiterId);
    // While the first grantee holds the target, a further grant is a typed
    // single-holder denial — and a failed grant dequeues its head, so the
    // queue never holds a stale hostage.
    const heldAgain = gov.grantNextWaiter(BUF);
    expect(heldAgain.ok).toBe(false);
    if (!heldAgain.ok) expect(heldAgain.reason).toBe("target_held");
    expect(gov.waiters(BUF)).toHaveLength(0);
    if (g1.ok) gov.release(g1.lease);
    const w3 = gov.enqueueWaiter({ target: BUF, principal: TENANT_B, ttlMs: 30_000 });
    if (!w3.ok) throw new Error("setup: re-enqueue should succeed");
    const g2 = gov.grantNextWaiter(BUF);
    expect(g2.ok).toBe(true);
    if (g2.ok) expect(g2.waiterId).toBe(w3.ticket.waiterId);
    expect(gov.grantNextWaiter(BUF).ok).toBe(false);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 4. Adversarial inputs — typed denials, never uncontained throws
 * ═════════════════════════════════════════════════════════════*/

describe("adversarial inputs — lease governor", () => {
  it("denies every malformed ttl with a typed code and admits a ttl exactly at the bound", () => {
    const clock = fakeClock();
    const gov = governor({ clock, maxTtlMs: 60_000 });
    const malformed: readonly [number, string][] = [
      [Number.NaN, "invalid_input"],
      [Number.POSITIVE_INFINITY, "invalid_input"],
      [Number.NEGATIVE_INFINITY, "invalid_input"],
      [0, "invalid_input"],
      [-0, "invalid_input"],
      [-1, "invalid_input"],
      [Number.MAX_SAFE_INTEGER, "ttl_exceeds_bound"],
      [60_001, "ttl_exceeds_bound"],
    ];
    for (const [ttlMs, expected] of malformed) {
      const result = gov.acquire({ target: BUF, principal: TENANT_A, ttlMs });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(expected);
    }
    // No target state was created by any denied acquire.
    expect(gov.isHeld(BUF)).toBe(false);
    // The bound itself is inclusive — no off-by-one lockout.
    expect(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 60_000 }).ok).toBe(true);
  });

  it("denies malformed targets and principals with typed codes", () => {
    const gov = governor();
    const attempts: readonly { request: { target: LeaseTarget; principal: LeasePrincipal; ttlMs: number }; expected: string }[] = [
      { request: { target: { kind: "bogus" as unknown as LeaseTargetKind, ref: "x" }, principal: TENANT_A, ttlMs: 1_000 }, expected: "invalid_input" },
      { request: { target: { kind: "resource", ref: "" }, principal: TENANT_A, ttlMs: 1_000 }, expected: "invalid_input" },
      { request: { target: { kind: "resource", ref: "   " }, principal: TENANT_A, ttlMs: 1_000 }, expected: "invalid_input" },
      { request: { target: BUF, principal: { tenantRef: "", agentRef: null }, ttlMs: 1_000 }, expected: "invalid_input" },
      { request: { target: BUF, principal: { tenantRef: "tenant_a", agentRef: "  " }, ttlMs: 1_000 }, expected: "invalid_input" },
    ];
    for (const { request, expected } of attempts) {
      const result = gov.acquire(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(expected);
    }
  });

  it("renewal and release contain a NaN fencing token as stale — the live lease state is untouched", () => {
    const clock = fakeClock();
    const gov = governor({ clock });
    const grant = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    const nanHandle: LeaseHandleRef = { ...grant, fencingToken: Number.NaN };
    const renewed = gov.renew({ ...nanHandle, ttlMs: 30_000 });
    expect(renewed.ok).toBe(false);
    if (!renewed.ok) expect(renewed.reason).toBe("stale_fencing_token");
    const released = gov.release(nanHandle);
    expect(released.ok).toBe(false);
    if (!released.ok) expect(released.reason).toBe("stale_fencing_token");
    // The genuine handle still fences and renews: nothing was corrupted.
    expect(gov.assertFencingToken(grant).ok).toBe(true);
    expect(gov.renew({ ...grant, ttlMs: 30_000 }).ok).toBe(true);
  });

  it("renewal validates its ttl independently without touching lease state on denial", () => {
    const clock = fakeClock();
    const gov = governor({ clock, maxTtlMs: 60_000 });
    const grant = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    for (const [ttlMs, expected] of [
      [0, "invalid_input"],
      [-5, "invalid_input"],
      [Number.NaN, "invalid_input"],
      [Number.POSITIVE_INFINITY, "invalid_input"],
      [60_001, "ttl_exceeds_bound"],
    ] as const) {
      const result = gov.renew({ ...grant, ttlMs });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(expected);
    }
    expect(gov.currentLease(BUF)?.expiresAtMs).toBe(grant.expiresAtMs);
  });

  it("waiter surfaces resolve to typed codes under adversarial use", () => {
    const clock = fakeClock();
    const gov = governor({ clock, maxTtlMs: 60_000 });
    expect(gov.grantNextWaiter(BUF)).toMatchObject({ ok: false, reason: "waiter_queue_empty" });
    expect(gov.cancelWaiter({ target: BUF, waiterId: "waiter:missing", principal: TENANT_A })).toMatchObject({
      ok: false,
      reason: "waiter_not_found",
    });
    const ticket = gov.enqueueWaiter({ target: BUF, principal: TENANT_A, ttlMs: 30_000 });
    if (!ticket.ok) throw new Error("setup: waiter should enqueue");
    expect(gov.cancelWaiter({ target: BUF, waiterId: ticket.ticket.waiterId, principal: TENANT_B })).toMatchObject({
      ok: false,
      reason: "holder_mismatch",
    });
    expect(gov.headWaiter(BUF)?.waiterId).toBe(ticket.ticket.waiterId);
    expect(gov.enqueueWaiter({ target: BUF, principal: TENANT_A, ttlMs: 60_001 })).toMatchObject({
      ok: false,
      reason: "ttl_exceeds_bound",
    });
    expect(
      gov.enqueueWaiter({ target: BUF, principal: { tenantRef: "tenant_undeclared", agentRef: null }, ttlMs: 1_000 }),
    ).toMatchObject({ ok: false, reason: "quota_principal_undeclared" });
    // The valid ticket survives every adversarial attempt.
    expect(gov.waiters(BUF)).toHaveLength(1);
  });
});

describe("adversarial inputs — quota authority", () => {
  it("denies non-finite, oversized and mistyped unit quantities with typed invalid_input", () => {
    // NaN / 0 / -1 / fractional units are covered by h3-019; this deepens
    // with infinities, oversized finite magnitudes and runtime mistypes.
    const quota = quotaAuthority([ceiling({ maxUnitsPerWindow: 100 })], { clock: fakeClock() });
    const badUnits: readonly unknown[] = [
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1e21,
      MAX_UNITS_PER_CONSUMPTION + 1,
      "10",
      null,
      {},
    ];
    for (const units of badUnits) {
      const result = quota.consume({
        principal: TENANT_A,
        resourceClass: "compute_units",
        units: units as unknown as number,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_input");
    }
    const [tenant] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenant?.consumedInWindow).toBe(0);
  });

  it("denies null and malformed principals with typed invalid_input", () => {
    const quota = quotaAuthority([ceiling()], { clock: fakeClock() });
    const attempts: readonly LeasePrincipal[] = [
      null as unknown as LeasePrincipal,
      undefined as unknown as LeasePrincipal,
      { tenantRef: 42 } as unknown as LeasePrincipal,
      { tenantRef: "tenant_a", agentRef: Number.NaN } as unknown as LeasePrincipal,
      { tenantRef: "tenant_a", agentRef: 7 } as unknown as LeasePrincipal,
    ];
    for (const principal of attempts) {
      const result = quota.consume({ principal, resourceClass: "compute_units", units: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_input");
    }
  });

  it("denies malformed lease bindings BEFORE the lease plane is ever consulted", () => {
    const clock = fakeClock();
    let planeCalls = 0;
    const plane: QuotaLeasePlane = {
      assertFencingToken: () => {
        planeCalls += 1;
        return { ok: true };
      },
    };
    const quota = quotaAuthority([ceiling()], { clock, leasePlane: plane });
    const malformed: readonly unknown[] = [
      { target: null },
      { target: BUF, leaseId: "lease:x:1" }, // missing fencingToken
      { target: BUF, fencingToken: 1, principal: TENANT_A }, // missing leaseId
      { target: BUF, leaseId: "lease:x:1", fencingToken: 1, principal: { tenantRef: "tenant_other", agentRef: null } },
      { target: BUF, leaseId: "lease:x:1", fencingToken: 1 }, // missing principal
    ];
    for (const lease of malformed) {
      const result = quota.consume({
        principal: TENANT_A,
        resourceClass: "compute_units",
        units: 1,
        lease: lease as unknown as ConsumptionRequest["lease"],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_input");
    }
    expect(planeCalls).toBe(0);
    // A well-formed binding does reach the plane (counter sanity).
    const wellFormed = quota.consume({
      principal: TENANT_A,
      resourceClass: "compute_units",
      units: 1,
      lease: { target: BUF, leaseId: "lease:x:1", fencingToken: 1, principal: TENANT_A },
    });
    expect(wellFormed.ok).toBe(true);
    expect(planeCalls).toBe(1);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 5. Approval chains — audit containment under failure
 * ═════════════════════════════════════════════════════════════*/

describe("approval chains — audit containment under failure", () => {
  it("the gate ALWAYS emits its frozen audit — even for tenant-mismatched blocked routing, bound to the CASE tenant", () => {
    const { kase, routing } = routedCase({}, { tenantId: OTHER_TENANT });
    expect(routing.ok).toBe(false);
    const outcome = resolveFlow(kase, routing, [], DECIDE_1);
    expect(outcome.kind).toBe("blocked_no_eligible_resolver");
    if (outcome.kind === "blocked_no_eligible_resolver") expect(outcome.code).toBe("chain_tenant_mismatch");
    const gate = gateExecutionOnResolution(kase, outcome, DECIDE_1);
    expect(gate.gateDecision).toBe("DENIED");
    // The audit carries the CASE tenant, never the mis-scoped chain's tenant.
    expect(gate.audit.tenantId).toBe(kase.tenantId);
    expect(gate.audit.tenantId).not.toBe(OTHER_TENANT);
    expect(gate.audit.outcomeKind).toBe("blocked_no_eligible_resolver");
    expect(gate.audit.reasons[0]).toContain("impossible");
    expect(gate.audit.auditId.startsWith("sha256:")).toBe(true);
    expect(gate.audit.requesterKind).toBe("ai");
    expect(Object.isFrozen(gate)).toBe(true);
    expect(Object.isFrozen(gate.audit)).toBe(true);
  });

  it("every forged-record defect surfaces in ONE typed invalid outcome — defects are aggregated, never absorbed", () => {
    const { kase, routing, chain } = routedCase({}, { resolvers: [ALICE, BOB] });
    if (!routing.ok) throw new Error("setup: routing should succeed");
    const base = approveRecord(kase, routing, chain, ALICE);
    const forged: readonly ResolutionRecord[] = [
      { ...base, resolutionId: "res-f1", tenantId: OTHER_TENANT },
      { ...base, resolutionId: "res-f2", resolverRef: BOB, identityKind: "ai" },
      { ...base, resolutionId: "res-f3", resolverRef: kase.requesterRef },
      { ...base, resolutionId: "res-f4", resolverRef: CAROL },
    ];
    const outcome = resolveFlow(kase, routing, forged, DECIDE_1);
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") {
      expect(outcome.reasons).toHaveLength(4);
      const joined = outcome.reasons.join(" | ");
      expect(joined).toContain(`carries tenant "${OTHER_TENANT}"`);
      expect(joined).toContain("non-human identity");
      expect(joined).toContain("self-resolution is denied");
      expect(joined).toContain("no routing position");
    }
    const gate = gateExecutionOnResolution(kase, outcome, DECIDE_1);
    expect(gate.gateDecision).toBe("DENIED");
    expect(gate.audit.outcomeKind).toBe("invalid");
    expect(gate.audit.reasons).toHaveLength(4);
    for (const reason of gate.audit.reasons) expect(reason.startsWith("record set invalid:")).toBe(true);
  });

  it("adversarial resolution payloads fail with a TYPED ResolutionFlowError code — never a raw error", () => {
    const { kase, routing, chain } = routedCase();
    const attempts: readonly Partial<ResolutionInput>[] = [
      { decidedAt: "garbage" },
      { verdict: "maybe" } as unknown as Partial<ResolutionInput>,
      { capabilities: CAP } as unknown as Partial<ResolutionInput>,
      { evidence: 42 } as unknown as Partial<ResolutionInput>,
      { tenantId: "" },
      { resolutionId: "   " },
      { identityKind: "robot" } as unknown as Partial<ResolutionInput>,
    ];
    for (const overrides of attempts) {
      expect(
        codeOf(() =>
          recordResolution(kase, routing, declareApprovalChain(chain), [], {
            resolutionId: "res-x",
            verdict: "approve",
            resolverRef: ALICE,
            identityKind: "human",
            tenantId: kase.tenantId,
            capabilities: [CAP],
            decidedAt: DECIDE_1,
            evidence: "ok",
            ...overrides,
          }),
        ),
      ).toBe("invalid_input");
    }
  });

  it("garbage `at` instants fail typed at BOTH resolveFlow and the execution gate", () => {
    const { kase, routing } = routedCase();
    for (const at of ["not-a-time", "   ", "2026-13-45T00:00:00.000Z"]) {
      expect(codeOf(() => resolveFlow(kase, routing, [], at))).toBe("invalid_input");
      expect(codeOf(() => gateExecutionOnResolution(kase, { kind: "pending", approvals: [], requiredResolvers: 1, resolveBy: null }, at))).toBe(
        "invalid_input",
      );
    }
  });
});

describe("approval chains — deadline races (fixed instants)", () => {
  it("routing rejects a deadline exactly at the request instant and admits one millisecond later", () => {
    const exact = routedCase({}, { resolveBy: REQUESTED_AT });
    expect(exact.routing.ok).toBe(false);
    if (!exact.routing.ok) expect(exact.routing.code).toBe("deadline_invalid");
    const oneMsLater = routedCase({}, { resolveBy: ONE_MS_AFTER_REQUEST });
    expect(oneMsLater.routing.ok).toBe(true);
  });

  it("a resolution decided exactly AT the chain deadline is denied; one millisecond before is recorded", () => {
    const { kase, routing, chain } = routedCase();
    expect(
      codeOf(() => approveRecord(kase, routing, chain, ALICE, { decidedAt: DEADLINE })),
    ).toBe("deadline_exceeded");
    const justInTime = approveRecord(kase, routing, chain, ALICE, { decidedAt: ONE_MS_BEFORE_DEADLINE });
    expect(justInTime.decidedAt).toBe(ONE_MS_BEFORE_DEADLINE);
    // The just-in-time record still closes the routine case as approved.
    expect(resolveFlow(kase, routing, [justInTime], ONE_MS_BEFORE_DEADLINE).kind).toBe("approved");
  });

  it("resolveFlow blocks at exactly the deadline and stays pending one millisecond before", () => {
    const { kase, routing, chain } = routedCase({ riskTier: "elevated" });
    const only = approveRecord(kase, routing, chain, ALICE);
    const before = resolveFlow(kase, routing, [only], ONE_MS_BEFORE_DEADLINE);
    expect(before.kind).toBe("pending");
    const atDeadline = resolveFlow(kase, routing, [only], DEADLINE);
    expect(atDeadline.kind).toBe("blocked_unresolved");
    if (atDeadline.kind === "blocked_unresolved") expect(atDeadline.detail).toContain("1/2");
  });
});

/* ═════════════════════════════════════════════════════════════
 * 6. Recorded containment findings (H3-089) — CURRENT behavior
 * ═════════════════════════════════════════════════════════════*/

describe("recorded containment findings (see progress/h3-wave/H3-089.report.md)", () => {
  it("FINDING H3-089-F1: a NaN fencing token PASSES the governor fence — fail-open recorded", () => {
    // Recorded containment gap: NaN compares false against both `<` and `>`
    // in assertFencingToken, so a NaN token falls through every token check
    // and is accepted whenever the principal matches and the lease is live.
    // The fail-closed law demands denial. Asserting CURRENT behavior as a
    // tripwire; flip to ok:false when the gap is closed.
    const clock = fakeClock();
    const gov = governor({ clock });
    const grant = grantOrThrow(gov.acquire({ target: BUF, principal: TENANT_A, ttlMs: 30_000 }));
    const nanHandle: LeaseHandleRef = { ...grant, fencingToken: Number.NaN };
    const fence = gov.assertFencingToken(nanHandle);
    expect(fence.ok).toBe(true);
  });

  it("FINDING H3-089-F3: a null target crashes acquire with a raw TypeError before validation", () => {
    // Recorded containment gap: targetKey() runs BEFORE validateAcquireRequest(),
    // so the validator's null-target branch is dead code on this path and the
    // malformed shape escapes as an uncontained TypeError (same ordering in
    // enqueueWaiter/cancelWaiter). Asserting CURRENT behavior as a tripwire.
    const gov = governor();
    expect(() =>
      gov.acquire({ target: null as unknown as LeaseTarget, principal: TENANT_A, ttlMs: 1_000 }),
    ).toThrowError(TypeError);
  });

  it("FINDING H3-089-F4: non-JSON-serializable subjects escape openResolutionFlow as raw errors", () => {
    // Recorded containment gap: digestContent → canonicalJson throws raw
    // TypeError (BigInt) / RangeError (circular) instead of a typed
    // ResolutionFlowError("invalid_input"). Asserting CURRENT behavior.
    expect(() => openResolutionFlow(flowInput({ subject: BigInt(42) }))).toThrowError(TypeError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => openResolutionFlow(flowInput({ subject: circular }))).toThrowError(RangeError);
  });

  it("FINDING H3-089-F5: a forged record with an unparseable decidedAt PASSES eligibility and approves the case", () => {
    // Recorded containment gap: describeIneligibleRecord compares Date.parse
    // results; NaN is neither `< requestedAt` nor `>= resolveBy`, so a forged
    // record outside any real time window counts as a valid approval — the
    // deadline re-derivation is fail-open for non-parseable timestamps.
    // Asserting CURRENT behavior as a tripwire; flip to "invalid" when fixed.
    const { kase, routing, chain } = routedCase({}, { resolvers: [ALICE, BOB] });
    if (!routing.ok) throw new Error("setup: routing should succeed");
    const real = approveRecord(kase, routing, chain, ALICE);
    const forged: ResolutionRecord = { ...real, resolutionId: "res-forged", resolverRef: BOB, decidedAt: "garbage" };
    const outcome = resolveFlow(kase, routing, [real, forged], DECIDE_1);
    expect(outcome.kind).toBe("approved");
  });

  it("FINDING H3-089-F6: a forged record without evidence crashes resolveFlow with a raw TypeError", () => {
    // Recorded containment gap: describeIneligibleRecord calls
    // record.evidence.trim() without guarding undefined, so a drifted record
    // escapes resolveFlow as an uncontained TypeError instead of a typed
    // "invalid" outcome. Asserting CURRENT behavior as a tripwire.
    const { kase, routing, chain } = routedCase();
    if (!routing.ok) throw new Error("setup: routing should succeed");
    const real = approveRecord(kase, routing, chain, ALICE);
    const forged = { ...real, evidence: undefined } as unknown as ResolutionRecord;
    expect(() => resolveFlow(kase, routing, [forged], DECIDE_1)).toThrowError(TypeError);
  });
});