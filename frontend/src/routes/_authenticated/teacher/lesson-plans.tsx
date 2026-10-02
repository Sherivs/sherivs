import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, FileText, Send, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { draftLessonPlan } from "@/lib/runtime/scholar/lesson-plan-ai.functions";

type Row = {
  id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  date_planned: string | null;
  duration_minutes: number | null;
  description: string | null;
  homework_assignment: string | null;
  status: string | null;
  review_notes: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  needs_revision: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  draft: "bg-muted text-muted-foreground border-border",
};

const schema = z.object({
  title: z.string().min(2).max(180),
  subject: z.string().max(80).nullable().optional(),
  topic: z.string().max(180).nullable().optional(),
  date_planned: z.string().nullable().optional(),
  duration_minutes: z.number().int().positive().nullable().optional(),
  description: z.string().max(8000).nullable().optional(),
  homework_assignment: z.string().max(2000).nullable().optional(),
});

type FormVals = {
  title: string;
  subject: string;
  topic: string;
  date_planned: string;
  duration_minutes: string;
  description: string;
  homework_assignment: string;
};
const empty: FormVals = {
  title: "",
  subject: "",
  topic: "",
  date_planned: "",
  duration_minutes: "",
  description: "",
  homework_assignment: "",
};

function TeacherLessonPlans() {
  const { profile, school } = useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [vals, setVals] = useState<FormVals>(empty);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const aiDraft = useServerFn(draftLessonPlan);

  async function runAiDraft() {
    if (!vals.subject.trim() || !vals.topic.trim()) {
      toast.error("Enter a subject and topic first, then let AI draft the rest.");
      return;
    }
    setDrafting(true);
    try {
      const draft = await aiDraft({
        data: {
          subject: vals.subject.trim(),
          topic: vals.topic.trim(),
          duration_minutes: vals.duration_minutes ? Number(vals.duration_minutes) : undefined,
        },
      });
      const desc = [
        "Objectives:",
        ...draft.objectives.map((o) => ` • ${o}`),
        "",
        "Materials:",
        ...draft.materials.map((m) => ` • ${m}`),
        "",
        "Activities:",
        ...draft.activities.map((a) => ` • [${a.minutes} min] ${a.description}`),
        "",
        `Assessment: ${draft.assessment}`,
      ].join("\n");
      setVals((s) => ({
        ...s,
        title: s.title || draft.title,
        description: desc,
        homework_assignment: s.homework_assignment || draft.homework,
      }));
      toast.success("Draft inserted — review and edit before saving.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI draft failed");
    } finally {
      setDrafting(false);
    }
  }

  const q = useQuery<Row[]>({
    queryKey: ["teacher-lesson-plans", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lesson_plans")
        .select(
          "id,title,subject,topic,date_planned,duration_minutes,description,homework_assignment,status,review_notes",
        )
        .eq("teacher_id", profile!.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  useMemo(() => {
    if (editing) {
      setVals({
        title: editing.title ?? "",
        subject: editing.subject ?? "",
        topic: editing.topic ?? "",
        date_planned: editing.date_planned ?? "",
        duration_minutes: editing.duration_minutes?.toString() ?? "",
        description: editing.description ?? "",
        homework_assignment: editing.homework_assignment ?? "",
      });
    } else {
      setVals(empty);
    }
  }, [editing]);

  async function save(submit: boolean) {
    if (!profile || !school) return;
    setSaving(true);
    try {
      const parsed = schema.parse({
        title: vals.title,
        subject: vals.subject || null,
        topic: vals.topic || null,
        date_planned: vals.date_planned || null,
        duration_minutes: vals.duration_minutes ? Number(vals.duration_minutes) : null,
        description: vals.description || null,
        homework_assignment: vals.homework_assignment || null,
      });
      const status = submit ? "submitted" : (editing?.status ?? "draft");
      const payload = { ...parsed, status };
      let error;
      if (editing) {
        ({ error } = await supabase.from("lesson_plans").update(payload).eq("id", editing.id));
      } else {
        ({ error } = await supabase.from("lesson_plans").insert({
          ...payload,
          teacher_id: profile.id,
          school_id: school.id,
          admin_viewed: false,
        }));
      }
      if (error) throw error;
      toast.success(submit ? "Submitted for review" : editing ? "Saved" : "Created");
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["teacher-lesson-plans", profile.id] });
    } catch (err) {
      toast.error(
        err instanceof z.ZodError
          ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" • ")
          : err instanceof Error
            ? err.message
            : "Failed to save",
      );
    } finally {
      setSaving(false);
    }
  }

  const rows = q.data ?? [];

  return (
    <PortalPage title="My lesson plans" subtitle="Draft, submit and track feedback from admin.">
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="size-4" /> New plan
        </Button>
      </div>

      {q.isLoading ? (
        <div className="uos-card p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="uos-empty p-10 text-center">
          <FileText className="mx-auto size-10 text-muted-foreground/60" />
          <h3 className="mt-3 font-display text-lg font-semibold">No lesson plans yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first plan to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const cls = STATUS_STYLES[r.status ?? "draft"] ?? STATUS_STYLES.draft;
            return (
              <div key={r.id} className="uos-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{r.title}</h3>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${cls}`}
                      >
                        {(r.status ?? "draft").replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[r.subject, r.topic, r.date_planned].filter(Boolean).join(" • ") ||
                        "No details"}
                    </div>
                    {r.status === "needs_revision" && r.review_notes && (
                      <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs">
                        <span className="font-semibold text-rose-300">Admin feedback: </span>
                        <span className="text-rose-100/90">{r.review_notes}</span>
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(r);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="size-4" /> Edit
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit lesson plan" : "New lesson plan"}</DialogTitle>
            <DialogDescription>Save as draft or submit for admin review.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Title">
              <Input
                value={vals.title}
                onChange={(e) => setVals((s) => ({ ...s, title: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Subject">
                <Input
                  value={vals.subject}
                  onChange={(e) => setVals((s) => ({ ...s, subject: e.target.value }))}
                />
              </Field>
              <Field label="Topic">
                <Input
                  value={vals.topic}
                  onChange={(e) => setVals((s) => ({ ...s, topic: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={vals.date_planned}
                  onChange={(e) => setVals((s) => ({ ...s, date_planned: e.target.value }))}
                />
              </Field>
              <Field label="Duration (minutes)">
                <Input
                  type="number"
                  value={vals.duration_minutes}
                  onChange={(e) => setVals((s) => ({ ...s, duration_minutes: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Lesson description / objectives">
              <Textarea
                rows={5}
                value={vals.description}
                onChange={(e) => setVals((s) => ({ ...s, description: e.target.value }))}
              />
            </Field>
            <Field label="Homework">
              <Textarea
                rows={2}
                value={vals.homework_assignment}
                onChange={(e) => setVals((s) => ({ ...s, homework_assignment: e.target.value }))}
              />
            </Field>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={runAiDraft}
              disabled={drafting || saving}
              className="mr-auto"
            >
              {drafting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => save(false)}>
              Save draft
            </Button>
            <Button disabled={saving} onClick={() => save(true)}>
              <Send className="size-4" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/teacher/lesson-plans")({
  component: TeacherLessonPlans,
});
