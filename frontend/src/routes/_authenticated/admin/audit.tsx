import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PortalPage, EmptyCard, SectionGrid, StatCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { loadAuditOverview } from "@/lib/runtime/scholar/portal-overview.functions";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  ssr: false,
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const navigate = useNavigate();
  const overview = useServerFn(loadAuditOverview);

  const stats = useQuery({
    queryKey: ["admin-audit-overview"],
    queryFn: () => overview(),
    retry: false,
  });

  return (
    <PortalPage
      title="Audit & Compliance"
      subtitle="Tenant audit trail over real logged events — the detailed log lives on the audit-logs page"
      actions={
        <Button onClick={() => navigate({ to: "/admin/audit-logs" })}>View Detailed Logs</Button>
      }
    >
      {stats.isError ? (
        <EmptyCard
          title="Audit overview could not be loaded"
          body={
            stats.error instanceof Error
              ? stats.error.message
              : "The audit trail is not available right now. No numbers are invented in its place — retry or open the detailed logs."
          }
          action={
            <Button variant="outline" onClick={() => void stats.refetch()}>
              Retry
            </Button>
          }
        />
      ) : stats.isPending ? (
        <EmptyCard
          title="Loading audit trail…"
          body="Reading real logged events for this tenant."
        />
      ) : (
        <div className="space-y-6">
          <SectionGrid>
            <StatCard label="Total events logged" value={String(stats.data.totalEvents)} />
            <StatCard label="Events today" value={String(stats.data.eventsToday)} />
            <StatCard
              label="Security events (resets, logins)"
              value={String(stats.data.securityEvents)}
            />
            <StatCard
              label="Last event"
              value={
                stats.data.lastEventAt
                  ? new Date(stats.data.lastEventAt).toLocaleString()
                  : "No events yet"
              }
            />
          </SectionGrid>

          <EmptyCard
            title="Honest state of this page"
            body="These counts are read live from this tenant's audit_logs. What this page does not claim: regulatory compliance status, anomaly detection, or automated retention — those workflows are planned capability and are not in V1. Every logged event is browsable in the detailed log."
          />
        </div>
      )}
    </PortalPage>
  );
}
