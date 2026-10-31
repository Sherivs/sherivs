import { createFileRoute } from "@tanstack/react-router";
import { ConsoleTickets } from "@/components/internal-console/operations-screens";

export const Route = createFileRoute("/console/activity/tickets")({
  component: ConsoleTickets,
  head: () => ({ meta: [{ title: "Tickets — Sherivs Console" }] }),
});
