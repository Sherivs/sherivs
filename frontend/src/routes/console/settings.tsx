import { createFileRoute } from "@tanstack/react-router";
import { ConsoleSettings } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/settings")({
  component: ConsoleSettings,
  head: () => ({ meta: [{ title: "Platform settings — Sherivs Console" }] }),
});
