/**
 * CoreGrid — optional distributed rate limiter tests.
 *
 * Proves with injected fetches (no network, no secrets):
 * 1. Missing/malformed REDIS env degrades to the in-process limiter with a
 *    secret-free reason — never an error, never unenforced (Part 31 default).
 * 2. The Redis limiter issues a single atomic EVAL (INCR + PEXPIRE) with the
 *    credential ONLY in the auth header, against an https URL.
 * 3. allow/deny derivation from the returned counter, with bounded
 *    retryAfterMs computed from the fixed window.
 * 4. Redis failures (network, non-2xx, malformed body) fall back to the
 *    in-process limiter — degraded but never unenforced.
 * 5. refKeys are sanitized before touching the data plane.
 */
import { describe, expect, it, vi } from "vitest";
import {
  rateLimiterFromEnv,
  redisRateLimiter,
} from "../../../frontend/src/lib/rate-limit/redis-rate-limiter.server";

const CONNECTION = { REDIS_REST_URL: "https://example.upstash.io", REDIS_REST_TOKEN: "rt-token" };
const CONFIG = { maxRequests: 2, windowMs: 60_000 };

interface CallRecord {
  url: string;
  init: RequestInit;
}

function restFetch(results: (number | "network-error")[]) {
  const calls: CallRecord[] = [];
  let i = 0;
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), init: (init ?? {}) as RequestInit });
    const result = results[Math.min(i, results.length - 1)];
    i += 1;
    if (result === "network-error") throw new Error("connection refused");
    return {
      ok: result >= 200 && result < 300,
      status: result,
      json: async () => ({ result: result === 200 ? i : null }),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("rateLimiterFromEnv — fail-soft provisioning", () => {
  it("provisions the in-process limiter when REDIS env is absent", async () => {
    const provision = rateLimiterFromEnv(CONFIG, {});
    expect(provision.mode).toBe("in_process");
    expect(provision.reason).toContain("BLOCKED_NO_CREDENTIAL");
    expect(provision.reason).toContain("REDIS_REST_URL");
    // The in-process fallback still enforces the policy.
    expect((await provision.limiter.check("t:a", 0)).decision).toBe("allow");
    expect((await provision.limiter.check("t:a", 1)).decision).toBe("allow");
    expect((await provision.limiter.check("t:a", 2)).decision).toBe("deny");
  });

  it("refuses a non-https REDIS URL before any contact (secret-free reason)", () => {
    const { impl, calls } = restFetch([200]);
    const provision = rateLimiterFromEnv(
      CONFIG,
      { REDIS_REST_URL: "http://insecure.example", REDIS_REST_TOKEN: "rt-token" },
      { fetchImpl: impl },
    );
    expect(provision.mode).toBe("in_process");
    expect(provision.reason).toContain("malformed");
    expect(calls).toEqual([]);
  });
});

describe("redisRateLimiter — fixed-window decisions over REST", () => {
  it("sends one atomic EVAL per check with the token only in the auth header", async () => {
    const { impl, calls } = restFetch([200, 200, 200]);
    const limiter = redisRateLimiter(CONFIG, CONNECTION, { fetchImpl: impl });
    await limiter.check("tenant-a:actor-1", 1_000);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(CONNECTION.REDIS_REST_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CONNECTION.REDIS_REST_TOKEN}`);
    const body = JSON.parse(init.body as string);
    expect(body[0]).toBe("EVAL");
    expect(body[2]).toBe("1");
    expect(JSON.stringify(body)).not.toContain(CONNECTION.REDIS_REST_TOKEN);
  });

  it("allows under the limit and denies with a window-bounded retryAfter", async () => {
    // result counter echoes the call index (1, 2, 3, ...).
    const { impl } = restFetch([200, 200, 200, 200]);
    const limiter = redisRateLimiter(CONFIG, CONNECTION, { fetchImpl: impl });
    expect((await limiter.check("t:a", 1_000)).decision).toBe("allow");
    expect((await limiter.check("t:a", 2_000)).decision).toBe("allow");
    const denied = (await limiter.check("t:a", 3_000)) as { decision: "deny"; retryAfterMs: number };
    expect(denied.decision).toBe("deny");
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(CONFIG.windowMs);
  });

  it("keys are isolated per ref and bucketed per window", async () => {
    const { impl, calls } = restFetch([200, 200]);
    const limiter = redisRateLimiter(CONFIG, CONNECTION, { fetchImpl: impl });
    await limiter.check("tenant-a:actor-1", 1_000);
    await limiter.check("tenant-b:actor-2", 1_000);
    const keyA = JSON.parse(calls[0].init.body as string)[3] as string;
    const keyB = JSON.parse(calls[1].init.body as string)[3] as string;
    expect(keyA).toContain("coregrid:rl:tenant-a:actor-1:");
    expect(keyB).toContain("coregrid:rl:tenant-b:actor-2:");
    expect(keyA).not.toBe(keyB);
  });

  it("sanitizes unsafe characters out of refKeys", async () => {
    const { impl, calls } = restFetch([200]);
    const limiter = redisRateLimiter(CONFIG, CONNECTION, { fetchImpl: impl });
    await limiter.check("tenant a/actor *two*", 1_000);
    const key = JSON.parse(calls[0].init.body as string)[3] as string;
    expect(key.startsWith("coregrid:rl:tenant_a_actor__two_:")).toBe(true);
    expect(key).not.toMatch(/[\s/*]/);
  });

  it("falls back to the in-process limiter on network failure (degraded, still enforced)", async () => {
    const { impl } = restFetch(["network-error", "network-error", "network-error"]);
    const limiter = redisRateLimiter(CONFIG, CONNECTION, { fetchImpl: impl });
    // The fallback counts independently: 3 checks against maxRequests=2 deny.
    expect((await limiter.check("t:a", 1_000)).decision).toBe("allow");
    expect((await limiter.check("t:a", 2_000)).decision).toBe("allow");
    expect((await limiter.check("t:a", 3_000)).decision).toBe("deny");
  });

  it("falls back on a non-2xx REST response", async () => {
    const { impl } = restFetch([500, 500, 500]);
    const limiter = redisRateLimiter(CONFIG, CONNECTION, { fetchImpl: impl });
    expect((await limiter.check("t:a", 1_000)).decision).toBe("allow");
    expect((await limiter.check("t:a", 2_000)).decision).toBe("allow");
    expect((await limiter.check("t:a", 3_000)).decision).toBe("deny");
  });

  it("fails closed on a non-positive or malformed config", async () => {
    const { impl, calls } = restFetch([200]);
    const limiter = redisRateLimiter({ maxRequests: 5, windowMs: 0 }, CONNECTION, { fetchImpl: impl });
    expect((await limiter.check("t:a", 1_000)).decision).toBe("deny");
    expect(calls).toEqual([]);
    const zeroMax = redisRateLimiter({ maxRequests: 0, windowMs: 1_000 }, CONNECTION, { fetchImpl: impl });
    expect((await zeroMax.check("t:a", 1_000)).decision).toBe("deny");
  });
});