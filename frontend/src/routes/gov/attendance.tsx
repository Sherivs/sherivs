import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cell, govTrend } from "@/lib/gov/portal";
import { useGovJurisdiction } from "@/lib/gov/context";

export const Route = createFileRoute("/gov/attendance")({ ssr: false, component: GovAttendance });

function GovAttendance() {
  const j = useGovJurisdiction();
  const [weeks, setWeeks] = useState(12);
  const d = useQuery({ queryKey: ["gov-trend", j?.id, weeks], enabled: !!j, queryFn: () => govTrend(j!.id, weeks) });
  return (
    <section>
      <h1 className="text-xl font-semibold">Weekly attendance</h1>
      <select className="mt-3 rounded-md border bg-background p-2 text-sm" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Weeks">
        {[4, 12, 26, 52].map((w) => <option key={w} value={w}>Last {w} weeks</option>)}
      </select>
      <ul className="mt-4 space-y-1 text-sm">{(d.data ?? []).map((w) => (
        <li key={w.week} className="flex items-center gap-3"><span className="w-28 text-muted-foreground">{w.week}</span>
          <span className="h-2 rounded bg-primary" style={{ width: `${w.attendance_pct ?? 0}%`, maxWidth: "60%" }} aria-hidden />
          <span>{cell(w.attendance_pct, w.suppressed, "%")}</span></li>))}</ul>
    </section>
  );
}
