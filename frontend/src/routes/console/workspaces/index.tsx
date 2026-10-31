import { createFileRoute } from "@tanstack/react-router";
import { ConsoleWorkspaces } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/workspaces/")({
  component: ConsoleWorkspaces,
});
