import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard, StatCard, SectionGrid } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { initFeePayment, verifyFeePayment } from "@/lib/runtime/scholar/paystack.functions";
import { loadPaystackInline } from "@/lib/paystack-inline";

export const Route = createFileRoute("/_authenticated/parent/fees")({
  ssr: false,
  component: ParentFeesPage,
});

type Child = { student_id: string; full_name: string };
type Fee = {
  id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  due_date: string | null;
  term: string | null;
  academic_year: string | null;
  student_id: string;
  /** SHERIVS-A05b: approved discounts/scholarships/waivers allocated to this row, and what is left to pay. */
  relief?: number;
  due?: number;
};

function badge(status: string | null) {
  if (status === "paid") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "partial") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-rose-500/15 text-rose-300 border-rose-500/30";
}

function ParentFeesPage() {
  const { profile } = useApp();
  const qc = useQueryClient();
  const init = useServerFn(initFeePayment);
  const verify = useServerFn(verifyFeePayment);
  const [paying, setPaying] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string>("");

  const children = useQuery<Child[]>({
    queryKey: ["parent-children-fees", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: map } = await supabase
        .from("parent_student_map")
        .select("student_id")
        .eq("parent_id", profile!.id);
      const ids = (map ?? []).map((r) => r.student_id as string);
      if (ids.length === 0) return [];
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id")
        .in("id", ids);
      const userIds = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const { data: users } = userIds.length
        ? await supabase.from("users").select("id, full_name").in("id", userIds)
        : { data: [] as { id: string; full_name: string }[] };
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name as string]));
      return (students ?? []).map((s) => ({
        student_id: s.id,
        full_name: (s.user_id && nameOf.get(s.user_id)) || "(unnamed)",
      }));
    },
  });

  const childIds = useMemo(() => (children.data ?? []).map((c) => c.student_id), [children.data]);
  const activeChild = selectedChild || childIds[0] || "";

  const fees = useQuery<Fee[]>({
    queryKey: ["parent-fees", activeChild],
    enabled: !!activeChild,
    queryFn: async () => {
      const { data } = await supabase
        .from("fees")
        .select(
          "id, fee_type, amount, paid_amount, status, due_date, term, academic_year, student_id",
        )
        .eq("student_id", activeChild)
        .order("due_date", { ascending: true, nullsFirst: false });
      const list = (data ?? []) as Fee[];
      // Amount owed after approved relief, per term/session (same server function checkout charges).
      const groups = [...new Set(list.filter((f) => f.term && f.academic_year).map((f) => `${f.term}|${f.academic_year}`))];
      const dues = new Map<string, { relief: number; due: number }>();
      for (const g of groups) {
        const [term, year] = g.split("|");
        const { data: d } = await supabase.rpc("fee_dues" as never, { p_student: activeChild, p_term: term, p_year: year } as never);
        for (const r of (d ?? []) as { fee_id: string; relief: number; due: number }[]) dues.set(r.fee_id, { relief: Number(r.relief), due: Number(r.due) });
      }
      return list.map((f) => ({ ...f, ...(dues.get(f.id) ?? {}) }));
    },
  });

  async function payInvoice(fee: Fee) {
    if (!profile?.email) {
      toast.error("No email on your profile — ask the school to update it.");
      return;
    }
    setPaying(fee.id);
    try {
      const init1 = await init({ data: { fee_id: fee.id, email: profile.email } });
      await loadPaystackInline();
      if (!window.PaystackPop) throw new Error("Checkout not ready");
      await new Promise<void>((resolve, reject) => {
        window.PaystackPop!.resumeTransaction(init1.access_code, {
          onSuccess: async (tx) => {
            try {
              const v = await verify({ data: { reference: tx.reference } });
              if (v.paid) {
                toast.success("Payment received");
                qc.invalidateQueries({ queryKey: ["parent-fees", activeChild] });
              } else {
                toast.info("Payment processing — we'll update once Paystack confirms.");
              }
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          onCancel: () => {
            toast.info("Payment cancelled");
            resolve();
          },
          onError: (err) => reject(new Error(err.message ?? "Payment error")),
        });
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(null);
    }
  }

  const rows = fees.data ?? [];
  const billed = rows.reduce((a, r) => a + Number(r.amount), 0);
  const paid = rows.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
  const relief = rows.reduce((a, r) => a + Number(r.relief ?? 0), 0);
  const outstanding = rows.reduce((a, r) => a + (r.due ?? Math.max(Number(r.amount) - Number(r.paid_amount ?? 0), 0)), 0);

  if ((children.data ?? []).length === 0 && !children.isLoading) {
    return (
      <PortalPage title="Fees">
        <EmptyCard
          title="No children linked yet"
          body="Ask your school admin to link your children to your account."
        />
      </PortalPage>
    );
  }

  return (
    <PortalPage
      title="Fees"
      subtitle="Pay invoices for your children securely. Receipts arrive in your inbox."
    >
      {(children.data ?? []).length > 1 && (
        <div className="flex flex-wrap gap-2">
          {(children.data ?? []).map((c) => (
            <button
              key={c.student_id}
              type="button"
              onClick={() => setSelectedChild(c.student_id)}
              className={[
                "rounded-md border px-3 py-1.5 text-xs",
                c.student_id === activeChild
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/40",
              ].join(" ")}
            >
              {c.full_name}
            </button>
          ))}
        </div>
      )}

      <SectionGrid>
        <StatCard label="Billed (₦)" value={billed.toLocaleString()} />
        <StatCard label="Paid (₦)" value={paid.toLocaleString()} />
        <StatCard label="Outstanding (₦)" value={outstanding.toLocaleString()} />
        <StatCard label="Relief (₦)" value={relief.toLocaleString()} />
        <StatCard label="Invoices" value={rows.length} />
      </SectionGrid>

      <div className="uos-card">
        {fees.isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading invoices…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No invoices for this child yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((f) => {
              const due = f.due ?? Number(f.amount) - Number(f.paid_amount ?? 0);
              const canPay = f.status !== "paid" && due > 0;
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{f.fee_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {[f.term, f.academic_year, f.due_date ? `due ${f.due_date}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono text-sm">₦{Number(f.amount).toLocaleString()}</p>
                      {Number(f.relief ?? 0) > 0 && (
                        <p className="text-xs text-emerald-400">
                          −₦{Number(f.relief).toLocaleString()} relief · pay ₦{due.toLocaleString()}
                        </p>
                      )}
                      <span
                        className={
                          "mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide " +
                          badge(f.status)
                        }
                      >
                        {f.status ?? "unpaid"}
                      </span>
                    </div>
                    {canPay && (
                      <Button size="sm" onClick={() => payInvoice(f)} disabled={paying === f.id}>
                        {paying === f.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CreditCard className="size-4" />
                        )}
                        Pay ₦{due.toLocaleString()}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PortalPage>
  );
}
