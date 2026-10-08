import { createFileRoute } from "@tanstack/react-router";
import { CommandCentre } from "@/components/command-centre/command-centre";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Organization provisioning — formerly the unsigned homepage Command Centre.
 * Kept as a real operator surface; it is no longer the public brand homepage.
 */
export const Route = createFileRoute("/(site)/provision")({
  component: CommandCentre,
  head: () => ({
    meta: [
      { title: `Provision an organization — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: "Operator onboarding: provision an organization, roles and policies on Sherivs.",
      },
    ],
  }),
});
