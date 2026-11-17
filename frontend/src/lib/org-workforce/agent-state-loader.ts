/**
 * Loads what the agent roster needs (ENGINE-21, ADR-099), with the data access injected so the
 * order of questions and the way each failure is read can be tested without a database.
 *
 * Only people who manage settings can read the add-on log, so the permission is asked first:
 * a person who cannot would otherwise get an empty log and a roster that wrongly says that
 * nothing is switched on.
 */
import { buildOrgRoster, type RosterView } from "./roster-view";
import { MEMBERSHIP_ROLES, type MembershipRole } from "./org-agents";
import type { MemberFact } from "./activation";
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
  /** People who hold a role some agent answers to. Meaningful only when `holdersKnown`. */
  readonly members: readonly MemberFact[];
  /** False when the holders could not be read; the roster then claims nothing about them. */
  readonly holdersKnown: boolean;
  /** A sentence for the viewer, or an empty string. A missing proposal is not an error. */
  readonly error: string;
}

const none = (canManage: boolean, error = ""): AgentScreenState => ({
  canManage,
  applied: false,
  switches: EMPTY_SWITCHES,
  events: [],
  members: [],
  holdersKnown: false,
  error,
});

/**
 * Rows from `org_agent_holders`. The database offers no pending-invitation state: an active
 * membership is one whose invite was applied, so it counts as accepted (ENGINE-22, ADR-100).
 */
export function parseHolders(data: unknown): readonly MemberFact[] {
  if (!Array.isArray(data)) return [];
  const out: MemberFact[] = [];
  for (const r of data) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (
      typeof o.holder_id !== "string" ||
      typeof o.holder_role !== "string" ||
      !(MEMBERSHIP_ROLES as readonly string[]).includes(o.holder_role)
    ) {
      continue;
    }
    out.push({
      identityId: o.holder_id,
      role: o.holder_role as MembershipRole,
      active: true,
      invitation: "accepted",
    });
  }
  return out;
}

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

  // Who holds each agent's approving role. A failure here must not hide the switches: the
  // roster then says it has not checked, which is true.
  const holders = await db.rpc("org_agent_holders", { p_org: orgId });
  const holdersKnown = !holders.error && Array.isArray(holders.data);
  const members = holdersKnown ? parseHolders(holders.data) : [];
  const holderError =
    holders.error && !isNotApplied(holders.error) ? messageForError(holders.error) : "";

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
      members,
      holdersKnown,
      error: messageForError(raised.error),
    };
  }
  return {
    canManage: true,
    applied: true,
    switches,
    events: sortEvents(parseAgentEvents(raised.data)),
    members,
    holdersKnown,
    error: holderError,
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

const INACTIVE_STATUSES = new Set(["suspended", "cancelled", "canceled", "expired"]);

/** The roster for one organization from what was loaded. Everything the roster claims comes from here. */
export function rosterFromState(
  school: {
    readonly id: string;
    readonly subscription_tier?: string | null;
    readonly subscription_status?: string | null;
  },
  state: AgentScreenState,
): RosterView {
  return buildOrgRoster({
    tenant: {
      tenantId: school.id,
      tier: school.subscription_tier,
      active: !INACTIVE_STATUSES.has((school.subscription_status ?? "").toLowerCase()),
    },
    enabledCodes: state.switches.enabledCodes,
    pausedCodes: state.switches.pausedCodes,
    platformPausedCodes: state.switches.platformPausedCodes,
    addOnsApplied: state.applied,
    members: state.members,
    holdersKnown: state.holdersKnown,
    stateKnown: state.canManage,
  });
}
