/**
 * Admin roles & permissions (SHERIVS-017).
 * Pick any catalog role (572 Nigerian education roles) and its full context pops up:
 * locked MANDATORY permissions and guardrails (enforced in the database, never editable),
 * OPTIONAL permissions with per-organisation toggles, custom permissions/context, and
 * custom roles that inherit the base role's guardrails. People can hold several roles;
 * separation-of-duty conflicts are refused by the database. Every change is audited.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { NG_ROLES, NG_ROLE_CATALOG_STATS } from "@/lib/scholar/roles/ng-role-catalog.generated";

export const Route = createFileRoute("/_authenticated/admin/roles")({ ssr: false, component: RolesPage });

type Perm = { code: string; module: string; label: string; sensitivity: string; protected: boolean; enabled?: boolean; default_on?: boolean };
type RoleContext = {
  role: { code: string; name: string; category: string; template: string; custom: boolean; base_role: string | null; institution_types: string[] };
  scope: string; data_sensitivity: string; approval_limit_ngn: number | null;
  guardrails: { code: string; description: string }[];
  mandatory: Perm[]; optional: Perm[];
  custom_grants: { id: string; permission: string | null; custom_key: string | null; context: Record<string, unknown> }[];
  sod_conflicts: string[];
};
type RpcResult = { data: unknown; error: { message: string } | null };
type LooseClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;
  from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => Promise<RpcResult> } };
};
const db = supabase as unknown as LooseClient;
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
const naira = (v: number | null) => (v == null ? "No approval authority" : "₦" + Number(v).toLocaleString("en-NG"));

function RolesPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [roleCode, setRoleCode] = useState<string>("ng.principal");
  const [customKey, setCustomKey] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [assignee, setAssignee] = useState("");
  const [scopeRef, setScopeRef] = useState("");

  const customRoles = useQuery({
    queryKey: ["custom-roles", org],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await db.from("role_catalog").select("code,name,category,base_role_code").eq("org_id", org);
      if (error) throw new Error(error.message);
      return (data ?? []) as { code: string; name: string; category: string }[];
    },
  });
  const staff = useQuery({
    queryKey: ["role-staff", org],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await db.from("users").select("id,full_name,role").eq("school_id", org);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string; role: string }[];
    },
  });
  const allRoles = useMemo(() => [...NG_ROLES.map((r) => ({ code: r.code, name: r.name, category: r.category })), ...(customRoles.data ?? [])], [customRoles.data]);
  const categories = useMemo(() => ["All", ...Array.from(new Set(allRoles.map((r) => r.category)))], [allRoles]);
  const visible = allRoles.filter((r) => (category === "All" || r.category === category) && r.name.toLowerCase().includes(search.toLowerCase()));

  const ctx = useQuery({
    queryKey: ["role-context", org, roleCode],
    enabled: !!org && !!roleCode,
    queryFn: () => rpc<RoleContext | null>("role_context", { p_org: org, p_role: roleCode }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["role-context", org, roleCode] });
  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await refresh(); await qc.invalidateQueries({ queryKey: ["custom-roles", org] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  const c = ctx.data;

  return (
    <PortalPage title="Roles & permissions" subtitle={`${NG_ROLE_CATALOG_STATS.roles} Nigerian education roles · mandatory guardrails are locked by the database`}>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2 rounded-lg border p-3">
          <select className="w-full rounded-md border bg-background p-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Role category">
            {categories.map((x) => <option key={x}>{x}</option>)}
          </select>
          <Input placeholder="Search roles" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="h-80 w-full rounded-md border bg-background p-1 text-sm" size={14} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} aria-label="Role">
            {visible.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </div>

        {c && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <h2 className="text-lg font-semibold">{c.role.name}</h2>
              <p className="text-sm text-muted-foreground">{c.role.category}{c.role.custom ? ` · custom role based on ${c.role.base_role}` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">Scope: {c.scope}</Badge>
                <Badge variant="secondary">Data: up to {c.data_sensitivity}</Badge>
                <Badge variant="secondary">Approval limit: {naira(c.approval_limit_ngn)}</Badge>
                {c.sod_conflicts.length > 0 && <Badge variant="destructive">Cannot be combined with: {c.sod_conflicts.join(", ")}</Badge>}
              </div>
            </div>

            <section className="rounded-lg border p-4">
              <h3 className="mb-2 font-medium">Mandatory permissions (locked)</h3>
              <ul className="grid gap-1 sm:grid-cols-2">
                {c.mandatory.map((p) => (
                  <li key={p.code} className="flex items-center gap-2 text-sm"><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />{p.label}{p.protected && <Badge variant="outline">protected</Badge>}</li>
                ))}
              </ul>
              <h3 className="mb-2 mt-4 font-medium">Guardrails (enforced in the database)</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">{c.guardrails.map((g) => <li key={g.code}>• {g.description}</li>)}</ul>
            </section>

            <section className="rounded-lg border p-4">
              <h3 className="mb-2 font-medium">Optional permissions for this organisation</h3>
              <ul className="space-y-2">
                {c.optional.map((p) => (
                  <li key={p.code} className="flex items-center justify-between gap-3 text-sm">
                    <span>{p.label} <span className="text-xs text-muted-foreground">({p.module}{p.protected ? ", protected" : ""})</span></span>
                    <Switch checked={!!p.enabled} onCheckedChange={(v) => act("role_set_optional", { p_org: org, p_role: c.role.code, p_permission: p.code, p_enabled: v }, "Permission updated")} aria-label={p.label} />
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border p-4 space-y-2">
              <h3 className="font-medium">Custom permissions & context</h3>
              {c.custom_grants.map((g) => (
                <div key={g.id} className="flex items-center justify-between text-sm">
                  <span>{g.custom_key ?? g.permission} {g.context && Object.keys(g.context).length > 0 ? `· ${JSON.stringify(g.context)}` : ""}</span>
                  <Button size="sm" variant="ghost" onClick={() => act("role_remove_custom_grant", { p_grant: g.id }, "Removed")}>Remove</Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-xs" placeholder="custom.lab_duty" value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
                <Input className="max-w-xs" placeholder="Context note" value={customNote} onChange={(e) => setCustomNote(e.target.value)} />
                <Button size="sm" disabled={!customKey} onClick={() => act("role_add_custom_grant", { p_org: org, p_role: c.role.code, p_permission: null, p_custom_key: customKey, p_context: customNote ? { note: customNote } : {} }, "Custom permission added")}>Add</Button>
              </div>
              <p className="text-xs text-muted-foreground">Protected permissions cannot be added here. Assign a second role that carries them.</p>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="font-medium">Create a custom role from this one</h3>
                <Input placeholder="e.g. Head of Robotics Club" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} />
                <Button size="sm" disabled={newRoleName.trim().length < 3} onClick={() => act("role_create_custom", { p_org: org, p_base_role: c.role.code, p_name: newRoleName }, "Custom role created (inherits all mandatory guardrails)")}>Create</Button>
              </div>
              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="font-medium">Assign to a person</h3>
                <select className="w-full rounded-md border bg-background p-2 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Person">
                  <option value="">Select a person</option>
                  {(staff.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
                </select>
                {c.scope !== "org" && c.scope !== "self" && <Input placeholder={`${c.scope} id`} value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} />}
                <Button size="sm" disabled={!assignee} onClick={() => act("role_assign", { p_org: org, p_user: assignee, p_role: c.role.code, p_scope_type: c.scope, p_scope_ref: scopeRef || null }, "Role assigned")}>Assign</Button>
                <p className="text-xs text-muted-foreground">People can hold several roles. Conflicting roles and self-assignment are refused.</p>
              </div>
            </section>
          </div>
        )}
      </div>
    </PortalPage>
  );
}
