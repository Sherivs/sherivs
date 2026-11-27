/**
 * A4: when the console offers a promotion. Advisory only: `wf_autonomy_promote` decides. Pure so it is unit tested.
 */
import type { AutonomyLevel, ConsoleAgent } from "./agent-console";

/** The rung an agent can be promoted to from the console, or null when none is offered. */
export function offeredPromotion(
  agent: Pick<ConsoleAgent, "next_level" | "evidence" | "state">,
  isFounder: boolean,
): AutonomyLevel | null {
  if (!isFounder) return null;
  if (!agent.next_level || agent.next_level === "suggest") return null;
  if (!agent.evidence || !agent.evidence.meets_bar) return null;
  if (agent.state !== "active") return null;
  return agent.next_level;
}

/** A promotion needs a written reason of 10 to 300 characters (the database enforces the same range). */
export function reasonProblem(reason: string): string | null {
  const n = reason.trim().length;
  if (n < 10) return "Write a reason of at least 10 characters.";
  if (n > 300) return "Keep the reason to 300 characters.";
  return null;
}
