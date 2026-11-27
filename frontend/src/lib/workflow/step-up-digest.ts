/**
 * A3 (ADR-138): the digest a passkey step-up is bound to. The server uses it as the WebAuthn challenge for a sensitive
 * decision and records the verified result; the database recomputes the same value (`wf_step_up_digest`) when the
 * decision is made, so evidence for one promotion can never be spent on another. SHA-256 over the kind and the parts,
 * separated by U+001F (parts may not contain it).
 */
import { createHash } from "node:crypto";

export type StepUpKind = "agent_promotion" | "production_change";
const SEPARATOR = "\u001f";

export function stepUpDigest(kind: StepUpKind, parts: readonly string[]): string {
  for (const part of parts) {
    if (part.includes(SEPARATOR))
      throw new Error("step-up parts may not contain the unit separator");
  }
  return createHash("sha256")
    .update([kind, ...parts].join(SEPARATOR), "utf8")
    .digest("hex");
}

/** The parts of an agent promotion, in the order the database uses. */
export function agentPromotionDigest(input: {
  orgId: string;
  agentRef: string;
  toLevel: string;
  evidenceId: string;
}): string {
  return stepUpDigest("agent_promotion", [
    input.orgId,
    input.agentRef,
    input.toLevel,
    input.evidenceId,
  ]);
}
