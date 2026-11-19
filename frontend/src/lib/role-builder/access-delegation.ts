/**
 * Access-review campaigns and delegation / acting roles (mission M4, ADR-121): schemas, ports and
 * handlers. Writes go through the existing M13 and M009 database functions with the caller's JWT;
 * the database audits every one (`role_access_review_audit_events`, `role_assignment_audit_events`).
 */
import { z } from "zod";
import { RoleBuilderError, mapDatabaseError, parseInput, uuidLike } from "./role-builder-core";
import { resolveCaller, type CallerContext, type UserClient } from "./role-builder-port";

const DAY_MS = 86_400_000;
export const MAX_CAMPAIGN_DAYS = 365;
export const MAX_DELEGATION_DAYS = 366;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface ReviewItem {
  id: string;
  campaignId: string;
  userId: string;
  userName: string;
  roleCode: string;
  roleName: string;
  status: "pending" | "retained" | "revoked" | "already_ended";
  decidedBy: string | null;
  decidedAt: string | null;
}
export interface ReviewCampaign {
  id: string;
  title: string;
  status: "open" | "completed";
  dueAt: string;
  createdAt: string;
  completedAt: string | null;
  items: ReviewItem[];
  auditCount: number;
}
export interface AssignmentRow {
  id: string;
  userId: string;
  userName: string;
  roleCode: string;
  roleName: string;
  startedAt: string;
  validUntil: string | null;
}
export interface DelegationRow {
  id: string;
  assignmentId: string;
  delegateUserId: string;
  delegateName: string;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
}
export interface ActingContextRow {
  kind: "delegated" | "acting";
  recordId: string;
  roleCode: string;
  roleName: string;
  holderName: string | null;
  validFrom: string;
  validUntil: string | null;
}

export interface AccessPort {
  caller(): Promise<CallerContext & { canManageRoles: boolean }>;
  listCampaigns(orgId: string): Promise<ReviewCampaign[]>;
  startCampaign(orgId: string, title: string, dueAt: string): Promise<string>;
  decide(itemId: string, decision: "retain" | "revoke"): Promise<string>;
  listAssignments(orgId: string): Promise<AssignmentRow[]>;
  listDelegations(orgId: string): Promise<DelegationRow[]>;
  members(orgId: string): Promise<{ id: string; name: string }[]>;
  grantDelegation(input: DelegationInput): Promise<string>;
  revokeDelegation(id: string): Promise<void>;
  myActingContext(): Promise<ActingContextRow[]>;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const isoDateTime = z.string().datetime({ offset: true });
export const campaignInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  dueAt: isoDateTime,
});
export const decisionInputSchema = z.object({
  itemId: uuidLike,
  decision: z.enum(["retain", "revoke"]),
});
export const delegationInputSchema = z
  .object({
    assignmentId: uuidLike,
    delegateUserId: uuidLike,
    validFrom: isoDateTime,
    validUntil: isoDateTime,
  })
  .refine((d) => Date.parse(d.validUntil) > Date.parse(d.validFrom), {
    message: "the end must be after the start",
    path: ["validUntil"],
  });
export type DelegationInput = z.infer<typeof delegationInputSchema>;
export const delegationIdSchema = z.object({ id: uuidLike });

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function requireRoleManager(port: AccessPort) {
  const caller = await port.caller();
  if (!caller.userId) throw new RoleBuilderError("UNAUTHENTICATED", "Sign in again.");
  if (!caller.orgId) throw new RoleBuilderError("NO_ORGANIZATION", "Choose an organization first.");
  if (!caller.canManageRoles)
    throw new RoleBuilderError(
      "FORBIDDEN",
      "Managing access needs roles.assign in this organization.",
    );
  return { ...caller, orgId: caller.orgId };
}

export async function handleListCampaigns(port: AccessPort) {
  const caller = await requireRoleManager(port);
  return { campaigns: await port.listCampaigns(caller.orgId), me: caller.userId };
}

export async function handleStartCampaign(port: AccessPort, input: unknown, nowMs: number) {
  const { title, dueAt } = parseInput(campaignInputSchema, input);
  const due = Date.parse(dueAt);
  if (due <= nowMs) throw new RoleBuilderError("VALIDATION", "The due date must be in the future.");
  if (due > nowMs + MAX_CAMPAIGN_DAYS * DAY_MS)
    throw new RoleBuilderError("VALIDATION", "A campaign is due within a year.");
  const caller = await requireRoleManager(port);
  return { id: await port.startCampaign(caller.orgId, title, dueAt) };
}

