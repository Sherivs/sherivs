import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/platform/integrations")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Integrations — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.platformIntegrations.lead },
      { property: "og:title", content: "Integrations — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.platformIntegrations.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.platformIntegrations} />;
}
