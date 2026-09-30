import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard, StatCard, SectionGrid } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/student/fees")({
  ssr: false,
  component: StudentFeesPage,
});

type Fee = {
  id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  due_date: string | null;
  term: string | null;
  academic_year: string | null;
};

function badge(status: string | null) {
  if (status === "paid") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "partial") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-rose-500/15 text-rose-300 border-rose-500/30";
}

function StudentFeesPage() {
  const { profile } = useApp();
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", profile.id)
        .maybeSingle();
      setStudentId((data?.id as string) ?? null);
    })();
  }, [profile?.id]);

  const fees = useQuery<Fee[]>({
    queryKey: ["student-fees", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("fees")
        .select("id, fee_type, amount, paid_amount, status, due_date, term, academic_year")
        .eq("student_id", studentId!)
        .order("due_date", { ascending: true, nullsFirst: false });
      return (data ?? []) as Fee[];
    },
  });

  if (!studentId && profile?.id) {
    return (
      <PortalPage title="My fees">
        <EmptyCard
          title="Not linked yet"
          body="Ask your school admin to link your student record."
        />
      </PortalPage>
    );
  }

  const rows = fees.data ?? [];
  const billed = rows.reduce((a, r) => a + Number(r.amount), 0);
  const paid = rows.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
  const outstanding = billed - paid;

  return (
    <PortalPage title="My fees" subtitle="View-only. Payments are made by your parent or guardian.">
      <SectionGrid>
        <StatCard label="Billed (₦)" value={billed.toLocaleString()} />
        <StatCard label="Paid (₦)" value={paid.toLocaleString()} />
        <StatCard label="Outstanding (₦)" value={outstanding.toLocaleString()} />
        <StatCard label="Invoices" value={rows.length} />
      </SectionGrid>

      <div className="uos-card mt-6">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No invoices on file.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{f.fee_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {[f.term, f.academic_year, f.due_date ? `due ${f.due_date}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">₦{Number(f.amount).toLocaleString()}</p>
                  <span
                    className={
                      "mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide " +
                      badge(f.status)
                    }
                  >
                    {f.status ?? "unpaid"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalPage>
  );
}
