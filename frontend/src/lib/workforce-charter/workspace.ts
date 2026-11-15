/**
 * Agent Workspace v1 (ENGINE-13, ADR-091): the data an internal agent may touch, the
 * row-level rule for each resource, its hard boundaries and the screen an operator
 * gets for it.
 *
 * A workspace never grants authority by itself. It narrows it: an agent can use a
 * resource only if its workspace lists it, and a tenant's rows only under the rule the
 * workspace states. `authorizeScope` is the pure deny-by-default check the runtime (and
 * the proposed row-level-security helper) must agree with. Nothing here reads a
 * database, a clock or a secret; time is always passed in.
 */
import { z } from "zod";
import { tierRank, type MemorySensitivity, type RolePack } from "../twin-engine/role-pack";
import type { AgentCharter } from "./charter";

export const WORKSPACE_SCHEMA = "sherivs.agent-workspace.v1" as const;

/** There is deliberately no delete and no "write anything" mode. */
export const ACCESS_MODES = ["read", "write_own", "propose"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const ROW_SCOPES = [
  /** Platform-wide records that belong to no organization (runbooks, CI, incidents). */
  "platform",
  /** One row per organization, identity and plan columns only; never its content. */
  "tenant_metadata",
  /** Aggregated figures; never an individual record. */
  "aggregate",
  /** An organization's rows, only under an active, time-boxed grant for that organization. */
  "tenant_with_grant",
  /** Rows an organization itself flagged to the platform; nothing else of theirs. */
  "tenant_flagged",
  /** Rows this agent created itself. */
  "own_agent",
] as const;
export type RowScope = (typeof ROW_SCOPES)[number];

export const WORKBENCHES = ["console", "queue", "feed", "board", "ledger"] as const;
export const QUICK_ACTION_KINDS = [
  "ask_for_draft",
  "view_runs",
  "review_proposals",
  "pause_agent",
] as const;

const SENSITIVITY_RANK: Readonly<Record<MemorySensitivity, number>> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

const slug = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-z0-9_-]*$/);

/** Resources every agent has, whatever else its workspace lists. */
export const BASE_RESOURCES = ["agent_runs", "agent_memory", "agent_proposals"] as const;

export const workspaceSchema = z
  .object({
    schema: z.literal(WORKSPACE_SCHEMA),
    packCode: z.string().min(2).max(80),
    scopes: z
      .array(
        z
          .object({
            resource: slug,
            access: z.enum(ACCESS_MODES),
            rowScope: z.enum(ROW_SCOPES),
            sensitivity: z.enum(["public", "internal", "restricted"]),
            purpose: z.string().min(8).max(120),
            /** Required for, and only allowed on, `tenant_with_grant`. */
            grantMaxMinutes: z.number().int().min(1).max(240).optional(),
          })
          .strict(),
      )
      .min(BASE_RESOURCES.length)
      .max(24),
    boundaries: z.array(z.string().min(20).max(200)).min(3).max(8),
    ui: z
      .object({
        workbench: z.enum(WORKBENCHES),
        headline: z.string().min(8).max(80),
        queues: z
          .array(z.object({ id: slug, title: z.string().min(3).max(60), source: slug }).strict())
          .max(4),
        quickActions: z
          .array(
            z
              .object({
                id: slug,
                label: z.string().min(3).max(60),
                kind: z.enum(QUICK_ACTION_KINDS),
              })
              .strict(),
          )
          .min(2)
          .max(6),
        emptyState: z.string().min(10).max(140),
      })
      .strict(),
  })
  .strict();

export type AgentWorkspace = z.infer<typeof workspaceSchema>;
export type WorkspaceScope = AgentWorkspace["scopes"][number];

