/**
 * Admin report-card publishing console.
 * Filter by class + term + academic year, see counts of draft vs published
 * grades, and bulk publish/unpublish for a whole class+term in one click.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { notifyGradesPublished } from "@/lib/runtime/scholar/notifications-fanout.functions";

export const Route = createFileRoute("/_authenticated/admin/report-cards")({
  ssr: false,
  component: AdminReportCardsPage,
});

type ClassRow = { id: string; name: string };
type StudentRow = {
  id: string;
  admission_number: string | null;
  user_id: string | null;
  full_name: string;
};
type GradeRow = {
  id: string;
  student_id: string;
  subject: string;
  total_score: number | null;
  grade: string | null;
  is_published: boolean | null;
  term: string | null;
  academic_year: string | null;
};

const TERMS = ["First", "Second", "Third"];

function currentAcademicYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

function AdminReportCardsPage() {
  const { school } = useApp();
  const qc = useQueryClient();
  const schoolId = school?.id;

  const [classId, setClassId] = useState<string | null>(null);
  const [term, setTerm] = useState<string>(TERMS[0]);
  const [year, setYear] = useState<string>(currentAcademicYear());
  const [busy, setBusy] = useState(false);

  const classes = useQuery<ClassRow[]>({
    queryKey: ["admin-rc-classes", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", schoolId!)
        .order("name");
      return (data ?? []) as ClassRow[];
    },
  });

  useEffect(() => {
    if (!classId && classes.data?.[0]) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  const students = useQuery<StudentRow[]>({
    queryKey: ["admin-rc-students", schoolId, classId],
    enabled: !!schoolId && !!classId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, admission_number, user_id")
        .eq("school_id", schoolId!)
        .eq("class_id", classId!)
        .eq("is_active", true);
      const list = (data ?? []) as {
        id: string;
        admission_number: string | null;
        user_id: string | null;
      }[];
      const uids = list.map((s) => s.user_id).filter((u): u is string => !!u);
      const nameOf: Record<string, string> = {};
      if (uids.length) {
        const u = await supabase.from("users").select("id, full_name").in("id", uids);
        (u.data ?? []).forEach((r) => (nameOf[r.id] = r.full_name as string));
      }
      return list
        .map((s) => ({
          ...s,
          full_name:
            (s.user_id && nameOf[s.user_id]) || `Student ${s.admission_number ?? s.id.slice(0, 6)}`,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  const studentIds = useMemo(() => (students.data ?? []).map((s) => s.id), [students.data]);

  const grades = useQuery<GradeRow[]>({
    queryKey: ["admin-rc-grades", schoolId, classId, term, year, studentIds.join(",")],
    enabled: !!schoolId && !!classId && studentIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("id, student_id, subject, total_score, grade, is_published, term, academic_year")
        .eq("school_id", schoolId!)
        .in("student_id", studentIds)
        .eq("term", term)
        .eq("academic_year", year);
      return (data ?? []) as GradeRow[];
    },
  });

  const byStudent = useMemo(() => {
    const m = new Map<string, GradeRow[]>();
    (grades.data ?? []).forEach((g) => {
      if (!m.has(g.student_id)) m.set(g.student_id, []);
      m.get(g.student_id)!.push(g);
    });
    return m;
  }, [grades.data]);

  const totals = useMemo(() => {
    const all = grades.data ?? [];
    const published = all.filter((g) => g.is_published).length;
    return { total: all.length, published, draft: all.length - published };
  }, [grades.data]);

  const notifyPublished = useServerFn(notifyGradesPublished);

  async function setPublishedFor(ids: string[], next: boolean) {
    if (!ids.length) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("grades").update({ is_published: next }).in("id", ids);
      if (error) throw new Error(error.message);
      toast.success(`${next ? "Published" : "Unpublished"} ${ids.length} record(s)`);
      qc.invalidateQueries({ queryKey: ["admin-rc-grades"] });
      if (next && classId) {
        try {
          const r = await notifyPublished({
            data: { class_id: classId, term, academic_year: year },
          });
          if (r.notified > 0) toast.success(`Notified ${r.notified} parent(s)/student(s)`);
        } catch (e) {
          // notification failure should not block the publish
          console.warn("notifyGradesPublished failed", e);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalPage
      title="Report cards"
      subtitle="Bulk-publish report-card grades for a class and term. Published rows become visible to students and parents."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          to="/admin/grades"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Grades
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={classId ?? ""}
          onChange={(e) => setClassId(e.target.value || null)}
        >
          <option value="" disabled>
            Class…
          </option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        >
          {TERMS.map((t) => (
            <option key={t} value={t}>
              {t} term
            </option>
          ))}
        </select>
        <input
          className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="2025/2026"
        />
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || totals.published === 0}
            onClick={() =>
              setPublishedFor(
                (grades.data ?? []).filter((g) => g.is_published).map((g) => g.id),
                false,
              )
            }
          >
            Unpublish all
          </Button>
          <Button
            size="sm"
            disabled={busy || totals.draft === 0}
            onClick={() =>
              setPublishedFor(
                (grades.data ?? []).filter((g) => !g.is_published).map((g) => g.id),
                true,
              )
            }
          >
            Publish all drafts
          </Button>
        </div>
      </div>

      <SectionGrid>
        <StatCard label="Grade rows" value={totals.total} />
        <StatCard label="Published" value={totals.published} />
        <StatCard label="Drafts" value={totals.draft} />
      </SectionGrid>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Student</th>
              <th className="px-3 py-2 text-center font-medium">Subjects</th>
              <th className="px-3 py-2 text-center font-medium">Published</th>
              <th className="px-3 py-2 text-center font-medium">Drafts</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(students.data ?? []).map((s) => {
              const rows = byStudent.get(s.id) ?? [];
              const pub = rows.filter((g) => g.is_published).length;
              const drf = rows.length - pub;
              return (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.full_name}</div>
                    {s.admission_number && (
                      <div className="text-[11px] text-muted-foreground">{s.admission_number}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">{rows.length}</td>
                  <td className="px-3 py-2 text-center text-emerald-500">{pub}</td>
                  <td className="px-3 py-2 text-center text-amber-500">{drf}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || drf === 0}
                        onClick={() =>
                          setPublishedFor(
                            rows.filter((g) => !g.is_published).map((g) => g.id),
                            true,
                          )
                        }
                      >
                        Publish
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || pub === 0}
                        onClick={() =>
                          setPublishedFor(
                            rows.filter((g) => g.is_published).map((g) => g.id),
                            false,
                          )
                        }
                      >
                        Unpublish
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(students.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {classId ? "No active students in this class." : "Pick a class above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PortalPage>
  );
}
