/**
 * Workforce console view-model (ENGINE-12, ADR-090).
 *
 * Pure functions that turn Role Packs and charters into what the console shows. Nothing
 * here reads a database, a clock or a secret. Anything that would need live data (runs,
 * spend, proposals, measured service levels) is reported as unavailable with the reason,
 * never as a number.
 */
import { ACTION_MAP } from "../jarvis-bridge/action-map";
import { JARVIS_EXECUTIVE_PACK } from "../jarvis-executive/executive-pack";
import { JARVIS_RISK_TIER_POLICY } from "../jarvis/risk-policy";
import { COMPLETION_WORKFORCE_PACKS } from "../twin-engine/packs/completion-workforce-packs";
import { EXPANSION_WORKFORCE_PACKS } from "../twin-engine/packs/expansion-workforce-packs";
import { PLATFORM_WORKFORCE_PACKS } from "../twin-engine/packs/platform-workforce-packs";
import {
  tierRank,
  type PackAutonomyMode,
  type RolePack,
  type RolePackTier,
} from "../twin-engine/role-pack";
import {
  validateRoster,
  type AgentCharter,
  type Duty,
  type DashboardPanel,
} from "../workforce-charter/charter";
import { EXISTING_CHARTERS } from "../workforce-charter/charters/existing-charters";
import { COMPLETION_CHARTERS } from "../workforce-charter/charters/completion-charters";
import { EXPANSION_CHARTERS } from "../workforce-charter/charters/expansion-charters";
import { WORKFORCE_WORKSPACES } from "../workforce-charter/workspaces/workforce-workspaces";
import type { AccessMode, AgentWorkspace, RowScope } from "../workforce-charter/workspace";

export const ENGINE_TABLES_NOTE =
  "Not available: the workforce engine tables have not been applied, so nothing is recorded yet.";

export const TIER_TITLES = {
  executive: "Executive",
  department: "Departments",
  assurance: "Independent assurance",
} as const;

export const AUTONOMY_LABELS: Readonly<Record<PackAutonomyMode, string>> = {
  propose_only: "Proposes only",
  act_with_approval: "Acts after approval",
  act_autonomously: "Acts on its own",
};

export const DUTY_LABELS: Readonly<Record<Duty, string>> = {
  observe: "Observes",
  analyse: "Analyses",
  originate: "Originates action",
  coordinate: "Coordinates",
  verify: "Verifies independently",
};

export const PANEL_TITLES: Readonly<Record<DashboardPanel, string>> = {
  charter: "Charter",
  context: "Context and memory",
  permissions: "Permissions and capabilities",
  autonomy: "Autonomy",
  budget: "Budget",
  proposals: "Proposals and approvals",
  runs: "Playbooks and runs",
  handoffs: "Handoffs",
  slos: "Service levels",
  safety: "Safety and oversight",
};

/** Packs wired into the existing registries; the rest are definitions only. */
const BOUND_CODES: ReadonlySet<string> = new Set([
  ...PLATFORM_WORKFORCE_PACKS.map((p) => p.code),
  JARVIS_EXECUTIVE_PACK.code,
]);

const ALL_PACKS: readonly RolePack[] = [
  JARVIS_EXECUTIVE_PACK,
  ...PLATFORM_WORKFORCE_PACKS,
  ...EXPANSION_WORKFORCE_PACKS,
  ...COMPLETION_WORKFORCE_PACKS,
];
const ALL_CHARTERS: readonly AgentCharter[] = [
  ...EXISTING_CHARTERS,
  ...EXPANSION_CHARTERS,
  ...COMPLETION_CHARTERS,
];

export const ACCESS_LABELS: Readonly<Record<AccessMode, string>> = {
  read: "Reads",
  write_own: "Writes its own records",
  propose: "Proposes for approval",
};

