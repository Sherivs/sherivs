import { createFileRoute } from "@tanstack/react-router";
import { CommandCentre } from "@/components/command-centre/command-centre";
import { pageTitle } from "@/lib/experience/brand";

/**
 * Provisioning rehearsal — the in-memory organization provisioning wizard.
 *
 * Previously rendered at `/` to anonymous visitors. It is an operator tool
 * (it exercises the onboarding, role-model and security-policy contracts
 * without persisting anything), so it lives behind the command-centre's
 * platform-operator guard and the public root carries the Sherivs homepage.
 */
export const Route = createFileRoute("/_authenticated/command-centre/provision")({
  ssr: false,
  component: CommandCentre,
  head: () => ({
    meta: [
      { title: pageTitle("Provisioning rehearsal") },
      {
        name: "description",
        content:
          "Rehearse organization provisioning — legal identity, role model and security policies — against the platform contracts without persisting anything.",
      },
    ],
  }),
});
