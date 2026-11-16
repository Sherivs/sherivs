/**
 * Scope guard (ENGINE-15, ADR-093): the one door through which a Sherivs agent
 * reaches data.
 *
 * Why it exists: `authorizeScope` takes grant, ownership and "flagged" facts as
 * inputs, so a caller could simply claim them. This guard never trusts the caller
 * for any of them. It resolves the agent's workspace from the server-side list,
 * looks up grants, flags and row owners through ports, and lets the OPERATION
 * KIND decide whether an individual record is being read, so an agent cannot
 * ask for a record while claiming to ask for an aggregate.
 *
 * Fail closed throughout: an unknown agent, a missing fact, a failing lookup, a
 * failing audit write or an engaged kill switch all deny, and the inner data port
 * is never called on a deny. Every decision, allowed or denied, is audited
 * without any row content.
 *
 * Pure orchestration over ports: no database client, no environment, no secrets.
 */
import type { AccessMode, AgentWorkspace, ScopeGrant } from "../workforce-charter/workspace";
import { authorizeScope } from "../workforce-charter/workspace";
import { WORKFORCE_WORKSPACES } from "../workforce-charter/workspaces/workforce-workspaces";

export const OP_KINDS = ["read_aggregate", "read_records", "write_own", "propose"] as const;
export type OpKind = (typeof OP_KINDS)[number];

const ACCESS_FOR: Readonly<Record<OpKind, AccessMode>> = {
  read_aggregate: "read",
  read_records: "read",
  write_own: "write_own",
  propose: "propose",
};

/** What the caller may say. Nothing here is a claim of authority. */
export interface AgentOp {
  readonly kind: OpKind;
  readonly resource: string;
  readonly tenantId?: string;
  /** One specific row, when the operation targets one. */
  readonly rowId?: string;
  readonly payload?: unknown;
}

/** What the inner data port is told. The restrictions are set by the guard, never the caller. */
export interface GuardedOp extends AgentOp {
  readonly agentCode: string;
  /** Only rows this agent created. */
  readonly restrictToOwner?: string;
  /** Only rows the organization itself flagged to the platform. */
  readonly restrictToFlagged?: true;
}

export interface InnerDataPort {
  run(op: GuardedOp): Promise<unknown>;
}

export interface ScopeFactsPort {
  /** The live grant for this agent over this organization, if any. */
  grantFor(agentCode: string, tenantId: string, now: Date): Promise<ScopeGrant | null>;
  isFlagged(resource: string, tenantId: string, rowId: string): Promise<boolean>;
  rowOwner(resource: string, rowId: string): Promise<string | null>;
}

export interface ScopeAuditEntry {
  readonly agentCode: string;
  readonly kind: OpKind;
  readonly resource: string;
  readonly tenantId: string | null;
  readonly allowed: boolean;
  readonly reason: string;
  readonly at: string;
}

export interface ScopeAuditPort {
  record(entry: ScopeAuditEntry): Promise<void>;
}

export interface GuardPorts {
  readonly inner: InnerDataPort;
  readonly facts: ScopeFactsPort;
  readonly audit: ScopeAuditPort;
  readonly now: () => Date;
  /** The global kill switch, resolved server-side. */
  readonly killSwitch: () => boolean;
  /** True when the agent is paused, directly or by a cascade (see workforce-pause). Required: a guard without it does not compile. */
  readonly isPaused: (agentCode: string) => boolean;
  /** Defaults to the shipped workspaces; injectable so tests can use their own. */
  readonly workspaces?: readonly AgentWorkspace[];
}

export type GuardError =
  | "kill_switch"
  | "agent_paused"
  | "unknown_agent"
  | "invalid_operation"
  | "lookup_failed"
  | "audit_unavailable"
  | "data_unavailable"
  | (string & {});

export type GuardResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: GuardError };

async function record(ports: GuardPorts, entry: ScopeAuditEntry): Promise<boolean> {
  try {
    await ports.audit.record(entry);
    return true;
  } catch {
    return false;
  }
}

export async function runAsAgent(
  ports: GuardPorts,
  agentCode: string,
  op: AgentOp,
): Promise<GuardResult> {
  const at = ports.now();
  const entry = (allowed: boolean, reason: string): ScopeAuditEntry => ({
    agentCode,
    kind: op.kind,
    resource: op.resource,
    tenantId: op.tenantId ?? null,
    allowed,
    reason,
    at: at.toISOString(),
  });
  const refuse = async (error: GuardError): Promise<GuardResult> => {
    // A refusal is still recorded; if even that fails the answer is the same refusal.
    await record(ports, entry(false, error));
    return { ok: false, error };
  };

  if (ports.killSwitch()) return refuse("kill_switch");
  try {
    if (ports.isPaused(agentCode)) return refuse("agent_paused");
  } catch {
    return refuse("lookup_failed");
  }
  if (!OP_KINDS.includes(op.kind)) return refuse("invalid_operation");

  const workspace = (ports.workspaces ?? WORKFORCE_WORKSPACES).find(
    (w) => w.packCode === agentCode,
  );
  if (!workspace) return refuse("unknown_agent");
  const scope = workspace.scopes.find((s) => s.resource === op.resource);

  let grant: ScopeGrant | undefined;
  let flagged: boolean | undefined;
  let rowOwner: string | undefined;
  let restrictToOwner: string | undefined;
  let restrictToFlagged: true | undefined;

  try {
    if (scope?.rowScope === "tenant_with_grant" && op.tenantId) {
      grant = (await ports.facts.grantFor(agentCode, op.tenantId, at)) ?? undefined;
    }
    if (scope?.rowScope === "tenant_flagged" && op.tenantId) {
      if (op.rowId === undefined) {
        restrictToFlagged = true;
        flagged = true;
      } else {
        flagged = await ports.facts.isFlagged(op.resource, op.tenantId, op.rowId);
      }
    }
    if (scope?.rowScope === "own_agent") {
      if (op.rowId === undefined) {
        restrictToOwner = agentCode;
        rowOwner = agentCode;
      } else {
        rowOwner = (await ports.facts.rowOwner(op.resource, op.rowId)) ?? undefined;
      }
    }
  } catch {
    return refuse("lookup_failed");
  }

  const decision = authorizeScope(workspace, {
    agentCode,
    resource: op.resource,
    access: ACCESS_FOR[op.kind],
    ...(op.tenantId !== undefined ? { tenantId: op.tenantId } : {}),
    ...(rowOwner !== undefined ? { rowOwner } : {}),
    individualRecord: op.kind === "read_records",
    ...(flagged !== undefined ? { flaggedByTenant: flagged } : {}),
    ...(grant ? { grant } : {}),
    now: at,
  });
  if (!decision.allowed) return refuse(decision.reason);

  // Record first: an allowed call that cannot be audited does not happen.
  if (!(await record(ports, entry(true, decision.rowScope)))) {
    return { ok: false, error: "audit_unavailable" };
  }

  const guarded: GuardedOp = {
    ...op,
    agentCode,
    ...(restrictToOwner !== undefined ? { restrictToOwner } : {}),
    ...(restrictToFlagged ? { restrictToFlagged } : {}),
  };
  try {
    return { ok: true, data: await ports.inner.run(guarded) };
  } catch {
    // Deliberately not echoed: the error may carry row content.
    return { ok: false, error: "data_unavailable" };
  }
}
