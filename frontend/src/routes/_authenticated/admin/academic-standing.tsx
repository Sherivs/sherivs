/** Tertiary results: semester GPA / CGPA, degree class bands and academic standing (SHERIVS-A03). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/academic-standing")({ ssr: false, component: StandingPage });
type Flag = { student_id: string; admission_number: string | null; name: string | null; cgpa: number | null; standing: string };
type Sem = { session: string; semester: string; tcu: number; tcp: number; tce: number; gpa: number | null; cgpa: number | null };
type Result = { semesters: Sem[]; cgpa: number | null; class: string | null; standing: { status: string; consecutive_probations: number } };
const DEFAULT_BANDS = '[{"label":"First Class","min_cgpa":4.5},{"label":"Second Class Upper","min_cgpa":3.5},{"label":"Second Class Lower","min_cgpa":2.4},{"label":"Third Class","min_cgpa":1.5},{"label":"Pass","min_cgpa":1.0}]';

function StandingPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ["standing", org], enabled: !!org, queryFn: () => rpc<Flag[]>("academic_standing_report", { p_org: org }) });
  const bands = useQuery({ queryKey: ["bands", org], enabled: !!org, queryFn: () => rows<{ label: string; min_cgpa: number }>(sdb.from("degree_class_bands").select("label,min_cgpa").eq("school_id", org).order("min_cgpa", { ascending: false })) });
  const [student, setStudent] = useState(""); const [res, setRes] = useState<Result | null>(null);
  const [bandText, setBandText] = useState(""); const [floor, setFloor] = useState("1.00"); const [streak, setStreak] = useState("2");
  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  }
  async function look(id: string) { setStudent(id); try { setRes(await rpc<Result>("semester_results", { p_student: id })); } catch (e) { toast.error((e as Error).message); } }
  return (
    <PortalPage title="Results & academic standing" subtitle="Published grades only. GPA per semester, running CGPA, class of degree, probation and withdrawal advice.">
      <div className="rounded-lg border p-3"><h3 className="font-medium">Students needing attention</h3>
        <ul className="mt-2 space-y-1 text-sm">{(report.data ?? []).map((f) => (
          <li key={f.student_id}><button className="underline" onClick={() => look(f.student_id)}>{f.name ?? f.admission_number ?? f.student_id.slice(0, 8)}</button> · CGPA {f.cgpa ?? "–"} · <b>{f.standing.replace("_", " ")}</b></li>))}
          {report.data?.length === 0 && <li className="text-muted-foreground">Everyone is in good standing.</li>}
          {report.error && <li className="text-destructive">{(report.error as Error).message}</li>}</ul></div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Student results</h3>
        <div className="flex gap-2"><Input placeholder="Student id" value={student} onChange={(e) => setStudent(e.target.value)} /><Button onClick={() => look(student)}>Show</Button></div>
        {res && (<div className="text-sm"><p>CGPA <b>{res.cgpa ?? "–"}</b> · {res.class ?? "no class yet"} · {res.standing.status.replace("_", " ")}</p>
          <table className="mt-2 w-full text-left"><thead><tr><th>Session</th><th>Semester</th><th>TCU</th><th>TCP</th><th>TCE</th><th>GPA</th><th>CGPA</th></tr></thead>
            <tbody>{res.semesters.map((s) => <tr key={s.session + s.semester}><td>{s.session}</td><td>{s.semester}</td><td>{s.tcu}</td><td>{s.tcp}</td><td>{s.tce}</td><td>{s.gpa}</td><td>{s.cgpa}</td></tr>)}</tbody></table></div>)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Degree class bands</h3>
          <p className="text-xs text-muted-foreground">{(bands.data ?? []).length ? bands.data!.map((b) => `${b.label} ≥ ${b.min_cgpa}`).join(" · ") : "Using NUC 5-point defaults."}</p>
          <textarea className="h-24 w-full rounded border p-2 font-mono text-xs" placeholder={DEFAULT_BANDS} value={bandText} onChange={(e) => setBandText(e.target.value)} aria-label="Bands JSON" />
          <Button onClick={() => { try { void go("degree_class_bands_set", { p_org: org, p_bands: JSON.parse(bandText || DEFAULT_BANDS) }, "Bands saved"); } catch { toast.error("Bands must be valid JSON"); } }}>Save bands</Button></div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Standing rules</h3>
          <label className="block text-sm">Probation below CGPA <Input value={floor} onChange={(e) => setFloor(e.target.value)} /></label>
          <label className="block text-sm">Consecutive probation sessions before withdrawal is advised <Input value={streak} onChange={(e) => setStreak(e.target.value)} /></label>
          <Button onClick={() => go("academic_standing_rules_set", { p_org: org, p_probation_below: Number(floor), p_consecutive: Number(streak) }, "Rules saved")}>Save rules</Button></div>
      </div>
    </PortalPage>
  );
}
