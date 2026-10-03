/**
 * CoreGrid — H3-019 resource-quota contract tests (mission B-019 / J-031).
 * Fail-closed quota exhaustion semantics layered on the lease contracts:
 * undeclared principals admit nowhere, exhaustion is a typed deny with
 * structured detail, lease-backed consumption requires a live fencing token,
 * and every denial is audited. Pure offline: no network, no database, no
 * secrets.
 */
import { describe, expect, it } from "vitest";
import type { AdapterClock } from "../../frontend/src/lib/adapters/failure-policy";
import { LeaseQuotaGovernor } from "../../frontend/src/lib/reliability/leases";
import {
  MAX_QUOTA_WINDOW_MS,
  MAX_UNITS_PER_CONSUMPTION,
  MAX_UNITS_PER_WINDOW,
  ResourceQuotaAuthority,
  parseResourceQuotaRegistry,
  type QuotaCeiling,
  type QuotaLeasePlane,
} from "../../frontend/src/lib/reliability/quotas";

/* Injectable clock: all time flows from here, nothing runs implicitly. */
function fakeClock(startMs = 1_000_000): AdapterClock & { advanceMs(delta: number): void } {
  let now = startMs;
  return {
    nowMs: () => now,
    // Nothing in the contracts under test awaits time; the delay is a
    // rejected affordance (fail fast if it were ever used implicitly).
    delay: () => Promise.reject(new Error("fakeClock: implicit time flow is forbidden in these tests")),
    advanceMs: (delta: number) => {
      now += delta;
    },
  };
}

const PROVENANCE = {
  declaredBy: "role:quota-lease-engineer",
  authority: "AGENTS.md §42 / H3 wave mission B-019",
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

const TENANT_A = { tenantRef: "tenant_a", agentRef: null };
const TENANT_B = { tenantRef: "tenant_b", agentRef: null };
const AGENT_X = { tenantRef: "tenant_a", agentRef: "agent_x" };

function registry(...ceilings: QuotaCeiling[]) {
  return parseResourceQuotaRegistry({ ceilings });
}

function authority(ceilings: QuotaCeiling[], options: { clock?: AdapterClock; leasePlane?: QuotaLeasePlane } = {}) {
  const parsed = registry(...ceilings);
  if (!parsed.ok) throw new Error(`test registry invalid: ${parsed.issues.join("; ")}`);
  return new ResourceQuotaAuthority({
    registry: parsed.registry,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.leasePlane !== undefined ? { leasePlane: options.leasePlane } : {}),
  });
}

describe("registry parsing (fail-closed declarations)", () => {
  it("accepts a valid registry and exposes the ceilings", () => {
    const parsed = registry(ceiling());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.registry.ceilings).toHaveLength(1);
  });

  it("rejects an empty registry — nothing is assumed", () => {
    expect(registry().ok).toBe(false);
    expect(parseResourceQuotaRegistry({ ceilings: [] }).ok).toBe(false);
    expect(parseResourceQuotaRegistry(null).ok).toBe(false);
    expect(parseResourceQuotaRegistry({ ceilings: [{ scope: "tenant" }] }).ok).toBe(false);
  });

  it("rejects duplicate bindings — one binding per scope, principal and class", () => {
    const parsed = registry(ceiling(), ceiling({ maxUnitsPerWindow: 5 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]).toContain("duplicate quota binding");
  });

  it("rejects unbounded windows and unbounded budgets", () => {
    expect(registry(ceiling({ windowMs: MAX_QUOTA_WINDOW_MS + 1 })).ok).toBe(false);
    expect(registry(ceiling({ windowMs: 0 })).ok).toBe(false);
    expect(registry(ceiling({ maxUnitsPerWindow: MAX_UNITS_PER_WINDOW + 1 })).ok).toBe(false);
  });

  it("accepts a zero-limit ceiling as a valid deny-all binding", () => {
    const parsed = registry(ceiling({ maxUnitsPerWindow: 0 }));
    expect(parsed.ok).toBe(true);
  });

  it("rejects anonymous ceilings — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = ceiling({ provenance: { ...PROVENANCE, declaredBy: "" } });
    expect(registry(anonymous).ok).toBe(false);
  });
});