export async function handleDecide(port: AccessPort, input: unknown) {
  const { itemId, decision } = parseInput(decisionInputSchema, input);
  const caller = await requireRoleManager(port);
  const item = (await port.listCampaigns(caller.orgId))
    .flatMap((c) => c.items)
    .find((i) => i.id === itemId);
  if (!item) throw new RoleBuilderError("NOT_FOUND", "That review item does not exist here.");
  if (item.userId === caller.userId)
    throw new RoleBuilderError(
      "SELF_GRANT",
      "no_self_role_grant: another reviewer decides your own access.",
    );
  if (item.status !== "pending")
    throw new RoleBuilderError("CONFLICT", "That item has already been decided.");
  return { result: await port.decide(itemId, decision) };
}

export async function handleListDelegations(port: AccessPort) {
  const caller = await requireRoleManager(port);
  const [assignments, delegations, members] = await Promise.all([
    port.listAssignments(caller.orgId),
    port.listDelegations(caller.orgId),
    port.members(caller.orgId),
  ]);
  return { assignments, delegations, members, me: caller.userId };
}

export async function handleGrantDelegation(port: AccessPort, input: unknown, nowMs: number) {
  const delegation = parseInput(delegationInputSchema, input);
  const caller = await requireRoleManager(port);
  const assignment = (await port.listAssignments(caller.orgId)).find(
    (a) => a.id === delegation.assignmentId,
  );
  if (!assignment)
    throw new RoleBuilderError("NOT_FOUND", "That assignment is not active in this organization.");
  if (
    delegation.delegateUserId === assignment.userId ||
    delegation.delegateUserId === caller.userId
  )
    throw new RoleBuilderError(
      "SELF_GRANT",
      "no_self_role_grant: delegate to another member, not the holder or yourself.",
    );
  const from = Date.parse(delegation.validFrom);
  const until = Date.parse(delegation.validUntil);
  if (until <= nowMs)
    throw new RoleBuilderError("VALIDATION", "The delegation must end in the future.");
  if (from < Date.parse(assignment.startedAt))
    throw new RoleBuilderError(
      "DELEGATION_EXCEEDS_SOURCE",
      "A delegation cannot start before the source assignment.",
    );
  if (assignment.validUntil && until > Date.parse(assignment.validUntil))
    throw new RoleBuilderError(
      "DELEGATION_EXCEEDS_SOURCE",
      `A delegation cannot end after the source assignment (${assignment.validUntil}).`,
    );
  if (until - from > MAX_DELEGATION_DAYS * DAY_MS)
    throw new RoleBuilderError("VALIDATION", "A delegation lasts at most a year.");
  return { id: await port.grantDelegation(delegation) };
}

export async function handleRevokeDelegation(port: AccessPort, input: unknown) {
  const { id } = parseInput(delegationIdSchema, input);
  await requireRoleManager(port);
  await port.revokeDelegation(id);
}

/** For the shell banner: any signed-in member, own rows only (the database filters). */
export async function handleMyActingContext(port: AccessPort): Promise<ActingContextRow[]> {
  return port.myActingContext();
}

// ---------------------------------------------------------------------------
// Supabase implementation (user JWT)
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);

async function read(
  query: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
) {
  const result = await query;
  if (result.error) throw mapDatabaseError(result.error);
  return Array.isArray(result.data)
    ? result.data.filter((r): r is Row => typeof r === "object" && r !== null)
    : [];
}

