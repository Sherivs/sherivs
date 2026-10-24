import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { cell, govOverview } from "@/lib/gov/portal";
import { useGovJurisdiction } from "@/lib/gov/context";

export const Route = createFileRoute("/gov/")({ ssr: false, component: GovOverviewPage });

function GovOverviewPage() {
  const j = useGovJurisdiction();
  const [year, setYear] = useState("");
  const d = useQuery({ queryKey: ["gov-ov", j?.id, year], enabled: !!j, queryFn: () => govOverview(j!.id, year) });
  const o = d.data;
  return (
    <section>
      <h1 className="text-xl font-semibold">{j?.name} overview</h1>
      <p className="text-sm text-muted-foreground">Schools that chose to share. Aggregates only; groups under 10 students are hidden.</p>
      <Input className="mt-3 max-w-xs" placeholder="Session, e.g. 2025/2026 (optional)" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Session" />
      {d.error && <p className="mt-3 text-sm text-destructive">{(d.error as Error).message}</p>}
      {o && (<>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {([["Schools sharing", String(o.schools)], ["Enrolled", cell(o.enrolled, o.suppressed)], ["Girls", cell(o.girls_pct, o.suppressed, "%")],
            ["Attendance (30 days)", cell(o.attendance_pct_30d, o.suppressed, "%")], ["Pass rate", cell(o.pass_rate_pct, o.suppressed, "%")]] as const).map(([k, v]) => (
            <div key={k} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v}</div></div>))}
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {([["By ownership", o.by_ownership.map((g) => ({ k: g.ownership, ...g }))], ["By LGA", o.by_lga.map((g) => ({ k: g.lga, ...g }))]] as const).map(([title, groups]) => (
            <div key={title}><h2 className="font-medium">{title}</h2>
              <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Group</th><th>Schools</th><th>Enrolled</th><th>Attendance</th></tr></thead>
                <tbody>{groups.map((g) => <tr key={g.k} className="border-t"><td className="capitalize">{g.k}</td><td>{g.schools}</td><td>{cell(g.enrolled, g.suppressed)}</td><td>{cell(g.attendance_pct, g.suppressed, "%")}</td></tr>)}</tbody></table></div>))}
        </div></>)}
    </section>
  );
}
