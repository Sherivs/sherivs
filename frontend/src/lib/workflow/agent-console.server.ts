/**
 * AIN-05: server operations behind the agent console (ADR-129). Ports only: no database or request import, so the
 * whole path runs in a unit test and in the sim e2e against the real functions.
 *
 * Every call passes the VERIFIED user id (from the signed-in session, never from the request body) to a SECURITY
 * DEFINER function that decides permission for that person's own organisation. This file forwards, parses strictly
 * and maps errors to safe sentences. It never reads a table.
 */
import {
  AgentConsoleError,
  CONSOLE_REASON_SENTENCES,
  consoleErrorFromDatabase,
  parseAck,
  parseAgentConsole,
  parseMemoryList,
  parseSafetyList,
  type AgentConsole,
  type ConsoleReason,
  type MemoryList,
  type SafetyList,
} from "./agent-console";

export interface ConsoleRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: unknown; readonly code?: unknown } | null;
}
export interface AgentConsolePorts {
  readonly rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<ConsoleRpcResult>;
  /** The organisation of the verified person, resolved by the caller from the database, never from the request. */
  readonly organizationOf: (actorId: string) => PromiseLike<string | null>;
}

async function call(ports: AgentConsolePorts, fn: string, args: Record<string, unknown>): Promise<unknown> {
  let result: ConsoleRpcResult;
  try {
    result = await ports.rpc(fn, args);
  } catch {
    throw new AgentConsoleError("unavailable");
  }
  if (result.error) throw consoleErrorFromDatabase(result.error);
  return result.data;
}

export async function loadAgents(ports: AgentConsolePorts, input: { actorId: string }): Promise<AgentConsole> {
  return parseAgentConsole(await call(ports, "wf_console_agents", { p_actor: input.actorId }));
}

export async function listMemory(
  ports: AgentConsolePorts,
  input: { actorId: string; status: "proposed" | "active" | "all"; before?: string; beforeId?: string },
): Promise<MemoryList> {
  return parseMemoryList(
    await call(ports, "wf_console_memory_list", {
      p_actor: input.actorId,
      p_status: input.status,
      p_before: input.before ?? null,
      p_before_id: input.beforeId ?? null,
      p_limit: 25,
    }),
  );
}

export async function listSafety(
  ports: AgentConsolePorts,
  input: { actorId: string; filter: "pending" | "blocked" | "decided" | "all"; before?: string; beforeId?: string },
): Promise<SafetyList> {
  return parseSafetyList(
    await call(ports, "wf_console_safety_list", {
      p_actor: input.actorId,
      p_filter: input.filter,
      p_before: input.before ?? null,
      p_before_id: input.beforeId ?? null,
      p_limit: 25,
    }),
  );
}

export async function decideMemory(
  ports: AgentConsolePorts,
  input: { actorId: string; itemId: string; decision: "accept" | "reject" },
): Promise<{ ok: true }> {
  return parseAck(
    await call(ports, "wf_memory_decide", { p_actor: input.actorId, p_item: input.itemId, p_decision: input.decision }),
  );
}

export async function retireMemory(
  ports: AgentConsolePorts,
  input: { actorId: string; itemId: string },
): Promise<{ ok: true }> {
  return parseAck(await call(ports, "wf_memory_retire", { p_actor: input.actorId, p_item: input.itemId }));
}

export async function reviewSafety(
  ports: AgentConsolePorts,
  input: { actorId: string; checkId: string; decision: "cleared" | "rejected"; reason: ConsoleReason },
): Promise<{ ok: true }> {
  return parseAck(
    await call(ports, "wf_safety_review_check", {
      p_actor: input.actorId,
      p_check: input.checkId,
      p_decision: input.decision,
      p_reason: CONSOLE_REASON_SENTENCES[input.reason],
    }),
  );
}

export async function demoteAgent(
  ports: AgentConsolePorts,
  input: { actorId: string; agentRef: string; toLevel: "suggest" | "draft" | "act_with_approval"; reason: ConsoleReason },
): Promise<{ ok: true }> {
  const org = await ports.organizationOf(input.actorId);
  if (!org) throw new AgentConsoleError("not_authorized");
  return parseAck(
    await call(ports, "wf_autonomy_demote", {
      p_actor: input.actorId,
      p_org: org,
      p_agent: input.agentRef,
      p_to_level: input.toLevel,
      p_reason: CONSOLE_REASON_SENTENCES[input.reason],
    }),
  );
}
