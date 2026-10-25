import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import { canManage, groupLabelFromHost, groupOverview, groupSession, type GroupSession } from "@/lib/group/console";

export const Route = createFileRoute("/group/")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ g: typeof s.g === "string" ? s.g : undefined }),
  component: GroupConsole,
});

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function GroupConsole() {
  const { g } = Route.useSearch();
  const label = groupLabelFromHost(typeof window === "undefined" ? null : window.location.host) ?? g ?? null;
  const sess = useQuery({ queryKey: ["group-sess", label], enabled: !!label, queryFn: () => groupSession(label!) });
  const s = sess.data;
  if (!label) return <main className="p-6">Open your group console at console.&lt;your-group&gt;.sherivs.com.</main>;
  if (!s) return <main className="p-6">Loading…</main>;
  if (s.status === "unknown") return <main className="p-6">This school group does not exist.</main>;
  if (s.status === "no_access") return <main className="p-6">You are not a member of this school group. <Link to="/login" className="underline">Sign in</Link> with the account the owner added.</main>;
  if (s.status === "mfa_required") return <main className="p-6">{s.group}: verify with your authenticator app (MFA) to open the group console. <Link to="/login" className="underline">Verify</Link></main>;
  return <GroupOverviewPage s={s} />;
}

function GroupOverviewPage({ s }: { s: GroupSession }) {
  const qc = useQueryClient();
  const ov = useQuery({ queryKey: ["group-ov", s.group_id], queryFn: () => groupOverview(s.group_id!) });
  const adm = useQuery({ queryKey: ["group-adm", s.group_id], enabled: canManage(s.role),
    queryFn: () => rpc<{ admins: { user_id: string; email: string; role: string }[]; pending: { id: string; school: string }[] }>("group_admins_list", { p_group: s.group_id }) });
  const [school, setSchool] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: string, args: Record<string, unknown>) => {
    setMsg(null);
    try { await rpc(fn, args); await qc.invalidateQueries(); } catch (e) { setMsg((e as Error).message); }
  };
  const o = ov.data;
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">{s.group}</h1>
      <p className="text-sm text-muted-foreground">Group console · you are {s.role}. Figures are totals only; schools with fewer than 10 learners are hidden.</p>
      {msg && <p className="mt-2 text-sm text-destructive" role="alert">{msg}</p>}
      {o && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["Schools", o.schools], ["Learners", o.enrolled ?? "—"], ["Teachers", o.teachers ?? "—"], ["Attendance (30d)", pct(o.attendance_pct_30d)], ["Pass rate", pct(o.pass_rate_pct)]].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold">{v}</div></div>))}
          </div>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>School</th><th>Learners</th><th>Teachers</th><th>PTR</th><th>Attendance</th><th>Pass rate</th>{s.role === "owner" && <th />}</tr></thead>
            <tbody>{o.per_school.map((p) => (
              <tr key={p.school_id} className="border-t">
                <td>{p.school}</td><td>{p.suppressed ? "<10" : p.enrolled}</td><td>{p.teachers ?? "—"}</td><td>{p.ptr === null ? "—" : `${p.ptr}:1`}</td>
                <td>{pct(p.attendance_pct)}</td><td>{pct(p.pass_rate_pct)}</td>
                {s.role === "owner" && <td><Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${p.school} from the group?`)) void act("group_school_leave", { p_school: p.school_id }); }}>Remove</Button></td>}
              </tr>))}</tbody>
          </table>
        </>
      )}
      {canManage(s.role) && (
        <section className="mt-6 rounded-lg border p-3">
          <h2 className="font-medium">Invite a school</h2>
          <p className="text-sm text-muted-foreground">The school's own admin must accept (with MFA) under Admin → School group.</p>
          <div className="mt-2 flex gap-2">
            <Input placeholder="School ID" value={school} onChange={(e) => setSchool(e.target.value)} />
            <Button disabled={!/^[0-9a-f-]{36}$/i.test(school.trim())} onClick={() => void act("group_join_request", { p_group: s.group_id, p_school: school.trim() }).then(() => setSchool(""))}>Send request</Button>
          </div>
          {(adm.data?.pending ?? []).length > 0 && <p className="mt-2 text-sm">Waiting for: {adm.data!.pending.map((p) => p.school).join(", ")}</p>}
          <h2 className="mt-4 font-medium">Group staff</h2>
          <ul className="mt-1 text-sm">{(adm.data?.admins ?? []).map((a) => (
            <li key={a.user_id} className="flex justify-between gap-2"><span>{a.email} · {a.role}</span>
              {s.role === "owner" && a.role !== "owner" && <button className="text-destructive underline" onClick={() => void act("group_admin_set", { p_group: s.group_id, p_user: a.user_id, p_role: null })}>Remove</button>}
            </li>))}</ul>
        </section>
      )}
    </main>
  );
}
