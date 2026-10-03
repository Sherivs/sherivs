import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/intelligence-parents")({
  ssr: false,
  component: ParentExperienceCenter,
});

function ParentExperienceCenter() {
  return (
    <PortalPage
      title="Parent Experience Center"
      subtitle="Build trust with every family — visibility, growth and conversation in one hub."
    >
      <PlannedCapabilityState
        capability="Parent engagement analytics"
        note="Engagement, sentiment and fee-health analytics must be computed from real messaging and payment data before any number can be shown. Sentiment indices are planned capability — not in V1."
        realSurfaces={[
          { label: "Messages", to: "/messages" },
          { label: "Fees", to: "/admin/fees" },
        ]}
      />
    </PortalPage>
  );
}
