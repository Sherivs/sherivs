/** Teacher: submit lesson notes against the scheme of work; HoD reviews (SHERIVS-024). */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/teacher/lesson-notes")({ ssr: false, component: LessonNotes });

function LessonNotes() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["my-plans"], queryFn: () => rows<{ id: string; title: string; subject: string; status: string; review_notes: string | null }>(sdb.from("lesson_plans").select("id,title,subject,status,review_notes").order("created_at", { ascending: false }).limit(50)) });
  const queue = useQuery({ queryKey: ["review-queue"], queryFn: () => rows<{ id: string; lesson_plan_id: string; submitted_by: string; status: string }>(sdb.from("lesson_note_reviews").select("id,lesson_plan_id,submitted_by,status").eq("status", "submitted")) });
  async function go(fn: string, args: Record<string, unknown>, ok: string) { try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  return (
    <PortalPage title="Lesson notes" subtitle="Submit each note for review. A reviewer can never approve their own note.">
      <ul className="space-y-1 text-sm">{(plans.data ?? []).map((p) => <li key={p.id} className="flex items-center justify-between border-t py-1"><span>{p.subject} · {p.title} · {p.status}{p.review_notes ? ` · “${p.review_notes}”` : ""}</span>
        {p.status === "draft" && <Button size="sm" onClick={() => go("lesson_note_submit", { p_plan: p.id }, "Submitted")}>Submit</Button>}</li>)}</ul>
      {(queue.data ?? []).length > 0 && <div className="mt-6"><h3 className="font-medium">Waiting for your review</h3>
        <ul className="text-sm">{(queue.data ?? []).map((r) => <li key={r.id} className="flex items-center justify-between border-t py-1"><span>{r.lesson_plan_id.slice(0, 8)}</span>
          <span className="flex gap-1"><Button size="sm" onClick={() => go("lesson_note_review", { p_review: r.id, p_approve: true }, "Approved")}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => { const c = prompt("What should be fixed?") ?? ""; void go("lesson_note_review", { p_review: r.id, p_approve: false, p_comment: c }, "Returned"); }}>Return</Button></span></li>)}</ul></div>}
    </PortalPage>);
}