/** Every problem found, in a stable order. Empty means the workspace is sound for this agent. */
export function validateWorkspace(
  candidate: unknown,
  pack: RolePack,
  charter: AgentCharter,
): readonly string[] {
  const parsed = workspaceSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const ws = parsed.data;
  const problems: string[] = [];
  const at = `${pack.code}:`;

  if (ws.packCode !== pack.code) problems.push(`${at} workspace names ${ws.packCode}`);
  if (charter.packCode !== pack.code) problems.push(`${at} charter names ${charter.packCode}`);

  const seen = new Set<string>();
  for (const s of ws.scopes) {
    if (seen.has(s.resource)) problems.push(`${at} duplicate resource ${s.resource}`);
    seen.add(s.resource);
  }
  for (const base of BASE_RESOURCES) {
    if (!seen.has(base)) problems.push(`${at} missing base resource ${base}`);
  }

  const ceiling = Math.min(
    SENSITIVITY_RANK[pack.memory.maxSensitivity],
    SENSITIVITY_RANK[charter.modelPolicy.contextCeiling],
  );
  for (const s of ws.scopes) {
    const where = `${at} ${s.resource}:`;
    if (SENSITIVITY_RANK[s.sensitivity] > ceiling) {
      problems.push(`${where} ${s.sensitivity} data is above the agent's context ceiling`);
    }
    if (s.access === "write_own" && s.rowScope !== "own_agent") {
      problems.push(`${where} write_own is only allowed on own_agent rows`);
    }
    if (s.access === "propose" && s.rowScope !== "own_agent") {
      problems.push(`${where} propose is only allowed on own_agent rows`);
    }
    if (s.rowScope === "tenant_with_grant" && s.grantMaxMinutes === undefined) {
      problems.push(`${where} tenant_with_grant needs grantMaxMinutes`);
    }
    if (s.rowScope !== "tenant_with_grant" && s.grantMaxMinutes !== undefined) {
      problems.push(`${where} grantMaxMinutes is only allowed on tenant_with_grant`);
    }
    if (
      (s.rowScope === "tenant_with_grant" || s.rowScope === "tenant_flagged") &&
      !charter.modelPolicy.seesCustomerContent
    ) {
      problems.push(
        `${where} reads organization rows but the charter says it sees no customer content`,
      );
    }
    if (s.rowScope === "tenant_with_grant" || s.rowScope === "tenant_flagged") {
      if (s.access !== "read") problems.push(`${where} organization rows are read-only`);
    }
    if (s.rowScope === "tenant_metadata" || s.rowScope === "aggregate") {
      if (s.access !== "read") problems.push(`${where} ${s.rowScope} is read-only`);
      if (s.sensitivity === "restricted")
        problems.push(`${where} ${s.rowScope} cannot be restricted`);
    }
  }

  if (charter.agentTier === "assurance") {
    for (const s of ws.scopes) {
      if (s.rowScope === "tenant_with_grant" || s.rowScope === "tenant_flagged") {
        problems.push(`${at} ${s.resource}: assurance agents never read organization rows`);
      }
      if (s.resource === "work_orders") {
        problems.push(`${at} assurance agents do not create work orders`);
      }
    }
  }

  const hasTenantRows = ws.scopes.some(
    (s) => s.rowScope === "tenant_with_grant" || s.rowScope === "tenant_flagged",
  );
  if (!hasTenantRows) {
    const hasBoundary = ws.boundaries.some((b) =>
      /organization'?s? (content|data|records)/i.test(b),
    );
    if (!hasBoundary && pack.kind === "platform_role") {
      // Agents with no tenant-row scope must say so: it is the most important boundary.
      problems.push(`${at} boundaries must state that organization content is never read`);
    }
  }

  for (const b of ws.boundaries) {
    if (!/^Never /.test(b))
      problems.push(`${at} boundary must start with "Never": ${b.slice(0, 40)}`);
  }

  const readable = new Set(ws.scopes.map((s) => s.resource));
  const queueIds = new Set<string>();
  for (const q of ws.ui.queues) {
    if (queueIds.has(q.id)) problems.push(`${at} duplicate queue ${q.id}`);
    queueIds.add(q.id);
    if (!readable.has(q.source))
      problems.push(`${at} queue ${q.id} reads ${q.source}, not in scopes`);
  }
  const kinds = new Set(ws.ui.quickActions.map((a) => a.kind));
  for (const must of ["review_proposals", "pause_agent"] as const) {
    if (!kinds.has(must)) problems.push(`${at} quick actions must include ${must}`);
  }
  const actionIds = new Set<string>();
  for (const a of ws.ui.quickActions) {
    if (actionIds.has(a.id)) problems.push(`${at} duplicate quick action ${a.id}`);
    actionIds.add(a.id);
  }

  // A pack with a T3 capability must be reviewable: its proposals resource is mandatory
  // and must be proposal-only, which the base-resource check covers; guard the access mode.
  const proposals = ws.scopes.find((s) => s.resource === "agent_proposals");
  if (proposals && proposals.access !== "propose") {
    problems.push(`${at} agent_proposals must be propose access`);
  }
  if (pack.capabilities.some((c) => tierRank(c.tier) >= tierRank("T3")) && !proposals) {
    problems.push(`${at} T3 capability without a proposals resource`);
  }

  return problems;
}

