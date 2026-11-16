/**
 * Agent pause policy (ENGINE-16, ADR-094): who may pause or resume a Sherivs agent,
 * what a pause reaches, and how it forces an agent back to shadow.
 *
 * Design rule: the safe direction is cheap and the risky direction is expensive.
 * Pausing a single, ordinary agent needs one operations capability. Pausing an
 * agent whose pause cascades (JARVIS), pausing the whole workforce, pausing an
 * assurance agent, and every resume need the sheriff (platform owner). Pausing
 * more than asked is allowed to happen; pausing less never is.
 *
 * Pure module: no I/O, no clock, no environment. The pause state is an append-only
 * list of events; the current state is a fold over them, so history is never lost.
 * Nothing here applies a pause: it is a policy and a calculation, awaiting the
 * owner's approval and the tables proposed in ENGINE-16_agent_pause_state.sql.
 */
import type { EffectiveAutonomy } from "../twin-engine/autonomy-ladder";

export const PAUSE_CAPABILITY = "platform.operations.assign" as const;
export const WORKFORCE_TARGET = "all" as const;
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 300;

export type PauseAction = "pause" | "resume";

export interface PauseSubject {
  readonly packCode: string;
  readonly agentTier: "executive" | "department" | "assurance";
  /** How far pausing this agent reaches. */
  readonly killScope: "agent" | "department" | "workforce";
}

export interface PauseActor {
  readonly isSheriff: boolean;
  readonly capabilities: ReadonlySet<string>;
}

export interface PauseChange {
  readonly action: PauseAction;
  /** An agent code, or "all" for the whole workforce. */
  readonly target: string;
  readonly reason: string;
}

export interface PauseEvent extends PauseChange {
  readonly actorId: string;
  readonly atMs: number;
}

export type PauseDecision =
  | { readonly allowed: true; readonly needs: "sheriff" | "operations" }
  | { readonly allowed: false; readonly reason: string };

const no = (reason: string): PauseDecision => ({ allowed: false, reason });

/** True when pausing this subject also pauses other agents. */
export const cascades = (s: PauseSubject): boolean => s.killScope !== "agent";

export function authorizePauseChange(
  actor: PauseActor,
  change: PauseChange,
  roster: readonly PauseSubject[],
): PauseDecision {
  const reason = change.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) return no("reason_too_short");
  if (reason.length > MAX_REASON_LENGTH) return no("reason_too_long");
  if (change.action !== "pause" && change.action !== "resume") return no("unknown_action");

  const isAll = change.target === WORKFORCE_TARGET;
  const subject = isAll ? null : roster.find((s) => s.packCode === change.target);
  if (!isAll && !subject) return no("unknown_target");

  // Resuming restores autonomy that was earned: only the sheriff may do it.
  if (change.action === "resume") {
    return actor.isSheriff ? { allowed: true, needs: "sheriff" } : no("resume_needs_sheriff");
  }

  const sheriffOnly =
    isAll ||
    subject!.agentTier === "assurance" ||
    subject!.agentTier === "executive" ||
    cascades(subject!);
  if (sheriffOnly) {
    return actor.isSheriff ? { allowed: true, needs: "sheriff" } : no("pause_needs_sheriff");
  }
  if (actor.isSheriff) return { allowed: true, needs: "sheriff" };
  return actor.capabilities.has(PAUSE_CAPABILITY)
    ? { allowed: true, needs: "operations" }
    : no("pause_needs_operations_capability");
}

export interface PausedBy {
  /** The agent code (or "all") whose pause is responsible. */
  readonly source: string;
  readonly direct: boolean;
}

/**
 * Fold the events into the agents that are paused right now. The last event for each
 * target wins. A pause on a cascading agent reaches every non-assurance agent; a
 * workforce pause reaches the same set. Assurance agents are only ever paused directly,
 * so a workforce-wide stop cannot silence the verifier. Events for unknown targets are
 * ignored. `killScope: "department"` has no department data behind it, so it is treated
 * as workforce-wide: pausing more is the safe direction.
 */
export function computePaused(
  events: readonly PauseEvent[],
  roster: readonly PauseSubject[],
): ReadonlyMap<string, PausedBy> {
  const known = new Set<string>([WORKFORCE_TARGET, ...roster.map((s) => s.packCode)]);
  const latest = new Map<string, PauseAction>();
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.atMs - b.e.atMs || a.i - b.i);
  for (const { e } of ordered) if (known.has(e.target)) latest.set(e.target, e.action);

  const out = new Map<string, PausedBy>();
  const sweep = (source: string): void => {
    for (const s of roster) {
      if (s.agentTier !== "assurance" && !out.has(s.packCode)) {
        out.set(s.packCode, { source, direct: false });
      }
    }
  };
  for (const s of roster) {
    if (latest.get(s.packCode) === "pause") {
      out.set(s.packCode, { source: s.packCode, direct: true });
    }
  }
  for (const s of roster) {
    if (latest.get(s.packCode) === "pause" && cascades(s)) sweep(s.packCode);
  }
  if (latest.get(WORKFORCE_TARGET) === "pause") sweep(WORKFORCE_TARGET);
  return out;
}

/** A paused agent is held in shadow whatever it has earned. */
export const applyPause = (effective: EffectiveAutonomy, paused: boolean): EffectiveAutonomy =>
  paused ? "shadow" : effective;