/** What each row rule means, in words an operator can check against the database policy. */
export const ROW_SCOPE_LABELS: Readonly<Record<RowScope, string>> = {
  platform: "Platform records that belong to no organization",
  tenant_metadata: "One identity and plan row per organization, never its content",
  aggregate: "Aggregated figures only, never an individual record",
  tenant_with_grant: "An organization's rows only under an active, time-boxed support grant",
  tenant_flagged: "Only rows the organization itself flagged to the platform",
  own_agent: "Only rows this agent created",
};

export interface Entry {
  readonly pack: RolePack;
  readonly charter: AgentCharter;
}

export const workforceEntries = (): readonly Entry[] =>
  ALL_CHARTERS.flatMap((charter) => {
    const pack = ALL_PACKS.find((p) => p.code === charter.packCode);
    return pack ? [{ pack, charter }] : [];
  });

const highestTier = (pack: RolePack): RolePackTier =>
  pack.capabilities.reduce<RolePackTier>(
    (max, c) => (tierRank(c.tier) > tierRank(max) ? c.tier : max),
    "T0",
  );

export interface RosterRow {
  readonly code: string;
  readonly codename: string;
  readonly title: string;
  readonly tier: AgentCharter["agentTier"];
  readonly mission: string;
  readonly accountable: string;
  readonly supervisor: string;
  readonly capabilityCount: number;
  readonly gatedCount: number;
  readonly highestTier: RolePackTier;
  readonly binding: "bound" | "definition_only";
  readonly killScope: AgentCharter["killScope"];
  readonly state: "shadow";
}

export interface RosterView {
  readonly groups: readonly {
    readonly tier: AgentCharter["agentTier"];
    readonly title: string;
    readonly rows: readonly RosterRow[];
  }[];
  readonly total: number;
  readonly boundCount: number;
  readonly definitionOnlyCount: number;
  /** Problems the roster validator reports; empty when the workforce is coherent. */
  readonly rosterProblems: readonly string[];
}

export function buildRoster(entries: readonly Entry[] = workforceEntries()): RosterView {
  const rows: RosterRow[] = entries.map(({ pack, charter }) => ({
    code: pack.code,
    codename: charter.codename,
    title: pack.title,
    tier: charter.agentTier,
    mission: charter.mission,
    accountable: charter.accountable,
    supervisor: charter.supervisor,
    capabilityCount: pack.capabilities.length,
    gatedCount: pack.capabilities.filter((c) => tierRank(c.tier) >= tierRank("T2")).length,
    highestTier: highestTier(pack),
    binding: BOUND_CODES.has(pack.code) ? "bound" : "definition_only",
    killScope: charter.killScope,
    state: "shadow",
  }));
  const order: AgentCharter["agentTier"][] = ["executive", "department", "assurance"];
  return {
    groups: order
      .map((tier) => ({
        tier,
        title: TIER_TITLES[tier],
        rows: rows.filter((r) => r.tier === tier),
      }))
      .filter((g) => g.rows.length > 0),
    total: rows.length,
    boundCount: rows.filter((r) => r.binding === "bound").length,
    definitionOnlyCount: rows.filter((r) => r.binding === "definition_only").length,
    rosterProblems: validateRoster(entries),
  };
}

export interface CapabilityRow {
  readonly id: string;
  readonly title: string;
  readonly tier: RolePackTier;
  readonly autonomy: string;
  readonly duty: string;
  readonly connector: string | null;
  readonly approver: string | null;
  readonly permission: string;
  /** JARVIS approval action that gates it, or null when none is defined. */
  readonly approvalAction: string | null;
  readonly t3Rule: string | null;
  readonly evalSuite: string | null;
  readonly evalBar: number | null;
}

export interface WorkspaceView {
  readonly scopes: readonly {
    readonly resource: string;
    readonly access: string;
    readonly rowRule: string;
    readonly rowScope: RowScope;
    readonly sensitivity: string;
    readonly purpose: string;
    readonly grantMaxMinutes: number | null;
  }[];
  readonly reachesOrganizationRows: boolean;
  readonly boundaries: readonly string[];
  readonly workbench: AgentWorkspace["ui"];
}

