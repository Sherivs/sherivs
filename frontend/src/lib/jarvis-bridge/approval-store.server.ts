/**
 * JARVIS-LIVE-01: durable approval decisions (Authority: Owner; Origin: owner instruction of
 * 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * The approval inbox (lib/jarvis/approval-inbox.ts) is a pure state machine. This module makes
 * its decisions durable without re-implementing any rule: it loads one request and its events,
 * runs `decideApproval` on that state, and writes back only the resulting transition.
 *
 *  - Every rule (no AI approver, no self-approval, console-only approve, T3 needs a sheriff AND
 *    a passkey step-up, expiry) stays in the inbox. This module cannot loosen one.
 *  - The status change is conditional on the row still being `pending`, so two concurrent
 *    decisions cannot both win; the loser gets `already_decided`.
 *  - The database repeats the main rules as constraints and a transition guard, so a bug here
 *    still cannot produce an approved T3 request without a sheriff and a passkey.
 */
import {
  decideApproval,
  type ApprovalChannel,
  type ApprovalDecisionKind,
  type ApprovalErrorCode,
  type ApprovalEvent,
  type ApprovalInboxState,
  type ApprovalRequest,
} from "../jarvis/approval-inbox";

type Row = Record<string, unknown>;
type Result<T = unknown> = { data: T | null; error: { code?: string; message: string } | null };

interface Select extends PromiseLike<Result<Row[]>> {
  eq(column: string, value: unknown): Select;
  order(column: string, options?: { ascending?: boolean }): Select;
  limit(n: number): Select;
  maybeSingle(): PromiseLike<Result<Row>>;
}

export interface ApprovalDbClient {
  from(table: string): {
    select(columns: string): Select;
    insert(rows: Row[]): PromiseLike<Result>;
    update(patch: Row): {
      eq(
        column: string,
        value: unknown,
      ): {
        eq(column: string, value: unknown): { select(columns: string): PromiseLike<Result<Row[]>> };
      };
    };
  };
}

export interface DecidePersistedInput {
  readonly approvalId: string;
  readonly decision: ApprovalDecisionKind;
  readonly approverId: string;
  readonly approverRole: "platform_staff" | "sheriff";
  readonly passkeyStepUpVerified: boolean;
  readonly nowIso: string;
}

export type DecidePersistedResult =
  | { readonly ok: true; readonly status: ApprovalRequest["status"] }
  | {
      readonly ok: false;
      readonly code: ApprovalErrorCode | "store_unavailable";
    };

const REQUEST_COLUMNS =
  "approval_id, idempotency_key, action_id, action_ref, agent_definition_id, requester_ref, platform_ref, risk_tier, preconditions_digest, requested_at, expires_at, status, decided_by, decided_role, decided_at, passkey_step_up_verified, executed_at";
const EVENT_COLUMNS = "event_seq, approval_id, kind, channel, actor_ref, code, at";

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const sn = (v: unknown): string | null => (typeof v === "string" ? v : null);
const iso = (v: unknown): string => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

export function requestFromRow(r: Row): ApprovalRequest {
  return {
    approvalId: s(r.approval_id),
    idempotencyKey: s(r.idempotency_key),
    actionId: s(r.action_id),
    actionRef: s(r.action_ref),
    agentDefinitionId: s(r.agent_definition_id),
    requesterRef: s(r.requester_ref),
    platformRef: s(r.platform_ref),
    riskTier: r.risk_tier === "T3" ? "T3" : "T2",
    preconditionsDigest: s(r.preconditions_digest),
    requestedAt: iso(r.requested_at),
    expiresAt: iso(r.expires_at),
    status: s(r.status) as ApprovalRequest["status"],
    decidedBy: sn(r.decided_by),
    decidedRole:
      r.decided_role === "sheriff" || r.decided_role === "platform_staff" ? r.decided_role : null,
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
    passkeyStepUpVerified: r.passkey_step_up_verified === true,
    executedAt: r.executed_at ? iso(r.executed_at) : null,
  };
}

function eventFromRow(r: Row): ApprovalEvent {
  return {
    eventSeq: Number(r.event_seq) || 0,
    approvalId: s(r.approval_id),
    kind: s(r.kind) as ApprovalEvent["kind"],
    channel: (sn(r.channel) as ApprovalChannel | null) ?? null,
    actorRef: sn(r.actor_ref),
    code: sn(r.code),
    at: iso(r.at),
  };
}

export async function decidePersistedApproval(
  db: ApprovalDbClient,
  input: DecidePersistedInput,
): Promise<DecidePersistedResult> {
  const loaded = await db
    .from("jarvis_approval_requests")
    .select(REQUEST_COLUMNS)
    .eq("approval_id", input.approvalId)
    .maybeSingle();
  if (loaded.error) return { ok: false, code: "store_unavailable" };
  if (!loaded.data) return { ok: false, code: "not_found" };
  const events = await db
    .from("jarvis_approval_events")
    .select(EVENT_COLUMNS)
    .eq("approval_id", input.approvalId)
    .order("event_seq", { ascending: true })
    .limit(500);
  if (events.error) return { ok: false, code: "store_unavailable" };

  const before = requestFromRow(loaded.data);
  const priorEvents = (events.data ?? []).map(eventFromRow);
  const state: ApprovalInboxState = { requests: [before], events: priorEvents };

  const decided = decideApproval(
    state,
    {
      approvalId: input.approvalId,
      decision: input.decision,
      channel: "console",
      approverId: input.approverId,
      approverRole: input.approverRole,
      identityKind: "human",
      humanIdentityVerified: true,
      passkeyStepUpVerified: input.passkeyStepUpVerified,
    },
    input.nowIso,
  );

  const after = decided.state.requests[0] ?? before;
  // Persist the transition first (conditional on still pending), then the audit events.
  if (after.status !== before.status) {
    const patch: Row =
      after.status === "expired"
        ? { status: "expired" }
        : {
            status: after.status,
            decided_by: after.decidedBy,
            decided_role: after.decidedRole,
            decided_channel: "console",
            decided_at: after.decidedAt,
            passkey_step_up_verified: after.passkeyStepUpVerified,
          };
    const updated = await db
      .from("jarvis_approval_requests")
      .update(patch)
      .eq("approval_id", input.approvalId)
      .eq("status", "pending")
      .select("approval_id");
    if (updated.error) return { ok: false, code: "store_unavailable" };
    if ((updated.data ?? []).length !== 1) return { ok: false, code: "already_decided" };
  }
  const fresh = decided.state.events.slice(priorEvents.length);
  if (fresh.length > 0) {
    const written = await db.from("jarvis_approval_events").insert(
      fresh.map((e) => ({
        approval_id: e.approvalId,
        kind: e.kind,
        channel: e.channel,
        actor_ref: e.actorRef,
        code: e.code,
        at: e.at,
      })),
    );
    if (written.error) return { ok: false, code: "store_unavailable" };
  }
  return decided.ok ? { ok: true, status: after.status } : { ok: false, code: decided.code };
}
