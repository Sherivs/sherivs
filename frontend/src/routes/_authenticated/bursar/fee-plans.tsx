import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bursar/fee-plans")({
  ssr: false,
  component: FeePlansPage,
});

type Fee = {
  id: string;
  student_id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  due_date: string | null;
  status: string | null;
  term: string | null;
  academic_year: string | null;
};

function fmtNaira(n: number) {
  return "₦" + Math.round(n).toLocaleString();
}

function FeePlansPage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const fees = useQuery<Fee[]>({
    queryKey: ["fee-plans-fees", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select(
          "id, student_id, fee_type, amount, paid_amount, due_date, status, term, academic_year",
        )
        .eq("school_id", schoolId!)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Fee[];
    },
  });

  const students = useQuery<Record<string, string>>({
    queryKey: ["fee-plans-students", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, user_id")
        .eq("school_id", schoolId!);
      const rows = (data ?? []) as Array<{ id: string; user_id: string | null }>;
      const uids = rows.map((r) => r.user_id).filter(Boolean) as string[];
      const names: Record<string, string> = {};
      if (uids.length) {
        const { data: us } = await supabase.from("users").select("id, full_name").in("id", uids);
        (us ?? []).forEach((u) => {
          names[u.id as string] = (u.full_name as string) ?? "";
        });
      }
      const map: Record<string, string> = {};
      rows.forEach((r) => {
        map[r.id] = r.user_id ? (names[r.user_id] ?? "—") : "—";
      });
      return map;
    },
  });

  // Group by student + fee_type + term (an "installment plan")
  const plans = useMemo(() => {
    const groups = new Map<
      string,
      { studentId: string; feeType: string; term: string; installments: Fee[] }
    >();
    (fees.data ?? []).forEach((f) => {
      const key = `${f.student_id}::${f.fee_type}::${f.term ?? ""}::${f.academic_year ?? ""}`;
      const g = groups.get(key) ?? {
        studentId: f.student_id,
        feeType: f.fee_type,
        term: `${f.term ?? "—"} ${f.academic_year ?? ""}`.trim(),
        installments: [],
      };
      g.installments.push(f);
      groups.set(key, g);
    });
    return Array.from(groups.values())
      .filter((g) => g.installments.length >= 2 || g.installments.some((f) => f.due_date))
      .map((g) => {
        const total = g.installments.reduce((a, f) => a + Number(f.amount), 0);
        const paid = g.installments.reduce((a, f) => a + Number(f.paid_amount ?? 0), 0);
        const nextDue = g.installments
          .filter((f) => Number(f.amount) > Number(f.paid_amount ?? 0))
          .sort((a, b) => (a.due_date ?? "z").localeCompare(b.due_date ?? "z"))[0];
        return { ...g, total, paid, outstanding: total - paid, nextDue };
      });
  }, [fees.data]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return plans;
    return plans.filter((p) => {
      const name = (students.data?.[p.studentId] ?? "").toLowerCase();
      return name.includes(term) || p.feeType.toLowerCase().includes(term);
    });
  }, [plans, q, students.data]);

  const stats = useMemo(() => {
    const now = Date.now();
    const upcoming = plans.filter(
      (p) =>
        p.nextDue?.due_date &&
        new Date(p.nextDue.due_date).getTime() >= now &&
        new Date(p.nextDue.due_date).getTime() < now + 7 * 86400000,
    ).length;
    const overdue = plans.filter(
      (p) => p.nextDue?.due_date && new Date(p.nextDue.due_date).getTime() < now,
    ).length;
    const totalOutstanding = plans.reduce((a, p) => a + p.outstanding, 0);
    return { count: plans.length, upcoming, overdue, totalOutstanding };
  }, [plans]);

  async function addInstallment(
    studentId: string,
    feeType: string,
    term: string,
    academic_year: string,
  ) {
    const amount = Number(prompt("Installment amount (₦):") ?? "0");
    if (!amount) return;
    const due = prompt("Due date (YYYY-MM-DD):") ?? "";
    const { error } = await supabase.from("fees").insert({
      school_id: schoolId!,
      student_id: studentId,
      fee_type: feeType,
      amount,
      due_date: due || null,
      term: term || null,
      academic_year: academic_year || null,
      status: "unpaid",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Installment added");
      qc.invalidateQueries({ queryKey: ["fee-plans-fees", schoolId] });
    }
  }

  async function sendReminder(studentId: string, planLabel: string) {
    const { data: s } = await supabase
      .from("students")
      .select("user_id, parent_id")
      .eq("id", studentId)
      .maybeSingle();
    const target = (s?.parent_id as string | null) ?? (s?.user_id as string | null);
    if (!target) {
      toast.error("No user to notify");
      return;
    }
    const { error } = await supabase.from("notifications").insert({
      school_id: schoolId!,
      user_id: target,
      title: "Installment reminder",
      message: `Upcoming installment for ${planLabel}. Please pay before the due date.`,
      type: "fees",
    });
    if (error) toast.error(error.message);
    else toast.success("Reminder sent");
  }

  return (
    <PortalPage title="Fee Plans" subtitle="Installment schedules per student, per fee type.">
      <SectionGrid>
        <StatCard label="Active plans" value={stats.count} />
        <StatCard label="Due this week" value={stats.upcoming} />
        <StatCard label="Overdue" value={stats.overdue} />
        <StatCard label="Outstanding" value={fmtNaira(stats.totalOutstanding)} />
      </SectionGrid>

      <div className="mt-8 uos-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Installment plans</h2>
          <Input
            placeholder="Filter by student or fee type…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
        </header>
        {fees.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No installment plans yet. Add multiple fee entries for the same student, fee type and
            term to form a plan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Student</th>
                  <th className="px-3 py-2 text-left">Fee</th>
                  <th className="px-3 py-2 text-left">Term</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-left">Progress</th>
                  <th className="px-3 py-2 text-left">Next due</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p, i) => {
                  const pct = p.total > 0 ? (p.paid / p.total) * 100 : 0;
                  const first = p.installments[0];
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2">{students.data?.[p.studentId] ?? "—"}</td>
                      <td className="px-3 py-2 capitalize">
                        {p.feeType}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({p.installments.length}×)
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.term}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNaira(p.total)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNaira(p.paid)}</td>
                      <td className="px-3 py-2 min-w-[120px]">
                        <div className="h-2 rounded bg-muted">
                          <div className="h-2 rounded bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{pct.toFixed(0)}%</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{p.nextDue?.due_date ?? "—"}</td>
                      <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() =>
                            addInstallment(
                              p.studentId,
                              p.feeType,
                              first.term ?? "",
                              first.academic_year ?? "",
                            )
                          }
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/30"
                        >
                          + Installment
                        </button>
                        <button
                          onClick={() => sendReminder(p.studentId, `${p.feeType} ${p.term}`)}
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
    </PortalPage>
  );
}
