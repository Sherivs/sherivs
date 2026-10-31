import { createFileRoute } from "@tanstack/react-router";
import { ConsoleActivity } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/activity/security")({
  component: () => <ConsoleActivity scope="security" />,
  head: () => ({ meta: [{ title: "Security events — Sherivs Console" }] }),
});
