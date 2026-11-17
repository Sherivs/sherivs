/**
 * JARVIS workforce oversight (ENGINE-04, ADR-082): reads a snapshot of the human
 * and AI workforce and returns findings, each with a RECOMMENDED action and the
 * tier that action would need. Oversight never executes: its output is routed
 * through the broker like any other request.
 *
 * Pure and deterministic: the same snapshot always yields the same findings in
 * the same order.
 */
import type { RolePackTier } from "../twin-engine/role-pack";
import type { TrustState } from "../twin-engine/autonomy-ladder";
import { EVIDENCE_MAX_AGE_MS } from "../twin-engine/autonomy-ladder";
import type { Severity } from "./severity";

export interface PendingItem {
  readonly id: string;
  readonly ageMs: number;
}

export interface WorkforceMember {
  readonly contextId: string;
  readonly kind: "ai" | "human";
  readonly role: string;
  readonly status: "active" | "pending_pack" | "suspended";
  /** Approvals or tasks waiting on this member. */
  readonly pending: readonly PendingItem[];
  readonly calls24h: number;
  readonly failures24h: number;
  readonly denials24h: number;
  /** 0..1 of the daily action budget. */
  readonly budgetUsed: number;
  readonly trust: readonly {
    readonly capabilityId: string;
    readonly state: TrustState;
    readonly evidenceAgeMs: number | null;
  }[];
}

export const OVERSIGHT_THRESHOLDS = Object.freeze({
  approvalSlaMs: 4 * 60 * 60 * 1000,
  approvalCriticalMs: 20 * 60 * 60 * 1000,
  minCallsForRates: 10,
  failureRate: 0.2,
  denialRate: 0.5,
  budgetWarn: 0.9,
});

export type FindingKind =
  | "approval_stalled"
  | "approval_near_expiry"
  | "agent_failure_spike"
  | "agent_denial_spike"
  | "budget_exhausted"
  | "autonomy_evidence_stale"
  | "context_suspended_with_work";

export type RecommendedAction =
  | "notify_owner"
  | "reassign_to_human"
  | "demote_capability"
  | "review_role_pack"
  | "reevaluate_capability"
  | "pause_agent";

export interface Finding {
  readonly id: string;
  readonly kind: FindingKind;
  readonly severity: Severity;
  readonly contextId: string;
  readonly detail: string;
  readonly recommended: RecommendedAction;
  /** Tier of the recommended action: demoting or pausing is T1 (reversible, internal). */
  readonly actionTier: RolePackTier;
}

const SEV_ORDER: Readonly<Record<Severity, number>> = { S1: 0, S2: 1, S3: 2, S4: 3 };

export function assessWorkforce(members: readonly WorkforceMember[]): readonly Finding[] {
  const T = OVERSIGHT_THRESHOLDS;
  const out: Finding[] = [];
  const push = (f: Omit<Finding, "id">) =>
    out.push({
      ...f,
      id: `${f.kind}:${f.contextId}${f.detail ? `:${f.detail.split(" ")[0]}` : ""}`,
    });

  for (const m of members) {
    if (m.status === "suspended" && m.pending.length > 0) {
      push({
        kind: "context_suspended_with_work",
        severity: "S3",
        contextId: m.contextId,
        detail: `${m.pending.length} items wait on a suspended context`,
        recommended: "reassign_to_human",
        actionTier: "T1",
      });
    }
    for (const p of m.pending) {
      if (p.ageMs >= T.approvalCriticalMs) {
        push({
          kind: "approval_near_expiry",
          severity: "S2",
          contextId: m.contextId,
          detail: `${p.id} is about to expire`,
          recommended: "notify_owner",
          actionTier: "T1",
        });
      } else if (p.ageMs >= T.approvalSlaMs) {
        push({
          kind: "approval_stalled",
          severity: "S3",
          contextId: m.contextId,
          detail: `${p.id} is past its SLA`,
          recommended: m.kind === "human" ? "notify_owner" : "reassign_to_human",
          actionTier: "T1",
        });
      }
    }
    if (m.kind === "ai") {
      if (m.calls24h >= T.minCallsForRates) {
        if (m.failures24h / m.calls24h >= T.failureRate) {
          push({
            kind: "agent_failure_spike",
            severity: "S2",
            contextId: m.contextId,
            detail: `${m.failures24h}/${m.calls24h} calls failed`,
            recommended: "demote_capability",
            actionTier: "T1",
          });
        }
        if (m.denials24h / m.calls24h >= T.denialRate) {
          push({
            kind: "agent_denial_spike",
            severity: "S3",
            contextId: m.contextId,
            detail: `${m.denials24h}/${m.calls24h} calls denied`,
            recommended: "review_role_pack",
            actionTier: "T1",
          });
        }
      }
      if (m.budgetUsed >= T.budgetWarn) {
        push({
          kind: "budget_exhausted",
          severity: m.budgetUsed >= 1 ? "S2" : "S4",
          contextId: m.contextId,
          detail: `budget ${Math.round(m.budgetUsed * 100)}% used`,
          recommended: m.budgetUsed >= 1 ? "pause_agent" : "notify_owner",
          actionTier: "T1",
        });
      }
      for (const t of m.trust) {
        if (
          t.state === "autonomous" &&
          (t.evidenceAgeMs === null || t.evidenceAgeMs > EVIDENCE_MAX_AGE_MS)
        ) {
          push({
            kind: "autonomy_evidence_stale",
            severity: "S3",
            contextId: m.contextId,
            detail: `${t.capabilityId} has no fresh evidence`,
            recommended: "reevaluate_capability",
            actionTier: "T1",
          });
        }
      }
    }
  }
  return out.sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}
