import { createFileRoute } from "@tanstack/react-router";
import { ConsoleWorkforceRoster } from "@/components/internal-console/workforce-screens";

export const Route = createFileRoute("/console/workforce/")({
  component: ConsoleWorkforceRoster,
});
