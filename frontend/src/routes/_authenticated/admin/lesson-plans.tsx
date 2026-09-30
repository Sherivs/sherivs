import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { PaginationBar } from "@/components/pagination-bar";
import { usePagination, PAGE_SIZE } from "@/hooks/use-pagination";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = {
  id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  date_planned: string | null;
  status: string | null;
  review_notes: string | null;
  teacher_id: string;
  teacher?: { full_name: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  needs_revision: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  draft: "bg-muted text-muted-foreground border-border",
};

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "draft";
  const cls = STATUS_STYLES[s] ?? STATUS_STYLES.draft;
  return (
    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${cls}`}>
      {s.replace("_", " ")}
    </span>
  );
}

function AdminLessonPlans() {
  const { school } = useApp();
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const [notes, setNotes] = useState("");

  const { page, from, to, nextPage, prevPage, goToPage } = usePagination();

  const q = useQuery<{ rows: Row[]; count: number }>({
    queryKey: ["admin-lesson-plans", school?.id, page],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("lesson_plans")
        .select(
          "id,title,subject,topic,date_planned,status,review_notes,teacher_id,teacher:users!lesson_plans_teacher_id_fkey(full_name)",
          { count: "exact" },
        )
        .eq("school_id", school!.id)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
    },
  });

  async function setStatus(row: Row, status: string, review_notes: string | null = null) {
    const { error } = await supabase
      .from("lesson_plans")
      .update({ status, review_notes, admin_viewed: true })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked as ${status.replace("_", " ")}`);
    setReviewing(null);
    setNotes("");
    qc.invalidateQueries({ queryKey: ["admin-lesson-plans", school?.id] });
  }

  const rows = q.data?.rows ?? [];
  const total = q.data?.count ?? 0;
  const pending = rows.filter((r) => r.status === "submitted").length;

  return (
    <PortalPage
      title="Lesson plans"
      subtitle={
        pending > 0
          ? `${pending} plan${pending === 1 ? "" : "s"} awaiting review`
          : "Review and approve teacher lesson plans."
      }
    >
      {q.isLoading ? (
        <div className="uos-card p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : total === 0 ? (
        <div className="uos-empty p-10 text-center">
          <FileText className="mx-auto size-10 text-muted-foreground/60" />
          <h3 className="mt-3 font-display text-lg font-semibold">No lesson plans yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Teachers will submit plans here. You will be able to approve them or request revisions.
          </p>
        </div>
      ) : (
        <div className="uos-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.title}</div>
                      {r.topic && <div className="text-xs text-muted-foreground">{r.topic}</div>}
                    </td>
                    <td className="px-4 py-3">{r.teacher?.full_name ?? "—"}</td>
                    <td className="px-4 py-3">{r.subject ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.date_planned ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReviewing(r);
                          setNotes(r.review_notes ?? "");
                        }}
                      >
                        <ClipboardCheck className="size-3.5" /> Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onNext={nextPage}
            onPrev={prevPage}
            onPage={goToPage}
            isLoading={q.isFetching}
          />
        </div>
      )}

      <Dialog open={!!reviewing} onOpenChange={(v) => !v && setReviewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{reviewing?.title}</DialogTitle>
            <DialogDescription>
              {reviewing?.subject ? `${reviewing.subject} • ` : ""}
              {reviewing?.teacher?.full_name ?? "Teacher"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Review notes
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Optional notes — required when requesting revisions."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!reviewing) return;
                if (!notes.trim()) return toast.error("Add a note explaining what to revise.");
                void setStatus(reviewing, "needs_revision", notes.trim());
              }}
            >
              Request revisions
            </Button>
            <Button
              onClick={() => reviewing && setStatus(reviewing, "approved", notes.trim() || null)}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalPage>
  );
}

export const Route = createFileRoute("/_authenticated/admin/lesson-plans")({
  component: AdminLessonPlans,
});