export function supabaseAccessPort(client: UserClient, userId: string): AccessPort {
  async function call(name: string, args?: Record<string, unknown>) {
    const result = await client.rpc(name, args);
    if (result.error) throw mapDatabaseError(result.error);
    return result.data;
  }
  async function names(orgId: string) {
    const [users, roles] = await Promise.all([
      read(client.from("users").select("id,full_name").eq("school_id", orgId)),
      read(client.from("role_catalog").select("code,name")),
    ]);
    return {
      user: new Map(users.map((u) => [str(u.id), str(u.full_name) || "Member"])),
      role: new Map(roles.map((r) => [str(r.code), str(r.name)])),
    };
  }
  return {
    async caller() {
      const base = await resolveCaller(client, userId);
      const canManageRoles = base.orgId
        ? (await call("can_manage_roles", { p_org: base.orgId, p_perm: "roles.assign" })) === true
        : false;
      return { ...base, canManageRoles };
    },
    async listCampaigns(orgId) {
      const [campaigns, items, audit, lookup] = await Promise.all([
        read(
          client
            .from("role_access_review_campaigns")
            .select("id,title,status,due_at,created_at,completed_at")
            .eq("org_id", orgId)
            .order("created_at", { ascending: false }),
        ),
        read(
          client
            .from("role_access_review_items")
            .select("id,campaign_id,user_id,role_code,status,decided_by,decided_at")
            .eq("org_id", orgId),
        ),
        read(
          client.from("role_access_review_audit_events").select("campaign_id").eq("org_id", orgId),
        ),
        names(orgId),
      ]);
      return campaigns.map((c) => ({
        id: str(c.id),
        title: str(c.title),
        status: str(c.status) === "completed" ? "completed" : "open",
        dueAt: str(c.due_at),
        createdAt: str(c.created_at),
        completedAt: strOrNull(c.completed_at),
        auditCount: audit.filter((a) => a.campaign_id === c.id).length,
        items: items
          .filter((i) => i.campaign_id === c.id)
          .map((i) => ({
            id: str(i.id),
            campaignId: str(i.campaign_id),
            userId: str(i.user_id),
            userName: lookup.user.get(str(i.user_id)) ?? "Member",
            roleCode: str(i.role_code),
            roleName: lookup.role.get(str(i.role_code)) ?? str(i.role_code),
            status: str(i.status) as ReviewItem["status"],
            decidedBy: strOrNull(i.decided_by),
            decidedAt: strOrNull(i.decided_at),
          })),
      }));
    },
    async startCampaign(orgId, title, dueAt) {
      return str(
        await call("workspace_access_review_campaign_create", {
          p_org: orgId,
          p_title: title,
          p_due_at: dueAt,
        }),
      );
    },
    async decide(itemId, decision) {
      return str(
        await call("workspace_access_review_decide", { p_item_id: itemId, p_decision: decision }),
      );
    },
    async listAssignments(orgId) {
      const [assignments, lookup] = await Promise.all([
        read(
          client
            .from("user_role_assignments")
            .select("id,user_id,role_code,started_at,valid_until,status")
            .eq("org_id", orgId)
            .eq("status", "active"),
        ),
        names(orgId),
      ]);
      return assignments.map((a) => ({
        id: str(a.id),
        userId: str(a.user_id),
        userName: lookup.user.get(str(a.user_id)) ?? "Member",
        roleCode: str(a.role_code),
        roleName: lookup.role.get(str(a.role_code)) ?? str(a.role_code),
        startedAt: str(a.started_at),
        validUntil: strOrNull(a.valid_until),
      }));
    },
    async listDelegations(orgId) {
      const [delegations, lookup] = await Promise.all([
        read(
          client
            .from("role_assignment_delegations")
            .select("id,assignment_id,delegate_user_id,valid_from,valid_until,revoked_at")
            .eq("org_id", orgId)
            .order("created_at", { ascending: false }),
        ),
        names(orgId),
      ]);
      return delegations.map((d) => ({
        id: str(d.id),
        assignmentId: str(d.assignment_id),
        delegateUserId: str(d.delegate_user_id),
        delegateName: lookup.user.get(str(d.delegate_user_id)) ?? "Member",
        validFrom: str(d.valid_from),
        validUntil: str(d.valid_until),
        revokedAt: strOrNull(d.revoked_at),
      }));
    },
    async members(orgId) {
      const users = await read(
        client
          .from("users")
          .select("id,full_name,is_active")
          .eq("school_id", orgId)
          .eq("is_active", true),
      );
      return users.map((u) => ({ id: str(u.id), name: str(u.full_name) || "Member" }));
    },
    async grantDelegation(input) {
      return str(
        await call("workspace_role_delegate", {
          p_assignment: input.assignmentId,
          p_delegate_user: input.delegateUserId,
          p_valid_from: input.validFrom,
          p_valid_until: input.validUntil,
        }),
      );
    },
    async revokeDelegation(id) {
      await call("workspace_role_delegation_revoke", { p_delegation: id });
    },
    async myActingContext() {
      const data = await call("workspace_my_acting_context");
      return (Array.isArray(data) ? (data as Row[]) : []).map((r) => ({
        kind: str(r.kind) === "acting" ? "acting" : "delegated",
        recordId: str(r.record_id),
        roleCode: str(r.role_code),
        roleName: str(r.role_name),
        holderName: strOrNull(r.holder_name),
        validFrom: str(r.valid_from),
        validUntil: strOrNull(r.valid_until),
      }));
    },
  };
}
