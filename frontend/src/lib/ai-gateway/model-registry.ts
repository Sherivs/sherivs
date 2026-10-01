/**
 * CoreGrid — AI model registry, routing policy & fallback chains (J-014,
 * V1CAP-028, MISSION-R-31; Constitution §20 gateway-owned routing, §25
 * provider neutrality).
 *
 * PURE module: no I/O, no provider imports, no environment reads. The
 * registry is the declared truth about which models MAY serve organizational
 * intelligence purposes, under which capability/cost/latency requirements,
 * and in which order alternatives are attempted when a route fails.
 *
 * Design laws honored here:
 * - §20 (AI gateway): ALL routing lives inside the gateway perimeter. Nothing
 *   here ever contacts a provider; the registry only decides which model the
 *   governed invocation path (invokeAiGateway) is allowed to attempt.
 * - §25 (provider-agnostic): models declare a logical `providerClass`, never
 *   a vendor identity. Vendor bindings belong to adapters, not to routing.
 * - Fail-closed: malformed declarations (duplicate ids, invalid profiles,
 *   fallback chains naming unregistered models) throw at construction — a
 *   broken registry can never silently route. Unknown purposes/models are
 *   typed denials, never guesses.
 * - Circuit-breaker handoff (§18 security fabric): the registry reuses the
 *   adapter failure-policy health vocabulary (`AdapterMode`, J-045). It owns
 *   a per-model health state machine — consecutive failures move a model
 *   healthy -> degraded -> isolated, a success resets it — and routing skips
 *   every model whose health is not "healthy". The invocation-level breaker
 *   stays in the AdapterFailurePolicy wired by the gateway; this module
 *   consumes its outcome vocabulary, it never re-implements it.
 */

import type { AdapterMode } from "../adapters/failure-policy";
import { GATEWAY_PURPOSES, type GatewayPurpose } from "../metering/usage-ledger";

/** Declared expected-cost bucket of a model (budget routing dimension). */
export type ModelCostTier = "low" | "medium" | "high";

/** Declared expected-latency bucket of a model (latency routing dimension). */
export type ModelLatencyTier = "low" | "medium" | "high";

const TIER_RANK: Readonly<Record<string, number>> = { low: 0, medium: 1, high: 2 };

export interface ModelCapabilityProfile {
  /** Declared context window in tokens (finite positive integer). */
  contextWindowTokens: number;
  /** Expected latency tier of the model class. */
  latencyTier: ModelLatencyTier;
  /** Expected cost tier of the model class. */
  costTier: ModelCostTier;
}

export interface DeclaredModel {
  /** Stable model id (e.g. "coregrid/flash"); the usage-ledger model key. */
  id: string;
  /** Logical provider class — vendor-neutral (§25), never a vendor brand. */
  providerClass: string;
  /** Capability/cost/latency profile used by the routing policy. */
  profile: ModelCapabilityProfile;
  /** Starting health state; defaults to "healthy". */
  initialHealth?: AdapterMode;
}

/** Purpose-scoped ordered alternatives (first entry is the primary route). */
export type FallbackChain = readonly string[];

export interface ModelHealthPolicy {
  /** Consecutive failures that degrade a model. Default 1. */
  degradedAfterFailures?: number;
  /** Consecutive failures that isolate a model. Default 3. */
  isolatedAfterFailures?: number;
}

interface ResolvedHealthPolicy {
  degradedAfterFailures: number;
  isolatedAfterFailures: number;
}

export interface ModelRegistryConfig {
  models: readonly DeclaredModel[];
  /** Purpose -> ordered alternative model ids (all ids must be declared). */
  fallbackChains?: Readonly<Partial<Record<GatewayPurpose, FallbackChain>>>;
  health?: ModelHealthPolicy;
}

export interface ModelRoutingRequirements {
  /** Maximum acceptable declared cost tier (inclusive). */
  maxCostTier?: ModelCostTier;
  /** Maximum acceptable declared latency tier (inclusive). */
  maxLatencyTier?: ModelLatencyTier;
  /** Minimum declared context window in tokens (inclusive). */
  minContextWindowTokens?: number;
}

