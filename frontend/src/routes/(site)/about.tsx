import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/about")({
  component: Page,
  head: () => ({
    meta: [
      { title: "About — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.about.lead },
      { property: "og:title", content: "About — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.about.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.about} />;
}
