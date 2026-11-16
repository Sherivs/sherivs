/**
 * Agent Charter v1 (ENGINE-10, ADR-088): the single, reviewable statement of what an
 * internal AI agent is for, who answers for it, what it may touch, how it is
 * supervised, how it is measured and how it earns more autonomy.
 *
 * A charter does not grant authority. Authority still comes from the Role Pack, the
 * autonomy ladder, the tool broker and the human approvers. The charter adds what
 * those do not state: accountability, supervision line, model policy, duties
 * (for segregation of duties), service levels, evaluation requirements, handoffs,
 * review cadence and the dashboard an operator gets. `validateCharter` is pure and
 * returns every problem it finds; nothing is silently defaulted.
 */
import { z } from "zod";
import { GATEWAY_PURPOSES } from "../metering/usage-ledger";
import {
  MEMORY_SENSITIVITIES,
  tierRank,
  type MemorySensitivity,
  type RolePack,
} from "../twin-engine/role-pack";

export const CHARTER_SCHEMA = "sherivs.agent-charter.v1" as const;

export const AGENT_TIERS = ["executive", "department", "assurance"] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];

export const DUTIES = ["observe", "analyse", "originate", "coordinate", "verify"] as const;
export type Duty = (typeof DUTIES)[number];

export const T3_RULES = ["owner", "delegate_requires_owner_proposal"] as const;
export type T3Rule = (typeof T3_RULES)[number];

export const KILL_SCOPES = ["agent", "department", "workforce"] as const;

/** Panels every agent dashboard must offer. Extra panels are allowed. */
export const DASHBOARD_PANELS = [
  "charter",
  "context",
  "permissions",
  "autonomy",
  "budget",
  "proposals",
  "runs",
  "handoffs",
  "slos",
  "safety",
] as const;
export type DashboardPanel = (typeof DASHBOARD_PANELS)[number];
export const MANDATORY_PANELS: readonly DashboardPanel[] = [
  "charter",
  "permissions",
  "autonomy",
  "budget",
  "proposals",
  "safety",
];

