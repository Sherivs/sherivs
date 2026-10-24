/** Exam office: sessions, papers, seating, invigilators, malpractice queue (SHERIVS-022). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/exams")({ ssr: false, component: ExamsPage });

function ExamsPage() {
  const { school } = useApp(); const org = school?.id ?? ""; const qc = useQueryClient();
  const [name, setName] = useState("First Term Examinations"); const [year, setYear] = useState("2025/2026"); const [term, setTerm] = useState("First Term");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [session, setSession] = useState(""); const [cls, setCls] = useState(""); const [subject, setSubject] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [paper, setPaper] = useState(""); const [inv, setInv] = useState("");
  const sessions = useQuery({ queryKey: ["exam-sessions", org], enabled: !!org, queryFn: () => rows<{ id: string; name: string }>(sdb.from("exam_sessions").select("id,name").eq("school_id", org)) });
  const papers = useQuery({ queryKey: ["exam-papers", org], enabled: !!org, queryFn: () => rows<{ id: string; subject: string; starts_at: string; class_id: string }>(sdb.from("exam_papers").select("id,subject,starts_at,class_id").eq("school_id", org).order("starts_at")) });
  const classes = useQuery({ queryKey: ["classes", org], enabled: !!org, queryFn: () => rows<{ id: string; name: string }>(sdb.from("classes").select("id,name").eq("school_id", org)) });
  const staff = useQuery({ queryKey: ["staff", org], enabled: !!org, queryFn: () => rows<{ id: string; full_name: string }>(sdb.from("users").select("id,full_name").eq("school_id", org).eq("role", "teacher")) });
  const cases = useQuery({ queryKey: ["malpractice", org], enabled: !!org, queryFn: () => rows<{ id: string; description: string; status: string }>(sdb.from("malpractice_cases").select("id,description,status").eq("school_id", org)) });
  async function go(fn: string, args: Record<string, unknown>, ok: string) { try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  const sel = "rounded-md border bg-background p-2 text-sm";
  return (
    <PortalPage title="Exam office" subtitle="Timetable without clashes, seat plans, invigilators who are never double-booked, and malpractice cases decided by someone other than the reporter.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Exam session</h3>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <div className="flex gap-2"><Input value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" /><Input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term" /></div>
          <div className="flex gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div>
          <Button onClick={() => go("exam_session_create", { p_school: org, p_name: name, p_year: year, p_term: term, p_from: from, p_to: to }, "Session created")}>Create</Button></div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Add paper</h3>
          <select className={sel} value={session} onChange={(e) => setSession(e.target.value)} aria-label="Session"><option value="">Session</option>{(sessions.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className={sel} value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class"><option value="">Class</option>{(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <div className="flex gap-2"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start" /><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End" /></div>
          <Button onClick={() => go("exam_paper_add", { p_session: session, p_class: cls, p_subject: subject, p_start: new Date(start).toISOString(), p_end: new Date(end).toISOString() }, "Paper added")}>Add paper</Button></div>
      </div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Seating and invigilation</h3>
        <select className={sel} value={paper} onChange={(e) => setPaper(e.target.value)} aria-label="Paper"><option value="">Paper</option>{(papers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.subject} · {new Date(p.starts_at).toLocaleString()}</option>)}</select>
        <div className="flex gap-2"><Button variant="outline" onClick={() => go("exam_generate_seating", { p_paper: paper }, "Seat plan generated")}>Generate seat plan</Button>
          <select className={sel} value={inv} onChange={(e) => setInv(e.target.value)} aria-label="Invigilator"><option value="">Invigilator</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
          <Button onClick={() => go("exam_assign_invigilator", { p_paper: paper, p_user: inv }, "Invigilator assigned")}>Assign</Button></div></div>
      <div className="mt-4 rounded-lg border p-3"><h3 className="font-medium">Malpractice cases</h3>
        <ul className="text-sm">{(cases.data ?? []).map((c) => <li key={c.id} className="flex items-center justify-between py-1"><span>{c.description} · {c.status}</span>
          {c.status === "open" && <span className="flex gap-1"><Button size="sm" variant="outline" onClick={() => go("malpractice_decide", { p_case: c.id, p_outcome: "dismissed" }, "Dismissed")}>Dismiss</Button>
            <Button size="sm" onClick={() => go("malpractice_decide", { p_case: c.id, p_outcome: "upheld" }, "Upheld")}>Uphold</Button></span>}</li>)}</ul></div>
    </PortalPage>);
}
