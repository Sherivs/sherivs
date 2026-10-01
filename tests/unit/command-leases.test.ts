/**
 * CoreGrid — lease / concurrency control contract tests (J-031 / V1CAP-055).
 *
 * Validates: concurrent acquire serialization, bounded TTL, renewal,
 * fencing-token monotonicity (stale holder writes rejected), no-resurrection
 * of expired leases, fail-closed expiry, and TTL-based deadlock prevention.
 */

import { describe, expect, it } from "vitest";
import { LeaseManager } from "@/lib/command/leases";

const MAX_TTL = 30_000;

function manager(): LeaseManager {
  return new LeaseManager({ maxTtlMs: MAX_TTL });
}

describe("acquire", () => {
  it("grants a lease with a monotonic fencing token", () => {
    const mgr = manager();
    const first = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.lease.fencingToken).toBe(1);
      expect(first.lease.expiresAtMs).toBe(2_000);
      expect(first.lease.leaseId).toContain("res-1");
    }
  });

  it("serializes concurrent acquires: second holder rejected while held", () => {
    const mgr = manager();
    const first = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 5_000 }, 1_000);
    const second = mgr.acquire({ resourceRef: "res-1", holderId: "w2", ttlMs: 5_000 }, 1_000);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "resource_held", heldBy: "w1" });
    expect(mgr.isHeld("res-1", 1_000)).toBe(true);
  });

  it("rejects TTL above the bounded maximum", () => {
    const mgr = manager();
    const result = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: MAX_TTL + 1 }, 1_000);
    expect(result).toEqual({ ok: false, reason: "ttl_exceeds_bound", heldBy: null });
  });

  it("rejects invalid holders and non-positive TTLs", () => {
    const mgr = manager();
    expect(mgr.acquire({ resourceRef: "res-1", holderId: "", ttlMs: 1_000 }, 0).ok).toBe(false);
    expect(mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 0 }, 0).ok).toBe(false);
  });

  it("allows a different holder to acquire after TTL expiry (deadlock prevention)", () => {
    const mgr = manager();
    const first = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    expect(first.ok).toBe(true);
    // Dead holder never releases; expiry frees the resource at 2_000.
    const second = mgr.acquire({ resourceRef: "res-1", holderId: "w2", ttlMs: 1_000 }, 2_000);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.lease.holderId).toBe("w2");
      expect(second.lease.fencingToken).toBe(2);
    }
  });
});

describe("renew", () => {
  it("extends an unexpired lease for the current holder", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    expect(lease.ok).toBe(true);
    if (lease.ok) {
      const renewed = mgr.renew(
        { resourceRef: "res-1", holderId: "w1", fencingToken: lease.lease.fencingToken },
        1_500,
        1_000,
      );
      expect(renewed.ok).toBe(true);
      if (renewed.ok) expect(renewed.lease.expiresAtMs).toBe(2_500);
    }
  });

  it("fails closed on renewal after expiry (no resurrection)", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    expect(lease.ok).toBe(true);
    if (lease.ok) {
      const renewed = mgr.renew(
        { resourceRef: "res-1", holderId: "w1", fencingToken: lease.lease.fencingToken },
        1_001 + 1_000,
        1_000,
      );
      expect(renewed.ok).toBe(false);
      if (!renewed.ok) expect(renewed.reason).toBe("lease_expired");
    }
  });

  it("rejects renewal by a non-holder", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 5_000 }, 1_000);
    expect(lease.ok).toBe(true);
    const renewed = mgr.renew(
      { resourceRef: "res-1", holderId: "w2", fencingToken: lease.ok ? lease.lease.fencingToken : 0 },
      1_500,
      5_000,
    );
    expect(renewed).toEqual({ ok: false, reason: "holder_mismatch" });
  });

  it("rejects renewal above the bounded maximum", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    if (lease.ok) {
      const renewed = mgr.renew(
        { resourceRef: "res-1", holderId: "w1", fencingToken: lease.lease.fencingToken },
        1_000,
        MAX_TTL + 1,
      );
      expect(renewed.ok).toBe(false);
    }
  });
});

