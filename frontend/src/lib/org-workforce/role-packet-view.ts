/**
 * Role packet view and change planner (ENGINE-19, ADR-097).
 *
 * A role comes with a packet: permissions it always carries (mandatory), permissions an
 * organization may switch on or off (optional), the guardrails that bound it, and the roles
 * it must never be combined with. An organization shapes the packet to how it really works;
 * this module turns the server's `role_context` answer into a view, and turns what the
 * administrator wants into the exact server calls, refusing what the server would refuse and
 * asking for confirmation on anything sensitive.
 *
 * It decides nothing the database does not also enforce: the server functions
 * `role_set_optional` and `role_add_custom_grant` check the caller, refuse changes to a role
 * the caller holds, and write the audit trail. This only avoids sending calls that would
 * fail, and keeps the person informed about why.
 *
 * Pure: no I/O.
 */
export type Sensitivity = "public" | "internal" | "confidential" | "restricted" | string;

export interface PacketPermission {
  readonly code: string;
  readonly module: string;
  readonly label: string;
  readonly sensitivity: Sensitivity;
  readonly protected: boolean;
  readonly defaultOn: boolean | null;
  readonly enabled: boolean;
}

export interface PacketView {
  readonly role: {
    readonly code: string;
    readonly name: string;
    readonly category: string;
    readonly template: string;
    readonly custom: boolean;
    readonly baseRole: string | null;
  };
  readonly scope: string | null;
  readonly dataSensitivity: string | null;
  readonly approvalLimitNgn: number | null;
  readonly guardrails: readonly { readonly code: string; readonly description: string }[];
  readonly mandatory: readonly PacketPermission[];
  readonly optional: readonly PacketPermission[];
  readonly customGrants: readonly {
    readonly id: string;
    readonly permission: string;
    readonly customKey: string | null;
  }[];
  readonly conflictingTemplates: readonly string[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function permission(raw: unknown, optional: boolean): PacketPermission | null {
  const o = obj(raw);
  const code = o ? str(o.code) : null;
  if (!o || !code) return null;
  const defaultOn = optional && typeof o.default_on === "boolean" ? o.default_on : null;
  return {
    code,
    module: str(o.module) ?? "",
    label: str(o.label) ?? code,
    sensitivity: str(o.sensitivity) ?? "internal",
    protected: o.protected === true,
    defaultOn,
    enabled: optional ? (typeof o.enabled === "boolean" ? o.enabled : (defaultOn ?? false)) : true,
  };
}

/** Parse the server's `role_context` answer. Anything that is not the expected shape is null. */
export function parseRoleContext(raw: unknown): PacketView | null {
  const o = obj(raw);
  const role = o ? obj(o.role) : null;
  if (!o || !role) return null;
  const code = str(role.code);
  const template = str(role.template);
  if (!code || !template) return null;
  return {
    role: {
      code,
      name: str(role.name) ?? code,
      category: str(role.category) ?? "",
      template,
      custom: role.custom === true,
      baseRole: str(role.base_role),
    },
    scope: str(o.scope),
    dataSensitivity: str(o.data_sensitivity),
    approvalLimitNgn: typeof o.approval_limit_ngn === "number" ? o.approval_limit_ngn : null,
    guardrails: arr(o.guardrails).flatMap((g) => {
      const x = obj(g);
      const c = x ? str(x.code) : null;
      return x && c ? [{ code: c, description: str(x.description) ?? "" }] : [];
    }),
    mandatory: arr(o.mandatory).flatMap((p) => permission(p, false) ?? []),
    optional: arr(o.optional).flatMap((p) => permission(p, true) ?? []),
    customGrants: arr(o.custom_grants).flatMap((g) => {
      const x = obj(g);
      const id = x ? str(x.id) : null;
      const perm = x ? str(x.permission) : null;
      return x && id && perm ? [{ id, permission: perm, customKey: str(x.custom_key) }] : [];
    }),
    conflictingTemplates: arr(o.sod_conflicts).flatMap((t) => str(t) ?? []),
  };
}

/** Permissions that need an explicit confirmation before they are switched on. */
export const needsConfirmation = (
  p: Pick<PacketPermission, "protected" | "sensitivity">,
): boolean => p.protected || p.sensitivity === "restricted";

export type BlockReason =
  "not_in_packet" | "mandatory" | "you_hold_this_role" | "already_granted" | "not_in_catalog";

export interface PlannedCall {
  readonly rpc: "role_set_optional" | "role_add_custom_grant" | "role_remove_custom_grant";
  readonly args: Readonly<Record<string, unknown>>;
}

export interface PacketPlan {
  readonly calls: readonly PlannedCall[];
  readonly blocked: readonly { readonly code: string; readonly reason: BlockReason }[];
  /** Sensitive switches the person must confirm before they go through. */
  readonly awaitingConfirmation: readonly string[];
}

export const BLOCK_TEXT: Readonly<Record<BlockReason, string>> = {
  not_in_packet: "This permission is not part of this role's packet.",
  mandatory: "This permission always comes with the role and cannot be switched off.",
  you_hold_this_role:
    "You hold this role, so you cannot change its permissions. Ask another administrator.",
  already_granted: "This permission is already granted to the role.",
  not_in_catalog: "This permission is not in the permission catalog.",
};

/**
 * Turn the wanted optional permissions into server calls. `desired` maps optional permission
 * codes to the wanted state; codes already in that state are skipped. `confirmed` holds the
 * sensitive codes the person has explicitly confirmed.
 */
export function planOptionalChanges(input: {
  readonly orgId: string;
  readonly view: PacketView;
  readonly desired: Readonly<Record<string, boolean>>;
  readonly confirmed?: readonly string[];
  readonly callerHoldsRole: boolean;
}): PacketPlan {
  const calls: PlannedCall[] = [];
  const blocked: { code: string; reason: BlockReason }[] = [];
  const awaiting: string[] = [];
  const confirmed = new Set(input.confirmed ?? []);
  const optional = new Map(input.view.optional.map((p) => [p.code, p] as const));
  const mandatory = new Set(input.view.mandatory.map((p) => p.code));
  for (const code of Object.keys(input.desired).sort()) {
    const want = input.desired[code]!;
    if (mandatory.has(code)) {
      blocked.push({ code, reason: "mandatory" });
      continue;
    }
    const current = optional.get(code);
    if (!current) {
      blocked.push({ code, reason: "not_in_packet" });
      continue;
    }
    if (input.callerHoldsRole) {
      blocked.push({ code, reason: "you_hold_this_role" });
      continue;
    }
    if (current.enabled === want) continue;
    if (want && needsConfirmation(current) && !confirmed.has(code)) {
      awaiting.push(code);
      continue;
    }
    calls.push({
      rpc: "role_set_optional",
      args: {
        p_org: input.orgId,
        p_role: input.view.role.code,
        p_permission: code,
        p_enabled: want,
      },
    });
  }
  return { calls, blocked, awaitingConfirmation: awaiting };
}

/** Plan a custom grant: a catalog permission the packet does not already carry. */
export function planCustomGrant(input: {
  readonly orgId: string;
  readonly view: PacketView;
  readonly permission: string;
  readonly catalog: readonly Pick<PacketPermission, "code" | "protected" | "sensitivity">[];
  readonly confirmed?: readonly string[];
  readonly callerHoldsRole: boolean;
  readonly customKey?: string;
}): PacketPlan {
  const code = input.permission;
  const entry = input.catalog.find((p) => p.code === code);
  const block = (reason: BlockReason): PacketPlan => ({
    calls: [],
    blocked: [{ code, reason }],
    awaitingConfirmation: [],
  });
  if (!entry) return block("not_in_catalog");
  if (input.callerHoldsRole) return block("you_hold_this_role");
  const carried =
    input.view.mandatory.some((p) => p.code === code) ||
    input.view.optional.some((p) => p.code === code && p.enabled) ||
    input.view.customGrants.some((g) => g.permission === code);
  if (carried) return block("already_granted");
  if (needsConfirmation(entry) && !(input.confirmed ?? []).includes(code)) {
    return { calls: [], blocked: [], awaitingConfirmation: [code] };
  }
  return {
    calls: [
      {
        rpc: "role_add_custom_grant",
        args: {
          p_org: input.orgId,
          p_role: input.view.role.code,
          p_permission: code,
          ...(input.customKey ? { p_custom_key: input.customKey } : {}),
        },
      },
    ],
    blocked: [],
    awaitingConfirmation: [],
  };
}

export function planRemoveCustomGrant(
  view: PacketView,
  grantId: string,
  callerHoldsRole: boolean,
): PacketPlan {
  const g = view.customGrants.find((x) => x.id === grantId);
  if (!g)
    return {
      calls: [],
      blocked: [{ code: grantId, reason: "not_in_packet" }],
      awaitingConfirmation: [],
    };
  if (callerHoldsRole)
    return {
      calls: [],
      blocked: [{ code: g.permission, reason: "you_hold_this_role" }],
      awaitingConfirmation: [],
    };
  return {
    calls: [{ rpc: "role_remove_custom_grant", args: { p_grant: grantId } }],
    blocked: [],
    awaitingConfirmation: [],
  };
}
