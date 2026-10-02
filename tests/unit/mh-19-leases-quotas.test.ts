/**
 * CoreGrid — reliability lease & quota contract tests (J-031 / V1CAP-055).
 *
 * MISSION H2-19. Validates the fail-closed admission contract over the
 * deterministic AdapterClock (`adapters/failure-policy.ts` pattern):
 * bounded TTL expiry (no infinite leases), single-holder enforcement,
 * steal-after-expiry denied to the expired holder (no resurrection), quota
 * ceilings per tenant and per agent with structured denial + audit, FIFO
 * waiter fairness, and renewal denied to non-holders.
 */

import { describe, expect, it } from "vitest";
import type { AdapterClock } from "@/lib/adapters/failure-policy";
import {
  LeaseQuotaGovernor,
  type LeasePrincipal,
  type LeaseQuotaAuditEvent,
  type LeaseQuotaGovernorConfig,
} from "@/lib/reliability/leases";

/* ─────────────────────────────────────────────────────────────
 * Deterministic clock (AdapterClock injection pattern)
 * ────────────────────────────────────────────────────────────*/

class ManualClock implements AdapterClock {
  private current: number;

  constructor(startMs = 1_000) {
    this.current = startMs;
  }

  nowMs(): number {
    return this.current;
  }

  async delay(ms: number): Promise<void> {
    this.current += ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const MAX_TTL = 30_000;

const AGENT_CEILING_1 = { maxActiveLeases: 1, maxWaiters: 1 };
const TENANT_CEILING_2 = { maxActiveLeases: 2, maxWaiters: 2 };

function makeGovernor(
  overrides: Partial<LeaseQuotaGovernorConfig> & {
    quotas?: LeaseQuotaGovernorConfig["quotas"];
  } = {},
): { governor: LeaseQuotaGovernor; clock: ManualClock; events: LeaseQuotaAuditEvent[] } {
  const clock = new ManualClock();
  const events: LeaseQuotaAuditEvent[] = [];
  const governor = new LeaseQuotaGovernor({
    maxTtlMs: MAX_TTL,
    quotas: {
      tenants: {
        "tenant-a": TENANT_CEILING_2,
        "tenant-b": TENANT_CEILING_2,
        "tenant-one-lease": { maxActiveLeases: 1, maxWaiters: 1 },
        "tenant-zero": { maxActiveLeases: 0, maxWaiters: 0 },
      },
      agents: {
        "agent-w1": AGENT_CEILING_1,
        "agent-w2": AGENT_CEILING_1,
        "agent-w3": AGENT_CEILING_1,
        "agent-quiet": { maxActiveLeases: 1, maxWaiters: 1 },
      },
    },
    clock,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { governor, clock, events };
}

const agent = (agentRef: string, tenantRef = "tenant-a"): LeasePrincipal => ({
  tenantRef,
  agentRef,
});
const human = (tenantRef: string): LeasePrincipal => ({ tenantRef, agentRef: null });
const resource = (ref: string) => ({ kind: "resource" as const, ref });
const agentSlot = (ref: string) => ({ kind: "agent" as const, ref });

/* ─────────────────────────────────────────────────────────────
 * Construction (fail fast) + bounded TTL
 * ────────────────────────────────────────────────────────────*/

describe("construction", () => {
  it("rejects a non-positive or non-finite maxTtlMs", () => {
    const { clock } = makeGovernor();
    expect(() => new LeaseQuotaGovernor({ maxTtlMs: 0, quotas: { tenants: {}, agents: {} }, clock })).toThrow(TypeError);
    expect(() => new LeaseQuotaGovernor({ maxTtlMs: -5, quotas: { tenants: {}, agents: {} }, clock })).toThrow(TypeError);
    expect(() =>
      new LeaseQuotaGovernor({ maxTtlMs: Number.POSITIVE_INFINITY, quotas: { tenants: {}, agents: {} }, clock }),
    ).toThrow(TypeError);
  });

  it("rejects invalid ceilings (negative, fractional, empty refs)", () => {
    const { clock } = makeGovernor();
    expect(
      () =>
        new LeaseQuotaGovernor({
          maxTtlMs: MAX_TTL,
          quotas: { tenants: { t: { maxActiveLeases: -1, maxWaiters: 0 } }, agents: {} },
          clock,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new LeaseQuotaGovernor({
          maxTtlMs: MAX_TTL,
          quotas: { tenants: {}, agents: { a: { maxActiveLeases: 1.5, maxWaiters: 0 } } },
          clock,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new LeaseQuotaGovernor({
          maxTtlMs: MAX_TTL,
          quotas: { tenants: { " ": { maxActiveLeases: 1, maxWaiters: 0 } }, agents: {} },
          clock,
        }),
    ).toThrow(TypeError);
  });

  it("uses the injected clock for every timestamp (pure time, no wall clock)", () => {
    const { governor, clock, events } = makeGovernor();
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(granted.ok).toBe(true);
    if (granted.ok) {
      expect(granted.lease.acquiredAtMs).toBe(clock.nowMs());
      expect(granted.lease.expiresAtMs).toBe(clock.nowMs() + 5_000);
    }
    expect(events.every((e) => "atMs" in e ? e.atMs <= clock.nowMs() : true)).toBe(true);
  });
});

describe("bounded TTL (no infinite leases)", () => {
  it("rejects a TTL above the governor maximum", () => {
    const { governor } = makeGovernor();
    const result = governor.acquire({
      target: resource("res-1"),
      principal: agent("agent-w1"),
      ttlMs: MAX_TTL + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ttl_exceeds_bound");
  });

  it("rejects non-positive and non-finite TTLs", () => {
    const { governor } = makeGovernor();
    for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: ttl });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_input");
    }
  });

  it("rejects renewal TTLs above the same ceiling", () => {
    const { governor } = makeGovernor();
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(granted.ok).toBe(true);
    if (granted.ok) {
      const renewed = governor.renew({ ...granted.lease, ttlMs: MAX_TTL + 1 });
      expect(renewed.ok).toBe(false);
      if (!renewed.ok) expect(renewed.reason).toBe("ttl_exceeds_bound");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Single-holder enforcement + expiry
 * ────────────────────────────────────────────────────────────*/

describe("single-holder enforcement", () => {
  it("denies a second holder while the target is held, naming the holder", () => {
    const { governor } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(first.ok).toBe(true);
    const second = governor.acquire({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 5_000 });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("target_held");
      expect(second.heldBy).toBe("agent-w1");
    }
    expect(governor.isHeld(resource("res-1"))).toBe(true);
  });

  it("frees the target after an explicit holder release", () => {
    const { governor } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(governor.release(first.lease).ok).toBe(true);
      expect(governor.isHeld(resource("res-1"))).toBe(false);
      const second = governor.acquire({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 5_000 });
      expect(second.ok).toBe(true);
    }
  });

  it("leases agent execution slots with the same single-holder law", () => {
    const { governor } = makeGovernor();
    const first = governor.acquire({ target: agentSlot("runtime-001"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(first.ok).toBe(true);
    const second = governor.acquire({ target: agentSlot("runtime-001"), principal: agent("agent-w2"), ttlMs: 5_000 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("target_held");
  });
});

describe("expiry (deterministic clock, lazy observation)", () => {
  it("expires exactly at the TTL bound and frees the target", () => {
    const { governor, clock } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.lease.expiresAtMs).toBe(2_000);

    clock.advance(999);
    expect(governor.isHeld(resource("res-1"))).toBe(true);

    clock.advance(1); // exactly expiresAtMs
    expect(governor.isHeld(resource("res-1"))).toBe(false);
    expect(governor.currentLease(resource("res-1"))).toBeNull();
  });

  it("emits lease_expired_observed exactly once per expired lease", () => {
    const { governor, clock, events } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    clock.advance(1_000);
    const swept1 = governor.sweepExpired();
    const swept2 = governor.sweepExpired();
    expect(swept1).toEqual([first.ok ? first.lease.leaseId : ""]);
    expect(swept2).toEqual([]);
    const observed = events.filter((e) => e.kind === "lease_expired_observed");
    expect(observed).toHaveLength(1);
    if (observed[0].kind === "lease_expired_observed") {
      expect(observed[0].expiredAtMs).toBe(2_000);
      expect(observed[0].observedAtMs).toBe(2_000);
    }
  });

  it("lets a different holder acquire after expiry with a new fencing token", () => {
    const { governor, clock } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    clock.advance(1_000);
    const second = governor.acquire({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 1_000 });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.lease.fencingToken).toBe((first.ok ? first.lease.fencingToken : 0) + 1);
      expect(second.lease.principal.agentRef).toBe("agent-w2");
    }
  });
});

describe("steal-after-expiry is denied to the expired holder (fail closed, no resurrection)", () => {
  it("denies renew, release and fence to the expired holder", () => {
    const { governor, clock } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const expiredHandle = first.lease;

    clock.advance(1_000); // lease is now dead

    const renewed = governor.renew({ ...expiredHandle, ttlMs: 1_000 });
    expect(renewed.ok).toBe(false);
    if (!renewed.ok) expect(renewed.reason).toBe("lease_expired");

    const released = governor.release(expiredHandle);
    expect(released.ok).toBe(false);
    if (!released.ok) expect(released.reason).toBe("lease_expired");

    const fenced = governor.assertFencingToken(expiredHandle);
    expect(fenced.ok).toBe(false);
    if (!fenced.ok) expect(fenced.reason).toBe("lease_expired");

    // And the target is free for someone else — the expired holder cannot
    // sneak back in while w2 holds it.
    const second = governor.acquire({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 5_000 });
    expect(second.ok).toBe(true);
    const steal = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(steal.ok).toBe(false);
    if (!steal.ok) expect(steal.reason).toBe("target_held");
  });

  it("forces the expired holder through a fresh acquire with a new token", () => {
    const { governor, clock } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const oldToken = first.lease.fencingToken;
    clock.advance(1_000);
    const fresh = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.lease.fencingToken).toBe(oldToken + 1);
      const stale = governor.assertFencingToken(first.lease);
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.reason).toBe("stale_fencing_token");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Quota ceilings (fail-closed admission, structured denial + audit)
 * ────────────────────────────────────────────────────────────*/

describe("quota admission", () => {
  it("denies over-quota tenants with a structured detail and audit event", () => {
    const { governor, clock, events } = makeGovernor();
    const first = governor.acquire({
      target: resource("res-1"),
      principal: agent("agent-w1", "tenant-one-lease"),
      ttlMs: 5_000,
    });
    expect(first.ok).toBe(true);
    const second = governor.acquire({
      target: resource("res-2"),
      principal: agent("agent-w2", "tenant-one-lease"),
      ttlMs: 5_000,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("quota_exhausted");
      expect(second.quota).toEqual({
        scope: "tenant",
        principalRef: "tenant-one-lease",
        limit: 1,
        active: 1,
      });
      expect(second.detail).toContain("tenant-one-lease");
    }
    const quotaEvents = events.filter((e) => e.kind === "quota_denied");
    expect(quotaEvents).toHaveLength(1);
    if (quotaEvents[0].kind === "quota_denied") {
      expect(quotaEvents[0].scope).toBe("tenant");
      expect(quotaEvents[0].limit).toBe(1);
      expect(quotaEvents[0].atMs).toBe(clock.nowMs());
    }
  });

  it("denies over-quota agents across different resources (agent ceiling)", () => {
    const { governor } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(first.ok).toBe(true);
    const second = governor.acquire({ target: resource("res-2"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("quota_exhausted");
      expect(second.quota).toEqual({ scope: "agent", principalRef: "agent-w1", limit: 1, active: 1 });
    }
  });

  it("fails closed for undeclared principals (no ceiling = no admission)", () => {
    const { governor } = makeGovernor();
    const unknownTenant = governor.acquire({
      target: resource("res-1"),
      principal: agent("agent-w1", "tenant-ghost"),
      ttlMs: 5_000,
    });
    expect(unknownTenant.ok).toBe(false);
    if (!unknownTenant.ok) expect(unknownTenant.reason).toBe("quota_principal_undeclared");

    const unknownAgent = governor.acquire({
      target: resource("res-1"),
      principal: agent("agent-ghost"),
      ttlMs: 5_000,
    });
    expect(unknownAgent.ok).toBe(false);
    if (!unknownAgent.ok) expect(unknownAgent.reason).toBe("quota_principal_undeclared");
  });

  it("a ceiling of zero admits nothing", () => {
    const { governor } = makeGovernor();
    const result = governor.acquire({
      target: resource("res-1"),
      principal: human("tenant-zero"),
      ttlMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quota_exhausted");
  });

  it("release frees quota; expiry frees quota lazily", () => {
    const { governor, clock } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    const blocked = governor.acquire({ target: resource("res-2"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(blocked.ok).toBe(false);

    // Explicit release frees the ceiling immediately.
    if (first.ok) expect(governor.release(first.lease).ok).toBe(true);
    const afterRelease = governor.acquire({ target: resource("res-2"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(afterRelease.ok).toBe(true);

    // Lazy expiry frees the ceiling without any explicit release.
    clock.advance(1_000);
    const third = governor.acquire({ target: resource("res-3"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(third.ok).toBe(true);
  });

  it("expired leases do not count against the ceiling", () => {
    const { governor, clock } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    clock.advance(1_000);
    expect(governor.activeLeasesFor(agent("agent-w1"))).toBe(0);
    const second = governor.acquire({ target: resource("res-2"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(second.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Waiters / FIFO fairness
 * ────────────────────────────────────────────────────────────*/

describe("waiters and FIFO fairness", () => {
  it("denies out-of-order acquisition while waiters are queued (no queue jumping)", () => {
    const { governor } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    const queued = governor.enqueueWaiter({
      target: resource("res-1"),
      principal: agent("agent-w2"),
      ttlMs: 1_000,
    });
    expect(queued.ok).toBe(true);
    const jumper = governor.acquire({ target: resource("res-1"), principal: agent("agent-w3"), ttlMs: 1_000 });
    expect(jumper.ok).toBe(false);
    if (!jumper.ok) expect(jumper.reason).toBe("queue_ahead");
  });

  it("grants the head waiter in FIFO order and re-runs admission at grant time", () => {
    const { governor, events } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    const w2 = governor.enqueueWaiter({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 1_000 });
    const w3 = governor.enqueueWaiter({ target: resource("res-1"), principal: agent("agent-w3"), ttlMs: 1_000 });
    expect(w2.ok && w3.ok).toBe(true);
    expect(governor.headWaiter(resource("res-1"))?.principal.agentRef).toBe("agent-w2");

    // Release frees the target; the grant goes to the HEAD only.
    if (first.ok) governor.release(first.lease);
    const grant1 = governor.grantNextWaiter(resource("res-1"));
    expect(grant1.ok).toBe(true);
    if (grant1.ok) expect(grant1.lease.principal.agentRef).toBe("agent-w2");
    const grant2 = governor.grantNextWaiter(resource("res-1"));
    expect(grant2.ok).toBe(false);
    if (!grant2.ok) expect(grant2.reason).toBe("target_held");

    const grantedEvents = events.filter((e) => e.kind === "waiter_granted");
    expect(grantedEvents).toHaveLength(1);
  });

  it("honours quota at grant time and dequeues a denied head waiter", () => {
    const { governor, events } = makeGovernor();
    const holder = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(holder.ok).toBe(true);
    const queued = governor.enqueueWaiter({ target: resource("res-1"), principal: agent("agent-quiet"), ttlMs: 1_000 });
    expect(queued.ok).toBe(true);

    // The waiter's ceiling is consumed elsewhere before the grant.
    const side = governor.acquire({ target: resource("res-9"), principal: agent("agent-quiet"), ttlMs: 5_000 });
    expect(side.ok).toBe(true);

    if (holder.ok) governor.release(holder.lease);
    const grant = governor.grantNextWaiter(resource("res-1"));
    expect(grant.ok).toBe(false);
    if (!grant.ok) {
      expect(grant.reason).toBe("quota_exhausted");
      expect(grant.quota).toEqual({ scope: "agent", principalRef: "agent-quiet", limit: 1, active: 1 });
    }
    expect(governor.waiters(resource("res-1"))).toHaveLength(0);
    const deniedEvents = events.filter((e) => e.kind === "waiter_denied");
    expect(deniedEvents).toHaveLength(1);
  });

  it("enforces waiter ceilings per principal (fail closed)", () => {
    const { governor } = makeGovernor();
    const first = governor.enqueueWaiter({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    const second = governor.enqueueWaiter({ target: resource("res-2"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("quota_exhausted");
      expect(second.quota).toEqual({ scope: "agent", principalRef: "agent-w1", limit: 1, active: 1 });
    }
  });

  it("lets the owning principal cancel its waiter; denies others", () => {
    const { governor } = makeGovernor();
    const queued = governor.enqueueWaiter({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const stranger = governor.cancelWaiter({
      target: resource("res-1"),
      waiterId: queued.ticket.waiterId,
      principal: agent("agent-w2"),
    });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.reason).toBe("holder_mismatch");
    const owner = governor.cancelWaiter({
      target: resource("res-1"),
      waiterId: queued.ticket.waiterId,
      principal: agent("agent-w1"),
    });
    expect(owner.ok).toBe(true);
    expect(governor.waiters(resource("res-1"))).toHaveLength(0);
    const empty = governor.grantNextWaiter(resource("res-1"));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe("waiter_queue_empty");
  });

  it("admits the head waiter's own acquire through its ticket", () => {
    const { governor } = makeGovernor();
    const holder = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(holder.ok).toBe(true);
    const queued = governor.enqueueWaiter({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 1_000 });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    if (holder.ok) governor.release(holder.lease);
    const headAcquire = governor.acquire({
      target: resource("res-1"),
      principal: agent("agent-w2"),
      ttlMs: 1_000,
      waiterId: queued.ticket.waiterId,
    });
    expect(headAcquire.ok).toBe(true);
    expect(governor.waiters(resource("res-1"))).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Renewal and fencing
 * ────────────────────────────────────────────────────────────*/

describe("renewal", () => {
  it("extends the current holder's unexpired lease within the bound", () => {
    const { governor, clock, events } = makeGovernor();
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 1_000 });
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    clock.advance(400);
    const renewed = governor.renew({ ...granted.lease, ttlMs: 1_000 });
    expect(renewed.ok).toBe(true);
    if (renewed.ok) expect(renewed.lease.expiresAtMs).toBe(1_400 + 1_000);
    const renewedEvents = events.filter((e) => e.kind === "lease_renewed");
    expect(renewedEvents).toHaveLength(1);
  });

  it("denies renewal by a non-holder", () => {
    const { governor, events } = makeGovernor();
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    const hijack = governor.renew({ ...granted.lease, principal: agent("agent-w2"), ttlMs: 5_000 });
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.reason).toBe("holder_mismatch");
    const tenantHijack = governor.renew({ ...granted.lease, principal: human("tenant-b"), ttlMs: 5_000 });
    expect(tenantHijack.ok).toBe(false);
    if (!tenantHijack.ok) expect(tenantHijack.reason).toBe("holder_mismatch");
    const denied = events.filter((e) => e.kind === "lease_renewal_denied");
    expect(denied).toHaveLength(2);
  });

  it("denies renewal for unknown leases and stale fencing tokens", () => {
    const { governor } = makeGovernor();
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    const unknown = governor.renew({ ...granted.lease, leaseId: "lease:resource:res-1:999", ttlMs: 1_000 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("unknown_lease");
    const stale = governor.renew({ ...granted.lease, fencingToken: 98, ttlMs: 1_000 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale_fencing_token");
  });
});

describe("fencing tokens", () => {
  it("admits the current holder with the current token and rejects the rest", () => {
    const { governor } = makeGovernor();
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    expect(governor.assertFencingToken(granted.lease).ok).toBe(true);
    const wrongHolder = governor.assertFencingToken({ ...granted.lease, principal: agent("agent-w2") });
    expect(wrongHolder.ok).toBe(false);
    if (!wrongHolder.ok) expect(wrongHolder.reason).toBe("holder_mismatch");
    const forwardToken = governor.assertFencingToken({ ...granted.lease, fencingToken: 99 });
    expect(forwardToken.ok).toBe(false);
    if (!forwardToken.ok) expect(forwardToken.reason).toBe("unknown_lease");
  });

  it("fails closed for unknown targets", () => {
    const { governor } = makeGovernor();
    const ghost = governor.assertFencingToken({
      target: resource("ghost"),
      leaseId: "lease:resource:ghost:1",
      fencingToken: 1,
      principal: agent("agent-w1"),
    });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.reason).toBe("unknown_lease");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Audit trail
 * ────────────────────────────────────────────────────────────*/

describe("audit trail", () => {
  it("records every denial in the append-only trail (denials are never silent)", () => {
    const { governor } = makeGovernor();
    const first = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(first.ok).toBe(true);
    governor.acquire({ target: resource("res-1"), principal: agent("agent-w2"), ttlMs: 5_000 });
    governor.acquire({ target: resource("res-2"), principal: agent("agent-w2", "tenant-ghost"), ttlMs: 5_000 });

    const trail = governor.auditTrail();
    const deniedLeases = trail.filter((e) => e.kind === "lease_denied");
    expect(deniedLeases).toHaveLength(2);
    expect(governor.totals().denied).toBe(2);
    expect(governor.totals().granted).toBe(1);
  });

  it("never lets a throwing event sink break containment", () => {
    const { governor } = makeGovernor({
      onEvent: () => {
        throw new Error("sink down");
      },
    });
    const granted = governor.acquire({ target: resource("res-1"), principal: agent("agent-w1"), ttlMs: 5_000 });
    expect(granted.ok).toBe(true);
    expect(governor.auditTrail().length).toBeGreaterThan(0);
  });

  it("exposes declared ceilings as configuration provenance", () => {
    const { governor } = makeGovernor();
    const ceilings = governor.declaredCeilings();
    expect(ceilings.tenants["tenant-a"]).toEqual(TENANT_CEILING_2);
    expect(ceilings.agents["agent-w1"]).toEqual(AGENT_CEILING_1);
  });
});