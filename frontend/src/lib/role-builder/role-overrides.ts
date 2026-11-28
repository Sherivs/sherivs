/**
 * Tenant role overrides (M2c, ADR-161): schemas, port and handlers for proposing, approving and ending an override.
 * Every write goes through the database functions of migration 20261128000400 with the caller's own session. The database
 * decides who may act, enforces four-eyes, the guardrails and separation of duties, and writes the audit trail; this module
 * checks the shape first so the person gets a plain message, and keeps the permission cache honest.
 */
import { z } from "zod";
import { RoleBuilderError, mapDatabaseError, parseInput, uuidLike } from "./role-builder-core";
import { resolveCaller, type CallerContext, type UserClient } from "./role-builder-port";
import {
  EffectivePermissionCache,
  type EffectivePermission,
  type JsonValue,
  type PermissionSource,
} from "./effective-permission-cache";

export const OVERRIDE_KINDS = [
  "rename",
  "enable",
  "disable",
  "add_optional_permission",
  "remove_optional_permission",
  "scope_narrow",
  "approval_limit",
  "add_responsibility",
] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/** Scopes an override may narrow a role to, widest first. The database compares the rank against the template default. */
export const NARROWING_SCOPES = ["campus", "faculty", "department", "class", "self"] as const;

const code = z.string().regex(/^[a-z][a-z0-9_.:-]{1,80}$/, "Use a permission or template code");
const template = z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/, "Choose a role template");

const payloadByKind = {
  rename: z.object({ name: z.string().trim().min(2).max(120) }).strict(),
  enable: z.object({}).strict(),
  disable: z.object({ reason: z.string().trim().min(1).max(240).optional() }).strict(),
  add_optional_permission: z.object({ permission: code }).strict(),
  remove_optional_permission: z.object({ permission: code }).strict(),
  scope_narrow: z.object({ scope: z.enum(NARROWING_SCOPES) }).strict(),
  approval_limit: z
    .object({ limit_ngn: z.number().finite().min(0).max(1_000_000_000_000) })
    .strict(),
  add_responsibility: z.object({ responsibility: code }).strict(),
} as const;

export const overrideInputSchema = z
  .object({
    template,
    kind: z.enum(OVERRIDE_KINDS),
    payload: z.record(z.string(), z.unknown()).default({}),
    effectiveTo: z.string().datetime().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const parsed = payloadByKind[value.kind].safeParse(value.payload);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: parsed.error.issues[0]?.message ?? "Check the details for this kind of override",
      });
    }
    if (value.effectiveTo && new Date(value.effectiveTo).getTime() <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "The end time must be in the future",
      });
    }
  });
export type OverrideInput = z.infer<typeof overrideInputSchema>;
export const overrideIdSchema = z.object({ id: uuidLike });

export type OverrideState = "pending" | "in_force" | "scheduled" | "ended";

export interface OverrideRow {
  id: string;
  template: string;
  kind: OverrideKind;
  payload: Record<string, JsonValue>;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  state: OverrideState;
}

export interface OverridesView {
  caller: CallerContext;
  rows: OverrideRow[];
}

/** The state shown to people. Ended wins over everything; an unapproved override has no effect until a second person approves. */
export function overrideState(
  row: { approvedBy: string | null; effectiveFrom: string; effectiveTo: string | null },
  nowMs: number,
): OverrideState {
  if (row.effectiveTo && new Date(row.effectiveTo).getTime() <= nowMs) return "ended";
  if (!row.approvedBy) return "pending";
  return new Date(row.effectiveFrom).getTime() > nowMs ? "scheduled" : "in_force";
}

/** One plain sentence for a row: what it changes. No code names the person has to know. */
export function describeOverride(kind: OverrideKind, payload: Record<string, JsonValue>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (kind) {
    case "rename":
      return `Rename the role to "${s(payload.name)}"`;
    case "enable":
      return "Turn the role back on";
    case "disable":
      return payload.reason ? `Turn the role off: ${s(payload.reason)}` : "Turn the role off";
    case "add_optional_permission":
      return `Add the optional permission ${s(payload.permission)}`;
    case "remove_optional_permission":
      return `Remove the optional permission ${s(payload.permission)}`;
    case "scope_narrow":
      return `Narrow the role to ${s(payload.scope)} scope`;
    case "approval_limit": {
      const n = typeof payload.limit_ngn === "number" ? payload.limit_ngn : 0;
      return `Lower the approval limit to ₦${n.toLocaleString("en-NG")}`;
    }
    case "add_responsibility":
      return `Add the responsibility ${s(payload.responsibility)}`;
  }
}

export interface OverridePort {
  caller(): Promise<CallerContext>;
  list(orgId: string): Promise<OverrideRow[]>;
  create(input: OverrideInput): Promise<string>;
  approve(id: string): Promise<void>;
  end(id: string): Promise<void>;
}

