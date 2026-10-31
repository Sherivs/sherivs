import { createFileRoute } from "@tanstack/react-router";
import { ConsoleRoleCatalogue } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/team/roles")({
  component: ConsoleRoleCatalogue,
  head: () => ({ meta: [{ title: "Role catalogue — Sherivs Console" }] }),
});
