import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/bursar/reconciliation")({
  ssr: false,
  component: ReconciliationPage,
});

type FeeRow = {
  id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  paystack_reference: string | null;
  paid_at: string | null;
  student_id: string;
  created_at: string;
};

type WebhookRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  processing_status: string | null;
  created_at: string;
};

function ReconciliationPage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const [q, setQ] = useState("");

  const fees = useQuery<FeeRow[]>({
    queryKey: ["recon-fees", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select(
          "id, fee_type, amount, paid_amount, status, paystack_reference, paid_at, student_id, created_at",
        )
        .eq("school_id", schoolId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as FeeRow[];
    },
  });

  const hooks = useQuery<WebhookRow[]>({
    queryKey: ["recon-hooks", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_logs")
        .select("id, event_type, payload, processing_status, created_at")
        .eq("school_id", schoolId!)
        .eq("provider", "paystack")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as WebhookRow[];
    },
  });

  const stats = useMemo(() => {
    const rows = fees.data ?? [];
    const paid = rows.filter((r) => r.status === "paid");
    const unpaid = rows.filter((r) => r.status !== "paid");
    const orphans = (hooks.data ?? []).filter((h) => {
      const ref = (h.payload as { data?: { reference?: string } })?.data?.reference;
      if (!ref) return false;
      return !rows.some((r) => r.paystack_reference === ref);
    });
    return {
      collected: paid.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0),
      outstanding: unpaid.reduce((a, r) => a + (Number(r.amount) - Number(r.paid_amount ?? 0)), 0),
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      orphanCount: orphans.length,
    };
  }, [fees.data, hooks.data]);

  const filtered = (fees.data ?? []).filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      r.fee_type.toLowerCase().includes(needle) ||
      (r.paystack_reference ?? "").toLowerCase().includes(needle) ||
      r.student_id.toLowerCase().includes(needle)
    );
  });

  return (
    <PortalPage
      title="Reconciliation"
      subtitle="Match Paystack webhooks against invoices and flag mismatches."
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          to="/bursar/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Bursar dashboard
        </Link>
        <Link
          to="/admin/fees"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          Manage invoices
        </Link>
      </div>

      <SectionGrid>
        <StatCard label="Collected (₦)" value={stats.collected.toLocaleString()} />
        <StatCard label="Outstanding (₦)" value={stats.outstanding.toLocaleString()} />
        <StatCard label="Paid invoices" value={stats.paidCount} />
        <StatCard
          label="Unreconciled webhooks"
          value={stats.orphanCount}
          hint="Webhook refs with no matching invoice"
        />
      </SectionGrid>

      <div className="mt-8 uos-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Invoices</h2>
            <p className="text-xs text-muted-foreground">Latest 500 invoices for your school.</p>
          </div>
          <Input
            placeholder="Filter by type, reference, or student id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
        </header>
        {fees.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No invoices match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="px-3 py-2 text-left">Paid at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{r.fee_type}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      ₦{Number(r.amount).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      ₦{Number(r.paid_amount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.status === "paid"
                            ? "text-emerald-400"
                            : r.status === "partial"
                              ? "text-amber-400"
                              : "text-rose-400"
                        }
                      >
                        {r.status ?? "unpaid"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs">{r.paystack_reference ?? "—"}</code>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.paid_at ? new Date(r.paid_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8 uos-card">
        <header className="border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Recent Paystack webhooks</h2>
          <p className="text-xs text-muted-foreground">
            Signature-verified events received from Paystack. Orphans below have no matching
            invoice.
          </p>
        </header>
        {(hooks.data?.length ?? 0) === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No webhooks received yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {hooks.data!.slice(0, 50).map((h) => {
              const ref = (h.payload as { data?: { reference?: string } })?.data?.reference;
              const amount = (h.payload as { data?: { amount?: number } })?.data?.amount;
              const matched = ref && (fees.data ?? []).some((f) => f.paystack_reference === ref);
              return (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs"
                >
                  <div>
                    <p className="font-semibold">{h.event_type}</p>
                    <p className="text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()} · ref <code>{ref ?? "—"}</code>
                    </p>
                  </div>
                  <div className="text-right">
                    {amount != null && (
                      <p className="font-mono">₦{(amount / 100).toLocaleString()}</p>
                    )}
                    <p className={matched ? "text-emerald-400" : "text-rose-400"}>
                      {matched ? "matched" : "orphan"}
                    </p>
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
