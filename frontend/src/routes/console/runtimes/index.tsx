import { createFileRoute } from "@tanstack/react-router";
import { ConsoleRuntimes } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/runtimes/")({
  component: ConsoleRuntimes,
});
