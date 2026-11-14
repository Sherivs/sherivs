/**
 * Sherivs Entity Engine — earned-autonomy ladder (ENGINE-01, ADR-078).
 *
 * Every capability of every agent starts in SHADOW: it computes a proposal that
 * is logged and shown for comparison, and nothing executes. Autonomy is earned
 * one rung at a time from evaluation evidence and is withdrawn automatically on
 * regression. The role pack is the ceiling; the ladder is the current floor.
 *
 *   shadow -> propose -> assist -> autonomous
 *
 * Hard rules:
 *  - T3 can never reach autonomous, whatever the evidence.
 *  - T2 reaches autonomous only if the pack marks it promotable AND the
 *    sheriff recorded an explicit promotion.
 *  - Stale evidence promotes nothing.
 *  - A regression or a kill demotes at once; promotion is one rung at a time.
 *
 * Pure functions: no I/O, no clock (the caller supplies `nowMs`).
 */
import {
  tierRank,
  type PackAutonomyMode,
  type RolePackCapability,
  type RolePackTier,
} from "./role-pack";

export const TRUST_STATES = ["shadow", "propose", "assist", "autonomous"] as const;
export type TrustState = (typeof TRUST_STATES)[number];

export interface EvalEvidence {
  readonly samples: number;
  /** Fraction of evaluated runs that met the capability's acceptance bar, 0..1. */
  readonly passRate: number;
  /** Safety or policy regressions observed in the window. */
  readonly regressions: number;
  readonly evaluatedAtMs: number;
}

export interface TrustRecord {
  readonly capabilityId: string;
  readonly state: TrustState;
  /** Present only when the sheriff explicitly promoted a T2 capability. */
  readonly sheriffPromotionId?: string;
}

export const EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEMOTE_BELOW_PASS_RATE = 0.9;

/** Minimum evidence to climb into the named state. */
export const PROMOTION_BAR: Readonly<
  Record<Exclude<TrustState, "shadow">, { samples: number; passRate: number }>
> = Object.freeze({
  propose: { samples: 20, passRate: 0.9 },
  assist: { samples: 50, passRate: 0.95 },
  autonomous: { samples: 200, passRate: 0.98 },
});

/** What the agent may actually do with a capability right now. */
export type EffectiveAutonomy = "shadow" | PackAutonomyMode;

const MODE_RANK: Readonly<Record<EffectiveAutonomy, number>> = {
  shadow: 0,
  propose_only: 1,
  act_with_approval: 2,
  act_autonomously: 3,
};

const minMode = (a: EffectiveAutonomy, b: EffectiveAutonomy): EffectiveAutonomy =>
  MODE_RANK[a] <= MODE_RANK[b] ? a : b;

const STATE_CEILING: Readonly<Record<TrustState, EffectiveAutonomy>> = {
  shadow: "shadow",
  propose: "propose_only",
  assist: "act_with_approval",
  autonomous: "act_autonomously",
};

/**
 * The autonomy a capability may use now: the lower of the pack declaration and
 * the earned trust state. T3 is capped at approval; T2 is capped at approval
 * unless the sheriff recorded a promotion.
 */
export function effectiveAutonomy(
  capability: Pick<RolePackCapability, "tier" | "autonomy" | "promotableToAutonomous">,
  record: TrustRecord | undefined,
): EffectiveAutonomy {
  if (!record) return "shadow";
  let result = minMode(capability.autonomy, STATE_CEILING[record.state]);
  const tier: RolePackTier = capability.tier;
  if (tier === "T4") return "shadow";
  if (tier === "T3") result = minMode(result, "act_with_approval");
  if (tier === "T2") {
    const promoted =
      capability.promotableToAutonomous === true &&
      record.state === "autonomous" &&
      record.sheriffPromotionId !== undefined &&
      capability.autonomy !== "propose_only";
    result = promoted ? "act_autonomously" : minMode(result, "act_with_approval");
  }
  return result;
}

const nextState = (s: TrustState): TrustState | null => {
  const i = TRUST_STATES.indexOf(s);
  return i >= 0 && i < TRUST_STATES.length - 1 ? (TRUST_STATES[i + 1] as TrustState) : null;
};

/** A promotion is meaningful only at the top rung; any other state drops it. */
const withState = (record: TrustRecord, state: TrustState): TrustRecord =>
  state === "autonomous" && record.sheriffPromotionId !== undefined
    ? { capabilityId: record.capabilityId, state, sheriffPromotionId: record.sheriffPromotionId }
    : { capabilityId: record.capabilityId, state };

const prevState = (s: TrustState): TrustState => {
  const i = TRUST_STATES.indexOf(s);
  return i <= 0 ? "shadow" : (TRUST_STATES[i - 1] as TrustState);
};

export type TrustChange =
  | { readonly changed: false; readonly record: TrustRecord; readonly reason: string }
  | {
      readonly changed: true;
      readonly record: TrustRecord;
      readonly reason: string;
      readonly from: TrustState;
    };

/**
 * Apply evidence. Demotion is checked first and is immediate; promotion needs
 * fresh evidence that clears the bar for the next rung, climbs one rung, and
 * never passes the tier caps.
 */
export function applyEvidence(
  capability: Pick<RolePackCapability, "tier" | "promotableToAutonomous">,
  record: TrustRecord,
  evidence: EvalEvidence,
  nowMs: number,
): TrustChange {
  if (evidence.regressions > 0 || evidence.passRate < DEMOTE_BELOW_PASS_RATE) {
    if (record.state === "shadow") return { changed: false, record, reason: "already_shadow" };
    return {
      changed: true,
      from: record.state,
      record: withState(record, prevState(record.state)),
      reason: evidence.regressions > 0 ? "regression" : "pass_rate_below_floor",
    };
  }
  if (nowMs - evidence.evaluatedAtMs > EVIDENCE_MAX_AGE_MS || evidence.evaluatedAtMs > nowMs) {
    return { changed: false, record, reason: "evidence_stale_or_invalid" };
  }
  const next = nextState(record.state);
  if (next === null) return { changed: false, record, reason: "at_top" };
  if (tierRank(capability.tier) >= tierRank("T3") && next === "autonomous") {
    return { changed: false, record, reason: "t3_never_autonomous" };
  }
  if (capability.tier === "T2" && next === "autonomous") {
    if (capability.promotableToAutonomous !== true) {
      return { changed: false, record, reason: "t2_not_promotable" };
    }
    if (record.sheriffPromotionId === undefined) {
      return { changed: false, record, reason: "t2_needs_sheriff_promotion" };
    }
  }
  const bar = PROMOTION_BAR[next as Exclude<TrustState, "shadow">];
  if (evidence.samples < bar.samples || evidence.passRate < bar.passRate) {
    return { changed: false, record, reason: "evidence_below_bar" };
  }
  return { changed: true, from: record.state, record: withState(record, next), reason: "promoted" };
}

/** A kill or revocation returns the capability to shadow and drops any promotion. */
export function resetToShadow(record: TrustRecord): TrustRecord {
  return { capabilityId: record.capabilityId, state: "shadow" };
}

/** Initial record for every capability of a newly provisioned agent. */
export function initialTrust(capabilityIds: readonly string[]): readonly TrustRecord[] {
  return capabilityIds.map((capabilityId) => ({ capabilityId, state: "shadow" as const }));
}