function need(caller: CallerContext): string {
  if (!caller.orgId) throw new RoleBuilderError("FORBIDDEN", "You are not in an organization.");
  if (!caller.isAdmin)
    throw new RoleBuilderError("FORBIDDEN", "Only an administrator can manage role overrides.");
  return caller.orgId;
}

export async function handleListOverrides(
  port: OverridePort,
  nowMs: number,
): Promise<OverridesView> {
  const caller = await port.caller();
  if (!caller.orgId || !caller.isAdmin) return { caller, rows: [] };
  const rows = await port.list(caller.orgId);
  return { caller, rows: rows.map((r) => ({ ...r, state: overrideState(r, nowMs) })) };
}

export async function handleCreateOverride(
  port: OverridePort,
  cache: EffectivePermissionCache,
  input: OverrideInput,
): Promise<{ id: string }> {
  const orgId = need(await port.caller());
  const id = await port.create(input);
  cache.invalidateOrg(orgId);
  return { id };
}

export async function handleApproveOverride(
  port: OverridePort,
  cache: EffectivePermissionCache,
  id: string,
): Promise<{ ok: true }> {
  const caller = await port.caller();
  const orgId = need(caller);
  await port.approve(id);
  cache.invalidateOrg(orgId);
  return { ok: true };
}

export async function handleEndOverride(
  port: OverridePort,
  cache: EffectivePermissionCache,
  id: string,
): Promise<{ ok: true }> {
  const orgId = need(await port.caller());
  await port.end(id);
  cache.invalidateOrg(orgId);
  return { ok: true };
}

/** The caller's effective permissions, from the cache when it is still good. Any signed-in member may read their own. */
export async function handleMyEffectivePermissions(
  port: Pick<OverridePort, "caller">,
  source: (orgId: string) => PermissionSource,
  cache: EffectivePermissionCache,
): Promise<{ permissions: readonly EffectivePermission[]; fromCache: boolean }> {
  const caller = await port.caller();
  if (!caller.orgId) return { permissions: [], fromCache: false };
  const result = await cache.get(caller.orgId, caller.userId, source(caller.orgId));
  return { permissions: result.permissions, fromCache: result.fromCache };
}

// ---------------------------------------------------------------------------
// Supabase implementation (caller's JWT only)
// ---------------------------------------------------------------------------
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);

async function call(client: UserClient, name: string, args?: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw mapDatabaseError(result.error);
  return result.data;
}

export function supabaseOverridePort(client: UserClient, userId: string): OverridePort {
  return {
    caller: () => resolveCaller(client, userId),
    async list(orgId) {
      const result = await client
        .from("tenant_role_overrides")
        .select(
          "id,template_code,override_kind,payload,effective_from,effective_to,created_by,approved_by,approved_at,created_at",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (result.error) throw mapDatabaseError(result.error);
      const data = Array.isArray(result.data) ? result.data : [];
      return data
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          id: str(r.id),
          template: str(r.template_code),
          kind: str(r.override_kind) as OverrideKind,
          payload:
            typeof r.payload === "object" && r.payload !== null
              ? (r.payload as Record<string, JsonValue>)
              : {},
          effectiveFrom: str(r.effective_from),
          effectiveTo: strOrNull(r.effective_to),
          createdBy: str(r.created_by),
          approvedBy: strOrNull(r.approved_by),
          approvedAt: strOrNull(r.approved_at),
          createdAt: str(r.created_at),
          state: "pending" as OverrideState,
        }));
    },
    async create(input) {
      const id = await call(client, "role_override_create", {
        p_template: input.template,
        p_kind: input.kind,
        p_payload: input.payload,
        p_effective_to: input.effectiveTo,
      });
      if (typeof id !== "string")
        throw new RoleBuilderError("UNKNOWN", "The override was not created.");
      return id;
    },
    async approve(id) {
      await call(client, "role_override_approve", { p_id: id });
    },
    async end(id) {
      await call(client, "role_override_end", { p_id: id });
    },
  };
}

/** Reads the epoch and the effective permissions for the signed-in caller. */
export function supabasePermissionSource(client: UserClient, orgId: string): PermissionSource {
  return {
    async epoch() {
      const value = await call(client, "role_override_epoch");
      return typeof value === "string" ? value : "";
    },
    async load() {
      const data = await call(client, "effective_permissions", { p_org: orgId });
      const list = Array.isArray(data) ? data : [];
      return list
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          permissionCode: str(r.permission_code),
          kind: str(r.kind),
          roleCodes: Array.isArray(r.role_codes) ? r.role_codes.map(String) : [],
          scopes: (r.scopes ?? null) as JsonValue,
        }));
    },
  };
}

export const parseOverrideInput = (input: unknown) => parseInput(overrideInputSchema, input);
export const parseOverrideId = (input: unknown) => parseInput(overrideIdSchema, input);
