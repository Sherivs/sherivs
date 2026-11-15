/**
 * Execution gate (ENGINE-06, ADR-084): the only code that calls an adapter.
 *
 * It re-verifies, from the ledger, that this exact call was cleared before the
 * adapter runs: the decision exists, belongs to this tool and tier, was made over
 * exactly these arguments, and carries the verdict and approval its tier demands.
 * Then it resolves the secret, runs the adapter once, scrubs the result, and
 * ALWAYS appends the outcome. If the outcome cannot be recorded the failure is
 * reported loudly (`outcome_unrecorded`) rather than hidden.
 *
 * Refusals before clearance write nothing: no side effect happened.
 */
import { validateConnectorBinding, type ConnectorBinding } from "../tool-broker/connector-vault";
import { toolById } from "../tool-broker/platform-tools";
import { argsDigest } from "../tool-broker/redact.server";
import type { Verdict } from "../tool-broker/broker";
import type { ApprovalEvidence } from "../playbook-runner/playbook-runner.server";
import type { RolePackTier } from "../twin-engine/role-pack";
import type { ConnectorAdapter, HttpPort, SecretResolverPort } from "./adapter-contract";

export interface LoadedDecision {
  readonly id: string;
  readonly twinContextId: string;
  readonly tenantRef: string;
  readonly contextKind: "tenant_membership" | "platform_staff";
  readonly toolId: string;
  readonly toolVersion: string;
  readonly tier: RolePackTier;
  readonly verdict: Verdict;
  readonly argsDigest: string;
}

export interface GateLedgerPort {
  loadDecision(decisionId: string): Promise<LoadedDecision | null>;
  hasSucceeded(decisionId: string): Promise<boolean>;
  appendOutcome(input: {
    readonly decision: LoadedDecision;
    readonly outcome: "succeeded" | "failed" | "aborted";
    readonly approval: ApprovalEvidence | null;
  }): Promise<{ readonly id: string }>;
}

export interface GatePorts {
  readonly ledger: GateLedgerPort;
  readonly adapters: Readonly<Record<string, ConnectorAdapter>>;
  readonly secrets: SecretResolverPort;
  readonly bindings: (q: {
    readonly connector: string;
    readonly scope: "platform" | "tenant";
    readonly tenantRef: string;
  }) => Promise<ConnectorBinding | null>;
  readonly http: HttpPort;
}

export type GateError =
  | "unknown_decision"
  | "unknown_tool"
  | "args_mismatch"
  | "not_cleared"
  | "already_succeeded"
  | "no_adapter"
  | "binding_unavailable"
  | "ledger_unavailable"
  | "outcome_unrecorded";

export type GateResult =
  | {
      readonly ok: true;
      readonly outcome: "succeeded" | "failed";
      readonly outcomeId: string;
      readonly summary: unknown;
      readonly errorCode: string | null;
    }
  | { readonly ok: false; readonly error: GateError };

/** Replace every occurrence of the secret, at any depth, so it can never be stored or returned. */
export function scrubSecret(value: unknown, secret: string): unknown {
  if (secret.length === 0) return value;
  if (typeof value === "string")
    return value.includes(secret) ? value.split(secret).join("[withheld]") : value;
  if (Array.isArray(value)) return value.map((v) => scrubSecret(v, secret));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.split(secret).join("[withheld]")] = scrubSecret(v, secret);
    }
    return out;
  }
  return value;
}

function cleared(d: LoadedDecision, approval: ApprovalEvidence | null): boolean {
  if (d.verdict === "execute") return true;
  if (approval === null || approval.approvalRef.trim() === "") return false;
  if (d.verdict === "sheriff_passkey") return approval.approverKind === "sheriff";
  return d.verdict === "queue_approval";
}

export async function executeCleared(
  ports: GatePorts,
  req: {
    readonly decisionId: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
    readonly approval: ApprovalEvidence | null;
  },
): Promise<GateResult> {
  let decision: LoadedDecision | null;
  try {
    decision = await ports.ledger.loadDecision(req.decisionId);
  } catch {
    return { ok: false, error: "ledger_unavailable" };
  }
  if (!decision) return { ok: false, error: "unknown_decision" };

  const tool = toolById(decision.toolId);
  if (!tool || tool.version !== decision.toolVersion || tool.tier !== decision.tier) {
    return { ok: false, error: "unknown_tool" };
  }
  if (argsDigest(req.args) !== decision.argsDigest) return { ok: false, error: "args_mismatch" };
  if (!cleared(decision, req.approval)) return { ok: false, error: "not_cleared" };
  if (tool.platformOnly && decision.contextKind !== "platform_staff")
    return { ok: false, error: "not_cleared" };

  try {
    if (await ports.ledger.hasSucceeded(decision.id))
      return { ok: false, error: "already_succeeded" };
  } catch {
    return { ok: false, error: "ledger_unavailable" };
  }

  const adapter = ports.adapters[tool.connector];
  if (!adapter || adapter.connector !== tool.connector || !adapter.tools.includes(tool.id)) {
    return { ok: false, error: "no_adapter" };
  }

  const scope = decision.contextKind === "platform_staff" ? "platform" : "tenant";
  const binding = await ports.bindings({
    connector: tool.connector,
    scope,
    tenantRef: decision.tenantRef,
  });
  if (
    !binding ||
    binding.status !== "active" ||
    binding.connector !== tool.connector ||
    binding.scope !== scope ||
    (scope === "tenant" && binding.tenantRef !== decision.tenantRef) ||
    validateConnectorBinding(binding).length > 0
  ) {
    return { ok: false, error: "binding_unavailable" };
  }

  const approval = decision.verdict === "execute" ? null : req.approval;
  const record = async (outcome: "succeeded" | "failed" | "aborted") => {
    try {
      return await ports.ledger.appendOutcome({ decision, outcome, approval });
    } catch {
      return null;
    }
  };

  let secret: string | null = null;
  try {
    secret = await ports.secrets.resolve(binding.secretRef);
  } catch {
    secret = null;
  }
  if (secret === null || secret === "") {
    const row = await record("failed");
    return row
      ? {
          ok: true,
          outcome: "failed",
          outcomeId: row.id,
          summary: null,
          errorCode: "secret_unavailable",
        }
      : { ok: false, error: "outcome_unrecorded" };
  }

  let outcome: "succeeded" | "failed" = "failed";
  let summary: unknown = null;
  let errorCode: string | null = "adapter_error";
  try {
    const res = await adapter.execute({
      tool,
      args: req.args,
      binding,
      secret,
      http: ports.http,
      idempotencyKey: req.idempotencyKey,
    });
    if (res.outcome === "succeeded") {
      outcome = "succeeded";
      summary = scrubSecret(res.summary, secret);
      errorCode = null;
    } else {
      errorCode = res.code;
    }
  } catch {
    // The error is deliberately not echoed: it may carry the secret or argument data.
  }
  const row = await record(outcome);
  if (!row) return { ok: false, error: "outcome_unrecorded" };
  return { ok: true, outcome, outcomeId: row.id, summary, errorCode };
}
