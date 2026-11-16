/**
 * Tool Broker service (ENGINE-03, ADR-081): the orchestration around the pure
 * decision. It depends on ports only, so it has no vendor or database import and
 * a test can drive it in memory. The DB adapter implements `LedgerPort` over
 * `cg_tool_call_ledger`.
 *
 * Order matters and is fixed: resolve authority server-side, replay if this
 * idempotency key was already decided, decide, then append the decision BEFORE
 * the caller is told anything. A call whose decision cannot be recorded is
 * refused: nothing may act without a ledger row.
 */
import { decideToolCall, type ActingContext, type BrokerState, type Decision } from "./broker";
import type { ToolDefinition } from "./tool-contract";
import { argsDigest, redactArgs } from "./redact.server";

export interface DecisionRecord {
  readonly id: string;
  readonly decision: Decision;
  readonly argsDigest: string;
}

export interface LedgerPort {
  findDecision(input: {
    twinContextId: string;
    toolId: string;
    idempotencyKey: string;
  }): Promise<DecisionRecord | null>;
  appendDecision(input: {
    twinContextId: string;
    tenantRef: string;
    tool: ToolDefinition;
    decision: Decision;
    argsDigest: string;
    argsRedacted: unknown;
    idempotencyKey: string | undefined;
  }): Promise<{ id: string }>;
}

export interface AuthorityPort {
  /** Server-resolved authority for this context and tool. Never from the call. */
  resolve(input: {
    twinContextId: string;
    tool: ToolDefinition;
  }): Promise<{ ctx: ActingContext; state: BrokerState } | null>;
}

export type BrokerResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly decision: Decision;
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly error: "unknown_context" | "ledger_unavailable" };

export async function brokerToolCall(
  ports: { authority: AuthorityPort; ledger: LedgerPort },
  req: {
    twinContextId: string;
    tool: ToolDefinition;
    args: unknown;
    idempotencyKey?: string;
  },
): Promise<BrokerResult> {
  const digest = argsDigest(req.args);
  try {
    if (req.idempotencyKey) {
      const prior = await ports.ledger.findDecision({
        twinContextId: req.twinContextId,
        toolId: req.tool.id,
        idempotencyKey: req.idempotencyKey,
      });
      // The same key with different arguments is not a replay: it is refused.
      if (prior) {
        if (prior.argsDigest !== digest) {
          return {
            ok: true,
            id: prior.id,
            replayed: true,
            decision: {
              verdict: "deny",
              tier: req.tool.tier,
              reasons: ["idempotency key reused with different arguments"],
              denyCode: "idempotency_required",
            },
          };
        }
        return { ok: true, id: prior.id, decision: prior.decision, replayed: true };
      }
    }

    const authority = await ports.authority.resolve({
      twinContextId: req.twinContextId,
      tool: req.tool,
    });
    if (!authority) return { ok: false, error: "unknown_context" };

    const decision = decideToolCall(req.tool, authority.ctx, authority.state, {
      idempotencyKey: req.idempotencyKey,
    });
    const row = await ports.ledger.appendDecision({
      twinContextId: req.twinContextId,
      tenantRef: authority.ctx.tenantRef,
      tool: req.tool,
      decision,
      argsDigest: digest,
      argsRedacted: redactArgs(req.args),
      idempotencyKey: req.idempotencyKey,
    });
    return { ok: true, id: row.id, decision, replayed: false };
  } catch {
    // Fail closed. The error is deliberately not echoed: it may carry argument data.
    return { ok: false, error: "ledger_unavailable" };
  }
}
