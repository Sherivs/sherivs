/**
 * Sherivs Tool Broker: the one decision point (ENGINE-03, ADR-081).
 *
 * `decideToolCall` is a pure function of its input. It never executes anything:
 * it returns a verdict and the reasons, and the caller (a server function) acts
 * on it and appends a ledger row. Every rule fails closed and the first
 * matching deny wins, so a deny reason is always the earliest broken invariant.
 *
 * Authority comes only from the server-resolved context. Nothing in the call
 * payload (including a model's own claim of permission) is trusted.
 */
import type { RolePackCapability, RolePackTier } from "../twin-engine/role-pack";
import { tierRank } from "../twin-engine/role-pack";
import type { EffectiveAutonomy } from "../twin-engine/autonomy-ladder";
import type { ConnectorBinding } from "./connector-vault";
import { validateConnectorBinding } from "./connector-vault";
import type { ToolDefinition } from "./tool-contract";
import { validateToolDefinition } from "./tool-contract";

export const VERDICTS = [
  "execute",
  "shadow",
  "propose",
  "queue_approval",
  "sheriff_passkey",
  "deny",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type DenyCode =
  | "kill_switch"
  | "tool_invalid"
  | "tool_disabled"
  | "tier_forbidden"
  | "capability_missing"
  | "permission_missing"
  | "tier_exceeds_capability"
  | "scope_violation"
  | "binding_missing"
  | "binding_invalid"
  | "rate_limited"
  | "idempotency_required"
  | "context_inactive";

export interface ActingContext {
  readonly kind: "tenant_membership" | "platform_staff";
  readonly tenantRef: string;
  readonly status: "active" | "pending_pack" | "suspended";
  /** Permissions the server resolved for the role right now (never from the call). */
  readonly permissions: ReadonlySet<string>;
  /** The pack capability this call is made under, if the pack declares one. */
  readonly capability: Pick<
    RolePackCapability,
    "id" | "tier" | "requiresPermission" | "connector" | "approver"
  > | null;
  /** Result of the autonomy ladder for that capability. */
  readonly effective: EffectiveAutonomy;
}

export interface BrokerState {
  readonly killSwitch: boolean;
  readonly disabledTools: ReadonlySet<string>;
  /** Calls already made by this context for this tool in the current hour. */
  readonly callsThisHour: number;
  /** Active binding for the connector in the scope the call resolves to. */
  readonly binding: ConnectorBinding | null;
}

export interface ToolCall {
  readonly idempotencyKey: string | undefined;
}

export interface Decision {
  readonly verdict: Verdict;
  readonly tier: RolePackTier;
  readonly reasons: readonly string[];
  readonly denyCode?: DenyCode;
  readonly approver?: "role_owner" | "platform_staff" | "sheriff";
}

const deny = (tool: ToolDefinition, code: DenyCode, reason: string): Decision => ({
  verdict: "deny",
  tier: tool.tier,
  reasons: [reason],
  denyCode: code,
});

export function decideToolCall(
  tool: ToolDefinition,
  ctx: ActingContext,
  state: BrokerState,
  call: ToolCall,
): Decision {
  if (state.killSwitch) return deny(tool, "kill_switch", "global kill switch is engaged");

  const toolFindings = validateToolDefinition(tool);
  if (toolFindings.length > 0) return deny(tool, "tool_invalid", toolFindings.join("; "));
  if (tool.tier === "T4") return deny(tool, "tier_forbidden", "T4 is never autonomous");
  if (state.disabledTools.has(tool.id)) return deny(tool, "tool_disabled", "tool is disabled");

  if (ctx.status !== "active") {
    return deny(tool, "context_inactive", `context is ${ctx.status}`);
  }
  if (tool.platformOnly && ctx.kind !== "platform_staff") {
    return deny(tool, "scope_violation", "platform-only tool from a tenant context");
  }

  const cap = ctx.capability;
  if (!cap || (cap.connector !== undefined && cap.connector !== tool.connector)) {
    return deny(tool, "capability_missing", "no pack capability covers this tool");
  }
  if (!ctx.permissions.has(cap.requiresPermission)) {
    return deny(tool, "permission_missing", `role lacks ${cap.requiresPermission}`);
  }
  if (tierRank(tool.tier) > tierRank(cap.tier)) {
    return deny(
      tool,
      "tier_exceeds_capability",
      `tool ${tool.tier} exceeds capability ${cap.tier}`,
    );
  }

  const binding = state.binding;
  if (!binding || binding.status !== "active" || binding.connector !== tool.connector) {
    return deny(tool, "binding_missing", "no active connector binding");
  }
  if (validateConnectorBinding(binding).length > 0) {
    return deny(tool, "binding_invalid", "connector binding failed validation");
  }
  if (binding.scope === "tenant" && binding.tenantRef !== ctx.tenantRef) {
    return deny(tool, "scope_violation", "binding belongs to another tenant");
  }
  if (binding.scope === "platform" && ctx.kind !== "platform_staff") {
    return deny(tool, "scope_violation", "platform binding from a tenant context");
  }

  if (state.callsThisHour >= tool.maxCallsPerHour) {
    return deny(tool, "rate_limited", "hourly call budget exhausted");
  }
  if (
    tool.direction === "write" &&
    (call.idempotencyKey === undefined || call.idempotencyKey === "")
  ) {
    return deny(tool, "idempotency_required", "a write needs an idempotency key");
  }

  // ---- verdict: tier first, then earned autonomy ------------------------------
  if (tool.direction === "read" && tool.tier === "T0") {
    return { verdict: "execute", tier: tool.tier, reasons: ["T0 read"] };
  }
  if (tool.tier === "T3") {
    // Money, public posts, production config, access grants, legal: a human, always.
    return {
      verdict: "sheriff_passkey",
      tier: tool.tier,
      reasons: ["T3 always requires the sheriff passkey"],
      approver: "sheriff",
    };
  }
  switch (ctx.effective) {
    case "shadow":
      return {
        verdict: "shadow",
        tier: tool.tier,
        reasons: ["capability is in shadow: logged only"],
      };
    case "propose_only":
      return { verdict: "propose", tier: tool.tier, reasons: ["capability may only propose"] };
    case "act_with_approval":
      return {
        verdict: "queue_approval",
        tier: tool.tier,
        reasons: ["capability acts with approval"],
        approver: cap.approver === "sheriff" ? "sheriff" : (cap.approver ?? "role_owner"),
      };
    case "act_autonomously":
      return { verdict: "execute", tier: tool.tier, reasons: ["earned autonomy"] };
  }
}
