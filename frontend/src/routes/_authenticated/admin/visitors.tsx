import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/visitors")({
  ssr: false,
  component: AdminVisitorsPage,
});

function AdminVisitorsPage() {
  return (
    <PortalPage
      title="Visitor Management & Gate Control"
      subtitle="Real-time visitor tracking, pass management, and comprehensive security monitoring"
    >
      <PlannedCapabilityState
        capability="Visitor management and gate control"
        note="Visitor check-in, pass issuance and gate logs require a visitor schema that does not exist yet, so this page has no data to show and no security status to claim. The placeholder zeros and disabled actions that stood here before have been removed rather than faked. Visitor management is planned capability — not in V1."
      />
    </PortalPage>
  );
}
