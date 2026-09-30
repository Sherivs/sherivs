import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/bursar/financial-intelligence")({
  ssr: false,
  component: FinancialIntel,
});

type Fee = {
  id: string;
  student_id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  paid_at: string | null;
  due_date: string | null;
  created_at: string | null;
  status: string | null;
  term: string | null;
  academic_year: string | null;
};

function fmtNaira(n: number) {
  return "₦" + Math.round(n).toLocaleString();
}

function FinancialIntel() {
  const { school } = useApp();
  const schoolId = school?.id;

  const fees = useQuery<Fee[]>({
    queryKey: ["fin-intel-fees", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select(
          "id, student_id, fee_type, amount, paid_amount, paid_at, due_date, created_at, status, term, academic_year",
        )
        .eq("school_id", schoolId!)
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Fee[];
    },
  });

  const insights = useMemo(() => {
    const rows = fees.data ?? [];
    const now = Date.now();

    // Cash flow forecast — sum of unpaid amounts by due_date window
    const unpaid = rows.filter((r) => Number(r.amount) > Number(r.paid_amount ?? 0));
    const expected7 = unpaid
      .filter(
        (r) =>
          r.due_date &&
          new Date(r.due_date).getTime() >= now &&
          new Date(r.due_date).getTime() < now + 7 * 86400000,
      )
      .reduce((a, r) => a + (Number(r.amount) - Number(r.paid_amount ?? 0)), 0);
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1, 1);
    monthEnd.setDate(0);
    const expectedMonth = unpaid
      .filter(
        (r) =>
          r.due_date &&
          new Date(r.due_date).getTime() >= now &&
          new Date(r.due_date).getTime() <= monthEnd.getTime(),
      )
      .reduce((a, r) => a + (Number(r.amount) - Number(r.paid_amount ?? 0)), 0);

    // Fee category analysis
    const byCat = new Map<string, { billed: number; paid: number }>();
    rows.forEach((r) => {
      const c = byCat.get(r.fee_type) ?? { billed: 0, paid: 0 };
      c.billed += Number(r.amount);
      c.paid += Number(r.paid_amount ?? 0);
      byCat.set(r.fee_type, c);
    });
    const categories = Array.from(byCat.entries())
      .map(([type, v]) => ({
        type,
        billed: v.billed,
        paid: v.paid,
        rate: v.billed > 0 ? (v.paid / v.billed) * 100 : 0,
      }))
      .sort((a, b) => a.rate - b.rate);

    // Parent payment behavior — by student
    const byStudent = new Map<
      string,
      { firstWeek: number; late: number; total: number; arrears: number }
    >();
    rows.forEach((r) => {
      const b = byStudent.get(r.student_id) ?? { firstWeek: 0, late: 0, total: 0, arrears: 0 };
      b.total++;
      if (r.paid_at && r.created_at) {
        const days = (new Date(r.paid_at).getTime() - new Date(r.created_at).getTime()) / 86400000;
        if (days <= 7) b.firstWeek++;
      }
      if (r.due_date && r.paid_at && new Date(r.paid_at) > new Date(r.due_date)) b.late++;
      if (Number(r.amount) > Number(r.paid_amount ?? 0)) b.arrears++;
      byStudent.set(r.student_id, b);
    });
    const behaviors = Array.from(byStudent.values());
    const promptPayers = behaviors.filter(
      (b) => b.total >= 2 && b.firstWeek / b.total >= 0.6,
    ).length;
    const slowPayers = behaviors.filter((b) => b.total >= 2 && b.late / b.total >= 0.5).length;
    const chronicLate = behaviors.filter((b) => b.late >= 3).length;

    // Risk — students in arrears for 2+ terms
    const termsPerStudent = new Map<string, Set<string>>();
    rows.forEach((r) => {
      if (Number(r.amount) > Number(r.paid_amount ?? 0) && r.term) {
        const s = termsPerStudent.get(r.student_id) ?? new Set();
        s.add(`${r.term}::${r.academic_year ?? ""}`);
        termsPerStudent.set(r.student_id, s);
      }
    });
    const multiTermArrears = Array.from(termsPerStudent.values()).filter((s) => s.size >= 2).length;

    return {
      expected7,
      expectedMonth,
      categories,
      promptPayers,
      slowPayers,
      chronicLate,
      multiTermArrears,
      uniqueDefaulters: behaviors.filter((b) => b.arrears > 0).length,
    };
  }, [fees.data]);

  return (
    <PortalPage
      title="Financial Intelligence"
      subtitle="AI-powered cash-flow forecasts, category analysis and payment-behavior insights."
    >
      <SectionGrid>
        <StatCard label="Expected · next 7 days" value={fmtNaira(insights.expected7)} />
        <StatCard label="Expected · this month" value={fmtNaira(insights.expectedMonth)} />
        <StatCard label="Multi-term arrears" value={insights.multiTermArrears} />
        <StatCard label="Defaulters" value={insights.uniqueDefaulters} />
      </SectionGrid>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="uos-card p-5">
          <h3 className="font-display font-semibold">Fee category analysis</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Sorted by lowest collection rate first.
          </p>
          {insights.categories.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No fees recorded.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1">Category</th>
                    <th className="text-right">Billed</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {insights.categories.map((c) => (
                    <tr key={c.type}>
                      <td className="py-2 capitalize">{c.type}</td>
                      <td className="text-right font-mono">{fmtNaira(c.billed)}</td>
                      <td className="text-right font-mono">{fmtNaira(c.paid)}</td>
                      <td
                        className={`text-right font-mono ${c.rate < 50 ? "text-rose-600" : c.rate < 80 ? "text-amber-600" : "text-emerald-600"}`}
                      >
                        {c.rate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="uos-card p-5">
          <h3 className="font-display font-semibold">Parent payment behavior</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Insight
              label="Prompt payers (usually pay in first week)"
              value={insights.promptPayers}
              tone="good"
            />
            <Insight
              label="Slow payers (often pay after due date)"
              value={insights.slowPayers}
              tone="warn"
            />
            <Insight
              label="Chronic late (3+ late payments)"
              value={insights.chronicLate}
              tone="bad"
            />
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Risk assessment
            </h4>
            <p className="mt-2 text-sm">
              <span className="font-mono font-semibold text-rose-600">
                {insights.multiTermArrears}
              </span>{" "}
              student(s) in arrears for 2+ consecutive terms — flag for family outreach.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Families showing payment stress: {insights.chronicLate} household(s).
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 uos-card p-5">
        <h3 className="font-display font-semibold">AI narrative</h3>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Expected inflow over the next 7 days is{" "}
            <span className="font-mono text-foreground">{fmtNaira(insights.expected7)}</span> based
            on scheduled installments.
          </li>
          {insights.categories[0] && (
            <li>
              Lowest-performing category:{" "}
              <span className="capitalize text-foreground">{insights.categories[0].type}</span> at{" "}
              {insights.categories[0].rate.toFixed(0)}% collection — prioritise reminders for these
              fees.
            </li>
          )}
          {insights.slowPayers > 0 && (
            <li>
              {insights.slowPayers} household(s) consistently pay after due date — consider
              early-bird incentives.
            </li>
          )}
          {insights.multiTermArrears > 0 && (
            <li>
              {insights.multiTermArrears} student(s) in multi-term arrears — high risk of dropout
              without intervention.
            </li>
          )}
        </ul>
      </div>
    </PortalPage>
  );
}

function Insight({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad";
}) {
  const c =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-rose-600";
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span>{label}</span>
      <span className={`font-mono text-lg font-bold ${c}`}>{value}</span>
    </div>
  );
}
