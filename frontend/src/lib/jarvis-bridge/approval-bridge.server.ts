/**
 * Bridge between the playbook runner and the JARVIS durable approval inbox
 * (ENGINE-08, ADR-086).
 *
 * The runner stops at a step that needs a human. This bridge raises the matching
 * request in the JARVIS inbox, and later turns the inbox's verdict into the runner's
 * resume decision. It adds no authority of its own:
 *  - only capabilities with an explicit, tier-equal JARVIS action are bridgeable;
 *    anything else stays unapprovable (fail closed);
 *  - the inbox decides who may approve (humans only, phone channels cannot approve,
 *    T3 needs a sheriff with passkey step-up) and enforces expiry and replay;
 *  - an approval is consumed (single use) only after the kill switch, the approver
 *    role and the preconditions have been checked, and a denial or expiry can never
 *    execute anything.
 */
import { JARVIS_RISK_TIER_POLICY, type JarvisRiskActionId } from "../jarvis/risk-policy";
import {
  MAX_APPROVAL_TTL_MS,
  authorizeExecution,
  createApprovalRequest,
  expireDueApprovals,
  type ApprovalErrorCode,
  type ApprovalInboxState,
  type ApprovalRequest,
} from "../jarvis/approval-inbox";
import { abortRun, type PlaybookRun } from "../playbook-runner/run-state";
import {
  resumeRun,
  stepArgs,
  type ApprovalEvidence,
  type Budgeted,
  type ResumeResult,
  type RunnerPorts,
} from "../playbook-runner/playbook-runner.server";
import type { BindingTable } from "../playbook-runner/capability-bindings";
import { argsDigest } from "../tool-broker/redact.server";
import type { RolePack } from "../twin-engine/role-pack";

/**
 * Engine capability -> JARVIS risk-policy action. A capability is bridgeable only if
 * the JARVIS tier equals the capability tier (checked by `validateActionMap`).
 * `publish.social.post` has no JARVIS action yet and is deliberately absent.
 */
export const ACTION_MAP: Readonly<Record<string, JarvisRiskActionId>> = Object.freeze({
  "send.customer.message": "send_customer_communications",
  "request.refund": "spend_money",
  "request.deploy": "deploy_production",
  "request.access.grant": "invite_privileged_staff",
});

export function validateActionMap(
  pack: RolePack,
  map: Readonly<Record<string, string>> = ACTION_MAP,
): readonly string[] {
  const problems: string[] = [];
  for (const [capabilityId, actionId] of Object.entries(map)) {
    const cap = pack.capabilities.find((c) => c.id === capabilityId);
    const policyTier = (JARVIS_RISK_TIER_POLICY as Readonly<Record<string, string>>)[actionId];
    if (!cap) problems.push(`${capabilityId}: not a capability of ${pack.code}`);
    else if (policyTier === undefined)
      problems.push(`${capabilityId}: unknown JARVIS action ${actionId}`);
    else if (policyTier !== cap.tier) {
      problems.push(
        `${capabilityId}: tier ${cap.tier} differs from JARVIS ${actionId} ${policyTier}`,
      );
    }
  }
  return problems;
}

export const MIN_APPROVAL_TTL_MS = 60_000;

export const approvalIdFor = (run: Pick<PlaybookRun, "runId">, stepIndex: number): string =>
  `appr:${run.runId}:${stepIndex}`;

export type BridgeRefusal =
  | "not_waiting"
  | "internal_step"
  | "unmapped_capability"
  | "unsupported_approver"
  | "unknown_step"
  | "invalid_ttl"
  | ApprovalErrorCode;

export type RaiseResult =
  | {
      readonly ok: true;
      readonly state: ApprovalInboxState;
      readonly approvalId: string;
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly code: BridgeRefusal; readonly state: ApprovalInboxState };

function waitingStep(run: PlaybookRun):
  | {
      readonly ok: true;
      readonly stepIndex: number;
      readonly decisionId: string;
      readonly capabilityId: string;
      readonly approver: "role_owner" | "platform_staff" | "sheriff";
    }
  | { readonly ok: false; readonly code: "not_waiting" | "internal_step" | "unknown_step" } {
  const p = run.pending;
  if (run.status !== "awaiting_approval" || !p) return { ok: false, code: "not_waiting" };
  if (p.decisionId === null) return { ok: false, code: "internal_step" };
  const rec = run.steps.find((s) => s.index === p.stepIndex);
  if (!rec) return { ok: false, code: "unknown_step" };
  return {
    ok: true,
    stepIndex: p.stepIndex,
    decisionId: p.decisionId,
    capabilityId: rec.capabilityId,
    approver: p.approver,
  };
}

