import { createFileRoute } from "@tanstack/react-router";
import { ConsoleIncidents } from "@/components/internal-console/operations-screens";

export const Route = createFileRoute("/console/activity/incidents")({
  component: ConsoleIncidents,
  head: () => ({ meta: [{ title: "Incidents — Sherivs Console" }] }),
});
