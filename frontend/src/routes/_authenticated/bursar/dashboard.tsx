import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";
import { SkeletonDashboard } from "@/components/skeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bursar/dashboard")({
  ssr: false,
  component: BursarDashboard,
});

type FeeRow = {
  id: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  paid_at: string | null;
  due_date: string | null;
  fee_type: string;
  term: string | null;
  academic_year: string | null;
  student_id: string;
  paystack_reference: string | null;
};

type StudentLite = { id: string; full_name: string | null; class_id: string | null };

function fmtNaira(n: number) {
  return "₦" + Math.round(n).toLocaleString();
}

function BursarDashboard() {
  const { school, profile } = useApp();
  const schoolId = school?.id;
  const qc = useQueryClient();

  const fees = useQuery<FeeRow[]>({
    queryKey: ["bursar-dash-fees", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select(
          "id, amount, paid_amount, status, paid_at, due_date, fee_type, term, academic_year, student_id, paystack_reference",
        )
        .eq("school_id", schoolId!)
        .order("paid_at", { ascending: false, nullsFirst: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as FeeRow[];
    },
  });

  const students = useQuery<Record<string, StudentLite>>({
    queryKey: ["bursar-dash-students", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, user_id, class_id")
        .eq("school_id", schoolId!);
      const rows = (data ?? []) as Array<{
        id: string;
        user_id: string | null;
        class_id: string | null;
      }>;
      const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
      const map: Record<string, StudentLite> = {};
      const names: Record<string, string> = {};
      if (userIds.length) {
        const { data: us } = await supabase.from("users").select("id, full_name").in("id", userIds);
        (us ?? []).forEach((u) => {
          names[u.id as string] = (u.full_name as string) ?? "";
        });
      }
      rows.forEach((s) => {
        map[s.id] = {
          id: s.id,
          class_id: s.class_id,
          full_name: s.user_id ? (names[s.user_id] ?? null) : null,
        };
      });
      return map;
    },
  });

  const classes = useQuery<Record<string, string>>({
    queryKey: ["bursar-dash-classes", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase.from("classes").select("id, name").eq("school_id", schoolId!);
      const map: Record<string, string> = {};
      (data ?? []).forEach((c) => {
        map[c.id as string] = c.name as string;
      });
      return map;
    },
  });

  // Realtime — refresh on any fee change
  useEffect(() => {
    if (!schoolId) return;
    const ch = supabase
      .channel("bursar-fees-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fees", filter: `school_id=eq.${schoolId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["bursar-dash-fees", schoolId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [schoolId, qc]);

  const stats = useMemo(() => {
    const rows = fees.data ?? [];
    const billed = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
    const collected = rows.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    const outstanding = Math.max(0, billed - collected);
    const rate = billed > 0 ? (collected / billed) * 100 : 0;
    const today = new Date().toISOString().slice(0, 10);
    const collectedToday = rows
      .filter((r) => r.paid_at?.slice(0, 10) === today)
      .reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    const now = Date.now();
    const defaulters = new Set(
      rows
        .filter((r) => {
          const outstandingRow = Number(r.amount ?? 0) - Number(r.paid_amount ?? 0);
          return outstandingRow > 0 && r.due_date && new Date(r.due_date).getTime() < now;
        })
        .map((r) => r.student_id),
    ).size;
    return { billed, collected, outstanding, rate, collectedToday, defaulters };
  }, [fees.data]);

  // 8-week revenue trend
  const weekly = useMemo(() => {
    const rows = fees.data ?? [];
    const buckets: { label: string; amount: number }[] = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      const s = start.getTime(),
        e = end.getTime() + 86400000;
      const amount = rows
        .filter(
          (r) =>
            r.paid_at && new Date(r.paid_at).getTime() >= s && new Date(r.paid_at).getTime() < e,
        )
        .reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
      buckets.push({ label: `W${8 - i}`, amount });
    }
    return buckets;
  }, [fees.data]);

  const maxWeek = Math.max(1, ...weekly.map((w) => w.amount));

  // Payment "channel" breakdown — infer from paystack_reference presence
  const channels = useMemo(() => {
    const rows = (fees.data ?? []).filter((r) => Number(r.paid_amount ?? 0) > 0);
    const online = rows
      .filter((r) => r.paystack_reference)
      .reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    const manual = rows
      .filter((r) => !r.paystack_reference)
      .reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    return { online, manual };
  }, [fees.data]);

  // Defaulters (top 10 by amount overdue > 30 days)
  const defaultersList = useMemo(() => {
    const rows = fees.data ?? [];
    const now = Date.now();
    const perStudent = new Map<string, { due: number; days: number }>();
    rows.forEach((r) => {
      const out = Number(r.amount ?? 0) - Number(r.paid_amount ?? 0);
      if (out <= 0 || !r.due_date) return;
      const days = Math.floor((now - new Date(r.due_date).getTime()) / 86400000);
      if (days < 30) return;
      const cur = perStudent.get(r.student_id) ?? { due: 0, days: 0 };
      perStudent.set(r.student_id, { due: cur.due + out, days: Math.max(cur.days, days) });
    });
    return Array.from(perStudent.entries())
      .map(([sid, v]) => ({ sid, ...v }))
      .sort((a, b) => b.due - a.due)
      .slice(0, 10);
  }, [fees.data]);

  const recentPayments = useMemo(
    () => (fees.data ?? []).filter((r) => r.paid_at).slice(0, 20),
    [fees.data],
  );

  const reconciliation = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todays = (fees.data ?? []).filter((r) => r.paid_at?.slice(0, 10) === today);
    const online = todays
      .filter((r) => r.paystack_reference)
      .reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    const manual = todays
      .filter((r) => !r.paystack_reference)
      .reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    return { online, manual, discrepancy: false, count: todays.length };
  }, [fees.data]);

  async function sendReminder(studentId: string) {
    // Look up parent user via students table, fallback to student's user_id
    const { data: s } = await supabase
      .from("students")
      .select("user_id, parent_id")
      .eq("id", studentId)
      .maybeSingle();
    const target = (s?.parent_id as string | null) ?? (s?.user_id as string | null);
    if (!target) {
      toast.error("No user to notify for this student");
      return;
    }
    const { error } = await supabase.from("notifications").insert({
      school_id: schoolId!,
      user_id: target,
      title: "Fee reminder",
      message: "You have outstanding fees overdue. Please pay to avoid service disruption.",
      type: "fees",
    });
    if (error) toast.error(error.message);
    else toast.success("Reminder sent");
  }

  if (fees.isLoading) return <SkeletonDashboard />;

  return (
    <PortalPage
      title={`Welcome, ${profile?.full_name?.split(" ")[0] ?? "Bursar"}`}
      subtitle="Financial command center — billing, collections and reconciliation"
    >
      <PreviewPublicSiteCard />

      <SectionGrid>
        <StatCard label="Billed (term)" value={fmtNaira(stats.billed)} />
        <StatCard label="Collected" value={fmtNaira(stats.collected)} />
        <StatCard label="Outstanding" value={fmtNaira(stats.outstanding)} />
        <StatCard label="Collection rate" value={`${stats.rate.toFixed(1)}%`} />
        <StatCard label="Collected today" value={fmtNaira(stats.collectedToday)} />
        <StatCard label="Defaulters" value={stats.defaulters} />
      </SectionGrid>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="uos-card p-5 lg:col-span-2">
          <h3 className="font-display font-semibold">Revenue trend (last 8 weeks)</h3>
          <svg viewBox="0 0 640 200" className="mt-4 w-full">
            {weekly.map((w, i) => {
              const bw = 640 / weekly.length;
              const h = (w.amount / maxWeek) * 150;
              return (
                <g key={i} transform={`translate(${i * bw}, 0)`}>
                  <rect
                    x={bw * 0.15}
                    y={170 - h}
                    width={bw * 0.7}
                    height={h}
                    fill="hsl(var(--primary))"
                    opacity={0.85}
                  >
                    <title>{`${w.label}: ${fmtNaira(w.amount)}`}</title>
                  </rect>
                  <text
                    x={bw / 2}
                    y={190}
                    textAnchor="middle"
                    fontSize="11"
                    fill="currentColor"
                    opacity="0.6"
                  >
                    {w.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="uos-card p-5">
          <h3 className="font-display font-semibold">Payment channels</h3>
          <div className="mt-4 space-y-3 text-sm">
            <ChannelBar
              label="Online (Paystack)"
              value={channels.online}
              total={channels.online + channels.manual}
              color="hsl(var(--primary))"
            />
            <ChannelBar
              label="Manual (cash/transfer)"
              value={channels.manual}
              total={channels.online + channels.manual}
              color="hsl(var(--accent))"
            />
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Today's reconciliation
            </h4>
            <p className="mt-2 text-sm">
              Online: <span className="font-mono">{fmtNaira(reconciliation.online)}</span>
            </p>
            <p className="text-sm">
              Manual: <span className="font-mono">{fmtNaira(reconciliation.manual)}</span>
            </p>
            <p className="text-sm text-muted-foreground">{reconciliation.count} transaction(s)</p>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="uos-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold">Defaulters (30+ days overdue)</h3>
            <Link to="/admin/fees-defaulters" className="text-xs text-primary hover:underline">
              Manage all →
            </Link>
          </div>
          {defaultersList.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No defaulters. 🎉</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1">Student</th>
                    <th>Class</th>
                    <th className="text-right">Due</th>
                    <th className="text-right">Days</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {defaultersList.map((d) => {
                    const s = students.data?.[d.sid];
                    const cls = s?.class_id ? classes.data?.[s.class_id] : "—";
                    return (
                      <tr key={d.sid}>
                        <td className="py-2">{s?.full_name ?? "—"}</td>
                        <td className="text-xs text-muted-foreground">{cls ?? "—"}</td>
                        <td className="text-right font-mono">{fmtNaira(d.due)}</td>
                        <td className="text-right text-xs">{d.days}d</td>
                        <td className="text-right">
                          <button
                            onClick={() => sendReminder(d.sid)}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/30"
                          >
                            Remind
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="uos-card p-5">
          <h3 className="font-display font-semibold">Recent transactions</h3>
          {recentPayments.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1">Student</th>
                    <th className="text-right">Amount</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentPayments.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">{students.data?.[r.student_id]?.full_name ?? "—"}</td>
                      <td className="text-right font-mono">
                        {fmtNaira(Number(r.paid_amount ?? 0))}
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "—"}
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link
            to="/bursar/receipts"
            className="mt-4 inline-block text-xs text-primary hover:underline"
          >
            View all receipts →
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink to="/admin/fees" title="Issue invoices" desc="Create per-student fees" />
        <QuickLink to="/bursar/receipts" title="Receipts" desc="View & print receipts" />
        <QuickLink to="/bursar/fee-plans" title="Fee plans" desc="Installment schedules" />
        <QuickLink
          to="/bursar/financial-intelligence"
          title="Financial AI"
          desc="Forecasts & insights"
        />
      </div>
    </PortalPage>
  );
}

function ChannelBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono">
          {fmtNaira(value)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="mt-1 h-2 rounded bg-muted">
        <div className="h-2 rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const c =
    status === "paid"
      ? "bg-emerald-500/15 text-emerald-600"
      : status === "partial"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-rose-500/15 text-rose-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{status ?? "—"}</span>;
}

function QuickLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link to={to} className="uos-card block p-4 hover:bg-muted/30 transition">
      <div className="font-display font-semibold text-sm">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </Link>
  );
}