export interface AgentDashboard {
  readonly code: string;
  readonly codename: string;
  readonly title: string;
  readonly binding: "bound" | "definition_only";
  readonly panels: readonly DashboardPanel[];
  readonly charter: {
    readonly mission: string;
    readonly tier: string;
    readonly accountable: string;
    readonly supervisor: string;
    readonly reviewCadenceDays: number;
    readonly reviewer: string;
    readonly packVersion: string;
  };
  readonly context: {
    readonly domains: readonly string[];
    readonly maxSensitivity: string;
    readonly retentionDays: number;
    readonly modelPurposes: readonly string[];
    readonly contextCeiling: string;
    readonly seesCustomerContent: boolean;
    readonly crossTenant: false;
  };
  readonly permissions: {
    readonly granted: readonly string[];
    readonly capabilities: readonly CapabilityRow[];
  };
  readonly autonomy: {
    readonly current: "shadow";
    readonly note: string;
    readonly ceilingByCapability: readonly { readonly id: string; readonly ceiling: string }[];
  };
  readonly budget: {
    readonly dailyActions: number;
    readonly dailyModelCalls: number;
    readonly dailyCostCapMinor: number;
    readonly used: { readonly available: false; readonly reason: string };
  };
  readonly proposals: {
    readonly routes: readonly {
      readonly capabilityId: string;
      readonly approver: string;
      readonly action: string | null;
    }[];
    readonly recorded: { readonly available: false; readonly reason: string };
  };
  readonly runs: {
    readonly playbooks: readonly {
      readonly id: string;
      readonly title: string;
      readonly wakeOn: readonly string[];
      readonly steps: readonly string[];
      readonly maxRunsPerDay: number;
    }[];
    readonly recorded: { readonly available: false; readonly reason: string };
  };
  readonly handoffs: readonly {
    readonly to: string;
    readonly kind: string;
    readonly when: string;
  }[];
  /** Null only if an agent has no workspace, which the workspace validator reports. */
  readonly workspace: WorkspaceView | null;
  readonly slos: {
    readonly targets: readonly {
      readonly id: string;
      readonly metric: string;
      readonly target: number;
      readonly unit: string;
      readonly window: string;
    }[];
    readonly measured: { readonly available: false; readonly reason: string };
  };
  readonly safety: {
    readonly killScope: string;
    readonly shadowStart: true;
    readonly neverAutonomous: readonly string[];
    readonly t3Rules: readonly { readonly capabilityId: string; readonly rule: string }[];
    readonly independentOversight: string;
  };
}

const unavailable = { available: false, reason: ENGINE_TABLES_NOTE } as const;

const OVERSIGHT: Readonly<Record<AgentCharter["agentTier"], string>> = {
  executive: "Reports to the sheriff. Every T3 decision needs the sheriff with a passkey.",
  department: "Supervised by the executive agent; reviewed by the independent audit agent.",
  assurance: "Reports only to the sheriff. Read-only: it verifies and cannot act.",
};

export function buildWorkspaceView(code: string): WorkspaceView | null {
  const ws = WORKFORCE_WORKSPACES.find((w) => w.packCode === code);
  if (!ws) return null;
  return {
    scopes: ws.scopes.map((sc) => ({
      resource: sc.resource,
      access: ACCESS_LABELS[sc.access],
      rowRule: ROW_SCOPE_LABELS[sc.rowScope],
      rowScope: sc.rowScope,
      sensitivity: sc.sensitivity,
      purpose: sc.purpose,
      grantMaxMinutes: sc.grantMaxMinutes ?? null,
    })),
    reachesOrganizationRows: ws.scopes.some(
      (sc) => sc.rowScope === "tenant_with_grant" || sc.rowScope === "tenant_flagged",
    ),
    boundaries: ws.boundaries,
    workbench: ws.ui,
  };
}

