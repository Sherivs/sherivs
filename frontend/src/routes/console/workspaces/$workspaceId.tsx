import { createFileRoute } from "@tanstack/react-router";
import { ConsoleWorkspaceDetail } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/workspaces/$workspaceId")({
  component: ConsoleWorkspaceDetail,
  head: () => ({ meta: [{ title: "Workspace — Sherivs Console" }] }),
});
