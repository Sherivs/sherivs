import { createFileRoute } from "@tanstack/react-router";
import { PublicHome } from "@/components/experience/public-home";
import { PLATFORM_NAME, PLATFORM_PAGE_DESCRIPTION, PLATFORM_TAGLINE } from "@/lib/platform";

/**
 * Compatibility URL for the previous `/coregrid` marketing path.
 * Renders the Sherivs public home so existing anchors and journeys keep working.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  component: PublicHome,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      { name: "description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:title", content: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      { property: "og:description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
});