export interface ModelRoutingRequest {
  purpose: GatewayPurpose;
  /** Caller-declared model; must be registered when provided. */
  declaredModel?: string | null;
  /** Purpose requirements the route must satisfy. */
  requirements?: ModelRoutingRequirements | null;
}

export type ModelRoutingDenyCode =
  | "unknown_purpose"
  | "unregistered_model"
  | "no_registered_model"
  | "no_routable_model";

export type ModelRoutingDecision =
  | {
      decision: "allow";
      /** The selected primary model. */
      modelId: string;
      providerClass: string;
      profile: ModelCapabilityProfile;
      /**
       * The full ordered attempt queue for this invocation (primary first,
       * then fallback alternatives in declared order). The gateway walks this
       * queue through the same governed path — never a raw provider call.
       */
      candidates: readonly string[];
    }
  | { decision: "deny"; code: ModelRoutingDenyCode; reason: string };

export interface ModelHealthSnapshot {
  id: string;
  providerClass: string;
  health: AdapterMode;
  consecutiveFailures: number;
}

interface ModelState {
  model: DeclaredModel;
  health: AdapterMode;
  consecutiveFailures: number;
}

function isTier(value: unknown): value is ModelCostTier | ModelLatencyTier {
  return typeof value === "string" && value in TIER_RANK;
}

