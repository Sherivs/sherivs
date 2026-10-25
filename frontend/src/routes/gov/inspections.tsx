import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import { useGovJurisdiction } from "@/lib/gov/context";
import { INSPECTION_DOMAINS, averageScore, canDo, govInspections, validScores, type Inspection } from "@/lib/gov/modules";

export const Route = createFileRoute("/gov/inspections")({ ssr: false, component: GovInspections });

function GovInspections() {
  const j = useGovJurisdiction();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["gov-insp", j?.id], enabled: !!j, queryFn: () => govInspections(j!.id) });
  const ov = useQuery({ queryKey: ["gov-schools", j?.id], enabled: !!j, queryFn: () => rpc<{ id: string; school: string }[]>("gov_sharing_schools", { p_jurisdiction: j!.id }) });
  const role = (j as { agency_role?: string | null } | null)?.agency_role ?? null;
  const [school, setSchool] = useState(""); const [date, setDate] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number | undefined>>({}); const [summary, setSummary] = useState(""); const [recs, setRecs] = useState(""); const [due, setDue] = useState("");
  const schools = ov.data ?? [];
  const act = async (fn: string, args: Record<string, unknown>) => {
    setMsg(null);
    try { await rpc(fn, args); await qc.invalidateQueries({ queryKey: ["gov-insp", j?.id] }); return true; } catch (e) { setMsg((e as Error).message); return false; }
  };
  return (
    <section>
      <h1 className="text-xl font-semibold">Inspections</h1>
      <p className="text-sm text-muted-foreground">Schools that share with {j?.name}. Reports are final once recorded; schools can reply once.</p>
      {msg && <p className="mt-2 text-sm text-destructive" role="alert">{msg}</p>}
      {canDo(role, "inspect") && (
        <div className="mt-3 flex flex-wrap gap-2 rounded-lg border p-3">
          {schools.length > 0 ? (
            <select className="rounded-md border bg-background p-2 text-sm" aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)}>
              <option value="">Choose a school</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.school}</option>)}</select>
          ) : <Input className="max-w-72" placeholder="School ID" aria-label="School ID" value={school} onChange={(e) => setSchool(e.target.value)} />}
          <Input type="date" className="max-w-44" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button disabled={!school || !date} onClick={async () => { if (await act("gov_inspection_schedule", { p_jurisdiction: j!.id, p_school: school, p_date: date })) { setSchool(""); setDate(""); } }}>Schedule</Button>
        </div>
      )}
      <table className="mt-4 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Date</th><th>School</th><th>Status</th><th>Average</th><th>School reply</th><th /></tr></thead>
        <tbody>{(list.data ?? []).map((i: Inspection) => (
          <tr key={i.id} className="border-t align-top">
            <td>{i.scheduled_for}</td><td>{i.school}</td><td className="capitalize">{i.status}</td><td>{averageScore(i.scores) ?? "—"}</td>
            <td className="max-w-64">{i.school_response ?? "—"}</td>
            <td>{i.status === "scheduled" && canDo(role, "inspect") && <Button size="sm" variant="outline" onClick={() => { setOpen(i.id); setScores({}); setSummary(""); setRecs(""); setDue(""); }}>Record</Button>}</td>
          </tr>))}</tbody></table>
      {open && (
        <div className="mt-4 space-y-2 rounded-lg border p-3">
          <h2 className="font-medium">Record findings (1 = poor, 5 = excellent; at least three areas)</h2>
          {INSPECTION_DOMAINS.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm">{label}
              <select className="rounded-md border bg-background p-1" value={scores[k] ?? ""} onChange={(e) => setScores({ ...scores, [k]: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">Not scored</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>))}
          <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} placeholder="Summary (at least 20 characters)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={2} placeholder="Recommendations" value={recs} onChange={(e) => setRecs(e.target.value)} />
          <Input type="date" className="max-w-44" aria-label="Follow-up due" value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="flex gap-2">
            <Button disabled={!validScores(scores) || summary.trim().length < 20} onClick={async () => {
              const clean = Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== undefined));
              if (await act("gov_inspection_record", { p_id: open, p_scores: clean, p_summary: summary, p_recommendations: recs || null, p_follow_up_due: due || null })) setOpen(null); }}>Save final report</Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
