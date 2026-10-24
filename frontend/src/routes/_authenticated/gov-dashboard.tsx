/** Government dashboard (SHERIVS-025): aggregates only, opted-in schools, cells under 10 students suppressed. */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalPage } from "@/components/portal-shell";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/gov-dashboard")({ ssr: false, component: GovDashboard });
type Dash = { schools: number; enrolled: number; girls_pct: number; attendance_pct_30d: number; pass_rate_pct: number;
  per_school: { school: string; enrolled: number | null; attendance_pct: number | null; pass_rate_pct: number | null; suppressed: boolean }[] };

function GovDashboard() {
  const mine = useQuery({ queryKey: ["gov-viewers"], queryFn: () => rows<{ jurisdiction_id: string }>(sdb.from("gov_viewers").select("jurisdiction_id")) });
  const [j, setJ] = useState("");
  const jid = j || mine.data?.[0]?.jurisdiction_id || "";
  const d = useQuery({ queryKey: ["gov", jid], enabled: !!jid, queryFn: () => rpc<Dash>("gov_dashboard", { p_jurisdiction: jid }) });
  return (
    <PortalPage title="Education dashboard" subtitle="Only schools that chose to share appear. No student-level data is shown.">
      {(mine.data ?? []).length > 1 && <select className="mb-3 rounded-md border bg-background p-2 text-sm" value={jid} onChange={(e) => setJ(e.target.value)} aria-label="Jurisdiction">{(mine.data ?? []).map((m) => <option key={m.jurisdiction_id} value={m.jurisdiction_id}>{m.jurisdiction_id.slice(0, 8)}</option>)}</select>}
      {d.data && (<>
        <div className="grid gap-3 md:grid-cols-5">{[["Schools", d.data.schools], ["Enrolled", d.data.enrolled], ["Girls %", d.data.girls_pct], ["Attendance % (30d)", d.data.attendance_pct_30d], ["Pass rate %", d.data.pass_rate_pct]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v ?? "—"}</div></div>))}</div>
        <table className="mt-4 w-full text-sm"><thead><tr className="text-left"><th>School</th><th>Enrolled</th><th>Attendance %</th><th>Pass %</th></tr></thead>
          <tbody>{d.data.per_school.map((s) => <tr key={s.school} className="border-t"><td>{s.school}</td><td>{s.suppressed ? "<10" : s.enrolled}</td><td>{s.attendance_pct ?? "—"}</td><td>{s.pass_rate_pct ?? "—"}</td></tr>)}</tbody></table></>)}
    </PortalPage>);
}
