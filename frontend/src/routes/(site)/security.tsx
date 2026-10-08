import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/security")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Security — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.security.lead },
      { property: "og:title", content: "Security — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.security.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.security} />;
}
