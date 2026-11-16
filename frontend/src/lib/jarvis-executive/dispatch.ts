/**
 * JARVIS work assignment (ENGINE-04, ADR-082): choose who does a task.
 * The coordinator may only choose among contexts that can already do the work
 * under their own pack and trust. It cannot grant a capability, cross a tenant,
 * or pick a suspended context. When nobody qualifies the task goes to a human.
 */
import type { EffectiveAutonomy } from "../twin-engine/autonomy-ladder";
import type { RolePackTier } from "../twin-engine/role-pack";
import { tierRank } from "../twin-engine/role-pack";

export interface Candidate {
  readonly contextId: string;
  readonly kind: "ai" | "human";
  readonly tenantRef: string;
  readonly status: "active" | "pending_pack" | "suspended";
  readonly hasCapability: boolean;
  /** Ladder result for this capability; ignored for humans. */
  readonly effective: EffectiveAutonomy;
  /** Open items; lower is preferred. */
  readonly load: number;
}

export interface Task {
  readonly capabilityId: string;
  readonly tier: RolePackTier;
  readonly tenantRef: string;
}

export type Assignment =
  | {
      readonly assigned: true;
      readonly contextId: string;
      readonly mode: "ai_autonomous" | "ai_with_approval" | "human";
      readonly reason: string;
    }
  | { readonly assigned: false; readonly reason: string };

export function assignTask(task: Task, candidates: readonly Candidate[]): Assignment {
  const eligible = candidates
    .filter((c) => c.status === "active" && c.hasCapability && c.tenantRef === task.tenantRef)
    .slice()
    .sort((a, b) => a.load - b.load || a.contextId.localeCompare(b.contextId));

  // T3 always ends with a human decision; an AI may prepare it, a human context owns it.
  const ai = eligible.filter((c) => c.kind === "ai");
  const humans = eligible.filter((c) => c.kind === "human");

  if (tierRank(task.tier) <= tierRank("T1")) {
    const auto = ai.find((c) => c.effective === "act_autonomously");
    if (auto)
      return {
        assigned: true,
        contextId: auto.contextId,
        mode: "ai_autonomous",
        reason: "earned autonomy",
      };
  }
  if (tierRank(task.tier) <= tierRank("T2")) {
    const gated = ai.find(
      (c) => c.effective === "act_with_approval" || c.effective === "act_autonomously",
    );
    if (gated)
      return {
        assigned: true,
        contextId: gated.contextId,
        mode: "ai_with_approval",
        reason: "agent prepares, human approves",
      };
  }
  const h = humans[0];
  if (h)
    return {
      assigned: true,
      contextId: h.contextId,
      mode: "human",
      reason: "no agent holds enough trust for this tier",
    };
  return { assigned: false, reason: "no eligible context in this tenant" };
}