export function buildAgentDashboard(code: string): AgentDashboard | null {
  const entry = workforceEntries().find((e) => e.pack.code === code);
  if (!entry) return null;
  const { pack, charter } = entry;
  const suites = new Map(charter.evalSuites.map((s) => [s.capabilityId, s] as const));
  const capabilities: CapabilityRow[] = pack.capabilities.map((c) => ({
    id: c.id,
    title: c.title,
    tier: c.tier,
    autonomy: AUTONOMY_LABELS[c.autonomy],
    duty: DUTY_LABELS[charter.duties[c.id] ?? "observe"],
    connector: c.connector ?? null,
    approver: c.approver ?? null,
    permission: c.requiresPermission,
    approvalAction: ACTION_MAP[c.id] ?? null,
    t3Rule: charter.t3Rules[c.id] ?? null,
    evalSuite: suites.get(c.id)?.suiteId ?? null,
    evalBar: suites.get(c.id)?.minPassRate ?? null,
  }));
  return {
    code: pack.code,
    codename: charter.codename,
    title: pack.title,
    binding: BOUND_CODES.has(pack.code) ? "bound" : "definition_only",
    panels: charter.dashboardPanels,
    charter: {
      mission: charter.mission,
      tier: TIER_TITLES[charter.agentTier],
      accountable: charter.accountable,
      supervisor: charter.supervisor,
      reviewCadenceDays: charter.review.cadenceDays,
      reviewer: charter.review.reviewer,
      packVersion: pack.version,
    },
    context: {
      domains: pack.memory.domains,
      maxSensitivity: pack.memory.maxSensitivity,
      retentionDays: pack.memory.retentionDays,
      modelPurposes: charter.modelPolicy.purposes,
      contextCeiling: charter.modelPolicy.contextCeiling,
      seesCustomerContent: charter.modelPolicy.seesCustomerContent,
      crossTenant: false,
    },
    permissions: { granted: pack.permissions, capabilities },
    autonomy: {
      current: "shadow",
      note: "Every agent starts in shadow and earns autonomy from evaluations. The pack is a ceiling, never a grant.",
      ceilingByCapability: pack.capabilities.map((c) => ({
        id: c.id,
        ceiling: AUTONOMY_LABELS[c.autonomy],
      })),
    },
    budget: {
      dailyActions: pack.budget.dailyActions,
      dailyModelCalls: pack.budget.dailyModelCalls,
      dailyCostCapMinor: pack.budget.dailyCostCapMinor,
      used: unavailable,
    },
    proposals: {
      routes: pack.capabilities
        .filter((c) => c.autonomy === "act_with_approval")
        .map((c) => ({
          capabilityId: c.id,
          approver: c.approver ?? pack.escalation.defaultApprover,
          action: ACTION_MAP[c.id] ?? null,
        })),
      recorded: unavailable,
    },
    runs: { playbooks: pack.playbooks, recorded: unavailable },
    handoffs: charter.handoffs.map((h) => ({ to: h.to, kind: h.workOrderKind, when: h.when })),
    workspace: buildWorkspaceView(pack.code),
    slos: { targets: charter.slos, measured: unavailable },
    safety: {
      killScope: charter.killScope,
      shadowStart: true,
      neverAutonomous: Object.entries(JARVIS_RISK_TIER_POLICY)
        .filter(([, tier]) => tier === "T4")
        .map(([action]) => action),
      t3Rules: Object.entries(charter.t3Rules).map(([capabilityId, rule]) => ({
        capabilityId,
        rule,
      })),
      independentOversight: OVERSIGHT[charter.agentTier],
    },
  };
}

export const WORKFORCE_CAPABILITIES = ["platform.operations.read", "platform.audit.read"] as const;

/** Operations and audit staff, and the platform owner, may see the workforce. */
export function canViewWorkforce(viewer: {
  isSuperAdmin: boolean;
  capabilities: readonly string[];
}): boolean {
  return viewer.isSuperAdmin || WORKFORCE_CAPABILITIES.some((c) => viewer.capabilities.includes(c));
}
