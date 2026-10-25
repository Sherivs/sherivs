import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { ScopeBanner, useScopeFilter } from "@/components/sds/scope-filter";
import { PortalPage, EmptyCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/teacher/gradebook")({
  ssr: false,
  component: GradebookPage,
});

type ClassRow = { id: string; name: string };
type Student = { id: string; full_name: string; admission_number: string | null };
type GradeRow = {
  id: string;
  student_id: string;
  ca_score: number | null;
  exam_score: number | null;
  total_score: number | null;
  grade: string | null;
  is_published: boolean | null;
};

type CellState = {
  ca: string;
  exam: string;
  published: boolean;
  dirty: boolean;
  savedId: string | null;
};

function clampScore(v: string): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function GradebookPage() {
  const { profile, school } = useApp();
  const qc = useQueryClient();
  const [classId, setClassId] = useState<string>("");
  const scope = useScopeFilter();
  const [subject, setSubject] = useState<string>("");
  const [term, setTerm] = useState<string>("1st");
  const [year, setYear] = useState<string>(() => {
    const n = new Date();
    const y = n.getFullYear();
    return n.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
  });
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [saving, setSaving] = useState(false);

  const classes = useQuery<ClassRow[]>({
    queryKey: ["teacher-classes", profile?.id, school?.id],
    enabled: !!profile?.id && !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id,name")
        .eq("school_id", school!.id)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as ClassRow[];
    },
  });

  const students = useQuery<Student[]>({
    queryKey: ["gradebook-students", classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, admission_number, user_id")
        .eq("class_id", classId);
      if (error) throw new Error(error.message);
      const list = (data ?? []) as {
        id: string;
        admission_number: string | null;
        user_id: string | null;
      }[];
      const userIds = list.map((s) => s.user_id).filter(Boolean) as string[];
      const names = userIds.length
        ? await supabase.from("users").select("id, full_name").in("id", userIds)
        : { data: [] as { id: string; full_name: string }[], error: null };
      const nameOf = new Map((names.data ?? []).map((u) => [u.id, u.full_name]));
      return list
        .map((s) => ({
          id: s.id,
          admission_number: s.admission_number,
          full_name: (s.user_id && nameOf.get(s.user_id)) || "(unnamed)",
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  const existing = useQuery<GradeRow[]>({
    queryKey: ["gradebook-existing", classId, subject, term, year],
    enabled: !!classId && !!subject && !!term && !!year,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("id, student_id, ca_score, exam_score, total_score, grade, is_published")
        .eq("class_id", classId)
        .eq("subject", subject)
        .eq("term", term)
        .eq("academic_year", year);
      if (error) throw new Error(error.message);
      return (data ?? []) as GradeRow[];
    },
  });

  // Seed cell state when students or existing grades load.
  useMemo(() => {
    if (!students.data) return;
    const next: Record<string, CellState> = {};
    const byStudent = new Map((existing.data ?? []).map((g) => [g.student_id, g]));
    for (const s of students.data) {
      const g = byStudent.get(s.id);
      next[s.id] = {
        ca: g?.ca_score?.toString() ?? "",
        exam: g?.exam_score?.toString() ?? "",
        published: g?.is_published === true,
        dirty: false,
        savedId: g?.id ?? null,
      };
    }
    setCells(next);
  }, [students.data, existing.data]);

  function update(studentId: string, patch: Partial<CellState>) {
    setCells((s) => ({ ...s, [studentId]: { ...s[studentId], ...patch, dirty: true } }));
  }

  async function saveAll() {
    if (!school || !profile || !classId || !subject || !term || !year) {
      toast.error("Pick class, subject, term and year first");
      return;
    }
    const dirtyEntries = Object.entries(cells).filter(([, c]) => c.dirty);
    if (dirtyEntries.length === 0) {
      toast.info("Nothing to save");
      return;
    }
    setSaving(true);
    try {
      let updated = 0;
      let inserted = 0;
      for (const [studentId, c] of dirtyEntries) {
        const ca = clampScore(c.ca);
        const exam = clampScore(c.exam);
        const payload = {
          student_id: studentId,
          class_id: classId,
          school_id: school.id,
          teacher_id: profile.id,
          subject,
          term,
          academic_year: year,
          ca_score: ca,
          exam_score: exam,
          is_published: c.published,
        };
        if (c.savedId) {
          const { error } = await supabase.from("grades").update(payload).eq("id", c.savedId);
          if (error) throw error;
          updated++;
        } else {
          const { error } = await supabase.from("grades").insert(payload);
          if (error) throw error;
          inserted++;
        }
      }
      toast.success(`Saved — ${inserted} added, ${updated} updated`);
      qc.invalidateQueries({ queryKey: ["gradebook-existing", classId, subject, term, year] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const ready = !!classId && !!subject && !!term && !!year;
  const dirtyCount = Object.values(cells).filter((c) => c.dirty).length;

  return (
    <PortalPage
      title="Gradebook"
      subtitle="Enter CA + exam scores for a whole class in one place. Total and grade are computed automatically."
      actions={
        <Button onClick={saveAll} disabled={saving || dirtyCount === 0}>
          <Save className="mr-2 size-4" /> Save {dirtyCount > 0 ? `(${dirtyCount})` : ""}
        </Button>
      }
    >
      <ScopeBanner scope={scope} />
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <Link
          to="/teacher/grades"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          Single-entry mode
        </Link>
      </div>

      <div className="uos-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Class">
          <select
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {scope.filterClasses(classes.data).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Mathematics"
          />
        </Field>
        <Field label="Term">
          <select
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          >
            <option value="1st">1st</option>
            <option value="2nd">2nd</option>
            <option value="3rd">3rd</option>
          </select>
        </Field>
        <Field label="Academic year">
          <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2025/2026" />
        </Field>
      </div>

      {!ready ? (
        <EmptyCard
          title="Pick class, subject, term and year"
          body="Choose the four fields above to load the gradebook."
        />
      ) : students.isLoading || existing.isLoading ? (
        <div className="uos-card p-8 text-center text-sm text-muted-foreground">
          Loading students…
        </div>
      ) : (students.data ?? []).length === 0 ? (
        <EmptyCard
          title="No students in this class"
          body="Add students to this class from the Admin → Students page."
        />
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-2 sm:hidden">
            {(students.data ?? []).map((s) => {
              const c = cells[s.id] ?? {
                ca: "",
                exam: "",
                published: false,
                dirty: false,
                savedId: null,
              };
              return (
                <div key={s.id} className="uos-card min-w-0 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={s.full_name}>
                        {s.full_name}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {s.admission_number ?? "—"}
                      </p>
                    </div>
                    {c.dirty && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-amber-300">
                        unsaved
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        CA
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        inputMode="decimal"
                        value={c.ca}
                        onChange={(e) => update(s.id, { ca: e.target.value })}
                        className="h-11"
                        aria-label={`CA score for ${s.full_name}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Exam
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        inputMode="decimal"
                        value={c.exam}
                        onChange={(e) => update(s.id, { exam: e.target.value })}
                        className="h-11"
                        aria-label={`Exam score for ${s.full_name}`}
                      />
                    </div>
                  </div>
                  <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={c.published}
                      onChange={(e) => update(s.id, { published: e.target.checked })}
                      className="size-5 accent-primary"
                    />
                    Publish to student &amp; parent
                  </label>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className="uos-card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3">Student</th>
                  <th className="p-3 w-24">Adm. no.</th>
                  <th className="p-3 w-28">CA (0-100)</th>
                  <th className="p-3 w-28">Exam (0-100)</th>
                  <th className="p-3 w-24 text-center">Publish</th>
                </tr>
              </thead>
              <tbody>
                {(students.data ?? []).map((s) => {
                  const c = cells[s.id] ?? {
                    ca: "",
                    exam: "",
                    published: false,
                    dirty: false,
                    savedId: null,
                  };
                  return (
                    <tr key={s.id} className="border-b border-border/40">
                      <td className="p-3 font-medium">
                        {s.full_name}
                        {c.dirty && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-300">
                            unsaved
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground font-mono text-xs">
                        {s.admission_number ?? "—"}
                      </td>
                      <td className="p-3">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={c.ca}
                          onChange={(e) => update(s.id, { ca: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={c.exam}
                          onChange={(e) => update(s.id, { exam: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={c.published}
                          onChange={(e) => update(s.id, { published: e.target.checked })}
                          className="size-4 accent-primary"
                          aria-label={`Publish grade for ${s.full_name}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
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
