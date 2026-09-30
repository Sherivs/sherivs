import { createFileRoute, Link } from "@tanstack/react-router";
import { SkeletonDashboard } from "@/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";

export const Route = createFileRoute("/_authenticated/hq/dashboard")({
  ssr: false,
  component: HqDashboard,
});

function HqDashboard() {
  const { school, profile } = useApp();
  const schoolId = school?.id;

  const stats = useQuery({
    queryKey: ["hq-stats", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const sid = schoolId!;
      const [users, students, classes] = await Promise.all([
        supabase.from("users").select("id", { count: "exact", head: true }).eq("school_id", sid),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", sid),
        supabase.from("classes").select("id", { count: "exact", head: true }).eq("school_id", sid),
      ]);
      return {
        users: users.count ?? 0,
        students: students.count ?? 0,
        classes: classes.count ?? 0,
      };
    },
  });

  const staff = useQuery({
    queryKey: ["hq-staff", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const sid = schoolId!;
      const [teachers, activeUsers] = await Promise.all([
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("school_id", sid)
          .eq("role", "teacher"),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("school_id", sid)
          .eq("is_active", true),
      ]);
      return { teachers: teachers.count ?? 0, activeUsers: activeUsers.count ?? 0 };
    },
  });

  const finance = useQuery({
    queryKey: ["hq-finance", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("fees")
        .select("amount, paid_amount, status")
        .eq("school_id", schoolId!);
      let billed = 0,
        collected = 0,
        outstanding = 0;
      (data ?? []).forEach((f) => {
        const a = Number(f.amount ?? 0);
        const p = Number(f.paid_amount ?? 0);
        billed += a;
        collected += p;
        if (f.status !== "paid") outstanding += a - p;
      });
      return { billed, collected, outstanding };
    },
  });

  const fmt = (n: number) => `₦${n.toLocaleString()}`;

  if (stats.isLoading) return <SkeletonDashboard />;

  return (
    <PortalPage
      title={`Welcome, ${profile?.full_name?.split(" ")[0] ?? "HQ"}`}
      subtitle="Group-level oversight across this school"
    >
      <PreviewPublicSiteCard />
      <SectionGrid>
        <StatCard label="Total users" value={stats.data?.users ?? 0} />
        <StatCard label="Total students" value={stats.data?.students ?? 0} />
        <StatCard label="Total classes" value={stats.data?.classes ?? 0} />
        <StatCard
          label="Subscription"
          value={(school?.subscription_tier as string | undefined) ?? "—"}
        />
      </SectionGrid>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="uos-card p-5">
          <h3 className="font-display text-base font-semibold">Staff overview</h3>
          <p className="mt-1 text-xs text-muted-foreground">Active accounts in this school.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Teachers</div>
              <div className="mt-1 font-display text-2xl font-bold">
                {staff.data?.teachers ?? 0}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Active users</div>
              <div className="mt-1 font-display text-2xl font-bold">
                {staff.data?.activeUsers ?? 0}
              </div>
            </div>
          </div>
        </div>

        <div className="uos-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Finance snapshot</h3>
            <Link to="/hq/finance" className="text-xs text-primary hover:underline">
              Open finance →
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            All-time fee billing across the school.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Billed</div>
              <div className="mt-1 font-display text-lg font-bold">
                {fmt(finance.data?.billed ?? 0)}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Collected</div>
              <div className="mt-1 font-display text-lg font-bold text-emerald-400">
                {fmt(finance.data?.collected ?? 0)}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Outstanding</div>
              <div className="mt-1 font-display text-lg font-bold text-rose-400">
                {fmt(finance.data?.outstanding ?? 0)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalPage>
  );
}
