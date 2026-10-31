import { createFileRoute } from "@tanstack/react-router";
import { ConsoleOrganizationOnboarding } from "@/components/internal-console/organization-screens";

export const Route = createFileRoute("/console/organizations/new")({
  component: ConsoleOrganizationOnboarding,
  head: () => ({ meta: [{ title: "Onboard organization — Sherivs Console" }] }),
});
