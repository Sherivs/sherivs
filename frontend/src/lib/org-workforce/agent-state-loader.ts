/**
 * Loads what the agent roster needs (ENGINE-21, ADR-099), with the data access injected so the
 * order of questions and the way each failure is read can be tested without a database.
 *
 * Only people who manage settings can read the add-on log, so the permission is asked first:
 * a person who cannot would otherwise get an empty log and a roster that wrongly says that
 * nothing is switched on.
 */
import {
  foldAddOnEvents,
  isNotApplied,
  messageForError,
  parseAddOnEvents,
  parseAgentEvents,
  sortEvents,
  type AgentEventRow,
  type AgentSwitchState,
} from "./agent-actions";

type Err = { message: string; code?: string } | null;
type Result = { data: unknown; error: Err };
interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(count: number): Query;
}
export interface AgentDb {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
}

export const EVENTS_SHOWN = 50;

export const EMPTY_SWITCHES: AgentSwitchState = {
  enabledCodes: [],
  pausedCodes: [],
  platformPausedCodes: [],
};

export interface AgentScreenState {
  /** The viewer holds settings.manage. */
  readonly canManage: boolean;
  /** The ENGINE-20 tables exist and could be read. */
  readonly applied: boolean;
  readonly switches: AgentSwitchState;
  readonly events: readonly AgentEventRow[];
  /** A sentence for the viewer, or an empty string. A missing proposal is not an error. */
  readonly error: string;
}

const none = (canManage: boolean, error = ""): AgentScreenState => ({
  canManage,
  applied: false,
  switches: EMPTY_SWITCHES,
  events: [],
  error,
});

export async function loadAgentState(db: AgentDb, orgId: string): Promise<AgentScreenState> {
  if (orgId.trim() === "") return none(false);
  const can = await db.rpc("scholar_can", { p_org: orgId, p_perm: "settings.manage" });
  if (can.error || can.data !== true) return none(false);

  const log = await db
    .from("org_agent_addon_events")
    .select("agent_code,action,seq")
    .eq("org_id", orgId)
    .order("seq");
  if (log.error) return none(true, isNotApplied(log.error) ? "" : messageForError(log.error));
  const switches = foldAddOnEvents(parseAddOnEvents(log.data));

  const raised = await db
    .from("org_agent_events")
    .select("id,agent_code,kind,severity,summary,amount_minor,created_at,acked_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(EVENTS_SHOWN);
  if (raised.error) {
    return {
      canManage: true,
      applied: true,
      switches,
      events: [],
      error: messageForError(raised.error),
    };
  }
  return {
    canManage: true,
    applied: true,
    switches,
    events: sortEvents(parseAgentEvents(raised.data)),
    error: "",
  };
}

/** Runs one planned call and returns a sentence for the viewer, or "" on success. */
export async function runAgentCall(
  db: AgentDb,
  rpc: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { error } = await db.rpc(rpc, args);
  return error ? messageForError(error) : "";
}