/** Raise (idempotently) the inbox request for the step a run is waiting on. */
export function raiseApproval(
  state: ApprovalInboxState,
  run: PlaybookRun,
  pack: RolePack,
  opts: { readonly ttlMs: number },
  now: string,
): RaiseResult {
  const w = waitingStep(run);
  if (!w.ok) return { ok: false, code: w.code, state };
  const actionId = ACTION_MAP[w.capabilityId];
  if (
    actionId === undefined ||
    validateActionMap(pack, { [w.capabilityId]: actionId }).length > 0
  ) {
    return { ok: false, code: "unmapped_capability", state };
  }
  if (w.approver === "role_owner") return { ok: false, code: "unsupported_approver", state };
  if (!Number.isFinite(opts.ttlMs) || opts.ttlMs < MIN_APPROVAL_TTL_MS) {
    return { ok: false, code: "invalid_ttl", state };
  }
  const ttl = Math.min(opts.ttlMs, MAX_APPROVAL_TTL_MS);
  const approvalId = approvalIdFor(run, w.stepIndex);
  const created = createApprovalRequest(
    state,
    {
      approvalId,
      idempotencyKey: approvalId,
      actionId,
      actionRef: w.decisionId,
      agentDefinitionId: pack.code,
      requesterRef: `agent:${run.contextId}`,
      platformRef: run.tenantRef,
      preconditionsDigest: argsDigest(stepArgs(run)),
      expiresAt: new Date(Date.parse(now) + ttl).toISOString(),
    },
    now,
  );
  return created.ok
    ? { ok: true, state: created.state, approvalId, replayed: created.replayed }
    : { ok: false, code: created.code, state: created.state };
}

export type InboxVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "pending" }
  | { readonly kind: "approved"; readonly request: ApprovalRequest }
  | { readonly kind: "denied" }
  | { readonly kind: "expired" }
  | { readonly kind: "consumed" };

/** Read the inbox's verdict for the run's current step, applying due expiry. */
export function inboxVerdict(
  state: ApprovalInboxState,
  run: PlaybookRun,
  now: string,
): { readonly state: ApprovalInboxState; readonly verdict: InboxVerdict } {
  const w = waitingStep(run);
  const after = expireDueApprovals(state, now);
  if (!w.ok) return { state: after, verdict: { kind: "none" } };
  const request = after.requests.find((r) => r.approvalId === approvalIdFor(run, w.stepIndex));
  if (!request) return { state: after, verdict: { kind: "none" } };
  const verdict: InboxVerdict =
    request.status === "pending"
      ? { kind: "pending" }
      : request.status === "approved"
        ? { kind: "approved", request }
        : request.status === "denied"
          ? { kind: "denied" }
          : request.status === "expired"
            ? { kind: "expired" }
            : { kind: "consumed" };
  return { state: after, verdict };
}

export type BridgeResume =
  | {
      readonly kind: "no_request" | "still_pending" | "not_waiting";
      readonly state: ApprovalInboxState;
      readonly run: PlaybookRun;
    }
  | {
      readonly kind: "aborted";
      readonly reason: string;
      readonly state: ApprovalInboxState;
      readonly run: PlaybookRun;
    }
  | {
      readonly kind: "wrong_approver";
      readonly state: ApprovalInboxState;
      readonly run: PlaybookRun;
    }
  | { readonly kind: "resumed"; readonly state: ApprovalInboxState; readonly result: ResumeResult };

/**
 * Apply the inbox's verdict to a waiting run. Order matters: the kill switch and the
 * approver role are checked BEFORE the single-use approval is consumed.
 */
export async function resumeFromInbox(
  ports: RunnerPorts,
  pack: RolePack,
  bindings: BindingTable,
  run: PlaybookRun,
  state: ApprovalInboxState,
  budget: Budgeted,
  now: string,
): Promise<BridgeResume> {
  const w = waitingStep(run);
  if (!w.ok) return { kind: "not_waiting", state, run };
  const { state: s1, verdict } = inboxVerdict(state, run, now);
  switch (verdict.kind) {
    case "none":
      return { kind: "no_request", state: s1, run };
    case "pending":
      return { kind: "still_pending", state: s1, run };
    case "denied":
      return {
        kind: "aborted",
        reason: "approval_denied",
        state: s1,
        run: abortRun(run, "approval_denied"),
      };
    case "expired":
      return {
        kind: "aborted",
        reason: "approval_expired",
        state: s1,
        run: abortRun(run, "approval_expired"),
      };
    case "consumed":
      return {
        kind: "aborted",
        reason: "approval_already_used",
        state: s1,
        run: abortRun(run, "approval_already_used"),
      };
    case "approved":
      break;
  }
  if (await ports.killSwitch()) {
    return { kind: "aborted", reason: "kill_switch", state: s1, run: abortRun(run, "kill_switch") };
  }
  const request = verdict.request;
  if (request.decidedRole !== w.approver) return { kind: "wrong_approver", state: s1, run };

  const consumed = authorizeExecution(
    s1,
    {
      approvalId: request.approvalId,
      actionId: request.actionId,
      actionRef: w.decisionId,
      currentPreconditionsDigest: argsDigest(stepArgs(run)),
    },
    now,
  );
  if (!consumed.ok) {
    const reason = `approval_${consumed.code}`;
    return { kind: "aborted", reason, state: consumed.state, run: abortRun(run, reason) };
  }
  const evidence: ApprovalEvidence = {
    approvalRef: consumed.request.approvalId,
    approverKind: consumed.evidence.approverRole,
  };
  const result = await resumeRun(ports, pack, bindings, run, { approved: true, evidence }, budget);
  return { kind: "resumed", state: consumed.state, result };
}
