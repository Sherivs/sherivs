/**
 * Engine actors (AIN-01, ADR-125): the one place that turns the agent packs and charters (platform
 * workforce, ADR-088) and the organization agent packs (ADR-095) into the identity, capability and
 * budget rows the workflow engine enforces.
 *
 * Definitions only: no I/O, no environment, no secret, no model call. The SQL seed that
 * `engineActorSeedSql` renders is pasted into the AIN-01 migration between two marker lines and a test
 * fails when the two differ. Nothing here grants authority; the engine's tool broker, autonomy guard
 * and human approvers still decide what an agent may do. This only says who an agent is.
 */
import { ORG_AGENTS } from "../org-workforce/org-agents";
import {
  tierRank,
  type RolePack,
  type RolePackCapability,
  type RolePackTier,
} from "../twin-engine/role-pack";
import { workforceRoster } from "./roster";

export const ENGINE_AGENT_FAMILIES = ["platform", "org"] as const;
export type EngineAgentFamily = (typeof ENGINE_AGENT_FAMILIES)[number];

export type EngineAgentTier = "executive" | "department" | "assurance" | "organization";

/** The highest tier an engine actor may hold. T4 is never declarable and never reaches the engine. */
export type EngineMaxTier = "T0" | "T1" | "T2" | "T3";

export interface EngineAgentCapability {
  readonly id: string;
  readonly tier: EngineMaxTier;
  readonly autonomy: RolePackCapability["autonomy"];
  readonly requiresPermission: string;
  readonly connector: string | null;
  readonly approver: string | null;
}

export interface EngineAgentRecord {
  /** The identity key: the pack code. Equal to the agent code used by pause state and org add-ons. */
  readonly agentRef: string;
  readonly family: EngineAgentFamily;
  readonly codename: string;
  readonly agentTier: EngineAgentTier;
  readonly accountable: string;
  /** Another agent's ref, or "sheriff"; null for an organization agent (it answers to its role). */
  readonly supervisor: string | null;
  readonly packVersion: string;
  readonly maxTier: EngineMaxTier;
  readonly contextCeiling: RolePack["memory"]["maxSensitivity"];
  readonly dailyActions: number;
  readonly dailyModelCalls: number;
  readonly dailyCostCapMinor: number;
  readonly capabilities: readonly EngineAgentCapability[];
}

/**
 * Which engine action classes a capability tier may use. Reviewed data, an engineering default for
 * the founder to ratify (ADR-125). `ai_model` is listed so that approving the AI route later needs no
 * second migration here; until then `wf_ai_route_approved()` refuses kind `ai` steps outright.
 * Money, safeguarding, credential, publishing, mass-message and authority-sharing classes stay capped
 * at draft by the autonomy guard whatever this table says. `unclassified` is allowed from T1 only because
 * the autonomy guard already caps every class other than `internal` at draft and the action broker never
 * executes an unclassified action; an observe-only (T0) agent gets no unclassified action at all.
 */
export const TIER_ACTION_CLASSES: Readonly<Record<EngineMaxTier, readonly string[]>> = {
  T0: ["internal", "wait"],
  T1: ["internal", "wait", "task", "ai_model", "unclassified"],
  T2: ["internal", "wait", "task", "ai_model", "unclassified", "communication"],
  T3: [
    "internal",
    "wait",
    "task",
    "ai_model",
    "unclassified",
    "communication",
    "money_movement",
    "safeguarding",
    "credential_change",
    "public_publish",
    "mass_message",
    "external_authority_share",
  ],
};

function engineMaxTier(pack: RolePack): EngineMaxTier {
  let best: RolePackTier = "T0";
  for (const cap of pack.capabilities) if (tierRank(cap.tier) > tierRank(best)) best = cap.tier;
  if (best === "T4") throw new Error(`${pack.code}: a T4 capability cannot be an engine actor`);
  return best;
}

function capabilities(pack: RolePack): readonly EngineAgentCapability[] {
  return pack.capabilities.map((c) => {
    if (c.tier === "T4") throw new Error(`${pack.code}: ${c.id} is T4`);
    return {
      id: c.id,
      tier: c.tier,
      autonomy: c.autonomy,
      requiresPermission: c.requiresPermission,
      connector: c.connector ?? null,
      approver: c.approver ?? null,
    };
  });
}

