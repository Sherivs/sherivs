/**
 * CoreGrid — AI gateway (V5.3 MISSION-V1-010: intelligence gateway +
 * metering-minimal, Constitution §20/§21, Parts 24/31/49).
 *
 * The centralized entry point for every AI operation: authorization of
 * configuration, budget pre-check, rate limiting, structured metering and
 * secret-free decision logging all happen here — never scattered at call
 * sites. `createAiGatewayProvider` remains the low-level provider factory for
 * existing importers; new callers should use `invokeAiGateway`.
 *
 * Fail-closed invariants:
 * - BLK-2: a missing or empty API key yields an explicit "unconfigured"
 *   gateway decision — never a live invocation attempt.
 * - Part 29: no key material ever reaches a log line; every emitted field is
 *   additionally scrubbed against the live key as defense in depth.
 * - V5.3 scope: purposes are organizational intelligence only (enforced by
 *   the metering vocabulary in ./metering/usage-ledger).
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  estimateCostUsd,
  evaluateBudget,
  type BudgetConfig,
  type BudgetDecision,
  type GatewayPurpose,
  type ModelRateTable,
  type UsageCostInput,
  type UsageLedger,
  type UsageRecord,
} from "./metering/usage-ledger";
import {
  logStructured,
  REDACTED,
  serializeError,
  type LogLevel,
  type LogSink,
} from "./observability/structured-log";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "./adapters/failure-policy";

export function createAiGatewayProvider(apiKey: string) {
  const key = apiKey || process.env.AI_API_KEY || "";
  return createOpenAICompatible({
    name: "ai-gateway",
    baseURL: process.env.AI_GATEWAY_URL || "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${key}` },
  });
}

export type AiGatewayProvider = ReturnType<typeof createAiGatewayProvider>;

/**
 * Declared default failure-semantics policy for the AI gateway (J-045).
 * Model invocations are billed, non-idempotent effects: a single transport
 * attempt; the caller wires the policy via `AiGatewayInvokeRequest.failurePolicy`.
 */
export const AI_GATEWAY_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "ai-gateway",
  timeoutMs: 60_000,
  maxAttempts: 1,
  backoffBaseMs: 500,
  backoffCapMs: 8_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 120_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 30_000,
});

// ---------------------------------------------------------------------------
// In-process rate limiting (Part 31 economy: pure config, no Redis, no I/O)
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Max invocations allowed inside any rolling `windowMs`. 0 denies all. */
  maxRequests: number;
  windowMs: number;
}

export type RateLimitDecision = { decision: "allow" } | { decision: "deny"; retryAfterMs: number };

export interface RateLimiter {
  /** Sliding-window check keyed by an arbitrary ref (e.g. "tenant:actor"). */
  check(refKey: string, nowMs?: number): RateLimitDecision;
}

/**
 * Sliding-window rate limiter. Malformed config (non-finite or non-positive
 * window) fails closed: every check denies. Keys are isolated — one tenant or
 * actor never consumes another's window.
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const maxRequests = Number.isFinite(config.maxRequests)
    ? Math.max(0, Math.floor(config.maxRequests))
    : 0;
  const windowMs = Number.isFinite(config.windowMs) ? config.windowMs : 0;
  const failClosed = windowMs <= 0;
  const hits = new Map<string, number[]>();

  return {
    check(refKey: string, nowMs: number = Date.now()): RateLimitDecision {
      if (failClosed) return { decision: "deny", retryAfterMs: 0 };
      const windowStart = nowMs - windowMs;
      const recent = (hits.get(refKey) ?? []).filter((ts) => ts > windowStart);
      hits.set(refKey, recent);
      if (recent.length >= maxRequests) {
        const oldest = recent.length > 0 ? recent[0] : nowMs;
        return {
          decision: "deny",
          retryAfterMs: Math.max(1, oldest + windowMs - nowMs),
        };
      }
      recent.push(nowMs);
      return { decision: "allow" };
    },
  };
}

// ---------------------------------------------------------------------------
// Budget pre-check hook (Part 49 economy: ledger consulted before invocation)
// ---------------------------------------------------------------------------

export function precheckGatewayBudget(
  budget: BudgetConfig,
  ledger: UsageLedger,
  tenantRef: string,
): BudgetDecision {
  return evaluateBudget(budget, ledger.tenantTotals(tenantRef));
}

// ---------------------------------------------------------------------------
// Structured decision logging without key material (Part 29)
// ---------------------------------------------------------------------------

const MAX_SCRUB_DEPTH = 8;

type GatewayLogFields = Record<string, unknown>;

/**
 * Defense in depth: scrub the resolved key material out of any string value
 * before emission, even if a caller embedded it somewhere unexpected.
 */
