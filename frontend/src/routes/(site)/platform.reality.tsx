import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/platform/reality")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Reality — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.platformReality.lead },
      { property: "og:title", content: "Reality — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.platformReality.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.platformReality} />;
}
