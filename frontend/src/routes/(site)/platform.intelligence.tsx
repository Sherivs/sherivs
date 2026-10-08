import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/platform/intelligence")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Intelligence — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.platformIntelligence.lead },
      { property: "og:title", content: "Intelligence — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.platformIntelligence.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.platformIntelligence} />;
}
