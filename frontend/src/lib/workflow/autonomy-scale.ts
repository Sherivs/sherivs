// AIN-02: the one autonomy scale. Pure, no I/O. The database is the authority (wf_autonomy_* tables, migration
// 20261117000980); this file restates its reviewed data so the application can explain a refusal and so a unit test
// can fail when the two drift apart. It does not grant anything: promotion happens only in wf_autonomy_promote.
import {
  DEMOTE_BELOW_PASS_RATE,
  EVIDENCE_MAX_AGE_MS,
  PROMOTION_BAR,
  type TrustState,
} from "@/lib/twin-engine/autonomy-ladder";
import {
  WORKFLOW_ACTION_CATEGORY_CAPS,
  WORKFLOW_AUTONOMY_LEVELS,
  type WorkflowAutonomyLevel,
} from "./workflow-actions";

export { WORKFLOW_AUTONOMY_LEVELS as AUTONOMY_SCALE };
export type AutonomyLevel = WorkflowAutonomyLevel;

/** The engine's ladder state (ENGINE-01) that each level stands for. */
export const LADDER_STATE_OF_LEVEL: Readonly<Record<AutonomyLevel, TrustState>> = Object.freeze({
  suggest: "shadow",
  draft: "propose",
  act_with_approval: "assist",
  act_and_report: "autonomous",
});

export const AUTONOMY_RANK: Readonly<Record<AutonomyLevel, number>> = Object.freeze({
  suggest: 0,
  draft: 1,
  act_with_approval: 2,
  act_and_report: 3,
});

export type AgentTier = "executive" | "department" | "assurance" | "organization";

/** The highest level an agent of this tier can ever hold (wf_autonomy_agent_tier_cap). An engineering default for the founder to ratify. */
export const AGENT_TIER_CAP: Readonly<Record<AgentTier, AutonomyLevel>> = Object.freeze({
  executive: "act_with_approval",
  department: "act_and_report",
  assurance: "draft",
  organization: "act_and_report",
});

/** The highest level a step of this action class can run at (wf_autonomy_class_cap). */
export const ACTION_CLASS_CAP: Readonly<Record<string, AutonomyLevel>> = Object.freeze({
  internal: "act_and_report",
  communication: "act_and_report",
  task: "act_and_report",
  wait: "act_and_report",
  unclassified: "draft",
  ai_model: "suggest",
  ...WORKFLOW_ACTION_CATEGORY_CAPS,
});

export interface AutonomyBar {
  readonly minGraded: number;
  readonly minPassRate: number;
  readonly maxAgeDays: number;
}

/** Evidence needed to be promoted INTO the named level. Restated from the ladder, never a second source. */
export const AUTONOMY_BAR: Readonly<Record<Exclude<AutonomyLevel, "suggest">, AutonomyBar>> =
  Object.freeze({
    draft: bar("propose"),
    act_with_approval: bar("assist"),
    act_and_report: bar("autonomous"),
  });

function bar(state: Exclude<TrustState, "shadow">): AutonomyBar {
  return {
    minGraded: PROMOTION_BAR[state].samples,
    minPassRate: PROMOTION_BAR[state].passRate,
    maxAgeDays: Math.round(EVIDENCE_MAX_AGE_MS / 86_400_000),
  };
}

/** A pass rate strictly below this is a regression (and so is any critical failure). */
export const AUTONOMY_DEMOTE_FLOOR = DEMOTE_BELOW_PASS_RATE;

export const autonomyRank = (level: string | null | undefined): number =>
  level !== null &&
  level !== undefined &&
  Object.prototype.hasOwnProperty.call(AUTONOMY_RANK, level)
    ? AUTONOMY_RANK[level as AutonomyLevel]
    : 0;

const lowest = (levels: readonly AutonomyLevel[]): AutonomyLevel =>
  levels.reduce((a, b) => (autonomyRank(b) < autonomyRank(a) ? b : a));

/** The agent's ceiling: what the tier allows. An unknown tier has the floor. */
export const agentCeiling = (tier: string | null | undefined): AutonomyLevel =>
  tier !== null && tier !== undefined && Object.prototype.hasOwnProperty.call(AGENT_TIER_CAP, tier)
    ? AGENT_TIER_CAP[tier as AgentTier]
    : "suggest";

/** The cap for an action class; a class the table does not know is capped at draft. */
export const classCap = (actionClass: string): AutonomyLevel =>
  Object.prototype.hasOwnProperty.call(ACTION_CLASS_CAP, actionClass)
    ? ACTION_CLASS_CAP[actionClass]!
    : "draft";

/** Mirror of wf_effective_autonomy: the lowest of the template, the organization, the earned level, the tier ceiling and the class cap. */
export function effectiveAutonomy(input: {
  template: AutonomyLevel;
  organization: AutonomyLevel;
  earned: AutonomyLevel;
  tier: string | null | undefined;
  actionClass: string;
}): AutonomyLevel {
  return lowest([
    input.template,
    input.organization,
    input.earned,
    agentCeiling(input.tier),
    classCap(input.actionClass),
  ]);
}

export interface PromotionEvidence {
  readonly graded: number;
  readonly passed: number;
  readonly criticalFailures: number;
  readonly ungraded: number;
  readonly ageMs: number;
}

export type PromotionVerdict =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: string };

/** Why a promotion would be refused, in the order the database checks it. Advisory: wf_autonomy_promote decides. */
export function explainPromotion(input: {
  from: AutonomyLevel;
  to: AutonomyLevel;
  tier: string | null | undefined;
  evidence: PromotionEvidence;
}): PromotionVerdict {
  const { from, to, tier, evidence } = input;
  if (autonomyRank(to) !== autonomyRank(from) + 1) {
    return { eligible: false, reason: "a promotion climbs exactly one rung" };
  }
  if (autonomyRank(to) > autonomyRank(agentCeiling(tier))) {
    return { eligible: false, reason: "above the ceiling for this agent tier" };
  }
  const needed = AUTONOMY_BAR[to as Exclude<AutonomyLevel, "suggest">];
  if (evidence.ageMs < 0 || evidence.ageMs > needed.maxAgeDays * 86_400_000) {
    return { eligible: false, reason: "the evidence is stale or dated in the future" };
  }
  if (evidence.criticalFailures > 0) {
    return { eligible: false, reason: "the evidence has a critical failure" };
  }
  if (
    evidence.graded < needed.minGraded ||
    evidence.passed < evidence.graded * needed.minPassRate
  ) {
    return { eligible: false, reason: "the evidence is below the bar for this level" };
  }
  if (autonomyRank(to) > AUTONOMY_RANK.draft && evidence.ungraded > 0) {
    return { eligible: false, reason: "ungraded model cases block every level above draft" };
  }
  return { eligible: true };
}

/** Mirror of the regression test applied when evidence is recorded. */
export const isRegression = (
  e: Pick<PromotionEvidence, "graded" | "passed" | "criticalFailures">,
): boolean =>
  e.criticalFailures > 0 || e.graded === 0 || e.passed / e.graded < AUTONOMY_DEMOTE_FLOOR;
