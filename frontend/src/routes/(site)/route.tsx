import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/experience/public-shell";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";

/**
 * Sherivs public site layout — pathless group `(site)`.
 *
 * Presentation chrome for the customer-facing platform. Interactive account
 * actions link to the real `/auth` surface. No tenant context, no fake forms.
 */
export const Route = createFileRoute("/(site)")({
  component: PublicShell,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      { name: "description", content: PLATFORM_TAGLINE },
    ],
  }),
});
