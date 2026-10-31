import { createFileRoute } from "@tanstack/react-router";
import { ConsoleSuspendedStaff } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/team/suspended")({
  component: ConsoleSuspendedStaff,
  head: () => ({ meta: [{ title: "Suspended staff — Sherivs Console" }] }),
});
