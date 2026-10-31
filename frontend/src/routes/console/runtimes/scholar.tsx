import { createFileRoute } from "@tanstack/react-router";
import { ConsoleScholarRuntime } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/runtimes/scholar")({
  component: ConsoleScholarRuntime,
  head: () => ({ meta: [{ title: "Sherivs Scholar — Console" }] }),
});
