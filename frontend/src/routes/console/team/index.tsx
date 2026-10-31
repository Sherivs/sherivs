import { createFileRoute } from "@tanstack/react-router";
import { ConsoleTeamDirectory } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/team/")({
  component: ConsoleTeamDirectory,
});
