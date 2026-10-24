/** Learning-gap early warning (SHERIVS-023). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/early-warning")({ ssr: false, component: EarlyWarning });
type Flag = { id: string; student_id: string; kind: string; severity: string; detail: Record<string, unknown>; resolved_at: string | null };

function EarlyWarning() {
  const { school } = useApp(); const org = school?.id ?? ""; const qc = useQueryClient();
  const [year, setYear] = useState("2025/2026"); const [term, setTerm] = useState("First Term"); const [prev, setPrev] = useState(""); const [notes, setNotes] = useState<Record<string, string>>({});
  const flags = useQuery({ queryKey: ["flags", org], enabled: !!org, queryFn: () => rows<Flag>(sdb.from("learning_gap_flags").select("id,student_id,kind,severity,detail,resolved_at").eq("school_id", org).order("created_at", { ascending: false }).limit(500)) });
  async function run() { try { const r = await rpc("compute_early_warnings", { p_school: org, p_year: year, p_term: term, p_prev_term: prev || null }); toast.success(`Flags: ${JSON.stringify(r)}`); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  async function resolve(id: string) { try { await rpc("early_warning_resolve", { p_flag: id, p_note: notes[id] ?? "" }); toast.success("Resolved"); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  const open = (flags.data ?? []).filter((f) => !f.resolved_at);
  return (
    <PortalPage title="Early warning" subtitle="Students slipping on attendance or results, so form teachers and counsellors can act early.">
      <div className="mb-4 flex flex-wrap gap-2"><Input value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" /><Input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term" />
        <Input placeholder="Previous term (for drops)" value={prev} onChange={(e) => setPrev(e.target.value)} /><Button onClick={run}>Run now</Button></div>
      <ul className="space-y-2">{open.map((f) => (
        <li key={f.id} className="rounded border p-2 text-sm"><b className={f.severity === "act" ? "text-red-600" : "text-amber-600"}>{f.kind.replace("_", " ")}</b> · {f.student_id.slice(0, 8)} · {JSON.stringify(f.detail)}
          <div className="mt-1 flex gap-2"><Input placeholder="What was done" value={notes[f.id] ?? ""} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} /><Button size="sm" onClick={() => resolve(f.id)}>Resolve</Button></div></li>))}</ul>
    </PortalPage>);
}
