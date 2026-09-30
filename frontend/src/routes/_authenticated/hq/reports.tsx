import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid, EmptyCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/hq/reports")({
  ssr: false,
  component: HqReportsPage,
});

function HqReportsPage() {
  const { school } = useApp();
  const schoolId = school?.id;

  const data = useQuery({
    queryKey: ["hq-reports", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const sid = schoolId!;
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [students, staff, attendance, fees, grades] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", sid),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("school_id", sid)
          .eq("role", "teacher"),
        supabase.from("attendance").select("status").eq("school_id", sid).gte("date", since),
        supabase.from("fees").select("amount, paid_amount, status").eq("school_id", sid),
        supabase.from("grades").select("total_score").eq("school_id", sid).eq("is_published", true),
      ]);
      const att = (attendance.data ?? []) as { status: string }[];
      const present = att.filter((a) => a.status === "present" || a.status === "late").length;
      const rate = att.length ? Math.round((present / att.length) * 100) : null;
      const feeRows = (fees.data ?? []) as {
        amount: number;
        paid_amount: number | null;
        status: string | null;
      }[];
      const billed = feeRows.reduce((a, r) => a + Number(r.amount), 0);
      const paid = feeRows.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
      const gradeRows = (grades.data ?? []) as { total_score: number | null }[];
      const avg = gradeRows.length
        ? gradeRows.reduce((a, r) => a + Number(r.total_score ?? 0), 0) / gradeRows.length
        : null;
      return {
        students: students.count ?? 0,
        staff: staff.count ?? 0,
        attRate: rate,
        attDays: att.length,
        billed,
        paid,
        outstanding: billed - paid,
        gradeAvg: avg,
        publishedGrades: gradeRows.length,
      };
    },
  });

  if (!schoolId) {
    return (
      <PortalPage title="School reports">
        <EmptyCard title="No school selected" body="Pick a tenant school to view its reports." />
      </PortalPage>
    );
  }

  const d = data.data;
  return (
    <PortalPage
      title="School reports"
      subtitle="Aggregated KPIs across academics, attendance, and finance."
    >
      <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">People</h2>
      <SectionGrid>
        <StatCard label="Students" value={d?.students ?? 0} />
        <StatCard label="Teachers" value={d?.staff ?? 0} />
        <StatCard
          label="Attendance (30d)"
          value={d?.attRate == null ? "—" : `${d.attRate}%`}
          hint={`${d?.attDays ?? 0} records`}
        />
        <StatCard
          label="Avg grade"
          value={d?.gradeAvg == null ? "—" : `${d.gradeAvg.toFixed(1)}%`}
          hint={`${d?.publishedGrades ?? 0} published`}
        />
      </SectionGrid>

      <h2 className="mt-10 font-display text-sm uppercase tracking-wide text-muted-foreground">
        Finance
      </h2>
      <SectionGrid>
        <StatCard label="Billed (₦)" value={(d?.billed ?? 0).toLocaleString()} />
        <StatCard label="Collected (₦)" value={(d?.paid ?? 0).toLocaleString()} />
        <StatCard label="Outstanding (₦)" value={(d?.outstanding ?? 0).toLocaleString()} />
        <StatCard
          label="Collection rate"
          value={!d || d.billed === 0 ? "—" : `${Math.round((d.paid / d.billed) * 100)}%`}
        />
      </SectionGrid>
    </PortalPage>
  );
}
