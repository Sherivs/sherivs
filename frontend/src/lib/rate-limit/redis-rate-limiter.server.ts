/**
 * CoreGrid — optional distributed rate limiter (Upstash-compatible REST).
 *
 * Server module. Implements the SAME `RateLimiter` contract as the in-process
 * sliding-window limiter in ai-gateway.server, but backed by an
 * Upstash-compatible REST data plane so the limit holds across server
 * instances (multi-instance deployments must not rate-limit per-instance).
 *
 * Design invariants (Constitution §16/§17/§28, fail-closed bias):
 * - The credential exists ONLY inside the auth header of a single https
 *   request; it never enters a decision, error, or log line (§30).
 * - A missing or malformed REDIS connection degrades to the IN-PROCESS
 *   limiter with the same policy — an optional infrastructure plane must
 *   never hard-fail the gateway path (Part 31 remains the V1 default).
 * - Key material is namespaced (`coregrid:rl:`) and refKeys are sanitized
 *   before they can touch the data plane.
 * - Fixed-window counting via an atomic EVAL (INCR + first-hit PEXPIRE), so
 *   two instances racing on the same key cannot both pass.
 *
 * Un-freeze authority: DECISIONS.md #204 (PLATFORM-013, 2026-10-06).
 */

import { z } from "zod";
import { TimeAuthority, SystemClock } from "../kernel/time-authority";
import { createRateLimiter, type RateLimitConfig, type RateLimiter, type RateLimitDecision } from "../ai-gateway.server";

const rateLimitTimeAuthority = new TimeAuthority(new SystemClock());

export type FetchLike = typeof fetch;

/** ServerEnv view (never a secret carrier beyond the auth header). */
export type ServerEnv = Record<string, string | undefined>;

const REDIS_CONNECTION_ENV = z.strictObject({
  REDIS_REST_URL: z.string().url().refine((v) => v.startsWith("https://"), {
    message: "REDIS_REST_URL must be https (§25 provider-neutrality: no cleartext data plane)",
  }),
  REDIS_REST_TOKEN: z.string().min(1),
});

export type RedisConnection = z.infer<typeof REDIS_CONNECTION_ENV>;

export interface RedisRateLimiterOptions {
  fetchImpl?: FetchLike;
  /**
   * Limiter used when the Redis REST call itself fails (network error,
   * non-2xx, malformed body). Defaults to an in-process limiter with the
   * same policy — degraded but never unenforced.
   */
  fallback?: RateLimiter;
}

export interface RedisLimiterProvision {
  /** Always usable: either the Redis-backed limiter or the fallback. */
  limiter: RateLimiter;
  mode: "redis" | "in_process";
  /** Set only when mode === "in_process" (secret-free reason). */
  reason?: string;
}

/** Atomic fixed-window increment: INCR, PEXPIRE on first hit, return count. */
const FIXED_WINDOW_LUA =
  "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return c";

const REST_RESULT_SCHEMA = z.strictObject({ result: z.number() });

const KEY_NAMESPACE = "coregrid:rl:";

/** RefKeys become Redis keys: allow only safe characters, bound the length. */
function redisKeyFor(refKey: string, bucket: number): string {
  const safe = refKey.replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 120);
  return `${KEY_NAMESPACE}${safe}:${bucket}`;
}

export function redisRateLimiter(
  config: RateLimitConfig,
  connection: RedisConnection,
  options: RedisRateLimiterOptions = {},
): RateLimiter {
  const fallback = options.fallback ?? createRateLimiter(config);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRequests = Math.max(0, Math.floor(config.maxRequests));
  const windowMs = config.windowMs;

  return {
    async check(refKey: string, nowMs: number = rateLimitTimeAuthority.now().atMs): Promise<RateLimitDecision> {
      if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(maxRequests) || maxRequests <= 0) {
        return { decision: "deny", retryAfterMs: 0 };
      }
      const bucket = Math.floor(nowMs / windowMs);
      const key = redisKeyFor(refKey, bucket);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        let response: Response;
        try {
          response = await fetchImpl(connection.REDIS_REST_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${connection.REDIS_REST_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(["EVAL", FIXED_WINDOW_LUA, "1", key, String(Math.ceil(windowMs))]),
            signal: controller.signal,
            redirect: "error",
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          return fallback.check(refKey, nowMs);
        }
        const parsed = REST_RESULT_SCHEMA.safeParse(await response.json());
        if (!parsed.success) return fallback.check(refKey, nowMs);
        if (parsed.data.result > maxRequests) {
          const windowEnd = (bucket + 1) * windowMs;
          return { decision: "deny", retryAfterMs: Math.max(1, windowEnd - nowMs) };
        }
        return { decision: "allow" };
      } catch {
        return fallback.check(refKey, nowMs);
      }
    },
  };
}

/**
 * Environment-gated provisioning: a missing or non-https REDIS connection is
 * NOT an error — it provisions the in-process limiter (Part 31 default) with
 * a secret-free reason. Only a well-formed https connection activates the
 * distributed mode.
 */
export function rateLimiterFromEnv(
  config: RateLimitConfig,
  env: ServerEnv,
  options: RedisRateLimiterOptions = {},
): RedisLimiterProvision {
  const parsed = REDIS_CONNECTION_ENV.safeParse({
    REDIS_REST_URL: env.REDIS_REST_URL,
    REDIS_REST_TOKEN: env.REDIS_REST_TOKEN,
  });
  if (!parsed.success) {
    const missing =
      !env.REDIS_REST_URL || env.REDIS_REST_URL.trim() === ""
        ? "REDIS_REST_URL"
        : !env.REDIS_REST_TOKEN || env.REDIS_REST_TOKEN.trim() === ""
          ? "REDIS_REST_TOKEN"
          : null;
    return {
      limiter: createRateLimiter(config),
      mode: "in_process",
      reason: missing
        ? `BLOCKED_NO_CREDENTIAL: ${missing} not set — in-process rate limiting active (Part 31)`
        : "REDIS connection env malformed (URL must be https) — in-process rate limiting active (Part 31)",
    };
  }
  return { limiter: redisRateLimiter(config, parsed.data, options), mode: "redis" };
}