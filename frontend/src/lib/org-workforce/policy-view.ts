/**
 * Workspace policy and module view (ENGINE-19, ADR-097).
 *
 * Organizations switch workspace policies and modules on and off to match how they work.
 * This parses the server's `workspace_policy_list` answer and plans the server calls
 * (`workspace_policy_set`, `workspace_feature_set`); the database checks the caller and
 * refuses unknown keys. Pure: no I/O.
 */
export interface PolicyRow {
  readonly key: string;
  readonly label: string;
  readonly defaultOn: boolean;
  readonly enabled: boolean;
}
export interface ModuleRow {
  readonly key: string;
  readonly enabled: boolean;
}
export interface PolicyView {
  readonly policies: readonly PolicyRow[];
  readonly modules: readonly ModuleRow[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;

export function parsePolicyList(raw: unknown): PolicyView | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.policies)) return null;
  const policies = o.policies.flatMap((p): PolicyRow[] => {
    const x = obj(p);
    if (!x || typeof x.key !== "string") return [];
    const defaultOn = x.default === true;
    return [
      {
        key: x.key,
        label: typeof x.label === "string" ? x.label : x.key,
        defaultOn,
        enabled: typeof x.enabled === "boolean" ? x.enabled : defaultOn,
      },
    ];
  });
  const modules = (Array.isArray(o.modules) ? o.modules : []).flatMap((m): ModuleRow[] => {
    const x = obj(m);
    return x && typeof x.key === "string" ? [{ key: x.key, enabled: x.enabled !== false }] : [];
  });
  return { policies, modules };
}

export interface PolicyCall {
  readonly rpc: "workspace_policy_set" | "workspace_feature_set";
  readonly args: Readonly<Record<string, unknown>>;
}

export function planPolicyChanges(input: {
  readonly orgId: string;
  readonly view: PolicyView;
  readonly policies?: Readonly<Record<string, boolean>>;
  readonly modules?: Readonly<Record<string, boolean>>;
}): { readonly calls: readonly PolicyCall[]; readonly unknown: readonly string[] } {
  const calls: PolicyCall[] = [];
  const unknown: string[] = [];
  const pol = new Map(input.view.policies.map((p) => [p.key, p] as const));
  const mod = new Map(input.view.modules.map((m) => [m.key, m] as const));
  for (const key of Object.keys(input.policies ?? {}).sort()) {
    const cur = pol.get(key);
    if (!cur) {
      unknown.push(key);
      continue;
    }
    const want = input.policies![key]!;
    if (cur.enabled !== want) {
      calls.push({
        rpc: "workspace_policy_set",
        args: { p_org: input.orgId, p_policy: key, p_enabled: want },
      });
    }
  }
  for (const key of Object.keys(input.modules ?? {}).sort()) {
    const cur = mod.get(key);
    if (!cur) {
      unknown.push(key);
      continue;
    }
    const want = input.modules![key]!;
    if (cur.enabled !== want) {
      calls.push({
        rpc: "workspace_feature_set",
        args: { p_org: input.orgId, p_feature: key, p_enabled: want },
      });
    }
  }
  return { calls, unknown };
}
