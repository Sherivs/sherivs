import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { ReportCard } from "@/components/report-card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/student/report-card")({
  ssr: false,
  component: StudentReportCardPage,
});

function StudentReportCardPage() {
  const { profile } = useApp();
  const [term, setTerm] = useState("");
  const [year, setYear] = useState("");

  const student = useQuery({
    queryKey: ["self-student", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return data as { id: string } | null;
    },
  });

  return (
    <PortalPage title="My report card" subtitle="View your published grades for any term.">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          to="/student/dashboard"
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
      {student.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !student.data ? (
        <p className="text-sm text-muted-foreground">
          No student record is linked to your account yet.
        </p>
      ) : (
        <ReportCard studentId={student.data.id} term={term || null} academicYear={year || null} />
      )}
    </PortalPage>
  );
}
