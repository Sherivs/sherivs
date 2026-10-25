/** External exam registration windows: WAEC, NECO, NABTEB, BECE, NCEE, JAMB UTME (SHERIVS-A04). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/exam-bodies")({ ssr: false, component: ExamBodiesPage });
type Body = { code: string; name: string; min_subjects: number; max_subjects: number; default_levels: string[] };
type Win = { id: string; body_code: string; exam_year: number; opens_on: string; closes_on: string; late_closes_on: string | null; fee: number; late_fee: number };
type Cand = { id: string; student_id: string; subjects: string[]; status: string; late: boolean; fee_due: number };
type Summary = { state: string; candidates: number; late: number; fees_due: number; by_subject: Record<string, number> };

function ExamBodiesPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const bodies = useQuery({ queryKey: ["exam-bodies"], queryFn: () => rows<Body>(sdb.from("exam_bodies").select("code,name,min_subjects,max_subjects,default_levels")) });
  const wins = useQuery({ queryKey: ["exam-windows", org], enabled: !!org, queryFn: () => rows<Win>(sdb.from("exam_body_windows").select("id,body_code,exam_year,opens_on,closes_on,late_closes_on,fee,late_fee").eq("school_id", org).order("exam_year", { ascending: false })) });
  const [sel, setSel] = useState("");
  const cands = useQuery({ queryKey: ["exam-cands", sel], enabled: !!sel, queryFn: () => rows<Cand>(sdb.from("exam_body_candidates").select("id,student_id,subjects,status,late,fee_due").eq("window_id", sel)) });
  const summary = useQuery({ queryKey: ["exam-summary", sel], enabled: !!sel, queryFn: () => rpc<Summary>("exam_window_summary", { p_window: sel }) });
  const students = useQuery({ queryKey: ["students-min", org], enabled: !!org, queryFn: () => rows<{ id: string; admission_number: string | null }>(sdb.from("students").select("id,admission_number").eq("school_id", org).eq("is_active", true)) });
  const [w, setW] = useState({ body: "WAEC_WASSCE", year: String(new Date().getFullYear() + 1), opens: "", closes: "", late: "", fee: "0", lateFee: "0" });
  const [c, setC] = useState({ student: "", subjects: "" });
  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  }
  const body = bodies.data?.find((b) => b.code === wins.data?.find((x) => x.id === sel)?.body_code);
  const s = "rounded-md border bg-background p-2 text-sm";
  return (
    <PortalPage title="External exams" subtitle="Open a registration window per exam body and year, register eligible candidates, and track late entries and fees.">
      <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Registration window</h3>
        <div className="grid gap-2 md:grid-cols-7">
          <select className={s} aria-label="Exam body" value={w.body} onChange={(e) => setW({ ...w, body: e.target.value })}>{(bodies.data ?? []).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select>
          <Input aria-label="Exam year" value={w.year} onChange={(e) => setW({ ...w, year: e.target.value })} />
          <Input type="date" aria-label="Opens" value={w.opens} onChange={(e) => setW({ ...w, opens: e.target.value })} />
          <Input type="date" aria-label="Closes" value={w.closes} onChange={(e) => setW({ ...w, closes: e.target.value })} />
          <Input type="date" aria-label="Late registration closes" value={w.late} onChange={(e) => setW({ ...w, late: e.target.value })} />
          <Input aria-label="Fee (₦)" value={w.fee} onChange={(e) => setW({ ...w, fee: e.target.value })} />
          <Input aria-label="Late fee (₦)" value={w.lateFee} onChange={(e) => setW({ ...w, lateFee: e.target.value })} />
        </div>
        <Button onClick={() => go("exam_window_upsert", { p_org: org, p_body: w.body, p_year: Number(w.year), p_opens: w.opens, p_closes: w.closes, p_late_closes: w.late || null, p_fee: Number(w.fee), p_late_fee: Number(w.lateFee) }, "Window saved")}>Save window</Button>
        <ul className="text-sm">{(wins.data ?? []).map((x) => <li key={x.id}><button className={x.id === sel ? "font-semibold underline" : "underline"} onClick={() => setSel(x.id)}>{x.body_code} {x.exam_year}</button> · {x.opens_on} → {x.closes_on}{x.late_closes_on ? ` (late to ${x.late_closes_on})` : ""} · ₦{x.fee}{x.late_fee ? ` + ₦${x.late_fee} late` : ""}</li>)}</ul></div>
      {sel && (<div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Candidates {summary.data ? `· ${summary.data.state} · ${summary.data.candidates} registered · ${summary.data.late} late · ₦${summary.data.fees_due} due` : ""}</h3>
        {body && <p className="text-xs text-muted-foreground">{body.name}: {body.min_subjects}–{body.max_subjects} subjects; for {body.default_levels.join(", ")}.</p>}
        <div className="grid gap-2 md:grid-cols-3">
          <select className={s} aria-label="Student" value={c.student} onChange={(e) => setC({ ...c, student: e.target.value })}><option value="">Choose a student</option>{(students.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.admission_number ?? x.id.slice(0, 8)}</option>)}</select>
          <Input className="md:col-span-2" placeholder="Subjects, comma separated" value={c.subjects} onChange={(e) => setC({ ...c, subjects: e.target.value })} />
        </div>
        <Button disabled={!c.student} onClick={() => go("exam_candidate_register", { p_window: sel, p_student: c.student, p_subjects: c.subjects.split(",").map((x) => x.trim()).filter(Boolean) }, "Candidate registered")}>Register / update</Button>
        <ul className="text-sm">{(cands.data ?? []).map((x) => <li key={x.id} className="flex justify-between gap-2"><span>{students.data?.find((st) => st.id === x.student_id)?.admission_number ?? x.student_id.slice(0, 8)} · {x.subjects.length} subjects · {x.status}{x.late ? " · late" : ""} · ₦{x.fee_due}</span>
          {x.status === "registered" && <button className="text-destructive underline" onClick={() => go("exam_candidate_withdraw", { p_candidate: x.id }, "Withdrawn")}>Withdraw</button>}</li>)}</ul>
        {summary.data && <p className="text-xs text-muted-foreground">Entries per subject: {Object.entries(summary.data.by_subject).map(([k, n]) => `${k} ${n}`).join(" · ") || "none yet"}</p>}</div>)}
    </PortalPage>
  );
}
