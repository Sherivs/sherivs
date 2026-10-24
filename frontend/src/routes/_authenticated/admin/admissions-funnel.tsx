/** Admissions funnel (SHERIVS-020): entrance exam → interview → offer → acceptance fee → enrol. */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/admissions-funnel")({ ssr: false, component: Funnel });
const STAGES = ["applied", "exam_scheduled", "exam_taken", "interview", "offered", "accepted", "enrolled"];
type App = { id: string; application_number: string; student_first_name: string; student_last_name: string; applying_for_class: string; stage: string; entrance_exam_score: number | null; acceptance_fee: number | null };

function Funnel() {
  const { school } = useApp(); const org = school?.id ?? ""; const qc = useQueryClient();
  const [val, setVal] = useState<Record<string, string>>({});
  const funnel = useQuery({ queryKey: ["funnel", org], enabled: !!org, queryFn: () => rpc<Record<string, number>>("admissions_funnel", { p_school: org }) });
  const apps = useQuery({ queryKey: ["apps", org], enabled: !!org, queryFn: () => rows<App>(sdb.from("admission_applications").select("id,application_number,student_first_name,student_last_name,applying_for_class,stage,entrance_exam_score,acceptance_fee").eq("school_id", org).order("submitted_at", { ascending: false }).limit(100)) });
  async function go(fn: string, args: Record<string, unknown>, ok: string) { try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  const inDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
  return (
    <PortalPage title="Admissions funnel" subtitle="Each step is recorded; the exam scorer cannot also make the offer.">
      <div className="flex flex-wrap gap-2">{STAGES.map((s) => <Badge key={s} variant="outline">{s.replace("_", " ")}: {funnel.data?.[s] ?? 0}</Badge>)}</div>
      <table className="mt-4 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Applicant</th><th>Class</th><th>Stage</th><th>Score</th><th>Next step</th></tr></thead>
        <tbody>{(apps.data ?? []).map((a) => (
          <tr key={a.id} className="border-t align-top"><td>{a.student_first_name} {a.student_last_name}<div className="text-xs text-muted-foreground">{a.application_number}</div></td>
            <td>{a.applying_for_class}</td><td>{a.stage}</td><td>{a.entrance_exam_score ?? "—"}</td>
            <td className="space-x-1">
              {a.stage === "applied" && <Button size="sm" onClick={() => go("admissions_schedule_exam", { p_app: a.id, p_at: inDays(7) }, "Exam scheduled")}>Schedule exam (7 days)</Button>}
              {a.stage === "exam_scheduled" && <><Input className="inline w-20" placeholder="Score" value={val[a.id] ?? ""} onChange={(e) => setVal({ ...val, [a.id]: e.target.value })} />
                <Button size="sm" onClick={() => go("admissions_record_score", { p_app: a.id, p_score: Number(val[a.id]) }, "Score saved")}>Save score</Button></>}
              {(a.stage === "exam_taken" || a.stage === "interview") && <><Input className="inline w-28" placeholder="Acceptance fee ₦" value={val[a.id] ?? ""} onChange={(e) => setVal({ ...val, [a.id]: e.target.value })} />
                <Button size="sm" onClick={() => go("admissions_offer", { p_app: a.id, p_acceptance_fee: Number(val[a.id] || 0), p_expires: inDays(14) }, "Offer sent")}>Make offer</Button></>}
              {a.stage === "offered" && <Button size="sm" variant="outline" onClick={() => go("admissions_record_acceptance", { p_app: a.id, p_reference: `CASH-${Date.now()}` }, "Acceptance fee recorded")}>Record cash acceptance fee</Button>}
              {a.stage === "accepted" && <><Input className="inline w-32" placeholder="Admission no." value={val[a.id] ?? ""} onChange={(e) => setVal({ ...val, [a.id]: e.target.value })} />
                <Button size="sm" onClick={() => go("admissions_enroll", { p_app: a.id, p_admission_number: val[a.id] }, "Enrolled")}>Enrol</Button></>}
            </td></tr>))}</tbody></table>
    </PortalPage>
  );
}