function scrubValue(value: unknown, secret: string, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    if (secret.length > 0 && value.includes(secret)) {
      return value.split(secret).join(REDACTED);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, secret, depth + 1));
  }
  // Errors must survive scrubbing as `Name: message` (never a raw object,
  // never a stack) — their message can carry key material, so serialize
  // first, then scrub the resulting string.
  if (value instanceof Error) {
    return scrubValue(serializeError(value), secret, depth + 1);
  }
  if (value !== null && typeof value === "object") {
    const out: GatewayLogFields = {};
    for (const [field, member] of Object.entries(value as GatewayLogFields)) {
      out[field] = scrubValue(member, secret, depth + 1);
    }
    return out;
  }
  return value;
}

function emitGatewayLog(
  sink: LogSink | undefined,
  level: LogLevel,
  msg: string,
  fields: GatewayLogFields,
  secret: string,
): void {
  const scrubbed: GatewayLogFields = {};
  for (const [field, value] of Object.entries(fields)) {
    scrubbed[field] = scrubValue(value, secret);
  }
  logStructured({ msg, level, component: "ai-gateway", ...scrubbed }, sink ? { sink } : {});
}

// ---------------------------------------------------------------------------
// Gateway entry (§27 server-function discipline applied to model invocation)
// ---------------------------------------------------------------------------

export interface AiGatewayInvocationResult<TPayload> {
  payload: TPayload;
  tokensIn: number;
  tokensOut: number;
}

export interface AiGatewayInvokeRequest<TPayload> {
  tenantRef: string;
  actorRef: string;
  agentRef?: string | null;
  missionRef?: string | null;
  model: string;
  provider: string;
  purpose: GatewayPurpose;
  /**
   * Explicit credential; falls back to AI_API_KEY. Never logged, never
   * returned — only forwarded to the provider factory (BLK-2).
   */
  apiKey?: string;
  invoke: (provider: AiGatewayProvider) => Promise<AiGatewayInvocationResult<TPayload>>;
  /** Rate table for cost estimation; omitted => estimatedCostUsd stays null. */
  rates?: ModelRateTable;
  /** Budget limits evaluated against the ledger before invocation. */
  budget?: BudgetConfig;
  /** Metering ledger; usage is recorded here on success. */
  ledger?: UsageLedger;
  /** In-process rate limiter; keyed per tenantRef:actorRef. */
  rateLimiter?: RateLimiter;
  /**
   * J-045: adapter failure policy for the invocation itself. When provided,
   * the model call is bounded (per-call timeout), contained (a failing
   * provider returns a `provider_failed` denial instead of rethrowing) and
   * recorded (degraded mode, breaker state, trust history). When omitted,
   * the legacy rethrow semantics are preserved unchanged.
   */
  failurePolicy?: AdapterFailurePolicy;
  logSink?: LogSink;
  now?: () => number;
}

export type AiGatewayDenyCode =
  "unconfigured" | "budget_exhausted" | "rate_limited" | "provider_failed";

export type AiGatewayOutcome<TPayload> =
  | { decision: "allow"; payload: TPayload; usage: UsageRecord }
  | { decision: "deny"; code: AiGatewayDenyCode; reason: string };

/**
 * Invoke a model through the governed gateway.
 *
 * Order of decisions (all fail closed, cheapest first):
 * 1. unconfigured  — no usable API key; no provider is ever constructed.
 * 2. budget_exhausted — ledger totals already at/over a configured limit.
 * 3. rate_limited  — tenantRef:actorRef sliding window is full.
 *
 * On success the invocation is metered (start/end hooks, usage record with
 * full attribution) and the payload returned. Without a wired failurePolicy,
 * invocation failures are logged and rethrown — the gateway never converts a
 * provider error into a policy decision, and failed attempts record no usage.
 * With `failurePolicy` wired (J-045), the invocation is bounded and contained:
 * a failing provider yields a contained `provider_failed` denial, degraded
 * mode/breaker state and trust history are recorded on the policy, and no
 * usage is recorded.
 */
