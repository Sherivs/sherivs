/** Safeguards (SHERIVS-B04): consent coverage, break-glass reviews, delegations, and the shadow access report. */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";
import { CONSENT_PURPOSES, DELEGABLE_SUGGESTIONS, delegationWindowOk, type BreakGlass, type Delegation } from "@/lib/safeguards";

export const Route = createFileRoute("/_authenticated/admin/safeguards")({ ssr: false, component: SafeguardsPage });
type Overview = Record<string, { granted: number; withdrawn: number; not_asked: number }>;
type Shadow = { checks: number; agree: number; new_stricter: number; new_looser: number; by_layer: Record<string, number> } | null;

function SafeguardsPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const consent = useQuery({ queryKey: ["sg-consent"], queryFn: () => rpc<Overview>("consent_overview") });
  const bg = useQuery({ queryKey: ["sg-bg"], queryFn: () => rpc<BreakGlass[]>("break_glass_list") });
  const del = useQuery({ queryKey: ["sg-del"], queryFn: () => rpc<Delegation[]>("delegations_mine") });
  const shadow = useQuery({ queryKey: ["sg-shadow", org], enabled: !!org, queryFn: () => rpc<Shadow>("authz_shadow_report", { p_org: org }) });
  const staff = useQuery({ queryKey: ["sg-staff", org], enabled: !!org, queryFn: () => rows<{ id: string; full_name: string; role: string }>(sdb.from("users").select("id,full_name,role").eq("school_id", org).limit(2000)).then((r) => r.filter((u) => u.role !== "parent" && u.role !== "student")) });
  const [note, setNote] = useState<Record<string, string>>({});
  const [d, setD] = useState({ delegate: "", perms: "", days: "7", reason: "" });
  const go = async (fn: string, args: Record<string, unknown>, ok: string, key: string) => {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries({ queryKey: [key] }); } catch (e) { toast.error((e as Error).message); }
  };
  const start = new Date(); const end = new Date(start.getTime() + Number(d.days || 0) * 86_400_000);
  const perms = d.perms.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <PortalPage title="Safeguards" subtitle="Consent, emergency access reviews and temporary delegation. Reviews and delegations need MFA.">
      <h2 className="mt-2 font-semibold">Consent coverage</h2>
      <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Purpose</th><th>Allowed</th><th>Withdrawn</th><th>Not answered</th></tr></thead>
        <tbody>{CONSENT_PURPOSES.map(([k, l]) => <tr key={k} className="border-t"><td>{l}</td><td>{consent.data?.[k]?.granted ?? "—"}</td><td>{consent.data?.[k]?.withdrawn ?? "—"}</td><td>{consent.data?.[k]?.not_asked ?? "—"}</td></tr>)}</tbody></table>

      <h2 className="mt-6 font-semibold">Break-glass access</h2>
      <ul className="mt-2 space-y-2">
        {(bg.data ?? []).map((g) => (
          <li key={g.id} className="rounded-lg border p-3 text-sm">
            <div className="font-medium">{g.opened_by} → {g.student} · {g.opened_at.slice(0, 16).replace("T", " ")} · {g.state}{g.overdue ? " · review overdue (72h)" : ""}</div>
            <p className="text-muted-foreground">{g.reason}</p>
            {g.state === "reviewed" ? <p>Review: {g.review_outcome} — {g.review_note}</p> : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Input className="flex-1" placeholder="Review note (at least 10 characters)" value={note[g.id] ?? ""} onChange={(e) => setNote({ ...note, [g.id]: e.target.value })} />
                <Button size="sm" onClick={() => go("break_glass_review", { p_id: g.id, p_outcome: "justified", p_note: note[g.id] ?? "" }, "Marked justified", "sg-bg")}>Justified</Button>
                <Button size="sm" variant="destructive" onClick={() => go("break_glass_review", { p_id: g.id, p_outcome: "unjustified", p_note: note[g.id] ?? "" }, "Marked unjustified", "sg-bg")}>Unjustified</Button>
              </div>)}
          </li>))}
      </ul>

      <h2 className="mt-6 font-semibold">Delegation (acting-up, at most 30 days)</h2>
      <div className="mt-2 flex flex-wrap gap-2 rounded-lg border p-3">
        <select className="rounded-md border bg-background p-2 text-sm" aria-label="Delegate" value={d.delegate} onChange={(e) => setD({ ...d, delegate: e.target.value })}>
          <option value="">Choose a staff member</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}</select>
        <Input className="flex-1" list="sg-perms" placeholder="Permissions, comma separated (e.g. fees.view)" value={d.perms} onChange={(e) => setD({ ...d, perms: e.target.value })} />
        <datalist id="sg-perms">{DELEGABLE_SUGGESTIONS.map((p) => <option key={p} value={p} />)}</datalist>
        <Input className="max-w-24" type="number" min={1} max={30} aria-label="Days" value={d.days} onChange={(e) => setD({ ...d, days: e.target.value })} />
        <Input className="flex-1" placeholder="Reason (at least 10 characters)" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
        <Button disabled={!d.delegate || perms.length === 0 || d.reason.trim().length < 10 || !delegationWindowOk(start, end, start)}
          onClick={() => go("delegation_grant", { p_delegate: d.delegate, p_permissions: perms, p_ends_at: end.toISOString(), p_reason: d.reason }, "Delegation created", "sg-del")}>Delegate</Button>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {(del.data ?? []).map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-1">
            <span>{x.delegator} → {x.delegate}: {x.permissions.join(", ")} · until {x.ends_at.slice(0, 10)} · {x.state}</span>
            {(x.state === "active" || x.state === "scheduled") && <Button size="sm" variant="ghost" onClick={() => go("delegation_revoke", { p_id: x.id }, "Delegation ended", "sg-del")}>End now</Button>}
          </li>))}
      </ul>

      {shadow.data && (<>
        <h2 className="mt-6 font-semibold">New access model (shadow, last 7 days)</h2>
        <p className="text-sm text-muted-foreground">The new layered check runs beside the live one and only logs. Live access is unchanged.</p>
        <p className="mt-1 text-sm">{shadow.data.agree}/{shadow.data.checks} agree · stricter {shadow.data.new_stricter} · looser {shadow.data.new_looser}
          {Object.keys(shadow.data.by_layer ?? {}).length ? ` · disagreements by layer: ${Object.entries(shadow.data.by_layer).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}</p>
      </>)}
    </PortalPage>
  );
}
