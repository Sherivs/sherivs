import { createFileRoute } from "@tanstack/react-router";
import { InternalConsoleLayout } from "@/components/internal-console/console-shell";

export const Route = createFileRoute("/console")({
  component: InternalConsoleLayout,
  head: () => ({
    meta: [
      { title: "Internal Console — Sherivs" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
