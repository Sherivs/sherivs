import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  ssr: false,
  component: AdminAnalytics,
});

type AttRow = { date: string; status: string | null };
type FeeRow = {
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  created_at: string;
};
type StudentRow = { id: string; created_at: string };

function AdminAnalytics() {
  const { school, profile } = useApp();
  const sid = school?.id;

  const since30 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const attendance = useQuery<AttRow[]>({
    queryKey: ["adm-analytics-att", sid, since30],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("date, status")
        .eq("school_id", sid!)
        .gte("date", since30);
      if (error) throw new Error(error.message);
      return (data ?? []) as AttRow[];
    },
  });

  const fees = useQuery<FeeRow[]>({
    queryKey: ["adm-analytics-fees", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select("amount, paid_amount, status, created_at")
        .eq("school_id", sid!);
      if (error) throw new Error(error.message);
      return (data ?? []) as FeeRow[];
    },
  });

  const students = useQuery<StudentRow[]>({
    queryKey: ["adm-analytics-students", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, created_at")
        .eq("school_id", sid!);
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    },
  });

  // ----- derived ---------------------------------------------------------
  const att = attendance.data ?? [];
  const present = att.filter((a) => a.status === "present").length;
  const absent = att.filter((a) => a.status === "absent").length;
  const late = att.filter((a) => a.status === "late").length;
  const excused = att.filter((a) => a.status === "excused").length;
  const attRate = att.length ? Math.round(((present + late) / att.length) * 100) : 0;

  // daily attendance rate trend (last 14 days)
  const trend = useMemo(() => {
    const byDay = new Map<string, { p: number; t: number }>();
    att.forEach((a) => {
      const cur = byDay.get(a.date) ?? { p: 0, t: 0 };
      cur.t += 1;
      if (a.status === "present" || a.status === "late") cur.p += 1;
      byDay.set(a.date, cur);
    });
    const days: Array<{ date: string; rate: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      const v = byDay.get(k);
      days.push({ date: k, rate: v && v.t ? Math.round((v.p / v.t) * 100) : 0 });
    }
    return days;
  }, [att]);

  const f = fees.data ?? [];
  let billed = 0,
    collected = 0,
    outstanding = 0,
    paidCount = 0;
  f.forEach((r) => {
    const a = Number(r.amount ?? 0);
    const p = Number(r.paid_amount ?? 0);
    billed += a;
    collected += p;
    if (r.status !== "paid") outstanding += a - p;
    if (r.status === "paid") paidCount += 1;
  });
  const collectionRate = billed > 0 ? Math.round((collected / billed) * 100) : 0;

  const s = students.data ?? [];
  const enrolledThisMonth = s.filter(
    (st) => +new Date(st.created_at) >= +new Date(new Date().setDate(1)),
  ).length;

  const fmt = (n: number) => `₦${Math.round(n).toLocaleString()}`;

  return (
    <PortalPage title="Analytics" subtitle={`${school?.name ?? "School"} · last 30 days`}>
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          ← Dashboard
        </Link>
        <Link
          to="/admin/fees"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          Fees
        </Link>
        <Link
          to="/admin/students"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          Students
        </Link>
      </div>

      <SectionGrid>
        <StatCard
          label="Attendance rate (30d)"
          value={`${attRate}%`}
          hint={`${att.length} records`}
        />
        <StatCard label="Fee collection" value={`${collectionRate}%`} hint={fmt(collected)} />
        <StatCard
          label="Outstanding"
          value={fmt(outstanding)}
          hint={`${f.length - paidCount} unpaid`}
        />
        <StatCard label="New students (MTD)" value={enrolledThisMonth} hint={`${s.length} total`} />
      </SectionGrid>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="uos-card p-5">
          <h3 className="font-display text-base font-semibold">Daily attendance rate</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Present + late as a share of marked records, last 14 days.
          </p>
          {att.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No attendance recorded yet.</p>
          ) : (
            <div className="mt-5 flex h-44 items-end gap-1">
              {trend.map((d) => (
                <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.rate}%`}>
                  <div
                    className="w-full rounded-t bg-primary/70 transition group-hover:bg-primary"
                    style={{ height: `${Math.max(d.rate, 2)}%` }}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>{trend[0]?.date.slice(5)}</span>
            <span>{trend[trend.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        <div className="uos-card p-5">
          <h3 className="font-display text-base font-semibold">Attendance breakdown</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            All marks recorded in the last 30 days.
          </p>
          <div className="mt-4 space-y-3">
            {[
              { label: "Present", value: present, color: "bg-emerald-500" },
              { label: "Late", value: late, color: "bg-amber-500" },
              { label: "Absent", value: absent, color: "bg-rose-500" },
              { label: "Excused", value: excused, color: "bg-sky-500" },
            ].map((b) => {
              const pct = att.length ? Math.round((b.value / att.length) * 100) : 0;
              return (
                <div key={b.label}>
                  <div className="flex justify-between text-xs">
                    <span>{b.label}</span>
                    <span className="text-muted-foreground">
                      {b.value} · {pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted">
                    <div className={`h-full ${b.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="uos-card p-5 lg:col-span-2">
          <h3 className="font-display text-base font-semibold">Fee collection</h3>
          <p className="mt-1 text-xs text-muted-foreground">All-time billed vs. collected.</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Billed</div>
              <div className="mt-1 font-display text-2xl font-bold">{fmt(billed)}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Collected</div>
              <div className="mt-1 font-display text-2xl font-bold text-emerald-400">
                {fmt(collected)}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs uppercase text-muted-foreground">Outstanding</div>
              <div className="mt-1 font-display text-2xl font-bold text-rose-400">
                {fmt(outstanding)}
              </div>
            </div>
          </div>
          <div className="mt-5 h-3 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${collectionRate}%` }} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {collectionRate}% of billed amount collected · paid invoices: {paidCount} / {f.length}
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">Signed in as {profile?.full_name ?? "—"}</p>
    </PortalPage>
  );
}
