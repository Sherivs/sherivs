/**
 * CoreGrid — payment routing and provider neutrality (Phase 13, domain-neutral).
 *
 * FinOS never depends on one payment provider and never hard-codes one. A provider
 * is a profile that declares what it can do; routing is a decision over those
 * declared capabilities plus the transaction's requirements, the tenant's policy
 * and cost. Two laws keep this safe:
 *
 *   - capability dominates preference: a policy may order eligible candidates, it
 *     can never make an ineligible provider eligible;
 *   - failover is refused unless the provider proved that no capture occurred. An
 *     attempt that timed out is unresolved, never failed, because treating it as a
 *     failure is exactly how systems double-charge a payer.
 *
 * Every decision is explainable: which candidates were considered, which capability
 * disqualified each rejected one, and which policy applied.
 */
import type { PaymentMethodKind } from "./financial-payments";

export interface ProviderCapabilities {
  /** The payment methods this provider actually serves (institutional data, not a fixed list). */
  readonly paymentMethods: readonly PaymentMethodKind[];
  readonly currencies: readonly string[];
  /** Jurisdictions the provider is licensed to serve, as declared data. */
  readonly jurisdictions: readonly string[];
  readonly supportsPartialRefund: boolean;
  readonly supportsSplit: boolean;
  readonly captureModel: "immediate" | "authorize-then-capture" | "manual";
  /** How the provider proves a webhook came from it — never "trusted because it arrived". */
  readonly webhookSignatureScheme: string;
}

export interface ProviderProfile {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  /** Declared cost in basis points, used for cost ranking only. */
  readonly feeBasisPoints?: number;
  readonly active: boolean;
}

export interface RoutingRequirement {
  readonly currency: string;
  readonly paymentMethod: PaymentMethodKind;
  readonly jurisdiction: string;
  readonly requiresSplit?: boolean;
  readonly requiresPartialRefund?: boolean;
}

export interface CandidateEvaluation {
  readonly providerId: string;
  readonly eligible: boolean;
  /** The single capability that disqualified this candidate, stated in words. */
  readonly disqualifiedBy?: string;
}

export interface RoutingDecision {
  readonly providerId: string | null;
  readonly candidates: readonly CandidateEvaluation[];
  readonly policyApplied: readonly string[];
  readonly reason: string;
}

export interface RoutingPolicy {
  readonly preferredProviderIds?: readonly string[];
  readonly maxFeeBasisPoints?: number;
  /** Refuse already-inactive providers rather than routing to them (default true). */
  readonly requireActive?: boolean;
}

/**
 * Choose a provider for one requirement. Returns a decision with no provider when
 * none can serve it — an unroutable requirement is reported, never forced through a
 * provider that cannot serve it.
 */
export function selectPaymentRoute(input: {
  readonly providers: readonly ProviderProfile[];
  readonly requirement: RoutingRequirement;
  readonly policy?: RoutingPolicy;
}): RoutingDecision {
  const policy: Required<RoutingPolicy> = {
    preferredProviderIds: input.policy?.preferredProviderIds ?? [],
    maxFeeBasisPoints: input.policy?.maxFeeBasisPoints ?? Number.POSITIVE_INFINITY,
    requireActive: input.policy?.requireActive ?? true,
  };
  const policyApplied: string[] = [];
  if (policy.preferredProviderIds.length > 0) policyApplied.push("tenant preference order");
  if (Number.isFinite(policy.maxFeeBasisPoints)) {
    policyApplied.push(`declared cost ceiling ${policy.maxFeeBasisPoints} basis points`);
  }
  if (policy.requireActive) policyApplied.push("inactive providers refused");

  const candidates: CandidateEvaluation[] = input.providers.map((provider) => {
    const disqualifier = disqualifyingCapability(provider, input.requirement, policy);
    return disqualifier
      ? { providerId: provider.providerId, eligible: false, disqualifiedBy: disqualifier }
      : { providerId: provider.providerId, eligible: true };
  });

  const eligible = input.providers.filter(
    (provider) =>
      candidates.find((candidate) => candidate.providerId === provider.providerId)?.eligible,
  );

  if (eligible.length === 0) {
    return {
      providerId: null,
      candidates,
      policyApplied,
      reason: "no declared provider capability serves this requirement",
    };
  }

  const ranked = [...eligible].sort((a, b) => {
    const aPreference = policy.preferredProviderIds.indexOf(a.providerId);
    const bPreference = policy.preferredProviderIds.indexOf(b.providerId);
    const aRank = aPreference === -1 ? Number.POSITIVE_INFINITY : aPreference;
    const bRank = bPreference === -1 ? Number.POSITIVE_INFINITY : bPreference;
    if (aRank !== bRank) return aRank - bRank;
    const aFee = a.feeBasisPoints ?? Number.POSITIVE_INFINITY;
    const bFee = b.feeBasisPoints ?? Number.POSITIVE_INFINITY;
    if (aFee !== bFee) return aFee - bFee;
    return a.providerId.localeCompare(b.providerId);
  });

  const chosen = ranked[0];
  const disqualified = candidates.filter((candidate) => !candidate.eligible);
  return {
    providerId: chosen.providerId,
    candidates,
    policyApplied,
    reason:
      disqualified.length === 0
        ? `every declared provider could serve this requirement; ${chosen.providerId} was selected by cost and preference order`
        : `${chosen.providerId} was selected; ${disqualified
            .map((candidate) => `${candidate.providerId} (${candidate.disqualifiedBy})`)
            .join(", ")} could not serve it`,
  };
}

