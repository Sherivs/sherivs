import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/legal/terms")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Terms — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.terms.lead },
      { property: "og:title", content: "Terms — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.terms.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.terms} />;
}
