import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cell, govOverview } from "@/lib/gov/portal";
import { useGovJurisdiction } from "@/lib/gov/context";

export const Route = createFileRoute("/gov/schools")({ ssr: false, component: GovSchools });

function GovSchools() {
  const j = useGovJurisdiction();
  const d = useQuery({ queryKey: ["gov-ov", j?.id, ""], enabled: !!j, queryFn: () => govOverview(j!.id) });
  return (
    <section>
      <h1 className="text-xl font-semibold">Schools sharing data</h1>
      <p className="text-sm text-muted-foreground">Schools with fewer than 10 students show no figures.</p>
      <table className="mt-4 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>School</th><th>LGA</th><th>Ownership</th><th>Enrolled</th><th>Girls</th><th>Attendance</th><th>Pass rate</th></tr></thead>
        <tbody>{(d.data?.per_school ?? []).map((s) => (
          <tr key={s.school} className="border-t"><td>{s.school}</td><td>{s.lga}</td><td className="capitalize">{s.ownership}</td>
            <td>{cell(s.enrolled, s.suppressed)}</td><td>{cell(s.girls_pct, s.suppressed, "%")}</td><td>{cell(s.attendance_pct, s.suppressed, "%")}</td><td>{cell(s.pass_rate_pct, s.suppressed, "%")}</td></tr>))}</tbody></table>
    </section>
  );
}
