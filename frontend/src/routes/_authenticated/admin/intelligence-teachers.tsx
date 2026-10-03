import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/intelligence-teachers")({
  ssr: false,
  component: TeacherIntelligencePage,
});

function TeacherIntelligencePage() {
  return (
    <PortalPage
      title="Teacher Intelligence Center"
      subtitle="Measure, support and celebrate every teacher with one unified view."
    >
      <PlannedCapabilityState
        capability="Teacher performance and workload analytics"
        note="Performance scores, burnout detection and recognition tracking must be computed from real lesson-plan, attendance and outcome data before any number can be shown. They are planned capability — not in V1. The real teacher-intelligence surface is linked below."
        realSurfaces={[{ label: "Teacher intelligence", to: "/admin/teacher-intelligence" }]}
      />
    </PortalPage>
  );
}
