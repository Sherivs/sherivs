import { createFileRoute } from "@tanstack/react-router";
import { OwnerAlertsScreen } from "@/components/internal-console/owner-alerts-screen";

export const Route = createFileRoute("/console/alerts")({
  component: OwnerAlertsScreen,
  head: () => ({ meta: [{ title: "Alerts and approvals — Sherivs Console" }] }),
});