describe("fencing tokens", () => {
  it("accepts the current holder's live token", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 5_000 }, 1_000);
    if (lease.ok) {
      const fence = mgr.assertFencingToken(
        { resourceRef: "res-1", holderId: "w1", fencingToken: lease.lease.fencingToken },
        2_000,
      );
      expect(fence).toEqual({ ok: true });
    }
  });

  it("rejects a stale holder's write after the lease moved on", () => {
    const mgr = manager();
    const first = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    expect(first.ok).toBe(true);
    const staleToken = first.ok ? first.lease.fencingToken : 0;

    // Lease expires at 2_000; w2 acquires fresh at 2_000 and gets token 2.
    const second = mgr.acquire({ resourceRef: "res-1", holderId: "w2", ttlMs: 5_000 }, 2_000);
    expect(second.ok).toBe(true);

    // w1 (stale token 1) attempts a write against the live resource.
    const staleWrite = mgr.assertFencingToken(
      { resourceRef: "res-1", holderId: "w1", fencingToken: staleToken },
      2_500,
    );
    expect(staleWrite).toEqual({ ok: false, reason: "stale_fencing_token" });

    // Even w1's correct token can no longer be used by the wrong holder.
    const holderCheck = mgr.assertFencingToken(
      { resourceRef: "res-1", holderId: "w1", fencingToken: 2 },
      2_500,
    );
    expect(holderCheck).toEqual({ ok: false, reason: "holder_mismatch" });
  });

  it("fails closed on fence checks for unknown resources", () => {
    const mgr = manager();
    expect(
      mgr.assertFencingToken({ resourceRef: "ghost", holderId: "w1", fencingToken: 1 }, 1_000),
    ).toEqual({ ok: false, reason: "unknown_resource" });
  });
});

describe("release", () => {
  it("lets the current holder release an unexpired lease", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 5_000 }, 1_000);
    if (lease.ok) {
      const released = mgr.release(
        { resourceRef: "res-1", holderId: "w1", fencingToken: lease.lease.fencingToken },
        1_500,
      );
      expect(released).toEqual({ ok: true, released: true });
      expect(mgr.isHeld("res-1", 1_500)).toBe(false);
    }
  });

  it("rejects release by a non-holder and after expiry", () => {
    const mgr = manager();
    const lease = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    if (lease.ok) {
      const wrongHolder = mgr.release(
        { resourceRef: "res-1", holderId: "w2", fencingToken: lease.lease.fencingToken },
        1_500,
      );
      expect(wrongHolder).toEqual({ ok: false, reason: "holder_mismatch" });

      const afterExpiry = mgr.release(
        { resourceRef: "res-1", holderId: "w1", fencingToken: lease.lease.fencingToken },
        1_000 + 1_000,
      );
      expect(afterExpiry).toEqual({ ok: false, reason: "lease_expired" });
    }
  });
});

describe("no resurrection", () => {
  it("forces the expired holder through a fresh acquire with a new token", () => {
    const mgr = manager();
    const first = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 1_000);
    expect(first.ok).toBe(true);
    const oldToken = first.ok ? first.lease.fencingToken : 0;

    // After expiry, w1 cannot renew, cannot release, cannot fence-write.
    expect(
      mgr.renew({ resourceRef: "res-1", holderId: "w1", fencingToken: oldToken }, 2_000, 1_000).ok,
    ).toBe(false);
    expect(
      mgr.release({ resourceRef: "res-1", holderId: "w1", fencingToken: oldToken }, 2_000).ok,
    ).toBe(false);
    expect(
      mgr.assertFencingToken({ resourceRef: "res-1", holderId: "w1", fencingToken: oldToken }, 2_000)
        .ok,
    ).toBe(false);

    // The only path forward is a fresh acquire, which mints a NEW token.
    const fresh = mgr.acquire({ resourceRef: "res-1", holderId: "w1", ttlMs: 1_000 }, 2_000);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.lease.fencingToken).toBe(oldToken + 1);
      // And the old token is permanently stale.
      const stale = mgr.assertFencingToken(
        { resourceRef: "res-1", holderId: "w1", fencingToken: oldToken },
        2_500,
      );
      expect(stale).toEqual({ ok: false, reason: "stale_fencing_token" });
    }
  });
});
