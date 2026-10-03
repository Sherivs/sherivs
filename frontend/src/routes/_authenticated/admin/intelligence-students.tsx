import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/intelligence-students")({
  ssr: false,
  component: StudentIntelligencePage,
});

function StudentIntelligencePage() {
  return (
    <PortalPage
      title="Student Intelligence Center"
      subtitle="Real-time insights on every learner — success, risk, and momentum."
    >
      <PlannedCapabilityState
        capability="Student success scoring and prediction"
        note="Success scores, dropout prediction and risk registers must be computed from real attendance, grade and behaviour data before any number can be shown. They are planned capability — not in V1. The real student-intelligence surface is linked below."
        realSurfaces={[{ label: "Student intelligence", to: "/admin/student-intelligence" }]}
      />
    </PortalPage>
  );
}
