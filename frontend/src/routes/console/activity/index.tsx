import { createFileRoute } from "@tanstack/react-router";
import { ConsoleActivity } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/activity/")({
  component: () => <ConsoleActivity scope="all" />,
});