export interface WorkspaceEntry {
  readonly workspace: AgentWorkspace;
  readonly pack: RolePack;
  readonly charter: AgentCharter;
}

/** One workspace per agent, none left over, and each one sound. */
export function validateWorkspaces(
  workspaces: readonly AgentWorkspace[],
  entries: readonly { readonly pack: RolePack; readonly charter: AgentCharter }[],
): readonly string[] {
  const problems: string[] = [];
  const byCode = new Map<string, AgentWorkspace>();
  for (const w of workspaces) {
    if (byCode.has(w.packCode)) problems.push(`duplicate workspace for ${w.packCode}`);
    byCode.set(w.packCode, w);
  }
  const codes = new Set(entries.map((e) => e.pack.code));
  for (const code of byCode.keys()) {
    if (!codes.has(code)) problems.push(`workspace for unknown agent ${code}`);
  }
  for (const e of entries) {
    const w = byCode.get(e.pack.code);
    if (!w) {
      problems.push(`${e.pack.code}: no workspace`);
      continue;
    }
    problems.push(...validateWorkspace(w, e.pack, e.charter));
  }
  return problems;
}

export interface ScopeGrant {
  readonly tenantId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revoked: boolean;
}

export interface ScopeRequest {
  /** The agent asking. */
  readonly agentCode: string;
  readonly resource: string;
  readonly access: AccessMode;
  /** Organization the rows belong to, when the resource holds organization rows. */
  readonly tenantId?: string;
  /** The agent that created the rows, when asking for own_agent rows. */
  readonly rowOwner?: string;
  /** True when the request is for one individual's record rather than aggregates. */
  readonly individualRecord?: boolean;
  /** True when the organization itself flagged the rows to the platform. */
  readonly flaggedByTenant?: boolean;
  readonly grant?: ScopeGrant;
  readonly now: Date;
}

export type ScopeDecision =
  | { readonly allowed: true; readonly rowScope: RowScope }
  | { readonly allowed: false; readonly reason: string };

const deny = (reason: string): ScopeDecision => ({ allowed: false, reason });

/** Deny by default. Every allow names the row scope the caller must then apply. */
export function authorizeScope(workspace: AgentWorkspace, req: ScopeRequest): ScopeDecision {
  if (req.agentCode !== workspace.packCode) return deny("wrong_agent");
  const scope = workspace.scopes.find((s) => s.resource === req.resource);
  if (!scope) return deny("unknown_resource");
  if (scope.access !== req.access) return deny("access_not_granted");

  switch (scope.rowScope) {
    case "platform":
      return { allowed: true, rowScope: "platform" };
    case "tenant_metadata":
    case "aggregate":
      if (req.individualRecord) return deny("individual_record_not_allowed");
      return { allowed: true, rowScope: scope.rowScope };
    case "own_agent":
      if (req.rowOwner !== workspace.packCode) return deny("not_own_row");
      return { allowed: true, rowScope: "own_agent" };
    case "tenant_flagged":
      if (!req.tenantId) return deny("tenant_required");
      if (req.flaggedByTenant !== true) return deny("not_flagged_by_tenant");
      return { allowed: true, rowScope: "tenant_flagged" };
    case "tenant_with_grant": {
      if (!req.tenantId) return deny("tenant_required");
      const g = req.grant;
      if (!g) return deny("grant_required");
      if (g.revoked) return deny("grant_revoked");
      if (g.tenantId !== req.tenantId) return deny("grant_for_other_tenant");
      if (g.expiresAt.getTime() <= req.now.getTime()) return deny("grant_expired");
      if (g.issuedAt.getTime() > req.now.getTime()) return deny("grant_not_yet_active");
      const minutes = (g.expiresAt.getTime() - g.issuedAt.getTime()) / 60000;
      if (scope.grantMaxMinutes === undefined || minutes > scope.grantMaxMinutes) {
        return deny("grant_too_long");
      }
      return { allowed: true, rowScope: "tenant_with_grant" };
    }
  }
}
