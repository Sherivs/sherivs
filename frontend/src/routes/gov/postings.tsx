import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import { useGovJurisdiction } from "@/lib/gov/context";
import { canDeploy, EXPORT_KINDS, govExport, govPostings, govStaffing, validTeacherRef } from "@/lib/gov/deployment";

export const Route = createFileRoute("/gov/postings")({ ssr: false, component: GovPostings });

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function GovPostings() {
  const j = useGovJurisdiction();
  const qc = useQueryClient();
  const role = (j as { agency_role?: string | null } | null)?.agency_role ?? null;
  const list = useQuery({ queryKey: ["gov-postings", j?.id], enabled: !!j, queryFn: () => govPostings(j!.id) });
  const schools = useQuery({ queryKey: ["gov-staffing", j?.id], enabled: !!j, queryFn: () => govStaffing(j!.id) });
  const blank = { name: "", ref: "", from: "", to: "", date: "", subject: "", reason: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: string, args: Record<string, unknown>) => {
    setMsg(null);
    try { await rpc(fn, args); await qc.invalidateQueries({ queryKey: ["gov-postings", j?.id] }); return true; } catch (e) { setMsg((e as Error).message); return false; }
  };
  const pub = (schools.data ?? []).filter((s) => s.ownership === "public");
  return (
    <section>
      <h1 className="text-xl font-semibold">Teacher postings & exports</h1>
      <p className="text-sm text-muted-foreground">Postings between public schools need a second director to approve. The releasing school releases the teacher first, then the receiving school confirms arrival.</p>
      {msg && <p className="mt-2 text-sm text-destructive" role="alert">{msg}</p>}
      {canDeploy(role, "export") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXPORT_KINDS.map((k) => (
            <Button key={k} size="sm" variant="outline" onClick={async () => {
              try { const r = await govExport(j!.id, k); download(r.filename, r.csv); } catch (e) { setMsg((e as Error).message); } }}>Export {k} (CSV)</Button>))}
        </div>
      )}
      {canDeploy(role, "propose") && (
        <div className="mt-3 space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap gap-2">
            <Input className="flex-1" placeholder="Teacher name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input className="max-w-48" placeholder="TRCN / staff no." value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
            <Input className="max-w-40" placeholder="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-md border bg-background p-2 text-sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
              <option value="">From: new appointment</option>{pub.map((s) => <option key={s.school_id} value={s.school_id}>{s.school}</option>)}
            </select>
            <select className="rounded-md border bg-background p-2 text-sm" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
              <option value="">To school…</option>{pub.map((s) => <option key={s.school_id} value={s.school_id}>{s.school}</option>)}
            </select>
            <Input type="date" className="max-w-44" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <Input placeholder="Reason (at least 10 characters)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <Button disabled={!f.name.trim() || !validTeacherRef(f.ref) || !f.to || !f.date || f.reason.trim().length < 10} onClick={async () => {
            if (await act("gov_posting_propose", { p_jurisdiction: j!.id, p_teacher_name: f.name, p_teacher_ref: f.ref, p_from: f.from || null, p_to: f.to, p_effective: f.date, p_reason: f.reason, p_subject: f.subject || null })) setF(blank);
          }}>Propose posting</Button>
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {(list.data ?? []).map((p) => (
          <li key={p.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{p.teacher_name} ({p.teacher_ref}){p.subject ? ` · ${p.subject}` : ""}</span>
              <span className="text-muted-foreground">{p.status}{p.released ? " · released" : ""}{p.received ? " · received" : ""} · from {p.effective_date}</span>
            </div>
            <p className="text-muted-foreground">{p.from_school ?? "New appointment"} → {p.to_school} — {p.reason}</p>
            {p.status === "proposed" && canDeploy(role, "decide") && !p.mine && (
              <div className="mt-1 flex gap-2">
                <Button size="sm" onClick={() => void act("gov_posting_decide", { p_id: p.id, p_approve: true, p_note: null })}>Approve</Button>
                <Button size="sm" variant="ghost" onClick={() => { const n = prompt("Reason for rejecting"); if (n) void act("gov_posting_decide", { p_id: p.id, p_approve: false, p_note: n }); }}>Reject</Button>
              </div>)}
            {(p.status === "proposed" || (p.status === "approved" && !p.received)) && canDeploy(role, "propose") && (
              <Button size="sm" variant="ghost" onClick={() => { const r = prompt("Reason for cancelling"); if (r) void act("gov_posting_cancel", { p_id: p.id, p_reason: r }); }}>Cancel</Button>)}
          </li>))}
      </ul>
    </section>
  );
}
