import { createFileRoute } from "@tanstack/react-router";
import { ConsoleLogs } from "@/components/internal-console/operations-screens";

export const Route = createFileRoute("/console/activity/logs")({
  component: ConsoleLogs,
  head: () => ({ meta: [{ title: "Logs — Sherivs Console" }] }),
});
