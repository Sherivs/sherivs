import { createFileRoute } from "@tanstack/react-router";
import { ConsoleOrganizationProfile } from "@/components/internal-console/organization-screens";

export const Route = createFileRoute("/console/organizations/$organizationId")({
  component: ConsoleOrganizationProfile,
  head: () => ({ meta: [{ title: "Organization — Sherivs Console" }] }),
});
