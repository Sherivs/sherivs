import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_PAGE_DESCRIPTION } from "@/lib/platform";
import { SherivsPublicHome } from "@/components/public/sherivs-public-home";

/**
 * LEGACY public URL `/coregrid`. Canonical Plane A home is `/`.
 * Kept so bookmarks and the (site) layout group continue to resolve.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  component: LegacySherivsSitePage,
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

function LegacySherivsSitePage() {
  return <SherivsPublicHome />;
}