function disqualifyingCapability(
  provider: ProviderProfile,
  requirement: RoutingRequirement,
  policy: Required<RoutingPolicy>,
): string | null {
  if (policy.requireActive && !provider.active) return "provider is not active";
  if (!provider.capabilities.currencies.includes(requirement.currency)) {
    return `does not settle ${requirement.currency}`;
  }
  if (!provider.capabilities.paymentMethods.includes(requirement.paymentMethod)) {
    return `does not support the ${requirement.paymentMethod} method`;
  }
  if (!provider.capabilities.jurisdictions.includes(requirement.jurisdiction)) {
    return `not declared for jurisdiction ${requirement.jurisdiction}`;
  }
  if (requirement.requiresSplit && !provider.capabilities.supportsSplit)
    return "cannot route a split payment";
  if (requirement.requiresPartialRefund && !provider.capabilities.supportsPartialRefund) {
    return "cannot support partial refunds";
  }
  if ((provider.feeBasisPoints ?? 0) > policy.maxFeeBasisPoints) {
    return `declared cost ${provider.feeBasisPoints} exceeds the ceiling`;
  }
  return null;
}

export type FailoverDecision =
  | { readonly allowed: true; readonly toProviderId: string; readonly reason: string }
  | { readonly allowed: false; readonly reason: string };

export type AttemptOutcome = "succeeded" | "declined" | "failed" | "unresolved_timeout";

export interface RouteAttempt {
  readonly providerId: string;
  readonly outcome: AttemptOutcome;
  /** True only when the provider produced evidence that no money was captured. */
  readonly providerProvedNoCapture: boolean;
}

/**
 * Failover safety: re-route only where the provider proved no capture. A timeout is
 * unresolved — it must be verified with the provider before any retry or failover.
 */
export function canFailover(input: {
  readonly attempt: RouteAttempt;
  readonly toProviderId: string;
}): FailoverDecision {
  const { attempt, toProviderId } = input;
  if (attempt.providerId === toProviderId) {
    return { allowed: false, reason: "a failover must move to a different provider" };
  }
  if (attempt.outcome === "succeeded") {
    return {
      allowed: false,
      reason: "the attempt succeeded: failover would take the same money twice",
    };
  }
  if (attempt.outcome === "unresolved_timeout") {
    return {
      allowed: false,
      reason:
        "the attempt timed out and is unresolved: verify with the provider before any retry, because a timeout is not a failure",
    };
  }
  if (!attempt.providerProvedNoCapture) {
    return { allowed: false, reason: "the provider has not proved that no capture occurred" };
  }
  return {
    allowed: true,
    toProviderId,
    reason:
      "the provider declined or failed and proved no capture: re-routing cannot double-charge",
  };
}

/** Explain a routing decision in words an operator can act on. */
export function explainRoutingDecision(
  decision: RoutingDecision,
  providers: readonly ProviderProfile[],
): string {
  const lines = [`Routing decision: ${decision.providerId ?? "unroutable"}`];
  for (const candidate of decision.candidates) {
    const profile = providers.find((provider) => provider.providerId === candidate.providerId);
    lines.push(
      candidate.eligible
        ? `  - ${candidate.providerId} (${profile?.displayName ?? "unknown"}) was eligible`
        : `  - ${candidate.providerId} (${profile?.displayName ?? "unknown"}) was refused: ${candidate.disqualifiedBy}`,
    );
  }
  if (decision.policyApplied.length > 0)
    lines.push(`  policy applied: ${decision.policyApplied.join("; ")}`);
  lines.push(`  reason: ${decision.reason}`);
  return lines.join("\n");
}

/** Whether a provider can carry a multi-beneficiary payment at all. */
export function providerSupportsSplit(profile: ProviderProfile): boolean {
  return profile.active && profile.capabilities.supportsSplit;
}
