import { createFileRoute } from "@tanstack/react-router";
import { ConsoleAgentWorkbench } from "@/components/internal-console/workforce-screens";

export const Route = createFileRoute("/console/workforce/$agentCode_/workbench")({
  component: WorkbenchRoute,
  head: () => ({ meta: [{ title: "Workbench — Sherivs Console" }] }),
});

function WorkbenchRoute() {
  const { agentCode } = Route.useParams();
  return <ConsoleAgentWorkbench code={agentCode} />;
}
