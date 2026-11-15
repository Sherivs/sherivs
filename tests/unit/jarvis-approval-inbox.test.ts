/**
 * SV1-JARVIS-02 — durable approval inbox contract.
 * Offline and deterministic: fixed instants, synthetic identities, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  authorizeExecution,
  createApprovalRequest,
  decideApproval,
  EMPTY_APPROVAL_INBOX,
  expireDueApprovals,
  MAX_APPROVAL_TTL_MS,
  type ApprovalInboxState,
  type CreateApprovalInput,
  type DecideApprovalInput,
} from "../../frontend/src/lib/jarvis/approval-inbox";
import { evaluateJarvisRiskPolicy } from "../../frontend/src/lib/jarvis/risk-policy";
import {
  createCapabilityRegistry,
  type CapabilityRegistrationInput,
} from "../../frontend/src/lib/workforce/capability-registry";
import { defineWorkerDefinition } from "../../frontend/src/lib/workforce/worker-definition";
import {
  COREGRID_PLATFORM_REF,
  PLATFORM_AGENT_RESOURCE_SCOPE,
  resolvePlatformAgentAuthority,
} from "../../frontend/src/lib/workforce/platform-agent-authority";

const T0 = "2026-11-04T05:00:00.000Z";
const T_MID = "2026-11-04T05:20:00.000Z";
const EXPIRY = "2026-11-04T06:00:00.000Z";
const AFTER_EXPIRY = "2026-11-04T06:00:01.000Z";
const DIGEST = "sha256:aaaa";
const AGENT = "agent-operations";
const AGENT_IDENTITY = "identity-agent-operations";

function req(over: Partial<CreateApprovalInput> = {}): CreateApprovalInput {
  return {
    approvalId: "approval-1",
    idempotencyKey: "idem-1",
    actionId: "change_subscription", // T3
    actionRef: "proposal-001",
    agentDefinitionId: AGENT,
    requesterRef: AGENT_IDENTITY,
    platformRef: COREGRID_PLATFORM_REF,
    preconditionsDigest: DIGEST,
    expiresAt: EXPIRY,
    ...over,
  };
}

function decision(over: Partial<DecideApprovalInput> = {}): DecideApprovalInput {
  return {
    approvalId: "approval-1",
    decision: "approve",
    channel: "console",
    approverId: "human-sheriff",
    approverRole: "sheriff",
    identityKind: "human",
    humanIdentityVerified: true,
    passkeyStepUpVerified: true,
    ...over,
  };
}

function open(over: Partial<CreateApprovalInput> = {}): ApprovalInboxState {
  const r = createApprovalRequest(EMPTY_APPROVAL_INBOX, req(over), T0);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

function approved(over: Partial<CreateApprovalInput> = {}): ApprovalInboxState {
  const r = decideApproval(open(over), decision(), T_MID);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

const exec = (over = {}) => ({
  approvalId: "approval-1",
  actionId: "change_subscription",
  actionRef: "proposal-001",
  currentPreconditionsDigest: DIGEST,
  ...over,
});

describe("request creation", () => {
  it("creates a pending request with a recorded event", () => {
    const r = createApprovalRequest(EMPTY_APPROVAL_INBOX, req(), T0);
    expect(r.ok && r.request.status).toBe("pending");
    expect(r.ok && r.request.riskTier).toBe("T3");
    expect(r.state.events.map((e) => e.kind)).toEqual(["requested"]);
  });

  it("is idempotent for the same key and payload", () => {
    const first = open();
    const again = createApprovalRequest(first, req(), T_MID);
    expect(again.ok && again.replayed).toBe(true);
    expect(again.state.requests).toHaveLength(1);
  });

  it("rejects a reused idempotency key with a different payload", () => {
    const r = createApprovalRequest(
      open(),
      req({ actionRef: "proposal-002", approvalId: "a2" }),
      T0,
    );
    expect(!r.ok && r.code).toBe("idempotency_conflict");
  });

  it("refuses tiers that do not use the inbox and unmapped actions", () => {
    for (const actionId of ["observe_platform_state", "request_approval", "disable_guardrails"]) {
      const r = createApprovalRequest(EMPTY_APPROVAL_INBOX, req({ actionId }), T0);
      expect(!r.ok && r.code).toBe("tier_not_approvable");
    }
    const unknown = createApprovalRequest(EMPTY_APPROVAL_INBOX, req({ actionId: "nope" }), T0);
    expect(!unknown.ok && unknown.code).toBe("unknown_action");
  });

  it("requires a future expiry within 24 hours", () => {
    const past = createApprovalRequest(EMPTY_APPROVAL_INBOX, req({ expiresAt: T0 }), T0);
    expect(!past.ok && past.code).toBe("invalid_expiry");
    const far = new Date(Date.parse(T0) + MAX_APPROVAL_TTL_MS + 1).toISOString();
    const tooFar = createApprovalRequest(EMPTY_APPROVAL_INBOX, req({ expiresAt: far }), T0);
    expect(!tooFar.ok && tooFar.code).toBe("invalid_expiry");
  });
});

describe("decisions", () => {
  it("approves T3 only with a sheriff on the console with passkey step-up", () => {
    const r = decideApproval(open(), decision(), T_MID);
    expect(r.ok && r.request.status).toBe("approved");
    expect(r.ok && r.request.passkeyStepUpVerified).toBe(true);
  });

  it("rejects T3 approval without passkey step-up", () => {
    const r = decideApproval(open(), decision({ passkeyStepUpVerified: false }), T_MID);
    expect(!r.ok && r.code).toBe("passkey_step_up_required");
    expect(r.state.requests[0]?.status).toBe("pending");
  });

  it("rejects T3 approval by platform_staff even with step-up", () => {
    const r = decideApproval(open(), decision({ approverRole: "platform_staff" }), T_MID);
    expect(!r.ok && r.code).toBe("role_insufficient");
  });

  it("phone and message channels can never approve, for any tier", () => {
    for (const channel of ["whatsapp", "voice", "sms", "email"] as const) {
      for (const actionId of ["change_subscription", "send_customer_communications"]) {
        const s = open({ actionId });
        const r = decideApproval(s, decision({ channel }), T_MID);
        expect(!r.ok && r.code).toBe("channel_cannot_approve");
        expect(r.state.requests[0]?.status).toBe("pending");
      }
    }
  });

  it("phone channels may acknowledge (request stays pending) or deny", () => {
    const ack = decideApproval(
      open(),
      decision({ decision: "acknowledge", channel: "voice" }),
      T_MID,
    );
    expect(ack.ok && ack.request.status).toBe("pending");
    const deny = decideApproval(
      ack.state,
      decision({ decision: "deny", channel: "whatsapp" }),
      T_MID,
    );
    expect(deny.ok && deny.request.status).toBe("denied");
  });

  it("an AI identity or an unverified human can never decide", () => {
    const ai = decideApproval(open(), decision({ identityKind: "ai" }), T_MID);
    expect(!ai.ok && ai.code).toBe("ai_identity_cannot_decide");
    const unverified = decideApproval(open(), decision({ humanIdentityVerified: false }), T_MID);
    expect(!unverified.ok && unverified.code).toBe("ai_identity_cannot_decide");
  });

  it("the requester cannot decide its own request", () => {
    const r = decideApproval(open(), decision({ approverId: AGENT_IDENTITY }), T_MID);
    expect(!r.ok && r.code).toBe("self_approval_forbidden");
  });

  it("a replayed decision is rejected and does not change the record", () => {
    const first = decideApproval(open(), decision(), T_MID);
    const replay = decideApproval(first.state, decision({ decision: "deny" }), T_MID);
    expect(!replay.ok && replay.code).toBe("already_decided");
    expect(replay.state.requests[0]?.status).toBe("approved");
  });

  it("an expired request cannot be decided", () => {
    const r = decideApproval(open(), decision(), AFTER_EXPIRY);
    expect(!r.ok && r.code).toBe("expired");
    expect(r.state.requests[0]?.status).toBe("expired");
  });

  it("T2 can be approved by platform_staff on the console without step-up", () => {
    const s = open({ actionId: "send_customer_communications" });
    const r = decideApproval(
      s,
      decision({ approverRole: "platform_staff", passkeyStepUpVerified: false }),
      T_MID,
    );
    expect(r.ok && r.request.status).toBe("approved");
  });
});

describe("execution-time revalidation", () => {
  it("allows exactly once and returns evidence the risk policy accepts", () => {
    const ok = authorizeExecution(approved(), exec(), T_MID);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.request.status).toBe("executed");
    const replay = authorizeExecution(ok.state, exec(), T_MID);
    expect(!replay.ok && replay.code).toBe("already_executed");
  });

  it("an expired approval cannot execute", () => {
    const r = authorizeExecution(approved(), exec(), AFTER_EXPIRY);
    expect(!r.ok && r.code).toBe("expired");
  });

  it("changed preconditions block execution and leave the approval unused", () => {
    const r = authorizeExecution(
      approved(),
      exec({ currentPreconditionsDigest: "sha256:bbbb" }),
      T_MID,
    );
    expect(!r.ok && r.code).toBe("preconditions_changed");
    expect(r.state.requests[0]?.status).toBe("approved");
  });

  it("an approval bound to one action cannot execute another", () => {
    const a = authorizeExecution(approved(), exec({ actionId: "spend_money" }), T_MID);
    expect(!a.ok && a.code).toBe("action_mismatch");
    const b = authorizeExecution(approved(), exec({ actionRef: "other" }), T_MID);
    expect(!b.ok && b.code).toBe("action_mismatch");
  });

  it("pending and denied requests cannot execute", () => {
    const pending = authorizeExecution(open(), exec(), T_MID);
    expect(!pending.ok && pending.code).toBe("not_approved");
    const denied = decideApproval(open(), decision({ decision: "deny" }), T_MID);
    const r = authorizeExecution(denied.state, exec(), T_MID);
    expect(!r.ok && r.code).toBe("not_approved");
  });

  it("unknown approvals are rejected", () => {
    const r = authorizeExecution(EMPTY_APPROVAL_INBOX, exec(), T_MID);
    expect(!r.ok && r.code).toBe("not_found");
  });
});

describe("integration with the JARVIS risk policy (JARVIS-01)", () => {
  const ids = ["change_subscription", "send_customer_communications"];
  function authorityAt(resolvedAt: string) {
    const caps: CapabilityRegistrationInput[] = ids.map((capabilityId) => ({
      capabilityId,
      contract: `Governed action ${capabilityId}`,
      riskClass: capabilityId === "change_subscription" ? "high" : "medium",
      evidenceRequirements: ["policy-decision"],
    }));
    const registry = createCapabilityRegistry(caps);
    if (!registry.ok) throw new Error(registry.errors.join("; "));
    const def = defineWorkerDefinition({
      id: AGENT,
      tenantScope: "tenant-operations",
      identityRef: AGENT_IDENTITY,
      classification: "ai",
      capabilities: ids.map((capabilityId) => ({ capabilityId, description: capabilityId })),
      authorityBounds: {
        maxRiskClass: "critical",
        resourceScopes: [PLATFORM_AGENT_RESOURCE_SCOPE],
      },
      lifecycle: "active",
    });
    if (!def.ok) throw new Error(def.errors.join("; "));
    const result = resolvePlatformAgentAuthority({
      definition: def.definition,
      grant: {
        grantId: "grant-operations",
        definitionId: AGENT,
        delegationRef: "platform-operations",
        delegatedCapabilities: ids,
        maxGrantedRiskClass: "critical",
        state: "active",
        grantedAt: "2026-11-04T04:00:00.000Z",
        expiresAt: "2026-11-04T07:00:00.000Z",
      },
      capabilityRegistry: registry.registry,
      platformScope: {
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: null,
      },
      resolvedAt,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.authority;
  }

  it("evidence from authorizeExecution lets T3 execute; without the inbox it is denied", () => {
    const ok = authorizeExecution(approved(), exec(), T_MID);
    if (!ok.ok) throw new Error(ok.code);
    const allow = evaluateJarvisRiskPolicy({
      actionId: "change_subscription",
      actionRef: "proposal-001",
      phase: "execution",
      evaluatedAt: T_MID,
      authority: authorityAt(T_MID),
      approval: ok.evidence,
    });
    expect(allow.decision).toBe("allow");
    const noApproval = evaluateJarvisRiskPolicy({
      actionId: "change_subscription",
      actionRef: "proposal-001",
      phase: "execution",
      evaluatedAt: T_MID,
      authority: authorityAt(T_MID),
    });
    expect(noApproval.decision).toBe("deny");
  });
});

describe("expiry sweep and append-only log", () => {
  it("expireDueApprovals expires pending and approved requests past deadline", () => {
    const swept = expireDueApprovals(approved(), AFTER_EXPIRY);
    expect(swept.requests[0]?.status).toBe("expired");
  });

  it("the event log only grows and numbers events contiguously", () => {
    let s = open();
    const lens: number[] = [s.events.length];
    s = decideApproval(s, decision({ passkeyStepUpVerified: false }), T_MID).state;
    lens.push(s.events.length);
    s = decideApproval(s, decision(), T_MID).state;
    lens.push(s.events.length);
    s = authorizeExecution(s, exec(), T_MID).state;
    lens.push(s.events.length);
    expect(lens).toEqual([1, 2, 3, 4]);
    expect(s.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4]);
  });

  it("never mutates the input state", () => {
    const s = open();
    const snapshot = JSON.stringify(s);
    decideApproval(s, decision(), T_MID);
    authorizeExecution(s, exec(), T_MID);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
