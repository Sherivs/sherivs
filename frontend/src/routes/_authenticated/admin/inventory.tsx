import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/inventory")({
  ssr: false,
  component: AdminInventoryPage,
});

function AdminInventoryPage() {
  return (
    <PortalPage
      title="Inventory & Asset Management"
      subtitle="Real-time asset tracking, stock management, and equipment maintenance"
    >
      <PlannedCapabilityState
        capability="Inventory and asset management"
        note="Asset registers, stock levels, maintenance schedules and requisitions require an inventory schema that does not exist yet, so this page has no data to show. The placeholder zeros and disabled actions that stood here before have been removed rather than faked. Inventory is planned capability — not in V1."
      />
    </PortalPage>
  );
}
