/** School side of the gov console (SHERIVS-B03): circulars to acknowledge and inspection reports to answer. */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { rpc } from "@/lib/scholar/rpc";
import { nextSchoolStep, type Posting } from "@/lib/gov/deployment";
import { INSPECTION_DOMAINS, averageScore, type Circular, type Inspection } from "@/lib/gov/modules";

export const Route = createFileRoute("/_authenticated/admin/government")({ ssr: false, component: GovernmentPage });

function GovernmentPage() {
  const qc = useQueryClient();
  const circ = useQuery({ queryKey: ["school-circ"], queryFn: () => rpc<Circular[]>("school_circulars_mine") });
  const insp = useQuery({ queryKey: ["school-insp"], queryFn: () => rpc<Inspection[]>("school_inspections_mine") });
  const posts = useQuery({ queryKey: ["school-posts"], queryFn: () => rpc<Posting[]>("school_postings_mine") });
  const [reply, setReply] = useState<Record<string, string>>({});
  const go = async (fn: string, args: Record<string, unknown>, ok: string, key: string) => {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries({ queryKey: [key] }); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <PortalPage title="Government" subtitle="Circulars and inspection reports from authorities your school shares data with.">
      <h2 className="mt-2 font-semibold">Circulars</h2>
      <ul className="mt-2 space-y-3">
        {(circ.data ?? []).map((c) => (
          <li key={c.id} className="rounded-lg border p-3 text-sm">
            <div className="font-medium">{c.authority} · {c.ref_no ? `${c.ref_no} · ` : ""}{c.title}</div>
            <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            {c.requires_ack && (c.acked_at ? <p className="mt-1 text-muted-foreground">Acknowledged {c.acked_at.slice(0, 10)}</p>
              : <Button size="sm" className="mt-2" onClick={() => go("school_circular_ack", { p_id: c.id }, "Acknowledged", "school-circ")}>Acknowledge</Button>)}
          </li>))}
      </ul>
      <h2 className="mt-6 font-semibold">Inspections</h2>
      <ul className="mt-2 space-y-3">
        {(insp.data ?? []).map((i) => (
          <li key={i.id} className="rounded-lg border p-3 text-sm">
            <div className="font-medium">{i.authority} · {i.scheduled_for} · <span className="capitalize">{i.status}</span>{i.status === "completed" ? ` · average ${averageScore(i.scores)}` : ""}</div>
            {i.status === "completed" && (<>
              <ul className="mt-1 text-muted-foreground">{INSPECTION_DOMAINS.filter(([k]) => i.scores?.[k]).map(([k, l]) => <li key={k}>{l}: {i.scores?.[k]}/5</li>)}</ul>
              <p className="mt-1">{i.summary}</p>
              {i.recommendations && <p className="mt-1">Recommendations: {i.recommendations}</p>}
              {i.follow_up_due && <p className="mt-1">Follow-up due {i.follow_up_due}</p>}
              {i.school_response ? <p className="mt-1 text-muted-foreground">Your reply: {i.school_response}</p> : (
                <div className="mt-2 flex gap-2">
                  <textarea className="flex-1 rounded-md border bg-background p-2" rows={2} placeholder="Reply once (at least 10 characters)" value={reply[i.id] ?? ""} onChange={(e) => setReply({ ...reply, [i.id]: e.target.value })} />
                  <Button disabled={(reply[i.id] ?? "").trim().length < 10} onClick={() => go("school_inspection_respond", { p_id: i.id, p_response: reply[i.id] }, "Reply sent", "school-insp")}>Send</Button>
                </div>)}
            </>)}
          </li>))}
      </ul>
      <h2 className="mt-6 font-semibold">Teacher postings</h2>
      <ul className="mt-2 space-y-2">
        {(posts.data ?? []).map((p) => {
          const step = nextSchoolStep(p);
          return (
            <li key={p.id} className="rounded-lg border p-3 text-sm">
              <div className="font-medium">{p.direction === "incoming" ? "Incoming" : "Outgoing"}: {p.teacher_name} ({p.teacher_ref}) · {p.other_school ?? "new appointment"} · from {p.effective_date}</div>
              {step === "release" && <Button size="sm" className="mt-2" onClick={() => go("school_posting_ack", { p_id: p.id }, "Teacher released", "school-posts")}>Release teacher</Button>}
              {step === "receive" && <Button size="sm" className="mt-2" onClick={() => go("school_posting_ack", { p_id: p.id }, "Arrival confirmed", "school-posts")}>Confirm arrival</Button>}
              {step === "wait" && <p className="mt-1 text-muted-foreground">Waiting for the current school to release this teacher.</p>}
              {p.received && <p className="mt-1 text-muted-foreground">Completed.</p>}
            </li>);
        })}
      </ul>
    </PortalPage>
  );
}
