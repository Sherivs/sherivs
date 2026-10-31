import { createFileRoute } from "@tanstack/react-router";
import { ConsoleInvitations } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/team/invitations")({
  component: ConsoleInvitations,
  head: () => ({ meta: [{ title: "Invitations — Sherivs Console" }] }),
});
