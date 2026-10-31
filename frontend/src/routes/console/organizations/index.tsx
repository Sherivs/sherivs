import { createFileRoute } from "@tanstack/react-router";
import { ConsoleOrganizationDirectory } from "@/components/internal-console/organization-screens";

export const Route = createFileRoute("/console/organizations/")({
  component: ConsoleOrganizationDirectory,
  validateSearch: (search: Record<string, unknown>): { state?: string } => ({
    state: typeof search.state === "string" ? search.state : undefined,
  }),
});
