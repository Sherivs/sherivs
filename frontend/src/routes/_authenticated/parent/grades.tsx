import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/parent/grades")({
  ssr: false,
  component: ParentGradesPage,
});

type Child = { student_id: string; full_name: string };
type Grade = {
  id: string;
  subject: string | null;
  term: string | null;
  academic_year: string | null;
  total_score: number | null;
  grade: string | null;
  grade_remark: string | null;
};

function ParentGradesPage() {
  const { profile } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  const children = useQuery<Child[]>({
    queryKey: ["parent-children-grades", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: map } = await supabase
        .from("parent_student_map")
        .select("student_id")
        .eq("parent_id", profile!.id);
      const ids = (map ?? []).map((r) => r.student_id as string);
      if (ids.length === 0) return [];
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id")
        .in("id", ids);
      const uids = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const { data: users } = uids.length
        ? await supabase.from("users").select("id, full_name").in("id", uids)
        : { data: [] as { id: string; full_name: string }[] };
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name as string]));
      return (students ?? []).map((s) => ({
        student_id: s.id as string,
        full_name: s.user_id ? (nameOf.get(s.user_id as string) ?? "Child") : "Child",
      }));
    },
  });

  useEffect(() => {
    if (!selected && children.data?.[0]) setSelected(children.data[0].student_id);
  }, [children.data, selected]);

  const grades = useQuery<Grade[]>({
    queryKey: ["parent-grades-detail", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("id, subject, term, academic_year, total_score, grade, grade_remark")
        .eq("student_id", selected!)
        .eq("is_published", true)
        .order("academic_year", { ascending: false })
        .order("term", { ascending: false });
      return (data ?? []) as unknown as Grade[];
    },
  });

  if ((children.data?.length ?? 0) === 0) {
    return (
      <PortalPage title="Children's grades">
        <EmptyCard
          title="No children linked"
          body="Once your child is linked to your account, published grades will appear here."
        />
      </PortalPage>
    );
  }

  return (
    <PortalPage title="Children's grades" subtitle="Published grades, organized by child.">
      <div className="mb-4 flex flex-wrap gap-2">
        {(children.data ?? []).map((c) => (
          <button
            key={c.student_id}
            type="button"
            onClick={() => setSelected(c.student_id)}
            className={
              "rounded-md border px-3 py-1.5 text-sm " +
              (selected === c.student_id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/40")
            }
          >
            {c.full_name}
          </button>
        ))}
      </div>

      <div className="uos-card overflow-x-auto">
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
            {(grades.data?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No published grades yet for this child.
                </td>
              </tr>
            ) : (
              grades.data!.map((g) => (
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