describe("fail-closed admission (undeclared admits nowhere)", () => {
  it("denies an undeclared tenant with undeclared_quota", () => {
    const quota = authority([ceiling({ principalRef: "tenant_a" })]);
    const result = quota.consume({ principal: TENANT_B, resourceClass: "compute_units", units: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("undeclared_quota");
      expect(result.quota).toBeNull();
    }
  });

  it("denies an undeclared agent even when its tenant is declared", () => {
    const quota = authority([
      ceiling({ principalRef: "tenant_a" }),
      ceiling({ scope: "agent", principalRef: "agent_y" }),
    ]);
    const result = quota.consume({ principal: AGENT_X, resourceClass: "compute_units", units: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("undeclared_quota");
      expect(result.detail).toContain("agent_x");
    }
  });

  it("denies an undeclared resource class for a declared tenant", () => {
    const quota = authority([ceiling()]);
    const result = quota.consume({ principal: TENANT_A, resourceClass: "other_units", units: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("undeclared_quota");
  });

  it("enforces a zero-limit ceiling as a total deny-all", () => {
    const quota = authority([ceiling({ maxUnitsPerWindow: 0 })]);
    const result = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("quota_exhausted");
      expect(result.quota).toMatchObject({ scope: "tenant", limit: 0, consumedInWindow: 0 });
    }
  });
});

describe("quota exhaustion and window rollover", () => {
  it("admits consumption up to the ceiling and denies the unit that would exceed it", () => {
    const clock = fakeClock();
    const quota = authority([ceiling({ maxUnitsPerWindow: 10 })], { clock });
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 7 }).ok).toBe(true);
    const denied = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 4 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("quota_exhausted");
      expect(denied.quota).toMatchObject({
        scope: "tenant",
        principalRef: "tenant_a",
        resourceClass: "compute_units",
        limit: 10,
        consumedInWindow: 7,
      });
      expect(denied.quota?.retryAtMs).toBeGreaterThan(clock.nowMs());
    }
  });

  it("carries a structured window on exhaustion and restores capacity exactly at rollover", () => {
    const clock = fakeClock(0);
    const quota = authority([ceiling({ maxUnitsPerWindow: 10, windowMs: 60_000 })], { clock });
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 10 }).ok).toBe(true);
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 }).ok).toBe(false);
    clock.advanceMs(59_999);
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 }).ok).toBe(false);
    clock.advanceMs(1);
    const rolled = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 10 });
    expect(rolled.ok).toBe(true);
  });

  it("keeps scopes independent: agent consumption counts against tenant and agent ceilings separately", () => {
    const quota = authority([
      ceiling({ principalRef: "tenant_a", maxUnitsPerWindow: 10 }),
      ceiling({ scope: "agent", principalRef: "agent_x", maxUnitsPerWindow: 3 }),
    ]);
    expect(quota.consume({ principal: AGENT_X, resourceClass: "compute_units", units: 3 }).ok).toBe(true);
    const denied = quota.consume({ principal: AGENT_X, resourceClass: "compute_units", units: 1 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("quota_exhausted");
      expect(denied.quota).toMatchObject({ scope: "agent", principalRef: "agent_x", limit: 3, consumedInWindow: 3 });
    }
    // The tenant ceiling has room: a non-agent principal still consumes.
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 7 }).ok).toBe(true);
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 }).ok).toBe(false);
  });

  it("denies invalid input before any quota state is touched", () => {
    const quota = authority([ceiling()]);
    for (const units of [0, -1, 1.5, Number.NaN, MAX_UNITS_PER_CONSUMPTION + 1]) {
      const result = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_input");
    }
    const badClass = quota.consume({ principal: TENANT_A, resourceClass: "NOT A REF", units: 1 });
    expect(badClass.ok).toBe(false);
  });
});

