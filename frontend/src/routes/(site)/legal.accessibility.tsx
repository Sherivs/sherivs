import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/legal/accessibility")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Accessibility — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.accessibility.lead },
      { property: "og:title", content: "Accessibility — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.accessibility.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.accessibility} />;
}
