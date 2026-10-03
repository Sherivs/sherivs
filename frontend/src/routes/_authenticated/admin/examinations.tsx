import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/examinations")({
  ssr: false,
  component: AdminExaminationsPage,
});

function AdminExaminationsPage() {
  return (
    <PortalPage
      title="Examination Management System"
      subtitle="Advanced exam scheduling, seating arrangements, and invigilation coordination"
    >
      <PlannedCapabilityState
        capability="Examination logistics"
        note="Exam scheduling, seating plans, exam centres and invigilation require an examinations schema that does not exist yet, so this page has no data to show. Grade capture and report-card publishing are real V1 capabilities and live on their own pages, linked below."
        realSurfaces={[
          { label: "Grades", to: "/admin/grades" },
          { label: "Report cards", to: "/admin/report-cards" },
        ]}
      />
    </PortalPage>
  );
}
