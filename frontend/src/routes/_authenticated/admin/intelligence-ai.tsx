import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { PlannedCapabilityState } from "@/components/planned-capability-state";

export const Route = createFileRoute("/_authenticated/admin/intelligence-ai")({
  ssr: false,
  component: AiCommandCenter,
});

function AiCommandCenter() {
  return (
    <PortalPage
      title="AI Command Center"
      subtitle="Every AI agent, workflow and report — managed in one place."
    >
      <PlannedCapabilityState
        capability="AI operations dashboard"
        note="An operations picture over AI agents, workflows and reports requires real usage-attribution data. The V1 AI gateway is governed through the platform's AI governance registry; per-org AI operations dashboards are planned capability — not in V1."
      />
    </PortalPage>
  );
}