describe("lease layering (consumption over live leases)", () => {
  function leasePlane(governor: LeaseQuotaGovernor): QuotaLeasePlane {
    return { assertFencingToken: (request) => governor.assertFencingToken(request) };
  }

  function leaseBacking(clock: AdapterClock) {
    return new LeaseQuotaGovernor({
      maxTtlMs: 60_000,
      quotas: {
        tenants: { tenant_a: { maxActiveLeases: 5, maxWaiters: 5 }, tenant_b: { maxActiveLeases: 5, maxWaiters: 5 } },
        agents: { agent_x: { maxActiveLeases: 5, maxWaiters: 5 } },
      },
      clock,
    });
  }

  it("admits lease-backed consumption when the binding is the live fencing token", () => {
    const clock = fakeClock();
    const governor = leaseBacking(clock);
    const lease = governor.acquire({
      target: { kind: "resource", ref: "shared_buffer" },
      principal: TENANT_A,
      ttlMs: 30_000,
    });
    if (!lease.ok) throw new Error("setup: lease should be granted");
    const quota = authority([ceiling()], { clock, leasePlane: leasePlane(governor) });
    const result = quota.consume({
      principal: TENANT_A,
      resourceClass: "compute_units",
      units: 1,
      lease: lease.lease,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.leaseFencingToken).toBe(lease.lease.fencingToken);
  });

  it("fails closed when the lease has expired — the former holder cannot consume", () => {
    const clock = fakeClock();
    const governor = leaseBacking(clock);
    const lease = governor.acquire({
      target: { kind: "resource", ref: "shared_buffer" },
      principal: TENANT_A,
      ttlMs: 30_000,
    });
    if (!lease.ok) throw new Error("setup: lease should be granted");
    const quota = authority([ceiling()], { clock, leasePlane: leasePlane(governor) });
    clock.advanceMs(30_001);
    const result = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1, lease: lease.lease });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("lease_not_active");
      expect(result.detail).toContain("expired");
    }
  });

  it("fails closed on a stale fencing token and on a foreign holder", () => {
    const clock = fakeClock();
    const governor = leaseBacking(clock);
    const first = governor.acquire({ target: { kind: "resource", ref: "shared_buffer" }, principal: TENANT_A, ttlMs: 30_000 });
    if (!first.ok) throw new Error("setup: first lease should be granted");
    governor.release(first.lease);
    const second = governor.acquire({ target: { kind: "resource", ref: "shared_buffer" }, principal: TENANT_A, ttlMs: 30_000 });
    if (!second.ok) throw new Error("setup: second lease should be granted");
    const quota = authority([ceiling()], { clock, leasePlane: leasePlane(governor) });
    const stale = quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1, lease: first.lease });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("lease_not_active");
    // Same tenant, different principal: the lease plane's holder check denies.
    const foreign = quota.consume({ principal: AGENT_X, resourceClass: "compute_units", units: 1, lease: second.lease });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("lease_not_active");
  });

  it("fails closed when a lease binding is presented with no lease plane configured", () => {
    const clock = fakeClock();
    const quota = authority([ceiling()], { clock });
    const result = quota.consume({
      principal: TENANT_A,
      resourceClass: "compute_units",
      units: 1,
      lease: {
        target: { kind: "resource", ref: "shared_buffer" },
        leaseId: "lease:resource:shared_buffer:1",
        fencingToken: 1,
        principal: TENANT_A,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("lease_plane_unavailable");
      expect(result.detail).toContain("fails closed");
    }
  });

  it("does not require a lease for quota-only admission", () => {
    const quota = authority([ceiling()]);
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 }).ok).toBe(true);
  });
});

describe("observability and hygiene", () => {
  it("audits every consumption and denial; denials are never silent", () => {
    const quota = authority([ceiling({ maxUnitsPerWindow: 2 })]);
    quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 2 });
    quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 });
    const trail = quota.auditTrail();
    expect(trail).toHaveLength(2);
    expect(trail[0]?.kind).toBe("quota_consumed");
    expect(trail[1]?.kind).toBe("quota_denied");
    const totals = quota.totals();
    expect(totals).toMatchObject({ consumedUnits: 2, denied: 1, events: 2 });
  });

  it("streams events to the injected sink and contains sink failures", () => {
    const seen: string[] = [];
    const parsed = registry(ceiling());
    if (!parsed.ok) throw new Error("setup");
    const quota = new ResourceQuotaAuthority({
      registry: parsed.registry,
      onEvent: (event) => {
        seen.push(event.kind);
        if (event.kind === "quota_consumed") throw new Error("sink failure must not break containment");
      },
    });
    expect(quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 }).ok).toBe(true);
    expect(seen).toEqual(["quota_consumed"]);
  });

  it("gives a fail-closed snapshot for undeclared scopes and a live one for declared scopes", () => {
    const clock = fakeClock(120_000);
    const quota = authority([ceiling({ maxUnitsPerWindow: 10, windowMs: 60_000 })], { clock });
    quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 4 });
    const [tenantSnapshot] = quota.snapshot(TENANT_A, "compute_units");
    expect(tenantSnapshot).toMatchObject({
      scope: "tenant",
      declared: true,
      limit: 10,
      consumedInWindow: 4,
      remainingInWindow: 6,
    });
    const agentSnapshot = quota.snapshot(AGENT_X, "compute_units")[1];
    expect(agentSnapshot).toMatchObject({ scope: "agent", declared: false, limit: 0, remainingInWindow: null });
  });

  it("prunes only closed windows; the live window survives", () => {
    const clock = fakeClock(0);
    const quota = authority([ceiling({ maxUnitsPerWindow: 10, windowMs: 60_000 })], { clock });
    quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 5 });
    expect(quota.pruneClosedWindows()).toBe(0);
    clock.advanceMs(60_001);
    quota.consume({ principal: TENANT_A, resourceClass: "compute_units", units: 1 });
    expect(quota.pruneClosedWindows()).toBe(1);
    expect(quota.snapshot(TENANT_A, "compute_units")[0]?.consumedInWindow).toBe(1);
  });
});
