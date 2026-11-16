import { createFileRoute } from "@tanstack/react-router";
import { ConsoleAgentDashboard } from "@/components/internal-console/workforce-screens";

export const Route = createFileRoute("/console/workforce/$agentCode")({
  component: AgentRoute,
  head: () => ({ meta: [{ title: "Agent — Sherivs Console" }] }),
});

function AgentRoute() {
  const { agentCode } = Route.useParams();
  return <ConsoleAgentDashboard code={agentCode} />;
}
