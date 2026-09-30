import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { ReportCard } from "@/components/report-card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/parent/report-cards")({
  ssr: false,
  component: ParentReportCardsPage,
});

type Child = { student_id: string; full_name: string | null; admission_number: string | null };

function ParentReportCardsPage() {
  const { profile } = useApp();
  const [term, setTerm] = useState("");
  const [year, setYear] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const children = useQuery<Child[]>({
    queryKey: ["parent-children-full", profile?.id],
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
        .select("id, admission_number, user_id")
        .in("id", ids);
      const userIds = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const { data: users } = userIds.length
        ? await supabase.from("users").select("id, full_name").in("id", userIds)
        : { data: [] as { id: string; full_name: string }[] };
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name as string]));
      return (students ?? []).map((s) => ({
        student_id: s.id as string,
        admission_number: (s.admission_number as string) ?? null,
        full_name: s.user_id ? (nameOf.get(s.user_id as string) ?? null) : null,
      }));
    },
  });

  const active = selected ?? children.data?.[0]?.student_id ?? null;

  return (
    <PortalPage
      title="Children's report cards"
      subtitle="View published grades for each of your children."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          to="/parent/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Dashboard
        </Link>
        <Input
          placeholder="Term (e.g. 1st)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="max-w-[140px]"
        />
        <Input
          placeholder="Year (e.g. 2025/2026)"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="max-w-[180px]"
        />
      </div>

      {(children.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          No children linked to your account yet. Ask the school admin to link your child.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {children.data!.map((c) => (
              <button
                key={c.student_id}
                type="button"
                onClick={() => setSelected(c.student_id)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm " +
                  (active === c.student_id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/40")
                }
              >
                {c.full_name ?? `Student ${c.student_id.slice(0, 6)}`}
                {c.admission_number ? ` · #${c.admission_number}` : ""}
              </button>
            ))}
          </div>
          {active && (
            <ReportCard studentId={active} term={term || null} academicYear={year || null} />
          )}
        </>
      )}
    </PortalPage>
  );
}
