import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/enterprise")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Enterprise — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.enterprise.lead },
      { property: "og:title", content: "Enterprise — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.enterprise.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.enterprise} />;
}
