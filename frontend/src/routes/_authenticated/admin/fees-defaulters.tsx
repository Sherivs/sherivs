import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard, StatCard, SectionGrid } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/fees-defaulters")({
  ssr: false,
  component: FeesDefaultersPage,
});

type Fee = {
  id: string;
  student_id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  due_date: string | null;
  term: string | null;
  academic_year: string | null;
};

type StudentLite = {
  id: string;
  admission_number: string | null;
  full_name: string;
  class_name: string | null;
};

function csv(
  rows: Array<{ student: StudentLite; fee: Fee; outstanding: number; daysOverdue: number }>,
) {
  const headers = [
    "student",
    "admission_no",
    "class",
    "fee_type",
    "term",
    "year",
    "amount",
    "paid",
    "outstanding",
    "due_date",
    "days_overdue",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.student.full_name,
        r.student.admission_number ?? "",
        r.student.class_name ?? "",
        r.fee.fee_type,
        r.fee.term ?? "",
        r.fee.academic_year ?? "",
        r.fee.amount,
        r.fee.paid_amount ?? 0,
        r.outstanding,
        r.fee.due_date ?? "",
        r.daysOverdue,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}

function FeesDefaultersPage() {
  const { school } = useApp();
  const [q, setQ] = useState("");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const fees = useQuery<Fee[]>({
    queryKey: ["defaulter-fees", school?.id, today],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select(
          "id, student_id, fee_type, amount, paid_amount, status, due_date, term, academic_year",
        )
        .eq("school_id", school!.id)
        .neq("status", "paid")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Fee[];
    },
  });

  const studentIds = useMemo(
    () => Array.from(new Set((fees.data ?? []).map((f) => f.student_id))),
    [fees.data],
  );

  const studentsQ = useQuery<Map<string, StudentLite>>({
    queryKey: ["defaulter-students", school?.id, studentIds.join(",")],
    enabled: studentIds.length > 0,
    queryFn: async () => {
      const { data: students } = await supabase
        .from("students")
        .select("id, admission_number, user_id, class_id")
        .in("id", studentIds);
      const userIds = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const classIds = (students ?? []).map((s) => s.class_id).filter(Boolean) as string[];
      const [{ data: users }, { data: classes }] = await Promise.all([
        userIds.length
          ? supabase.from("users").select("id, full_name").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
        classIds.length
          ? supabase.from("classes").select("id, name").in("id", classIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name as string]));
      const classOf = new Map((classes ?? []).map((c) => [c.id, c.name as string]));
      const out = new Map<string, StudentLite>();
      for (const s of students ?? []) {
        out.set(s.id, {
          id: s.id,
          admission_number: s.admission_number ?? null,
          full_name: (s.user_id && nameOf.get(s.user_id)) || "(unnamed)",
          class_name: (s.class_id && classOf.get(s.class_id)) || null,
        });
      }
      return out;
    },
  });

  const rows = useMemo(() => {
    const out: Array<{ student: StudentLite; fee: Fee; outstanding: number; daysOverdue: number }> =
      [];
    const studentsMap = studentsQ.data ?? new Map<string, StudentLite>();
    for (const f of fees.data ?? []) {
      const outstanding = Number(f.amount) - Number(f.paid_amount ?? 0);
      if (outstanding <= 0) continue;
      const student = studentsMap.get(f.student_id) ?? {
        id: f.student_id,
        admission_number: null,
        full_name: "(unknown)",
        class_name: null,
      };
      const daysOverdue = f.due_date
        ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(f.due_date)) / 86400000))
        : 0;
      out.push({ student, fee: f, outstanding, daysOverdue });
    }
    const needle = q.trim().toLowerCase();
    return out.filter((r) => {
      if (!needle) return true;
      const hay = [
        r.student.full_name,
        r.student.admission_number ?? "",
        r.student.class_name ?? "",
        r.fee.fee_type,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [fees.data, studentsQ.data, q, today]);

  const totalOutstanding = rows.reduce((a, r) => a + r.outstanding, 0);
  const overdue = rows.filter((r) => r.daysOverdue > 0);
  const overdueTotal = overdue.reduce((a, r) => a + r.outstanding, 0);

  function download() {
    const blob = new Blob([csv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fee-defaulters-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <PortalPage
      title="Fee defaulters"
      subtitle="Outstanding invoices across all students. Overdue rows show how many days late they are."
      actions={
        <Button variant="outline" size="sm" onClick={download} disabled={rows.length === 0}>
          <Download className="mr-2 size-4" /> Export CSV
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          to="/admin/fees"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← All invoices
        </Link>
      </div>

      <SectionGrid>
        <StatCard label="Defaulters (invoices)" value={rows.length} />
        <StatCard label="Outstanding (₦)" value={totalOutstanding.toLocaleString()} />
        <StatCard label="Overdue invoices" value={overdue.length} />
        <StatCard label="Overdue total (₦)" value={overdueTotal.toLocaleString()} />
      </SectionGrid>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search student, admission no., class, fee type…"
          className="pl-8"
        />
      </div>

      {fees.isLoading ? (
        <div className="uos-card p-8 text-center text-sm text-muted-foreground">
          Loading defaulters…
        </div>
      ) : fees.error ? (
        <div className="uos-card p-8 text-center text-sm text-red-400">
          {(fees.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <EmptyCard
          title="No outstanding fees 🎉"
          body="Every invoice in this school is fully paid."
        />
      ) : (
        <div className="uos-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3">Student</th>
                <th className="p-3">Class</th>
                <th className="p-3">Fee</th>
                <th className="p-3 text-right">Outstanding</th>
                <th className="p-3">Due</th>
                <th className="p-3 text-right">Days overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.fee.id}
                  className={`border-b border-border/40 ${r.daysOverdue > 14 ? "bg-rose-500/5" : ""}`}
                >
                  <td className="p-3">
                    <div className="font-medium">{r.student.full_name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {r.student.admission_number ?? "—"}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.student.class_name ?? "—"}</td>
                  <td className="p-3">
                    <div>{r.fee.fee_type}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {[r.fee.term, r.fee.academic_year].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono">₦{r.outstanding.toLocaleString()}</td>
                  <td className="p-3 font-mono text-xs">{r.fee.due_date ?? "—"}</td>
                  <td
                    className={`p-3 text-right font-mono ${r.daysOverdue > 0 ? "text-rose-300" : "text-muted-foreground"}`}
                  >
                    {r.daysOverdue > 0 ? r.daysOverdue : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalPage>
  );
}
