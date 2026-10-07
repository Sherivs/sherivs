#!/usr/bin/env node
/**
 * CoreGrid — Redis (Upstash-compatible REST) capability probe.
 *
 * Authority: DECISIONS.md #204 (PLATFORM-013) vendor-verification ladder +
 * DECISIONS.md #209 (PLATFORM-018). Read-only verification: one PING and one
 * governed rate-limiter check through `rateLimiterFromEnv` (the SAME module
 * the app runtime uses), proving verification level `capability_tested`.
 *
 * SECURITY (§30): the URL/token never enter a decision, error, or log line;
 * the report carries statuses and decisions only. The connection is read via
 * process.env and used only inside https request headers.
 *
 * Exit codes: 0 capability proven · 1 finding · 2 blocked (no credential).
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

const ROOT_RAW = fileURLToPath(new URL("../..", import.meta.url));
const ROOT = ROOT_RAW.endsWith(sep) ? ROOT_RAW.slice(0, -sep.length) : ROOT_RAW;
const jiti = createJiti(join(ROOT, "scripts", "infrastructure", "redis-capability-probe.mjs"));

const url = process.env.REDIS_REST_URL;
const token = process.env.REDIS_REST_TOKEN;
if (!url || url.trim() === "" || !token || token.trim() === "") {
  const missing = !url || url.trim() === "" ? "REDIS_REST_URL" : "REDIS_REST_TOKEN";
  console.error(`BLOCKED_NO_CREDENTIAL: ${missing} not set — distributed limiter stays in-process (Part 31); nothing to probe`);
  process.exit(2);
}

const configModule = await jiti.import(join(ROOT, "frontend/src/lib/rate-limit/redis-rate-limiter.server.ts"));

const provision = configModule.rateLimiterFromEnv(
  { maxRequests: 10, windowMs: 60_000 },
  { REDIS_REST_URL: url, REDIS_REST_TOKEN: token },
);
if (provision.mode !== "redis") {
  console.error(`FINDING: connection env rejected by the adapter contract (${provision.reason ?? "malformed"}) — probe aborted`);
  process.exit(1);
}
console.log("PROBE adapter accepted the connection env (mode: redis)");

// 1. Liveness: one PING through the REST data plane.
let pingOk = false;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["PING"]),
    signal: controller.signal,
    redirect: "error",
  }).finally(() => clearTimeout(timer));
  console.log(`PROBE PING http ${response.status}`);
  if (response.ok) {
    const body = await response.json();
    // Redis PING without an argument replies "PONG" ( RESP +PONG ); the
    // wave-4 draft wrongly asserted "OK" and was never run against a live
    // endpoint until wave 6 (2026-10-07, DECISIONS #211).
    pingOk = body?.result === "PONG";
    console.log(`PROBE PING result: ${body?.result === "PONG" ? "PONG" : "(non-PONG payload)"}`);
  }
} catch (error) {
  console.error(`FINDING: PING threw (${String(error).slice(0, 120)})`);
}

// 2. Capability: one governed rate-limit check through the app's own adapter.
let capabilityOk = false;
try {
  const decision = await provision.limiter.check("probe:redis-capability");
  console.log(`PROBE rate-limiter check decision: ${decision.decision}${decision.retryAfterMs !== undefined ? ` retryAfterMs: ${decision.retryAfterMs}` : ""}`);
  capabilityOk = decision.decision === "allow";
} catch (error) {
  console.error(`FINDING: rate-limiter check threw (${String(error).slice(0, 120)})`);
}

if (!pingOk || !capabilityOk) {
  console.error("FINDING: Redis capability probe did not fully pass — verification level stays CONFIGURED_BUT_UNVERIFIED");
  process.exit(1);
}
console.log("RESULT: CAPABILITY_PROVEN — PING OK + one governed rate-limiter check allowed (verification level: capability_tested)");