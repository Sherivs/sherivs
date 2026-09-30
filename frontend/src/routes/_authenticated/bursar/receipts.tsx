import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { PaginationBar } from "@/components/pagination-bar";
import { usePagination, PAGE_SIZE } from "@/hooks/use-pagination";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/bursar/receipts")({
  ssr: false,
  component: ReceiptsPage,
});

type ReceiptRow = {
  id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  paystack_reference: string | null;
  paid_at: string | null;
  term: string | null;
  academic_year: string | null;
  student: { full_name: string | null; admission_number: string | null } | null;
};

function ReceiptsPage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const [q, setQ] = useState("");
  const [from_, setFrom_] = useState<string>("");
  const [to_, setTo_] = useState<string>("");
  const [status, setStatus] = useState<"all" | "paid" | "partial" | "unpaid">("paid");
  const [active, setActive] = useState<ReceiptRow | null>(null);
  const { page, from, to, nextPage, prevPage, goToPage, reset } = usePagination();

  // Reset to page 0 whenever the search term changes.
  useEffect(() => {
    reset();
  }, [q, from_, to_, status, reset]);

  // Paginated server-side listing. Search applies to fee_type and paystack
  // reference; student-name search would require an embedded filter which
  // PostgREST does not support on the parent row, so it's intentionally
  // server-text-only here.
  const receipts = useQuery<{ rows: ReceiptRow[]; count: number }>({
    queryKey: ["bursar-receipts", schoolId, q, from_, to_, status, page],
    enabled: !!schoolId,
    queryFn: async () => {
      const term = q.trim();
      const pattern = `%${term}%`;
      let query = supabase
        .from("fees")
        .select(
          "id, fee_type, amount, paid_amount, paystack_reference, paid_at, term, academic_year, student:students(full_name, admission_number)",
          { count: "exact" },
        )
        .eq("school_id", schoolId!)
        .order("paid_at", { ascending: false })
        .range(from, to);
      if (status !== "all") query = query.eq("status", status);
      if (from_) query = query.gte("paid_at", from_);
      if (to_) query = query.lte("paid_at", `${to_}T23:59:59`);
      if (term) query = query.or(`fee_type.ilike.${pattern},paystack_reference.ilike.${pattern}`);
      const { data, error, count } = await query;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as ReceiptRow[], count: count ?? 0 };
    },
  });

  // Headline stats use a separate lightweight aggregate query so the cards
  // don't move when the user pages around.
  const summary = useQuery<{
    count: number;
    total: number;
    monthCount: number;
    monthTotal: number;
  }>({
    queryKey: ["bursar-receipts-summary", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select("paid_amount, paid_at")
        .eq("school_id", schoolId!)
        .eq("status", "paid");
      if (error) throw new Error(error.message);
      const all = (data ?? []) as Array<{ paid_amount: number | null; paid_at: string | null }>;
      const now = new Date();
      const thisMonth = all.filter(
        (r) =>
          r.paid_at &&
          new Date(r.paid_at).getMonth() === now.getMonth() &&
          new Date(r.paid_at).getFullYear() === now.getFullYear(),
      );
      return {
        count: all.length,
        total: all.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0),
        monthCount: thisMonth.length,
        monthTotal: thisMonth.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0),
      };
    },
  });

  const stats = useMemo(
    () => summary.data ?? { count: 0, total: 0, monthCount: 0, monthTotal: 0 },
    [summary.data],
  );
  const rows = receipts.data?.rows ?? [];
  const total = receipts.data?.count ?? 0;

  return (
    <PortalPage title="Receipts" subtitle="Printable receipts for every paid invoice.">
      <SectionGrid>
        <StatCard label="Total receipts" value={stats.count} />
        <StatCard label="Total collected (₦)" value={stats.total.toLocaleString()} />
        <StatCard label="This month" value={stats.monthCount} />
        <StatCard label="This month (₦)" value={stats.monthTotal.toLocaleString()} />
      </SectionGrid>

      <div className="mt-8 uos-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Paid invoices</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from_}
              onChange={(e) => setFrom_(e.target.value)}
              className="w-[150px]"
              aria-label="From date"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={to_}
              onChange={(e) => setTo_(e.target.value)}
              className="w-[150px]"
              aria-label="To date"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </select>
            <Input
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-[180px]"
            />
            <button
              onClick={() => exportCSV(rows)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Export CSV
            </button>
          </div>
        </header>
        {receipts.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : total === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No receipts match your filter.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-left">Paid at</th>
                    <th className="px-3 py-2 text-left">Reference</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{r.student?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.student?.admission_number ?? ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">{r.fee_type}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        ₦{Number(r.paid_amount ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.paid_at ? new Date(r.paid_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <code className="text-xs">{r.paystack_reference ?? "—"}</code>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setActive(r)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/40"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="space-y-3 p-4 sm:hidden">
              {rows.map((r) => (
                <div key={r.id} className="enterprise-card p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {r.student?.full_name ?? "—"}
                    </span>
                    <span className="shrink-0 font-mono text-sm">
                      ₦{Number(r.paid_amount ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Type</span>
                      <span className="truncate">{r.fee_type}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Paid at</span>
                      <span className="truncate">
                        {r.paid_at ? new Date(r.paid_at).toLocaleString() : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Reference</span>
                      <code className="truncate text-xs">{r.paystack_reference ?? "—"}</code>
                    </div>
                  </div>
                  <button
                    onClick={() => setActive(r)}
                    className="mt-3 w-full rounded-md border border-border py-2 text-xs hover:bg-muted/40"
                  >
                    View receipt
                  </button>
                </div>
              ))}
            </div>

            <PaginationBar
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              onNext={nextPage}
              onPrev={prevPage}
              onPage={goToPage}
              isLoading={receipts.isFetching}
            />
          </>
        )}
      </div>

      {active && (
        <ReceiptModal
          receipt={active}
          schoolName={school?.name ?? "School"}
          onClose={() => setActive(null)}
        />
      )}
    </PortalPage>
  );
}

function ReceiptModal({
  receipt,
  schoolName,
  onClose,
}: {
  receipt: ReceiptRow;
  schoolName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 print:max-w-full print:border-0">
        <div className="flex items-center justify-between print:hidden">
          <h3 className="font-display text-lg font-semibold">Receipt</h3>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Print
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-4 text-sm">
          <div className="border-b border-border pb-3 text-center">
            <h2 className="font-display text-xl font-bold">{schoolName}</h2>
            <p className="text-xs text-muted-foreground">Official Receipt</p>
          </div>

          <Row label="Receipt ID" value={receipt.id.slice(0, 8).toUpperCase()} />
          <Row label="Student" value={receipt.student?.full_name ?? "—"} />
          <Row label="Adm. number" value={receipt.student?.admission_number ?? "—"} />
          <Row label="Fee type" value={receipt.fee_type} />
          {receipt.term && <Row label="Term" value={receipt.term} />}
          {receipt.academic_year && <Row label="Year" value={receipt.academic_year} />}
          <Row label="Reference" value={receipt.paystack_reference ?? "—"} />
          <Row
            label="Paid at"
            value={receipt.paid_at ? new Date(receipt.paid_at).toLocaleString() : "—"}
          />

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-muted-foreground">Amount paid</span>
              <span className="font-display text-2xl font-bold">
                ₦{Number(receipt.paid_amount ?? 0).toLocaleString()}
              </span>
            </div>
          </div>

          <p className="pt-4 text-center text-xs text-muted-foreground">
            Thank you for your payment.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function exportCSV(rows: ReceiptRow[]) {
  const header = [
    "Student",
    "Admission #",
    "Type",
    "Amount",
    "Paid at",
    "Term",
    "Year",
    "Reference",
  ];
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [
        r.student?.full_name ?? "",
        r.student?.admission_number ?? "",
        r.fee_type,
        String(r.paid_amount ?? 0),
        r.paid_at ?? "",
        r.term ?? "",
        r.academic_year ?? "",
        r.paystack_reference ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    ),
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
