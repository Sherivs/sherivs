import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PortalPage, EmptyCard, SectionGrid, StatCard } from "@/components/portal-shell";
import { loadPayrollOverview } from "@/lib/runtime/scholar/portal-overview.functions";

export const Route = createFileRoute("/_authenticated/admin/payroll")({
  ssr: false,
  component: AdminPayrollPage,
});

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function formatNaira(value: number): string {
  return `₦${value.toLocaleString()}`;
}

function AdminPayrollPage() {
  const overview = useServerFn(loadPayrollOverview);

  const stats = useQuery({
    queryKey: ["admin-payroll-overview"],
    queryFn: () => overview(),
    retry: false,
  });

  return (
    <PortalPage
      title="Payroll"
      subtitle="Real payroll records for this tenant, for the current period"
    >
      {stats.isError ? (
        <EmptyCard
          title="Payroll overview could not be loaded"
          body={
            stats.error instanceof Error
              ? stats.error.message
              : "Payroll records are not available right now. No numbers are invented in their place."
          }
        />
      ) : stats.isPending ? (
        <EmptyCard title="Loading payroll…" body="Reading real payroll records for this tenant." />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Period: {MONTH_NAMES[stats.data.period.month - 1]} {stats.data.period.year}
          </p>
          <SectionGrid>
            <StatCard
              label="Staff with payroll records this year"
              value={String(stats.data.staffWithPayroll)}
            />
            <StatCard label="Payslips this period" value={String(stats.data.payslipCount)} />
            <StatCard label="Gross total this period" value={formatNaira(stats.data.grossTotal)} />
            <StatCard label="Net total this period" value={formatNaira(stats.data.netTotal)} />
          </SectionGrid>

          <SectionGrid>
            <StatCard label="Draft payslips" value={String(stats.data.byStatus.draft)} />
            <StatCard label="Approved payslips" value={String(stats.data.byStatus.approved)} />
            <StatCard label="Paid payslips" value={String(stats.data.byStatus.paid)} />
            <StatCard
              label="Unrecognised status"
              value={String(stats.data.byStatus.other)}
              hint="Rows whose status the schema does not declare"
            />
          </SectionGrid>

          <EmptyCard
            title="Honest state of this page"
            body="These figures are read live from this tenant's staff_payroll rows for the current period. Payroll processing, payslip generation and deduction management are planned capability — not in V1 — so this page renders no action buttons rather than disabled fakes."
          />
        </div>
      )}
    </PortalPage>
  );
}
