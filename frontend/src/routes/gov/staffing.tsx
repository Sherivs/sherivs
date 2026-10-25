import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useGovJurisdiction } from "@/lib/gov/context";
import { govStaffing, ptrBand } from "@/lib/gov/deployment";

export const Route = createFileRoute("/gov/staffing")({ ssr: false, component: GovStaffing });

function GovStaffing() {
  const j = useGovJurisdiction();
  const q = useQuery({ queryKey: ["gov-staffing", j?.id], enabled: !!j, queryFn: () => govStaffing(j!.id) });
  return (
    <section>
      <h1 className="text-xl font-semibold">Staffing</h1>
      <p className="text-sm text-muted-foreground">Teachers and pupil-teacher ratio (PTR) for schools sharing with {j?.name}. Schools with fewer than 10 learners are hidden.</p>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th>School</th><th>LGA</th><th>Learners</th><th>Teachers</th><th>PTR</th></tr></thead>
        <tbody>
          {(q.data ?? []).map((r) => {
            const b = ptrBand(r);
            return (
              <tr key={r.school_id} className="border-t">
                <td>{r.school}</td><td>{r.lga ?? "—"}</td>
                <td>{r.suppressed ? "<10" : r.learners}</td><td>{r.suppressed ? "—" : r.teachers}</td>
                <td className={b === "critical" ? "text-destructive font-medium" : b === "high" ? "text-amber-600" : ""}>{r.suppressed || r.ptr === null ? "—" : `${r.ptr}:1`}</td>
              </tr>);
          })}
        </tbody>
      </table>
    </section>
  );
}
