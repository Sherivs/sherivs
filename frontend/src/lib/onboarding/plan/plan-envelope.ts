/**
 * Sherivs — plan envelope (domain-neutral; ADR-107).
 *
 * Wraps a generated plan with what a reviewer and the provisioning record need
 * to trust it later: which interview graph and version produced it, a digest of
 * the answers it was produced from and a digest of the plan itself (suitable
 * for the existing `onboarding_sessions.plan_hash`). Regenerating from the same
 * graph version and answers gives the same envelope.
 *
 * Pure. No clock: when the envelope was made is recorded by the caller.
 */
import { canonicalize, planDigest, type PlanJson } from "./canonical";

export interface PlanEnvelope {
  readonly graphId: string;
  readonly graphVersion: string;
  readonly answersDigest: string;
  readonly planDigest: string;
  readonly plan: PlanJson;
}

export function envelopePlan(input: {
  readonly graphId: string;
  readonly graphVersion: string;
  readonly answers: unknown;
  readonly plan: unknown;
}): PlanEnvelope {
  const plan = canonicalize(input.plan);
  return {
    graphId: input.graphId,
    graphVersion: input.graphVersion,
    answersDigest: planDigest(input.answers),
    planDigest: planDigest(plan),
    plan,
  };
}

/** True when `envelope.plan` still matches its recorded digest. */
export function envelopeIntact(envelope: PlanEnvelope): boolean {
  return planDigest(envelope.plan) === envelope.planDigest;
}
