import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PortalPage, EmptyCard, SectionGrid, StatCard } from "@/components/portal-shell";
import { loadFinancialReportsOverview } from "@/lib/runtime/scholar/portal-overview.functions";

export const Route = createFileRoute("/_authenticated/admin/financial-reports")({
  ssr: false,
  component: AdminFinancialReportsPage,
});

function formatNaira(value: number): string {
  return `₦${value.toLocaleString()}`;
}

function AdminFinancialReportsPage() {
  const overview = useServerFn(loadFinancialReportsOverview);

  const stats = useQuery({
    queryKey: ["admin-financial-reports-overview"],
    queryFn: () => overview(),
    retry: false,
  });

  return (
    <PortalPage
      title="Financial Reports"
      subtitle="Real fee-collection and expense totals for this tenant"
    >
      {stats.isError ? (
        <EmptyCard
          title="Financial overview could not be loaded"
          body={
            stats.error instanceof Error
              ? stats.error.message
              : "Financial records are not available right now. No numbers are invented in their place."
          }
        />
      ) : stats.isPending ? (
        <EmptyCard
          title="Loading financials…"
          body="Reading real fee and expense records for this tenant."
        />
      ) : (
        <div className="space-y-6">
          <SectionGrid>
            <StatCard label="Fees billed" value={formatNaira(stats.data.fees.billed)} />
            <StatCard label="Fees collected" value={formatNaira(stats.data.fees.collected)} />
            <StatCard label="Fees outstanding" value={formatNaira(stats.data.fees.outstanding)} />
            <StatCard label="Expenses recorded" value={formatNaira(stats.data.expenses.total)} />
          </SectionGrid>

          <SectionGrid>
            <StatCard label="Fee records" value={String(stats.data.fees.count)} />
            <StatCard label="Paid in full" value={String(stats.data.fees.byStatus.paid)} />
            <StatCard label="Partially paid" value={String(stats.data.fees.byStatus.partial)} />
            <StatCard label="Unpaid" value={String(stats.data.fees.byStatus.unpaid)} />
          </SectionGrid>

          <EmptyCard
            title="Honest state of this page"
            body="These totals are computed live from this tenant's fees and school_expenses rows. Revenue/grant breakdowns, cash-flow forecasting and report generation are planned capability — not in V1 — so this page renders no export or forecast controls rather than disabled fakes."
          />
        </div>
      )}
    </PortalPage>
  );
}
