import { createFileRoute } from "@tanstack/react-router";
import { ConsoleMetrics } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/activity/metrics")({
  component: ConsoleMetrics,
  head: () => ({ meta: [{ title: "Metrics — Sherivs Console" }] }),
});