const id = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const charterSchema = z
  .object({
    schema: z.literal(CHARTER_SCHEMA),
    packCode: id,
    codename: z.string().min(2).max(40),
    mission: z.string().min(20).max(240),
    agentTier: z.enum(AGENT_TIERS),
    /** The platform role (or "sheriff") whose holder answers for this agent. */
    accountable: id,
    /** Another agent's pack code, or "sheriff". */
    supervisor: id,
    modelPolicy: z
      .object({
        purposes: z
          .array(z.enum(GATEWAY_PURPOSES as [string, ...string[]]))
          .min(1)
          .max(6),
        contextCeiling: z.enum(MEMORY_SENSITIVITIES),
        seesCustomerContent: z.boolean(),
      })
      .strict(),
    duties: z.record(id, z.enum(DUTIES)),
    t3Rules: z.record(id, z.enum(T3_RULES)),
    slos: z
      .array(
        z
          .object({
            id,
            metric: z.string().min(5).max(120),
            target: z.number().positive(),
            unit: z.enum(["percent", "minutes", "count"]),
            window: z.enum(["daily", "weekly"]),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    evalSuites: z
      .array(
        z
          .object({
            capabilityId: id,
            suiteId: id,
            minPassRate: z.number().min(0.9).max(1),
          })
          .strict(),
      )
      .max(60),
    handoffs: z
      .array(z.object({ to: id, workOrderKind: id, when: z.string().min(5).max(160) }).strict())
      .max(12),
    review: z
      .object({
        cadenceDays: z.number().int().min(7).max(90),
        reviewer: id,
      })
      .strict(),
    killScope: z.enum(KILL_SCOPES),
    dashboardPanels: z.array(z.enum(DASHBOARD_PANELS)).min(1).max(DASHBOARD_PANELS.length),
  })
  .strict();

export type AgentCharter = z.infer<typeof charterSchema>;

const SENSITIVITY_RANK: Readonly<Record<MemorySensitivity, number>> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/** Every problem found, in a stable order. Empty means the charter is sound for this pack. */
export function validateCharter(candidate: unknown, pack: RolePack): readonly string[] {
  const parsed = charterSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const c = parsed.data;
  const problems: string[] = [];
  if (c.packCode !== pack.code)
    problems.push(`packCode ${c.packCode} does not match pack ${pack.code}`);

  const capIds = new Set(pack.capabilities.map((x) => x.id));
  for (const cap of pack.capabilities) {
    if (c.duties[cap.id] === undefined) problems.push(`duties: no duty declared for ${cap.id}`);
  }
  for (const key of Object.keys(c.duties)) {
    if (!capIds.has(key)) problems.push(`duties: ${key} is not a capability of ${pack.code}`);
  }

  for (const cap of pack.capabilities) {
    if (cap.tier === "T3" && c.t3Rules[cap.id] === undefined) {
      problems.push(`t3Rules: no rule declared for T3 capability ${cap.id}`);
    }
  }
  for (const key of Object.keys(c.t3Rules)) {
    const cap = pack.capabilities.find((x) => x.id === key);
    if (!cap || cap.tier !== "T3")
      problems.push(`t3Rules: ${key} is not a T3 capability of ${pack.code}`);
  }

  const suites = new Map(c.evalSuites.map((s) => [s.capabilityId, s]));
  for (const cap of pack.capabilities) {
    if (tierRank(cap.tier) >= tierRank("T1") && !suites.has(cap.id)) {
      problems.push(
        `evalSuites: ${cap.id} (${cap.tier}) has no evaluation suite, so it can never be promoted`,
      );
    }
  }
  for (const s of c.evalSuites) {
    if (!capIds.has(s.capabilityId))
      problems.push(`evalSuites: ${s.capabilityId} is not a capability of ${pack.code}`);
  }

  if (
    SENSITIVITY_RANK[c.modelPolicy.contextCeiling] > SENSITIVITY_RANK[pack.memory.maxSensitivity]
  ) {
    problems.push(
      `modelPolicy: context ceiling ${c.modelPolicy.contextCeiling} exceeds the pack memory ceiling ${pack.memory.maxSensitivity}`,
    );
  }
  if (c.modelPolicy.seesCustomerContent && c.modelPolicy.contextCeiling === "public") {
    problems.push("modelPolicy: sees customer content but the context ceiling is public");
  }

  for (const panel of MANDATORY_PANELS) {
    if (!c.dashboardPanels.includes(panel))
      problems.push(`dashboardPanels: missing mandatory panel ${panel}`);
  }
  if (new Set(c.dashboardPanels).size !== c.dashboardPanels.length)
    problems.push("dashboardPanels: duplicates");

  if (c.supervisor === c.packCode) problems.push("supervisor: an agent cannot supervise itself");
  if (c.agentTier === "executive" && c.supervisor !== "sheriff") {
    problems.push("supervisor: the executive agent is supervised by the sheriff");
  }
  if (c.agentTier === "department" && c.supervisor === "sheriff") {
    problems.push(
      "supervisor: a department agent is supervised by the executive agent, not directly by the sheriff",
    );
  }

  const duties = Object.values(c.duties);
  if (c.agentTier === "assurance") {
    // Independence: assurance agents verify, they do not act.
    if (c.supervisor !== "sheriff")
      problems.push(
        "supervisor: an assurance agent reports to the sheriff, never to an agent it audits",
      );
    if (duties.includes("originate"))
      problems.push("duties: an assurance agent cannot originate actions");
    for (const cap of pack.capabilities) {
      if (tierRank(cap.tier) > tierRank("T1")) problems.push(`assurance: ${cap.id} is above T1`);
      if (cap.connector !== undefined && cap.connector !== "owner-alert") {
        problems.push(`assurance: ${cap.id} acts through connector ${cap.connector}`);
      }
    }
    if (c.killScope !== "agent")
      problems.push(
        "killScope: an assurance agent can only be paused individually, by the sheriff",
      );
  }
  if (duties.includes("verify") && c.agentTier !== "assurance") {
    problems.push("duties: only assurance agents may hold a verify duty");
  }
  for (const [capId, duty] of Object.entries(c.duties)) {
    const cap = pack.capabilities.find((x) => x.id === capId);
    if (
      cap &&
      tierRank(cap.tier) >= tierRank("T2") &&
      duty !== "originate" &&
      duty !== "coordinate"
    ) {
      problems.push(`duties: ${capId} is ${cap.tier} but its duty is ${duty}`);
    }
    if (
      cap &&
      (duty === "observe" || duty === "analyse") &&
      cap.connector !== undefined &&
      cap.connector !== "owner-alert"
    ) {
      problems.push(`duties: ${capId} is ${duty} but acts through connector ${cap.connector}`);
    }
  }
  return problems;
}

export interface RosterEntry {
  readonly pack: RolePack;
  readonly charter: AgentCharter;
}

/** Cross-agent rules: supervision graph, handoff targets, T3 ownership, role coverage. */
export function validateRoster(roster: readonly RosterEntry[]): readonly string[] {
  const problems: string[] = [];
  const byCode = new Map<string, RosterEntry>();
  for (const e of roster) {
    if (byCode.has(e.pack.code)) problems.push(`roster: duplicate agent ${e.pack.code}`);
    byCode.set(e.pack.code, e);
    for (const p of validateCharter(e.charter, e.pack)) problems.push(`${e.pack.code}: ${p}`);
  }

  for (const e of roster) {
    const sup = e.charter.supervisor;
    if (sup !== "sheriff" && !byCode.has(sup))
      problems.push(`${e.pack.code}: supervisor ${sup} is not in the roster`);
    for (const h of e.charter.handoffs) {
      if (!byCode.has(h.to))
        problems.push(`${e.pack.code}: handoff target ${h.to} is not in the roster`);
      if (h.to === e.pack.code) problems.push(`${e.pack.code}: hands work off to itself`);
    }
    // supervision must reach the sheriff without a cycle
    const seen = new Set<string>([e.pack.code]);
    let cur = sup;
    while (cur !== "sheriff") {
      if (seen.has(cur)) {
        problems.push(`${e.pack.code}: supervision cycle through ${cur}`);
        break;
      }
      seen.add(cur);
      const next = byCode.get(cur);
      if (!next) break;
      cur = next.charter.supervisor;
    }
    const supEntry = byCode.get(sup);
    if (
      supEntry &&
      e.charter.agentTier === "department" &&
      supEntry.charter.agentTier !== "executive"
    ) {
      problems.push(`${e.pack.code}: a department agent must be supervised by the executive agent`);
    }
    if (
      e.charter.agentTier === "executive" &&
      roster.filter((x) => x.charter.agentTier === "executive").length > 1
    ) {
      problems.push(`${e.pack.code}: more than one executive agent`);
    }
  }

  const t3Owners = new Map<string, string[]>();
  const t3Holders = new Map<string, number>();
  for (const e of roster) {
    for (const cap of e.pack.capabilities) {
      if (cap.tier !== "T3") continue;
      t3Holders.set(cap.id, (t3Holders.get(cap.id) ?? 0) + 1);
      if (e.charter.t3Rules[cap.id] === "owner")
        t3Owners.set(cap.id, [...(t3Owners.get(cap.id) ?? []), e.pack.code]);
    }
  }
  for (const [capId] of t3Holders) {
    const owners = t3Owners.get(capId) ?? [];
    if (owners.length !== 1)
      problems.push(`T3 ${capId}: needs exactly one owner, found ${owners.length}`);
  }
  return problems;
}
