/** Institution heads (SHERIVS-B01): admins grant/revoke head roles (MFA required, never to self). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";
import { HEAD_ROLE_LABELS } from "@/lib/head-console/host";

export const Route = createFileRoute("/_authenticated/admin/heads")({ ssr: false, component: HeadsPage });
type Head = { id: string; user_id: string; head_role: string; unit_ref: string | null; ends_at: string | null; revoked_at: string | null };
type Member = { id: string; full_name: string | null; role: string };

function HeadsPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [user, setUser] = useState(""); const [role, setRole] = useState("principal"); const [unit, setUnit] = useState(""); const [ends, setEnds] = useState("");
  const heads = useQuery({ queryKey: ["heads", org], enabled: !!org, queryFn: () => rows<Head>(sdb.from("institution_heads").select("*").eq("school_id", org)) });
  const members = useQuery({ queryKey: ["head-members", org], enabled: !!org, queryFn: () => rows<Member>(sdb.from("users").select("id,full_name,role").eq("school_id", org).limit(1000)) });
  const name = (id: string) => members.data?.find((m) => m.id === id)?.full_name ?? id.slice(0, 8);
  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries({ queryKey: ["heads", org] }); } catch (e) { toast.error((e as Error).message); }
  }
  const sel = "rounded-md border bg-background p-2 text-sm";
  const consoleUrl = school ? `https://console.${(school as { slug?: string }).slug ?? ""}.sherivs.com` : "";
  return (
    <PortalPage title="Institution heads" subtitle={`Heads use their normal account in the app, and also open the head console at ${consoleUrl} with MFA.`}>
      <div className="flex flex-wrap gap-2 rounded-lg border p-3">
        <select className={sel} value={user} onChange={(e) => setUser(e.target.value)} aria-label="Person"><option value="">Choose a person</option>
          {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name ?? m.id.slice(0, 8)} ({m.role})</option>)}</select>
        <select className={sel} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Head role">
          {Object.entries(HEAD_ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <Input className="max-w-48" placeholder="Unit (faculty/department)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <Input className="max-w-48" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} aria-label="Ends on (optional)" />
        <Button disabled={!user} onClick={() => go("head_role_grant", { p_user: user, p_role: role, p_unit: unit || null, p_ends_at: ends ? new Date(ends).toISOString() : null }, "Head role granted")}>Grant</Button>
      </div>
      <table className="mt-4 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Person</th><th>Role</th><th>Unit</th><th>Ends</th><th /></tr></thead>
        <tbody>{(heads.data ?? []).filter((h) => !h.revoked_at).map((h) => (
          <tr key={h.id} className="border-t"><td>{name(h.user_id)}</td><td>{HEAD_ROLE_LABELS[h.head_role] ?? h.head_role}</td><td>{h.unit_ref ?? ""}</td><td>{h.ends_at?.slice(0, 10) ?? ""}</td>
            <td><Button size="sm" variant="outline" onClick={() => go("head_role_revoke", { p_id: h.id }, "Revoked")}>Revoke</Button></td></tr>))}</tbody></table>
    </PortalPage>
  );
}
