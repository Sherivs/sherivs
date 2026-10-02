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
import type { ModelRegistry, ModelRoutingRequirements } from "./ai-gateway/model-registry";
import {
  buildIntelligenceSnapshot,
  type IntelligenceSnapshot,
  type RoutingRationaleStep,
} from "./ai-gateway/reasoning-provenance";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

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
    check(refKey: string, nowMs: number = timeAuthority.now().atMs): RateLimitDecision {
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

/**
 * J-015: the governed context package the invocation draws on. When declared,
 * the intelligence snapshot's context version records the package's trace id
 * plus a content digest of the exact assembled context; when omitted, the
 * snapshot records an explicitly absent context version (null traceId and
 * digest — never silently assumed empty).
 */
export interface AiGatewayIntelligenceContext {
  traceId: string;
  assembledContent: string;
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
  /**
   * The model call. The second argument carries the gateway-resolved
   * invocation context: on the legacy declared path the declared model is
   * echoed back; when `modelRegistry` is wired it is the registry-resolved
   * model for THIS attempt (§20: callers never choose providers themselves).
   */
  invoke: (
    provider: AiGatewayProvider,
    context: AiGatewayInvocationContext,
  ) => Promise<AiGatewayInvocationResult<TPayload>>;
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
  /**
   * J-014: when wired, EVERY model choice is resolved through the registry —
   * routing by declared purpose requirements, health-state skipping, and
   * fallback all execute inside this gateway. The declared `model` must be
   * registered (unregistered -> typed denial) and is used as the primary
   * route; alternatives come from the purpose's fallback chain.
   */
  modelRegistry?: ModelRegistry;
  /**
   * J-014: declared routing requirements (cost/latency/context capability)
   * the registry applies when resolving the route for the declared purpose.
   */
  routingRequirements?: ModelRoutingRequirements;
  /**
   * J-015: the governed context package this invocation draws on (its trace
   * id and exact assembled content). Omitted => the snapshot records an
   * explicitly absent context version.
   */
  intelligenceContext?: AiGatewayIntelligenceContext | null;
  logSink?: LogSink;
  now?: () => number;
}

export type AiGatewayDenyCode =
  | "unconfigured"
  | "budget_exhausted"
  | "rate_limited"
  | "provider_failed"
  | "model_unroutable";

/**
 * J-014: per-attempt invocation context handed to the `invoke` callback.
 * `providerClass` is the registry's vendor-neutral class when the invocation
 * was routed through the model registry; null on the legacy declared path.
 */
export interface AiGatewayInvocationContext {
  model: string;
  providerClass: string | null;
}

export type AiGatewayOutcome<TPayload> =
  | {
      decision: "allow";
      payload: TPayload;
      usage: UsageRecord;
      /**
       * J-015: the intelligence snapshot of THIS output — which model,
       * which context version, which routing/policy decision, token/cost
       * attribution and the deterministic output digest. Immutable,
       * serializable and envelope-bearing; the unit Evidence -> Verification
       * later consumes. Every successful invocation carries one.
       */
      intelligence: IntelligenceSnapshot;
    }
  | { decision: "deny"; code: AiGatewayDenyCode; reason: string };

/**
 * J-015: build the intelligence snapshot for one successful invocation.
 * Fail-closed through buildIntelligenceSnapshot — an output that cannot be
 * fully attributed never leaves the gateway.
 */
function stampIntelligence<TPayload>(args: {
  request: AiGatewayInvokeRequest<TPayload>;
  modelId: string;
  providerClass: string | null;
  routedViaRegistry: boolean;
  rationale: readonly RoutingRationaleStep[];
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number | null;
  output: TPayload;
  recordedAt: string;
}): IntelligenceSnapshot {
  const context = args.request.intelligenceContext ?? null;
  return buildIntelligenceSnapshot({
    tenantRef: args.request.tenantRef,
    actorRef: args.request.actorRef,
    agentRef: args.request.agentRef ?? null,
    missionRef: args.request.missionRef ?? null,
    purpose: args.request.purpose,
    model: { id: args.modelId, providerClass: args.providerClass },
    contextVersion: context
      ? { traceId: context.traceId, assembledContent: context.assembledContent }
      : null,
    routing: { routedViaRegistry: args.routedViaRegistry, rationale: args.rationale },
    usage: {
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      estimatedCostUsd: args.estimatedCostUsd,
    },
    output: args.output,
    recordedAt: args.recordedAt,
  });
}

/**
 * J-014: registry-routed invocation loop. All routing stays inside the
 * gateway: the registry resolves the ordered candidate queue, and every
 * candidate is attempted through the SAME governed path — health re-check,
 * budget pre-check, rate limit, contained invocation, metering — per
 * attempt. A failing model moves its registry health state (circuit-breaker
 * handoff, J-045 vocabulary); the next healthy candidate is the fallback.
 * Without a failure policy from the caller, the module-level gateway policy
 * bounds and contains each attempt so fallback decisions remain deterministic.
 */
async function invokeRoutedThroughRegistry<TPayload>(
  request: AiGatewayInvokeRequest<TPayload>,
  deps: {
    now: () => number;
    apiKey: string;
    log: (level: LogLevel, msg: string, fields?: GatewayLogFields) => void;
  },
): Promise<AiGatewayOutcome<TPayload>> {
  const registry = request.modelRegistry;
  if (!registry) {
    throw new TypeError("invokeRoutedThroughRegistry requires a model registry");
  }

  const resolution = registry.resolveModel({
    purpose: request.purpose,
    declaredModel: request.model,
    requirements: request.routingRequirements ?? null,
  });
  if (resolution.decision === "deny") {
    deps.log("warn", "gateway.decision.deny", {
      decision: "deny",
      code: "model_unroutable",
      routing_code: resolution.code,
      reason: resolution.reason,
    });
    return { decision: "deny", code: "model_unroutable", reason: resolution.reason };
  }

  const failurePolicy = request.failurePolicy ?? AI_GATEWAY_FAILURE_POLICY;
  const attempted: string[] = [];
  const rationale: RoutingRationaleStep[] = [];
  let lastProviderError: { code: string; reason: string } | null = null;

  // J-015: the routing rationale chain opens with the registry's route
  // decision — every downstream consumer must be able to answer "under which
  // policy was this model chosen".
  rationale.push({
    stage: "registry_route_resolved",
    model: resolution.modelId,
    detail: `Model registry resolved purpose "${request.purpose}" to the ordered candidate queue [${resolution.candidates.join(", ")}] with primary route "${resolution.modelId}"`,
  });

  for (const modelId of resolution.candidates) {
    if (registry.healthOf(modelId) !== "healthy") {
      rationale.push({
        stage: "health_gate_skip",
        model: modelId,
        detail: `Candidate skipped: registry health is "${registry.healthOf(modelId)}"`,
      });
      deps.log("warn", "gateway.routing.skip_unhealthy", {
        model: modelId,
        health: registry.healthOf(modelId),
      });
      continue;
    }

    if (request.ledger && request.budget) {
      const budget = precheckGatewayBudget(request.budget, request.ledger, request.tenantRef);
      if (budget.decision === "deny") {
        deps.log("warn", "gateway.decision.deny", {
          decision: "deny",
          code: "budget_exhausted",
          reason: budget.reason,
          model: modelId,
        });
        return { decision: "deny", code: "budget_exhausted", reason: budget.reason };
      }
    }

    if (request.rateLimiter) {
      const limit = request.rateLimiter.check(
        `${request.tenantRef}:${request.actorRef}`,
        deps.now(),
      );
      if (limit.decision === "deny") {
        const reason = `Rate limit exceeded for ${request.tenantRef}:${request.actorRef}; retry after ${limit.retryAfterMs}ms`;
        deps.log("warn", "gateway.decision.deny", {
          decision: "deny",
          code: "rate_limited",
          reason,
          retry_after_ms: limit.retryAfterMs,
          model: modelId,
        });
        return { decision: "deny", code: "rate_limited", reason };
      }
    }

    attempted.push(modelId);
    const startMs = deps.now();
    deps.log("info", "gateway.invoke.start", { model: modelId });

    const policyOutcome = await failurePolicy.run({
      operation: "ai-gateway.invoke",
      // Billed, non-idempotent model calls are never transport-retried here;
      // failover is model-level fallback, not a blind retry of the same call.
      maxAttempts: 1,
      call: async () => {
        const provider = createAiGatewayProvider(deps.apiKey);
        return request.invoke(provider, {
          model: modelId,
          providerClass: registry.describeModel(modelId).providerClass,
        });
      },
    });

    if (policyOutcome.outcome === "error") {
      registry.recordFailure(modelId);
      lastProviderError = { code: policyOutcome.code, reason: policyOutcome.reason };
      rationale.push({
        stage: "fallback_attempt_failed",
        model: modelId,
        detail: `Attempt failed (code=${policyOutcome.code}); advancing to the next routed candidate`,
      });
      deps.log("error", "gateway.invoke.error", {
        model: modelId,
        duration_ms: deps.now() - startMs,
        code: policyOutcome.code,
        reason: policyOutcome.reason,
      });
      continue;
    }

    const result = policyOutcome.value;
    registry.recordSuccess(modelId);
    const durationMs = deps.now() - startMs;
    rationale.push({
      stage: "provider_success",
      model: modelId,
      detail: "Attempt succeeded; output is attributed to this model through the governed path",
    });
    const costInput: UsageCostInput = {
      model: modelId,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
    const usage: UsageRecord = {
      tenantRef: request.tenantRef,
      actorRef: request.actorRef,
      agentRef: request.agentRef ?? null,
      missionRef: request.missionRef ?? null,
      model: modelId,
      provider: request.provider,
      purpose: request.purpose,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs,
      estimatedCostUsd: request.rates ? estimateCostUsd(costInput, request.rates) : null,
      at: new Date(deps.now()).toISOString(),
    };
    // J-015: every successful output leaves the gateway with its own
    // intelligence snapshot — the fallback winner's snapshot names the model
    // that actually produced the output and the full rationale chain.
    const intelligence = stampIntelligence({
      request,
      modelId,
      providerClass: registry.describeModel(modelId).providerClass,
      routedViaRegistry: true,
      rationale,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      estimatedCostUsd: usage.estimatedCostUsd,
      output: result.payload,
      recordedAt: usage.at,
    });
    const meteredUsage: UsageRecord & { intelligence: IntelligenceSnapshot } = {
      ...usage,
      intelligence,
    };
    if (request.ledger) {
      request.ledger.recordUsage(meteredUsage);
    }
    deps.log("info", "gateway.invoke.end", {
      model: modelId,
      duration_ms: durationMs,
      usage_in: result.tokensIn,
      usage_out: result.tokensOut,
      estimated_cost_usd: usage.estimatedCostUsd,
      snapshot_id: intelligence.snapshotId,
    });
    return { decision: "allow", payload: result.payload, usage: meteredUsage, intelligence };
  }

  if (lastProviderError) {
    const reason = `AI invocation failed at the adapter boundary (code=${lastProviderError.code}) for every routed model (${attempted.join(", ") || "none"}): ${lastProviderError.reason}`;
    deps.log("error", "gateway.decision.deny", {
      decision: "deny",
      code: "provider_failed",
      reason,
    });
    return { decision: "deny", code: "provider_failed", reason };
  }

  const reason = `Routing exhausted: no healthy registered model could serve purpose "${request.purpose}"`;
  deps.log("warn", "gateway.decision.deny", {
    decision: "deny",
    code: "model_unroutable",
    reason,
  });
  return { decision: "deny", code: "model_unroutable", reason };
}

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
 *
 * J-015: every ALLOW outcome carries an immutable intelligence snapshot
 * (which model, which context version, which routing/policy decision, token
 * and cost attribution, deterministic output digest). The snapshot also
 * flows into the usage-ledger record for the invocation.
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

  // J-014: with a wired registry, routing is a gateway decision made before
  // any metered attempt; budget/rate/authorization re-apply per candidate.
  if (request.modelRegistry) {
    return invokeRoutedThroughRegistry(request, { now, apiKey, log });
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
        return request.invoke(provider, { model: request.model, providerClass: null });
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
      result = await request.invoke(provider, { model: request.model, providerClass: null });
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
  // J-015: the legacy declared path stamps the same fail-closed snapshot —
  // no registry means the rationale records the declared-path decision.
  const intelligence = stampIntelligence({
    request,
    modelId: request.model,
    providerClass: null,
    routedViaRegistry: false,
    rationale: [
      {
        stage: "legacy_declared_path",
        model: request.model,
        detail:
          "No model registry wired; the declared model was invoked directly through the governed gateway path",
      },
    ],
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    estimatedCostUsd: usage.estimatedCostUsd,
    output: result.payload,
    recordedAt: usage.at,
  });
  const meteredUsage: UsageRecord & { intelligence: IntelligenceSnapshot } = {
    ...usage,
    intelligence,
  };
  if (request.ledger) {
    request.ledger.recordUsage(meteredUsage);
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
    snapshot_id: intelligence.snapshotId,
  });

  return { decision: "allow", payload: result.payload, usage: meteredUsage, intelligence };
}
