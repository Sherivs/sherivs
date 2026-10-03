import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/intelligence-operations")({
  ssr: false,
  component: OperationsCommandCenter,
});

function OperationsCommandCenter() {
  return (
    <PortalPage
      title="Operations Command Center"
      subtitle="Run the whole school in one screen — every signal, live."
    >
      <PlannedCapabilityState
        capability="Unified operations picture"
        note="A single live view across attendance, transport, facilities and incidents. Every real signal this page once pretended to summarise is already served by its own V1 page — linked below. A unified command view is planned capability — not in V1."
        realSurfaces={[
          { label: "Attendance", to: "/admin/attendance" },
          { label: "Transport", to: "/admin/buses" },
          { label: "Facilities", to: "/admin/facilities" },
        ]}
      />
    </PortalPage>
  );
}