function requireNonEmpty(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`ModelRegistry.${name} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new TypeError(`ModelRegistry.${name} must be a finite positive integer`);
  }
  return value;
}

function validateDeclaredModel(entry: DeclaredModel): DeclaredModel {
  const id = requireNonEmpty("models[].id", entry.id);
  const providerClass = requireNonEmpty("models[].providerClass", entry.providerClass);
  const contextWindowTokens = requirePositiveInteger(
    "models[].profile.contextWindowTokens",
    entry.profile?.contextWindowTokens,
  );
  if (!isTier(entry.profile?.latencyTier)) {
    throw new TypeError(
      `ModelRegistry.models[${id}].profile.latencyTier must be "low", "medium" or "high"`,
    );
  }
  if (!isTier(entry.profile?.costTier)) {
    throw new TypeError(
      `ModelRegistry.models[${id}].profile.costTier must be "low", "medium" or "high"`,
    );
  }
  const initialHealth = entry.initialHealth ?? "healthy";
  if (!["healthy", "degraded", "isolated"].includes(initialHealth)) {
    throw new TypeError(`ModelRegistry.models[${id}].initialHealth is not a valid AdapterMode`);
  }
  return {
    id,
    providerClass,
    profile: {
      contextWindowTokens,
      latencyTier: entry.profile.latencyTier,
      costTier: entry.profile.costTier,
    },
    initialHealth,
  };
}

function resolveHealthPolicy(policy: ModelHealthPolicy | undefined): ResolvedHealthPolicy {
  const degradedAfterFailures = policy?.degradedAfterFailures ?? 1;
  const isolatedAfterFailures = policy?.isolatedAfterFailures ?? 3;
  requirePositiveInteger("health.degradedAfterFailures", degradedAfterFailures);
  requirePositiveInteger("health.isolatedAfterFailures", isolatedAfterFailures);
  if (degradedAfterFailures > isolatedAfterFailures) {
    throw new TypeError(
      "ModelRegistry.health.degradedAfterFailures must be <= isolatedAfterFailures",
    );
  }
  return { degradedAfterFailures, isolatedAfterFailures };
}

function satisfiesRequirements(
  model: DeclaredModel,
  requirements: ModelRoutingRequirements | null | undefined,
): boolean {
  if (!requirements) return true;
  if (
    requirements.maxCostTier !== undefined &&
    TIER_RANK[model.profile.costTier] > TIER_RANK[requirements.maxCostTier]
  ) {
    return false;
  }
  if (
    requirements.maxLatencyTier !== undefined &&
    TIER_RANK[model.profile.latencyTier] > TIER_RANK[requirements.maxLatencyTier]
  ) {
    return false;
  }
  if (
    requirements.minContextWindowTokens !== undefined &&
    model.profile.contextWindowTokens < requirements.minContextWindowTokens
  ) {
    return false;
  }
  return true;
}

/**
 * The model registry. Declared models, purpose-scoped fallback chains and a
 * per-model health state machine (AdapterMode vocabulary, J-045 handoff).
 * Construction is fail-closed; after construction only health mutates.
 */
export class ModelRegistry {
  private readonly states = new Map<string, ModelState>();
  /** Registration order — the deterministic base ordering when no chain applies. */
  private readonly registrationOrder: string[] = [];
  private readonly chains = new Map<GatewayPurpose, FallbackChain>();
  private readonly healthPolicy: ResolvedHealthPolicy;

  constructor(config: ModelRegistryConfig) {
    this.healthPolicy = resolveHealthPolicy(config.health);
    if (!Array.isArray(config.models)) {
      throw new TypeError("ModelRegistry.models must be an array");
    }
    for (const entry of config.models) {
      const model = validateDeclaredModel(entry);
      if (this.states.has(model.id)) {
        throw new TypeError(`ModelRegistry declares duplicate model id "${model.id}"`);
      }
      this.states.set(model.id, {
        model,
        health: model.initialHealth ?? "healthy",
        consecutiveFailures: 0,
      });
      this.registrationOrder.push(model.id);
    }
    if (config.fallbackChains) {
      for (const [purpose, chain] of Object.entries(config.fallbackChains)) {
        if (!GATEWAY_PURPOSES.includes(purpose as GatewayPurpose)) {
          throw new TypeError(`ModelRegistry.fallbackChains has unknown purpose "${purpose}"`);
        }
        this.setFallbackChain(purpose as GatewayPurpose, chain ?? []);
      }
    }
  }

  /** Declare (or replace) the ordered fallback chain for a purpose. */
  setFallbackChain(purpose: GatewayPurpose, chain: FallbackChain): void {
    if (!GATEWAY_PURPOSES.includes(purpose)) {
      throw new TypeError(`ModelRegistry.setFallbackChain: unknown purpose "${String(purpose)}"`);
    }
    if (!Array.isArray(chain)) {
      throw new TypeError("ModelRegistry.setFallbackChain: chain must be an array");
    }
    const seen = new Set<string>();
    const validated: string[] = [];
    for (const id of chain) {
      const modelId = requireNonEmpty("setFallbackChain[].id", id);
      if (!this.states.has(modelId)) {
        throw new TypeError(
          `ModelRegistry.setFallbackChain: "${modelId}" is not a registered model (fail closed)`,
        );
      }
      if (seen.has(modelId)) {
        throw new TypeError(
          `ModelRegistry.setFallbackChain: duplicate entry "${modelId}" in the chain for ${purpose}`,
        );
      }
      seen.add(modelId);
      validated.push(modelId);
    }
    this.chains.set(purpose, validated);
  }

  fallbackChainFor(purpose: GatewayPurpose): FallbackChain {
    return this.chains.get(purpose) ?? [];
  }

  registeredModels(): readonly string[] {
    return [...this.registrationOrder];
  }

  /**
   * Current health of a model. Unknown ids throw — querying an undeclared
   * model is a programming error, never a health verdict.
   */
  healthOf(modelId: string): AdapterMode {
    const state = this.states.get(modelId);
    if (!state) {
      throw new TypeError(`ModelRegistry.healthOf: unknown model "${modelId}"`);
    }
    return state.health;
  }

  /**
   * Record an invocation failure (circuit-breaker handoff, J-045): the
   * failure count moves the model healthy -> degraded -> isolated per the
   * declared health policy. Routing skips every model that is not healthy.
   */
  recordFailure(modelId: string): AdapterMode {
    const state = this.states.get(modelId);
    if (!state) {
      throw new TypeError(`ModelRegistry.recordFailure: unknown model "${modelId}"`);
    }
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.healthPolicy.isolatedAfterFailures) {
      state.health = "isolated";
    } else if (state.consecutiveFailures >= this.healthPolicy.degradedAfterFailures) {
      state.health = "degraded";
    }
    return state.health;
  }

  /**
   * Record a successful invocation: failure history resets and the model
   * returns to "healthy" (mirrors the adapter failure-policy recovery rule).
   */
  recordSuccess(modelId: string): AdapterMode {
    const state = this.states.get(modelId);
    if (!state) {
      throw new TypeError(`ModelRegistry.recordSuccess: unknown model "${modelId}"`);
    }
    state.consecutiveFailures = 0;
    state.health = "healthy";
    return state.health;
  }

  /**
   * Operator-declared health (e.g. quarantining a model). Resets the failure
   * counter; the state machine takes over again from the declared state.
   */
  declareHealth(modelId: string, health: AdapterMode): AdapterMode {
    const state = this.states.get(modelId);
    if (!state) {
      throw new TypeError(`ModelRegistry.declareHealth: unknown model "${modelId}"`);
    }
    if (!["healthy", "degraded", "isolated"].includes(health)) {
      throw new TypeError(`ModelRegistry.declareHealth: "${String(health)}" is not a valid AdapterMode`);
    }
    state.health = health;
    state.consecutiveFailures = 0;
    return state.health;
  }

  healthSnapshot(): readonly ModelHealthSnapshot[] {
    return this.registrationOrder.map((id) => {
      const state = this.states.get(id);
      return {
        id,
        providerClass: state!.model.providerClass,
        health: state!.health,
        consecutiveFailures: state!.consecutiveFailures,
      };
    });
  }

  describeModel(modelId: string): DeclaredModel {
    const state = this.states.get(modelId);
    if (!state) {
      throw new TypeError(`ModelRegistry.describeModel: unknown model "${modelId}"`);
    }
    return state.model;
  }

  /**
   * Resolve the route for one invocation. Deterministic: candidate order is
   * the declared fallback chain (when present) else registration order; the
   * declared model (when registered) is prepended as the primary route.
   * Requirements filter candidates; health filtering skips every model that
   * is not "healthy". No candidate -> typed denial (fail closed).
   */
  resolveModel(request: ModelRoutingRequest): ModelRoutingDecision {
    if (!GATEWAY_PURPOSES.includes(request.purpose)) {
      return {
        decision: "deny",
        code: "unknown_purpose",
        reason: `Routing denied: purpose "${String(request.purpose)}" is not an organizational-intelligence purpose`,
      };
    }
    if (this.states.size === 0) {
      return {
        decision: "deny",
        code: "no_registered_model",
        reason: `Routing denied: the model registry declares no models for purpose "${request.purpose}"`,
      };
    }

    const declared = request.declaredModel?.trim() ?? "";
    let ordered: string[];
    if (declared.length > 0) {
      if (!this.states.has(declared)) {
        return {
          decision: "deny",
          code: "unregistered_model",
          reason: `Routing denied: declared model "${declared}" is not registered in the model registry`,
        };
      }
      ordered = [declared, ...this.fallbackChainFor(request.purpose).filter((id) => id !== declared)];
    } else {
      const chain = this.fallbackChainFor(request.purpose);
      ordered = chain.length > 0 ? [...chain] : [...this.registrationOrder];
    }

    const matching = ordered.filter((id) =>
      satisfiesRequirements(this.states.get(id)!.model, request.requirements),
    );
    if (matching.length === 0) {
      return {
        decision: "deny",
        code: "no_routable_model",
        reason: `Routing denied: no declared model for purpose "${request.purpose}" satisfies the declared requirements`,
      };
    }

    const healthy = matching.filter((id) => this.healthOf(id) === "healthy");
    if (healthy.length === 0) {
      return {
        decision: "deny",
        code: "no_routable_model",
        reason: `Routing denied: every model matching purpose "${request.purpose}" is unhealthy (degraded or isolated by failure history)`,
      };
    }

    const selected = healthy[0];
    const model = this.states.get(selected)!.model;
    return {
      decision: "allow",
      modelId: selected,
      providerClass: model.providerClass,
      profile: model.profile,
      candidates: healthy,
    };
  }
}