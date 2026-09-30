import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/hq/finance")({
  ssr: false,
  component: HqFinance,
});

const PIE = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--muted-foreground))"];

function HqFinance() {
  const { school } = useApp();
  const schoolId = school?.id;

  const fees = useQuery({
    queryKey: ["hq-finance", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select("amount, paid_amount, status, fee_type, paid_at")
        .eq("school_id", schoolId!)
        .limit(5000);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const data = useMemo(() => {
    const rows = fees.data ?? [];
    const collected = rows.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
    const outstanding = rows
      .filter((r) => r.status !== "paid")
      .reduce((a, r) => a + (Number(r.amount) - Number(r.paid_amount ?? 0)), 0);

    const months: { label: string; revenue: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push({
        label: d.toLocaleString(undefined, { month: "short" }),
        revenue: 0,
      });
    }
    rows.forEach((r) => {
      if (!r.paid_at) return;
      const d = new Date(r.paid_at);
      const diff =
        (new Date().getFullYear() - d.getFullYear()) * 12 + (new Date().getMonth() - d.getMonth());
      if (diff >= 0 && diff < 12) {
        months[11 - diff].revenue += Number(r.paid_amount ?? 0);
      }
    });

    const status = [
      { name: "Paid", value: rows.filter((r) => r.status === "paid").length },
      { name: "Partial", value: rows.filter((r) => r.status === "partial").length },
      { name: "Unpaid", value: rows.filter((r) => r.status === "unpaid").length },
    ];

    return { collected, outstanding, months, status, total: rows.length };
  }, [fees.data]);

  return (
    <PortalPage title="Finance overview" subtitle="12-month revenue and outstanding receivables.">
      <SectionGrid>
        <StatCard label="Invoices" value={data.total} />
        <StatCard label="Collected (₦)" value={data.collected.toLocaleString()} />
        <StatCard label="Outstanding (₦)" value={data.outstanding.toLocaleString()} />
        <StatCard
          label="Collection rate"
          value={
            data.collected + data.outstanding === 0
              ? "—"
              : `${Math.round((data.collected / (data.collected + data.outstanding)) * 100)}%`
          }
        />
      </SectionGrid>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="uos-card p-5 lg:col-span-2">
          <h3 className="font-display font-semibold">Revenue — trailing 12 months</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.months}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(v: number) => `₦${v.toLocaleString()}`}
                />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="uos-card p-5">
          <h3 className="font-display font-semibold">Invoice status</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.status}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                >
                  {data.status.map((_, i) => (
                    <Cell key={i} fill={PIE[i % PIE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </PortalPage>
  );
}