/** Every engine actor, platform agents first in charter order, then organization agents in catalogue order. */
export function engineAgentRecords(): readonly EngineAgentRecord[] {
  const platform = workforceRoster().map(({ pack, charter }): EngineAgentRecord => ({
    agentRef: pack.code,
    family: "platform",
    codename: charter.codename,
    agentTier: charter.agentTier,
    accountable: charter.accountable,
    supervisor: charter.supervisor,
    packVersion: pack.version,
    maxTier: engineMaxTier(pack),
    contextCeiling: pack.memory.maxSensitivity,
    dailyActions: pack.budget.dailyActions,
    dailyModelCalls: pack.budget.dailyModelCalls,
    dailyCostCapMinor: pack.budget.dailyCostCapMinor,
    capabilities: capabilities(pack),
  }));
  const org = ORG_AGENTS.map((a): EngineAgentRecord => ({
    agentRef: a.pack.code,
    family: "org",
    codename: a.codename,
    agentTier: "organization",
    accountable: a.accountable,
    supervisor: null,
    packVersion: a.pack.version,
    maxTier: engineMaxTier(a.pack),
    contextCeiling: a.pack.memory.maxSensitivity,
    dailyActions: a.pack.budget.dailyActions,
    dailyModelCalls: a.pack.budget.dailyModelCalls,
    dailyCostCapMinor: a.pack.budget.dailyCostCapMinor,
    capabilities: capabilities(a.pack),
  }));
  return [...platform, ...org];
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const qn = (s: string | null): string => (s === null ? "NULL" : q(s));

export const SEED_BEGIN =
  "-- BEGIN GENERATED AIN01 SEED (scripts/ops/generate-ain01-agent-seed.mjs; do not edit by hand)";
export const SEED_END = "-- END GENERATED AIN01 SEED";

/** The exact SQL the migration carries for the registry seed. Deterministic. */
export function engineActorSeedSql(records: readonly EngineAgentRecord[]): string {
  const lines: string[] = [SEED_BEGIN];
  lines.push(
    "INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,",
    "    max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor) VALUES",
  );
  lines.push(
    records
      .map(
        (r) =>
          `  (${q(r.agentRef)}, ${q(r.family)}, ${q(r.codename)}, ${q(r.agentTier)}, ${q(r.accountable)}, ${qn(r.supervisor)}, ${q(r.packVersion)}, ${q(r.maxTier)}, ${q(r.contextCeiling)}, ${r.dailyActions}, ${r.dailyModelCalls}, ${r.dailyCostCapMinor})`,
      )
      .join(",\n") + ";",
  );
  lines.push(
    "INSERT INTO public.wf_agent_capability (agent_ref, capability_id, tier, autonomy_mode, requires_permission,",
    "    connector, approver) VALUES",
  );
  lines.push(
    records
      .flatMap((r) =>
        r.capabilities.map(
          (c) =>
            `  (${q(r.agentRef)}, ${q(c.id)}, ${q(c.tier)}, ${q(c.autonomy)}, ${q(c.requiresPermission)}, ${qn(c.connector)}, ${qn(c.approver)})`,
        ),
      )
      .join(",\n") + ";",
  );
  lines.push(SEED_END);
  return lines.join("\n");
}

/** Rows of `wf_agent_tier_action_class`, in a stable order, for the same drift check. */
export function tierActionClassSeedSql(): string {
  const rows = (Object.keys(TIER_ACTION_CLASSES) as EngineMaxTier[]).flatMap((t) =>
    TIER_ACTION_CLASSES[t].map((c) => `  (${q(t)}, ${q(c)})`),
  );
  return [
    "-- BEGIN GENERATED AIN01 TIER CLASSES (scripts/ops/generate-ain01-agent-seed.mjs; do not edit by hand)",
    "INSERT INTO public.wf_agent_tier_action_class (tier, action_class) VALUES",
    rows.join(",\n") + ";",
    "-- END GENERATED AIN01 TIER CLASSES",
  ].join("\n");
}
