import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard, StatCard, SectionGrid } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/student/grades")({
  ssr: false,
  component: StudentGradesPage,
});

type Grade = {
  id: string;
  subject: string | null;
  term: string | null;
  academic_year: string | null;
  total_score: number | null;
  grade: string | null;
  grade_remark: string | null;
};

function StudentGradesPage() {
  const { profile } = useApp();
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", profile.id)
        .maybeSingle();
      setStudentId((data?.id as string) ?? null);
    })();
  }, [profile?.id]);

  const grades = useQuery<Grade[]>({
    queryKey: ["student-grades", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("id, subject, term, academic_year, total_score, grade, grade_remark")
        .eq("student_id", studentId!)
        .eq("is_published", true)
        .order("academic_year", { ascending: false })
        .order("term", { ascending: false });
      return (data ?? []) as unknown as Grade[];
    },
  });

  if (!studentId && profile?.id) {
    return (
      <PortalPage title="My grades">
        <EmptyCard
          title="Not linked yet"
          body="Your account isn't linked to a student record. Ask your school admin."
        />
      </PortalPage>
    );
  }

  const rows = grades.data ?? [];
  const avg = rows.length
    ? rows.reduce((a, r) => a + Number(r.total_score ?? 0), 0) / rows.length
    : null;
  const subjects = new Set(rows.map((r) => r.subject).filter(Boolean)).size;

  return (
    <PortalPage title="My grades" subtitle="Your published grades, term by term.">
      <SectionGrid>
        <StatCard label="Average" value={avg == null ? "—" : `${avg.toFixed(1)}%`} />
        <StatCard label="Subjects" value={subjects} />
        <StatCard label="Published grades" value={rows.length} />
        <StatCard
          label="Best subject"
          value={
            rows.length
              ? (rows
                  .slice()
                  .sort((a, b) => Number(b.total_score ?? 0) - Number(a.total_score ?? 0))[0]
                  .subject ?? "—")
              : "—"
          }
        />
      </SectionGrid>

      <div className="uos-card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3">Subject</th>
              <th className="p-3">Term</th>
              <th className="p-3">Year</th>
              <th className="p-3">Score</th>
              <th className="p-3">Grade</th>
              <th className="p-3">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No published grades yet.
                </td>
              </tr>
            ) : (
              rows.map((g) => (
                <tr key={g.id} className="border-b border-border/40">
                  <td className="p-3 font-medium">{g.subject ?? "—"}</td>
                  <td className="p-3">{g.term ?? "—"}</td>
                  <td className="p-3">{g.academic_year ?? "—"}</td>
                  <td className="p-3 font-mono">{g.total_score ?? "—"}</td>
                  <td className="p-3">{g.grade ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{g.grade_remark ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PortalPage>
  );
}