export async function invokeAiGateway<TPayload>(
  request: AiGatewayInvokeRequest<TPayload>,
): Promise<AiGatewayOutcome<TPayload>> {
  const now = request.now ?? Date.now;
  const sink = request.logSink;

  const apiKey = (request.apiKey ?? process.env.AI_API_KEY ?? "").trim();

  const attribution: GatewayLogFields = {
    tenant_ref: request.tenantRef,
    actor_ref: request.actorRef,
    agent_ref: request.agentRef ?? null,
    mission_ref: request.missionRef ?? null,
    model: request.model,
    provider: request.provider,
    purpose: request.purpose,
  };

  const log = (level: LogLevel, msg: string, fields: GatewayLogFields = {}) =>
    emitGatewayLog(sink, level, msg, { ...attribution, ...fields }, apiKey);

  if (apiKey.length === 0) {
    const reason = "AI gateway is not configured: missing or empty API key (BLK-2)";
    log("warn", "gateway.decision.deny", {
      decision: "deny",
      code: "unconfigured",
      reason,
    });
    return { decision: "deny", code: "unconfigured", reason };
  }

  if (request.ledger && request.budget) {
    const budget = precheckGatewayBudget(request.budget, request.ledger, request.tenantRef);
    if (budget.decision === "deny") {
      log("warn", "gateway.decision.deny", {
        decision: "deny",
        code: "budget_exhausted",
        reason: budget.reason,
      });
      return { decision: "deny", code: "budget_exhausted", reason: budget.reason };
    }
  }

  if (request.rateLimiter) {
    const limit = request.rateLimiter.check(`${request.tenantRef}:${request.actorRef}`, now());
    if (limit.decision === "deny") {
      const reason = `Rate limit exceeded for ${request.tenantRef}:${request.actorRef}; retry after ${limit.retryAfterMs}ms`;
      log("warn", "gateway.decision.deny", {
        decision: "deny",
        code: "rate_limited",
        reason,
        retry_after_ms: limit.retryAfterMs,
      });
      return { decision: "deny", code: "rate_limited", reason };
    }
  }

  const startMs = now();
  log("info", "gateway.invoke.start");

  let result: AiGatewayInvocationResult<TPayload>;
  if (request.failurePolicy) {
    const policyOutcome = await request.failurePolicy.run({
      operation: "ai-gateway.invoke",
      // Billed, non-idempotent model calls are never transport-retried here.
      maxAttempts: 1,
      call: async () => {
        const provider = createAiGatewayProvider(apiKey);
        return request.invoke(provider);
      },
    });
    if (policyOutcome.outcome === "error") {
      const reason = `AI invocation failed at the adapter boundary (code=${policyOutcome.code}): ${policyOutcome.reason}`;
      log("error", "gateway.invoke.error", {
        duration_ms: now() - startMs,
        code: policyOutcome.code,
        reason,
      });
      return { decision: "deny", code: "provider_failed", reason };
    }
    result = policyOutcome.value;
  } else {
    try {
      const provider = createAiGatewayProvider(apiKey);
      result = await request.invoke(provider);
    } catch (err) {
      log("error", "gateway.invoke.error", { duration_ms: now() - startMs, err });
      throw err;
    }
  }

  const durationMs = now() - startMs;
  const costInput: UsageCostInput = {
    model: request.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
  const usage: UsageRecord = {
    tenantRef: request.tenantRef,
    actorRef: request.actorRef,
    agentRef: request.agentRef ?? null,
    missionRef: request.missionRef ?? null,
    model: request.model,
    provider: request.provider,
    purpose: request.purpose,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    durationMs,
    estimatedCostUsd: request.rates ? estimateCostUsd(costInput, request.rates) : null,
    at: new Date(now()).toISOString(),
  };
  if (request.ledger) {
    request.ledger.recordUsage(usage);
  }

  // Usage counts are named usage_in/usage_out: the structured logger
  // redacts any field whose name contains "token" (Part 29 fail-closed),
  // and usage counts are observability data, not secrets. The ledger
  // record keeps the canonical tokensIn/tokensOut fields.
  log("info", "gateway.invoke.end", {
    duration_ms: durationMs,
    usage_in: result.tokensIn,
    usage_out: result.tokensOut,
    estimated_cost_usd: usage.estimatedCostUsd,
  });

  return { decision: "allow", payload: result.payload, usage };
}
