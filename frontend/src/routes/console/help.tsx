import { createFileRoute } from "@tanstack/react-router";
import { ConsoleHelp } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/help")({
  component: ConsoleHelp,
  head: () => ({ meta: [{ title: "Help — Sherivs Console" }] }),
});
