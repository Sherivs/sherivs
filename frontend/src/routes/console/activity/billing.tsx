import { createFileRoute } from "@tanstack/react-router";
import { ConsoleBilling } from "@/components/internal-console/operations-screens";

export const Route = createFileRoute("/console/activity/billing")({
  component: ConsoleBilling,
  head: () => ({ meta: [{ title: "Billing — Sherivs Console" }] }),
});
