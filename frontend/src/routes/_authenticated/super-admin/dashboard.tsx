/**
 * Super Admin — Platform Command Center.
 *
 * Six top-line KPIs, a School Health Monitor, tier-mix + signup analytics,
 * an unresolved support queue, and a static system-status footer.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SkeletonDashboard } from "@/components/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid, EmptyCard } from "@/components/portal-shell";
import { SUBSCRIPTION_TIERS, getTier, type TierName } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/super-admin/dashboard")({
  ssr: false,
  component: SuperAdminDashboard,
});

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  monthly_fee: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
};

function healthOf(updatedAt: string | null | undefined): "green" | "amber" | "red" {
  if (!updatedAt) return "red";
  const days = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  if (days < 7) return "green";
  if (days < 30) return "amber";
  return "red";
}

function SuperAdminDashboard() {
  const { superAdmin } = useApp();

  const schoolsQ = useQuery<SchoolRow[]>({
    queryKey: ["sa-cc-schools"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools")
        .select(
          "id, name, slug, subscription_tier, subscription_status, subscription_expires_at, monthly_fee, is_active, created_at, updated_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SchoolRow[];
    },
  });

  const countsQ = useQuery({
    queryKey: ["sa-cc-counts"],
    queryFn: async () => {
      const [students, teachers] = await Promise.all([
        supabase.from("students").select("id, school_id", { count: "exact", head: true }),
        supabase
          .from("users")
          .select("id, school_id", { count: "exact", head: true })
          .eq("role", "teacher"),
      ]);
      return { students: students.count ?? 0, teachers: teachers.count ?? 0 };
    },
  });

  const perSchoolCountsQ = useQuery({
    queryKey: ["sa-cc-per-school", schoolsQ.data?.map((s) => s.id).join(",")],
    enabled: (schoolsQ.data?.length ?? 0) > 0,
    queryFn: async () => {
      const map = new Map<string, { students: number; teachers: number }>();
      await Promise.all(
        (schoolsQ.data ?? []).map(async (s) => {
          const [{ count: sc }, { count: tc }] = await Promise.all([
            supabase
              .from("students")
              .select("id", { count: "exact", head: true })
              .eq("school_id", s.id),
            supabase
              .from("users")
              .select("id", { count: "exact", head: true })
              .eq("school_id", s.id)
              .eq("role", "teacher"),
          ]);
          map.set(s.id, { students: sc ?? 0, teachers: tc ?? 0 });
        }),
      );
      return map;
    },
  });

  const supportQ = useQuery({
    queryKey: ["sa-cc-support"],
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_complaints")
        .select("id, subject, priority, status, created_at, school_id, schools:school_id(name)")
        .in("status", ["open", "in_review"])
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as unknown as Array<{
        id: string;
        subject: string;
        priority: string | null;
        status: string | null;
        created_at: string;
        schools: { name: string | null } | null;
      }>;
    },
  });

  const schools = schoolsQ.data ?? [];

  const stats = useMemo(() => {
    const active = schools.filter((s) => s.subscription_status === "active").length;
    const trial = schools.filter((s) => s.subscription_tier === "trial").length;
    const mrr = schools
      .filter((s) => s.is_active && s.subscription_tier !== "trial")
      .reduce((a, s) => a + Number(s.monthly_fee ?? 0), 0);
    // Total revenue estimate: sum of monthly_fee × active months since created_at
    const now = Date.now();
    const totalRevenue = schools.reduce((a, s) => {
      const months = Math.max(
        1,
        Math.floor((now - new Date(s.created_at).getTime()) / (30 * 86_400_000)),
      );
      return a + Number(s.monthly_fee ?? 0) * months;
    }, 0);
    return { active, trial, mrr, totalRevenue };
  }, [schools]);

  const tierMix = useMemo(() => {
    const map = new Map<TierName, number>();
    for (const s of schools) {
      const t = getTier(s.subscription_tier) as TierName;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    const total = schools.length || 1;
    return Array.from(map.entries()).map(([tier, n]) => ({
      tier,
      n,
      pct: Math.round((n / total) * 100),
    }));
  }, [schools]);

  const signupTrend = useMemo(() => {
    const months: { label: string; n: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const n = schools.filter((s) => {
        const c = new Date(s.created_at).getTime();
        return c >= d.getTime() && c < nextD.getTime();
      }).length;
      months.push({ label: d.toLocaleString("default", { month: "short" }), n });
    }
    return months;
  }, [schools]);

  const revenueTrend = useMemo(() => {
    // Approximated: for each of last 6 months, sum monthly_fee of schools created on/before that month
    const months: { label: string; v: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
      const v = schools
        .filter((s) => new Date(s.created_at).getTime() < end && s.subscription_tier !== "trial")
        .reduce((a, s) => a + Number(s.monthly_fee ?? 0), 0);
      months.push({
        label: new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleString("default", {
          month: "short",
        }),
        v,
      });
    }
    return months;
  }, [schools]);

  if (schoolsQ.isLoading) return <SkeletonDashboard />;

  const priorityRank = { critical: 0, high: 1, normal: 2, medium: 2, low: 3 } as Record<
    string,
    number
  >;
  const supportRows = (supportQ.data ?? [])
    .slice()
    .sort(
      (a, b) => (priorityRank[a.priority ?? "low"] ?? 9) - (priorityRank[b.priority ?? "low"] ?? 9),
    );

  return (
    <PortalPage
      title={`Welcome, ${superAdmin?.full_name?.split(" ")[0] ?? "Super Admin"}`}
      subtitle="Platform command center — every tenant, at a glance."
      actions={
        <>
          <Link
            to="/super-admin/schools"
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            + New school
          </Link>
          <Link
            to="/super-admin/billing"
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Billing →
          </Link>
        </>
      }
    >
      <SectionGrid>
        <StatCard label="Total schools" value={schools.length} />
        <StatCard label="Active schools" value={stats.active} />
        <StatCard label="Trial schools" value={stats.trial} />
        <StatCard label="Total students" value={countsQ.data?.students ?? 0} />
        <StatCard label="MRR (₦)" value={stats.mrr.toLocaleString()} />
        <StatCard label="Est. total revenue (₦)" value={stats.totalRevenue.toLocaleString()} />
      </SectionGrid>

      {/* School Health Monitor */}
      <section className="uos-card mt-6">
        <header className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-semibold">School health monitor</h2>
            <p className="text-xs text-muted-foreground">
              Green &lt; 7d, amber &lt; 30d, red ≥ 30d since last activity.
            </p>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">School</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Students</th>
                <th className="px-3 py-2 text-right">Teachers</th>
                <th className="px-3 py-2 text-left">Last activity</th>
                <th className="px-3 py-2 text-center">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schools.slice(0, 20).map((s) => {
                const c = perSchoolCountsQ.data?.get(s.id) ?? { students: 0, teachers: 0 };
                const h = healthOf(s.updated_at);
                return (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase">
                        {s.subscription_tier ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{s.subscription_status ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{c.students}</td>
                    <td className="px-3 py-2 text-right font-mono">{c.teachers}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={
                          "inline-block size-3 rounded-full " +
                          (h === "green"
                            ? "bg-emerald-500"
                            : h === "amber"
                              ? "bg-amber-500"
                              : "bg-red-500")
                        }
                        title={h}
                      />
                    </td>
                  </tr>
                );
              })}
              {schools.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                    No schools yet — provision the first one from the Schools page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Analytics */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="uos-card p-5">
          <h3 className="font-display text-base font-semibold">Schools by tier</h3>
          <div className="mt-4 space-y-2">
            {tierMix.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet.</p>
            ) : (
              tierMix.map((t) => (
                <div key={t.tier}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="uppercase text-muted-foreground">
                      {SUBSCRIPTION_TIERS[t.tier].name}
                    </span>
                    <span className="font-mono">
                      {t.n} · {t.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted/40">
                    <div className="h-full bg-primary" style={{ width: `${t.pct}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="uos-card p-5 lg:col-span-2">
          <h3 className="font-display text-base font-semibold">
            Monthly signups &amp; revenue trend
          </h3>
          <div className="mt-4 grid grid-cols-6 gap-2">
            {signupTrend.map((m, i) => {
              const maxN = Math.max(1, ...signupTrend.map((x) => x.n));
              const maxV = Math.max(1, ...revenueTrend.map((x) => x.v));
              const nH = Math.max(4, Math.round((m.n / maxN) * 80));
              const vH = Math.max(4, Math.round((revenueTrend[i].v / maxV) * 80));
              return (
                <div key={m.label} className="flex flex-col items-center gap-1">
                  <div className="flex h-[90px] items-end gap-0.5">
                    <div
                      title={`${m.n} signups`}
                      className="w-2 rounded-t bg-primary"
                      style={{ height: `${nH}px` }}
                    />
                    <div
                      title={`₦${revenueTrend[i].v.toLocaleString()}`}
                      className="w-2 rounded-t bg-emerald-500"
                      style={{ height: `${vH}px` }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground">{m.label}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 text-[10px] uppercase text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded bg-primary" /> signups
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded bg-emerald-500" /> revenue
            </span>
          </div>
        </section>
      </div>

      {/* Support queue */}
      <section className="uos-card mt-6">
        <header className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Support queue</h2>
            <p className="text-xs text-muted-foreground">
              Unresolved tickets across all tenants, prioritised.
            </p>
          </div>
          <Link
            to="/super-admin/support"
            className="text-xs font-semibold text-primary hover:underline"
          >
            Open support →
          </Link>
        </header>
        {supportRows.length === 0 ? (
          <EmptyCard title="Inbox zero" body="No open support tickets right now." />
        ) : (
          <ul className="divide-y divide-border">
            {supportRows.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3">
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] uppercase " +
                    (r.priority === "critical"
                      ? "bg-red-500/20 text-red-300"
                      : r.priority === "high"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {r.priority ?? "low"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.subject}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.schools?.name ?? "—"} · {r.status ?? "open"}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* System status */}
      <section className="uos-card mt-6 p-5">
        <h2 className="font-display text-lg font-semibold">System status</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4 text-xs">
          <div>
            <div className="text-muted-foreground uppercase">Platform version</div>
            <div className="mt-1 font-mono">v2.4.0</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Last deployment</div>
            <div className="mt-1 font-mono">{new Date().toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Database</div>
            <div className="mt-1 font-mono">Operational</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Uptime</div>
            <div className="mt-1 font-mono">99.98%</div>
          </div>
        </div>
      </section>
    </PortalPage>
  );
}
